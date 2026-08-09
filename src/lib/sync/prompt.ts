import i18n from '@/lib/i18n'
import { getDb } from '@/lib/db/database'
import {
  conversationHasMessage,
  invalidateConversation,
  invalidateConversationList,
  refetchConversation
} from '@/lib/conversations/cache'
import { mintMessageId } from '@/lib/conversations/types'
import { attachCardStream } from '@/lib/sync/cards'
import { applyRemoteRatings } from '@/lib/sync/rating'
import { fetchConversationBody } from '@/lib/sync/sync'
import { tunnelClient } from '@/lib/tunnel/client'
import { Event, Rpc } from '@/lib/tunnel/protocol'
import { useChatRuntime, type LiveStream } from '@/state/chatRuntime'
import { markRun, useRunStatus } from '@/state/runStatus'
import type {
  ConversationMessage,
  ConversationRating,
  MessageAttachment,
  Segment,
  ConversationChannel
} from '@/lib/conversations/types'

/**
 * Sending a turn from the phone, and rendering the one the desktop runs.
 *
 * The desktop runs every turn — it holds the models, the capabilities and the
 * workspace. The phone hands over the prompt and renders what comes back, which
 * arrives as events rather than a reply: `message.appended` carrying the
 * assistant message as it grows, `message.delta` for the text between those
 * snapshots, and `turn.status` around the edges. That is the same stream the
 * desktop's own chat view consumes, which is why a turn started here looks
 * identical on both screens.
 *
 * A turn started on the OTHER side arrives the same way, with one addition:
 * `message.appended` also carries the prompt being answered. It has to. The
 * desktop's chat view has that prompt in its own feed and writes it to disk
 * only when the turn folds, so a phone with the conversation open — or one
 * that pairs halfway through, which is how this was found — has it neither
 * stored nor streamed, and renders an answer to a question that is nowhere
 * on screen. Every snapshot repeats it, because a late joiner only ever sees
 * snapshots.
 *
 * ORDER IS THE WHOLE CONTRACT. The phone must show the same things in the same
 * sequence the desktop does — later is fine, out of order or flickering is not
 * — and everything below follows from that:
 *
 *  - The turn appears at the TAP, not at the reply. A round trip to the desktop
 *    (which mints the conversation for a new chat) is dead air otherwise, and
 *    dead air is where the user presses Send again.
 *  - Nothing that arrives mid-turn writes to SQLite, and nothing mid-turn
 *    refetches the body. The desktop persists an assistant message once, when
 *    the turn ends; a fetch before that returns a transcript WITHOUT it and
 *    overwrites what the phone is showing — the vanishing reply.
 *  - Live rows carry the ids the desktop will save them under, so the feed
 *    drops each one exactly when the stored copy takes its place. See
 *    conversations/feed.ts — that merge is what makes every ordering safe.
 *
 * Live state lives in chatRuntime, keyed by conversation, so it survives
 * leaving and re-entering a conversation mid-turn and is readable from tests
 * without a renderer.
 */

export type SendPromptInput = {
  conversationId: string | null
  text: string
  attachments?: MessageAttachment[]
  /** True for a voice note: the audio is the prompt, and the desktop
   * transcribes it before running the turn. */
  voicePrompt?: boolean
}

/**
 * The project a first message files its new conversation under: project mode if
 * the chat is inside one, otherwise the per-chat pick from the menu sheet.
 *
 * Resolved here rather than passed in by each caller so the rule lives in one
 * place — the chat screen, the procedures screen and a voice note all mint
 * conversations through this module, and each deciding for itself is how one of
 * them ends up filing nothing.
 *
 * It travels WITH the send because the desktop stamps it at creation: the turn
 * this send starts reads projectId off the conversation file to build its
 * overlay, so filing afterwards would leave the first turn — the one that
 * matters most — without the project's instructions.
 */
function projectForNewConversation(): string | null {
  const { activeProjectId, pendingProjectId } = useChatRuntime.getState()
  return activeProjectId ?? pendingProjectId ?? null
}

export type SendPromptResult = { conversationId: string }

