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
import { fetchConversationBody } from '@/lib/sync/sync'
import { tunnelClient } from '@/lib/tunnel/client'
import { Event, Rpc } from '@/lib/tunnel/protocol'
import { useChatRuntime, type LiveStream } from '@/state/chatRuntime'
import type { ConversationMessage, MessageAttachment, Segment } from '@/lib/conversations/types'

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
    message: compose(base, tail)
  })
}

/** Whether a turn is being written into this conversation right now. */
export function isTurnRunning(conversationId: string): boolean {
  return liveFor(conversationId)?.status === 'streaming'
}

/**
 * Open a live turn before anything has come back from the desktop, so the
 * prompt and the thinking words are on screen from the tap. Called by the send
 * path, and by `turn.status: started` for turns begun on another surface — an
 * open conversation shows a desktop-side run the moment it starts, not at its
 * first token.
 */
export function beginTurn(conversationId: string, user?: ConversationMessage): void {
  const current = liveFor(conversationId)
  // A turn already streaming keeps its accumulated output: `started` can land
  // after the first snapshot, and re-basing on a blank would erase it.
  if (current?.status === 'streaming') {
    if (user) putLive(conversationId, { base: current.base, tail: current.tail, user })
    return
  }
  putLive(conversationId, { base: blankAssistant(), tail: '', user, status: 'streaming' })
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
    useChatRuntime.getState().putStream(conversationId, { ...live, status: 'complete' })
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
    const { conversationId, message } = (payload ?? {}) as {
      conversationId?: string
      message?: unknown
    }
    if (!conversationId) return

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
    const { conversationId, state } = (payload ?? {}) as {
      conversationId?: string
      state?: string
    }
    if (!conversationId) return
    // Started anywhere — this app, the desktop, a channel. An open conversation
    // shows the turn from its first instant rather than its first token.
    if (state === 'started') {
      beginTurn(conversationId)
      return
    }
    if (state !== 'done' && state !== 'error' && state !== 'canceled') return
    const live = liveFor(conversationId)
    if (live) {
      // Marked finished, NOT removed. The composer's Stop goes back to Send
      // here, while the reply stays on screen until its saved copy arrives to
      // take over — the two are separate events and only one of them is now.
      useChatRuntime.getState().putStream(conversationId, {
        ...live,
        status: state === 'error' ? 'error' : 'complete'
      })
    }
    invalidateConversationList()
    void settleTurn(conversationId)
  })

  tunnel.onEvent(Event.turnScored, (payload) => {
    const { conversationId } = (payload ?? {}) as { conversationId?: string }
    // A score can land from any channel — the desktop, Telegram, here — and
    // the phone shows whichever one was recorded, exactly like the desktop.
    if (conversationId) void fetchConversationBody(conversationId).catch(() => undefined)
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

  // Offline. The desktop holds the models and the workspace, so there is no
  // answer to be had here — but throwing turns a normal situation (a phone in
  // a lift) into an error the user has to interpret. Keep what they wrote,
  // say plainly why it is waiting, and let them carry on reading.
  if (!tunnel || !tunnelClient.connected) return offlineReply(input, user)

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
      voicePrompt: input.voicePrompt === true
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
  if (!input.conversationId) await createLocalConversation(conversationId, input.text, timestamp)
  beginTurn(conversationId, user)
  invalidateConversationList()
  return { conversationId }
}

/**
 * A locally-known stub for a conversation the desktop created. Deliberately
 * INSERT OR IGNORE and message-less: the desktop is the source of truth for
 * both, and its copy arrives through the index push moments later. `channel`
 * matches what the desktop stamped so the phone badge does not appear late.
 */
async function createLocalConversation(
  conversationId: string,
  text: string,
  timestamp: number
): Promise<void> {
  const db = await getDb()
  await db
    .runAsync(
      `INSERT OR IGNORE INTO conversations
         (id, title, channel, sealed, created_at, updated_at, message_count)
       VALUES (?, ?, 'mobile', 0, ?, ?, 1)`,
      [conversationId, text.trim().slice(0, 60) || 'Untitled', timestamp, timestamp]
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
  user: ConversationMessage
): Promise<SendPromptResult> {
  const conversationId = input.conversationId ?? `local_${Date.now()}`
  if (input.conversationId === null) {
    await createLocalConversation(conversationId, input.text || 'Offline', Date.now())
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
