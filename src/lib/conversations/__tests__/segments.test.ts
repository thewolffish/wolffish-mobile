import {
  buildRenderBlocks,
  coalesceTextSegments,
  messageText,
  toWorkspaceRelative
} from '@/lib/conversations/segments'
import type { ConversationMessage, Segment } from '@/lib/conversations/types'

function textSeg(delta: string, id: string, worker?: { id: string }): Segment {
  return { kind: 'text', turnId: 't1', segmentId: id, delta, ...(worker ? { worker } : {}) }
}

function message(segments: Segment[], extra?: Partial<ConversationMessage>): ConversationMessage {
  return { id: 'm1', role: 'assistant', content: '', timestamp: 1, segments, ...extra }
}

describe('toWorkspaceRelative', () => {
  it('strips any absolute desktop workspace prefix', () => {
    expect(toWorkspaceRelative('/Users/x/.wolffish/workspace/files/a.pdf')).toBe('files/a.pdf')
    expect(toWorkspaceRelative('files/a.pdf')).toBe('files/a.pdf')
  })
})

describe('coalesceTextSegments', () => {
  it('merges consecutive text runs and keeps boundaries', () => {
    const out = coalesceTextSegments([
      textSeg('Hel', 's1'),
      textSeg('lo', 's2'),
      { kind: 'separator', turnId: 't1', segmentId: 's3' },
      textSeg('World', 's4')
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ kind: 'text', delta: 'Hello' })
    expect(out[2]).toMatchObject({ kind: 'text', delta: 'World' })
  })

  it('never merges across different workers', () => {
    const out = coalesceTextSegments([
      textSeg('a', 's1', { id: 'w1' }),
      textSeg('b', 's2', { id: 'w2' }),
      textSeg('c', 's3')
    ])
    expect(out).toHaveLength(3)
  })
})

