import type { LiveStream } from '@/state/chatRuntime'
import type { ConversationMessage } from '@/lib/conversations/types'

/**
 * The chat feed's row list: the stored transcript with the in-flight turn laid
 * over it.
 *
 * The whole point of this function is that it is a PURE MERGE with no notion of
 * time. Every earlier attempt at "show the live turn, then swap in the saved
 * copy" was a sequencing problem — clear the overlay too early and the row is
 * in neither place (a blank); too late and it is in both (a duplicate). Neither
 * ordering can be guaranteed, because the two halves arrive independently: the
 * desktop pushes turn.status the moment a turn ends but persists the message
 * before that, and the body fetch that follows may or may not have caught it.
 *
 * So nothing is sequenced. Both halves are addressed by MESSAGE ID — the phone
 * mints the prompt's id and sends it with the turn, the desktop stamps its
 * assistant message once and mirrors it under that id — and a live row is
 * simply not emitted when the stored transcript already carries its id. The
 * overlay can therefore be dropped whenever, arrive whenever, and repeat: the
 * feed is the same either way.
 *
 * The assistant row's key is fixed rather than derived from the message. A
 * turn's live row starts as a thinking indicator with no id at all and later
 * learns the desktop's; keying on that would remount the row mid-turn and
 * restart the typed words. There is at most one live assistant row, so one
 * constant key is enough to keep it mounted for the whole turn.
 */

export const LIVE_KEY = 'live'

export type FeedItem = {
  key: string
  message: ConversationMessage
  /** True while this row is being written — drives the thinking indicator. */
  streaming: boolean
}

export type BuildFeedInput = {
  /** The stored transcript, in order. Undefined while it is still being read. */
  messages?: ConversationMessage[]
  /** The in-flight turn for this conversation, if any. */
  live?: LiveStream
  /**
   * The prompt sent from a chat that has no conversation id yet, held by the
   * screen for the round trip that mints one. Ignored once `live` carries it.
   */
  pendingUser?: ConversationMessage | null
  /** True between pressing Send and the desktop accepting the turn. */
  sending?: boolean
}

export function buildFeed({ messages, live, pendingUser, sending }: BuildFeedInput): FeedItem[] {
  const items: FeedItem[] = []
  const stored = new Set<string>()
  for (const message of messages ?? []) {
    const key = message.id ?? `${message.role}:${message.timestamp}`
    if (message.id) stored.add(message.id)
    items.push({ key, message, streaming: false })
  }

  // The prompt. `live.user` supersedes the screen's copy — they are the same
  // message under the same id, so preferring one keeps it from rendering twice.
  const user = live?.user ?? pendingUser ?? null
  if (user && !(user.id && stored.has(user.id))) {
    items.push({ key: user.id ?? 'pending-user', message: user, streaming: false })
  }

  if (live) {
    if (!(live.message.id && stored.has(live.message.id))) {
      items.push({ key: LIVE_KEY, message: live.message, streaming: live.status === 'streaming' })
    }
    return items
  }

  // Sending, but the desktop has not answered yet: there is no turn to show
  // and no id to file it under, so the thinking row stands in for both. It is
  // the same row the live turn will occupy, under the same key, so the handover
  // is invisible — the typed words never restart.
  if (sending) {
    items.push({
      key: LIVE_KEY,
      message: { role: 'assistant', content: '', timestamp: Date.now() },
      streaming: true
    })
  }
  return items
}
