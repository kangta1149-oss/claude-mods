import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { progressMarkdown } from '../hooks/view'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  component: 'Pane',
  requestId: 'task-progress',
  props: {
    title: '작업 진행률',
    isFocused: false,
    bodyColumns: 20,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const mountPane = <S extends (typeof SURFACES)[number]>($: Engine, surface: S) =>
  $.ui.mount({ plugin: 'task-progress', surface, ...PANE })

/** The world beneath the plugin: no cloud session (so no progress.md), a store in memory. */
function world(on: On) {
  mock.env(on, {})
  const saved: Record<string, unknown> = {}
  on('store.get', async (_$, e) => ({ value: saved[e.key] }))
  on('store.set', async (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('session.surfaces', async () => ({ value: ['terminal'] as const }))

  return saved
}

/** The engine's task tools, answered beneath the plugin. */
function taskTools(on: On) {
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, async (_$, e) => ({
    result: { task: { id: String(++next), subject: e.subject } },
  }))
  on('tool.call', { tool: 'TaskUpdate' }, async (_$, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))
}

async function threeTasks($: Engine) {
  for (const subject of ['지문 분석', '단어 추출', '해설 작성']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
}

test('완료 수, 퍼센트, 상태 표시가 체크리스트를 원래 순서대로 따라간다', async ($, on) => {
  world(on)
  taskTools(on)
  await threeTasks($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'summary' }))?.text).toBe('완료 1/3 · 33%')
    expect((await ui.find({ key: 'left' }))?.text).toBe('완료 1개 · 남은 작업 2개')
    const list = (await ui.find({ key: 'tasks' }))?.text
    expect(list).toContain('작업 목록 (3)')
    expect(list).toContain('● 지문 분석')
    expect(list).toContain('◐ 단어 추출')
    expect(list).toContain('○ 해설 작성')
    // The original order, not grouped by status.
    const order = ['● 지문 분석', '◐ 단어 추출', '○ 해설 작성'].map(row => list!.indexOf(row))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(list).not.toContain('체크리스트 항목이 아직 없습니다.')
    await ui.unmount()
  }

  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'deleted' })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'summary' }))?.text).toBe('완료 1/2 · 50%')
    expect((await ui.find({ key: 'left' }))?.text).toBe('완료 1개 · 남은 작업 1개')
    const list = (await ui.find({ key: 'tasks' }))?.text
    expect(list).toContain('작업 목록 (2)')
    expect(list).not.toContain('해설 작성')
    await ui.unmount()
  }
})

test('TodoWrite와 TaskList의 목록은 통째로 받아들인다', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'TodoWrite' }, async (_$, e) => ({
    result: { oldTodos: [], newTodos: e.todos },
  }))
  on('tool.call', { tool: 'TaskList' }, async () => ({
    result: {
      tasks: [
        { id: '7', subject: '정답표', status: 'completed', blockedBy: [] },
        { id: '8', subject: '검수', status: 'pending', blockedBy: [] },
      ],
    },
  }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '설계도', activeForm: '설계도 쓰는 중', status: 'in_progress' },
      { content: '문항 생성', activeForm: '문항 생성 중', status: 'pending' },
    ],
  })
  let ui = await mountPane($, 'terminal')
  expect((await ui.find({ key: 'summary' }))?.text).toBe('완료 0/2 · 0%')
  expect((await ui.find({ key: 'tasks' }))?.text).toContain('◐ 설계도 쓰는 중')
  await ui.unmount()

  await $.tool.call({ tool: 'TaskList' })
  ui = await mountPane($, 'terminal')
  expect((await ui.find({ key: 'summary' }))?.text).toBe('완료 1/2 · 50%')
  const list = (await ui.find({ key: 'tasks' }))?.text
  expect(list).toContain('● 정답표')
  expect(list).toContain('○ 검수')
  expect(list).not.toContain('설계도')
  await ui.unmount()
})

test('항목이 없으면 0/0과 안내 문구를 보여 준다', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'summary' }))?.text).toBe('완료 0/0 · 0%')
    expect((await ui.find({ key: 'left' }))?.text).toBe('완료 0개 · 남은 작업 0개')
    const list = (await ui.find({ key: 'tasks' }))?.text
    expect(list).toContain('작업 목록 (0)')
    expect(list).toContain('체크리스트 항목이 아직 없습니다.')
    expect((await ui.find({ key: 'meter' }))?.text).toBe('░'.repeat(20))
    await ui.unmount()
  }
})

