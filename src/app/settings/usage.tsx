import { InfoRow, PanelScreen, Section } from '@/components/settings/SettingsUI'
import { getUsageSummary, type UsageSummary } from '@/lib/conversations/repo'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Text, View } from 'react-native'

/**
 * Usage — the desktop UsagePanel's stat cards computed from the imported
 * conversations' real stats blocks: turns, tokens, cost, favourite model,
 * per-channel split. Entirely local.
 */

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}

function StatCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="bg-surface border-border min-w-[45%] flex-1 flex-col gap-1 rounded-2xl border p-4">
      <Text
        className="text-fg font-sans-semibold text-left text-xl"
        style={{ writingDirection: 'ltr' }}
      >
        {value}
      </Text>
      <Text className="text-muted text-left font-sans text-xs">{label}</Text>
    </View>
  )
}

export default function UsageScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { data } = useQuery<UsageSummary>({
    queryKey: ['usage-summary'],
    queryFn: getUsageSummary,
    staleTime: 60_000
  })

  if (!data) {
    return (
      <PanelScreen title={t('settings.tabs.usage')}>
        <ActivityIndicator />
      </PanelScreen>
    )
  }

  return (
    <PanelScreen title={t('settings.tabs.usage')} subtitle={t('settings.usage.subtitle')}>
      <View className="flex-row flex-wrap gap-3">
        <StatCard label={t('settings.usage.conversations')} value={`${data.conversations}`} />
        <StatCard label={t('settings.usage.messages')} value={`${data.messages}`} />
        <StatCard label={t('settings.usage.turns')} value={`${data.turns}`} />
        <StatCard label={t('settings.usage.toolCalls')} value={`${data.toolCalls}`} />
        <StatCard label={t('settings.usage.inputTokens')} value={formatTokens(data.inputTokens)} />
        <StatCard
          label={t('settings.usage.outputTokens')}
          value={formatTokens(data.outputTokens)}
        />
        <StatCard label={t('settings.usage.cost')} value={`$${data.cost.toFixed(2)}`} />
        <StatCard label={t('settings.usage.topModel')} value={data.topModel ?? '—'} />
      </View>
      <Section title={t('settings.usage.byChannel')}>
        {Object.entries(data.byChannel)
          .sort((a, b) => b[1] - a[1])
          .map(([channel, count]) => (
            <InfoRow
              key={channel}
              label={t(`settings.usage.channels.${channel}`, { defaultValue: channel })}
              value={`${count}`}
            />
          ))}
      </Section>
    </PanelScreen>
  )
}
