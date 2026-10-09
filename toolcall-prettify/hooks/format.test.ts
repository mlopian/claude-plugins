import { expect, test } from 'claude-code/testing'

import { clip, outputLanguage } from './format'

test('detects json output', () => {
  expect(outputLanguage('gh api x', '{ "a": 1 }')).toEqual({ language: 'json' })
})

test('detects diff output', () => {
  expect(outputLanguage('git diff', 'diff --git a/x b/x\n@@ -1 +1 @@')).toEqual({ language: 'diff' })
})

test('takes the language from a printed file', () => {
  expect(outputLanguage('cat .claude-plugin/plugin.json 2>/dev/null | head -30', 'x')).toEqual({ path: '.claude-plugin/plugin.json' })
})

test('leaves plain output plain', () => {
  expect(outputLanguage('ls', 'a\nb')).toEqual({})
})

test('clips long output and counts the rest', () => {
  const result = clip(Array.from({ length: 45 }, (_, i) => String(i)).join('\n'))
  expect(result.hidden).toBe(5)
  expect(result.text.split('\n').length).toBe(40)
})
