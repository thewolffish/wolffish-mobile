import { queryClient } from '@/lib/query/queryClient'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { deleteConversation, getConversation, listConversations } from './repo'
import type { ConversationFile, ConversationMeta } from './types'

/**
 * Read layer over the SQLite store. These queries are local — instant, never
 * stale in the network sense — so they refetch on invalidation only, and the
 * AsyncStorage query persister skips them (see queryClient LOCAL_QUERY_KEYS):
 * persisting them would duplicate what SQLite already holds.
 */

export const conversationKeys = {
  list: ['conversations'] as const,
  detail: (id: string) => ['conversation', id] as const
}

export function useConversationList(): UseQueryResult<ConversationMeta[]> {
  return useQuery({
    queryKey: conversationKeys.list,
    queryFn: listConversations,
    staleTime: Infinity
  })
}

export function useConversation(id: string | null): UseQueryResult<ConversationFile | null> {
  return useQuery({
    queryKey: conversationKeys.detail(id ?? 'none'),
    queryFn: () => (id ? getConversation(id) : Promise.resolve(null)),
    enabled: id !== null,
    staleTime: Infinity
  })
}

export function invalidateConversation(id: string): void {
  void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(id) })
  void queryClient.invalidateQueries({ queryKey: conversationKeys.list })
}

export function invalidateConversationList(): void {
  void queryClient.invalidateQueries({ queryKey: conversationKeys.list })
}

export async function removeConversation(id: string): Promise<void> {
  await deleteConversation(id)
  invalidateConversation(id)
}
