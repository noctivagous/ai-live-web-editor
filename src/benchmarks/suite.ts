/**
 * Token benchmark — the BASIC suite (TASKS-token-efficiency §5, first slice).
 *
 * Five scripted tasks run verbatim against a fresh copy of the fixture
 * project (see fixture/). The prompts are part of the yardstick: they
 * are hashed into every report so a wording change shows up as a new
 * baseline, not a silent drift. Graders are deterministic — pure
 * file/text checks over the run copy plus the facts the runner
 * observed about the turn. No model judgment anywhere.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isWriteTool } from '../agentTools.js'

/** What the runner observed about one driven turn. */
export interface TurnFacts {
  /** The turn's whole visible reply text (all text deltas joined). */
  finalText: string
  /** Turn-level error (stream error event, timeout, missing done), else null. */
  error: string | null
  timedOut: boolean
  /** One entry per tool-result event, in order. */
  toolResults: { name: string; ok: boolean }[]
  /** Distinct tool-call ids seen (falls back to the result count). */
  toolCalls: number
}

export interface GradeCheck {
  name: string
  ok: boolean
  detail: string
}

export interface GradeResult {
  solved: boolean
  checks: GradeCheck[]
}

export interface BenchmarkTask {
  id: string
  title: string
  prompt: string
  grade: (runDir: string, facts: TurnFacts) => GradeResult
}

export const EMPTY_FACTS: TurnFacts = {
  finalText: '',
  error: null,
  timedOut: false,
  toolResults: [],
  toolCalls: 0,
}

function readText(runDir: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(runDir, rel), 'utf-8')
  } catch {
    return ''
  }
}

/** Inline <script> bodies of index.html — agents sometimes work there
 * instead of src/main.ts, and the content graders should see both. */
function inlineScripts(html: string): string {
  const out: string[] = []
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.push(m[1])
  return out.join('\n')
}

/** All code an agent could plausibly have edited for behaviour. */
function codeText(runDir: string): string {
  const html = readText(runDir, 'index.html')
  return `${readText(runDir, 'src/main.ts')}\n${inlineScripts(html)}`
}

/** Stylesheet text that can carry the card's look: the linked sheet,
 * any <style> blocks, and the card element's inline style attribute. */
function cardCssText(runDir: string): string {
  const html = readText(runDir, 'index.html')
  const parts: string[] = [readText(runDir, 'src/card.css')]
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = styleRe.exec(html))) parts.push(m[1])
  const inline = html.match(/<[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>/i)?.[0] || ''
  const styleAttr = inline.match(/style="([^"]*)"/i)?.[1]
  if (styleAttr) parts.push(`.card { ${styleAttr} }`)
  return parts.join('\n')
}

/** Declarations of every plain `.card { … }` rule, later rules winning. */
function cardDeclarations(css: string): Map<string, string> {
  const decls = new Map<string, string>()
  const re = /\.card\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    for (const part of m[1].split(';')) {
      const colon = part.indexOf(':')
      if (colon < 1) continue
      const prop = part.slice(0, colon).trim().toLowerCase()
      const value = part.slice(colon + 1).trim().toLowerCase()
      if (prop && value) decls.set(prop, value)
    }
  }
  return decls
}

/** 0 (black) .. 1 (white) for hex / rgb() / a small named set; null when unknown. */
function colorLuminance(raw: string): number | null {
  const v = raw.trim().toLowerCase()
  const named: Record<string, number> = {
    black: 0, navy: 0.06, darkblue: 0.08, maroon: 0.1, darkgreen: 0.12,
    darkslategray: 0.18, darkslategrey: 0.18, dimgray: 0.35, dimgrey: 0.35,
    gray: 0.5, grey: 0.5, silver: 0.75, lightgray: 0.83, lightgrey: 0.83,
    whitesmoke: 0.96, snow: 0.98, ivory: 0.99, white: 1,
  }
  if (v in named) return named[v]
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (rgb) {
    return (0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3])) / 255
  }
  return null
}

