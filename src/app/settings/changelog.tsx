import { MarkdownView } from '@/components/chat/MarkdownView'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import {
  CHANGELOG_MONTHS,
  formatChangelogMonth,
  readChangelog,
  readDesktopChangelog
} from '@/lib/changelog'
import { cn } from '@/lib/utils/cn'
import { useLocale } from '@/providers/locale/useLocale'
import { useDesktopChangelogMonths } from '@/state/demoConfig'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, Text, View } from 'react-native'

/**
 * What's new — release notes for both ends of the pairing, one screen.
 *
 * Two sources behind one chip row, mirroring the Updates screen's two cards:
 * THIS APP's notes are bundled with the binary (readChangelog — the page
 * works on a plane), the DESKTOP's are its own months synced in the config
 * snapshot with bodies fetched over the tunnel on open and rendered verbatim
 * (readDesktopChangelog). Each source keeps the desktop app's month-by-month
 * navigation, reduced to chips because a phone has no room for a sidebar.
 */

type Source = 'mobile' | 'desktop'

/** One chip in a row of choices — months, and the two sources. */
function Chip({
  label,
  active,
  onPress
}: {
  label: string
  active: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'border-border rounded-lg border px-3 py-1.5',
        active ? 'bg-primary border-primary' : 'bg-surface active:bg-border/40'
      )}
    >
      <Text className={cn('font-sans-medium text-xs', active ? 'text-primary-fg' : 'text-muted')}>
        {label}
      </Text>
    </Pressable>
  )
}

export default function ChangelogScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const desktopMonths = useDesktopChangelogMonths()
  const [source, setSource] = useState<Source>('mobile')
  const [month, setMonth] = useState<string | null>(CHANGELOG_MONTHS[0] ?? null)
  // Loading is its own flag rather than a null body: an unreadable page is
  // also null, and would otherwise spin forever instead of saying so.
  const [page, setPage] = useState<{ text: string | null; loading: boolean }>({
    text: null,
    loading: true
  })

  const months = source === 'desktop' ? desktopMonths : CHANGELOG_MONTHS
  // The chosen month, guarded against the list moving underneath it — a
  // snapshot refresh can drop or add desktop months while this screen is up.
  const activeMonth = month && months.includes(month) ? month : (months[0] ?? null)

  useEffect(() => {
    if (!activeMonth) {
      // Nothing to read (the desktop tab before any sync) — clear whatever
      // the other source rendered, or its text would sit under this tab.
      setPage({ text: null, loading: false })
      return
    }
    let alive = true
    setPage({ text: null, loading: true })
    const read = source === 'desktop' ? readDesktopChangelog : readChangelog
    void read(activeMonth, locale).then((text) => {
      if (alive) setPage({ text, loading: false })
    })
    return () => {
      alive = false
    }
  }, [source, activeMonth, locale])

  const switchSource = (next: Source): void => {
    if (next === source) return
    setSource(next)
    setMonth(next === 'desktop' ? (desktopMonths[0] ?? null) : (CHANGELOG_MONTHS[0] ?? null))
  }

  // The desktop tab's empty text doubles for both of its dead ends — no
  // months known yet (never synced) and a body the tunnel cannot serve right
  // now. Both resolve the same way: connect to the desktop.
  const emptyText =
    source === 'desktop' ? t('settings.changelog.desktopEmpty') : t('settings.changelog.empty')

  return (
    <PanelScreen title={t('settings.changelog.title')} subtitle={t('settings.changelog.subtitle')}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        <Chip
          label={t('settings.updates.thisAppTitle')}
          active={source === 'mobile'}
          onPress={() => switchSource('mobile')}
        />
        <Chip
          label={t('settings.updates.desktopTitle')}
          active={source === 'desktop'}
          onPress={() => switchSource('desktop')}
        />
      </ScrollView>

      {months.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {months.map((key) => (
            <Chip
              key={key}
              label={formatChangelogMonth(key, locale)}
              active={key === activeMonth}
              onPress={() => setMonth(key)}
            />
          ))}
        </ScrollView>
      ) : null}

      <Section>
        {activeMonth && page.loading ? (
          <View className="py-8">
            <Text className="text-muted text-center font-sans text-sm">{t('common.loading')}</Text>
          </View>
        ) : page.text ? (
          <MarkdownView>{page.text}</MarkdownView>
        ) : (
          <Text className="text-muted text-left font-sans text-sm">{emptyText}</Text>
        )}
      </Section>
    </PanelScreen>
  )
}
