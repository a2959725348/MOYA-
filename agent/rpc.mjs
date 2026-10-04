import { spawn } from 'node:child_process';
import { sanitizeSnapshot } from './normalize.mjs';

function startupFailure(text) {
  if (/Could not find home directory/i.test(text)) return 'CODEX_HOME_UNAVAILABLE';
  if (/failed to initialize (?:sqlite )?state runtime/i.test(text)) return 'CODEX_STATE_UNAVAILABLE';
  if (/access is denied|permission denied|拒绝访问|os error 5\b/i.test(text)) return 'CODEX_PERMISSION_DENIED';
  return 'CODEX_UNAVAILABLE';
}

export class AppServerClient {
  constructor({ command = process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex'), args = ['app-server'], timeoutMs = 15000, cwd = process.cwd(), env = process.env, signal } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.closed = false;
    this.initialized = false;
    this.startupText = '';
    this.startupCode = null;
    // No shell, no log forwarding, no browser or credential-file access.
    const childEnv = { ...env };
    delete childEnv.WORKBENCH_AGENT_TOKEN;
    if (!childEnv.CODEX_HOME?.trim()) delete childEnv.CODEX_HOME;
    if (!childEnv.CODEX_BIN?.trim()) delete childEnv.CODEX_BIN;
    this.child = spawn(command, args, { cwd, env: childEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', data => this.consume(data));
    // Inspect a bounded startup suffix only to select fixed error codes. Raw logs
    // are never printed, uploaded, or retained after initialization / process exit.
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', text => { if (!this.initialized) this.startupText = (this.startupText + text).slice(-8192); });
    this.child.on('error', error => {
      this.startupCode = error.code === 'ENOENT' ? 'CODEX_EXECUTABLE_NOT_FOUND' : ['EACCES', 'EPERM'].includes(error.code) ? 'CODEX_PERMISSION_DENIED' : 'CODEX_UNAVAILABLE';
      this.fail(this.startupCode);
    });
    this.child.on('close', () => {
      this.startupCode ??= this.initialized ? 'CODEX_UNAVAILABLE' : startupFailure(this.startupText);
      this.startupText = '';
      this.fail(this.startupCode);
    });
    this.child.stdin.on('error', () => this.fail(this.startupCode || startupFailure(this.startupText)));
    this.signal = signal;
    this.abort = () => this.close();
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.close();
  }
  consume(data) {
    this.buffer += data;
    if (this.buffer.length > 2 * 1024 * 1024) { this.fail('CODEX_PROTOCOL_ERROR'); this.close(); return; }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.fail('CODEX_PROTOCOL_ERROR'); this.close(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { this.fail('CODEX_PROTOCOL_ERROR'); this.close(); return; }
      // Server-originated requests need a safe refusal; never service auth/token requests.
      if (message.method && Object.hasOwn(message, 'id')) {
        this.send({ id: message.id, error: { code: -32601, message: 'Unsupported method' } }); continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) {
        const code = message.error.code;
        pending.reject(new Error(code === 401 || code === 403 ? 'CODEX_AUTH_REQUIRED' : code === -32601 ? 'CODEX_METHOD_UNAVAILABLE' : 'CODEX_UNAVAILABLE'));
      } else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
      else pending.reject(new Error('CODEX_PROTOCOL_ERROR'));
    }
  }
  send(message) {
    if (this.closed || !this.child.stdin.writable) throw new Error('CODEX_UNAVAILABLE');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('CODEX_UNAVAILABLE'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CODEX_TIMEOUT')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('CODEX_UNAVAILABLE')); }
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'personal_workbench_sync', title: 'Personal Workbench Sync', version: '1.0.0' } });
    this.initialized = true;
    this.startupText = '';
    this.send({ method: 'initialized', params: {} });
  }
  fail(code) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(code)); }
    this.pending.clear();
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.fail('CODEX_UNAVAILABLE');
    this.startupText = '';
    this.signal?.removeEventListener('abort', this.abort);
    this.child.stdin.destroy(); this.child.kill();
  }
}

export async function readCodexSnapshot(client) {
  await client.initialize();
  const [quota, usage] = await Promise.allSettled([client.request('account/rateLimits/read'), client.request('account/usage/read')]);
  if (quota.status === 'rejected') throw quota.reason;
  const snapshot = sanitizeSnapshot({ ...quota.value, dailyUsageBuckets: usage.status === 'fulfilled' ? usage.value?.dailyUsageBuckets : null });
  if (usage.status === 'rejected') snapshot.error = 'CODEX_USAGE_UNAVAILABLE';
  return snapshot;
}
