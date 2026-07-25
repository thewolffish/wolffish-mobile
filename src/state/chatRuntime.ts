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
  startStream: (conversationId: string, message: ConversationMessage) => void
  updateStream: (conversationId: string, message: ConversationMessage) => void
  endStream: (conversationId: string) => void
}

export const useChatRuntime = create<ChatRuntimeState>()((set) => ({
  streams: {},
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
    })
}))
