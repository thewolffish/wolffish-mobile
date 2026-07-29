import type { ConversationMessage } from '@/lib/conversations/types'
import { create } from 'zustand'

/**
 * Live streaming state — the in-flight assistant turn per conversation.
 * Deliberately NOT persisted: the durable transcript lives in SQLite; this
 * store only carries the message being streamed so the feed re-renders on
 * deltas without touching the database. Mirrors the desktop's in-memory
 * AssistantMessage with status 'streaming' | 'complete' | 'error'.
 */

export type StreamStatus = 'streaming' | 'complete' | 'error'

export type LiveStream = {
  message: ConversationMessage
  status: StreamStatus
}

export type ChatRuntimeState = {
  streams: Record<string, LiveStream>
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
  endStream: (conversationId: string) => void
  /** Drop every stream and pending binding — a demo refresh replaces the
   *  conversations these point at (lib/demo/reset). */
  reset: () => void
}

export const useChatRuntime = create<ChatRuntimeState>()((set) => ({
  streams: {},
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
  endStream: (conversationId) =>
    set((state) => {
      const { [conversationId]: _gone, ...rest } = state.streams
      return { streams: rest }
    }),
  reset: () => set({ streams: {}, pendingProjectId: null })
}))