/** The segment id the tail text renders under — constant so the text block it
 *  produces keeps its identity as the tail grows. */
const TAIL_SEGMENT_ID = 'live_tail'

// ------------------------------------------------------------- live turn

function blankAssistant(): ConversationMessage {
  return { role: 'assistant', content: '', timestamp: Date.now() }
}

/**
 * The assistant message to render: the desktop's newest snapshot with the text
 * that has streamed in since appended to it.
 *
 * Both halves describe the same message — the snapshot is built from the deltas
 * the desktop has already emitted, so a snapshot always contains everything the
 * tail did up to the moment it was taken, and the tail resets when one lands.
 * Frames arrive in order on one socket, so this can never double-print.
 */
function compose(base: ConversationMessage, tail: string): ConversationMessage {
  if (!tail) return base
  const segments: Segment[] = [...(base.segments ?? [])]
  const last = segments[segments.length - 1]
  if (last && last.kind === 'text' && !last.worker) {
    segments[segments.length - 1] = { ...last, delta: last.delta + tail }
  } else {
    segments.push({ kind: 'text', turnId: 'live', segmentId: TAIL_SEGMENT_ID, delta: tail })
  }
  return { ...base, content: (base.content ?? '') + tail, segments }
}

function liveFor(conversationId: string): LiveStream | undefined {
  return useChatRuntime.getState().streams[conversationId]
}

/** Rebuild one conversation's live entry from its parts. */
function putLive(
  conversationId: string,
  next: {
    base?: ConversationMessage
    tail?: string
    user?: ConversationMessage
    status?: LiveStream['status']
    channel?: ConversationChannel | null
  }
): void {
  const current = liveFor(conversationId)
  const base = next.base ?? current?.base ?? blankAssistant()
  const tail = next.tail ?? ''
  const user = next.user ?? current?.user
  useChatRuntime.getState().putStream(conversationId, {
    base,
    tail,
    user,
    status: next.status ?? current?.status ?? 'streaming',
    channel: next.channel ?? current?.channel ?? null,
    message: compose(base, tail)
  })
}

/** Whether a turn is being written into this conversation right now. */
export function isTurnRunning(conversationId: string): boolean {
  return liveFor(conversationId)?.status === 'streaming'
}

/**
 * A prompt mirrored from the desktop — the question a turn running THERE is
 * answering — or null if the payload is not one.
 *
 * This is the other half of the mirror, and the half without which a turn
 * started anywhere but this phone renders as an answer to nothing: the desktop
 * writes an in-app turn's user message to disk only when the turn folds, and
 * the phone deliberately does not re-read a body mid-turn, so for the length of
 * the run the prompt exists in neither place. It arrives on every snapshot, so
 * a phone that pairs or opens the conversation mid-turn picks it up on the next
 * tick rather than never.
 *
 * The wire is data, not policy. An id is mandatory: the feed drops this row
 * when the stored transcript arrives carrying the same id, and one without an
 * id could never be dropped — it would sit under the answer permanently, which
 * is a worse bug than the one being fixed.
 */
function mirroredPrompt(value: unknown): ConversationMessage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ConversationMessage>
  if (raw.role !== 'user') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.content !== 'string') return null
  return {
    ...raw,
    id: raw.id,
    role: 'user',
    content: raw.content,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now()
  }
}

/**
 * Open a live turn before anything has come back from the desktop, so the
 * prompt and the thinking words are on screen from the tap. Called by the send
 * path, by `turn.status: started` for turns begun on another surface — an open
 * conversation shows a desktop-side run the moment it starts, not at its first
 * token — and by the mirror, which is the only one of the three that can carry
 * the prompt of a turn this phone did not send.
 */
