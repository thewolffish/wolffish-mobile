/**
 * Usage ledger aggregation — the mobile mirror of the desktop's
 * main/runtime/usage.ts read path.
 *
 * The desktop derives every UsagePanel figure from per-turn ledger lines
 * (usage/providers/*.md). Those lines never leave the workspace; what travels
 * in the demo config snapshot is the same ledger pre-aggregated per
 * (day × provider × model), carried in demo/config-snapshot.json. Nothing is
 * lost in the fold: every desktop range cutoff is midnight-aligned, so
 * day-level rows answer the exact same queries the per-line cache does.
 * Everything here is pure and synchronous — the screen recomputes on the fly
 * from the rows the demo config store holds.
 */

/** One model's turns on one calendar day, summed. */
export type UsageModelDay = {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  /** Ledger lines folded into this row — the desktop's "messages" unit. */
  entries: number
}

/** One calendar day of the ledger. `date` is local-naive `YYYY-MM-DD`. */
export type UsageDay = {
  date: string
  models: UsageModelDay[]
  /** Brave Search queries that day — priced, but never counted as tokens. */
  braveQueries: number
}

export type UsageTimeRange = 'today' | 'this_month' | '3_months' | '6_months' | 'ytd' | 'all_time'

export const USAGE_TIME_RANGES: UsageTimeRange[] = [
  'today',
  'this_month',
  '3_months',
  '6_months',
  'ytd',
  'all_time'
]

/** Desktop usage.ts provider roster, in its card order. Zero-filled always. */
export const USAGE_PROVIDERS = [
  'local',
  'anthropic',
  'openai',
  'openrouter',
  'deepseek',
  'mimo',
  'kimi',
  'minimax',
  'xai',
  'qwen',
  'stepfun',
  'zai'
] as const

export type UsageProviderId = (typeof USAGE_PROVIDERS)[number]

/** Desktop usage.ts BRAVE_COST_PER_QUERY. */
export const BRAVE_COST_PER_QUERY = 0.005

export type UsageStats = {
  /** Ledger entries in range — the desktop's definition of "messages". */
  messages: number
  activeDays: number
  longestStreak: number
  totalTokens: number
  favouriteModel: string | null
  /** LLM spend plus Brave query fees, matching the sum of the provider cards. */
  totalCost: number
  topSpendDay: { date: string; cost: number } | null
}

export type UsageProviderSummary = {
  provider: UsageProviderId
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  models: Array<{ model: string; inputTokens: number; outputTokens: number; cost: number }>
}

export type UsageSummary = {
  providers: UsageProviderSummary[]
  brave: { totalQueries: number; totalCost: number }
}

function formatDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The first ledger date a range includes, as `YYYY-MM-DD`. Every desktop
 * cutoff lands on a local midnight, so comparing whole days against this is
 * exactly the desktop's `timestamp >= cutoff` — including `today`, whose
 * cutoff IS today's midnight.
 */
export function rangeCutoff(range: UsageTimeRange, now: Date): string {
  switch (range) {
    case 'today':
      return formatDate(now)
    case 'this_month':
      return formatDate(new Date(now.getFullYear(), now.getMonth(), 1))
    case '3_months':
      return formatDate(new Date(now.getFullYear(), now.getMonth() - 3, 1))
    case '6_months':
      return formatDate(new Date(now.getFullYear(), now.getMonth() - 6, 1))
    case 'ytd':
      return formatDate(new Date(now.getFullYear(), 0, 1))
    case 'all_time':
      return '0000-00-00'
  }
}

/** The same cutoff as epoch ms, for the conversations COUNT query. */
export function rangeCutoffMs(range: UsageTimeRange, now: Date): number {
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    case 'this_month':
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    case '3_months':
      return new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime()
    case '6_months':
      return new Date(now.getFullYear(), now.getMonth() - 6, 1).getTime()
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1).getTime()
    case 'all_time':
      return 0
  }
}

/** Desktop usage.ts longestConsecutiveStreak, verbatim semantics. */
export function longestConsecutiveStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...dates].sort()
  let longest = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00Z')
    const cur = new Date(sorted[i] + 'T00:00:00Z')
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      current++
      if (current > longest) longest = current
    } else if (diffDays > 1) {
      current = 1
    }
  }
  return longest
}

