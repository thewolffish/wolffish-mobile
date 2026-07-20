import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'

/**
 * Server-state layer. The query cache is persisted to the device so heavy
 * content (conversation metadata, opened histories, media descriptors)
 * survives restarts and refreshes slowly in the background instead of
 * refetching everything up front:
 *
 * - gcTime keeps data eligible for persistence for 7 days.
 * - staleTime means cached data renders instantly and refetches in the
 *   background only after a minute of staleness.
 * - maxAge on the persister drops anything older than 7 days at restore.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 7 * 24 * 60 * 60 * 1000,
      staleTime: 60 * 1000,
      retry: 2
    }
  }
})

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'wolffish.query-cache',
  throttleTime: 3_000
})

export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
