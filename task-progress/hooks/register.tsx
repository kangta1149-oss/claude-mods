import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, ModelUse, ProgressStyle, RequestItem, TaskItem, TaskStatus } from '../types'
import {
  BLUE,
  STYLES,
  activityOf,
  agentGroups,
  boardOf,
  donutSvg,
  durationLabel,
  isStyle,
  modelLabel,
  nextBatch,
  nowLine,
  progressMarkdown,
  requestMark,
  requestRow,
  ringRows,
  taskMark,
  titleOf,
} from './view'

const PANE = 'task-progress'
const TITLE = '작업 진행률'
const FILE = 'progress.md'
const STYLE_KEY = 'style'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, [])
const main = atom({ plugin: 'task-progress', key: 'main' } as const, null)
const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, [])
const style = atom({ plugin: 'task-progress', key: 'style' } as const, 'bar')
const requests = atom({ plugin: 'task-progress', key: 'requests' } as const, [])

const MAX_REQUESTS = 100

/**
 * Appended to the system prompt: the board follows the task list, so work of
 * several steps should keep one, across the follow-up messages too.
 */
const CHECKLIST_GUIDE = [
  'The user watches this session on a progress board built from your task list (TaskCreate/TaskUpdate, or TodoWrite).',
  'For any request that takes more than one step (several tool calls, files or stages), create the task list before starting,',
  'mark an item in_progress when you start it and completed as soon as it is done, and keep using the same list across the',
  "user's follow-up messages, adding items for new work. A request answered in a single step needs no task list.",
].join(' ')

const isStatus = (value: unknown): value is TaskStatus =>
  value === 'pending' || value === 'in_progress' || value === 'completed'

const effortOf = (effort: string | number | undefined) => (effort === undefined ? undefined : String(effort))

function clockNow() {
  try {
    return new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return new Date().toISOString().slice(11, 16)
  }
}

/**
 * A listed checklist taken whole: known tasks keep their batch, and the ones
 * this module had not seen (a resume, a reload) join one batch together, since
 * a listing says nothing of when each was made.
 */
function withBatches(listed: readonly { id: string; subject: string; status: TaskStatus }[], known: readonly TaskItem[]) {
  const kept = known.filter(one => listed.some(task => task.id === one.id))
  const fresh = nextBatch(kept)

  return listed.map(task => ({ ...task, batch: known.find(one => one.id === task.id)?.batch ?? fresh }))
}

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
    requests: await read($, requests),
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
      await update($, tasks, known => withBatches(listed, known))
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
      await setTasks($, list => {
        const others = list.filter(task => task.id !== created.id)

        return [...others, { ...created, batch: nextBatch(others) }]
      })
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && ran.result.success) {
      await setTasks($, list => {
        if (e.status === 'deleted') return list.filter(task => task.id !== e.taskId)
        if (!list.some(task => task.id === e.taskId)) {
          const added: TaskItem = {
            id: e.taskId,
            subject: e.subject ?? `#${e.taskId}`,
            status: isStatus(e.status) ? e.status : 'pending',
            batch: nextBatch(list),
          }

          return [...list, added]
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
      await setTasks($, known => withBatches(listed, known))
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
        batch: 1,
      }))
      await setTasks($, () => listed)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Every tool call of the main loop is a step of the request it serves, and
  // says what that request is doing now.
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, requests)).some(request => request.status === 'running')) {
      const activity = activityOf(String(e.tool))
      await update($, requests, list => {
        const at = list.map(request => request.status).lastIndexOf('running')

        return list.map((request, index) => (index === at ? { ...request, steps: request.steps + 1, activity } : request))
      })
      await mirror($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A message the person sent opens a request; a turn with no text (a
  // continuation) goes on with the latest one.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const title = titleOf(e.text)
      if (title !== '') {
        const opened: RequestItem = { id: e.turnId, title, status: 'running', startedAt: clockNow(), steps: 0 }
        await update($, requests, list => [...list, opened].slice(-MAX_REQUESTS))
      } else {
        const resumed: RequestItem = { id: e.turnId, title: '이어서 진행', status: 'running', startedAt: clockNow(), steps: 0 }
        await update($, requests, list =>
          list.length === 0
            ? [resumed]
            : list.map((request, index): RequestItem =>
                index === list.length - 1 ? { ...request, status: 'running', took: undefined } : request,
              ),
        )
      }
      await mirror($)
    }

    return next(e)
  })

  // The board follows the task list: ask for one on work of several steps.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, { id: 'task-progress', text: CHECKLIST_GUIDE, scope: 'session' }] }
  })

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
    if (id === undefined) {
      const status = e.reason === 'answer' ? 'done' : 'stopped'
      const took = durationLabel(e.durationMs)
      await update($, requests, list => {
        const byTurn = list.findIndex(request => request.id === e.turnId && request.status === 'running')
        const at = byTurn >= 0 ? byTurn : list.map(request => request.status).lastIndexOf('running')

        return list.map((request, index) => (index === at ? { ...request, status, took, activity: undefined } : request))
      })
      await mirror($)
    } else if ((await read($, agents)).some(one => one.id === id)) {
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, all => all.map(one => (one.id === id ? { ...one, status } : one)))
      await mirror($)
    }

    return ended
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const chosen = await read($, style)
    const mainUse = await read($, main)
    const runs = await read($, agents)
    const board = boardOf(await read($, tasks), await read($, requests))
    const { percent } = board
    const width = Math.max(10, e.props.bodyColumns)
    const filled = Math.round((percent / 100) * width)
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
          <Text bold>{board.label}</Text>
        </Box>
        <Box key="left">
          <Text dimColor>{board.left}</Text>
        </Box>
        <Box key="now" marginTop={1}>
          <Text color={board.latest?.status === 'running' ? BLUE : undefined} wrap="truncate-end">
            지금 · {nowLine(board.latest)}
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
          <Text bold>체크리스트 ({board.current.length})</Text>
          {board.current.length === 0 && <Text dimColor>체크리스트 항목이 아직 없습니다.</Text>}
          {board.current.map(task => (
            <Box flexDirection="row">
              <Text color={BLUE} dimColor={task.status === 'pending'}>
                {taskMark(task.status)}{' '}
              </Text>
              <Text dimColor={task.status === 'completed'} bold={task.status === 'in_progress'} wrap="truncate-end">
                {task.subject}
              </Text>
            </Box>
          ))}
          {board.earlier.tasks > 0 && (
            <Text dimColor>
              앞서 끝낸 체크리스트 {board.earlier.batches}개 · 항목 {board.earlier.tasks}개
            </Text>
          )}
        </Box>

        <Box key="requests" flexDirection="column" marginTop={1}>
          <Text bold>요청 기록 ({board.recent.length + board.olderRequests})</Text>
          {board.recent.length === 0 && <Text dimColor>아직 보낸 요청이 없습니다.</Text>}
          {board.olderRequests > 0 && <Text dimColor>이전 요청 {board.olderRequests}개는 접어 둠</Text>}
          {board.recent.map(request => (
            <Box flexDirection="row">
              <Text color={BLUE} dimColor={request.status === 'stopped'}>
                {requestMark(request.status)}{' '}
              </Text>
              <Text dimColor={request.status !== 'running'} bold={request.status === 'running'} wrap="truncate-end">
                {requestRow(request)}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
