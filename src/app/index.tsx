import { BuildInfo } from '@/components/common/build-info/BuildInfo'
import { Button } from '@/components/core/Button'
import { ProgressBar } from '@/components/core/ProgressBar'
import {
  applyConfigSnapshot,
  fetchDemoManifest,
  importDemoData,
  type DemoProgress
} from '@/lib/demo/importer'
import { useAppStore } from '@/state/appStore'
import { useToast } from '@/providers/toast/useToast'
import { useTokens } from '@/providers/theme/useTheme'
import { invalidateConversationList } from '@/lib/conversations/hooks'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Home — deliberately blank: the fish, the name, and the Demo Mode door.
 * The first tap downloads the demo dataset from cdn.wolffi.sh (169 unique
 * conversations from three months of real desktop usage) and ingests it, under
 * a progress bar; every later tap opens straight into chat. The
 * desktop-pairing flow will slot in beside the demo button later.
 */
export default function Home(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const demoVersion = useAppStore((state) => state.demoVersion)
  const setDemoVersion = useAppStore((state) => state.setDemoVersion)
  const setDemoMode = useAppStore((state) => state.setDemoMode)
  const [progress, setProgress] = useState<DemoProgress | null>(null)
  const busy = progress !== null

  /**
   * Is there a dataset to pull? Nothing imported yet, or the published bundle
   * is a different build than the one on this device. Offline, or a manifest
   * that will not load, answers no — demo mode still opens on what is stored.
   */
  const needsImport = async (): Promise<boolean> => {
    if (!demoVersion) return true
    try {
      const manifest = await fetchDemoManifest()
      return manifest.version !== demoVersion
    } catch {
      return false
    }
  }

  const enterDemo = async (): Promise<void> => {
    if (busy) return
    setProgress({ phase: 'download', ratio: 0, imported: 0, total: 0 })
    if (await needsImport()) {
      try {
        const result = await importDemoData(setProgress)
        setDemoVersion(result.version)
        invalidateConversationList()
        toast.show({ tone: 'success', message: t('demo.imported', { count: result.imported }) })
      } catch {
        // Offline, or the bundle is mid-publish. Nothing is marked imported,
        // so the next tap starts over; already-inserted conversations upsert.
        toast.show({ tone: 'error', message: t('demo.failed') })
        return
      } finally {
        setProgress(null)
      }
    } else {
      setProgress(null)
    }
    // Refresh the config surface from the saved snapshot on every entry — the
    // demo's stand-in for live sync's cached-then-refresh.
    void applyConfigSnapshot()
    setDemoMode(true)
    router.push('/chat')
  }

  return (
    <View
      className="bg-bg flex-1 px-8"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-1 items-center justify-center gap-4">
        <Image
          source={require('../../assets/images/icon-trans.png')}
          style={{ width: 96, height: 96 }}
          contentFit="contain"
        />
        <Text className="text-fg font-sans-bold text-center text-3xl">{t('app.name')}</Text>
        <Text className="text-muted text-center font-sans text-sm leading-relaxed">
          {t('app.tagline')}
        </Text>
        <Button
          size="lg"
          disabled={busy}
          onPress={() => void enterDemo()}
          className="mt-4 self-center"
        >
          {busy && <ActivityIndicator size="small" color={tokens.primaryFg} />}
          {busy ? t('demo.importing') : t('home.demoMode')}
        </Button>

        {/* Progress takes the hint's slot rather than pushing it around. */}
        {progress ? (
          <View className="w-64 items-center gap-2">
            <ProgressBar value={progress.ratio} />
            <Text className="text-muted text-center font-sans text-xs leading-5">
              {progress.phase === 'download'
                ? t('demo.downloading')
                : progress.phase === 'reset'
                  ? t('demo.resetting')
                  : progress.total === 0
                    ? t('demo.downloading')
                    : t('demo.progress', { done: progress.imported, total: progress.total })}
            </Text>
          </View>
        ) : (
          <Text className="text-muted max-w-64 text-center font-sans text-xs leading-5">
            {t('home.demoHint')}
          </Text>
        )}
      </View>

      <View className="items-center">
        <BuildInfo />
      </View>
    </View>
  )
}
