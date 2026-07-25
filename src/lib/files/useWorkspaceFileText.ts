import { File } from 'expo-file-system'
import { useEffect, useState } from 'react'
import { resolveWorkspaceFile } from './fileCache'

/**
 * Read a workspace file's text through the file cache, with the desktop's
 * 512 KB inline guard (MarkdownFileViewer/HtmlFileViewer MAX_INLINE_BYTES):
 * past that the caller falls back to a plain file card instead of pulling
 * megabytes of text into the JS heap.
 */
export const MAX_INLINE_TEXT_BYTES = 512 * 1024

export type WorkspaceTextState = {
  /** Local file URI once cached; null while loading or when missing. */
  uri: string | null
  /** File body; null while loading, when missing, or when oversized. */
  text: string | null
  sizeBytes: number
  loading: boolean
  missing: boolean
  oversized: boolean
}

const INITIAL: WorkspaceTextState = {
  uri: null,
  text: null,
  sizeBytes: 0,
  loading: true,
  missing: false,
  oversized: false
}

export function useWorkspaceFileText(
  relPath: string | null,
  conversationId?: string,
  maxBytes: number = MAX_INLINE_TEXT_BYTES
): WorkspaceTextState {
  const [state, setState] = useState<WorkspaceTextState>(INITIAL)

  useEffect(() => {
    let alive = true
    if (!relPath) {
      setState({ ...INITIAL, loading: false })
      return
    }
    setState(INITIAL)

    void (async () => {
      const uri = await resolveWorkspaceFile(relPath, conversationId)
      if (!alive) return
      if (!uri) {
        setState({ ...INITIAL, loading: false, missing: true })
        return
      }
      try {
        const file = new File(uri)
        const sizeBytes = file.size ?? 0
        if (sizeBytes > maxBytes) {
          setState({ uri, text: null, sizeBytes, loading: false, missing: false, oversized: true })
          return
        }
        const text = await file.text()
        if (!alive) return
        setState({ uri, text, sizeBytes, loading: false, missing: false, oversized: false })
      } catch {
        // Unreadable (binary with a text extension, permissions, a race with
        // cache pruning) — the caller degrades to the plain file card.
        if (alive) setState({ ...INITIAL, uri, loading: false, missing: true })
      }
    })()

    return () => {
      alive = false
    }
  }, [relPath, conversationId, maxBytes])

  return state
}
