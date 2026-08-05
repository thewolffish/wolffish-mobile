import { BuildInfo } from '@/components/common/build-info/BuildInfo'
import { Button } from '@/components/core/Button'
import { ProgressBar } from '@/components/core/ProgressBar'
import {
  applyConfigSnapshot,
  fetchDemoManifest,
  importDemoData,
  type DemoProgress
} from '@/lib/demo/importer'
import { purgeDemoState } from '@/lib/demo/reset'
import { attachLiveUpdates, initialSync, type SyncProgress } from '@/lib/sync/sync'
import { attachTurnStream } from '@/lib/sync/prompt'
import { tunnelClient } from '@/lib/tunnel/client'
import { useAppStore } from '@/state/appStore'
import { useToast } from '@/providers/toast/useToast'
import { useTokens } from '@/providers/theme/useTheme'
import { invalidateConversationList } from '@/lib/conversations/cache'
import { Image } from 'expo-image'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
/**
 * Loaded on demand. The sheet pulls in expo-camera, and a static import would
 * bind that native module while the home screen mounts — so a JS bundle
 * running against a binary built before the camera landed would take the whole
 * app down at launch instead of simply failing to scan.
 */
const PairSheet = lazy(async () => ({
  default: (await import('@/components/pairing/PairSheet')).PairSheet
}))

/**
 * Home — the fish, the name, and the two doors in: pair with a desktop, or
 * take the demo tour.
 *
 * Pairing is the primary path and demo mode stays exactly what it was: an
 * independent, self-contained tour that works with no desktop, no account and
 * no network beyond the CDN. Disconnecting a desktop returns the app here with
 * demo mode still one tap away, which is why nothing in this screen couples
 * the two.
 */
export default function Home(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const demoVersion = useAppStore((state) => state.demoVersion)
  const setDemoVersion = useAppStore((state) => state.setDemoVersion)
  const setDemoMode = useAppStore((state) => state.setDemoMode)
  const setPaired = useAppStore((state) => state.setPaired)
  const paired = useAppStore((state) => state.paired)
  const params = useLocalSearchParams<{ stay?: string }>()
  const [progress, setProgress] = useState<DemoProgress | null>(null)
  const [sync, setSync] = useState<SyncProgress | null>(null)
  const [pairing, setPairing] = useState(false)
  const busy = progress !== null || sync !== null

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
    // replace, not push: this door is not somewhere to come back to. A back
    // gesture from chat would otherwise land on the entry screen, where the
    // next tap can drop a live connection by accident.
    router.replace('/chat')
  }

  /**
   * Runs once the sheet has handed us a live tunnel: pull everything the app
   * renders, under the same progress bar the demo import uses, then open chat
   * against real data.
   */
  const afterPaired = async (): Promise<void> => {
    setPairing(false)
    setSync({ phase: 'connect', ratio: 0, imported: 0, total: 0 })
    try {
      // A pairing starts from a clean slate. Demo leftovers are not inert
      // here: demo conversations linger in the list until a reconcile prunes
      // them, and — worse — demo media cached under workspace-relative paths
      // reads as a valid cache hit for a real file at the same path, which is
      // how a paired phone can show a sample PDF against a real conversation.
      // Demo mode loses nothing it cannot rebuild: the next demo entry
      // re-imports the bundle exactly as a fresh install would.
      await purgeDemoState()
      const result = await initialSync(setSync)
      attachLiveUpdates()
      attachTurnStream()
      setDemoMode(false)
      setPaired(true)
      toast.show({
        tone: 'success',
        message: t('pair.synced', { count: result.conversations })
      })
      router.replace('/chat')
    } catch {
      // The pairing itself survives a failed first sync — the Relay screen can
      // retry it without scanning again.
      toast.show({ tone: 'error', message: t('pair.syncFailed') })
    } finally {
      setSync(null)
    }
  }

  const statusLine = ((): string | null => {
    if (sync) {
      if (sync.phase === 'connect') return t('pair.syncing.connect')
      if (sync.phase === 'config') return t('pair.syncing.config')
      if (sync.phase === 'usage') return t('pair.syncing.usage')
      return sync.total === 0
        ? t('pair.syncing.conversations')
        : t('demo.progress', { done: sync.imported, total: sync.total })
    }
    if (progress) {
      if (progress.phase === 'download') return t('demo.downloading')
      if (progress.phase === 'reset') return t('demo.resetting')
      return progress.total === 0
        ? t('demo.downloading')
        : t('demo.progress', { done: progress.imported, total: progress.total })
    }
    return null
  })()

  // A paired phone has somewhere to be. This screen exists to make a
  // connection, and both of its controls can end the one that already exists
  // — so it is the wrong place to land on every launch. `stay` is how the
  // Relay screen reaches it deliberately, since the redirect would otherwise
  // make it unreachable.
  if (paired && params.stay !== '1') return <Redirect href="/chat?boot=1" />

  return (
    <View
      className="bg-bg flex-1 px-8"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-1 items-center justify-center gap-4">
        <Image
          source={require('@/assets/images/icon-trans.png')}
          style={{ width: 96, height: 96 }}
          contentFit="contain"
        />
        <Text className="text-fg font-sans-bold text-center text-3xl">{t('app.name')}</Text>
        <Text className="text-muted text-center font-sans text-sm leading-relaxed">
          {t('app.tagline')}
        </Text>

        {/* Already paired: the primary action is to carry on into the app.
            Re-pairing is still reachable, but demoted — reaching for it by
            reflex is how a working connection gets replaced by accident. */}
        <Button
          size="lg"
          disabled={busy}
          onPress={() => (paired ? router.replace('/chat') : setPairing(true))}
          className="mt-4 self-center"
        >
          {sync !== null && <ActivityIndicator size="small" color={tokens.primaryFg} />}
          {sync !== null ? t('pair.connecting') : paired ? t('home.continue') : t('pair.connect')}
        </Button>

        {/* The secondary door. Unpaired that is demo mode — the only way in
            without a desktop. Paired it is re-pairing, since demo mode would
            mean tearing down the connection this screen is guarding. */}
        <Pressable
          disabled={busy}
          onPress={() => (paired ? setPairing(true) : void enterDemo())}
          className="py-1"
        >
          <Text className="text-muted font-sans text-sm underline">
            {paired
              ? t('home.connectOther')
              : progress !== null
                ? t('demo.importing')
                : t('home.demoMode')}
          </Text>
        </Pressable>

        {/* Progress takes the hint's slot rather than pushing it around. */}
        {statusLine ? (
          <View className="w-64 items-center gap-2">
            <ProgressBar value={sync?.ratio ?? progress?.ratio ?? 0} />
            <Text className="text-muted text-center font-sans text-xs leading-5">{statusLine}</Text>
          </View>
        ) : (
          <Text className="text-muted max-w-64 text-center font-sans text-xs leading-5">
            {t('pair.hint')}
          </Text>
        )}
      </View>

      <View className="items-center">
        <BuildInfo />
      </View>

      {pairing && (
        <Suspense fallback={null}>
          <PairSheet
            visible={pairing}
            onClose={() => setPairing(false)}
            onPaired={() => void afterPaired()}
          />
        </Suspense>
      )}
    </View>
  )
}

/** Reconnect a stored pairing at launch, before the user touches anything. */
export async function resumePairing(): Promise<boolean> {
  const resumed = await tunnelClient.resume()
  if (resumed) attachLiveUpdates()
  return resumed
}