/** The desktop's usage.getStats over the folded rows (minus conversations). */
export function computeUsageStats(days: UsageDay[], range: UsageTimeRange, now: Date): UsageStats {
  const cutoff = rangeCutoff(range, now)

  let messages = 0
  let totalTokens = 0
  let totalCost = 0
  const activeDays: string[] = []
  const costByDay = new Map<string, number>()
  const modelCounts = new Map<string, number>()

  for (const day of days) {
    if (day.date < cutoff) continue
    let dayCost = 0
    let dayEntries = 0
    for (const row of day.models) {
      messages += row.entries
      dayEntries += row.entries
      totalTokens += row.inputTokens + row.outputTokens
      dayCost += row.cost
      modelCounts.set(row.model, (modelCounts.get(row.model) ?? 0) + row.entries)
    }
    // Brave queries are paid too, but stay out of activeDays — the desktop
    // keeps that meaning "days with LLM turns".
    dayCost += day.braveQueries * BRAVE_COST_PER_QUERY
    if (dayEntries > 0) activeDays.push(day.date)
    if (dayCost > 0) costByDay.set(day.date, (costByDay.get(day.date) ?? 0) + dayCost)
    totalCost += dayCost
  }

  let topSpendDay: { date: string; cost: number } | null = null
  for (const [date, cost] of costByDay) {
    if (!topSpendDay || cost > topSpendDay.cost) topSpendDay = { date, cost }
  }

  let favouriteModel: string | null = null
  let topCount = 0
  for (const [model, count] of modelCounts) {
    if (count > topCount) {
      favouriteModel = model
      topCount = count
    }
  }

  return {
    messages,
    activeDays: activeDays.length,
    longestStreak: longestConsecutiveStreak(activeDays),
    totalTokens,
    favouriteModel,
    totalCost,
    topSpendDay
  }
}

/** The desktop's usage.getSummary: all providers zero-filled, plus Brave. */
export function computeUsageSummary(
  days: UsageDay[],
  range: UsageTimeRange,
  now: Date
): UsageSummary {
  const cutoff = rangeCutoff(range, now)

  const byProvider = new Map<
    string,
    {
      totalInputTokens: number
      totalOutputTokens: number
      totalCost: number
      models: Map<string, { inputTokens: number; outputTokens: number; cost: number }>
    }
  >()
  let totalQueries = 0

  for (const day of days) {
    if (day.date < cutoff) continue
    totalQueries += day.braveQueries
    for (const row of day.models) {
      const bucket = byProvider.get(row.provider) ?? {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        models: new Map()
      }
      bucket.totalInputTokens += row.inputTokens
      bucket.totalOutputTokens += row.outputTokens
      bucket.totalCost += row.cost
      const model = bucket.models.get(row.model) ?? { inputTokens: 0, outputTokens: 0, cost: 0 }
      model.inputTokens += row.inputTokens
      model.outputTokens += row.outputTokens
      model.cost += row.cost
      bucket.models.set(row.model, model)
      byProvider.set(row.provider, bucket)
    }
  }

  const providers: UsageProviderSummary[] = USAGE_PROVIDERS.map((provider) => {
    const bucket = byProvider.get(provider)
    if (!bucket) {
      return { provider, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, models: [] }
    }
    return {
      provider,
      totalInputTokens: bucket.totalInputTokens,
      totalOutputTokens: bucket.totalOutputTokens,
      totalCost: bucket.totalCost,
      models: [...bucket.models.entries()].map(([model, stats]) => ({ model, ...stats }))
    }
  })

  return {
    providers,
    brave: { totalQueries, totalCost: totalQueries * BRAVE_COST_PER_QUERY }
  }
}

/** Per-day LLM token totals for one year — the desktop's usage.getDaily. */
export function dailyTokens(days: UsageDay[], year: number): Map<string, number> {
  const prefix = `${year}-`
  const byDay = new Map<string, number>()
  for (const day of days) {
    if (!day.date.startsWith(prefix)) continue
    let tokens = 0
    for (const row of day.models) tokens += row.inputTokens + row.outputTokens
    if (tokens > 0) byDay.set(day.date, tokens)
  }
  return byDay
}

/** Details behind one activity pixel — what the tap-a-day card renders. */
export type UsageDayDetails = {
  date: string
  totalTokens: number
  cost: number
  messages: number
  braveQueries: number
  models: UsageModelDay[]
}

export function dayDetails(days: UsageDay[], date: string): UsageDayDetails {
  const day = days.find((candidate) => candidate.date === date)
  const details: UsageDayDetails = {
    date,
    totalTokens: 0,
    cost: 0,
    messages: 0,
    braveQueries: day?.braveQueries ?? 0,
    models: day?.models ?? []
  }
  if (!day) return details
  for (const row of day.models) {
    details.totalTokens += row.inputTokens + row.outputTokens
    details.cost += row.cost
    details.messages += row.entries
  }
  details.cost += day.braveQueries * BRAVE_COST_PER_QUERY
  return details
}

/** Years the ledger touches (ascending), always including the current one. */
export function ledgerYears(days: UsageDay[], now: Date): number[] {
  const years = new Set<number>([now.getFullYear()])
  for (const day of days) {
    const year = Number(day.date.slice(0, 4))
    if (Number.isFinite(year) && year > 0) years.add(year)
  }
  return [...years].sort((a, b) => a - b)
}