export function beginTurn(
  conversationId: string,
  user?: ConversationMessage,
  channel?: ConversationChannel | null
): void {
  const current = liveFor(conversationId)
  // A turn already streaming keeps its accumulated output: `started` can land
  // after the first snapshot, and re-basing on a blank would erase it.
  if (current?.status === 'streaming') {
    if (user) putLive(conversationId, { base: current.base, tail: current.tail, user, channel })
    return
  }
  // A fresh turn: whatever cards the previous one parked on are settled facts
  // now — the desktop resolves or fails every parked request before its turn
  // can end, and the stored transcript renders the outcome. Cleared here as
  // well as at the settle, because a queued prompt flushes the moment the old
  // turn reports done — BEFORE its settle fetch returns — and a card left in
  // the store would ride the new live row's tail, below the new prompt.
  useChatRuntime.getState().clearCards(conversationId)
  putLive(conversationId, { base: blankAssistant(), tail: '', user, status: 'streaming', channel })
}

/**
 * The turns already in flight when this phone connected — the desktop's
 * chat:activeRuns, asked for once per connection.
 *
 * Turn lifecycle reaches the phone as pushes and nothing else, so a tunnel that
 * comes up mid-run has missed the only `started` that turn will ever send. Until
 * the desktop next mirrors it — which across a long tool call is minutes away —
 * the conversation renders as idle: a live composer, no stop, and a rating bar
 * offering to score a turn still being written. An overlay per running
 * conversation makes all of those read correctly from the first frame, because
 * every one of them derives "running" from the live streams (see
 * conversations/rows.ts).
 *
 * ORDER: called from the same connected edge that runs attachTurnStream, and
 * AFTER it. That function force-settles every turn this phone believed was
 * running, on the assumption it may have missed the end of one while away;
 * seeding first would hand it the very overlays this closes the window for.
 *
 * This RE-OPENS turns, which is not the same act as beginning one, and the
 * difference is why it does not call beginTurn:
 *
 *  - an existing overlay keeps everything it had — its base, its streamed
 *    tail, its prompt — because this turn is the one that was already being
 *    written, not a new one on top of it;
 *  - and its PARKED CARDS survive. beginTurn clears them (a fresh turn settles
 *    the last one's questions), and a phone reconnecting to a turn parked on an
 *    approval is the opposite case: that card is exactly what the user came
 *    back to answer, and it is not re-pushed.
 *
 * Never throws — a desktop too old to answer leaves the phone exactly where it
 * was, learning about the run when the desktop next mirrors it.
 */
export async function seedActiveRuns(): Promise<void> {
  const tunnel = tunnelClient.active
  if (!tunnel || !tunnelClient.connected) return
  // Anything the push stream reports as FINISHED from here on is newer than
  // this answer, which is a snapshot taken before the round trip. Without the
  // stamp, a run ending inside that window gets re-opened by its own stale
  // seed and thinks forever — the failure seedOverlays guards with `revision`.
  const issuedAt = Date.now()
  try {
    const seed = (await tunnel.rpc(Rpc.activeRuns)) as { conversationIds?: unknown } | null
    const ids = seed?.conversationIds
    if (!Array.isArray(ids)) return
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue
      const current = liveFor(id)
      // Ended while the answer was in flight — by a terminal push that found a
      // live overlay to mark, or one that found none and only left its mark on
      // the run store. Either way the turn is over and the seed is stale.
      if (current && current.status !== 'streaming' && current.ended === 'desktop') continue
      const ended = useRunStatus.getState().runs[id]
      if (ended && ended.at >= issuedAt) continue
      if (current) {
        // Take back the assumption that it ended; keep everything else — the
        // base, the streamed tail, the prompt, and the cards.
        const { ended: _assumed, ...rest } = current
        useChatRuntime.getState().putStream(id, { ...rest, status: 'streaming' })
      } else {
        // Nothing here: a thinking row, exactly as `turn.status: started`
        // would have opened one had this phone been connected to hear it.
        putLive(id, { base: blankAssistant(), tail: '', status: 'streaming' })
      }
    }
  } catch {
    // Silent, and deliberately not reportRpcFailure: a desktop that predates
    // this method is not a sick tunnel, and nothing the user asked for failed.
  }
}

// ------------------------------------------------------------- settling

