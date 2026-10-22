import { expect, test } from 'claude-code/testing'

import { classify, findDryRun } from './blast-radius.mjs'

test('holds find -delete', () => {
  expect(classify('find . -mindepth 1 -delete')).toEqual({ kind: 'find', label: 'find -delete', args: ['.', '-mindepth', '1', '-print'], dir: null })
})

test('holds find -exec rm and keeps the folder moved by cd', () => {
  expect(classify("cd /tmp/x && find . -name '*.log' -exec rm -f {} \;")).toEqual({
    kind: 'find',
    label: 'find -exec rm',
    args: ['.', '-name', '*.log', '-print'],
    dir: '/tmp/x',
  })
})

test('lets read-only find through', () => {
  expect(classify('find . -name "*.ts" -print')).toBe(null)
  expect(classify('find . -exec grep -l foo {} +')).toBe(null)
})

test('never lets the dry run write or execute', () => {
  expect(findDryRun(['.', '-fprint', 'out.txt', '-exec', 'chmod', '600', '{}', '+', '-delete'])?.args).toEqual(['.', '-true', '-true', '-print'])
})

test('draws the report above the prompt while the pane is placed but hidden', async ($, on) => {
  let polled: () => void
  const firstPoll = new Promise<void>((resolve) => { polled = resolve })
  let answered: () => void
  const pressed = new Promise<void>((resolve) => { answered = resolve })
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', async (_, e) => {
    if (e.argv[0] === 'sleep') {
      polled()
      await pressed
    }
    return { value: { exitCode: 0, stdout: e.argv[1] === 'status' ? ' M a.txt\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'blast-radius', title: 'Blast Radius', isShown: false, isFocused: false, isPlaced: true }] }))
  on('ui.close', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))

  const call = $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  await firstPoll

  const band = await $.ui.mount({
    plugin: 'blast-radius',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 100 },
  })
  expect((await band.find({ type: 'Text', text: /a\.txt/ }))?.text).toContain('a.txt')
  await band.press({ key: 'cancel' })
  answered()
  await band.unmount()

  expect(JSON.stringify(await call)).toContain('the user pressed Cancel')
})
