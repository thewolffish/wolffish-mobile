import i18n from '@/lib/i18n'
import { getDb } from '@/lib/db/database'
import { invalidateConversation, invalidateConversationList } from '@/lib/conversations/cache'
import { fetchConversationBody } from '@/lib/sync/sync'
import { tunnelClient } from '@/lib/tunnel/client'
import { Event, Rpc } from '@/lib/tunnel/protocol'
import type { MessageAttachment } from '@/lib/conversations/types'

/**
 * Sending a turn from the phone.
 *
 * The desktop runs the turn — it holds the models, the capabilities and the
 * workspace. The phone's job is to hand over the prompt and render what comes
 * back, which arrives as events rather than a reply: `message.delta` while the
 * assistant is writing, `message.appended` when a message is final, and
 * `turn.status` around the edges. That is the same stream the desktop's own
 * chat view consumes, which is why a turn started here looks identical on both
 * screens.
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

/** Live text for the conversation currently streaming, keyed by id. */
const streaming = new Map<string, string>()
const listeners = new Set<(conversationId: string, text: string) => void>()

/**
 * Conversations with a turn in flight on the desktop. Tracked so the composer
 * can offer Stop for a remote turn exactly as it does for a demo one — the
 * delta stream alone cannot carry this, because a turn is already running
 * (and abortable) before its first token arrives.
 */
const runningTurns = new Set<string>()
const turnListeners = new Set<(conversationId: string, running: boolean) => void>()

export function onTurnState(
  listener: (conversationId: string, running: boolean) => void
): () => void {
  turnListeners.add(listener)
  return () => turnListeners.delete(listener)
}

export function isTurnRunning(conversationId: string): boolean {
  return runningTurns.has(conversationId)
}

function setTurnRunning(conversationId: string, running: boolean): void {
  if (running === runningTurns.has(conversationId)) return
  if (running) runningTurns.add(conversationId)
  else runningTurns.delete(conversationId)
  for (const listener of turnListeners) listener(conversationId, running)
}

/** Subscribe to in-flight assistant text so the chat view can render it as it
 * arrives rather than waiting for the finished message. */
