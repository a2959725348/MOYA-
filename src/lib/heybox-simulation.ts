// Browser-only simulator: no credentials, storage, network or platform adapter.
import {defaultHeyboxSettings,validateHeyboxSettings,matchHeyboxSample,previewHeyboxReplies,type HeyboxSettings} from './heybox-settings'
export const SIMULATION_STEPS = [
  {id: 'read', label: '读取样本'}, {id: 'filter', label: '关键词筛选'},
  {id: 'analyze', label: '需求判断'}, {id: 'review', label: '模拟审核'},
  {id: 'reply', label: '模拟回帖'}, {id: 'follow', label: '模拟关注'},
  {id: 'message', label: '模拟私信'}, {id: 'done', label: '结果归档'},
] as const
export type SimulationStep = typeof SIMULATION_STEPS[number]['id']
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'failed' | 'completed'
export type SimulationScenario = 'success' | 'retry'
export type SimulationJob = {
  id: string; name: string; title:string;topic:string;sourceUrl:string; text: string; target: 'self' | 'other'; allowFollow: boolean;
  messageRequested: boolean; status: 'queued' | 'processing' | 'completed' | 'skipped' | 'failed';
  stepIndex: number; completedSteps: SimulationStep[]; attempts: number; draft: string; messageDraft:string;contactRequested:boolean; reason: string;
}
export type SimulationLog = {
  id: string; mode: 'simulation'; jobId: string | null; user: string; time: string;
  step: SimulationStep | 'system'; result: 'success' | 'skipped' | 'error' | 'info'; message: string;
}
export type Simulation = {
  mode: 'simulation'; scenario: SimulationScenario; status: SimulationStatus; duplicates: number;
  currentIndex: number; jobs: SimulationJob[]; logs: SimulationLog[];settings:HeyboxSettings;
}

const samples = [
  {id: 'sample-a', name: '测试用户 A',title:'ChatGPT 订阅求助',topic:'AI 工具',sourceUrl:'https://example.invalid/heybox/post/1001', text: 'ChatGPT 怎么订阅？请给我免费教程，可以私信发我，也欢迎你关注我。', target: 'self', allowFollow: true, messageRequested: true,contactRequested:false},
  {id: 'sample-b', name: '测试用户 B',title:'订阅问题已解决',topic:'AI 工具',sourceUrl:'https://example.invalid/heybox/post/1002', text: 'ChatGPT 订阅已经解决，不需要教程了。', target: 'self', allowFollow: false, messageRequested: false,contactRequested:false},
  {id: 'sample-c', name: '测试用户 C',title:'ChatGPT 教程讨论',topic:'游戏交流',sourceUrl:'https://example.invalid/heybox/post/1003', text: '回复其他用户：ChatGPT 求教程，求私。', target: 'other', allowFollow: false, messageRequested: false,contactRequested:false},
  {id: 'sample-d', name: '测试用户 D',title:'订阅支付失败求助',topic:'订阅问答',sourceUrl:'https://example.invalid/heybox/post/1004', text: 'ChatGPT 订阅支付失败，想了解排查方法，请私信给我教程和联系方式，不需要关注。', target: 'self', allowFollow: false, messageRequested: true,contactRequested:true},
] satisfies Pick<SimulationJob, 'id' | 'name' | 'title' | 'topic' | 'sourceUrl' | 'text' | 'target' | 'allowFollow' | 'messageRequested' | 'contactRequested'>[]

function log(state: Simulation, step: SimulationLog['step'], result: SimulationLog['result'], message: string, job: SimulationJob | null = null, time = new Date().toISOString()): Simulation {
  return {...state, logs: [...state.logs, {id: `log-${state.logs.length + 1}`, mode: 'simulation', jobId: job?.id ?? null, user: job?.name ?? '测试系统', time, step, result, message}]}
}

export function createSimulation(scenario: SimulationScenario = 'retry',settings:HeyboxSettings=defaultHeyboxSettings()): Simulation {
  const input = [...samples, samples[0]], unique = new Map(input.map(s => [s.id, s]))
  const state: Simulation = {
    mode: 'simulation', scenario, status: 'idle', duplicates: input.length - unique.size, currentIndex: 0,
    jobs: [...unique.values()].map(s => ({...s, status: 'queued', stepIndex: 0, completedSteps: [], attempts: 0, draft: '',messageDraft:'', reason: ''})), logs: [],settings:validateHeyboxSettings(settings),
  }
  return log(state, 'system', 'info', '已准备 4 名合成测试用户；另有 1 条重复输入被去重。没有连接真实账号。')
}

