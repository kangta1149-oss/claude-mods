import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, ModelUse, ProgressStyle, TaskItem, TaskStatus } from '../types'
import {
  BLUE,
  STYLES,
  agentGroups,
  donutSvg,
  isStyle,
  modelLabel,
  progressMarkdown,
  ringRows,
  summarize,
  taskMark,
} from './view'

const PANE = 'task-progress'
const TITLE = '작업 진행률'
const FILE = 'progress.md'
const STYLE_KEY = 'style'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, [])
const main = atom({ plugin: 'task-progress', key: 'main' } as const, null)
const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, [])
const style = atom({ plugin: 'task-progress', key: 'style' } as const, 'bar')

const isStatus = (value: unknown): value is TaskStatus =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

const effortOf = (effort: string | number | undefined) => (effort === undefined ? undefined : String(effort))

// Set from the plugin's options each time the module loads.
let fileMode: 'auto' | 'always' | 'off' = 'auto'

// The board as a file, for a session nothing draws a pane in (a cloud session
// seen through the Claude app). `auto` writes it only there.
async function mirror($: EngineInterface) {
  if (fileMode === 'off') return
  if (fileMode === 'auto') {
    const isCloud = (await $.env.get('CLAUDE_CODE_REMOTE')) === 'true'
    if (!isCloud || (await $.session.surfaces()).length > 0) return
  }
  let updatedAt: string
  try {
    updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  } catch {
    updatedAt = new Date().toISOString()
  }
  const page = progressMarkdown({
    tasks: await read($, tasks),
    main: await read($, main),
    agents: await read($, agents),
    style: await read($, style),
    updatedAt,
  })
  try {
    await $.fs.write(FILE, page)
  } catch {
    // A read-only folder: the pane is all there is.
  }
}

async function setTasks($: EngineInterface, change: (list: readonly TaskItem[]) => TaskItem[]) {
  await update($, tasks, list => change(list))
  await mirror($)
}

async function setStyle($: EngineInterface, next: ProgressStyle) {
  await update($, style, () => next)
  await $.store.set(STYLE_KEY, next)
  await mirror($)
}

// TaskList is the engine's own record of the checklist: read it whenever the
// list may have changed outside the calls this module watched (a resume, a reload).
async function resync($: EngineInterface) {
  try {
    const ran = await $.tool.call({ tool: 'TaskList' })
    if (ran.deny === undefined && !ran.isError) {
      const listed = ran.result.tasks.map(task => ({ id: task.id, subject: task.subject, status: task.status }))
      await update($, tasks, () => listed)
    }
  } catch {
    // No task tools in this session: the list stays as the watched calls left it.
  }
  await mirror($)
}

