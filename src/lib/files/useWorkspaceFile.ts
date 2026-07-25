import { File } from 'expo-file-system'
import { useEffect, useState } from 'react'
import { resolveWorkspaceFile } from './fileCache'

export type WorkspaceFileState = {
  /** Local file URI once cached; null while loading or when missing. */
  uri: string | null
  /** Size of the cached file, 0 when unknown — cards fall back to this when
   *  the sender didn't record one (delivered files carry no metadata). */
  sizeBytes: number
  loading: boolean
  missing: boolean
}

/**
 * Resolve a workspace-relative media path through the file cache. The first
 * view of a file copies it out of the demo source (later: downloads it from
 * the desktop) — subsequent views hit the cache instantly.
 */
export function useWorkspaceFile(
  relPath: string | null,
  conversationId?: string
): WorkspaceFileState {
  const [state, setState] = useState<WorkspaceFileState>({
    uri: null,
    sizeBytes: 0,
    loading: relPath !== null,
    missing: false
  })

  useEffect(() => {
    let alive = true
    if (!relPath) {
      setState({ uri: null, sizeBytes: 0, loading: false, missing: false })
      return
    }
    setState({ uri: null, sizeBytes: 0, loading: true, missing: false })
    void resolveWorkspaceFile(relPath, conversationId).then((uri) => {
      if (!alive) return
      let sizeBytes = 0
      if (uri) {
        try {
          sizeBytes = new File(uri).size ?? 0
        } catch {
          // Size is cosmetic — a stat failure must not hide the file.
        }
      }
      setState({ uri, sizeBytes, loading: false, missing: uri === null })
    })
    return () => {
      alive = false
    }
  }, [relPath, conversationId])

  return state
}
