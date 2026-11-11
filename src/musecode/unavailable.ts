/**
 * The Muse Code engine's answer before its supervisor exists
 * (Muse Code design §4, slice 1): a chat turn that resolves to
 * the 'musecode' engine ends immediately with one plain error
 * event on the usual stream — never a hang, never a silent fall
 * through to another engine. Slice 4 replaces this pipe with
 * the real supervisor + translator in this folder.
 *
 * Two wordings, because they ask for different fixes: no binary
 * on this machine (install it, or pick another engine) vs the
 * binary is here but chat on this engine is not ready in this
 * version of the editor yet (pick another engine for now).
 */
import { beginChatSse, type ChatSseResponse, type ChatStreamReq } from '../chatStream.js'
import { getMuseCodeAvailability } from './availability.js'

export function musecodeUnavailableMessage(binaryAvailable: boolean): string {
  return binaryAvailable
    ? 'The Muse Code engine is not ready in this version of the editor yet, so chats can’t run on it. Pick a different chat engine in Settings → Agent & Chat.'
    : 'Muse Code is not available on this machine. Install Muse Code, then restart the editor — or pick a different chat engine in Settings → Agent & Chat.'
}

export async function pipeMusecodeUnavailable(res: ChatSseResponse, req?: ChatStreamReq): Promise<void> {
  const { send } = beginChatSse(res, req)
  const availability = await getMuseCodeAvailability()
  send({ type: 'error', error: musecodeUnavailableMessage(availability.available) })
  res.end()
}
