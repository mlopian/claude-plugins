export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Snapshot = { limits: Limit[]; now: number }

declare module 'claude-code' {
  interface PluginState {
    'limits-status': { snapshot: Snapshot }
  }
}
