export type SessionTab = 'usage' | 'tools' | 'changes' | 'activity' | 'files' | 'stats' | 'help'

export type SessionPaths = {
  id: string
  cwd: string
  transcript: string
  env: string
  tmp: string
  fileHistory: string
}

export type SessionDiff = { path: string; text: string; against: string }

export type SessionGit = {
  root: string
  branch: string
  files: { code: string; path: string; added: number; removed: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-panel': {
      tab: SessionTab
      dir: string
      tick: number
      offset: number
      isErrorsOnly: boolean
      selectedTool: string | null
      listOffset: number
      diff: SessionDiff | null
      git: SessionGit | null
      paths: SessionPaths | null
    }
  }
}
