import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const statsView = await import(pathToFileURL(
  path.join(import.meta.dirname, '../npm/lib/stats-view.js'),
).href).catch(() => ({}))

test('the stats Client Plugin contributes only through the composer dock', () => {
  assert.deepEqual(statsView.inject, ['acpSessionStats', 'tuiSlots'])
  assert.equal(typeof statsView.apply, 'function')
  if (typeof statsView.apply !== 'function') return

  let listener
  let nodes = []
  const ctx = {
    acpSessionStats: {
      current: () => ({
        sessionId: 's-1',
        usage: {
          input: 1834, output: 412, cached: 1200,
          cacheRead: 1200, cacheWrite: 0, reasoning: 0,
        },
        stats: {
          turns: 1, steps: 67, llmMillis: 15_000, toolMillis: 0,
          ttftTotalMillis: 1500, ttftCount: 1,
        },
      }),
      subscribe(next) { listener = next; return () => { listener = undefined } },
    },
    tuiSlots: {
      inject(name, callback) {
        assert.equal(name, 'conversation.composer.dock')
        return callback()
      },
      register(options, initial) {
        assert.deepEqual(options, { name: 'conversation.composer.dock', id: 'stats' })
        nodes = initial
        return { update(next) { nodes = next }, dispose() {} }
      },
    },
  }

  statsView.apply(ctx)
  // No `usage_update` yet: the gauge is hidden rather than guessed from
  // the model name (issue #77 — the old 128K guess pegged early 100%).
  assert.equal(nodes.length, 5)
  assert.deepEqual(nodes.map((node) => node.title), [
    '↑1.8K · ↓412',
    '1 turn · 67 steps',
    'Cache hit 40%',
    'LLM 15s · Tool call 0s',
    'TTFT avg 1.5s · 27.5 tok/s',
  ])

  listener({
    sessionId: 's-1',
    usage: {
      input: 0, output: 0, cached: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
    },
    stats: {
      turns: 0, steps: 0, llmMillis: 0, toolMillis: 0,
      ttftTotalMillis: 0, ttftCount: 0,
    },
  })
  assert.deepEqual(nodes, [])

  // The harness `usage_update` gauge wins over the model-name heuristic:
  // 17000/128000 = 13.3%, not the guessed 1.0M window of the model.
  listener({
    sessionId: 's-1',
    usage: {
      input: 5000, output: 300, cached: 4000, cacheRead: 4000, cacheWrite: 0, reasoning: 0,
    },
    context: { used: 17_000, size: 128_000 },
    stats: {
      turns: 2, steps: 4, llmMillis: 0, toolMillis: 0,
      ttftTotalMillis: 0, ttftCount: 0,
    },
  })
  assert.deepEqual(nodes.map((node) => node.title), [
    '↑5K · ↓300',
    '13.3%/128K',
    '2 turns · 4 steps',
    'Cache hit 44%',
  ])
})

test('DSH_TUI_STATS parses into an ordered segment allowlist', () => {
  // unset keeps the default full dock (null = no filtering at all)
  assert.equal(statsView.statsSegments({}), null)
  assert.deepEqual(statsView.statsSegments({ DSH_TUI_STATS: '' }), [])
  assert.deepEqual(statsView.statsSegments({ DSH_TUI_STATS: ' off ' }), [])
  assert.deepEqual(statsView.statsSegments({ DSH_TUI_STATS: 'none' }), [])
  assert.deepEqual(statsView.statsSegments({ DSH_TUI_STATS: 'all' }),
    ['tokens', 'context', 'counts', 'cache', 'time', 'speed'])
  assert.deepEqual(
    statsView.statsSegments({ DSH_TUI_STATS: 'tokens,cache' }),
    ['tokens', 'cache'],
  )
  // the listed order is the render order
  assert.deepEqual(
    statsView.statsSegments({ DSH_TUI_STATS: 'cache , Tokens' }),
    ['cache', 'tokens'],
  )
  // unknown and duplicate ids drop out instead of failing the whole list
  assert.deepEqual(
    statsView.statsSegments({ DSH_TUI_STATS: 'tokens,bogus,tokens' }),
    ['tokens'],
  )
})

const FULL_SNAPSHOT = {
  sessionId: 's-1',
  usage: {
    input: 5000, output: 300, cached: 4000, cacheRead: 4000, cacheWrite: 0, reasoning: 0,
  },
  context: { used: 17_000, size: 128_000 },
  stats: {
    turns: 2, steps: 4, llmMillis: 97_000, toolMillis: 1_100,
    ttftTotalMillis: 2_100, ttftCount: 1,
  },
}

test('nodesOf filters and reorders by the segment allowlist', () => {
  assert.deepEqual(
    statsView.nodesOf(FULL_SNAPSHOT, ['speed', 'tokens']).map((node) => node.id),
    ['speed', 'tokens'],
  )
  assert.deepEqual(
    statsView.nodesOf(FULL_SNAPSHOT, []).map((node) => node.id),
    [],
  )
  // allowlisted but data-gated segments stay hidden (no usage_update → no gauge)
  assert.deepEqual(
    statsView.nodesOf({ ...FULL_SNAPSHOT, context: undefined }, ['context', 'tokens'])
      .map((node) => node.id),
    ['tokens'],
  )
  assert.deepEqual(
    statsView.nodesOf(FULL_SNAPSHOT, null).map((node) => node.id),
    ['tokens', 'context', 'counts', 'cache', 'time', 'speed'],
  )
})

test('apply honors DSH_TUI_STATS from the environment', () => {
  const previous = process.env.DSH_TUI_STATS
  try {
    process.env.DSH_TUI_STATS = 'none'
    let nodes = []
    statsView.apply(fakeCtx(FULL_SNAPSHOT, (next) => { nodes = next }))
    assert.deepEqual(nodes, [])

    process.env.DSH_TUI_STATS = 'context,counts'
    statsView.apply(fakeCtx(FULL_SNAPSHOT, (next) => { nodes = next }))
    assert.deepEqual(nodes.map((node) => node.title), ['13.3%/128K', '2 turns · 4 steps'])
  } finally {
    if (previous === undefined) delete process.env.DSH_TUI_STATS
    else process.env.DSH_TUI_STATS = previous
  }
})

function fakeCtx(snapshot, onNodes) {
  return {
    acpSessionStats: {
      current: () => snapshot,
      subscribe(listener) {
        return () => { listener = undefined }
      },
    },
    tuiSlots: {
      inject(name, callback) { return callback() },
      register(_options, initial) {
        onNodes(initial)
        return { update: onNodes, dispose() {} }
      },
    },
  }
}