export const register: Register = (on, options) => {
  fileMode = options.progressFile === 'always' || options.progressFile === 'off' ? options.progressFile : 'auto'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress',
      description: '작업 진행률 Pane을 열고 닫는다 (/progress 퍼센트 | 막대 | 도넛 으로 표시 방식 변경)',
      argumentHint: '[퍼센트|막대|도넛]',
    })
    const saved = await $.store.get(STYLE_KEY)
    if (isStyle(saved)) await update($, style, () => saved)
    void resync($)

    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    const chosen = STYLES.find(one => one.words.includes(word))

    if (word !== '' && chosen === undefined) {
      return { text: `모르는 표시 방식입니다: ${word} (퍼센트, 막대, 도넛 중 하나)` }
    }
    if (chosen === undefined && isOpen) {
      await $.ui.close({ id: PANE })

      return { text: '작업 진행률 Pane을 닫았습니다.' }
    }
    if (chosen !== undefined) await setStyle($, chosen.style)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const styleText = chosen ? ` 표시 방식: ${chosen.label}.` : ''
    if (opened.isPlaced) return { text: `작업 진행률 Pane을 열었습니다.${styleText}` }
    await mirror($)
    const fileText = fileMode === 'off' ? '' : ` 진행판 파일 ${FILE}에서 볼 수 있습니다.`

    return { text: `이 화면에는 Pane이 표시되지 않습니다(${opened.reason}).${styleText}${fileText}` }
  })

  // These watchers never decide a tool call: if one fails, the call stands as it ran.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const created: TaskItem = {
        id: ran.result.task.id,
        subject: ran.result.task.subject || e.subject,
        status: 'pending',
      }
      await setTasks($, list => [...list.filter(task => task.id !== created.id), created])
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && ran.result.success) {
      await setTasks($, list => {
        if (e.status === 'deleted') return list.filter(task => task.id !== e.taskId)
        if (!list.some(task => task.id === e.taskId)) {
          return [...list, { id: e.taskId, subject: e.subject ?? `#${e.taskId}`, status: isStatus(e.status) ? e.status : 'pending' }]
        }

        return list.map(task =>
          task.id === e.taskId
            ? { ...task, subject: e.subject ?? task.subject, status: isStatus(e.status) ? e.status : task.status }
            : task,
        )
      })
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The model's own TaskList answer is the whole list: take it as it is.
  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const listed = ran.result.tasks.map(task => ({ id: task.id, subject: task.subject, status: task.status }))
      await setTasks($, () => listed)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Sessions on the older checklist tool: each call carries the whole list.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError) {
      const listed = ran.result.newTodos.map((todo, index) => ({
        id: `todo-${index + 1}`,
        subject: todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content,
        status: todo.status,
      }))
      await setTasks($, () => listed)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A subagent joins the board once the engine has started it and named its model.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny === undefined && spawned.agentId !== undefined) {
      const run: AgentRun = {
        id: spawned.agentId,
        description: e.description,
        type: e.subagentType,
        model: spawned.model,
        status: 'running',
      }
      await update($, agents, list => [...list.filter(one => one.id !== run.id), run].slice(-50))
      await mirror($)
    }

    return spawned
  }).catch(($, e, next) => next(e))

  // Every model request names the model and effort it is sent with: the main
  // loop's becomes "메인", a subagent's corrects what its spawn guessed.
  on('turn.step', async function* ($, e, next) {
    const use: ModelUse = { model: e.model, effort: effortOf(e.effort) }
    if (e.agentId === undefined) {
      const was = await read($, main)
      if (was?.model !== use.model || was?.effort !== use.effort) {
        await update($, main, () => use)
        await mirror($)
      }
    } else {
      const id = e.agentId
      const list = await read($, agents)
      const known = list.find(one => one.id === id)
      if (known && (known.model !== use.model || known.effort !== use.effort)) {
        await update($, agents, all => all.map(one => (one.id === id ? { ...one, ...use } : one)))
        await mirror($)
      }
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    const id = e.agentId
    if (id !== undefined && (await read($, agents)).some(one => one.id === id)) {
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, all => all.map(one => (one.id === id ? { ...one, status } : one)))
      await mirror($)
    }

    return ended
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, tasks)
    const chosen = await read($, style)
    const mainUse = await read($, main)
    const runs = await read($, agents)
    const { done, total, left, percent, label } = summarize(list)
    const width = Math.max(10, e.props.bodyColumns)
    const filled = total === 0 ? 0 : Math.round((done / total) * width)
    const running = runs.filter(one => one.status === 'running').length

    let meter
    if (chosen === 'percent') {
      meter = (
        <Box key="meter" flexDirection="column">
          <Text bold color={BLUE} size="title">
            {percent}%
          </Text>
        </Box>
      )
    } else if (chosen === 'bar') {
      meter = (
        <Box key="meter" flexDirection="row">
          <Text color={BLUE}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
        </Box>
      )
    } else if (e.surface === 'terminal') {
      meter = (
        <Box key="meter" flexDirection="column">
          {ringRows(percent).map(row => (
            <Box flexDirection="row">
              {row.map(run =>
                run.isBead ? (
                  <Text color={BLUE} dimColor={!run.isFilled}>
                    {run.text}
                  </Text>
                ) : (
                  <Text bold>{run.text}</Text>
                ),
              )}
            </Box>
          ))}
        </Box>
      )
    } else {
      const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
      meter = (
        <Box key="meter">
          <Svg source={donutSvg(percent)} alt={`진행률 ${percent}%`} width={120} height={120} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box key="styles" flexDirection="row" gap={1}>
          {STYLES.map(one => (
            <Button
              key={`style-${one.style}`}
              label={one.label}
              variant={one.style === chosen ? 'primary' : 'secondary'}
              onPress={() => void setStyle($, one.style)}
            />
          ))}
        </Box>
        <Box key="gap-1" marginTop={1} />
        {meter}
        <Box key="summary">
          <Text bold>{label}</Text>
        </Box>
        <Box key="left">
          <Text dimColor>
            완료 {done}개 · 남은 작업 {left}개
          </Text>
        </Box>

        <Box key="models" flexDirection="column" marginTop={1}>
          <Text bold>모델</Text>
          <Text>메인 · {mainUse ? modelLabel(mainUse) : '아직 기록 없음'}</Text>
          <Text>
            서브에이전트 {runs.length}개{running > 0 ? ` (실행 중 ${running})` : ''}
          </Text>
          {agentGroups(runs).map(group => (
            <Text dimColor={group.running === 0}>
              {'  '}
              {group.label} ×{group.count}
              {group.running > 0 ? ` · 실행 중 ${group.running}` : ''}
            </Text>
          ))}
        </Box>

        <Box key="tasks" flexDirection="column" marginTop={1}>
          <Text bold>작업 목록 ({total})</Text>
          {total === 0 && <Text dimColor>체크리스트 항목이 아직 없습니다.</Text>}
          {list.map(task => (
            <Box flexDirection="row">
              <Text color={BLUE} dimColor={task.status === 'pending'}>
                {taskMark(task.status)}{' '}
              </Text>
              <Text dimColor={task.status === 'completed'} bold={task.status === 'in_progress'} wrap="truncate-end">
                {task.subject}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
