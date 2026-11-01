import type { AgentRun, ModelUse, ProgressStyle, RequestItem, TaskItem } from '../types'

export const BLUE = '#2f80ed'
export const TRACK = '#d0d7e2'

export const STYLES: readonly { style: ProgressStyle; label: string; words: readonly string[] }[] = [
  { style: 'percent', label: '퍼센트', words: ['퍼센트', 'percent', '%'] },
  { style: 'bar', label: '막대', words: ['막대', 'bar'] },
  { style: 'donut', label: '도넛', words: ['도넛', 'donut'] },
]

export const isStyle = (value: unknown): value is ProgressStyle =>
  value === 'percent' || value === 'bar' || value === 'donut'

export function summarize(list: readonly TaskItem[]) {
  const total = list.length
  const done = list.filter(task => task.status === 'completed').length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return { done, total, left: total - done, percent, label: `완료 ${done}/${total} · ${percent}%` }
}

const batchOf = (task: TaskItem) => task.batch ?? 1

/**
 * The batch a task created now joins: the latest one while any of its tasks is
 * still open, a new one once all of them are completed (a new piece of work).
 */
export function nextBatch(list: readonly TaskItem[]) {
  if (list.length === 0) return 1
  const latest = Math.max(...list.map(batchOf))
  const isOpen = list.some(task => batchOf(task) === latest && task.status !== 'completed')

  return isOpen ? latest : latest + 1
}

/** The first line of what the person sent, short enough for one row. */
export function titleOf(text: string, room = 40) {
  const line = text.trim().split('\n')[0]!.trim()

  return line.length > room ? `${line.slice(0, room - 1)}…` : line
}

