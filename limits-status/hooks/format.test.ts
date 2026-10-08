import { test, expect } from 'claude-code/testing'
import { bar, colorFor, countdown, segment } from './register'

const NOW = Date.parse('2026-10-08T10:00:00Z')

test('describes what is left with a colored bar and time to reset', async () => {
  expect(segment({ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-08T12:15:00Z' }, NOW)).toEqual({
    label: '5h',
    bar: '████████░░',
    color: 'success',
    text: '76.5% reset 2h 15m',
  })
  expect(segment({ kind: 'seven_day', percentUsed: 120 }, NOW).text).toBe('0%')
  expect(bar(0)).toBe('░░░░░░░░░░')
  expect([colorFor(51), colorFor(50), colorFor(21), colorFor(20)]).toEqual(['success', 'warning', 'warning', 'error'])
  expect(countdown(30_000)).toBe('1m')
  expect(countdown(3 * 86_400_000 + 5 * 3_600_000)).toBe('3d 5h')
})