for (const surface of SURFACES) {
  test(`표시 방식 버튼이 막대·도넛·퍼센트를 바꾸고 저장한다 (${surface})`, async ($, on) => {
    const saved = world(on)
    taskTools(on)
    await threeTasks($)

    const ui = await mountPane($, surface)
    // Default: the bar, 7 of 20 cells for 1/3.
    expect((await ui.find({ key: 'meter' }))?.text).toBe('█'.repeat(7) + '░'.repeat(13))
    expect((await ui.find({ key: 'style-bar' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'style-donut' }))?.props.variant).toBe('secondary')

    await ui.press({ key: 'style-donut' })
    expect(saved.style).toBe('donut')
    expect((await ui.find({ key: 'style-donut' }))?.props.variant).toBe('primary')
    const donut = await ui.find({ key: 'meter' })
    expect(donut?.text).not.toContain('█')
    if (surface === 'terminal') {
      // Twelve beads, round(33% of 12) = 4 filled, the percent in the middle.
      expect(donut?.text).toContain('33%')
      expect([...(donut?.text ?? '')].filter(c => c === '●')).toHaveLength(4)
      expect([...(donut?.text ?? '')].filter(c => c === '○')).toHaveLength(8)
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg).toBeDefined()
      expect(svg?.props.alt).toBe('진행률 33%')
      expect(String(svg?.props.source)).toContain('>33%</text>')
    }

    await ui.press({ key: 'style-percent' })
    expect(saved.style).toBe('percent')
    expect((await ui.find({ key: 'meter' }))?.text).toBe('33%')
    expect((await ui.find({ key: 'style-percent' }))?.props.variant).toBe('primary')

    await ui.press({ key: 'style-bar' })
    expect(saved.style).toBe('bar')
    expect((await ui.find({ key: 'meter' }))?.text).toBe('█'.repeat(7) + '░'.repeat(13))
    await ui.unmount()
  })
}

test('/progress는 Pane을 열고 닫으며, 인자로 표시 방식을 고른다', async ($, on) => {
  const saved = world(on)
  const open = new Set<string>()
  on('ui.open', async (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => ({
    value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))

  const run = (args: string) =>
    $.command.run({
      command: 'progress',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  expect((await run('')).text).toBe('작업 진행률 Pane을 열었습니다.')
  expect(open.has('task-progress')).toBe(true)
  expect((await run('')).text).toBe('작업 진행률 Pane을 닫았습니다.')
  expect(open.has('task-progress')).toBe(false)

  expect((await run('도넛')).text).toBe('작업 진행률 Pane을 열었습니다. 표시 방식: 도넛.')
  expect(open.has('task-progress')).toBe(true)
  expect(saved.style).toBe('donut')
  // A style word while open keeps it open and switches.
  expect((await run('Percent')).text).toBe('작업 진행률 Pane을 열었습니다. 표시 방식: 퍼센트.')
  expect(open.has('task-progress')).toBe(true)
  expect(saved.style).toBe('percent')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'meter' }))?.text).toBe('0%')
    await ui.unmount()
  }

  expect((await run('원형')).text).toBe('모르는 표시 방식입니다: 원형 (퍼센트, 막대, 도넛 중 하나)')
  expect(open.has('task-progress')).toBe(true)
  expect(saved.style).toBe('percent')
})