export function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}분 ${seconds % 60}초`

  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
}

const ACTIVITY: Record<string, string> = {
  Bash: '명령 실행',
  PowerShell: '명령 실행',
  Read: '파일 읽기',
  Write: '파일 쓰기',
  Edit: '파일 수정',
  NotebookEdit: '노트북 수정',
  Glob: '파일 찾기',
  Grep: '내용 찾기',
  WebSearch: '웹 검색',
  WebFetch: '웹 페이지 읽기',
  Agent: '서브에이전트 실행',
  Task: '서브에이전트 실행',
  TaskCreate: '체크리스트 작성',
  TaskUpdate: '체크리스트 갱신',
  TaskList: '체크리스트 확인',
  TodoWrite: '체크리스트 갱신',
  Skill: '스킬 사용',
  AskUserQuestion: '질문하는 중',
  ToolSearch: '도구 찾기',
}

/** What a tool call is doing, in the person's words; an MCP tool by its server. */
export function activityOf(tool: string) {
  const known = ACTIVITY[tool]
  if (known) return known
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)

  return mcp ? `${mcp[1]} 사용` : tool
}

export const requestMark = (status: RequestItem['status']) =>
  status === 'done' ? '●' : status === 'running' ? '◐' : '⊘'

export const RECENT_REQUESTS = 8

export type Board = {
  /** What the meter shows: the open checklist, else the requests. */
  source: 'checklist' | 'requests' | 'none'
  done: number
  total: number
  percent: number
  label: string
  left: string
  /** The latest checklist, the one the meter follows. */
  current: TaskItem[]
  /** Checklists finished before it, folded to one line. */
  earlier: { batches: number; tasks: number }
  latest: RequestItem | undefined
  recent: RequestItem[]
  olderRequests: number
}

/**
 * Everything the pane and progress.md show, from the checklist and the
 * requests. The meter follows the latest checklist while it is open, or while
 * no request runs; a request running past a finished checklist (or with none)
 * moves the meter by the requests instead, so every message shows progress.
 */
export function boardOf(tasks: readonly TaskItem[], requests: readonly RequestItem[]): Board {
  const latestBatch = tasks.length === 0 ? 0 : Math.max(...tasks.map(batchOf))
  const current = tasks.filter(task => batchOf(task) === latestBatch)
  const before = tasks.filter(task => batchOf(task) < latestBatch)
  const isRunning = requests.some(request => request.status === 'running')
  const isOpen = current.some(task => task.status !== 'completed')
  const latest = requests[requests.length - 1]
  const recent = requests.slice(-RECENT_REQUESTS)
  const base = {
    current,
    earlier: { batches: new Set(before.map(batchOf)).size, tasks: before.length },
    latest,
    recent,
    olderRequests: requests.length - recent.length,
  }

  if (current.length > 0 && (isOpen || !isRunning)) {
    const { done, total, left, percent } = summarize(current)

    return { ...base, source: 'checklist', done, total, percent, label: `완료 ${done}/${total} · ${percent}%`, left: `완료 ${done}개 · 남은 작업 ${left}개` }
  }
  if (requests.length > 0) {
    const total = requests.length
    const done = requests.filter(request => request.status !== 'running').length
    const percent = Math.round((done / total) * 100)

    return { ...base, source: 'requests', done, total, percent, label: `요청 완료 ${done}/${total} · ${percent}%`, left: `끝난 요청 ${done}개 · 진행 중 ${total - done}개` }
  }

  return { ...base, source: 'none', done: 0, total: 0, percent: 0, label: '완료 0/0 · 0%', left: '아직 맡긴 작업이 없습니다.' }
}

/** The "지금" line: what the latest request is doing, or that nothing runs. */
export function nowLine(latest: RequestItem | undefined) {
  if (!latest) return '대기 중'
  if (latest.status === 'running') {
    return `진행 중 · ${latest.title} · 단계 ${latest.steps}${latest.activity ? ` · ${latest.activity}` : ''}`
  }

  return `대기 중 · 마지막 요청 ${latest.status === 'done' ? '끝남' : '중단됨'}${latest.took ? ` (${latest.took})` : ''}`
}

/** One row of the request log, after its circle. */
export const requestRow = (request: RequestItem) =>
  `${request.title} · ${request.startedAt} · 단계 ${request.steps}${request.took ? ` · ${request.took}` : ''}`

/** `claude-opus-5-5` → `Opus 5.5`; anything else as it came. */
export function modelName(model: string) {
  const known = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  if (!known) return model
  const family = known[1]!
  const version = known[3] === undefined ? known[2] : `${known[2]}.${known[3]}`

  return `${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()} ${version}`
}

export const modelLabel = (use: ModelUse) => `${modelName(use.model)} · ${use.effort ?? '기본'}`

export type AgentGroup = { label: string; count: number; running: number }

/** Subagents counted by model and effort, the busiest group first. */
export function agentGroups(agents: readonly AgentRun[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>()
  for (const agent of agents) {
    const label = modelLabel(agent)
    const group = groups.get(label) ?? { label, count: 0, running: 0 }
    group.count += 1
    if (agent.status === 'running') group.running += 1
    groups.set(label, group)
  }

  return [...groups.values()].sort((a, b) => b.running - a.running || b.count - a.count)
}

export const taskMark = (status: TaskItem['status']) =>
  status === 'completed' ? '●' : status === 'in_progress' ? '◐' : '○'

/** The twelve beads of the text donut, clockwise from the top, on an 11 × 5 grid. */
const RING: readonly (readonly [number, number])[] = [
  [0, 5], [0, 7], [1, 9], [2, 10], [3, 9], [4, 7],
  [4, 5], [4, 3], [3, 1], [2, 0], [1, 1], [0, 3],
]

export type RingCell = { text: string; isFilled?: boolean; isBead?: boolean }

/** The text donut: each row as runs of beads (filled or not) and plain text. */
export function ringRows(percent: number): RingCell[][] {
  const filled = Math.round((percent / 100) * RING.length)
  const grid: RingCell[][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 11 }, () => ({ text: ' ' })),
  )
  RING.forEach(([row, column], index) => {
    grid[row]![column] = { text: index < filled ? '●' : '○', isFilled: index < filled, isBead: true }
  })
  const middle = `${percent}%`
  const start = Math.floor((11 - middle.length) / 2)
  for (let i = 0; i < middle.length; i += 1) grid[2]![start + i] = { text: middle[i]! }

  // Merge neighbours that draw alike, so a row is a few Text runs.
  return grid.map(row =>
    row.reduce<RingCell[]>((runs, cell) => {
      const last = runs[runs.length - 1]
      if (last && last.isBead === cell.isBead && last.isFilled === cell.isFilled) last.text += cell.text
      else runs.push({ ...cell })
      return runs
    }, []),
  )
}

export function donutSvg(percent: number, size = 120) {
  const radius = size * 0.4
  const stroke = size * 0.12
  const circumference = 2 * Math.PI * radius
  const length = (percent / 100) * circumference
  const center = size / 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>`,
    percent > 0
      ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${BLUE}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${length.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${center} ${center})"/>`
      : '',
    `<text x="${center}" y="${center + size * 0.07}" text-anchor="middle" font-family="sans-serif" font-size="${size * 0.2}" font-weight="700" fill="${BLUE}">${percent}%</text>`,
    '</svg>',
  ].join('')
}

