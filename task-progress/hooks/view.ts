import type { AgentRun, ModelUse, ProgressStyle, TaskItem } from '../types'

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
  style: ProgressStyle
  updatedAt: string
}

/**
 * The progress board as a Markdown page, for a session no surface draws a pane
 * in: the Claude app shows a .md file rendered at once, where an .html file
 * opens as source until its preview is turned on. The meter and the circles
 * are blue SVG images carried in the file.
 */
export function progressMarkdown({ tasks, main, agents, style, updatedAt }: Snapshot) {
  const { done, total, left, percent, label } = summarize(tasks)
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
  const rows = tasks.map(task => {
    const dot = svgImage(DOT_ALT[task.status], dotSvg(task.status))
    const subject = plain(task.subject)
    const text =
      task.status === 'completed' ? `~~${subject}~~` : task.status === 'in_progress' ? `**${subject}** _(진행 중)_` : subject

    return `${dot} ${text}`
  })

  return [
    '# 작업 진행률',
    '',
    meter,
    '',
    `**${label}**`,
    '',
    `완료 ${done}개 · 남은 작업 ${left}개`,
    '',
    '## 모델',
    '',
    `- 메인 · ${main ? plain(modelLabel(main)) : '아직 기록 없음'}`,
    `- 서브에이전트 ${agents.length}개${running ? ` (실행 중 ${running})` : ''}`,
    ...groups,
    '',
    `## 작업 목록 (${total})`,
    '',
    rows.length > 0 ? rows.join('  \n') : '체크리스트 항목이 아직 없습니다.',
    '',
    `_갱신 ${plain(updatedAt)} · 파일을 다시 열면 최신 내용이 보인다_`,
    '',
  ].join('\n')
}
