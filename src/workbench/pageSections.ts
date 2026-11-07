/**
 * Workbench environment program #1: page sectioning. Unlike the text
 * programs (unpack, read-symbol), this one cannot run in Node — the
 * rendered page's structure (post-JS DOM, computed visibility, real
 * geometry) exists only inside a browser. The program below is a
 * self-contained IIFE string evaluated in the live page through the
 * existing eval channel (page bridge or Playwright pool, the same
 * transport checkFrames and eval-js already use). It is strictly
 * read-only: it walks, measures and reports; it never mutates the DOM.
 *
 * What comes back is the page's table of contents: landmark sections
 * (header/nav/main/section/… + ARIA roles) with names, rects, text
 * digests and drill-in handles — or, on pages without landmarks, a
 * structural chunking of the body's large visible children, with the
 * mode stated so a guess is never mistaken for ground truth.
 */
export const PAGE_SECTIONS_PROGRAM = `(() => {
  var MAXS = 60;
  function clip(s, n) { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function vis(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return r;
  }
  function headingOf(el) {
    var h = el.querySelector('h1,h2,h3,h4,h5,h6');
    return h ? clip(h.innerText || h.textContent, 80) : '';
  }
  function selectorFor(el) {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var parts = [];
    var n = el;
    for (var i = 0; i < 3 && n && n !== document.body; i++) {
      var p = n.tagName.toLowerCase();
      if (n.classList && n.classList.length) p += '.' + n.classList[0];
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(' > ');
  }
  var LAND = 'header,nav,main,section,article,aside,footer,[role="banner"],[role="navigation"],[role="main"],[role="contentinfo"],[role="complementary"],[role="region"],[role="search"],[role="form"]';
  var found = Array.prototype.slice.call(document.querySelectorAll(LAND));
  var mode = 'landmarks';
  var cands = [];
  found.forEach(function (el) { var r = vis(el); if (r) cands.push({ el: el, r: r }); });
  if (cands.length < 2) {
    mode = 'structural';
    cands = [];
    var kids = document.body ? Array.prototype.slice.call(document.body.children) : [];
    kids.forEach(function (el) {
      var r = vis(el);
      if (r && r.width * r.height > innerWidth * innerHeight * 0.02) cands.push({ el: el, r: r });
    });
  }
  cands = cands.slice(0, MAXS);
  function depthOf(el) {
    var d = 0;
    var n = el.parentElement;
    while (n) { if (found.indexOf(n) >= 0) d++; n = n.parentElement; }
    return d;
  }
  var sections = cands.map(function (c, i) {
    var el = c.el, r = c.r;
    var role = el.getAttribute('role') || '';
    var name = el.getAttribute('aria-label') || headingOf(el) || role || el.tagName.toLowerCase();
    return {
      i: i,
      name: clip(name, 80),
      tag: el.tagName.toLowerCase(),
      role: role,
      selector: selectorFor(el),
      aiLoc: el.getAttribute('data-ai-loc') || '',
      depth: depthOf(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      digest: clip(el.innerText || el.textContent || '', 120),
      elements: el.querySelectorAll('*').length,
      interactive: el.querySelectorAll('a,button,input,select,textarea,[tabindex]').length
    };
  });
  var outline = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3')).slice(0, 20).map(function (h) {
    return { level: Number(h.tagName[1]), text: clip(h.innerText || h.textContent, 80) };
  });
  return {
    url: location.href,
    title: document.title,
    mode: mode,
    viewport: { w: innerWidth, h: innerHeight },
    sections: sections,
    outline: outline
  };
})()`

export interface PageSection {
  name: string
  tag: string
  role: string
  selector: string
  aiLoc: string
  depth: number
  rect: { x: number, y: number, w: number, h: number }
  digest: string
  elements: number
  interactive: number
}

export interface PageSectionsResult {
  url: string
  title: string
  mode: 'landmarks' | 'structural'
  viewport: { w: number, h: number }
  sections: PageSection[]
  outline: { level: number, text: string }[]
}

export const MAX_PAGE_SECTIONS = 60