test('/progress는 Pane을 둘 곳이 없으면 그 이유를 말한다', async ($, on) => {
  world(on)
  on('ui.open', async () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  on('ui.panes', async () => ({ value: [] }))

  const ran = await $.command.run({
    command: 'progress',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toBe('이 화면에는 Pane이 표시되지 않습니다(no-surface). 진행판 파일 progress.md에서 볼 수 있습니다.')
})

test('메인 모델과 서브에이전트의 모델·추론 수준을 묶어 센다', async ($, on) => {
  world(on)
  let spawned = 0
  on('agent.spawn', async (_$, e) => ({ model: e.model ?? e.parentModel, agentId: `agent-${++spawned}` }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))

  const step = async (model: string, effort: 'low' | 'high', agentId?: string) => {
    const stream = $.turn.step({
      turnId: agentId ? `turn-${agentId}` : 'turn-main',
      index: 0,
      model,
      effort,
      messageCount: 1,
      ...(agentId ? { agentId } : {}),
    })
    for await (const _chunk of stream) {
      // The engine's chunks: nothing streamed beneath.
    }
    return stream.result
  }
  const spawn = (model: string, description: string) =>
    $.agent.spawn({
      tool_use_id: `toolu-${description}`,
      prompt: description,
      description,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      model,
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    })

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const models = (await ui.find({ key: 'models' }))?.text
    expect(models).toContain('메인 · 아직 기록 없음')
    expect(models).toContain('서브에이전트 0개')
    expect(models).not.toContain('실행 중')
    await ui.unmount()
  }

  await step('claude-opus-5-5', 'high')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'models' }))?.text).toContain('메인 · Opus 5.5 · high')
    await ui.unmount()
  }

  const haiku = await spawn('claude-haiku-4-5', '단어 추출')
  const opus = await spawn('claude-opus-5-5', '해설 작성')
  expect(haiku.agentId).toBe('agent-1')
  expect(opus.agentId).toBe('agent-2')

  // Before their first step the effort is unknown.
  let ui = await mountPane($, 'terminal')
  let models = (await ui.find({ key: 'models' }))?.text
  expect(models).toContain('서브에이전트 2개 (실행 중 2)')
  expect(models).toContain('Haiku 4.5 · 기본 ×1 · 실행 중 1')
  expect(models).toContain('Opus 5.5 · 기본 ×1 · 실행 중 1')
  await ui.unmount()

  await step('claude-haiku-4-5', 'low', 'agent-1')
  await step('claude-opus-5-5', 'high', 'agent-2')
  // The main loop's model is not touched by a subagent's step.
  ui = await mountPane($, 'terminal')
  models = (await ui.find({ key: 'models' }))?.text
  expect(models).toContain('메인 · Opus 5.5 · high')
  expect(models).toContain('Haiku 4.5 · low ×1 · 실행 중 1')
  expect(models).toContain('Opus 5.5 · high ×1 · 실행 중 1')
  expect(models).not.toContain('기본')
  await ui.unmount()

  await $.turn.complete({
    answer: '끝',
    durationMs: 10,
    isAborted: false,
    turnId: 'turn-agent-1',
    agentId: 'agent-1',
    reason: 'answer',
  })

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const models = (await ui.find({ key: 'models' }))?.text ?? ''
    expect(models).toContain('메인 · Opus 5.5 · high')
    expect(models).toContain('서브에이전트 2개 (실행 중 1)')
    expect(models).toContain('Opus 5.5 · high ×1 · 실행 중 1')
    expect(models).toContain('Haiku 4.5 · low ×1')
    expect(models).not.toContain('Haiku 4.5 · low ×1 · 실행 중')
    // The busiest group first.
    expect(models.indexOf('Opus 5.5 · high ×1')).toBeLessThan(models.indexOf('Haiku 4.5 · low ×1'))
    await ui.unmount()
  }

  // A second opus/high subagent joins its group; a failed end is not running.
  await spawn('claude-opus-5-5', '검수')
  await step('claude-opus-5-5', 'high', 'agent-3')
  await $.turn.complete({
    answer: '',
    durationMs: 10,
    isAborted: true,
    turnId: 'turn-agent-2',
    agentId: 'agent-2',
    reason: 'aborted',
  })
  const desk = await mountPane($, 'desktop')
  models = (await desk.find({ key: 'models' }))?.text
  expect(models).toContain('서브에이전트 3개 (실행 중 1)')
  expect(models).toContain('Opus 5.5 · high ×2 · 실행 중 1')
  expect(models).toContain('Haiku 4.5 · low ×1')
  await desk.unmount()
})

test('세션 시작 때 저장된 표시 방식을 되살리고 TaskList로 목록을 맞춘다', async ($, on) => {
  const saved = world(on)
  saved.style = 'percent'
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.call', { tool: 'TaskList' }, async () => ({
    result: { tasks: [{ id: '1', subject: '지문 분석', status: 'completed', blockedBy: [] }] },
  }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'meter' }))?.text).toBe('100%')
    expect((await ui.find({ key: 'summary' }))?.text).toBe('완료 1/1 · 100%')
    await ui.unmount()
  }
})

test('progress.md는 표시 방식별 진행률, 모델, 동그라미 목록을 Markdown으로 쓴다', async () => {
  const tasks = [
    { id: '1', subject: '지문 분석', status: 'completed' },
    { id: '2', subject: '단어 *추출*', status: 'in_progress' },
    { id: '3', subject: '해설 작성', status: 'pending' },
  ] as const
  const agents = [
    { id: 'a', description: '', type: 'general', model: 'claude-haiku-4-5', effort: 'low', status: 'running' },
  ] as const
  const page = (style: 'percent' | 'bar' | 'donut') =>
    progressMarkdown({ tasks, agents, main: { model: 'claude-opus-5-5', effort: 'high' }, style, updatedAt: 't' })

  const bar = page('bar')
  expect(bar).toContain('**완료 1/3 · 33%**')
  expect(bar).toContain('`███████░░░░░░░░░░░░░` 33%')
  expect(bar).toContain('완료 1개 · 남은 작업 2개')
  expect(bar).toContain('- 메인 · Opus 5.5 · high')
  expect(bar).toContain('- 서브에이전트 1개 (실행 중 1)')
  expect(bar).toContain('  - Haiku 4.5 · low ×1 · 실행 중 1')
  expect(bar).toContain('- 🔵 ~~지문 분석~~\n- ◐ **단어 \\*추출\\*** _(진행 중)_\n- ⚪ 해설 작성')
  expect(page('percent')).toContain('## 33%')
  const donut = page('donut')
  expect(donut).toContain('33%')
  expect(donut.split('●').length - 1).toBe(4)
  expect(donut.split('○').length - 1).toBe(8)
  expect(progressMarkdown({ tasks: [], agents: [], main: null, style: 'bar', updatedAt: 't' })).toContain(
    '체크리스트 항목이 아직 없습니다.',
  )
})
