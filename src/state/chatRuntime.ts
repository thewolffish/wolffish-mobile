import type {
  ApprovalDecision,
  ApprovalDescription,
  AskUserAnswer,
  AskUserQuestion,
  ConversationMessage,
  DangerLevel
} from '@/lib/conversations/types'
import { create } from 'zustand'

/**
 * Live streaming state — the in-flight turn per conversation.
 *
 * Deliberately NOT persisted, and deliberately NOT written to SQLite while it
 * runs: the durable transcript is whatever the desktop has saved, and this
 * store only carries the turn currently being written. That split is what
 * makes the feed monotone. A mid-turn write to SQLite means the body fetch
 * that follows can DELETE it again (the desktop persists an assistant message
 * once, at the end of the turn), and every one of those windows was a row
 * appearing and then vanishing on screen.
 *
 * One entry covers a whole turn, from both ends of it:
 *
 *   user       the prompt this phone just sent, shown from the instant Send is
 *              pressed — before the RPC has even returned a conversation id.
 *   message    the assistant message being written. Empty ⇒ the feed shows the
 *              typed thinking words, exactly as demo mode does.
 *   base/tail  see prompt.ts: `base` is the last full snapshot the desktop
 *              pushed, `tail` the text deltas received since. `message` is the
 *              two composed, and is the only field the feed reads.
 *
 * Both messages carry the ids the desktop will persist them under, so the feed
 * can drop each one the moment the stored transcript contains it — no
 * sequencing, no window where a row is in neither place or in both.
 */

export type StreamStatus = 'streaming' | 'complete' | 'error'

export type LiveStream = {
  message: ConversationMessage
  status: StreamStatus
  /** The prompt that started this turn, while the stored body lacks it. */
  user?: ConversationMessage
  /** Paired mode only — the newest full message snapshot from the desktop. */
  base?: ConversationMessage
  /** Paired mode only — text deltas received after `base`. */
  tail?: string
}

/**
 * A flagged tool call the desktop is holding for this phone's decision. Mirrors
 * the desktop renderer's ApprovalCardState field for field, because it IS that
 * state — pushed over the tunnel instead of over IPC. `decision` is stamped the
 * moment the user taps, before the desktop answers, so the card settles at the
 * tap; the stored transcript carries the same record once the turn is saved.
 */
export type ApprovalCardState = {
  approvalId: string
  toolCallId: string
  tool: string
  args: Record<string, unknown>
  reason: string
  level: DangerLevel
  description?: ApprovalDescription
  decision?: ApprovalDecision
}

/**
 * A live ask-the-user card. Never persisted — a card replayed from history is
 * rebuilt from the tool_call args plus the tool_result output, exactly as on
 * the desktop — so this exists only for the window in which the turn is parked
 * waiting for an answer, plus the optimistic beat after the user submits.
 */
export type AskCardState = {
  askId: string
  toolCallId: string
  questions: AskUserQuestion[]
  /** Filled on submit — answers[i] answers questions[i]. */
  answers?: AskUserAnswer[]
  answered?: boolean
}

/**
 * The cards one conversation's running turn is parked on, keyed by toolCallId
 * so each renders against its own tool_call segment.
 *
 * Deliberately a sibling of `streams` rather than a field on one: the live
 * message is REPLACED wholesale by every mirror snapshot the desktop pushes,
 * and a card living inside it would be wiped twice a second. These are dropped
 * when the turn settles, at which point the stored transcript renders the
 * outcome instead.
 */
export type ConversationCards = {
  asks: Record<string, AskCardState>
  approvals: Record<string, ApprovalCardState>
}