export interface LayoutElementLike {
  rect?: { x?: number, y?: number, width?: number, height?: number }
  section?: string
  [key: string]: unknown
}

/**
 * Geometric join: assign each layout element the name of the smallest
 * page section whose rect contains the element's centre, so a flat
 * element list gains the section map's grouping. Best-effort by
 * design — elements outside every section (or with no usable rect)
 * are left untouched, and sections are viewport-space, matching the
 * layout snapshot's default coordinate space.
 */
export function joinSectionsToElements<T extends LayoutElementLike>(elements: T[], sections: PageSection[]): T[] {
  if (!sections.length) return elements
  const byArea = [...sections]
    .filter((s) => s.rect.w > 0 && s.rect.h > 0)
    .sort((a, b) => (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h) || b.depth - a.depth)
  for (const el of elements) {
    const r = el.rect
    if (!r || typeof r.x !== 'number' || typeof r.y !== 'number') continue
    const cx = r.x + (r.width || 0) / 2
    const cy = r.y + (r.height || 0) / 2
    const hit = byArea.find((s) => cx >= s.rect.x && cx <= s.rect.x + s.rect.w && cy >= s.rect.y && cy <= s.rect.y + s.rect.h)
    if (hit) el.section = hit.name
  }
  return elements
}
const MAX_DIGEST = 120
const MAX_NAME = 80

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Unwrap and validate whatever the eval channel returned — the bare
 * program result, `{ result }` (pool), `{ result: "<json>" }`, or a
 * bridge envelope — into a clean PageSectionsResult, or null when the
 * payload is not a sections result at all. Caps and clips are enforced
 * here, on the Node side, so a surprising page cannot push an
 * unbounded or malformed result into the agent's turn.
 */
export function normalizePageSections(raw: unknown): PageSectionsResult | null {
  let cur: unknown = raw
  for (let hop = 0; hop < 3; hop++) {
    const rec = asRecord(cur)
    if (!rec) return null
    if (Array.isArray(rec.sections)) { cur = rec; break }
    if (typeof rec.result === 'string') {
      try { cur = JSON.parse(rec.result) } catch { return null }
    } else if (rec.result && typeof rec.result === 'object') {
      cur = rec.result
    } else {
      return null
    }
  }
  const rec = asRecord(cur)
  if (!rec || !Array.isArray(rec.sections)) return null
  const sections: PageSection[] = []
  for (const item of rec.sections) {
    const s = asRecord(item)
    if (!s) continue
    const rect = asRecord(s.rect) || {}
    sections.push({
      name: clip(String(s.name ?? ''), MAX_NAME),
      tag: String(s.tag ?? ''),
      role: String(s.role ?? ''),
      selector: String(s.selector ?? ''),
      aiLoc: String(s.aiLoc ?? ''),
      depth: Math.max(0, Math.round(num(s.depth))),
      rect: {
        x: Math.round(num(rect.x)), y: Math.round(num(rect.y)),
        w: Math.max(0, Math.round(num(rect.w))), h: Math.max(0, Math.round(num(rect.h))),
      },
      digest: clip(String(s.digest ?? ''), MAX_DIGEST),
      elements: Math.max(0, Math.round(num(s.elements))),
      interactive: Math.max(0, Math.round(num(s.interactive))),
    })
    if (sections.length >= MAX_PAGE_SECTIONS) break
  }
  const vp = asRecord(rec.viewport) || {}
  const outline: { level: number, text: string }[] = []
  if (Array.isArray(rec.outline)) {
    for (const item of rec.outline) {
      const o = asRecord(item)
      if (!o) continue
      outline.push({ level: Math.min(3, Math.max(1, Math.round(num(o.level, 1)))), text: clip(String(o.text ?? ''), MAX_NAME) })
      if (outline.length >= 20) break
    }
  }
  return {
    url: String(rec.url ?? ''),
    title: String(rec.title ?? ''),
    mode: rec.mode === 'structural' ? 'structural' : 'landmarks',
    viewport: { w: Math.max(0, Math.round(num(vp.w))), h: Math.max(0, Math.round(num(vp.h))) },
    sections,
    outline,
  }
}