export function onStreamingText(
  listener: (conversationId: string, text: string) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function streamingTextFor(conversationId: string): string | null {
  return streaming.get(conversationId) ?? null
}

function publish(conversationId: string, text: string): void {
  streaming.set(conversationId, text)
  for (const listener of listeners) listener(conversationId, text)
}

/**
 * Wire the turn event stream. Called once when the tunnel comes up, alongside
 * `attachLiveUpdates` — kept separate because these events only matter while a
 * conversation is on screen, whereas list updates always matter.
 */
export function attachTurnStream(): void {
  const tunnel = tunnelClient.active
  if (!tunnel) return

  tunnel.onEvent(Event.messageDelta, (payload) => {
    const { conversationId, text, replace } = (payload ?? {}) as {
      conversationId?: string
      text?: string
      replace?: boolean
    }
    if (!conversationId || typeof text !== 'string') return
    // Turns the phone started arrive as increments; turns mirrored from the
    // desktop's other channels arrive as the message so far. Appending the
    // latter would print the answer again on every tick.
    publish(conversationId, replace === true ? text : (streaming.get(conversationId) ?? '') + text)
  })

  tunnel.onEvent(Event.messageAppended, (payload) => {
    const { conversationId } = (payload ?? {}) as { conversationId?: string }
    if (!conversationId) return
    // The finished message is authoritative; drop the streaming buffer and
    // pull the conversation so the stored copy matches the desktop's exactly.
    streaming.delete(conversationId)
    publish(conversationId, '')
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
    if (state === 'started') setTurnRunning(conversationId, true)
    // Terminal for a turn from anywhere — this app, the desktop, a channel.
    // The desktop follows it with the conversation's new metadata, which is
    // what pulls the body; clearing the buffer here stops the live text from
    // lingering under the message that replaces it.
    if (state === 'done' || state === 'error' || state === 'canceled') {
      setTurnRunning(conversationId, false)
      streaming.delete(conversationId)
      publish(conversationId, '')
      invalidateConversationList()
    }
  })

  tunnel.onEvent(Event.turnScored, (payload) => {
    const { conversationId } = (payload ?? {}) as { conversationId?: string }
    // A score can land from any channel — the desktop, Telegram, here — and
    // the phone shows whichever one was recorded, exactly like the desktop.
    if (conversationId) void fetchConversationBody(conversationId).catch(() => undefined)
  })
}

/**
 * Hand a prompt to the desktop. Returns the conversation id so the UI can
 * navigate immediately, the same contract `sendDemoPrompt` offers.
 */
export async function sendPrompt(input: SendPromptInput): Promise<SendPromptResult> {
  const tunnel = tunnelClient.active
  // Offline. The desktop holds the models and the workspace, so there is no
  // answer to be had here — but throwing turns a normal situation (a phone in
  // a lift) into an error the user has to interpret. Keep what they wrote,
  // say plainly why it is waiting, and let them carry on reading.
  if (!tunnel || !tunnelClient.connected) return offlineReply(input)

  const result = (await tunnel.rpc(Rpc.sendMessage, {
    conversationId: input.conversationId,
    text: input.text,
    attachments: input.attachments ?? [],
    voicePrompt: input.voicePrompt === true
  })) as { conversationId?: string }

  const conversationId = result?.conversationId ?? input.conversationId
  if (!conversationId) throw new Error('desktop did not return a conversation')

  // The desktop accepted the prompt, so a turn is now running there — mark it
  // before the `started` status lands so Stop is available immediately.
  setTurnRunning(conversationId, true)

  // Optimistically place the user's own message so the bubble appears the
  // instant they hit send, exactly as it does in demo mode. The desktop's
  // copy replaces it when the turn's first append arrives.
  await appendLocalUserMessage(conversationId, input.text, input.attachments)
  invalidateConversation(conversationId)
  invalidateConversationList()
  return { conversationId }
}

/**
 * The offline stand-in: the user's message is kept, and the assistant slot
 * says why it is not answering. Written locally exactly as the demo agent
 * writes its replies, so the feed has one shape rather than a special case,
 * and nothing here is ever sent — when the desktop returns, its own copy of
 * the conversation replaces this one wholesale.
 */
async function offlineReply(input: SendPromptInput): Promise<SendPromptResult> {
  const conversationId = input.conversationId ?? `local_${Date.now()}`
  if (input.conversationId === null) {
    const db = await getDb()
    await db.runAsync(
      `INSERT OR IGNORE INTO conversations
         (id, title, sealed, created_at, updated_at, message_count)
       VALUES (?, ?, 0, ?, ?, 0)`,
      [conversationId, input.text.slice(0, 60) || 'Offline', Date.now(), Date.now()]
    )
  }
  await appendLocalUserMessage(conversationId, input.text, input.attachments)
  await appendLocalAssistantMessage(conversationId, i18n.t('chat.offlineReply'))
  invalidateConversation(conversationId)
  invalidateConversationList()
  return { conversationId }
}

async function appendLocalAssistantMessage(conversationId: string, text: string): Promise<void> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE conversation_id = ?',
    [conversationId]
  )
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
       (conversation_id, seq, id, role, content, timestamp, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [conversationId, row?.next ?? 0, `offline_${Date.now()}`, 'assistant', text, Date.now()]
  )
}

async function appendLocalUserMessage(
  conversationId: string,
  text: string,
  attachments?: MessageAttachment[]
): Promise<void> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE conversation_id = ?',
    [conversationId]
  )
  const seq = row?.next ?? 0
  // Attachments ride in the payload so the optimistic bubble shows the file
  // card immediately — the same column shape the synced copy arrives in.
  const payload = attachments && attachments.length > 0 ? JSON.stringify({ attachments }) : null
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
       (conversation_id, seq, id, role, content, timestamp, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [conversationId, seq, `local_${Date.now()}`, 'user', text, Date.now(), payload]
  )
  await db.runAsync(
    'UPDATE conversations SET updated_at = ?, message_count = message_count + 1 WHERE id = ?',
    [Date.now(), conversationId]
  )
}

/** Ask the desktop to stop the running turn. */
export async function abortTurn(conversationId: string): Promise<void> {
  const tunnel = tunnelClient.active
  if (!tunnel) return
  await tunnel.rpc(Rpc.abortTurn, { conversationId }).catch(() => undefined)
  // Cleared here rather than waiting for the `canceled` status: the button
  // must not sit in its stop state through a round trip that may be lost.
  setTurnRunning(conversationId, false)
  streaming.delete(conversationId)
  publish(conversationId, '')
}