describe('buildRenderBlocks', () => {
  it('accumulates deltas into one text block and flushes at tool calls', () => {
    const blocks = buildRenderBlocks(
      message([
        textSeg('Hello ', 's1'),
        textSeg('world', 's2'),
        {
          kind: 'tool_call',
          turnId: 't1',
          segmentId: 's3',
          toolCallId: 'c1',
          name: 'shell_exec',
          args: { command: 'date' }
        },
        {
          kind: 'tool_result',
          turnId: 't1',
          segmentId: 's4',
          toolCallId: 'c1',
          status: 'success',
          output: '2026-07-23'
        },
        textSeg('Done.', 's5')
      ])
    )
    expect(blocks.map((block) => block.type)).toEqual(['text', 'tool', 'text'])
    expect(blocks[0]).toMatchObject({ markdown: 'Hello world' })
    const tool = blocks[1]
    if (tool.type !== 'tool') throw new Error('expected tool block')
    expect(tool.call.name).toBe('shell_exec')
    expect(tool.result?.output).toBe('2026-07-23')
  })

  it('skips worker-tagged segments and workflow orchestration tools', () => {
    const blocks = buildRenderBlocks(
      message([
        textSeg('visible', 's1'),
        textSeg('hidden', 's2', { id: 'w1' }),
        {
          kind: 'tool_call',
          turnId: 't1',
          segmentId: 's3',
          toolCallId: 'c1',
          name: 'agent_spawn',
          args: {}
        }
      ])
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'text', markdown: 'visible' })
  })

  it('extracts delivered-file markers from tool output, normalized and deduped', () => {
    const output =
      'done [wolffish-output: /Users/x/.wolffish/workspace/files/a.pdf (document)]\n' +
      '[wolffish-output: files/a.pdf (document)]'
    const blocks = buildRenderBlocks(
      message([
        {
          kind: 'tool_call',
          turnId: 't1',
          segmentId: 's1',
          toolCallId: 'c1',
          name: 'pdf_render',
          args: {}
        },
        {
          kind: 'tool_result',
          turnId: 't1',
          segmentId: 's2',
          toolCallId: 'c1',
          status: 'success',
          output
        }
      ])
    )
    const files = blocks.filter((block) => block.type === 'file')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ relPath: 'files/a.pdf', kind: 'document' })
  })

  it('never renders markers quoted inside file-content tool output', () => {
    const blocks = buildRenderBlocks(
      message([
        {
          kind: 'tool_call',
          turnId: 't1',
          segmentId: 's1',
          toolCallId: 'c1',
          name: 'file_read',
          args: { path: 'notes.md' }
        },
        {
          kind: 'tool_result',
          turnId: 't1',
          segmentId: 's2',
          toolCallId: 'c1',
          status: 'success',
          output: 'docs say [wolffish-output: files/x.pdf (document)]'
        }
      ])
    )
    expect(blocks.filter((block) => block.type === 'file')).toHaveLength(0)
  })

  it('renders a media-only text buffer as an image block', () => {
    const blocks = buildRenderBlocks(
      message([textSeg('![meme](wolffish-media://uploads/memes/a.gif)', 's1')])
    )
    expect(blocks).toEqual([
      expect.objectContaining({ type: 'media', relPath: 'uploads/memes/a.gif' })
    ])
  })

  it('routes ask_user to a question block', () => {
    const blocks = buildRenderBlocks(
      message([
        {
          kind: 'tool_call',
          turnId: 't1',
          segmentId: 's1',
          toolCallId: 'c1',
          name: 'ask_user',
          args: { questions: [{ question: 'Which?', options: [] }] }
        }
      ])
    )
    expect(blocks[0]?.type).toBe('question')
  })

  it('emits turn_end only for abnormal stops or reasoning', () => {
    const clean = buildRenderBlocks(
      message([
        {
          kind: 'turn_end',
          turnId: 't1',
          segmentId: 's1',
          stopReason: 'end_turn',
          iterationCount: 1
        }
      ])
    )
    expect(clean).toHaveLength(0)
    const reasoned = buildRenderBlocks(
      message([
        {
          kind: 'turn_end',
          turnId: 't1',
          segmentId: 's1',
          stopReason: 'end_turn',
          iterationCount: 1,
          reasoningContent: 'because'
        }
      ])
    )
    expect(reasoned[0]).toMatchObject({ type: 'turnEnd', reasoningContent: 'because' })
  })

  it('replaces workflow snapshots by workflowId instead of appending', () => {
    const snapshot = (status: 'running' | 'completed') => ({
      workflowId: 'wf1',
      status,
      startedAt: 1,
      phases: [],
      agents: [],
      totals: {
        agents: 0,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0
      }
    })
    const blocks = buildRenderBlocks(
      message([
        { kind: 'workflow', turnId: 't1', segmentId: 's1', snapshot: snapshot('running') },
        { kind: 'workflow', turnId: 't1', segmentId: 's2', snapshot: snapshot('completed') }
      ])
    )
    const workflows = blocks.filter((block) => block.type === 'workflow')
    expect(workflows).toHaveLength(1)
    expect(workflows[0]).toMatchObject({ snapshot: expect.objectContaining({ status: 'completed' }) })
  })

  it('tolerates unknown segment kinds and malformed entries', () => {
    const weird = [
      { kind: 'hologram', turnId: 't1', segmentId: 's1' },
      null,
      42,
      textSeg('ok', 's2')
    ] as unknown as Segment[]
    expect(buildRenderBlocks(message(weird))).toEqual([
      expect.objectContaining({ type: 'text', markdown: 'ok' })
    ])
  })
})

describe('messageText', () => {
  it('prefers persisted content and falls back to joined deltas', () => {
    expect(messageText(message([textSeg('a', 's1')], { content: 'full' }))).toBe('full')
    expect(messageText(message([textSeg('a', 's1'), textSeg('b', 's2')]))).toBe('ab')
  })
})
