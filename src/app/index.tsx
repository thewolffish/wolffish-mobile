import { BuildInfo } from '@/components/common/build-info/BuildInfo'
import { Button } from '@/components/core/Button'
import { applyConfigSnapshot, importDemoData } from '@/lib/demo/importer'
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
 * Entering demo mode ingests the pushed demo dataset once (165 unique
 * conversations from three months of real desktop usage), then opens chat.
 * The desktop-pairing flow will slot in beside the demo button later.
 */
export default function Home(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const demoImported = useAppStore((state) => state.demoImported)
  const setDemoImported = useAppStore((state) => state.setDemoImported)
  const setDemoMode = useAppStore((state) => state.setDemoMode)
  const [importing, setImporting] = useState(false)

  const enterDemo = async (): Promise<void> => {
    if (importing) return
    if (!demoImported) {
      setImporting(true)
      try {
        const result = await importDemoData()
        if (result.skipped) {
          toast.show({ tone: 'warning', message: t('demo.missing') })
          return
        }
        setDemoImported(true)
        invalidateConversationList()
        toast.show({ tone: 'success', message: t('demo.imported', { count: result.imported }) })
      } finally {
        setImporting(false)
      }
    }
    // Refresh the config surface from the snapshot on every entry — the
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
        <Button size="lg" disabled={importing} onPress={() => void enterDemo()} className="mt-4 self-center">
          {importing && <ActivityIndicator size="small" color={tokens.primaryFg} />}
          {importing ? t('demo.importing') : t('home.demoMode')}
        </Button>
        <Text className="text-muted max-w-64 text-center font-sans text-xs leading-5">
          {t('home.demoHint')}
        </Text>
      </View>

      <View className="items-center">
        <BuildInfo />
      </View>
    </View>
  )
}
