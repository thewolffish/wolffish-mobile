import type { TFunction } from 'i18next'

/**
 * Compact relative time ("5m", "3h", "2d") from the localized units strings.
 * Hermes ships without Intl.RelativeTimeFormat (unlike the desktop's
 * Electron), so this is string-table based — and the short form suits the
 * mobile rows better anyway.
 */
export function formatRelativeTime(timestamp: number, t: TFunction): string {
  const deltaMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return t('units.now')
  if (minutes < 60) return t('units.minutes', { value: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('units.hours', { value: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('units.days', { value: days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('units.months', { value: months })
  return t('units.years', { value: Math.floor(months / 12) })
}
