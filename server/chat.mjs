import { z } from 'zod';
const bodySchema=z.object({message:z.string().trim().min(1).max(12000),mode:z.enum(['tutor','plan','essay','reading','translation']),goalId:z.string().max(100).optional()}).strict();
const usageSchema=z.object({prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative(),total_tokens:z.number().int().nonnegative()});
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const instructions={tutor:'用中文辅导学习，解释步骤并提问检查理解。',plan:'根据目标提供可执行学习计划，明确日期、科目和时间。',essay:'辅导英语写作，说明修改原因并给出练习。',reading:'辅导英语阅读，解释关键句式、词汇和证据。',translation:'辅导中英翻译，解释表达选择。'};
export async function studyChat(request,reply,{store,vault,fetcher,settings}) {
  const body=bodySchema.parse(request.body);
  const ai=settings.ai,key=vault.get('ai.apiKey')||(ai.provider==='deepseek'?vault.get('deepseek.apiKey'):ai.provider==='openai'?vault.get('openai.apiKey'):null);
  if(!key)return reply.code(400).send({error:'请先配置学习 AI 的 API 密钥'});
  const goal=body.goalId?store.find('goals',body.goalId):null;
  if(body.goalId&&!goal)return reply.code(400).send({error:'学习目标不存在'});
  const day=dayFormat.format(new Date());
  const knownCost=store.list('chatMessages').filter(record=>record.role==='assistant'&&record.currency===ai.currency&&typeof record.cost==='number'&&dayFormat.format(new Date(record.createdAt))===day).reduce((sum,record)=>sum+record.cost,0);
  if(ai.dailyBudget!=null&&knownCost>=ai.dailyBudget)return reply.code(429).send({error:'今天已记录的估算费用达到预算阈值；此阈值在下一次调用前检查，不保证实际账单上限',code:'ESTIMATED_BUDGET_REACHED'});
  const counter=store.get('chatCounter',{day,count:0});if(counter.day!==day){counter.day=day;counter.count=0;}
  if(counter.count>=ai.dailyRequestLimit)return reply.code(429).send({error:'今天的 AI 请求次数已达到上限'});
  // Reserve before the first asynchronous operation, so concurrent requests cannot bypass the cap.
  counter.count++;store.set('chatCounter',counter);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  const disconnect=()=>{if(!reply.raw.writableFinished)controller.abort();};reply.raw.on('close',disconnect);
  let response;
  try {
    response=await fetcher(`${ai.baseUrl.replace(/\/$/,'')}/chat/completions`,{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:ai.model,stream:true,stream_options:{include_usage:true},max_tokens:ai.maxTokens,messages:[{role:'system',content:instructions[body.mode]+(goal?` 学习目标：${goal.title}；科目：${goal.subjects.join('、')}`:'')},...store.list('chatMessages').slice(-8).map(({role,content})=>({role,content:content.slice(0,4000)})),{role:'user',content:body.message}]})});
    if(!response.ok){await response.body?.cancel();throw new Error('UPSTREAM_ERROR');}
    if(!response.body)throw new Error('EMPTY_RESPONSE');
  } catch {clearTimeout(timer);reply.raw.off('close',disconnect);return reply.code(502).send({error:'AI 服务连接失败，请检查网络、密钥、模型和权限；本次计入每日请求上限'});}
  reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
  const send=event=>{if(!reply.raw.destroyed)reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);};
  let text='',usage=null,buffer='',complete=false,size=0;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  store.save('chatMessages',{role:'user',content:body.message,model:ai.model});
  const parse=block=>{
    const payload=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!payload)return;
    if(payload==='[DONE]'){complete=true;return;}
    const event=JSON.parse(payload);
    if(event.error)throw new Error('UPSTREAM_STREAM_ERROR');
    if(event.usage){const parsed=usageSchema.safeParse(event.usage);if(parsed.success)usage=parsed.data;}
    const delta=event.choices?.[0]?.delta?.content;
    if(typeof delta==='string'&&delta){text+=delta;if(text.length>30000)throw new Error('OUTPUT_TOO_LARGE');send({type:'delta',text:delta});}
  };
  try {
    while(!complete){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error('STREAM_TOO_LARGE');buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){parse(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}}
    if(buffer.trim())parse(buffer);
    if(!complete)throw new Error('INCOMPLETE_STREAM');
    const estimate=usage&&(ai.inputPrice>0||ai.outputPrice>0)?{cost:(usage.prompt_tokens*ai.inputPrice+usage.completion_tokens*ai.outputPrice)/1_000_000,currency:ai.currency}:{};
    if(text)store.save('chatMessages',{role:'assistant',content:text,model:ai.model,...(usage?{tokens:usage.total_tokens,...estimate}:{})});
    send({type:'done',...(usage?{usage:{...usage,...estimate,...('cost' in estimate?{costSource:'configured_price_estimate'}:{})}}:{})});
  } catch {send({type:'error',error:'AI 响应中断或源数据无效，未保存不完整回答'});}
  finally {clearTimeout(timer);reply.raw.off('close',disconnect);await reader.cancel().catch(()=>{});reply.raw.end();}
}