/**
 * A finished turn, brought to rest.
 *
 * The desktop announces the end and saves the message in that order across two
 * independent paths (the turn runner's lifecycle push and the channel sink's
 * own), so the first body fetch after `done` may still predate the save. That
 * is not worth racing: the fetch is simply repeated when the second signal
 * lands, and the live row stays up throughout because the feed drops it on id,
 * not on a timer. What this guarantees is only that a fetch HAPPENS — the
 * ordering is the merge's problem, and it has no ordering.
 *
 * One settle at a time per conversation, with a trailing rerun, so the two
 * signals cost one fetch when they arrive together and two when they do not.
 */
const settling = new Map<string, { again: boolean; run: Promise<void> }>()

function settleTurn(conversationId: string): Promise<void> {
  const active = settling.get(conversationId)
  if (active) {
    active.again = true
    return active.run
  }
  const entry = { again: false, run: Promise.resolve() }
  entry.run = (async () => {
    try {
      do {
        entry.again = false
        await fetchConversationBody(conversationId).catch(() => false)
        // Awaited, not invalidated: the query must hold the stored transcript
        // before the overlay is considered for release, or the row would be in
        // neither place for a frame.
        await refetchConversation(conversationId)
      } while (entry.again)
    } finally {
      settling.delete(conversationId)
    }
    const live = liveFor(conversationId)
    if (!live || live.status === 'streaming') return
    // Released only against its replacement. A turn whose message is now in the
    // stored transcript is already being drawn from there, so dropping the
    // overlay changes nothing on screen — that is the point. A turn whose
    // message is NOT there yet keeps it: `done` and the desktop's disk write
    // are announced by two independent paths, and the fetch that follows the
    // first can easily predate the second. Whatever streamed stays up, and the
    // signal that follows the save settles it.
    //
    // Nothing to match — a turn aborted before it wrote a word, or an older
    // desktop that streams text without ever naming the message — comes down
    // here instead, since no arriving copy ever will.
    const id = live.message.id
    if (!id || conversationHasMessage(conversationId, id)) {
      useChatRuntime.getState().endStream(conversationId)
      // The parked cards go with the turn they belonged to, and not a moment
      // earlier: from here the stored transcript draws the outcome — an
      // approval from the record persisted on the assistant message, an
      // answered question from its tool_call args and tool_result output — so
      // dropping them changes nothing on screen. A card still up when the turn
      // ended unanswered was failed closed on the desktop; the transcript is
      // where the truth about that lives.
      useChatRuntime.getState().clearCards(conversationId)
    }
  })()
  settling.set(conversationId, entry)
  return entry.run
}

// --------------------------------------------------------------- events

/**
 * Wire the turn event stream. Called once when the tunnel comes up, alongside
 * `attachLiveUpdates` — kept separate because these events only matter while a
 * conversation is on screen, whereas list updates always matter.
 */
