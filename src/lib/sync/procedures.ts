import { queryClient } from '@/lib/query/queryClient'
import { tunnelClient } from '@/lib/tunnel/client'
import { Rpc, type SyncProcedure } from '@/lib/tunnel/protocol'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

/**
 * Procedures — the desktop's `brain/procedures.json`, read and written from
 * here on the same contract as projects (lib/sync/projects.ts): every write
 * goes to the desktop and the stored row is what lands in the cache.
 *
 * Unlike projects there is no snapshot copy to fall back on — procedures are
 * not part of the config snapshot — so an unpaired phone shows the empty state,
 * which is the truth: demo mode has no procedures.
 */

export const procedureKeys = { list: ['procedures'] as const }

export function invalidateProcedures(): void {
  void queryClient.invalidateQueries({ queryKey: procedureKeys.list })
}

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const tunnel = tunnelClient.active
  if (!tunnel || !tunnelClient.connected) throw new Error('not connected')
  try {
    return (await tunnel.rpc(method, params)) as T
  } catch (error) {
    tunnelClient.reportRpcFailure(error)
    throw error
  }
}

async function fetchProcedures(): Promise<SyncProcedure[]> {
  // Disconnected keeps whatever the cache holds rather than emptying a list the
  // user is looking at; the reconnect's re-list is what corrects it.
  if (!tunnelClient.connected) {
    return queryClient.getQueryData<SyncProcedure[]>(procedureKeys.list) ?? []
  }
  const answer = await call<{ procedures?: SyncProcedure[] }>(Rpc.proceduresList)
  return Array.isArray(answer?.procedures) ? answer.procedures : []
}

export function useProcedures(): UseQueryResult<SyncProcedure[]> {
  return useQuery({ queryKey: procedureKeys.list, queryFn: fetchProcedures, staleTime: 30_000 })
}

/** See projects.ts absorb — the desktop's row, in the cache, before the push. */
function absorb(procedure: SyncProcedure): SyncProcedure {
  queryClient.setQueryData<SyncProcedure[]>(procedureKeys.list, (current) => {
    const rows = current ?? []
    const index = rows.findIndex((row) => row.id === procedure.id)
    const next = index >= 0 ? rows.with(index, procedure) : [procedure, ...rows]
    return [...next].sort((a, b) => b.updatedAt - a.updatedAt)
  })
  return procedure
}

export async function createProcedure(input: {
  title: string
  prompt: string
  mode?: 'single' | 'workflow'
  icon?: string
  projectId?: string
}): Promise<SyncProcedure> {
  const answer = await call<{ procedure: SyncProcedure }>(Rpc.procedureCreate, input)
  return absorb(answer.procedure)
}

export async function updateProcedure(input: {
  id: string
  title?: string
  prompt?: string
  mode?: 'single' | 'workflow'
  icon?: string
  /** '' unbinds the project, exactly as the desktop's setter reads it. */
  projectId?: string
}): Promise<SyncProcedure> {
  const answer = await call<{ procedure: SyncProcedure }>(Rpc.procedureUpdate, input)
  return absorb(answer.procedure)
}

export async function deleteProcedure(id: string): Promise<void> {
  await call<{ ok: boolean }>(Rpc.procedureDelete, { id })
  queryClient.setQueryData<SyncProcedure[]>(procedureKeys.list, (current) =>
    (current ?? []).filter((row) => row.id !== id)
  )
}
