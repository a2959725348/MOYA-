import { z } from 'zod';
import { reserveAIRequest } from '../server/ai-limits.mjs';
import { settingsDefaults } from '../server/schema.mjs';
import { withStore } from './store.mjs';
import { Vault } from './vault.mjs';

const bodySchema = z.object({
  message: z.string().trim().min(1).max(12000),
  mode: z.enum(['tutor', 'plan', 'essay', 'reading', 'translation']),
  goalId: z.string().max(100).optional(),
}).strict();
const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
const instructions = {
  tutor: '用中文辅导学习，解释步骤并提问检查理解。',
  plan: '根据目标提供可执行学习计划，明确日期、科目和时间。',
  essay: '辅导英语写作，说明修改原因并给出练习。',
  reading: '辅导英语阅读，解释关键句式、词汇和证据。',
  translation: '辅导中英翻译，解释表达选择。',
};
const connectionError = 'AI 服务连接失败，请检查网络、密钥、模型和权限；本次计入每日请求上限';
const streamError = 'AI 响应中断或源数据无效，未保存不完整回答';
const json = (status, body) => Response.json(body, { status, headers: { 'X-Content-Type-Options': 'nosniff' } });

function abortable(operation, signal) {
  if (signal.aborted) return Promise.reject(new Error('ABORTED'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function handleChat(request, env, ctx, { body, fetcher = fetch, sessionHash } = {}) {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return json(400, { error: '学习请求格式无效' });
  body = parsed.data;

  // Only the database work may retry. A paid upstream request is made exactly once.
  let reserved;
  try {
    reserved = await withStore(env.DB, async store => {
      if (sessionHash !== undefined) {
        const session = store.getSession(sessionHash);
        if (!session || session.expires <= Date.now()) return { response: json(401, { error: '请先登录' }) };
      }
      const stored = store.get('settings', settingsDefaults);
      const ai = { ...settingsDefaults.ai, ...stored.ai };
      const vault = new Vault(store, env.VAULT_KEY);
      const key = vault.get('ai.apiKey') || (ai.provider === 'deepseek' ? vault.get('deepseek.apiKey') : ai.provider === 'openai' ? vault.get('openai.apiKey') : null);
      if (!key) return { response: json(400, { error: '请先配置学习 AI 的 API 密钥' }) };
      const goal = body.goalId ? store.find('goals', body.goalId) : null;
      if (body.goalId && !goal) return { response: json(400, { error: '学习目标不存在' }) };
      const history = store.list('chatMessages');
      try{reserveAIRequest(store,ai);}catch(error){return {response:json(error.statusCode||500,{error:error.message,...(error.code?{code:error.code}:{})})};}
      const messages = [
        { role: 'system', content: instructions[body.mode] + (goal ? ` 学习目标：${goal.title}；科目：${goal.subjects.join('、')}` : '') },
        ...history.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
        { role: 'user', content: body.message },
      ];
      return { ai, key, messages };
    }, { retries: 5 });
  } catch {
    return json(502, { error: connectionError });
  }
  if (reserved.response) return reserved.response;
  const { ai, key, messages } = reserved;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 60000);
  const disconnect = () => abortController.abort();
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) disconnect();
  const cleanup = () => {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', disconnect);
  };
  let upstream;
  let reader;
  try {
    if (abortController.signal.aborted) throw new Error('ABORTED');
    upstream = await abortable(fetcher(`${ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: abortController.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ai.model, stream: true, stream_options: { include_usage: true }, max_tokens: ai.maxTokens, messages }),
    }), abortController.signal);
    if (!upstream.ok || !upstream.body) throw new Error('UPSTREAM_ERROR');
    reader = upstream.body.getReader();
    await withStore(env.DB, async store => {
      if (abortController.signal.aborted) throw new Error('ABORTED');
      store.save('chatMessages', { role: 'user', content: body.message, model: ai.model });
    }, { retries: 5 });
  } catch {
    cleanup();
    abortController.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (upstream?.body) void upstream.body.cancel().catch(() => {});
    return json(502, { error: connectionError });
  }

  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = event => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const pump = async () => {
        let text = '', usage = null, buffer = '', complete = false, size = 0;
        const decoder = new TextDecoder();
        const parse = block => {
          const payload = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!payload) return;
          if (payload === '[DONE]') { complete = true; return; }
          const event = JSON.parse(payload);
          if (event.error) throw new Error('UPSTREAM_STREAM_ERROR');
          if (event.usage) {
            const result = usageSchema.safeParse(event.usage);
            if (result.success) usage = result.data;
          }
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            text += delta;
            if (text.length > 30000) throw new Error('OUTPUT_TOO_LARGE');
            send({ type: 'delta', text: delta });
          }
        };
        try {
          while (!complete) {
            const { done, value } = await abortable(reader.read(), abortController.signal);
            if (done) { buffer += decoder.decode(); break; }
            size += value.byteLength;
            if (size > 2_000_000) throw new Error('STREAM_TOO_LARGE');
            // Preserve raw CRLF until the entire delimiter arrives across chunk boundaries.
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while (!complete && (boundary = /\r?\n\r?\n/.exec(buffer))) {
              parse(buffer.slice(0, boundary.index));
              buffer = buffer.slice(boundary.index + boundary[0].length);
            }
          }
          if (!complete && buffer.trim()) parse(buffer);
          if (!complete || !text || abortController.signal.aborted) throw new Error('INCOMPLETE_STREAM');
          const estimate = usage && (ai.inputPrice > 0 || ai.outputPrice > 0) ? {
            cost: (usage.prompt_tokens * ai.inputPrice + usage.completion_tokens * ai.outputPrice) / 1_000_000,
            currency: ai.currency,
          } : {};
          await withStore(env.DB, async store => {
            if (abortController.signal.aborted) throw new Error('ABORTED');
            store.save('chatMessages', { role: 'assistant', content: text, model: ai.model, ...(usage ? { tokens: usage.total_tokens, ...estimate } : {}) });
          }, { retries: 5 });
          if (abortController.signal.aborted) throw new Error('ABORTED');
          send({ type: 'done', ...(usage ? { usage: { ...usage, ...estimate, ...('cost' in estimate ? { costSource: 'configured_price_estimate' } : {}) } } : {}) });
        } catch {
          send({ type: 'error', error: streamError });
        } finally {
          cleanup();
          void reader.cancel().catch(() => {});
          if (!cancelled) controller.close();
        }
      };
      const task = pump();
      if (ctx?.waitUntil) ctx.waitUntil(task);
    },
    cancel() {
      cancelled = true;
      abortController.abort();
      cleanup();
      void reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  } });
}
