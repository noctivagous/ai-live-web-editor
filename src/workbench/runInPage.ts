/**
 * run-in-page — the workbench's first EXECUTING program (slices 1–6
 * are pure: read-only, originals untouched; this one is not, and the
 * tool's description says so).
 *
 * The agent hands over a snippet of JavaScript to check a fact at
 * runtime — what a module really exports, what a function really
 * returns, what state the app is really in. The program below runs
 * the snippet in the live page (the app's own page, with the app's
 * own powers — unsandboxed on purpose; a sandbox would blind it)
 * as the body of an async function: `return` sends a value back,
 * `await` works. The program captures console output during the
 * run, races the snippet against a timeout, and serializes the
 * return value safely (DOM elements, functions, circular objects
 * and deep structures degrade to descriptions, never explosions).
 *
 * Transport is the same eval channel page-sections rides
 * (livePageOp: bridge by default, pool for other origins). The
 * pool's evaluate awaits promises natively; the bridge client
 * learned to await thenables alongside this slice.
 */

export const RUN_TIMEOUT_MS = 10_000
export const MAX_RUN_CONSOLE_LINES = 50
export const MAX_RUN_VALUE_CHARS = 20_000

/**
 * Build the self-contained program string for one run. The user
 * code is embedded as a JSON string literal and handed to the
 * AsyncFunction constructor INSIDE the page, so quotes and
 * backslashes in the snippet can never break out of the embedding.
 */
export function buildRunProgram(code: string, timeoutMs: number = RUN_TIMEOUT_MS): string {
  return `(async () => {
  var CODE = ${JSON.stringify(code)};
  var TIMEOUT = ${Math.max(100, Math.floor(timeoutMs))};
  var started = Date.now();
  var logs = [];
  function describe(v, depth, seen) {
    if (v === undefined) return '[undefined]';
    if (v === null) return null;
    var t = typeof v;
    if (t === 'string') return v.length > 2000 ? v.slice(0, 2000) + '…' : v;
    if (t === 'number') return isFinite(v) ? v : String(v);
    if (t === 'boolean') return v;
    if (t === 'bigint') return String(v) + 'n';
    if (t === 'symbol') return String(v);
    if (t === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (v && v.nodeType === 1 && typeof v.tagName === 'string') {
      var cls = typeof v.className === 'string' && v.className ? '.' + v.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
      return '[Element ' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + cls + ']';
    }
    if (v instanceof Date) return v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (v instanceof Error) return { name: v.name, message: v.message };
    if (seen.indexOf(v) !== -1) return '[circular]';
    if (depth >= 3) return Array.isArray(v) ? '[array ' + v.length + ' items]' : '[object]';
    seen.push(v);
    var out;
    if (Array.isArray(v)) {
      out = [];
      for (var i = 0; i < Math.min(v.length, 20); i++) out.push(describe(v[i], depth + 1, seen));
      if (v.length > 20) out.push('… ' + (v.length - 20) + ' more');
    } else {
      out = {};
      var keys = Object.keys(v);
      for (var j = 0; j < Math.min(keys.length, 50); j++) {
        try { out[keys[j]] = describe(v[keys[j]], depth + 1, seen); } catch (e) { out[keys[j]] = '[unreadable]'; }
      }
      if (keys.length > 50) out['…'] = (keys.length - 50) + ' more keys';
    }
    seen.pop();
    return out;
  }
  function fmtArg(a) {
    if (typeof a === 'string') return a;
    var d = describe(a, 0, []);
    return typeof d === 'string' ? d : JSON.stringify(d);
  }
  var methods = ['log', 'info', 'warn', 'error', 'debug'];
  var orig = {};
  methods.forEach(function (k) {
    orig[k] = console[k];
    console[k] = function () {
      if (logs.length < ${MAX_RUN_CONSOLE_LINES}) {
        var line = k + ': ' + Array.prototype.map.call(arguments, fmtArg).join(' ');
        logs.push(line.length > 300 ? line.slice(0, 300) + '…' : line);
      }
      try { return orig[k].apply(console, arguments); } catch (e) { /* the page's console is best-effort */ }
    };
  });
  function restore() { methods.forEach(function (k) { console[k] = orig[k]; }); }
  try {
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    var fn = new AsyncFunction(CODE);
    var run = fn();
    run.catch(function () { /* a post-timeout rejection is not news */ });
    var value = await Promise.race([
      run,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('run-in-page timed out after ' + TIMEOUT + 'ms — the code may still be running in the page')); }, TIMEOUT);
      }),
    ]);
    restore();
    return { ok: true, value: describe(value, 0, []), console: logs, elapsedMs: Date.now() - started };
  } catch (e) {
    restore();
    return {
      ok: false,
      error: {
        name: e && e.name ? String(e.name) : 'Error',
        message: e && e.message ? String(e.message) : String(e),
        stack: e && e.stack ? String(e.stack).split('\\n').slice(0, 6).join('\\n') : undefined,
      },
      console: logs,
      elapsedMs: Date.now() - started,
    };
  }
})()`
}

export interface RunResult {
  ok: boolean
  value?: unknown
  console: string[]
  error?: { name: string, message: string, stack?: string }
  elapsedMs?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function unwrapRun(value: unknown, depth: number): unknown {
  if (depth > 4) return value
  if (typeof value === 'string') {
    try { return unwrapRun(JSON.parse(value), depth + 1) } catch { return value }
  }
  const obj = asRecord(value)
  if (obj && 'result' in obj && !('ok' in obj && typeof obj.ok === 'boolean')) {
    return unwrapRun(obj.result, depth + 1)
  }
  return value
}

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + '…')

/**
 * Validate and bound whatever the channel brought back. Returns
 * null for anything that is not a run result — the tool turns that
 * into an error value rather than passing a surprising page payload
 * into the turn.
 */
export function normalizeRunResult(raw: unknown): RunResult | null {
  const obj = asRecord(unwrapRun(raw, 0))
  if (!obj || typeof obj.ok !== 'boolean') return null
  const logs = Array.isArray(obj.console)
    ? obj.console.filter((l): l is string => typeof l === 'string').slice(0, MAX_RUN_CONSOLE_LINES).map(l => clip(l, 300))
    : []
  const out: RunResult = { ok: obj.ok, console: logs }
  if (typeof obj.elapsedMs === 'number' && Number.isFinite(obj.elapsedMs)) out.elapsedMs = Math.round(obj.elapsedMs)
  if (obj.ok) {
    if ('value' in obj) {
      let serialized = ''
      try { serialized = JSON.stringify(obj.value) ?? '' } catch { serialized = '' }
      out.value = serialized.length > MAX_RUN_VALUE_CHARS
        ? `[value too large to return: ${serialized.length} chars — return a smaller summary from the code]`
        : obj.value
    }
  } else {
    const err = asRecord(obj.error)
    out.error = err
      ? {
          name: clip(String(err.name ?? 'Error'), 100),
          message: clip(String(err.message ?? 'unknown error'), 500),
          ...(typeof err.stack === 'string' ? { stack: clip(err.stack, 1200) } : {}),
        }
      : { name: 'Error', message: 'the run failed without an error object' }
  }
  return out
}