export type ChatRuntimeState = {
  streams: Record<string, LiveStream>
  cards: Record<string, ConversationCards>
  /**
   * Project a new chat will be filed under. A conversation does not exist
   * until its first message, so a project picked before then has nothing to
   * be stamped on yet — it waits here and the agent applies it at creation,
   * the desktop's "new chat in this project" without the extra screen.
   */
  pendingProjectId: string | null
  setPendingProject: (projectId: string | null) => void
  startStream: (conversationId: string, message: ConversationMessage) => void
  updateStream: (conversationId: string, message: ConversationMessage) => void
  /** Whole-value upsert — the paired path rebuilds the entry on every event. */
  putStream: (conversationId: string, stream: LiveStream) => void
  endStream: (conversationId: string) => void
  /** Put one card up, or replace it — keyed by its tool call. */
  putAsk: (conversationId: string, ask: AskCardState) => void
  putApproval: (conversationId: string, approval: ApprovalCardState) => void
  /** Take one card down — it was answered somewhere else, or never landed. */
  dropAsk: (conversationId: string, toolCallId: string) => void
  dropApproval: (conversationId: string, toolCallId: string) => void
  /** Every card for a conversation, dropped together when its turn settles. */
  clearCards: (conversationId: string) => void
  /** Drop every stream and pending binding — a demo refresh replaces the
   *  conversations these point at (lib/demo/reset). */
  reset: () => void
}

const NO_CARDS: ConversationCards = { asks: {}, approvals: {} }

export const useChatRuntime = create<ChatRuntimeState>()((set) => ({
  streams: {},
  cards: {},
  pendingProjectId: null,
  setPendingProject: (pendingProjectId) => set({ pendingProjectId }),
  startStream: (conversationId, message) =>
    set((state) => ({
      streams: { ...state.streams, [conversationId]: { message, status: 'streaming' } }
    })),
  updateStream: (conversationId, message) =>
    set((state) => {
      const current = state.streams[conversationId]
      if (!current) return state
      return {
        streams: { ...state.streams, [conversationId]: { ...current, message } }
      }
    }),
  putStream: (conversationId, stream) =>
    set((state) => ({ streams: { ...state.streams, [conversationId]: stream } })),
  endStream: (conversationId) =>
    set((state) => {
      if (!state.streams[conversationId]) return state
      const { [conversationId]: _gone, ...rest } = state.streams
      return { streams: rest }
    }),
  putAsk: (conversationId, ask) =>
    set((state) => {
      const current = state.cards[conversationId] ?? NO_CARDS
      return {
        cards: {
          ...state.cards,
          [conversationId]: {
            ...current,
            asks: { ...current.asks, [ask.toolCallId]: ask }
          }
        }
      }
    }),
  putApproval: (conversationId, approval) =>
    set((state) => {
      const current = state.cards[conversationId] ?? NO_CARDS
      return {
        cards: {
          ...state.cards,
          [conversationId]: {
            ...current,
            approvals: { ...current.approvals, [approval.toolCallId]: approval }
          }
        }
      }
    }),
  dropAsk: (conversationId, toolCallId) =>
    set((state) => {
      const current = state.cards[conversationId]
      if (!current?.asks[toolCallId]) return state
      const { [toolCallId]: _gone, ...asks } = current.asks
      return { cards: { ...state.cards, [conversationId]: { ...current, asks } } }
    }),
  dropApproval: (conversationId, toolCallId) =>
    set((state) => {
      const current = state.cards[conversationId]
      if (!current?.approvals[toolCallId]) return state
      const { [toolCallId]: _gone, ...approvals } = current.approvals
      return { cards: { ...state.cards, [conversationId]: { ...current, approvals } } }
    }),
  clearCards: (conversationId) =>
    set((state) => {
      if (!state.cards[conversationId]) return state
      const { [conversationId]: _gone, ...rest } = state.cards
      return { cards: rest }
    }),
  reset: () => set({ streams: {}, cards: {}, pendingProjectId: null })
}))

/** One conversation's live cards, or the shared empty pair. A stable
 *  reference for both, so a subscribing component only re-renders when a
 *  card actually moves. */
export function cardsFor(conversationId: string | undefined): ConversationCards {
  if (!conversationId) return NO_CARDS
  return useChatRuntime.getState().cards[conversationId] ?? NO_CARDS
}

/** Selector form of `cardsFor`, for components. */
export function selectCards(
  conversationId: string | undefined
): (state: ChatRuntimeState) => ConversationCards {
  return (state) => (conversationId ? state.cards[conversationId] : undefined) ?? NO_CARDS
}

/** Read one conversation's live turn outside React (event handlers, tests). */
export function liveStreamFor(conversationId: string): LiveStream | undefined {
  return useChatRuntime.getState().streams[conversationId]
}
