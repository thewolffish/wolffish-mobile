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
  /** True once the demo dataset has been ingested into SQLite. */
  demoImported: boolean
  /**
   * Verbose feed — mirrors the desktop's inapp.verbose: show tool cards and
   * model chips (on) vs a clean feed of replies and delivered files (off).
   */
  verboseFeed: boolean
  setTheme: (theme: ThemeSource) => void
  setLocale: (locale: SupportedLocale) => void
  setDemoMode: (demoMode: boolean) => void
  setDemoImported: (demoImported: boolean) => void
  setVerboseFeed: (verboseFeed: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      locale: null,
      demoMode: false,
      demoImported: false,
      verboseFeed: false,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setDemoMode: (demoMode) => set({ demoMode }),
      setDemoImported: (demoImported) => set({ demoImported }),
      setVerboseFeed: (verboseFeed) => set({ verboseFeed })
    }),
    {
      name: 'wolffish.app',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persisted) => persisted as AppState,
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        demoMode: state.demoMode,
        demoImported: state.demoImported,
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
