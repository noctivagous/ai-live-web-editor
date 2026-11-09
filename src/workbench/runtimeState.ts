/**
 * Workbench environment program #2: page runtime state. The DOM senses
 * (snapshot, sections, inspect) see elements; canvas/WebGL-painted
 * content never appears in them, and the painted pixels live behind
 * app runtime state (web storage, in-memory models) rather than the
 * DOM. The programs below are self-contained strings evaluated in the
 * live page through the existing eval channel (page bridge or
 * Playwright pool, the same transport page-sections uses).
 *
 * The scan program is strictly read-only: it inventories web storage
 * and, given a target string, reports where that string occurs. The
 * set program is the sanctioned write path: read-modify-write of one
 * JSON path with the previous value returned as backup, verified by
 * read-back, with an optional reload so the app rehydrates.
 */

/** Build the scan program. `match` is case-insensitive; null skips the search (inventory only). */
export function buildScanProgram(match: string | null): string {
  return `(() => {
  var MATCH = ${JSON.stringify(match)};
  var NEEDLE = (typeof MATCH === 'string' && MATCH) ? MATCH.toLowerCase() : null;
  var out = { ok: true, match: MATCH, stores: {}, hits: [], hitsTruncated: false, indexedDB: false };
  try { out.indexedDB = typeof indexedDB !== 'undefined'; } catch (e) { out.indexedDB = false; }
  function findPaths(raw, needle, path, depth, acc) {
    if (acc.length >= 20 || depth > 8) return;
    var t = typeof raw;
    if (t === 'string') {
      if (raw.toLowerCase().indexOf(needle) !== -1) acc.push(path || '(raw)');
      return;
    }
    if (raw !== null && t === 'object') {
      var keys = Array.isArray(raw) ? raw.map(function (_, i) { return i; }) : Object.keys(raw);
      for (var i = 0; i < keys.length && acc.length < 20; i++) {
        if (i >= 200) break;
        var k = keys[i];
        var child;
        try { child = raw[k]; } catch (e) { continue; }
        var seg = Array.isArray(raw) ? '[' + k + ']' : (path ? path + '.' + k : String(k));
        findPaths(child, needle, seg, depth + 1, acc);
      }
    }
  }
  var NAMES = ['localStorage', 'sessionStorage'];
  for (var s = 0; s < NAMES.length; s++) {
    var name = NAMES[s];
    var st = null;
    try { st = window[name]; } catch (e) { out.stores[name] = { error: 'unreadable' }; continue; }
    if (!st) { out.stores[name] = { error: 'absent' }; continue; }
    var keys = [];
    var n = 0;
    try { n = st.length; } catch (e) { out.stores[name] = { error: 'unreadable' }; continue; }
    for (var i = 0; i < n && i < 500; i++) {
      var k = null;
      try { k = st.key(i); } catch (e) { continue; }
      var v = null;
      try { v = st.getItem(k); } catch (e) { keys.push({ key: String(k), bytes: -1 }); continue; }
      keys.push({ key: String(k), bytes: v == null ? 0 : v.length });
      if (NEEDLE && v != null && v.length <= 1000000 && v.toLowerCase().indexOf(NEEDLE) !== -1 && out.hits.length < 20) {
        var parsed = null, isJson = false;
        try { parsed = JSON.parse(v); isJson = true; } catch (e) { /* raw string */ }
        if (isJson) {
          var acc = [];
          findPaths(parsed, NEEDLE, '', 0, acc);
          for (var h = 0; h < acc.length && out.hits.length < 20; h++) {
            out.hits.push({ store: name, key: String(k), path: acc[h] });
          }
        } else {
          out.hits.push({ store: name, key: String(k), path: '(raw)' });
        }
      }
    }
    out.stores[name] = keys;
  }
  out.hitsTruncated = out.hits.length >= 20;
  return out;
})()`;
}

export interface RuntimeSetArgs {
  store: 'localStorage' | 'sessionStorage'
  key: string
  /** Dotted/index path within the stored JSON (a.b[0].c); absent replaces the whole value. */
  path?: string
  /** The new value, as JSON text. */
  valueJson: string
  /** Reload the page after a verified write so the app rehydrates. */
  reload: boolean
}

