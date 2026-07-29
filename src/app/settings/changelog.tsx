import { MarkdownView } from '@/components/chat/MarkdownView'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { CHANGELOG_MONTHS, formatChangelogMonth, readChangelog } from '@/lib/changelog'
import { cn } from '@/lib/utils/cn'
import { useLocale } from '@/providers/locale/useLocale'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, Text, View } from 'react-native'

/**
 * What's new — the desktop's Changelog page on one column. Same source
 * material (src/changelog/<month>/<locale>.md, read through lib/changelog),
 * same month-by-month navigation, reduced to a chip row because a phone has
 * no room for the desktop's sidebar. The notes are bundled with the app, so
 * this page works on a plane.
 */
export default function ChangelogScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const [month, setMonth] = useState(CHANGELOG_MONTHS[0] ?? null)
  // Loading is its own flag rather than a null body: an unreadable page is
  // also null, and would otherwise spin forever instead of saying so.
  const [page, setPage] = useState<{ text: string | null; loading: boolean }>({
    text: null,
    loading: true
  })

  useEffect(() => {
    if (!month) return
    let alive = true
    setPage({ text: null, loading: true })
    void readChangelog(month, locale).then((text) => {
      if (alive) setPage({ text, loading: false })
    })
    return () => {
      alive = false
    }
  }, [month, locale])

  return (
    <PanelScreen title={t('settings.changelog.title')} subtitle={t('settings.changelog.subtitle')}>
      {CHANGELOG_MONTHS.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {CHANGELOG_MONTHS.map((key) => {
            const active = key === month
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setMonth(key)}
                className={cn(
                  'border-border rounded-lg border px-3 py-1.5',
                  active ? 'bg-primary border-primary' : 'bg-surface active:bg-border/40'
                )}
              >
                <Text
                  className={cn(
                    'font-sans-medium text-xs',
                    active ? 'text-primary-fg' : 'text-muted'
                  )}
                >
                  {formatChangelogMonth(key, locale)}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}

      <Section>
        {month && page.loading ? (
          <View className="py-8">
            <Text className="text-muted text-center font-sans text-sm">{t('common.loading')}</Text>
          </View>
        ) : page.text ? (
          <MarkdownView>{page.text}</MarkdownView>
        ) : (
          <Text className="text-muted text-left font-sans text-sm">
            {t('settings.changelog.empty')}
          </Text>
        )}
      </Section>
    </PanelScreen>
  )
}
