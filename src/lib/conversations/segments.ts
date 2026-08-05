import type {
  ConversationMessage,
  Segment,
  SegmentTurnEndReason,
  TaskSnapshot,
  ToolResultStatus,
  ToolTiming,
  WorkflowSnapshot
} from '@/lib/conversations/types'

/**
 * Pure transforms from the persisted segment stream to what the feed renders.
 * Ported from wolffish-app Chat.tsx renderSegments/coalesceTextSegments with
 * the same invariants:
 *  - worker-tagged segments and workflow orchestration tools never render
 *  - text deltas accumulate and flush at any non-text segment or separator
 *  - file/path cards are marker-only — bare paths in prose never render
 *  - unknown segment kinds and tool names must degrade gracefully, never throw
 */

/** Orchestration tools whose surface is the workflow card, never a tool card. */
const WORKFLOW_TOOL_NAMES = new Set([
  'workflow_plan',
  'agent_spawn',
  'agent_send',
  'agents_await',
  'agent_cancel'
])

const ASK_TOOL_NAME = 'ask_user'

/** Tools whose output is file content — markers quoted inside never render. */
const FILE_CONTENT_TOOL_NAMES = new Set(['file_read', 'file_write', 'file_patch'])

export type ToolCallInfo = {
  toolCallId: string
  name: string
  args: Record<string, unknown>
}

export type ToolResultInfo = {
  status: ToolResultStatus
  output: string
  error?: string
}

export type DeliveredFileKind = 'image' | 'document' | 'audio' | 'video' | 'file' | 'chart'

export type RenderBlock =
  | { type: 'text'; key: string; markdown: string }
  | { type: 'media'; key: string; relPath: string }
  | {
      type: 'tool'
      key: string
      call: ToolCallInfo
      result?: ToolResultInfo
      timing?: ToolTiming
    }
  | { type: 'question'; key: string; call: ToolCallInfo; result?: ToolResultInfo }
  | { type: 'model'; key: string; provider: string; model: string }
  | { type: 'file'; key: string; relPath: string; kind: DeliveredFileKind }
  | { type: 'path'; key: string; path: string; kind: 'folder' | 'file' }
  | { type: 'workflow'; key: string; snapshot: WorkflowSnapshot }
  | { type: 'task'; key: string; snapshot: TaskSnapshot }
  | {
      type: 'compaction'
      key: string
      phase: 'started' | 'done'
      tokensSaved?: number
      targetsCount: number
      messagesCount?: number
    }
  | {
      type: 'turnEnd'
      key: string
      stopReason: SegmentTurnEndReason
      reasoningContent?: string
    }

const WORKSPACE_PREFIX_RE = /^.*?\/\.wolffish\/workspace\//

/** Normalize any absolute desktop workspace path to workspace-relative. */
export function toWorkspaceRelative(path: string): string {
  return path.replace(WORKSPACE_PREFIX_RE, '')
}

/** `[wolffish-output: <path> (<kind>)]` — delivered-file markers, output only. */
const OUTPUT_MARKER_RE =
  /\[wolffish-output:\s*([^\]]+?)\s*\((image|document|audio|video|file|chart)\)\]/g

/** `[wolffish-path: <path> (folder|file)]` — show_path markers. */
const PATH_MARKER_RE = /\[wolffish-path:\s*([^\]]+?)\s*\((folder|file)\)\]/g

/** A text buffer that is exactly one media image renders as an image, not markdown. */
const MEDIA_ONLY_RE = /^!\[[^\]]*\]\(wolffish-media:\/\/([^)]+)\)$/

export function isRenderableSegment(segment: Segment): boolean {
  if ('worker' in segment && segment.worker) return false
  if (segment.kind === 'tool_call' && WORKFLOW_TOOL_NAMES.has(segment.name)) return false
  if (segment.kind === 'tool_result') return true
  return true
}

/**
 * Voice tool replies persist as JSON `{filePath, fileName, isResponse}` in the
 * tool result output. Returns the relative path when this is such a payload.
 */
function parseVoiceResult(output: string): string | null {
  const trimmed = output.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes('filePath')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { filePath?: unknown }).filePath === 'string'
    ) {
      return toWorkspaceRelative((parsed as { filePath: string }).filePath)
    }
  } catch {
    // Not JSON — a plain tool output.
  }
  return null
}

