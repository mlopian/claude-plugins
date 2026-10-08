import { test, expect, mock } from 'claude-code/testing'

test('band draws a red bar when 10% is left', async ($, on) => {
  mock.clock(on)
  on('session.start', ($, e) => e as never)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 90 }] },
  }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'limits-status', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    expect(JSON.stringify(await ui.drawn())).toContain('{"color":"error"},"children":["█░░░░░░░░░"]')
    await ui.unmount()
  }
})
