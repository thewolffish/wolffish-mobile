import type { SupportedLocale } from '@/lib/i18n'
import type { ThemeSource } from '@/providers/theme/useTheme'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * Client-state store — the app-slice counterpart to the TanStack Query
 * server cache. Small, synchronous, selector-based (components re-render
 * only for the slices they read), persisted to the device. Server data
 * (conversations, messages, media) does NOT belong here — that lives in the
 * persisted query cache.
 */
export type AppState = {
  theme: ThemeSource
  /** null until the user picks one — the device language is used instead. */
  locale: SupportedLocale | null
  setTheme: (theme: ThemeSource) => void
  setLocale: (locale: SupportedLocale) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      locale: null,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale })
    }),
    {
      name: 'wolffish.app',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => ({ theme: state.theme, locale: state.locale })
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
