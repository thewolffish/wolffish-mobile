import { queryClient } from '@/lib/query/queryClient'

/**
 * Query keys for the conversation store, and the invalidations that go with
 * them.
 *
 * Deliberately its own module rather than part of `hooks.ts`: the writers that
 * need to invalidate — sync, the prompt runner, the demo agent — are not React
 * code and must not pull in the hooks, which import back from sync to fetch a
 * conversation body on first open. That import pair was a require cycle, and a
 * cycle here resolves to `undefined` at module-init time depending on which
 * side Metro loads first. This file imports only the query client, so both
 * sides can depend on it and neither depends on the other.
 *
 * The key roots are mirrored in queryClient's LOCAL_QUERY_KEYS, which keeps
 * these out of the persisted cache — SQLite already holds the data.
 */
export const conversationKeys = {
  list: ['conversations'] as const,
  detail: (id: string) => ['conversation', id] as const
}

/** One conversation changed: its own view and its row in the list. */
export function invalidateConversation(id: string): void {
  void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(id) })
  void queryClient.invalidateQueries({ queryKey: conversationKeys.list })
}

/** The set of conversations changed — added, removed, retitled, reordered. */
export function invalidateConversationList(): void {
  void queryClient.invalidateQueries({ queryKey: conversationKeys.list })
}