/** Build the set program. Values travel as JSON text so quotes can never break the embedding. */
export function buildSetProgram(a: RuntimeSetArgs): string {
  return `(() => {
  var ARGS = ${JSON.stringify(a)};
  function fail(error) { return { ok: false, error: error, store: ARGS.store, key: ARGS.key }; }
  if (ARGS.store !== 'localStorage' && ARGS.store !== 'sessionStorage') return fail('unknown store');
  var st = null;
  try { st = window[ARGS.store]; } catch (e) { return fail('store unreadable'); }
  if (!st) return fail('store absent');
  var raw = null;
  try { raw = st.getItem(ARGS.key); } catch (e) { return fail('key unreadable'); }
  function parsePath(p) {
    var segs = [];
    var cur = '';
    for (var i = 0; i < p.length; i++) {
      var c = p[i];
      if (c === '.') { if (cur) { segs.push(cur); cur = ''; } }
      else if (c === '[') {
        if (cur) { segs.push(cur); cur = ''; }
        var j = p.indexOf(']', i);
        if (j < 0) throw 0;
        segs.push(Number(p.slice(i + 1, j)));
        i = j;
      } else { cur += c; }
    }
    if (cur) segs.push(cur);
    if (!segs.length) throw 0;
    return segs;
  }
  var next;
  if (ARGS.path) {
    var base;
    try { base = raw == null ? {} : JSON.parse(raw); } catch (e) {
      return fail('stored value is not JSON, so a path cannot be set — omit path to replace the whole value');
    }
    if (base === null || typeof base !== 'object') return fail('stored value is not an object');
    var val;
    try { val = JSON.parse(ARGS.valueJson); } catch (e) { return fail('value is not valid JSON'); }
    var segs;
    try { segs = parsePath(ARGS.path); } catch (e) { return fail('bad path'); }
    var node = base;
    for (var d = 0; d < segs.length - 1; d++) {
      var s = segs[d];
      if (node[s] === null || typeof node[s] !== 'object') node[s] = (typeof segs[d + 1] === 'number') ? [] : {};
      node = node[s];
    }
    node[segs[segs.length - 1]] = val;
    try { next = JSON.stringify(base); } catch (e) { return fail('updated value does not serialize'); }
  } else {
    next = ARGS.valueJson;
  }
  try { st.setItem(ARGS.key, next); } catch (e) { return fail('write failed (quota or access)'); }
  var check = null;
  try { check = st.getItem(ARGS.key); } catch (e) { /* fall through to mismatch */ }
  if (check !== next) return { ok: false, error: 'verify read-back mismatch', store: ARGS.store, key: ARGS.key };
  var out = { ok: true, store: ARGS.store, key: ARGS.key, appliedBytes: next.length };
  if (ARGS.path) out.path = ARGS.path;
  if (raw != null && raw.length > 4000) { out.backup = raw.slice(0, 4000); out.backupTruncated = true; }
  else { out.backup = raw; out.backupTruncated = false; }
  if (ARGS.reload) {
    try { setTimeout(function () { location.reload(); }, 100); out.reloaded = true; }
    catch (e) { out.reloaded = false; }
  }
  return out;
})()`;
}

export interface RuntimeScanHit {
  store: string
  key: string
  path: string
}

export interface RuntimeScanStoreKey {
  key: string
  bytes: number
}

export interface RuntimeScanResult {
  ok: true
  match: string | null
  stores: Record<string, RuntimeScanStoreKey[] | { error: string }>
  hits: RuntimeScanHit[]
  hitsTruncated: boolean
  indexedDB: boolean
}

/** Validate a scan payload; garbage in becomes an error value, never a throw. */
export function normalizeScanResult(raw: unknown): RuntimeScanResult | { ok: false, error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'unreadable scan result' };
  const r = raw as Record<string, unknown>;
  if (r.ok !== true || !r.stores || typeof r.stores !== 'object') {
    return { ok: false, error: typeof r.error === 'string' ? r.error : 'unreadable scan result' };
  }
  const hits = Array.isArray(r.hits)
    ? r.hits.filter((h): h is RuntimeScanHit =>
      !!h && typeof h === 'object'
      && typeof (h as RuntimeScanHit).store === 'string'
      && typeof (h as RuntimeScanHit).key === 'string'
      && typeof (h as RuntimeScanHit).path === 'string')
    : [];
  return {
    ok: true,
    match: typeof r.match === 'string' ? r.match : null,
    stores: r.stores as RuntimeScanResult['stores'],
    hits,
    hitsTruncated: r.hitsTruncated === true,
    indexedDB: r.indexedDB === true,
  };
}

export interface RuntimeSetResult {
  ok: boolean
  store: string
  key: string
  path?: string
  appliedBytes?: number
  /** Previous raw value (clipped), so the write is reversible. */
  backup?: string | null
  backupTruncated?: boolean
  reloaded?: boolean
  error?: string
}

/** Validate a set payload; garbage in becomes an error value, never a throw. */
export function normalizeSetResult(raw: unknown): RuntimeSetResult {
  if (!raw || typeof raw !== 'object') return { ok: false, store: '', key: '', error: 'unreadable set result' };
  const r = raw as Record<string, unknown>;
  const base = {
    store: typeof r.store === 'string' ? r.store : '',
    key: typeof r.key === 'string' ? r.key : '',
  };
  if (r.ok !== true) {
    return { ...base, ok: false, error: typeof r.error === 'string' ? r.error : 'write failed' };
  }
  const backup: string | null | undefined =
    typeof r.backup === 'string' ? r.backup : r.backup === null ? null : undefined;
  return {
    ...base,
    ok: true,
    ...(typeof r.path === 'string' ? { path: r.path } : null),
    ...(typeof r.appliedBytes === 'number' ? { appliedBytes: r.appliedBytes } : null),
    ...(backup !== undefined ? { backup } : null),
    ...(typeof r.backupTruncated === 'boolean' ? { backupTruncated: r.backupTruncated } : null),
    ...(typeof r.reloaded === 'boolean' ? { reloaded: r.reloaded } : null),
  };
}
