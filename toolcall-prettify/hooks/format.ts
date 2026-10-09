const MAX_OUTPUT_LINES = 40

export function clip(text: string): { text: string; hidden: number } {
  const lines = text.replace(/\s+$/, '').split('\n')

  return { text: lines.slice(0, MAX_OUTPUT_LINES).join('\n'), hidden: Math.max(0, lines.length - MAX_OUTPUT_LINES) }
}

export function outputLanguage(command: string, output: string): { language?: string; path?: string } {
  const trimmed = output.trim()
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed)
      return { language: 'json' }
    } catch {}
  }
  if (/^(diff --git|--- |@@ )/m.test(trimmed)) return { language: 'diff' }
  const shown = command.match(/\b(?:cat|head|tail|bat|sed -n \S+)\s+(?:-\S+\s+)*([^\s|;&]+\.\w+)/)

  return shown ? { path: shown[1] } : {}
}