export function startSimulation(state: Simulation): Simulation {
  return state.status === 'idle' ? log({...state, status: 'running'}, 'system', 'info', '开始浏览器内模拟；回帖、关注、私信均不产生网络请求。') : state
}
export function pauseSimulation(state: Simulation): Simulation {
  return state.status === 'running' ? log({...state, status: 'paused'}, 'system', 'info', '已暂停；当前位置保留，不再推进任何模拟步骤。') : state
}
export function resumeSimulation(state: Simulation): Simulation {
  return state.status === 'paused' ? log({...state, status: 'running'}, 'system', 'info', '从暂停位置继续模拟。') : state
}
export function retrySimulation(state: Simulation): Simulation {
  const job = state.jobs[state.currentIndex]
  if (state.status !== 'failed' || job?.status !== 'failed') return state
  const jobs = state.jobs.map((j, i) => i === state.currentIndex ? {...j, status: 'processing' as const, reason: ''} : j)
  return log({...state, status: 'running', jobs}, 'system', 'info', '仅重试失败的模拟私信步骤，已完成回帖与关注不会重复执行。', job)
}

export function advanceSimulation(state: Simulation, now = new Date().toISOString()): Simulation {
  if (state.status !== 'running') return state
  const prior = state.jobs[state.currentIndex]
  if (!prior) return {...state, status: 'completed'}
  const job: SimulationJob = {...prior, status: 'processing', completedSteps: [...prior.completedSteps]}
  const step = SIMULATION_STEPS[job.stepIndex].id
  let result: SimulationLog['result'] = 'success', message = '', terminal = false
  switch (step) {
    case 'read': message = '读取合成帖子和楼中楼样本；未访问小黑盒。'; break
    case 'filter': {
      const match=matchHeyboxSample(state.settings,job)
      if (!match.matched) {
        job.status = 'skipped'; job.reason = match.reason; result = 'skipped'; terminal = true
      }
      message = match.reason; break
    }
    case 'analyze': {
      const replies=previewHeyboxReplies(state.settings,job)
      job.draft = replies.publicReply;job.messageDraft=[replies.tutorialMessage,replies.contactMessage].filter(Boolean).join('\n\n')
      if(replies.notice)job.reason=replies.notice
      message = '按本次保存的规则与模板生成预览；本步骤未调用大模型。'; break
    }
    case 'review':
      if (job.target === 'other') {
        job.status = 'skipped'; job.reason = '请求指向其他用户，不视为向当前账号提出的咨询。'; result = 'skipped'; terminal = true
      }
      message = terminal ? job.reason : '预设测试审核通过；只表示模拟条件满足，不是平台许可或真实用户同意。'; break
    case 'reply': result=job.draft?'success':'skipped';message = job.draft?'模拟回帖成功。没有发送真实评论。':'没有可用公开草稿，跳过模拟回帖。'; break
    case 'follow':
      result = job.allowFollow ? 'success' : 'skipped'
      message = job.allowFollow ? '模拟关注成功。没有关注真实用户。' : '样本未要求关注，跳过模拟关注。'; break
    case 'message':
      if (!job.messageRequested||!job.messageDraft) {result = 'skipped'; message = '没有明确私信请求或可用草稿，跳过模拟发送。'; break}
      job.attempts++
      if (state.scenario === 'retry' && job.id === 'sample-d' && job.attempts === 1) {
        job.status = 'failed'; job.reason = '注入的测试异常：模拟私信发送失败。'; result = 'error'; message = `${job.reason} 流程已停止，点击“重试失败步骤”继续。`
      } else message = '模拟私信成功；收件人和内容均为测试数据，实际发送量为 0。'
      break
    case 'done': job.status = 'completed'; terminal = true; message = '该用户模拟流程已完成，结果仅保存在当前页面内存。'; break
  }
  if (job.status !== 'failed') {job.completedSteps.push(step); job.stepIndex = Math.min(job.stepIndex + 1, SIMULATION_STEPS.length - 1)}
  const jobs = state.jobs.map((j, i) => i === state.currentIndex ? job : j)
  const nextIndex = terminal ? state.currentIndex + 1 : state.currentIndex
  const status: SimulationStatus = job.status === 'failed' ? 'failed' : nextIndex >= jobs.length ? 'completed' : 'running'
  return log({...state, jobs, currentIndex: nextIndex, status}, step, result, message, job, now)
}

export function simulationSummary(state: Simulation) {
  const completed = state.jobs.filter(j => j.status === 'completed').length
  const skipped = state.jobs.filter(j => j.status === 'skipped').length
  const failed = state.jobs.filter(j => j.status === 'failed').length
  const doneSteps = state.jobs.reduce((n, j) => n + (j.status === 'completed' || j.status === 'skipped' ? SIMULATION_STEPS.length : j.completedSteps.length), 0)
  return {total: state.jobs.length, completed, skipped, failed,
    progress: Math.round(doneSteps / (state.jobs.length * SIMULATION_STEPS.length) * 100),
    messages: state.logs.filter(l => l.step === 'message' && l.result === 'success').length,
    replies: state.logs.filter(l => l.step === 'reply' && l.result === 'success').length,
    follows: state.logs.filter(l => l.step === 'follow' && l.result === 'success').length,
  }
}
