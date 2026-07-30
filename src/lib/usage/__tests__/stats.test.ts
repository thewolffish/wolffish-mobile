import {
  BRAVE_COST_PER_QUERY,
  computeUsageStats,
  computeUsageSummary,
  dailyTokens,
  dayDetails,
  ledgerYears,
  longestConsecutiveStreak,
  rangeCutoff,
  rangeCutoffMs,
  USAGE_PROVIDERS,
  type UsageDay
} from '@/lib/usage/stats'

/**
 * These pin the mobile aggregation to the desktop's usage.ts semantics: the
 * folded per-day rows must answer every range exactly as the per-line ledger
 * cache does. A drift here is silent — both screens render plausible numbers,
 * they just stop being the same numbers.
 */

const NOW = new Date(2026, 6, 30, 14, 30) // 2026-07-30, local

function llm(
  date: string,
  rows: Array<[string, string, number, number, number, number]>,
  braveQueries = 0
): UsageDay {
  return {
    date,
    models: rows.map(([provider, model, inputTokens, outputTokens, cost, entries]) => ({
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      entries
    })),
    braveQueries
  }
}

const DAYS: UsageDay[] = [
  llm('2025-12-31', [['anthropic', 'claude-opus-4-5', 100, 50, 1, 1]]),
  llm('2026-06-28', [['anthropic', 'claude-opus-4-8', 1000, 500, 2, 3]], 4),
  llm('2026-06-29', [
    ['anthropic', 'claude-opus-4-8', 200, 100, 0.5, 1],
    ['deepseek', 'deepseek-v4-pro', 400, 200, 0.1, 2]
  ]),
  // A gap (06-30), then a brave-only day: paid, but never "active".
  llm('2026-07-01', [], 10),
  llm('2026-07-29', [['anthropic', 'claude-opus-4-8', 300, 300, 3, 1]]),
  llm('2026-07-30', [['deepseek', 'deepseek-v4-pro', 50, 25, 0.05, 1]])
]

describe('rangeCutoff', () => {
  it('lands every range on its desktop midnight', () => {
    expect(rangeCutoff('today', NOW)).toBe('2026-07-30')
    expect(rangeCutoff('this_month', NOW)).toBe('2026-07-01')
    expect(rangeCutoff('3_months', NOW)).toBe('2026-04-01')
    expect(rangeCutoff('6_months', NOW)).toBe('2026-01-01')
    expect(rangeCutoff('ytd', NOW)).toBe('2026-01-01')
    expect(rangeCutoff('all_time', NOW)).toBe('0000-00-00')
  })

  it('mirrors the ms cutoffs used for the conversations COUNT', () => {
    expect(rangeCutoffMs('today', NOW)).toBe(new Date(2026, 6, 30).getTime())
    expect(rangeCutoffMs('ytd', NOW)).toBe(new Date(2026, 0, 1).getTime())
    expect(rangeCutoffMs('all_time', NOW)).toBe(0)
  })
})

describe('computeUsageStats', () => {
  it('aggregates all_time exactly', () => {
    const stats = computeUsageStats(DAYS, 'all_time', NOW)
    expect(stats.messages).toBe(9)
    expect(stats.totalTokens).toBe(100 + 50 + 1500 + 300 + 600 + 600 + 75)
    expect(stats.activeDays).toBe(5) // brave-only day is not active
    expect(stats.longestStreak).toBe(2) // 06-28, 06-29
    expect(stats.favouriteModel).toBe('claude-opus-4-8') // 5 entries vs 3
    expect(stats.totalCost).toBeCloseTo(1 + 2 + 0.6 + 3 + 0.05 + 14 * BRAVE_COST_PER_QUERY)
  })

  it('prices brave into totalCost and topSpendDay but not activeDays', () => {
    const stats = computeUsageStats(DAYS, 'this_month', NOW)
    expect(stats.activeDays).toBe(2) // 07-29, 07-30
    expect(stats.messages).toBe(2)
    expect(stats.totalCost).toBeCloseTo(3 + 0.05 + 10 * BRAVE_COST_PER_QUERY)
    expect(stats.topSpendDay).toEqual({ date: '2026-07-29', cost: 3 })
  })

  it('today keeps only today', () => {
    const stats = computeUsageStats(DAYS, 'today', NOW)
    expect(stats.messages).toBe(1)
    expect(stats.totalTokens).toBe(75)
    expect(stats.favouriteModel).toBe('deepseek-v4-pro')
    expect(stats.topSpendDay).toEqual({ date: '2026-07-30', cost: 0.05 })
  })

  it('is empty-safe', () => {
    const stats = computeUsageStats([], 'all_time', NOW)
    expect(stats).toEqual({
      messages: 0,
      activeDays: 0,
      longestStreak: 0,
      totalTokens: 0,
      favouriteModel: null,
      totalCost: 0,
      topSpendDay: null
    })
  })
})

