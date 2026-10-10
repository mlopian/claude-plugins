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
