/**
 * Page fetching for research (phase-11-06 §N): one URL in,
 * readable text out. Deliberately small — strip the structural
 * noise (scripts, styles, nav chrome), keep headings and
 * paragraphs as plain text. Loopback and private-network hosts
 * are refused: an agent tool must not become a way to read the
 * user's LAN or this editor's own API.
 */
import type { FetchImpl } from './brave.js'

export const MAX_PAGE_CHARS = 8_000

export function isPublicHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return false
  return true
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m)
}

/** Reduce an HTML document to readable plain text (title first when known). */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  body = decodeEntities(body)
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { title: title ? decodeEntities(title).trim() : undefined, text: body }
}

export async function fetchPageText(
  url: string,
  fetchImpl: FetchImpl = fetch,
  maxChars: number = MAX_PAGE_CHARS,
): Promise<{ ok: true; title?: string; url: string; text: string; truncated: boolean } | { ok: false; error: string }> {
  if (!isPublicHttpUrl(url)) {
    return { ok: false, error: `Refused: ${url} is not a public http(s) URL (loopback/private hosts are blocked for fetch-page).` }
  }
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ai-live-editor research)', Accept: 'text/html, text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    })
  } catch (e) {
    return { ok: false, error: `Fetch failed for ${url}: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) return { ok: false, error: `Fetch failed for ${url}: HTTP ${res.status}` }
  const raw = await res.text()
  const type = res.headers.get('content-type') || ''
  const { title, text } = type.includes('html') || raw.trimStart().startsWith('<')
    ? htmlToText(raw)
    : { title: undefined, text: raw }
  const truncated = text.length > maxChars
  return { ok: true, title, url, text: truncated ? text.slice(0, maxChars) : text, truncated }
}
