import {
  AiBrain01Icon,
  BrainIcon,
  BubbleChatIcon,
  FireIcon,
  FlashIcon,
  WorkflowSquare03Icon
} from '@/components/core/icons'
import type { ConversationFile } from '@/lib/conversations/types'
import { cn } from '@/lib/utils/cn'
import {
  THINKING_LEVELS,
  setConfigValue,
  useConfigValue,
  type ThinkingLevel
} from '@/state/demoConfig'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'

/**
 * The composer's control cluster, desktop composer parity: chat mode
 * (single/workflow), thinking level (off/on/high/max with the desktop's
 * Flash/Brain/AiBrain/Fire icons), model picker, and the context meter.
 * Rendered inside the chat menu sheet and the Model settings panel.
 */

const THINKING_ICONS: Record<ThinkingLevel, typeof FlashIcon> = {
  off: FlashIcon,
  on: BrainIcon,
  high: AiBrain01Icon,
  max: FireIcon
}

function Chip({
  active,
  onPress,
  icon,
  label
}: {
  active: boolean
  onPress: () => void
  icon?: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-1.5 rounded-lg border px-3 py-2',
        active ? 'bg-primary border-primary' : 'bg-bg border-border active:bg-border/40'
      )}
    >
      {icon}
      <Text
        className={cn('font-sans-medium text-left text-xs', active ? 'text-primary-fg' : 'text-fg')}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** Chat mode + thinking level chips — shared by menu sheet and Model panel. */
export function ModeAndThinkingControls(): React.JSX.Element {
  const { t } = useTranslation()
  const chatMode = useConfigValue('chatMode')
  const thinkingMode = useConfigValue('thinkingMode')
  const setChatMode = (mode: 'single' | 'workflow'): void => setConfigValue('chatMode', mode)
  const setThinkingMode = (level: ThinkingLevel): void => setConfigValue('thinkingMode', level)

  return (
    <View className="flex-col gap-4">
      <View className="flex-col gap-2">
        <Text className="text-muted font-sans-medium text-left text-sm">
          {t('settings.model.modeLabel')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip
            active={chatMode === 'single'}
            onPress={() => setChatMode('single')}
            icon={
              <BubbleChatIcon
                size={14}
                className={chatMode === 'single' ? 'text-primary-fg' : 'text-muted'}
              />
            }
            label={t('settings.chatModes.single')}
          />
          <Chip
            active={chatMode === 'workflow'}
            onPress={() => setChatMode('workflow')}
            icon={
              <WorkflowSquare03Icon
                size={14}
                className={chatMode === 'workflow' ? 'text-primary-fg' : 'text-muted'}
              />
            }
            label={t('settings.chatModes.workflow')}
          />
        </View>
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {chatMode === 'single'
            ? t('settings.chatModes.singleDescription')
            : t('settings.chatModes.workflowDescription')}
        </Text>
      </View>

      <View className="flex-col gap-2">
        <Text className="text-muted font-sans-medium text-left text-sm">
          {t('settings.model.thinkingLabel')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {THINKING_LEVELS.map((level) => {
            const Icon = THINKING_ICONS[level]
            const active = thinkingMode === level
            return (
              <Chip
                key={level}
                active={active}
                onPress={() => setThinkingMode(level)}
                icon={<Icon size={14} className={active ? 'text-primary-fg' : 'text-muted'} />}
                label={t(`settings.thinking.${level}`)}
              />
            )
          })}
        </View>
      </View>
    </View>
  )
}

function formatTokens(value: number | undefined): string {
  const tokens = value ?? 0
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}

/**
 * Context meter — the desktop's gauge as a card: context fill bar plus the
 * last-turn and all-time roll-ups from the conversation's persisted stats.
 */
export function ContextMeterCard({
  conversation
}: {
  conversation: ConversationFile | null | undefined
}): React.JSX.Element {
  const { t } = useTranslation()
  const meter = conversation?.stats?.meter
  const allTime = conversation?.stats?.allTime
  const lastTurn = conversation?.stats?.lastTurn
  const contextTokens = meter?.contextTokens ?? 0
  const contextBudget = meter?.contextBudget ?? 0
  const fill = contextBudget > 0 ? Math.min(contextTokens / contextBudget, 1) : 0
  const fillClass = fill > 0.85 ? 'bg-red-500' : fill > 0.6 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <View className="flex-col gap-3">
      <View className="flex-col gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-muted font-sans-medium text-left text-sm">
            {t('chat.menu.context')}
          </Text>
          <Text className="text-fg font-sans text-xs" style={{ writingDirection: 'ltr' }}>
            {formatTokens(contextTokens)} / {formatTokens(contextBudget)}
          </Text>
        </View>
        <View className="bg-border h-1.5 w-full overflow-hidden rounded-full">
          <View className={cn('h-full', fillClass)} style={{ width: `${fill * 100}%` }} />
        </View>
      </View>
      {lastTurn ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-muted text-left font-sans text-xs">{t('chat.menu.lastTurn')}</Text>
          <Text className="text-fg font-sans text-xs" style={{ writingDirection: 'ltr' }}>
            {formatTokens(lastTurn.inputTokens)} in · {formatTokens(lastTurn.outputTokens)} out · $
            {(lastTurn.cost ?? 0).toFixed(3)}
          </Text>
        </View>
      ) : null}
      {allTime ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-muted text-left font-sans text-xs">{t('chat.menu.allTime')}</Text>
          <Text className="text-fg font-sans text-xs" style={{ writingDirection: 'ltr' }}>
            {allTime.turns ?? 0} {t('chat.menu.turns')} · {formatTokens(allTime.inputTokens)} in ·{' '}
            {formatTokens(allTime.outputTokens)} out · ${(allTime.cost ?? 0).toFixed(2)}
          </Text>
        </View>
      ) : null}
      {!meter && !allTime ? (
        <Text className="text-muted text-left font-sans text-xs">{t('chat.menu.noStats')}</Text>
      ) : null}
    </View>
  )
}
