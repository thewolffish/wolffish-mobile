import { invalidateConversation } from '@/lib/conversations/cache'
import {
  getConversationRatings,
  mergeConversationRatings,
  removeConversationRating,
  replaceConversationRatings
} from '@/lib/conversations/repo'
import type { ConversationRating } from '@/lib/conversations/types'
import { tunnelClient } from '@/lib/tunnel/client'
import { Rpc } from '@/lib/tunnel/protocol'
import { useAppStore } from '@/state/appStore'

/**
 * Turn scoring — the phone's half of the desktop's 0-10 rating bar.
 *
 * A score is a fact about a turn, not about a device: whoever casts it, every
 * surface showing that conversation has to move. The desktop already worked
 * that way (its bar reflects a bare-number Telegram reply live), and this is
 * the same contract extended one hop: the vote is written on the desktop, the
 * desktop announces it, and both screens render the announcement rather than
 * their own optimism.
 *
 * What arrives from the desktop — `turn.scored` pushes and the ratings a body
 * fetch carries — lands through `applyRemoteRatings`, which is why the merge
 * in the repo is "incoming wins, absent ids untouched": the desktop is the
 * source of truth for every vote including this phone's.
 *
 * IN-FLIGHT VOTES ARE HELD. Between the tap and the desktop's answer this
 * phone shows a score nothing has confirmed yet, and a body fetch or a push
 * landing in that window carries the PREVIOUS state of the same turn — folding
 * it in would flip the segment the finger just chose back to unscored, and
 * then flip it forward again a moment later. So a turn with a vote in flight
 * ignores incoming scores for exactly that turn (the desktop's rating bar
 * holds the same window, for the same reason), and the answer to this phone's
 * own write is what releases the hold.
 */

/** Assistant message ids with a vote on the wire right now. */
const pending = new Set<string>()

/** Is this turn's score still unconfirmed? Read by every apply path. */
export function isVotePending(messageId: string): boolean {
  return pending.has(messageId)
}

/**
 * The scores a fetched body carries — the desktop's complete set for that
 * conversation, so this REPLACES rather than merges: a score the desktop no
 * longer holds must not survive here, the same rule the message rows arriving
 * beside it follow.
 *
 * Storage only. The caller decides when the screen repaints, because a body
 * fetch runs inside the very read that is about to publish it and invalidating
 * from there would restart the query awaiting it.
 */
export async function foldFetchedRatings(
  conversationId: string,
  incoming: ConversationRating[]
): Promise<void> {
  await replaceConversationRatings(conversationId, incoming, pending)
}

/**
 * A score that arrived on its own — the `turn.scored` push. Merged, never
 * replaced: the push describes ONE turn, and the other turns' scores are not
 * in it to be preserved. Put on screen at once, since nothing else is going to
 * re-read this conversation and being visible now is the whole point of it.
 */
export async function applyRemoteRatings(
  conversationId: string,
  incoming: ConversationRating[]
): Promise<void> {
  const usable = incoming.filter((rating) => rating?.messageId && !pending.has(rating.messageId))
  if (usable.length === 0) return
  await mergeConversationRatings(conversationId, usable)
  invalidateConversation(conversationId)
}

/**
 * Score one turn, from this phone.
 *
 * The segment fills under the finger — the write is local first — and the
 * desktop's answer then replaces that optimism with what it actually
 * persisted. A refusal (a message the desktop's file no longer holds) or a
 * failed send takes the paint back down to whatever the phone knew before,
 * because a score that reached nothing must not keep sitting there looking
 * recorded.
 *
 * Demo mode has no desktop: the local write IS the whole act, exactly as an
 * unpaired settings edit is. Paired-but-offline refuses — the same answer
 * every other write path gives — and the bar is hidden in that state rather
 * than left to swallow taps (see chat.tsx).
 */
export async function rateTurn(
  conversationId: string,
  messageId: string,
  score: number
): Promise<boolean> {
  const clamped = Math.max(0, Math.min(10, Math.round(score)))
  const paired = useAppStore.getState().paired
  const tunnel = tunnelClient.active

  if (!paired) {
    await mergeConversationRatings(conversationId, [
      { messageId, score: clamped, at: Date.now(), source: 'mobile' }
    ])
    invalidateConversation(conversationId)
    return true
  }
  if (!tunnel || !tunnel.connected) return false

  // What to fall back to if the write never lands: the score this turn already
  // carried, or nothing at all. Read BEFORE the optimistic write, so the
  // take-back restores a real prior state rather than the one being painted.
  const previous = (await getConversationRatings(conversationId)).find(
    (rating) => rating.messageId === messageId
  )
  pending.add(messageId)
  await mergeConversationRatings(conversationId, [
    { messageId, score: clamped, at: Date.now(), source: 'mobile' }
  ])
  invalidateConversation(conversationId)

  let answer: { rating?: ConversationRating | null } | null = null
  let failed = false
  try {
    answer = (await tunnel.rpc(Rpc.rateTurn, { conversationId, messageId, score: clamped })) as {
      rating?: ConversationRating | null
    }
  } catch (error) {
    failed = true
    tunnelClient.reportRpcFailure(error)
  }

  // Released before the corrective write, never after: `applyRemoteRatings`
  // runs on its own (the desktop's turn.scored push echoes this very vote),
  // and a hold still standing when it does would drop the confirmation.
  pending.delete(messageId)

  if (failed || !answer?.rating) {
    if (previous) await mergeConversationRatings(conversationId, [previous])
    else await removeConversationRating(conversationId, messageId)
    invalidateConversation(conversationId)
    return false
  }

  // The desktop's own record — its clock, its source, its clamp. Written even
  // when it agrees with the optimism, so the two copies are byte-identical
  // rather than merely equal-looking.
  await mergeConversationRatings(conversationId, [answer.rating])
  invalidateConversation(conversationId)
  return true
}

/** Tests only — the pending set is module state and jest reuses the process. */
export function resetRatingStateForTests(): void {
  pending.clear()
}
