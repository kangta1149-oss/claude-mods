export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/**
 * One checklist item. `batch` counts the checklists of the session: a task
 * created once every task of the latest batch is completed opens a new one.
 */
export type TaskItem = { id: string; subject: string; status: TaskStatus; batch?: number }

/** The model a loop sent its last request to, and the effort it asked for. */
export type ModelUse = { model: string; effort?: string }

export type AgentRun = ModelUse & {
  id: string
  description: string
  type: string
  status: 'running' | 'done' | 'failed'
}

/** One message the person sent, followed until the turn that answers it ends. */
export type RequestItem = {
  id: string
  title: string
  status: 'running' | 'done' | 'stopped'
  /** When it started, as the person reads a clock (`14:02`). */
  startedAt: string
  /** How long it took, once it ended (`1분 20초`). */
  took?: string
  /** Tool calls made for it so far. */
  steps: number
  /** What it is doing now, while it runs (`웹 검색`). */
  activity?: string
}

export type ProgressStyle = 'percent' | 'bar' | 'donut'

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      tasks: TaskItem[]
      main: ModelUse | null
      agents: AgentRun[]
      requests: RequestItem[]
      style: ProgressStyle
    }
  }
}
