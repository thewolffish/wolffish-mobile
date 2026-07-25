import { Copy01Icon, Tick02Icon } from '@/components/core/icons'
import { buildRenderBlocks, messageText, toWorkspaceRelative } from '@/lib/conversations/segments'
import type { ConversationMessage, MessageAttachment } from '@/lib/conversations/types'
import { cn } from '@/lib/utils/cn'
import { formatRelativeTime } from '@/lib/utils/relativeTime'
import * as Clipboard from 'expo-clipboard'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'
import { CompactionCard, ModelChip, PathCard, TurnEndCard, WorkflowCard } from './InlineCards'
import { FileBlock } from './FileBlock'
import { MarkdownView, markdownHasTable } from './MarkdownView'
import { QuestionCard } from './QuestionCard'
import { ThinkingIndicator } from './ThinkingIndicator'
import { ToolCard } from './ToolCard'

/**
 * Feed message renderers. User prompts are right-aligned primary bubbles;
 * assistant turns walk their segment stream into blocks (text bubbles, tool
 * cards, delivered files, chips) with the desktop's clean/verbose gating:
 * verbose off hides tool cards, model chips and compaction — replies,
 * question cards and delivered files always render.
 */

function CopyFooter({
  text,
  timestamp,
  align
}: {
  text: string
  timestamp?: number
  align: 'start' | 'end'
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const relative = useMemo(
    () => (timestamp ? formatRelativeTime(timestamp, t) : ''),
    [timestamp, t]
  )
  const Icon = copied ? Tick02Icon : Copy01Icon
  return (
    <View
      className={cn('flex-row items-center gap-2', align === 'end' ? 'self-end' : 'self-start')}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('chat.copyMessage')}
        hitSlop={8}
        onPress={() => {
          void Clipboard.setStringAsync(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="p-1"
      >
        <Icon size={12} className={copied ? 'text-emerald-600' : 'text-muted'} />
      </Pressable>
      {relative ? <Text className="text-muted font-sans text-[10px]">{relative}</Text> : null}
    </View>
  )
}

function AttachmentList({
  attachments,
  conversationId,
  align
}: {
  attachments: MessageAttachment[]
  conversationId?: string
  align: 'start' | 'end'
}): React.JSX.Element {
  return (
    <View className={cn('flex-col gap-2', align === 'end' ? 'items-end' : 'items-start')}>
      {attachments.map((attachment, index) => (
        <FileBlock
          key={index}
          relPath={toWorkspaceRelative(attachment.filePath)}
          conversationId={conversationId}
          declared={attachment.type}
          sizeBytes={attachment.sizeBytes}
          displayName={attachment.originalName}
          align={align}
        />
      ))}
    </View>
  )
}

export const UserBubble = memo(function UserBubble({
  message,
  conversationId
}: {
  message: ConversationMessage
  conversationId?: string
}): React.JSX.Element {
  const hasText = message.content.trim().length > 0
  return (
    <View className="flex-col gap-1.5">
      {hasText && (
        <View className="bg-primary max-w-[85%] self-end overflow-hidden rounded-2xl px-4 py-2.5">
          <MarkdownView variant="user">{message.content}</MarkdownView>
        </View>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <AttachmentList
          attachments={message.attachments}
          conversationId={conversationId}
          align="end"
        />
      )}
      {hasText && <CopyFooter text={message.content} timestamp={message.timestamp} align="end" />}
    </View>
  )
})

export const AssistantMessageView = memo(function AssistantMessageView({
  message,
  conversationId,
  verbose,
  streaming
}: {
  message: ConversationMessage
  conversationId?: string
  verbose: boolean
  streaming?: boolean
}): React.JSX.Element {
  const blocks = useMemo(() => buildRenderBlocks(message), [message])
  const fullText = useMemo(() => messageText(message), [message])

  const visible = blocks.filter((block) => {
    if (block.type === 'tool' || block.type === 'model' || block.type === 'compaction') {
      return verbose
    }
    return true
  })

  // Nothing renderable while the turn streams → typed thinking words.
  if (streaming && visible.every((block) => block.type !== 'text')) {
    return <ThinkingIndicator />
  }

  return (
    <View className="flex-col gap-2">
      {visible.map((block) => (
        <View key={block.key} className="flex-col">
          {renderBlock(block, conversationId)}
        </View>
      ))}
      {!streaming && fullText.trim().length > 0 && (
        <CopyFooter text={fullText} timestamp={message.timestamp} align="start" />
      )}
    </View>
  )
})

function renderBlock(
  block: ReturnType<typeof buildRenderBlocks>[number],
  conversationId?: string
): React.ReactNode {
  switch (block.type) {
    case 'text':
      return (
        // A table needs the bubble at a DEFINITE width (w-[85%]) — a
        // content-sized bubble around a horizontal scroller is a circular
        // constraint that explodes Yoga layout. overflow-hidden clips any
        // painting past the rounded corners.
        <View
          className={cn(
            'bg-surface border-border self-start overflow-hidden rounded-2xl border px-4 py-2.5',
            markdownHasTable(block.markdown) ? 'w-[85%]' : 'max-w-[85%]'
          )}
        >
          <MarkdownView>{block.markdown}</MarkdownView>
        </View>
      )
    case 'media':
      return <FileBlock relPath={block.relPath} conversationId={conversationId} declared="image" />
    case 'tool':
      return <ToolCard call={block.call} result={block.result} timing={block.timing} />
    case 'question':
      return <QuestionCard call={block.call} result={block.result} />
    case 'file':
      // The marker's kind is only a hint — the extension decides which viewer
      // renders, exactly as on the desktop.
      return (
        <FileBlock relPath={block.relPath} conversationId={conversationId} declared={block.kind} />
      )
    case 'model':
      return <ModelChip provider={block.provider} model={block.model} />
    case 'path':
      return <PathCard path={block.path} kind={block.kind} />
    case 'workflow':
      return <WorkflowCard snapshot={block.snapshot} />
    case 'compaction':
      return <CompactionCard block={block} />
    case 'turnEnd':
      return <TurnEndCard block={block} />
    default:
      return null
  }
}