function extractDeliveredFiles(
  call: ToolCallInfo | undefined,
  result: ToolResultInfo,
  key: string,
  emitted: Set<string>
): RenderBlock[] {
  if (call && FILE_CONTENT_TOOL_NAMES.has(call.name)) return []
  const blocks: RenderBlock[] = []

  const voicePath = parseVoiceResult(result.output)
  if (voicePath) {
    if (!emitted.has(voicePath)) {
      emitted.add(voicePath)
      blocks.push({ type: 'file', key: `${key}:voice`, relPath: voicePath, kind: 'audio' })
    }
    return blocks
  }

  let match: RegExpExecArray | null
  OUTPUT_MARKER_RE.lastIndex = 0
  let index = 0
  while ((match = OUTPUT_MARKER_RE.exec(result.output)) !== null) {
    const relPath = toWorkspaceRelative(match[1])
    const kind = match[2] as DeliveredFileKind
    // Placeholder/self-referential markers (e.g. docs quoting the format).
    if (relPath === 'path' || relPath.includes('${')) continue
    if (emitted.has(relPath)) continue
    emitted.add(relPath)
    blocks.push({ type: 'file', key: `${key}:out${index}`, relPath, kind })
    index += 1
  }

  PATH_MARKER_RE.lastIndex = 0
  index = 0
  while ((match = PATH_MARKER_RE.exec(result.output)) !== null) {
    blocks.push({
      type: 'path',
      key: `${key}:path${index}`,
      path: match[1],
      kind: match[2] as 'folder' | 'file'
    })
    index += 1
  }

  return blocks
}

/**
 * Walk an assistant message's segments into orderly render blocks. Total —
 * unknown kinds are skipped, malformed data never throws.
 *
 * A message with prose but NO segments renders that prose. Every message the
 * desktop persists carries segments, so this looks like dead code and was
 * missing for that reason — but the phone writes messages the desktop never
 * sees (the offline reply) and reads text off the wire before its segments
 * exist (a turn streaming in as deltas). Without the fallback both render as
 * an empty bubble: text on screen everywhere else, silently blank here.
 */
export function buildRenderBlocks(message: ConversationMessage): RenderBlock[] {
  const segments = message.segments ?? []
  if (segments.length === 0) {
    const prose = message.content?.trim() ?? ''
    return prose ? [{ type: 'text', key: `t:${message.id ?? 'content'}`, markdown: prose }] : []
  }
  const blocks: RenderBlock[] = []
  const openTools = new Map<string, number>() // toolCallId -> block index
  const emittedFiles = new Set<string>()
  const workflowIndexById = new Map<string, number>()
  const taskIndexById = new Map<string, number>()
  let textBuffer = ''
  let textKey = ''
  let compactionStartedIndex = -1

  const flushText = (): void => {
    const trimmed = textBuffer.trim()
    textBuffer = ''
    if (!trimmed) return
    const mediaMatch = MEDIA_ONLY_RE.exec(trimmed)
    if (mediaMatch) {
      blocks.push({ type: 'media', key: textKey, relPath: toWorkspaceRelative(mediaMatch[1]) })
      return
    }
    blocks.push({ type: 'text', key: textKey, markdown: trimmed })
  }

  for (const segment of segments) {
    if (!segment || typeof segment !== 'object' || !('kind' in segment)) continue
    if (!isRenderableSegment(segment)) continue

    switch (segment.kind) {
      case 'text':
        if (!textBuffer) textKey = `t:${segment.segmentId}`
        textBuffer += segment.delta
        break
      case 'separator':
        flushText()
        break
      case 'tool_call': {
        flushText()
        const call: ToolCallInfo = {
          toolCallId: segment.toolCallId,
          name: segment.name,
          args: segment.args ?? {}
        }
        const timing = message.toolTimings?.[segment.toolCallId]
        const type = segment.name === ASK_TOOL_NAME ? 'question' : 'tool'
        openTools.set(segment.toolCallId, blocks.length)
        blocks.push({ type, key: `c:${segment.toolCallId}`, call, timing })
        break
      }
      case 'tool_result': {
        flushText()
        const result: ToolResultInfo = {
          status: segment.status,
          output: segment.output ?? '',
          error: segment.error
        }
        const callIndex = openTools.get(segment.toolCallId)
        let call: ToolCallInfo | undefined
        if (callIndex !== undefined) {
          const block = blocks[callIndex]
          if (block.type === 'tool' || block.type === 'question') {
            block.result = result
            call = block.call
          }
        }
        blocks.push(...extractDeliveredFiles(call, result, `r:${segment.toolCallId}`, emittedFiles))
        break
      }
      case 'active_model':
        flushText()
        blocks.push({
          type: 'model',
          key: `m:${segment.segmentId}`,
          provider: segment.provider,
          model: segment.model
        })
        break
      case 'workflow': {
        flushText()
        const id = segment.snapshot?.workflowId
        if (!id) break
        const existing = workflowIndexById.get(id)
        if (existing !== undefined) {
          blocks[existing] = { type: 'workflow', key: `w:${id}`, snapshot: segment.snapshot }
        } else {
          workflowIndexById.set(id, blocks.length)
          blocks.push({ type: 'workflow', key: `w:${id}`, snapshot: segment.snapshot })
        }
        break
      }
      case 'task': {
        // Async generation task card — replace-by-taskId, exactly like the
        // workflow fold above (the desktop's upsertTaskSegment contract).
        flushText()
        const id = segment.snapshot?.taskId
        if (!id) break
        const existing = taskIndexById.get(id)
        if (existing !== undefined) {
          blocks[existing] = { type: 'task', key: `tk:${id}`, snapshot: segment.snapshot }
        } else {
          taskIndexById.set(id, blocks.length)
          blocks.push({ type: 'task', key: `tk:${id}`, snapshot: segment.snapshot })
        }
        break
      }
      case 'compaction_started':
        flushText()
        compactionStartedIndex = blocks.length
        blocks.push({
          type: 'compaction',
          key: `cs:${segment.segmentId}`,
          phase: 'started',
          targetsCount: segment.targetsCount,
          messagesCount: segment.messagesCount
        })
        break
      case 'compaction':
        flushText()
        // A completed compaction supersedes its "started" card.
        if (compactionStartedIndex >= 0) {
          blocks.splice(compactionStartedIndex, 1)
          compactionStartedIndex = -1
        }
        blocks.push({
          type: 'compaction',
          key: `cd:${segment.segmentId}`,
          phase: 'done',
          targetsCount: segment.targetsCount,
          tokensSaved: segment.tokensSaved
        })
        break
      case 'turn_end':
        flushText()
        if (
          segment.stopReason !== 'end_turn' ||
          (segment.reasoningContent && segment.reasoningContent.trim())
        ) {
          blocks.push({
            type: 'turnEnd',
            key: `e:${segment.segmentId}`,
            stopReason: segment.stopReason,
            reasoningContent: segment.reasoningContent
          })
        }
        break
      default:
        // Unknown segment kind from a newer desktop — skip, never crash.
        break
    }
  }
  flushText()
  return blocks
}