/** Text that renders as itself in Markdown: its marks escaped, kept to one line. */
const plain = (text: string) => text.replace(/\s+/g, ' ').replace(/([\\`*_~[\]<>#|])/g, '\\$1')

/**
 * An SVG as an image Markdown can carry inside the file: the Claude app draws a
 * data: image, and draws neither HTML nor an image read from a file beside it.
 * The SVGs here are ASCII, so `btoa` takes them as they are.
 */
export const svgImage = (alt: string, svg: string) => `![${alt}](data:image/svg+xml;base64,${btoa(svg)})`

export const BAR_WIDTH = 320

export function barSvg(percent: number, width = BAR_WIDTH) {
  const filled = Math.round((percent / 100) * width)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="14" viewBox="0 0 ${width} 14">`,
    `<rect width="${width}" height="14" rx="7" fill="${TRACK}"/>`,
    filled > 0 ? `<rect width="${Math.max(filled, 14)}" height="14" rx="7" fill="${BLUE}"/>` : '',
    '</svg>',
  ].join('')
}

export function percentSvg(percent: number) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="56" viewBox="0 0 140 56">',
    `<text x="0" y="46" font-family="sans-serif" font-size="48" font-weight="800" fill="${BLUE}">${percent}%</text>`,
    '</svg>',
  ].join('')
}

/** A row's circle: filled when done, half when under way, a ring while waiting. */
export function dotSvg(status: TaskItem['status']) {
  const ring = `<circle cx="7" cy="7" r="5.5" fill="none" stroke="${BLUE}" stroke-width="2"/>`
  const body =
    status === 'completed'
      ? `<circle cx="7" cy="7" r="6.5" fill="${BLUE}"/>`
      : status === 'in_progress'
        ? `${ring}<path d="M7 1.5 A5.5 5.5 0 0 0 7 12.5 Z" fill="${BLUE}"/>`
        : ring

  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">${body}</svg>`
}

const DOT_ALT = { completed: '완료', in_progress: '진행 중', pending: '대기' } as const

export type Snapshot = {
  tasks: readonly TaskItem[]
  main: ModelUse | null
  agents: readonly AgentRun[]
  requests: readonly RequestItem[]
  style: ProgressStyle
  updatedAt: string
}

const REQUEST_DOT = { done: 'completed', running: 'in_progress', stopped: 'pending' } as const
const REQUEST_ALT = { done: '끝남', running: '진행 중', stopped: '중단됨' } as const

/**
 * The progress board as a Markdown page, for a session no surface draws a pane
 * in: the Claude app shows a .md file rendered at once, where an .html file
 * opens as source until its preview is turned on. The meter and the circles
 * are blue SVG images carried in the file.
 */
export function progressMarkdown({ tasks, main, agents, requests, style, updatedAt }: Snapshot) {
  const board = boardOf(tasks, requests)
  const { percent } = board
  const running = agents.filter(agent => agent.status === 'running').length
  const meter =
    style === 'donut'
      ? svgImage(`진행률 ${percent}%`, donutSvg(percent, 140))
      : style === 'bar'
        ? svgImage(`진행률 ${percent}%`, barSvg(percent))
        : svgImage(`진행률 ${percent}%`, percentSvg(percent))
  const groups = agentGroups(agents).map(
    group => `  - ${plain(group.label)} ×${group.count}${group.running ? ` · 실행 중 ${group.running}` : ''}`,
  )
  // One row per line (a hard break, two spaces), no list bullet beside the circle.
  const taskRows = board.current.map(task => {
    const dot = svgImage(DOT_ALT[task.status], dotSvg(task.status))
    const subject = plain(task.subject)
    const text =
      task.status === 'completed' ? `~~${subject}~~` : task.status === 'in_progress' ? `**${subject}** _(진행 중)_` : subject

    return `${dot} ${text}`
  })
  const requestRows = board.recent.map(request => {
    const dot = svgImage(REQUEST_ALT[request.status], dotSvg(REQUEST_DOT[request.status]))
    const row = plain(requestRow(request))

    return `${dot} ${request.status === 'running' ? `**${row}**` : row}${request.status === 'stopped' ? ' _(중단됨)_' : ''}`
  })

  return [
    '# 작업 진행률',
    '',
    meter,
    '',
    `**${board.label}**`,
    '',
    board.left,
    '',
    `**지금:** ${plain(nowLine(board.latest))}`,
    '',
    '## 모델',
    '',
    `- 메인 · ${main ? plain(modelLabel(main)) : '아직 기록 없음'}`,
    `- 서브에이전트 ${agents.length}개${running ? ` (실행 중 ${running})` : ''}`,
    ...groups,
    '',
    `## 체크리스트 (${board.current.length})`,
    '',
    taskRows.length > 0 ? taskRows.join('  \n') : '체크리스트 항목이 아직 없습니다.',
    ...(board.earlier.tasks > 0 ? ['', `_앞서 끝낸 체크리스트 ${board.earlier.batches}개 · 항목 ${board.earlier.tasks}개_`] : []),
    '',
    `## 요청 기록 (${requests.length})`,
    '',
    requestRows.length > 0 ? requestRows.join('  \n') : '아직 보낸 요청이 없습니다.',
    ...(board.olderRequests > 0 ? ['', `_이전 요청 ${board.olderRequests}개는 접어 둠_`] : []),
    '',
    `_갱신 ${plain(updatedAt)} · 파일을 다시 열면 최신 내용이 보인다_`,
    '',
  ].join('\n')
}
