/** Built-in Client Plugin: standard ACP usage and timing in the composer dock. */

export const name = 'stats-view'
export const inject = ['acpSessionStats', 'tuiSlots']

/** Segment ids in natural dock order — also the `DSH_TUI_STATS` vocabulary. */
const SEGMENT_ORDER = ['tokens', 'context', 'counts', 'cache', 'time', 'speed']

/**
 * Parse `DSH_TUI_STATS` into an ordered allowlist of segment ids. The listed
 * order is the render order, so the variable filters AND reorders the dock.
 * Unset keeps the default full dock (`null` = no filtering); `all` spells the
 * default out; `none`/`off`/empty hides every segment. Unknown and duplicate
 * ids are dropped, which also makes `tokens,bogus` degrade to `tokens`.
 */
export function statsSegments(env = process.env) {
  const raw = env.DSH_TUI_STATS
  if (raw === undefined) return null
  const keyword = raw.trim().toLowerCase()
  if (keyword === '' || keyword === 'none' || keyword === 'off') return []
  if (keyword === 'all') return [...SEGMENT_ORDER]
  const seen = new Set()
  const wanted = []
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase()
    if (!SEGMENT_ORDER.includes(id) || seen.has(id)) continue
    seen.add(id)
    wanted.push(id)
  }
  return wanted
}

export function apply(ctx) {
  const segments = statsSegments()
  let current = ctx.acpSessionStats.current()
  let panel
  const stopSlot = ctx.tuiSlots.inject('conversation.composer.dock', () => {
    panel = ctx.tuiSlots.register(
      { name: 'conversation.composer.dock', id: 'stats' },
      nodesOf(current, segments),
    )
    return () => panel.dispose()
  })
  const stopStats = ctx.acpSessionStats.subscribe((snapshot) => {
    current = snapshot
    panel?.update(nodesOf(current, segments))
  })
  return () => {
    stopStats?.()
    stopSlot?.()
  }
}

function nodesOf(snapshot, segments = null) {
  const usage = snapshot?.usage ?? {}
  const stats = snapshot?.stats ?? {}
  const nodes = []
  if ((usage.input ?? 0) > 0 || (usage.output ?? 0) > 0) {
    nodes.push(node('tokens', `↑${formatTokens(usage.input)} · ↓${formatTokens(usage.output)}`))
    const gauge = contextGauge(snapshot)
    if (gauge.used > 0 && gauge.size > 0) {
      const pct = Math.min(100, gauge.used / gauge.size * 100).toFixed(1)
      nodes.push(node('context', `${pct}%/${contextSizeLabel(gauge.size)}`))
    }
  }
  if ((stats.turns ?? 0) > 0 || (stats.steps ?? 0) > 0) {
    nodes.push(node(
      'counts',
      `${stats.turns ?? 0} ${plural(stats.turns ?? 0, 'turn')} · ${stats.steps ?? 0} ${plural(stats.steps ?? 0, 'step')}`,
    ))
  }
  if ((usage.input ?? 0) > 0) {
    const cacheRead = usage.cacheRead ?? usage.cached ?? 0
    const cacheWrite = usage.cacheWrite ?? 0
    const eligible = usage.input + cacheRead + cacheWrite
    const rate = eligible > 0 ? Math.round(cacheRead / eligible * 100) : 0
    nodes.push(node('cache', `Cache hit ${rate}%`))
  }
  if ((stats.llmMillis ?? 0) > 0 || (stats.toolMillis ?? 0) > 0) {
    nodes.push(node(
      'time',
      `LLM ${formatDuration(stats.llmMillis ?? 0)} · Tool call ${formatDuration(stats.toolMillis ?? 0)}`,
    ))
  }
  if ((stats.ttftCount ?? 0) > 0 || ((usage.output ?? 0) > 0 && (stats.llmMillis ?? 0) > 0)) {
    const parts = []
    if ((stats.ttftCount ?? 0) > 0) {
      parts.push(`TTFT avg ${formatDuration(stats.ttftTotalMillis / stats.ttftCount)}`)
    }
    if ((usage.output ?? 0) > 0 && (stats.llmMillis ?? 0) > 0) {
      parts.push(`${formatRate(usage.output / (stats.llmMillis / 1000))} tok/s`)
    }
    nodes.push(node('speed', parts.join(' · ')))
  }
  if (segments === null) return nodes
  return segments.flatMap((id) => nodes.find((entry) => entry.id === id) ?? [])
}

function node(id, title) {
  return { id, kind: 'generic', title, body: '' }
}

function plural(value, singular) { return value === 1 ? singular : `${singular}s` }

/**
 * Context-window gauge. Only the harness `usage_update` readout is shown:
 * `used` is the final prompt size and `size` the real model window from
 * `request/context`. Nothing client-side can reproduce either — per-turn
 * usage sums every step's full context (multi-step turns over-report),
 * and a model-name guess does not know the window (the old 128K guess is
 * what pegged the dock at 100% early in issue #77). Without an
 * authoritative readout the gauge is hidden instead of showing a wrong
 * percentage.
 */
function contextGauge(snapshot) {
  const context = snapshot?.context
  if (context?.size > 0) return { used: context.used ?? 0, size: context.size }
  return { used: 0, size: 0 }
}

/** `1000000` → `1.0M`, `128000` → `128K` — keeps the one-decimal look of
 * the percentage side (e.g. `17.5%/1.0M`). */
function contextSizeLabel(size) {
  if (size >= 1_000_000) {
    const scaled = size / 1_000_000
    return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}M`
  }
  return formatTokens(size)
}

function formatTokens(value = 0) {
  if (value < 1000) return String(value)
  const unit = value < 1_000_000 ? 1000 : 1_000_000
  const suffix = unit === 1000 ? 'K' : 'M'
  const scaled = value / unit
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10
  return `${rounded}${suffix}`
}

function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`
}

function formatRate(value) {
  return String(Math.round(value * 10) / 10)
}

export { formatDuration, formatRate, formatTokens, nodesOf }
