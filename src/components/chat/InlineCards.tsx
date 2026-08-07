import { ArrowDown01Icon, ArrowRight01Icon, ArrowLeft01Icon } from '@/components/core/icons'
import type { RenderBlock } from '@/lib/conversations/segments'
import type { WorkflowSnapshot } from '@/lib/conversations/types'
import { cn } from '@/lib/utils/cn'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { I18nManager, Pressable, Text, View } from 'react-native'

/**
 * The small inline chat cards: model chip, turn-end footer, workflow summary,
 * compaction notice. All verbose-gated except the turn-end error footer.
 */

export const ModelChip = memo(function ModelChip({
  provider,
  model
}: {
  provider: string
  model: string
}): React.JSX.Element {
  return (
    <View className="border-border bg-surface flex-row items-center gap-1.5 self-start rounded-full border px-2.5 py-1">
      <View className="bg-primary h-1.5 w-1.5 rounded-full" />
      <Text selectable className="text-muted font-sans-medium text-left text-[10px]">
        {provider}/{model}
      </Text>
    </View>
  )
})

export const TurnEndCard = memo(function TurnEndCard({
  block
}: {
  block: Extract<RenderBlock, { type: 'turnEnd' }>
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [showReasoning, setShowReasoning] = useState(false)
  const reasoning = block.reasoningContent?.trim()

  const label =
    block.stopReason === 'max_tokens'
      ? t('chat.turnFooter.maxTokens')
      : block.stopReason === 'error' || block.stopReason === 'no_provider_available'
        ? t('chat.turnFooter.error')
        : null

  if (!label && !reasoning) return null
  const Chevron = showReasoning
    ? ArrowDown01Icon
    : I18nManager.isRTL
      ? ArrowLeft01Icon
      : ArrowRight01Icon

  return (
    <View className="flex-col gap-1.5">
      {label && (
        <View className="self-start rounded-full bg-amber-500/15 px-2.5 py-1">
          <Text className="font-sans-medium text-left text-[10px] text-amber-600 dark:text-amber-400">
            {label}
          </Text>
        </View>
      )}
      {reasoning ? (
        <View className="bg-surface border-border w-[85%] flex-col gap-2 self-start rounded-xl border px-3 py-2.5">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showReasoning }}
            onPress={() => setShowReasoning((value) => !value)}
            className="flex-row items-center gap-2"
          >
            <Text numberOfLines={1} className="text-fg font-sans-medium flex-1 text-left text-xs">
              {t('chat.reasoning')}
            </Text>
            <Chevron size={14} className="text-muted" />
          </Pressable>
          {showReasoning && (
            <Text selectable className="text-muted text-left font-sans text-xs leading-5">
              {reasoning}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  )
})

export const WorkflowCard = memo(function WorkflowCard({
  snapshot
}: {
  snapshot: WorkflowSnapshot
}): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const done = snapshot.agents.filter((agent) => agent.status === 'completed').length
  const Chevron = expanded
    ? ArrowDown01Icon
    : I18nManager.isRTL
      ? ArrowLeft01Icon
      : ArrowRight01Icon

  return (
    <View className="bg-surface border-border w-full flex-col gap-2 rounded-xl border px-3 py-2.5">
      <Text
        onPress={() => setExpanded((value) => !value)}
        suppressHighlighting
        className="text-fg font-sans-medium text-left text-xs"
      >
        <Chevron size={12} className="text-muted" /> {t('chat.workflowCard.title')} ·{' '}
        {t('chat.workflowCard.agentsDone', { done, total: snapshot.agents.length })} ·{' '}
        {t('chat.workflowCard.toolCalls', { count: snapshot.totals.toolCalls })}
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        {snapshot.phases.map((phase, index) => (
          <View
            key={index}
            className={cn(
              'rounded-full border px-2 py-0.5',
              phase.status === 'done'
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : phase.status === 'active'
                  ? 'border-primary'
                  : 'border-border'
            )}
          >
            <Text className="text-muted font-sans text-[10px]">{phase.title}</Text>
          </View>
        ))}
      </View>
      {expanded && (
        <View className="flex-col gap-1">
          {snapshot.agents.map((agent) => (
            <View key={agent.id} className="flex-row items-center gap-2">
              <View
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  agent.status === 'completed'
                    ? 'bg-emerald-500'
                    : agent.status === 'failed'
                      ? 'bg-red-500'
                      : 'bg-primary'
                )}
              />
              <Text
                selectable
                numberOfLines={1}
                className="text-fg flex-1 text-left font-sans text-[11px]"
              >
                {agent.name}
              </Text>
              <Text selectable className="text-muted font-sans text-[10px]">
                {agent.model}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
})

export const CompactionCard = memo(function CompactionCard({
  block
}: {
  block: Extract<RenderBlock, { type: 'compaction' }>
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <View className="flex-row items-center gap-2 self-start rounded-full bg-violet-500/10 px-2.5 py-1">
      <Text className="font-sans-medium text-left text-[10px] text-violet-600 dark:text-violet-400">
        {t('chat.compactionCard.title')} ·{' '}
        {block.phase === 'started'
          ? t('chat.compactionCard.started', { messages: block.messagesCount ?? 0 })
          : t('chat.compactionCard.saved', {
              targets: block.targetsCount,
              tokens: ((block.tokensSaved ?? 0) / 1000).toFixed(1) + 'k'
            })}
      </Text>
    </View>
  )
})

export const PathCard = memo(function PathCard({
  path
}: {
  path: string
  kind: 'folder' | 'file'
}): React.JSX.Element {
  return (
    <View className="bg-surface border-border max-w-[85%] flex-col gap-1 self-start rounded-xl border px-4 py-3">
      <Text
        selectable
        style={{ writingDirection: 'ltr' }}
        className="text-muted text-left font-mono text-xs"
      >
        {path}
      </Text>
    </View>
  )
})