describe('computeUsageSummary', () => {
  it('zero-fills the full desktop roster in order', () => {
    const summary = computeUsageSummary([], 'all_time', NOW)
    expect(summary.providers.map((p) => p.provider)).toEqual([...USAGE_PROVIDERS])
    expect(summary.providers.every((p) => p.totalCost === 0 && p.models.length === 0)).toBe(true)
    expect(summary.brave).toEqual({ totalQueries: 0, totalCost: 0 })
  })

  it('folds models per provider within the range', () => {
    const summary = computeUsageSummary(DAYS, 'ytd', NOW)
    const anthropic = summary.providers.find((p) => p.provider === 'anthropic')
    expect(anthropic?.totalInputTokens).toBe(1500)
    expect(anthropic?.totalOutputTokens).toBe(900)
    expect(anthropic?.models).toEqual([
      { model: 'claude-opus-4-8', inputTokens: 1500, outputTokens: 900, cost: 5.5 }
    ])
    const deepseek = summary.providers.find((p) => p.provider === 'deepseek')
    expect(deepseek?.models[0]).toEqual({
      model: 'deepseek-v4-pro',
      inputTokens: 450,
      outputTokens: 225,
      cost: 0.15000000000000002
    })
    expect(summary.brave.totalQueries).toBe(14)
    expect(summary.brave.totalCost).toBeCloseTo(14 * BRAVE_COST_PER_QUERY)
  })
})

describe('dailyTokens', () => {
  it('keeps only the asked year, LLM tokens only', () => {
    const daily = dailyTokens(DAYS, 2026)
    expect(daily.get('2026-06-28')).toBe(1500)
    expect(daily.get('2026-07-01')).toBeUndefined() // brave-only: no tokens
    expect(daily.has('2025-12-31')).toBe(false)
  })
})

describe('dayDetails', () => {
  it('totals one day including brave fees', () => {
    const details = dayDetails(DAYS, '2026-06-28')
    expect(details.totalTokens).toBe(1500)
    expect(details.messages).toBe(3)
    expect(details.braveQueries).toBe(4)
    expect(details.cost).toBeCloseTo(2 + 4 * BRAVE_COST_PER_QUERY)
  })

  it('answers an unknown day with zeros', () => {
    const details = dayDetails(DAYS, '2026-01-15')
    expect(details).toEqual({
      date: '2026-01-15',
      totalTokens: 0,
      cost: 0,
      messages: 0,
      braveQueries: 0,
      models: []
    })
  })
})

describe('longestConsecutiveStreak', () => {
  it('spans month boundaries and ignores duplicates', () => {
    expect(longestConsecutiveStreak(['2026-06-30', '2026-07-01', '2026-07-02'])).toBe(3)
    expect(longestConsecutiveStreak(['2026-07-01', '2026-07-01'])).toBe(1)
    expect(longestConsecutiveStreak([])).toBe(0)
  })
})

describe('ledgerYears', () => {
  it('always includes the current year, ascending', () => {
    expect(ledgerYears(DAYS, NOW)).toEqual([2025, 2026])
    expect(ledgerYears([], NOW)).toEqual([2026])
  })
})
