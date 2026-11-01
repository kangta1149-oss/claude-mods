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

const escape = (text: string) =>
  text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export type Snapshot = {
  tasks: readonly TaskItem[]
  main: ModelUse | null
  agents: readonly AgentRun[]
  style: ProgressStyle
  updatedAt: string
}

/** The progress board as a page of its own, for a session no surface draws a pane in. */
export function progressHtml({ tasks, main, agents, style, updatedAt }: Snapshot) {
  const { done, total, left, percent, label } = summarize(tasks)
  const running = agents.filter(agent => agent.status === 'running').length
  const meter =
    style === 'donut'
      ? `<div class="donut">${donutSvg(percent, 140)}</div>`
      : style === 'bar'
        ? `<div class="bar"><div style="width:${percent}%"></div></div>`
        : `<div class="big">${percent}%</div>`
  const items = tasks
    .map(
      task =>
        `<li class="${task.status}"><span class="dot"></span><span>${escape(task.subject)}</span>${
          task.status === 'in_progress' ? '<em>진행 중</em>' : ''
        }</li>`,
    )
    .join('')
  const groups = agentGroups(agents)
    .map(group => `<li>${escape(group.label)} ×${group.count}${group.running ? ` <em>실행 중 ${group.running}</em>` : ''}</li>`)
    .join('')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>작업 진행률</title>
<style>
:root { --bg:#ffffff; --fg:#1f2933; --dim:#7b8794; --line:#e4e7eb; --blue:${BLUE}; --track:${TRACK}; }
@media (prefers-color-scheme: dark) { :root { --bg:#16181d; --fg:#e4e7eb; --dim:#9aa5b1; --line:#2d323b; --track:#3a404b; } }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:15px/1.5 "Malgun Gothic", system-ui, sans-serif; }
h1 { font-size:18px; margin:0 0 12px; }
h2 { font-size:13px; color:var(--dim); margin:20px 0 6px; font-weight:600; }
.summary { font-size:17px; font-weight:700; margin:8px 0; }
.left { color:var(--dim); }
.big { font-size:44px; font-weight:800; color:var(--blue); line-height:1.1; }
.bar { height:14px; background:var(--track); border-radius:7px; overflow:hidden; }
.bar div { height:100%; background:var(--blue); }
ul { list-style:none; margin:0; padding:0; }
li { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--line); }
.dot { flex:none; width:14px; height:14px; border-radius:50%; border:2px solid var(--blue); box-sizing:border-box; }
.completed .dot { background:var(--blue); }
.completed span:last-child { color:var(--dim); }
.in_progress .dot { background:linear-gradient(90deg, var(--blue) 50%, transparent 50%); }
em { font-style:normal; font-size:12px; color:var(--blue); margin-left:auto; }
.stamp { margin-top:20px; font-size:12px; color:var(--dim); }
</style>
</head>
<body>
<h1>작업 진행률</h1>
${meter}
<div class="summary">${label}</div>
<div class="left">완료 ${done}개 · 남은 작업 ${left}개</div>
<h2>모델</h2>
<ul><li>메인 · ${main ? escape(modelLabel(main)) : '아직 기록 없음'}</li></ul>
<h2>서브에이전트 ${agents.length}개${running ? ` (실행 중 ${running})` : ''}</h2>
<ul>${groups || '<li class="left">없음</li>'}</ul>
<h2>작업 목록 (${total})</h2>
<ul>${items || '<li class="left">체크리스트 항목이 아직 없습니다.</li>'}</ul>
<div class="stamp">갱신 ${escape(updatedAt)} · 5초마다 다시 읽음</div>
</body>
</html>
`
}
