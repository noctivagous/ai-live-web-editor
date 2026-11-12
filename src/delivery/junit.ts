/**
 * A small JUnit XML reader, shared by the runners that report
 * in JUnit (node:test's --test-reporter=junit and pytest's
 * --junitxml). Deliberately a reader, not a DOM: it extracts
 * testsuite/testcase elements and their attributes, decoding
 * the standard XML entities. Malformed input yields what
 * could be read, never a throw.
 */

export interface JunitCase {
  name: string
  classname: string
  file?: string
  timeSec: number
  failure?: string
  skipped: boolean
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w.-]+)="([^"]*)"/g)) attrs[m[1]] = decodeEntities(m[2])
  return attrs
}

export function parseJunit(xml: string): JunitCase[] {
  const cases: JunitCase[] = []
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = attrsOf(m[1])
    const body = m[2] ?? ''
    const failureEl = /<failure\b[^>]*>([\s\S]*?)<\/failure>/.exec(body)
    const failureAttr = attrs.failure
    cases.push({
      name: attrs.name ?? '',
      classname: attrs.classname ?? '',
      ...(attrs.file ? { file: attrs.file } : {}),
      timeSec: Number(attrs.time ?? 0) || 0,
      skipped: /<skipped\b/.test(body),
      ...((failureEl || failureAttr)
        ? { failure: (failureEl ? decodeEntities(failureEl[1]) : failureAttr ?? '').trim().slice(0, 4000) }
        : {}),
    })
  }
  return cases
}
