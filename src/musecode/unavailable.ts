/**
 * The Muse Code engine's honest-absence surface (Muse Code
 * design §4, slice 1; install guidance added in the setup-polish
 * pass). Since slice 4 the real path exists — musecode/chat.ts
 * runs the turn — and this module is what the absence still
 * looks like: when no binary is on this machine, the chat pipe
 * answers immediately with this one plain error event on the
 * usual stream — never a hang, never a silent fall through to
 * another engine, and never a spawn error.
 *
 * The wording carries the requirement and where to meet it, as
 * text (chat has no cards): the same "Requirement: Muse Code"
 * label and product URL the requirement note shows in Setup and
 * Settings. No restart is demanded — install, then press
 * Refresh in Settings → Agent & Chat (or pick another engine).
 *
 * pipeMusecodeUnavailable remains as the standalone pipe form
 * (and its tests); the routed chat path sends the same message
 * from its own pre-flight check.
 */
import { beginChatSse, type ChatSseResponse, type ChatStreamReq } from '../chatStream.js'
import { MUSE_CODE_PRODUCT_URL } from '../ui/lib/museSandbox.js'
import { getMuseCodeAvailability } from './availability.js'

export function musecodeUnavailableMessage(binaryAvailable: boolean): string {
  return binaryAvailable
    ? 'The Muse Code engine is not ready in this version of the editor yet, so chats can’t run on it. Pick a different chat engine in Settings → Agent & Chat.'
    : `Muse Code is not available on this machine. Requirement: Muse Code — installed on this machine before this path can be used: ${MUSE_CODE_PRODUCT_URL} — or pick a different chat engine in Settings → Agent & Chat.`
}

export async function pipeMusecodeUnavailable(res: ChatSseResponse, req?: ChatStreamReq): Promise<void> {
  const { send } = beginChatSse(res, req)
  const availability = await getMuseCodeAvailability()
  send({ type: 'error', error: musecodeUnavailableMessage(availability.available) })
  res.end()
}
