/** Abbreviated chips for the annotation section: selectors and notes in one glance. */

const NOTE_ABBR = 24

/** `main > div:nth-of-type(2) > h1` → `div > h1`; ids and short selectors pass through. */
export function abbreviateSelector(selector: string): string {
  const s = (selector || '').trim()
  if (!s) return 'body'
  const parts = s.split('>').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 2) return s
  return parts.slice(-2).map((p) => p.replace(/:nth-of-type\(\d+\)/g, '')).join(' > ')
}

export function abbreviateNote(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= NOTE_ABBR) return t
  return t.slice(0, NOTE_ABBR) + '…'
}

/** Token appended to the chat input when the selected-element chip is clicked. */
export function elementToken(selector: string): string {
  return `@${abbreviateSelector(selector)} `
}

/** Token appended to the chat input when a note chip is clicked. */
export function noteToken(text: string): string {
  return `note: "${text.replace(/\s+/g, ' ').trim().slice(0, 120)}" `
}
