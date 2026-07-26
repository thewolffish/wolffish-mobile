import type { SupportedLocale } from '@/lib/i18n'
import type { ThemeSource } from '@/providers/theme/useTheme'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * Client-state store — the app-slice counterpart to the TanStack Query
 * server cache. Small, synchronous, selector-based (components re-render
 * only for the slices they read), persisted to the device. Server data
 * (conversations, messages, media) does NOT belong here — that lives in
 * SQLite behind the query layer (lib/conversations).
 */
export type AppState = {
  theme: ThemeSource
  /** null until the user picks one — the device language is used instead. */
  locale: SupportedLocale | null
  /** Demo mode: the app runs against the imported demo dataset. */
  demoMode: boolean
  /**
   * Version of the demo bundle ingested into SQLite, null before the first
   * import. Holding the version rather than a boolean means a republished
   * dataset is distinguishable from an imported one when that check lands.
   */
  demoVersion: string | null
  /**
   * Verbose feed — mirrors the desktop's inapp.verbose: show tool cards and
   * model chips (on) vs a clean feed of replies and delivered files (off).
   */
  verboseFeed: boolean
  setTheme: (theme: ThemeSource) => void
  setLocale: (locale: SupportedLocale) => void
  setDemoMode: (demoMode: boolean) => void
  setDemoVersion: (demoVersion: string | null) => void
  setVerboseFeed: (verboseFeed: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      locale: null,
      demoMode: false,
      demoVersion: null,
      verboseFeed: false,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setDemoMode: (demoMode) => set({ demoMode }),
      setDemoVersion: (demoVersion) => set({ demoVersion }),
      setVerboseFeed: (verboseFeed) => set({ verboseFeed })
    }),
    {
      name: 'wolffish.app',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      // v3 replaced the demoImported boolean with the imported bundle's
      // version. The old flag meant "the dataset was pushed to this device",
      // which no device off the App Store could ever have been — dropping it
      // sends every install through the one download it always needed.
      migrate: (persisted) => {
        const { demoImported: _demoImported, ...rest } = (persisted ?? {}) as AppState & {
          demoImported?: boolean
        }
        return { ...rest, demoVersion: null } as AppState
      },
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        demoMode: state.demoMode,
        demoVersion: state.demoVersion,
        verboseFeed: state.verboseFeed
      })
    }
  )
)

/** Resolves once the persisted state has been restored from disk. */
export function whenHydrated(): Promise<void> {
  if (useAppStore.persist.hasHydrated()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsub = useAppStore.persist.onFinishHydration(() => {
      unsub()
      resolve()
    })
  })
}
