// Only documented, displayable quota fields leave the workstation.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_. -]{1,80}$/.test(value) && !/(?:^|[ -])(?:sk|org|acct|account|token|bearer)[-_ ]/i.test(value) ? value : null;
const window = value => object(value) ? { usedPercent: number(value.usedPercent) !== null && value.usedPercent <= 100 ? value.usedPercent : null, windowDurationMins: number(value.windowDurationMins, 1), resetsAt: number(value.resetsAt) } : null;
const taskQueryKeys = new Set(['courseid', 'taskid', 'workid', 'examid', 'classid', 'clazzid', 'id', 'knowledgeid']);
function bucket(value) {
  if (!object(value)) return null;
  const out = { primary: window(value.primary), secondary: window(value.secondary) };
  for (const key of ['limitId', 'limitName', 'planType', 'rateLimitReachedType']) {
    if (Object.hasOwn(value, key)) out[key] = identifier(value[key]);
  }
  if (Object.hasOwn(value, 'credits')) {
    if (!object(value.credits)) out.credits = null;
    else {
      const credits = value.credits;
      out.credits = {
        hasCredits: typeof credits.hasCredits === 'boolean' ? credits.hasCredits : null,
        unlimited: typeof credits.unlimited === 'boolean' ? credits.unlimited : null,
        balance: typeof credits.balance === 'string' && /^\d{1,16}(\.\d{1,8})?$/.test(credits.balance) ? credits.balance : null,
      };
    }
  }
  return out;
}
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const SAFE_ERRORS = new Set(['CODEX_AUTH_REQUIRED', 'CODEX_TIMEOUT', 'CODEX_UNAVAILABLE', 'CODEX_PROTOCOL_ERROR', 'CODEX_USAGE_UNAVAILABLE', 'CODEX_METHOD_UNAVAILABLE', 'CODEX_EXECUTABLE_NOT_FOUND', 'CODEX_HOME_UNAVAILABLE', 'CODEX_STATE_UNAVAILABLE', 'CODEX_PERMISSION_DENIED']);
export function sanitizeSnapshot(value) {
  if (!object(value)) throw new Error('SNAPSHOT_FILE_INVALID');
  let map = null;
  if (object(value.rateLimitsByLimitId)) {
    map = Object.fromEntries(Object.entries(value.rateLimitsByLimitId).filter(([key, val]) => object(val) && identifier(key) && !['__proto__', 'constructor', 'prototype'].includes(key)).slice(0, 100).map(([key, val]) => [key, bucket(val)]));
  }
  // Match the receiving schema: one observation per day, newest 400 days.
  const dailyMap = new Map();
  if (Array.isArray(value.dailyUsageBuckets)) {
    for (const row of value.dailyUsageBuckets) {
      if (object(row) && date(row.startDate) && Number.isSafeInteger(row.tokens) && row.tokens >= 0) dailyMap.set(row.startDate, { startDate: row.startDate, tokens: row.tokens });
    }
  }
  const daily = Array.isArray(value.dailyUsageBuckets) ? [...dailyMap.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(-400) : null;
  const out = { rateLimits: bucket(value.rateLimits), rateLimitsByLimitId: map, dailyUsageBuckets: daily };
  if (SAFE_ERRORS.has(value.error)) out.error = value.error;
  return out;
}
export function sanitizeTasks(value) {
  const rows = Array.isArray(value) ? value : value?.tasks;
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('TASK_FILE_INVALID');
  const map = new Map();
  for (const row of rows) {
    if (!object(row) || typeof row.platformId !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(row.platformId) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300) throw new Error('TASK_FILE_INVALID');
    if (row.course != null && (typeof row.course !== 'string' || row.course.length > 300)) throw new Error('TASK_FILE_INVALID');
    if (row.status != null && !['pending', 'completed'].includes(row.status)) throw new Error('TASK_FILE_INVALID');
    if (row.type != null && !['assignment', 'exam', 'other'].includes(row.type)) throw new Error('TASK_FILE_INVALID');
    if (row.dueAt != null && (typeof row.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(row.dueAt) || !Number.isFinite(Date.parse(row.dueAt)))) throw new Error('TASK_FILE_INVALID');
    let url = '';
    if (row.url) {
      try {
        const parsed = new URL(row.url);
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || row.url.length > 2000) throw new Error();
        for (const [key, value] of parsed.searchParams) {
          if (!taskQueryKeys.has(key.toLowerCase()) || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error();
        }
        url = parsed.href;
      } catch { throw new Error('TASK_FILE_INVALID'); }
    }
    map.set(row.platformId, { platformId: row.platformId, title: row.title.trim(), course: row.course ?? '', type: row.type ?? 'other', dueAt: row.dueAt ?? null, status: row.status ?? 'pending', url });
  }
  return [...map.values()];
}
