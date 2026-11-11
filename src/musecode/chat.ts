/**
 * Muse Code chat pipe (Muse Code design §6, slice 4).
 *
 * Serves POST /api/chat/stream when agent settings select the
 * musecode engine: ensure the project's `muse serve` host
 * (supervisor.ts), start or resume its durable session, send the
 * turn, and fold the SDK's item stream into the ChatStreamEvent
 * vocabulary (translator.ts) until the turn's outcome settles.
 *
 * The prompt is composed exactly as the OpenCode path composes
 * it: the route preamble for the turn's mode, then
 * buildTurnContext's parts (project brief, codebase map,
 * triggered skill bodies), then the user's text. On this engine
 * the preamble is instruction-level guidance only — tool use is
 * unmanaged here by design (design §2): there is no per-turn
 * tool gating, no tool-policy backstop, and no verify-gate arc
 * in this pipe. The gate re-check on this path is the managed
 * Stop hook's job (design §11, slice 9), not the translator's.
 *
 * Two mid-turn channels the spike proved exist are handled
 * honestly rather than silently: an approval this client never
 * answers is decided by the host's own default (its failures are
 * logged by the supervisor), and a request_user_input question —
 * which this version of the editor has no surface to answer —
 * ends the turn promptly with a plain explanation instead of
 * stalling until the watchdog.
 *
 * History: the session is Muse Code's (durable, resumed across
 * hosts by the supervisor); ALE keeps its usual chat record of
 * what was shown. Nothing is imported in either direction.
 */
import { createChatDebugTurn } from '../chatDebug.js'
import {
  abortSignalFromReq, beginChatSse,
  type ChatSseResponse, type ChatStreamEvent, type ChatStreamReq,
} from '../chatStream.js'
import { getFsRoot } from '../launcher.js'
import { logServerError } from '../serverLog.js'
import { getSketchMode, parseSketchMode, setSketchMode, SKETCH_TURN_PREAMBLE } from '../sketchSession.js'
import { buildTurnContext, latestUserText } from '../turnContext.js'
import { FILES_ROUTED_PREAMBLE, routeChatTurn, SKETCH_MIXED_PREAMBLE } from '../workflowRoute.js'
import { getMuseCodeAvailability } from './availability.js'
import {
  getOrStartMusecodeSession, type MusecodeSessionSlots,
} from './supervisor.js'
import { createMusecodeEventFolder, type MusecodeItemLike, type MusecodeOutcomeLike } from './translator.js'
import { musecodeUnavailableMessage } from './unavailable.js'

/** The host layer's session slots (supervisor.ts): filled by
 * the slices that own the content — slice 5 the ALE MCP server,
 * slice 9 the managed hooks file. Empty in this slice, by
 * design: the wiring is real, the content lands later. */
let hostSlots: MusecodeSessionSlots = {}

export function setMusecodeHostSlots(next: MusecodeSessionSlots): void {
  hostSlots = next
}

export function musecodeHostSlots(): MusecodeSessionSlots {
  return hostSlots
}

const TURN_TIMEOUT_MS = 15 * 60_000
const USER_INPUT_POLL_MS = 2_000

