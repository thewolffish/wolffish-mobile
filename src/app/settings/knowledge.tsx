import { Activity04Icon } from '@/components/core/icons'
import { Select, type SelectOption } from '@/components/core/Select'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { formatTokens } from '@/lib/utils/formatTokens'
import {
  setConfigValue,
  useCompactionRuns,
  useConfigValue,
  type CompactionRunRecord
} from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, Text, View } from 'react-native'

/**
 * Knowledge — the desktop CompactionPanel: when the daily compaction and
 * weekly consolidation run, then what the last of each actually did. Schedule
 * rows are editable and local in demo mode; the last-run cards are read-only
 * records the desktop's brainstem wrote, carried in the config snapshot.
 */
export default function KnowledgeScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const dailyHour = useConfigValue('compactionDailyHour')
  const weeklyDay = useConfigValue('compactionWeeklyDay')
  const weeklyHour = useConfigValue('compactionWeeklyHour')
  const runs = useCompactionRuns()

  const hourOptions = useMemo<readonly SelectOption<string>[]>(
    () =>
      Array.from({ length: 24 }, (_, hour) => ({
        value: `${hour}`,
        label: `${hour.toString().padStart(2, '0')}:00`
      })),
    []
  )
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayOptions = useMemo<readonly SelectOption<string>[]>(
    () => dayKeys.map((key, index) => ({ value: `${index}`, label: t(`settings.days.${key}`) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  )

  return (
    <PanelScreen title={t('settings.tabs.knowledge')} subtitle={t('settings.knowledge.subtitle')}>
      <Section title={t('settings.knowledge.dailyTitle')}>
        <Select<string>
          label={t('settings.knowledge.dailyHour')}
          value={`${dailyHour}`}
          options={hourOptions}
          onChange={(value) => setConfigValue('compactionDailyHour', Number(value))}
        />
      </Section>
      <Section title={t('settings.knowledge.weeklyTitle')}>
        <Select<string>
          label={t('settings.knowledge.weeklyDay')}
          value={`${weeklyDay}`}
          options={dayOptions}
          onChange={(value) => setConfigValue('compactionWeeklyDay', Number(value))}
        />
        <Select<string>
          label={t('settings.knowledge.weeklyHour')}
          value={`${weeklyHour}`}
          options={hourOptions}
          onChange={(value) => setConfigValue('compactionWeeklyHour', Number(value))}
        />
      </Section>
      {/* Absent entirely until a job has actually run — same as the desktop. */}
      {runs.daily ? <LastRunCard kind="daily" record={runs.daily} locale={locale} /> : null}
      {runs.weekly ? <LastRunCard kind="weekly" record={runs.weekly} locale={locale} /> : null}
    </PanelScreen>
  )
}

// ── Last-run cards ───────────────────────────────────────────────────

/**
 * The desktop's `<code>` chip: a bordered mono capsule on the page ground.
 * Flat `bg-bg`/`border-border` rather than the desktop's /60 and /40 — RN
 * cannot alpha-compose a var() color, and such a class silently drops (see
 * global.css, where --color-border-soft exists for exactly this reason).
 */
function Chip({ children }: { children: string }): React.JSX.Element {
  return (
    <View className="bg-bg border-border self-start rounded-lg border px-2.5 py-1">
      {/* No forced direction or alignment: a chip holds either a localized
          sentence ("استغرق ١٤ث") or a bare model id, and RN's default `auto`
          resolves each from its own first strong character — the desktop's
          bidi behaviour. Forcing ltr drags the Arabic leading number to the
          wrong end of the capsule. */}
      <Text selectable className="text-muted font-mono text-[11px]">
        {children}
      </Text>
    </View>
  )
}

function LastRunCard({
  kind,
  record,
  locale
}: {
  kind: 'daily' | 'weekly'
  record: CompactionRunRecord
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Section className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-shrink flex-row items-center gap-2">
          <Activity04Icon size={16} className="text-muted" />
          <Text
            numberOfLines={1}
            className="text-fg font-sans-medium flex-shrink text-left text-sm"
          >
            {t(`settings.knowledge.lastRun.${kind}Title`)}
          </Text>
        </View>
        <Chip>
          {t('settings.knowledge.lastRun.ranAt', { time: formatRanAt(record.at, locale) })}
        </Chip>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {record.model ? <Chip>{record.model}</Chip> : null}
        <Chip>
          {t('settings.knowledge.lastRun.took', {
            duration: formatDuration(record.durationMs, locale)
          })}
        </Chip>
        {record.inputTokens !== null && record.outputTokens !== null ? (
          <Chip>
            {t('settings.knowledge.lastRun.tokens', {
              input: formatTokens(record.inputTokens, locale),
              output: formatTokens(record.outputTokens, locale)
            })}
          </Chip>
        ) : null}
      </View>
      {/* Scrolls in place rather than stretching the panel — the desktop's
          max-h-64 overflow-auto block, in the app's own code-block tones. */}
      <ScrollView className="bg-bg border-border max-h-64 rounded-lg border" nestedScrollEnabled>
        {/* Alignment left to RN's `auto`, the desktop's `dir="auto"`: an
            English summary reads flush-left even while the panel is RTL. */}
        <Text selectable className="text-fg p-3 font-mono text-[11px] leading-4">
          {record.output}
        </Text>
      </ScrollView>
    </Section>
  )
}

// ── Formatting ───────────────────────────────────────────────────────

/** "Jul 26, 04:20" — the desktop card's timestamp, month/day + time. */
function formatRanAt(at: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(at))
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ')
  }
}

/**
 * Seconds under 90, minutes beyond — the desktop's split, so a 14s daily run
 * and a 3.2min one read at the granularity each deserves.
 *
 * Rounded BEFORE formatting: Hermes honours `style: 'unit'` but ignores
 * `maximumFractionDigits`, so leaving the precision to the formatter renders a
 * 14041ms run as "14.041s". The unit suffix is then checked rather than
 * assumed, falling back to the plain `s`/`m` the chat cards use.
 */
function formatDuration(ms: number, locale: string): string {
  const seconds = ms / 1000
  const asMinutes = seconds >= 90
  const digits = asMinutes || seconds < 10 ? 1 : 0
  const value = Number((asMinutes ? seconds / 60 : seconds).toFixed(digits))
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: asMinutes ? 'minute' : 'second',
      maximumFractionDigits: digits
    }).format(value)
    if (/[^\d\s.,٠-٩٫٬]/.test(formatted)) return formatted
  } catch {
    // Falls through to the plain form below.
  }
  return `${value.toFixed(digits)}${asMinutes ? 'm' : 's'}`
}
