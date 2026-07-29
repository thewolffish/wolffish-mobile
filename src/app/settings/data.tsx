import { Button } from '@/components/core/Button'
import { InfoRow, PanelScreen, Section } from '@/components/settings/SettingsUI'
import { countConversations } from '@/lib/conversations/repo'
import {
  DEFAULT_CACHE_BUDGET_BYTES,
  enforceCacheBudget,
  getCacheUsage,
  type CacheUsage
} from '@/lib/files/fileCache'
import { useToast } from '@/providers/toast/useToast'
import { useTokens } from '@/providers/theme/useTheme'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator } from 'react-native'

/**
 * Data — the desktop DataPanel adapted to what lives on the phone: media
 * cache size against the 10 GB release threshold, conversation count, and a
 * release-now action that prunes the cache (files re-download on next open).
 */

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export default function DataScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const tokens = useTokens()
  const [releasing, setReleasing] = useState(false)

  const { data } = useQuery<{ cache: CacheUsage; conversations: number }>({
    queryKey: ['data-usage'],
    queryFn: async () => ({
      cache: await getCacheUsage(),
      conversations: await countConversations()
    }),
    staleTime: 10_000
  })

  const release = async (): Promise<void> => {
    setReleasing(true)
    try {
      const removed = await enforceCacheBudget(0)
      toast.show({ tone: 'success', message: t('settings.data.released', { count: removed }) })
      void queryClient.invalidateQueries({ queryKey: ['data-usage'] })
    } finally {
      setReleasing(false)
    }
  }

  if (!data) {
    return (
      <PanelScreen title={t('settings.tabs.data')}>
        <ActivityIndicator />
      </PanelScreen>
    )
  }

  return (
    <PanelScreen title={t('settings.tabs.data')} subtitle={t('settings.data.subtitle')}>
      <Section title={t('settings.data.storageTitle')}>
        <InfoRow
          label={t('settings.data.cachedMedia')}
          value={formatBytes(data.cache.totalBytes)}
        />
        <InfoRow label={t('settings.data.cachedFiles')} value={`${data.cache.fileCount}`} />
        <InfoRow
          label={t('settings.data.budget')}
          value={formatBytes(DEFAULT_CACHE_BUDGET_BYTES)}
        />
        <InfoRow label={t('settings.data.conversations')} value={`${data.conversations}`} />
      </Section>
      <Section title={t('settings.data.releaseTitle')}>
        {/* The label never swaps for a loading string — the spinner carries the
            busy state so the button keeps its identity mid-action. */}
        <Button variant="outline" disabled={releasing} onPress={() => void release()}>
          {releasing && <ActivityIndicator size="small" color={tokens.fg} />}
          {t('settings.data.releaseNow')}
        </Button>
      </Section>
    </PanelScreen>
  )
}
