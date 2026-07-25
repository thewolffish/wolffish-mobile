import { invalidateConversation } from '@/lib/conversations/hooks'
import { appendMessage, createConversation } from '@/lib/conversations/repo'
import { coalesceTextSegments } from '@/lib/conversations/segments'
import type { ConversationMessage, MessageAttachment, Segment } from '@/lib/conversations/types'
import { mintConversationId, mintMessageId } from '@/lib/conversations/types'
import { useChatRuntime } from '@/state/chatRuntime'
import i18n from '@/lib/i18n'

/**
 * Demo-mode agent. Replays the desktop turn lifecycle against local state:
 * optimistic user append → streaming assistant placeholder → text deltas →
 * turn_end → whole-message persist. When the real Durable Object / WebRTC
 * transport lands, this module is the seam it replaces — the stores, feed and
 * composer are transport-agnostic.
 */

/** The demo agent "thinks" this long before answering with the demo card. */
const DEMO_THINKING_MS = 3000
const DEMO_PROVIDER = 'wolffish'
const DEMO_MODEL = 'wolffish-demo'

type ActiveTurn = { timer: ReturnType<typeof setTimeout> | null }
const activeTurns = new Map<string, ActiveTurn>()

export function isTurnActive(conversationId: string): boolean {
  return activeTurns.has(conversationId)
}

/** Desktop titling fallback: an 80-char slice of the first prompt. */
export function deriveTitle(text: string, attachments?: MessageAttachment[]): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 80)}` : trimmed
  const named = attachments?.find((attachment) => attachment.originalName)
  return named?.originalName ?? 'Untitled'
}

function buildDemoReply(): string {
  const heading = i18n.t('demo.reply.heading')
  const body = i18n.t('demo.reply.body')
  const outro = i18n.t('demo.reply.outro')
  return `**${heading}**\n\n${body}\n\n${outro}`
}

/** Mint + persist an empty conversation up front (voice notes need the id
 * before the recording file can be filed under uploads/conv-<id>/). */
export async function ensureDemoConversation(title: string): Promise<string> {
  const now = Date.now()
  const id = mintConversationId(new Date(now))
  await createConversation({
    id,
    title,
    model: DEMO_MODEL,
    messages: [],
    createdAt: now,
    updatedAt: now
  })
  return id
}

export type SendDemoPromptInput = {
  conversationId: string | null
  text: string
  attachments?: MessageAttachment[]
  voicePrompt?: boolean
  voiceLang?: string
}

/**
 * Send a prompt in demo mode. Returns the conversation id (freshly minted for
 * a new chat) synchronously-ish so the UI can navigate immediately.
 */
export async function sendDemoPrompt(input: SendDemoPromptInput): Promise<string> {
  const now = Date.now()
  let conversationId = input.conversationId

  if (!conversationId) {
    conversationId = mintConversationId(new Date(now))
    await createConversation({
      id: conversationId,
      title: deriveTitle(input.text, input.attachments),
      model: DEMO_MODEL,
      messages: [],
      createdAt: now,
      updatedAt: now
    })
  }

  const userMessage: ConversationMessage = {
    id: mintMessageId(now),
    role: 'user',
    content: input.text,
    timestamp: now,
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    ...(input.voicePrompt ? { voicePrompt: true } : {}),
    ...(input.voiceLang ? { voiceLang: input.voiceLang } : {})
  }
  await appendMessage(conversationId, userMessage)
  invalidateConversation(conversationId)

  startAssistantTurn(conversationId)
  return conversationId
}

/**
 * The demo turn: the feed shows the typed thinking indicator for a few
 * seconds, then a demo-mode card lands explaining that no new messages are
 * processed offline.
 */
function startAssistantTurn(conversationId: string): void {
  const runtime = useChatRuntime.getState()
  const turnId = `turn_${Date.now()}`
  const messageId = mintMessageId()

  runtime.startStream(conversationId, {
    id: messageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    segments: []
  })

  const turn: ActiveTurn = { timer: null }
  activeTurns.set(conversationId, turn)

  const finish = async (): Promise<void> => {
    activeTurns.delete(conversationId)
    const reply = buildDemoReply()
    const segments: Segment[] = [
      {
        kind: 'active_model',
        turnId,
        segmentId: 'seg_0',
        provider: DEMO_PROVIDER,
        model: DEMO_MODEL
      },
      { kind: 'text', turnId, segmentId: 'seg_1', delta: reply },
      {
        kind: 'turn_end',
        turnId,
        segmentId: 'seg_2',
        stopReason: 'end_turn',
        iterationCount: 1
      }
    ]
    const finalMessage: ConversationMessage = {
      id: messageId,
      role: 'assistant',
      content: reply,
      timestamp: Date.now(),
      segments: coalesceTextSegments(segments),
      stopReason: 'end_turn'
    }
    await appendMessage(conversationId, finalMessage)
    useChatRuntime.getState().endStream(conversationId)
    invalidateConversation(conversationId)
  }

  turn.timer = setTimeout(() => void finish(), DEMO_THINKING_MS)
}

/** The red Stop button — cancel the pending demo turn without a reply. */
export function stopDemoTurn(conversationId: string): void {
  const turn = activeTurns.get(conversationId)
  if (!turn) return
  if (turn.timer) clearTimeout(turn.timer)
  activeTurns.delete(conversationId)
  useChatRuntime.getState().endStream(conversationId)
}
