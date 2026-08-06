import { conversationKeys, invalidateConversation } from '@/lib/conversations/cache'
import { queryClient } from '@/lib/query/queryClient'
import { fetchConversationBody, isBodyStale, refreshSync } from '@/lib/sync/sync'
import { tunnelClient } from '@/lib/tunnel/client'
import { useRunStatus } from '@/state/runStatus'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import { deleteConversation, getConversation, listConversations } from '@/lib/conversations/repo'
import type { ConversationFile, ConversationMeta } from '@/lib/conversations/types'

/**
 * Read layer over the SQLite store. These queries are local — instant, never
 * stale in the network sense — so they refetch on invalidation only, and the
 * AsyncStorage query persister skips them (see queryClient LOCAL_QUERY_KEYS):
 * persisting them would duplicate what SQLite already holds.
 *
 * Keys and invalidations live in `./cache` so non-React writers can invalidate
 * without importing this module — see the note there.
 */

export function useConversationList(): UseQueryResult<ConversationMeta[]> {
  return useQuery({
    queryKey: conversationKeys.list,
    queryFn: listConversations,
    staleTime: Infinity
  })
}

export function useConversation(id: string | null): UseQueryResult<ConversationFile | null> {
  const query = useQuery({
    queryKey: conversationKeys.detail(id ?? 'none'),
    queryFn: async () => {
      if (!id) return null
      let local = await getConversation(id)

      // Not in this phone's index yet — reachable from a notification, a
      // deep link, or simply a conversation created since the last catch-up.
      // Pull the index and look again rather than rendering nothing forever.
      if (!local && tunnelClient.connected) {
        await refreshSync().catch(() => undefined)
        local = await getConversation(id)
      }
      if (!local) return null

      // Paired mode syncs metadata only, so a conversation never opened has
      // no messages here yet. Emptiness is not the whole test though: a body
      // pulled last week is just as wrong once the desktop has added to it,
      // and the phone learns that from updated_at. Demo mode has bodies
      // already and no tunnel, so neither branch fires there.
      if (tunnelClient.connected) {
        const needsBody = local.messages.length === 0 || (await isBodyStale(id))
        if (needsBody) {
          const fetched = await fetchConversationBody(id).catch(() => false)
          // Only re-read on success. A refused or malformed answer leaves the
          // copy in hand untouched, which is better than the empty screen a
          // blind re-read would produce.
          if (fetched) return getConversation(id)
        }
      }
      return local
    },
    enabled: id !== null,
    staleTime: Infinity
  })

  // The queryFn can only download the body while the tunnel is up, and on a
  // cold start the user reaches a conversation before the handshake finishes.
  // Without this, that first answer — the empty local copy — is pinned by
  // staleTime for the whole session. So every arrival of the connection asks
  // again; the queryFn re-checks against SQLite and fetches only if the copy
  // is actually missing or stale, so the repeat costs one local read.
  useEffect(() => {
    if (id === null) return
    let lastStatus: string | null = null
    return tunnelClient.subscribe((state) => {
      if (state.status === 'connected' && lastStatus !== 'connected') {
        void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(id) })
      }
      lastStatus = state.status
    })
  }, [id])

  return query
}

export async function removeConversation(id: string): Promise<void> {
  await deleteConversation(id)
  invalidateConversation(id)
  // Nothing left to tint. The entry would age out on its own, but a run status
  // outliving its conversation is the kind of thing that only stays harmless
  // until something else starts reading the map.
  useRunStatus.getState().dropRun(id)
}