/** First length of a CSS value in px (rem/em at 16px), null when unparseable. */
function firstLengthPx(raw: string): number | null {
  const m = raw.trim().match(/([\d.]+)\s*(px|rem|em)?/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n
}

function result(checks: GradeCheck[]): GradeResult {
  return { solved: checks.every((c) => c.ok), checks }
}

const controlOk: BenchmarkTask = {
  id: 'control-ok',
  title: 'Control: reply OK, touch nothing',
  prompt: 'Reply with exactly the word OK and do nothing else.',
  grade: (_runDir, facts) => {
    const writes = facts.toolResults.filter((r) => isWriteTool(r.name))
    return result([
      {
        name: 'turn completed without error',
        ok: facts.error === null && !facts.timedOut,
        detail: facts.error ?? (facts.timedOut ? 'turn timed out' : 'done event received'),
      },
      {
        name: 'reply is exactly "OK"',
        ok: facts.finalText.trim() === 'OK',
        detail: `final text was ${JSON.stringify(facts.finalText.trim().slice(0, 80))}`,
      },
      {
        name: 'no write tools used',
        ok: writes.length === 0,
        detail: writes.length ? `write tools used: ${writes.map((w) => w.name).join(', ')}` : 'no write-tool results in the turn',
      },
    ])
  },
}

const addCounter: BenchmarkTask = {
  id: 'add-counter',
  title: 'Add a click counter under the card',
  prompt: "Add a counter to the page: a button labelled 'Count' and a number next to it that starts at 0 and goes up by 1 each time the button is clicked. Put it under the card.",
  grade: (runDir) => {
    const html = readText(runDir, 'index.html')
    const code = codeText(runDir)
    const buttonInHtml = /<button[^>]*>\s*Count\s*<\/button>/i.test(html)
    const buttonInCode = /createElement\(\s*['"]button['"]\s*\)/.test(code) && /['">]Count['"<]/.test(code)
    const clickHandler = /addEventListener\(\s*['"]click['"]/.test(code) || /\bonclick\s*=/.test(html + code)
    const increments = /\+\+|\+=\s*1|=\s*[A-Za-z_$][\w$]*\s*\+\s*1/.test(code)
    const renders = /textContent|innerText|innerHTML/.test(code)
    return result([
      {
        name: "a button labelled 'Count' exists",
        ok: buttonInHtml || buttonInCode,
        detail: buttonInHtml ? 'button found in index.html' : buttonInCode ? 'button created in code with Count label' : 'no Count button in index.html or code',
      },
      {
        name: 'a click handler is wired',
        ok: clickHandler,
        detail: clickHandler ? 'click listener / onclick found' : 'no click listener or onclick found',
      },
      {
        name: 'the count increments by 1',
        ok: increments,
        detail: increments ? 'increment expression found' : 'no ++ / += 1 / x = x + 1 expression found',
      },
      {
        name: 'the count is rendered back to the page',
        ok: renders,
        detail: renders ? 'a textContent/innerText/innerHTML write found' : 'no DOM text write found',
      },
    ])
  },
}

const restyleCard: BenchmarkTask = {
  id: 'restyle-card',
  title: 'Restyle the product card (dark, rounded, shadowed)',
  prompt: 'Restyle the product card: give it a dark background, light text, rounded corners of at least 12px, and a subtle shadow.',
  grade: (runDir) => {
    const decls = cardDeclarations(cardCssText(runDir))
    const bg = decls.get('background-color') || decls.get('background') || ''
    const bgLum = bg ? colorLuminance(bg.split(/\s+/)[0]) : null
    const fg = decls.get('color') || ''
    const fgLum = fg ? colorLuminance(fg) : null
    const radius = decls.get('border-radius') || ''
    const radiusPx = radius ? firstLengthPx(radius) : null
    const shadow = decls.get('box-shadow') || ''
    return result([
      {
        name: 'card background is dark',
        ok: bgLum !== null && bgLum < 0.35,
        detail: bg ? `background: ${bg} (luminance ${bgLum === null ? 'unknown' : bgLum.toFixed(2)})` : 'no .card background declared',
      },
      {
        name: 'card text is light',
        ok: fgLum !== null && fgLum > 0.65,
        detail: fg ? `color: ${fg} (luminance ${fgLum === null ? 'unknown' : fgLum.toFixed(2)})` : 'no .card color declared',
      },
      {
        name: 'border radius is at least 12px',
        ok: radiusPx !== null && radiusPx >= 12,
        detail: radius ? `border-radius: ${radius} (${radiusPx === null ? 'unparseable' : `${radiusPx}px`})` : 'no .card border-radius declared',
      },
      {
        name: 'card has a box shadow',
        ok: shadow !== '' && shadow !== 'none',
        detail: shadow ? `box-shadow: ${shadow}` : 'no .card box-shadow declared',
      },
    ])
  },
}

const fixRuntimeError: BenchmarkTask = {
  id: 'fix-runtime-error',
  title: 'Fix the load-time runtime error',
  prompt: 'The page throws a runtime error when it loads. Find it and fix it so the page loads cleanly. Change as little as possible.',
  grade: (runDir) => {
    const main = readText(runDir, 'src/main.ts')
    const bugGone = !main.includes('singup')
    const wired = /querySelector\(\s*['"]#signup-form['"]\s*\)/.test(main) || /getElementById\(\s*['"]signup-form['"]\s*\)/.test(main)
    return result([
      {
        name: 'the broken selector is gone',
        ok: bugGone,
        detail: bugGone ? "no 'singup' token remains in src/main.ts" : "src/main.ts still contains the misspelled 'singup' selector",
      },
      {
        name: 'the form is wired by its real id',
        ok: wired,
        detail: wired ? "src/main.ts looks up '#signup-form'" : "src/main.ts never looks up '#signup-form'",
      },
    ])
  },
}

const formValidation: BenchmarkTask = {
  id: 'form-validation',
  title: 'Add signup form validation',
  prompt: "Add validation to the signup form: if the email field is empty or does not look like an email address, stop the submit and show the message 'Please enter a valid email address' under the form.",
  grade: (runDir) => {
    const html = readText(runDir, 'index.html')
    const code = codeText(runDir)
    const message = 'Please enter a valid email address'
    const messageShown = code.includes(message) || html.includes(message)
    const submitHandler = /addEventListener\(\s*['"]submit['"]/.test(code) || /\bonsubmit\s*=/.test(html + code)
    const emailCheck = [
      /includes\(\s*['"]@['"]\s*\)/,
      /indexOf\(\s*['"]@['"]\s*\)/,
      /\/[^/\n]*@[^/\n]*\/[a-z]*\s*\.test\(/,
      /checkValidity\(\)/,
      /validity\.typeMismatch/,
    ].some((re) => re.test(code))
    const stopsSubmit = /preventDefault\(\)/.test(code)
    return result([
      {
        name: 'the exact validation message is present',
        ok: messageShown,
        detail: messageShown ? 'message string found' : `message ${JSON.stringify(message)} not found in code or page`,
      },
      {
        name: 'a submit handler exists',
        ok: submitHandler,
        detail: submitHandler ? 'submit listener / onsubmit found' : 'no submit listener or onsubmit found',
      },
      {
        name: 'the email value is checked',
        ok: emailCheck,
        detail: emailCheck ? 'an @ check / email regex / validity check found' : 'no email-shaped check found',
      },
      {
        name: 'the submit can be stopped',
        ok: stopsSubmit,
        detail: stopsSubmit ? 'preventDefault() found' : 'no preventDefault() found',
      },
    ])
  },
}

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  controlOk,
  addCounter,
  restyleCard,
  fixRuntimeError,
  formValidation,
]

export const BASIC_SUITE = {
  id: 'basic',
  title: 'Basic token benchmark (5 tasks)',
  tasks: BENCHMARK_TASKS,
}