export function attachTurnStream(): void {
  const tunnel = tunnelClient.active
  if (!tunnel) return

  // The parked-card topics ride the same stream: they are turn events, and a
  // turn that is waiting on the user is a turn state like any other.
  attachCardStream()

  // Re-attached on every reconnect, which is also the one moment a live turn
  // can be a lie: the phone drops mid-turn, the turn finishes without it, and
  // its terminal event is never delivered. Every turn believed to be running is
  // therefore re-settled here. A turn that really is still going re-announces
  // itself on the next snapshot — self-correcting in the direction that costs
  // nothing, where the alternative is thinking words that never stop.
  for (const [conversationId, live] of Object.entries(useChatRuntime.getState().streams)) {
    if (live.status !== 'streaming') continue
    // Marked as the guess it is. The turn may well still be running on the
    // desktop — seedActiveRuns, a beat later, re-opens the ones that are —
    // and until something says otherwise nothing may read this as a finished
    // turn. See LiveStream.ended.
    useChatRuntime
      .getState()
      .putStream(conversationId, { ...live, status: 'complete', ended: 'assumed' })
    void settleTurn(conversationId)
  }

  tunnel.onEvent(Event.messageDelta, (payload) => {
    const { conversationId, text, replace } = (payload ?? {}) as {
      conversationId?: string
      text?: string
      replace?: boolean
    }
    if (!conversationId || typeof text !== 'string') return
    const live = liveFor(conversationId)
    // Turns this phone started arrive as increments; a mirror of a turn running
    // elsewhere arrives as the message so far. Appending the latter would print
    // the answer again on every tick.
    const tail = replace === true ? text : (live?.tail ?? '') + text
    putLive(conversationId, { base: live?.base, tail, status: 'streaming' })
  })

  tunnel.onEvent(Event.messageAppended, (payload) => {
    const { conversationId, message, userMessage } = (payload ?? {}) as {
      conversationId?: string
      message?: unknown
      userMessage?: unknown
    }
    if (!conversationId) return

    // The prompt first, and before every early return below — a mirror whose
    // assistant half was withheld for size still carries it, and the turns
    // whose answers outgrow that budget are exactly the long ones where a
    // missing question is most obvious. Applied once per turn rather than per
    // tick: the id is the whole payload's identity, so an unchanged one means
    // there is nothing to do and no reason to wake the feed.
    const prompt = mirroredPrompt(userMessage)
    if (prompt && liveFor(conversationId)?.user?.id !== prompt.id) {
      beginTurn(conversationId, prompt)
    }

    // A FULL assistant message (stable id + role) is the desktop's live mirror
    // of the turn it is writing — prose, tool cards and task cards, exactly as
    // they stand right now. It replaces the live row's base, and the deltas
    // that built the text it already contains are dropped with it.
    const mirrored = message as { id?: unknown; role?: unknown } | undefined
    if (
      mirrored &&
      typeof mirrored === 'object' &&
      typeof mirrored.id === 'string' &&
      mirrored.role === 'assistant'
    ) {
      putLive(conversationId, {
        base: message as ConversationMessage,
        tail: '',
        status: 'streaming'
      })
      return
    }

    // Anything else is a nudge: some conversation's stored body changed. Mid
    // turn there is nothing to gain from it — the desktop has not saved the
    // assistant message yet — and everything to lose, because the body it would
    // hand back is the one from BEFORE this turn. Fetch when the turn is over,
    // which the nudge that follows the save (or turn.status) will ask for.
    if (isTurnRunning(conversationId)) return
    // A conversation with a turn just ended is settling; the nudge that follows
    // the desktop's save is precisely the second attempt that path waits for,
    // so it joins it rather than racing a fetch of its own.
    if (liveFor(conversationId)) {
      void settleTurn(conversationId)
      return
    }
    void fetchConversationBody(conversationId)
      .then(() => invalidateConversation(conversationId))
      .catch(() => undefined)
  })

  tunnel.onEvent(Event.turnStatus, (payload) => {
    const { conversationId, state, detail } = (payload ?? {}) as {
      conversationId?: string
      state?: string
      /** The desktop sends the originating channel here on `started`. */
      detail?: unknown
    }
    if (!conversationId) return
    // Started anywhere — this app, the desktop, a channel. An open conversation
    // shows the turn from its first instant rather than its first token.
    if (state === 'started') {
      beginTurn(
        conversationId,
        undefined,
        typeof detail === 'string' ? (detail as ConversationChannel) : null
      )
      return
    }
    if (state !== 'done' && state !== 'error' && state !== 'canceled') return
    // How it ended, remembered for as long as that is news — this is what tints
    // the conversation's number chip in the sheet, exactly as the desktop's
    // rail tints its own. Recorded for EVERY conversation the desktop reports
    // on, not just the open one: the whole point of the list is that a turn
    // finishing somewhere the user is not looking still shows up there.
    markRun(
      conversationId,
      state === 'done' ? 'completed' : state === 'error' ? 'failed' : 'stopped'
    )
    const live = liveFor(conversationId)
    if (live) {
      // Marked finished, NOT removed. The composer's Stop goes back to Send
      // here, while the reply stays on screen until its saved copy arrives to
      // take over — the two are separate events and only one of them is now.
      //
      // `ended: 'desktop'` is the desktop SAYING so, as opposed to the
      // reconnect re-settle assuming it. It is what lets the rating bar offer
      // this turn while it is still the live row, without offering every turn
      // that merely stopped streaming for a moment.
      useChatRuntime.getState().putStream(conversationId, {
        ...live,
        status: state === 'error' ? 'error' : 'complete',
        ended: 'desktop'
      })
    }
    invalidateConversationList()
    void settleTurn(conversationId)
  })

  // A turn was scored on ANY surface — the desktop's own rating bar, a
  // bare-number Telegram/WhatsApp reply, this phone's vote echoing back — and
  // an open chat has to reflect it now, exactly as the desktop's bar does.
  //
  // The rating travels with the push, so this writes it and repaints. Nothing
  // else would: a ratings-only write moves no updated_at, so the conversation
  // never looks stale and no other path would ever come back for it.
  tunnel.onEvent(Event.turnScored, (payload) => {
    const { conversationId, rating } = (payload ?? {}) as {
      conversationId?: string
      rating?: ConversationRating
    }
    if (!conversationId) return
    if (rating?.messageId && typeof rating.score === 'number') {
      void applyRemoteRatings(conversationId, [rating]).catch(() => undefined)
      return
    }
    // A desktop that predates the payload — the score is on its file, so the
    // body carries it. Never mid-turn: a fetch before the turn folds returns a
    // transcript without the message being written (see above).
    if (isTurnRunning(conversationId) || liveFor(conversationId)) return
    void fetchConversationBody(conversationId)
      .then(() => invalidateConversation(conversationId))
      .catch(() => undefined)
  })
}