export async function pipeMusecodeChatStream(
  messages: unknown,
  res: ChatSseResponse,
  req?: ChatStreamReq,
  workflow?: unknown,
): Promise<void> {
  const dbg = createChatDebugTurn({ engine: 'musecode' })
  const { send: rawSend } = beginChatSse(res, req)
  const send = (obj: unknown) => {
    dbg.recordEvent(obj as ChatStreamEvent)
    rawSend(obj)
  }
  const abortSignal = abortSignalFromReq(req)
  try {
    // Availability gates before anything spawns (§4): no binary
    // gets slice 1's plain answer, never a spawn error.
    const availability = await getMuseCodeAvailability()
    if (!availability.available) {
      const message = musecodeUnavailableMessage(false)
      send({ type: 'error', error: message })
      res.end()
      dbg.finish({ error: message })
      return
    }

    // Turn mode, determined exactly as the other engines
    // determine it: an explicit workflow wins, then the router
    // may switch a Sketch turn with files intent to Files.
    const parsed = parseSketchMode(workflow)
    if (parsed) setSketchMode(parsed)
    const routed = routeChatTurn(getSketchMode(), messages)
    if (routed.switched) setSketchMode(routed.mode)
    const mode = getSketchMode()
    dbg.noteMode(mode, routed.switched)
    if (routed.switched) send({ type: 'workflow', mode: routed.mode, reason: routed.reason })
    send({ type: 'status', text: 'starting…' })
    const userText = latestUserText(messages)
    if (!userText) {
      const message = 'No user message was provided for the Muse Code turn.'
      send({ type: 'error', error: message })
      res.end()
      dbg.finish({ error: message })
      return
    }

    // Per-turn brief: the same content assembly the other
    // engines perform — route preamble, turn context parts,
    // user text (see the module header for why the preamble is
    // guidance, not gating, on this engine).
    const preamble = mode === 'sketch' && routed.intent === 'mixed'
      ? SKETCH_MIXED_PREAMBLE
      : mode === 'sketch'
        ? SKETCH_TURN_PREAMBLE
        : routed.switched
          ? FILES_ROUTED_PREAMBLE
          : null
    let skillsUsed: { name: string, via: string }[] = []
    const turnContext = await buildTurnContext(userText, {
      mode,
      onSkillsUsed: (used) => { skillsUsed = used },
    })
    if (skillsUsed.length) send({ type: 'skills', skills: skillsUsed })
    const promptText = [preamble, ...turnContext, userText]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join('\n\n')

    const projectRoot = getFsRoot()
    const { session, record } = await getOrStartMusecodeSession(projectRoot, musecodeHostSlots())
    console.log(
      `[musecode] turn on session ${record.sessionId} (posture ${record.posture}, muse ${record.binaryVersion}${record.resumed ? ', resumed' : ''})`,
    )

    const turn = await session.sendUserTurn({ input: [{ type: 'text', text: promptText }] })
    const folder = createMusecodeEventFolder()

    // Client disconnect cancels the turn (its terminal still
    // arrives server-side; we just stop waiting for it here).
    const onAbort = () => { void turn.cancel().catch(() => { /* already settled */ }) }
    if (abortSignal.aborted) onAbort()
    else abortSignal.addEventListener('abort', onAbort, { once: true })

    // Watchdog: the SDK never times a turn out locally, and a
    // turn the host wedges on must not hang the chat forever.
    const watchdog = setTimeout(() => { void turn.cancel().catch(() => { /* already settled */ }) }, TURN_TIMEOUT_MS)
    watchdog.unref?.()

    // request_user_input has no answering surface in this
    // version of the editor: if the agent asks, say so and end
    // the turn instead of leaving it pending (spike item 4
    // proved the channel; a UI for it is later work).
    let userInputBlock = false
    const inputPoll = setInterval(() => {
      try {
        const pending = session.fold.pendingUserInputs()
        if (pending.length > 0 && !userInputBlock) {
          userInputBlock = true
          void turn.cancel().catch(() => { /* already settled */ })
        }
      } catch { /* fold unavailable mid-turn — the watchdog still bounds the turn */ }
    }, USER_INPUT_POLL_MS)
    inputPoll.unref?.()

    try {
      for await (const item of turn.items()) {
        for (const ev of folder.pushItem(item as unknown as MusecodeItemLike)) send(ev)
      }
    } finally {
      clearTimeout(watchdog)
      clearInterval(inputPoll)
      abortSignal.removeEventListener('abort', onAbort)
    }
    const outcome = await turn.completed
    folder.pushOutcome(outcome as unknown as MusecodeOutcomeLike)

    if (userInputBlock) {
      const message = 'Muse Code asked a question during that turn, and this version of the editor can’t show questions from it yet — the turn was stopped. Rephrase the request so it doesn’t need an answer mid-task, or switch the chat engine in Settings → Agent & Chat.'
      send({ type: 'error', error: message })
      res.end()
      dbg.finish({ error: message })
      return
    }

    if (folder.terminal === 'failed' && folder.failure) {
      const failure = folder.failure
      if (failure.billing) {
        // §14: a payment/quota failure is a billing state on the
        // Muse account, surfaced as what it is — never dressed
        // as an agent error.
        const resets = failure.quotaResetsAtMs
          ? ` It resets ${new Date(failure.quotaResetsAtMs).toLocaleString()}.`
          : ''
        const message = `Muse Code couldn’t run that turn: ${failure.message} This is a payment or usage-limit state on the Muse account, not an editor error.${resets}`
        console.log(`[musecode] billing state on session ${record.sessionId}: ${failure.message}`)
        send({ type: 'error', error: message })
        res.end()
        dbg.finish({ error: `billing: ${failure.message}` })
        return
      }
      send({ type: 'error', error: failure.message })
      res.end()
      dbg.finish({ error: failure.message })
      return
    }

    if (abortSignal.aborted) {
      res.end()
      dbg.finish({ aborted: true })
      return
    }

    send({ type: 'done', usage: folder.usage })
    res.end()
    dbg.finish({})
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logServerError({ kind: 'chat-error', route: 'POST /api/chat/stream (musecode)', status: 500, message })
    try {
      send({ type: 'error', error: message })
      res.end()
    } catch { /* the client is already gone */ }
    dbg.finish({ error: message })
  }
}
