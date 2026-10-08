import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { Limit } from '../types'

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const BAR_WIDTH = 10
const MINUTE = 60_000

const snapshot = atom({ plugin: 'limits-status', key: 'snapshot' } as const, { limits: [], now: 0 })

export const bar = (percentLeft: number) => {
  const filled = Math.round((Math.max(0, Math.min(100, percentLeft)) / 100) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

export const countdown = (ms: number) => {
  const minutes = Math.max(0, Math.ceil(ms / MINUTE))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const colorFor = (percentLeft: number): ThemeKey =>
  percentLeft > 50 ? 'success' : percentLeft > 20 ? 'warning' : 'error'

export const segment = (l: Limit, now: number) => {
  const left = Math.max(0, Math.round((100 - l.percentUsed) * 10) / 10)
  return {
    label: LABELS[l.kind] ?? l.kind,
    bar: bar(left),
    color: colorFor(left),
    text: `${left}%${l.resetsAt ? ` reset ${countdown(Date.parse(l.resetsAt) - now)}` : ''}`,
  }
}

async function refresh($: EngineInterface, limits?: Limit[]) {
  const now = await $.clock.now()
  await update($, snapshot, s => ({ limits: limits ?? s.limits, now }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($, (await $.session.usage()).rateLimits)
    $.clock.every(MINUTE, () => refresh($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await refresh($, e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { limits, now } = await read($, snapshot)
    if (e.props.hasSurvey || limits.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        {limits.map((l, i) => {
          const s = segment(l, now)
          return (
            <Text key={l.kind}>
              {i > 0 ? '  ' : ''}
              <Text dimColor>{s.label} </Text>
              <Text color={s.color}>{s.bar}</Text>
              <Text dimColor> {s.text}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}
