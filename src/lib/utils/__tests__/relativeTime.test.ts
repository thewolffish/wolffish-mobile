import { formatRelativeTime } from '@/lib/utils/relativeTime'
import type { TFunction } from 'i18next'

// Fake t that renders like the en units table.
const t = ((key: string, options?: { value?: number }) => {
  const table: Record<string, string> = {
    'units.now': 'now',
    'units.minutes': `${options?.value}m`,
    'units.hours': `${options?.value}h`,
    'units.days': `${options?.value}d`,
    'units.months': `${options?.value}mo`,
    'units.years': `${options?.value}y`
  }
  return table[key] ?? key
}) as TFunction

describe('formatRelativeTime', () => {
  const NOW = Date.now()

  it('renders "now" under a minute', () => {
    expect(formatRelativeTime(NOW - 10_000, t)).toBe('now')
  })

  it('renders minutes, hours, days, months, years', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, t)).toBe('5m')
    expect(formatRelativeTime(NOW - 3 * 3_600_000, t)).toBe('3h')
    expect(formatRelativeTime(NOW - 2 * 86_400_000, t)).toBe('2d')
    expect(formatRelativeTime(NOW - 65 * 86_400_000, t)).toBe('2mo')
    expect(formatRelativeTime(NOW - 400 * 86_400_000, t)).toBe('1y')
  })

  it('clamps future timestamps to "now"', () => {
    expect(formatRelativeTime(NOW + 60_000, t)).toBe('now')
  })
})