// ----------------------------------------------------------------- send

/**
 * Hand a prompt to the desktop. Returns the conversation id so the UI can
 * navigate immediately, the same contract `sendDemoPrompt` offers.
 *
 * The prompt's id is minted HERE and travels with it, so the desktop saves the
 * message under the same id this phone is already showing. That one field is
 * what lets the optimistic bubble be replaced rather than joined by the stored
 * copy when the body arrives.
 */
export async function sendPrompt(input: SendPromptInput): Promise<SendPromptResult> {
  const tunnel = tunnelClient.active
  const timestamp = Date.now()
  const user: ConversationMessage = {
    id: mintMessageId(timestamp),
    role: 'user',
    content: input.text,
    timestamp,
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    ...(input.voicePrompt ? { voicePrompt: true } : {})
  }

  // Read before the wire is touched, so the value the local stub is written
  // with below is the same one the desktop was asked for.
  const projectId = input.conversationId ? null : projectForNewConversation()

  // Offline. The desktop holds the models and the workspace, so there is no
  // answer to be had here — but throwing turns a normal situation (a phone in
  // a lift) into an error the user has to interpret. Keep what they wrote,
  // say plainly why it is waiting, and let them carry on reading.
  if (!tunnel || !tunnelClient.connected) return offlineReply(input, user, projectId)

  // The turn is on screen before the wire is touched, for a conversation that
  // has one. A new chat has no id to file it under yet; the chat screen holds
  // that single prompt for the length of this round trip and hands it over
  // below — see `pendingUser` in conversations/feed.ts.
  if (input.conversationId) beginTurn(input.conversationId, user)

  let result: { conversationId?: string }
  try {
    result = (await tunnel.rpc(Rpc.sendMessage, {
      conversationId: input.conversationId,
      messageId: user.id,
      text: input.text,
      attachments: input.attachments ?? [],
      voicePrompt: input.voicePrompt === true,
      // Only meaningful for a conversation the desktop is about to create; it
      // ignores the field for one that already exists and has its own binding.
      ...(projectId ? { projectId } : {})
    })) as { conversationId?: string }
  } catch (error) {
    // The turn never started. Take the optimistic row down with it rather than
    // leaving the thinking words running against a desktop that never heard.
    if (input.conversationId) {
      useChatRuntime.getState().endStream(input.conversationId)
      useChatRuntime.getState().clearCards(input.conversationId)
    }
    throw error
  }

  const conversationId = result?.conversationId ?? input.conversationId
  if (!conversationId) throw new Error('desktop did not return a conversation')

  // A conversation the desktop just minted has no row here yet. Write one now:
  // it gives History the chat immediately and, more importantly, keeps the
  // conversation query off the catch-up path it takes for an unknown id (a full
  // index pull, then a body fetch, before anything can render). The desktop's
  // own metadata overwrites this the moment it arrives.
  if (!input.conversationId) {
    await createLocalConversation(conversationId, input.text, timestamp, projectId)
    // The per-chat pick was for THIS chat and has now been spent. Project mode
    // is not cleared — it holds until the user closes the project.
    if (useChatRuntime.getState().pendingProjectId) {
      useChatRuntime.getState().setPendingProject(null)
    }
  }
  beginTurn(conversationId, user)
  invalidateConversationList()
  return { conversationId }
}