/**
 * Merge consecutive text segments into one per run — the desktop does this at
 * persist time (a raw stream was 28k segments / 4 MB). Used by the demo
 * importer and by the demo streaming persister.
 */
export function coalesceTextSegments(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const segment of segments) {
    const last = out[out.length - 1]
    if (
      segment.kind === 'text' &&
      last &&
      last.kind === 'text' &&
      Boolean(last.worker) === Boolean(segment.worker) &&
      last.worker?.id === segment.worker?.id
    ) {
      out[out.length - 1] = { ...last, delta: last.delta + segment.delta }
    } else {
      out.push(segment)
    }
  }
  return out
}

/**
 * Every workspace path a message renders: its attachments, plus the delivered
 * file and media blocks its segments produce. This is what the sync layer
 * prefetches after a conversation body lands — collected through the same
 * buildRenderBlocks the feed uses, so prefetch and display can never disagree
 * about what counts as a file.
 */
export function messageFilePaths(message: ConversationMessage): string[] {
  const paths = new Set<string>()
  for (const attachment of message.attachments ?? []) {
    if (attachment?.filePath) paths.add(toWorkspaceRelative(attachment.filePath))
  }
  if (message.role === 'assistant') {
    for (const block of buildRenderBlocks(message)) {
      if (block.type === 'file' || block.type === 'media') paths.add(block.relPath)
      // A finished generation task renders its mp4 inline — prefetch it with
      // the conversation instead of downloading lazily on first render.
      if (block.type === 'task' && block.snapshot.outputPath) {
        paths.add(toWorkspaceRelative(block.snapshot.outputPath))
      }
    }
  }
  return [...paths]
}

/** Concatenated assistant prose — the "copy message" payload. */
export function messageText(message: ConversationMessage): string {
  if (message.role === 'user') return message.content
  if (message.content) return message.content
  const parts: string[] = []
  for (const segment of message.segments ?? []) {
    if (segment.kind === 'text' && !segment.worker) parts.push(segment.delta)
  }
  return parts.join('')
}
