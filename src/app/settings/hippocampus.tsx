import { Select, type SelectOption } from '@/components/core/Select'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { setConfigValue, useConfigValue } from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Hippocampus — the desktop CompactionPanel: when the daily compaction and
 * weekly consolidation run. Editable hours/day; local in demo mode.
 */
export default function HippocampusScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const dailyHour = useConfigValue('compactionDailyHour')
  const weeklyDay = useConfigValue('compactionWeeklyDay')
  const weeklyHour = useConfigValue('compactionWeeklyHour')

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
    <PanelScreen
      title={t('settings.tabs.hippocampus')}
      subtitle={t('settings.hippocampus.subtitle')}
    >
      <Section title={t('settings.hippocampus.dailyTitle')}>
        <Select<string>
          label={t('settings.hippocampus.dailyHour')}
          value={`${dailyHour}`}
          options={hourOptions}
          onChange={(value) => setConfigValue('compactionDailyHour', Number(value))}
        />
      </Section>
      <Section title={t('settings.hippocampus.weeklyTitle')}>
        <Select<string>
          label={t('settings.hippocampus.weeklyDay')}
          value={`${weeklyDay}`}
          options={dayOptions}
          onChange={(value) => setConfigValue('compactionWeeklyDay', Number(value))}
        />
        <Select<string>
          label={t('settings.hippocampus.weeklyHour')}
          value={`${weeklyHour}`}
          options={hourOptions}
          onChange={(value) => setConfigValue('compactionWeeklyHour', Number(value))}
        />
      </Section>
    </PanelScreen>
  )
}
