export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type TaskItem = { id: string; subject: string; status: TaskStatus }

/** The model a loop sent its last request to, and the effort it asked for. */
export type ModelUse = { model: string; effort?: string }

export type AgentRun = ModelUse & {
  id: string
  description: string
  type: string
  status: 'running' | 'done' | 'failed'
}

export type ProgressStyle = 'percent' | 'bar' | 'donut'

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      tasks: TaskItem[]
      main: ModelUse | null
      agents: AgentRun[]
      style: ProgressStyle
    }
  }
}