/**
 * A locally-known stub for a conversation the desktop created. Deliberately
 * INSERT OR IGNORE and message-less: the desktop is the source of truth for
 * both, and its copy arrives through the index push moments later. `channel`
 * matches what the desktop stamped so the phone badge does not appear late, and
 * `project_id` for the same reason — the chat's project chrome and the Projects
 * screen's count both read it, and a beat showing the chat as unfiled is a beat
 * showing the wrong thing.
 */
async function createLocalConversation(
  conversationId: string,
  text: string,
  timestamp: number,
  projectId: string | null = null
): Promise<void> {
  const db = await getDb()
  await db
    .runAsync(
      `INSERT OR IGNORE INTO conversations
         (id, title, channel, project_id, sealed, created_at, updated_at, message_count)
       VALUES (?, ?, 'mobile', ?, 0, ?, ?, 1)`,
      [conversationId, text.trim().slice(0, 60) || 'Untitled', projectId, timestamp, timestamp]
    )
    .catch(() => undefined)
}

/**
 * The offline stand-in: the user's message is kept, and the assistant slot
 * says why it is not answering. Written locally exactly as the demo agent
 * writes its replies, so the feed has one shape rather than a special case,
 * and nothing here is ever sent — when the desktop returns, its own copy of
 * the conversation replaces this one wholesale.
 */
async function offlineReply(
  input: SendPromptInput,
  user: ConversationMessage,
  projectId: string | null = null
): Promise<SendPromptResult> {
  const conversationId = input.conversationId ?? `local_${Date.now()}`
  if (input.conversationId === null) {
    await createLocalConversation(conversationId, input.text || 'Offline', Date.now(), projectId)
  }
  await appendLocalMessage(conversationId, user)
  await appendLocalMessage(conversationId, {
    id: `offline_${Date.now()}`,
    role: 'assistant',
    content: i18n.t('chat.offlineReply'),
    timestamp: Date.now()
  })
  invalidateConversation(conversationId)
  invalidateConversationList()
  return { conversationId }
}

async function appendLocalMessage(
  conversationId: string,
  message: ConversationMessage
): Promise<void> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE conversation_id = ?',
    [conversationId]
  )
  // Attachments ride in the payload so the bubble shows the file card
  // immediately — the same column shape the synced copy arrives in.
  const { id, role, content, timestamp, ...rest } = message
  const payload = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
       (conversation_id, seq, id, role, content, timestamp, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [conversationId, row?.next ?? 0, id ?? `local_${timestamp}`, role, content, timestamp, payload]
  )
  await db.runAsync(
    'UPDATE conversations SET updated_at = ?, message_count = message_count + 1 WHERE id = ?',
    [timestamp, conversationId]
  )
}

/** Ask the desktop to stop the running turn. */
export async function abortTurn(conversationId: string): Promise<void> {
  const tunnel = tunnelClient.active
  if (!tunnel) return
  await tunnel.rpc(Rpc.abortTurn, { conversationId }).catch(() => undefined)
  // Marked complete here rather than waiting for the `canceled` status: the
  // button must not sit in its stop state through a round trip that may be
  // lost. Whatever streamed stays up until the desktop's saved copy of it
  // arrives, exactly as it does for a turn that ended on its own.
  const live = liveFor(conversationId)
  if (live) useChatRuntime.getState().putStream(conversationId, { ...live, status: 'complete' })
  void settleTurn(conversationId)
}
