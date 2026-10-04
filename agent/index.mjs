import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { AppServerClient, readCodexSnapshot } from './rpc.mjs';
import { sanitizeSnapshot, sanitizeTasks, SAFE_ERRORS } from './normalize.mjs';

const LOCAL_ERRORS = new Set(['ARGS_INVALID', 'WORKBENCH_URL_INVALID', 'AGENT_TOKEN_REQUIRED', 'SYNC_HTTP_ERROR', 'SYNC_TIMEOUT', 'SYNC_UNAVAILABLE', 'SNAPSHOT_FILE_INVALID', 'TASK_FILE_INVALID', 'IMPORT_FILE_INVALID', 'OBSERVATION_INVALID']);
export function safeError(error) { return SAFE_ERRORS.has(error?.message) || LOCAL_ERRORS.has(error?.message) ? error.message : 'CODEX_UNAVAILABLE'; }
function options(args) {
  const out = { once: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--once') out.once = true;
    else if (key === '--dry-run') { out.dryRun = true; out.once = true; }
    else if (key === '--snapshot-file' || key === '--tasks-file') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('ARGS_INVALID');
      out[key === '--snapshot-file' ? 'snapshotFile' : 'tasksFile'] = args[++i]; out.once = true;
    } else throw new Error('ARGS_INVALID');
  }
  if (out.snapshotFile && out.tasksFile || out.dryRun && out.tasksFile) throw new Error('ARGS_INVALID');
  return out;
}
function baseUrl(value) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || url.protocol === 'http:' && loopback) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url;
  } catch { throw new Error('WORKBENCH_URL_INVALID'); }
}
async function loadFile(path) {
  try {
    if ((await stat(path)).size > 1024 * 1024) throw new Error();
    return JSON.parse(await readFile(path, 'utf8'));
  } catch { throw new Error('IMPORT_FILE_INVALID'); }
}
function observation(value) {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('OBSERVATION_INVALID');
  return new Date(value).toISOString();
}
export async function upload(base, endpoint, body, token, signal, timeoutMs = 15000) {
  try {
    const response = await fetch(new URL(endpoint, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('SYNC_HTTP_ERROR'); }
    // Never display arbitrary response content or retain an unbounded response body.
    await response.body?.cancel();
  } catch (error) {
    if (error.message === 'SYNC_HTTP_ERROR') throw error;
    throw new Error(error.name === 'TimeoutError' ? 'SYNC_TIMEOUT' : 'SYNC_UNAVAILABLE');
  }
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const opts = options(args);
  const base = opts.dryRun ? null : baseUrl(env.WORKBENCH_URL || 'http://127.0.0.1:4318');
  const token = env.WORKBENCH_AGENT_TOKEN;
  if (!opts.dryRun && (typeof token !== 'string' || !token || /[\r\n]/.test(token))) throw new Error('AGENT_TOKEN_REQUIRED');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let failures = 0;
  try {
    while (!controller.signal.aborted) {
      try {
        let data, observedAt, imported = false, endpoint = '/api/sync/codex';
        if (opts.tasksFile || opts.snapshotFile) {
          const raw = await loadFile(opts.tasksFile || opts.snapshotFile);
          observedAt = observation(raw.observedAt); imported = true;
          if (opts.tasksFile) { data = { tasks: sanitizeTasks(raw) }; endpoint = '/api/sync/tasks'; }
          else data = sanitizeSnapshot(raw);
        } else {
          const client = new AppServerClient({ command: env.CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex'), env, signal: controller.signal });
          try { data = await readCodexSnapshot(client); }
          catch (error) {
            if (opts.dryRun || controller.signal.aborted) throw error;
            data = { ...sanitizeSnapshot({}), error: safeError(error) };
          } finally { client.close(); }
          observedAt = new Date().toISOString();
        }
        if (opts.dryRun) { process.stdout.write(JSON.stringify(data) + '\n'); return; }
        const body = { eventId: imported ? createHash('sha256').update(JSON.stringify({ observedAt, ...data })).digest('hex') : randomUUID(), observedAt, ...data };
        await upload(base, endpoint, body, token, controller.signal);
        if (data.error) { process.stderr.write(data.error + '\n'); failures++; if (opts.once) { process.exitCode = 1; return; } }
        else { process.stdout.write(endpoint.endsWith('tasks') ? 'TASKS_SYNCED\n' : 'CODEX_SYNCED\n'); failures = 0; }
      } catch (error) {
        if (controller.signal.aborted) break;
        process.stderr.write(safeError(error) + '\n'); failures++;
        if (opts.once) { process.exitCode = 1; return; }
      }
      if (opts.once) return;
      try { await sleep(Math.min(900000, 60000 * 2 ** Math.min(failures, 4)), undefined, { signal: controller.signal }); }
      catch { break; }
    }
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; });
}
