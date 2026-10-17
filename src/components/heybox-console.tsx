import {useEffect, useState} from 'react'
import {Activity, Check, ChevronRight, FlaskConical, MessageSquare, Pause, Play, RotateCcw, Send, Users} from 'lucide-react'
import {Badge, Button, Panel, SectionTitle} from './common'
import {createSimulation, startSimulation, advanceSimulation, pauseSimulation, resumeSimulation, retrySimulation, simulationSummary, SIMULATION_STEPS, type SimulationJob, type SimulationScenario, type SimulationStatus} from '../lib/heybox-simulation'
import './heybox-console.css'
import HeyboxSettingsEditor from './heybox-settings-editor'
import {defaultHeyboxSettings,loadHeyboxSettings,saveHeyboxSettings,validateHeyboxSettings,type HeyboxSettings} from '../lib/heybox-settings'

const runLabels: Record<SimulationStatus, string> = {idle: '等待开始', running: '正在运行', paused: '已暂停', failed: '等待重试', completed: '测试完成'}
const jobLabels: Record<SimulationJob['status'], string> = {queued: '排队中', processing: '处理中', completed: '已完成', skipped: '已忽略', failed: '失败'}
const stepLabel = (id: string) => SIMULATION_STEPS.find(s => s.id === id)?.label ?? '流程控制'
const timeLabel = (time: string) => new Date(time).toLocaleTimeString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})

function ActionState({job, step}: {job: SimulationJob; step: 'reply' | 'follow' | 'message'}) {
  let text = '待执行', tone = 'muted'
  if (job.status === 'skipped') text = '跳过'
  else if (step === 'message' && job.status === 'failed') {text = '模拟失败'; tone = 'red'}
  else if (job.completedSteps.includes(step)) {
    const skipped = (step==='reply'&&!job.draft)||(step === 'follow' && !job.allowFollow) || (step === 'message' && (!job.messageRequested||!job.messageDraft))
    text = skipped ? '跳过' : '模拟成功'; tone = skipped ? 'muted' : 'green'
  } else if (job.status === 'processing' && SIMULATION_STEPS[job.stepIndex].id === step) {text = '模拟处理中'; tone = 'blue'}
  return <Badge variant="outline" className={`badge-${tone}`}>{text}</Badge>
}

export default function HeyboxConsole() {
  const [initialSettings]=useState(()=>{try{return loadHeyboxSettings(window.localStorage)}catch{return {settings:defaultHeyboxSettings(),warning:'浏览器不允许读取设置；使用默认设置。'}}})
  const [savedSettings,setSavedSettings]=useState(initialSettings.settings)
  const [draftSettings,setDraftSettings]=useState(initialSettings.settings)
  const [settingsMessage,setSettingsMessage]=useState(initialSettings.warning)
  const [view,setView]=useState<'flow'|'rules'|'templates'>('flow')
  const [simulation, setSimulation] = useState(() => createSimulation('retry',initialSettings.settings))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logFilter, setLogFilter] = useState<'all' | 'message' | 'error'>('all')
  useEffect(() => {
    if (simulation.status !== 'running') return
    const timer = window.setInterval(() => setSimulation(current => advanceSimulation(current)), 850)
    return () => window.clearInterval(timer)
  }, [simulation.status])

  const summary = simulationSummary(simulation)
  const current = simulation.jobs[simulation.currentIndex]
  const selected = simulation.jobs.find(j => j.id === selectedId) ?? current ?? simulation.jobs[0]
  const logs = simulation.logs.filter(l => logFilter === 'all' || (logFilter === 'message' ? l.step === 'message' : l.result === 'error')).slice().reverse()
  const dirty=JSON.stringify(savedSettings)!==JSON.stringify(draftSettings)
  const changeScenario = (scenario: SimulationScenario) => {setSimulation(createSimulation(scenario,savedSettings)); setSelectedId(null)}
  const saveSettings=()=>{
    try{const next=validateHeyboxSettings(draftSettings);let storage:Storage|null=null;try{storage=window.localStorage}catch{/* Apply in memory if unavailable. */}
      const result=saveHeyboxSettings(storage,next);setSavedSettings(next);setDraftSettings(next);setSimulation(createSimulation(simulation.scenario,next));setSelectedId(null);setLogFilter('all');setSettingsMessage(result.persisted?'已保存到当前浏览器，并应用到新测试。':result.warning)
    }catch(e){setSettingsMessage((e as Error).message)}
  }

  return <div className="heybox-console page-enter">
    <SectionTitle eyebrow="流程 · 对象 · 执行记录" title="小黑盒后台" description="一个界面，看清当前步骤与每个测试对象的处理结果。" action={<Badge variant="outline" className="badge-blue"><FlaskConical size={13}/>模拟测试版</Badge>}/>
    <div className="hb-notice"><FlaskConical size={19}/><div><strong>测试环境 · 真实发送量为 0</strong><p>使用合成用户、预设判断和模拟回执。未连接小黑盒账号，也不会调用大模型 API。</p></div><span className="hb-local">仅当前页面运行</span></div>
    <nav className="segmented hb-console-tabs" aria-label="模拟后台功能">{([['flow','流程监控'],['rules','任务规则'],['templates','回复模板']] as const).map(([value,label])=><button key={value} aria-pressed={view===value} className={view===value?'selected':''} onClick={()=>setView(value)}>{label}</button>)}</nav>
    {settingsMessage&&<p className="hb-settings-status" role="status">{settingsMessage}</p>}
    {dirty&&<p className="hb-settings-status">有未保存的设置修改；开始新测试前请先保存。当前运行使用已保存的设置。</p>}
    {view!=='flow'?<HeyboxSettingsEditor tab={view} settings={draftSettings} samples={simulation.jobs} disabled={simulation.status==='running'} dirty={dirty} onChange={setDraftSettings} onSave={saveSettings} onDefaults={()=>setDraftSettings(defaultHeyboxSettings())}/>:<>

    <div className="hb-metrics">
      {[
        {label: '测试对象', value: summary.total, hint: `已去重 ${simulation.duplicates} 条输入`, icon: Users},
        {label: '当前流程', value: runLabels[simulation.status], hint: current && simulation.status !== 'idle' ? `${current.name} · ${SIMULATION_STEPS[current.stepIndex].label}` : simulation.status === 'completed' ? '全部样本处理结束' : '选择场景后开始', icon: Activity},
        {label: '模拟私信成功', value: summary.messages, hint: '仅模拟回执，不代表真实送达', icon: MessageSquare},
        {label: '真实发送', value: 0, hint: '评论、关注、私信均未执行', icon: Send},
      ].map(m => <div className="hb-metric" key={m.label}><div><span>{m.label}</span><m.icon size={17}/></div><strong>{m.value}</strong><small>{m.hint}</small></div>)}
    </div>

    <Panel title="流程控制" description="正常场景验证完整流程；异常场景验证失败停止与原地重试。" action={<Badge variant="outline" className={simulation.status === 'failed' ? 'badge-red' : simulation.status === 'running' ? 'badge-blue' : 'badge-muted'}><span className={`hb-status-dot ${simulation.status}`}/>{runLabels[simulation.status]}</Badge>}>
      <div className="hb-controls"><label className="field"><span>测试场景</span><select aria-label="测试场景" value={simulation.scenario} disabled={simulation.status !== 'idle'} onChange={e => changeScenario(e.target.value as SimulationScenario)}><option value="retry">异常重试 · 私信首次失败</option><option value="success">正常流程 · 无注入异常</option></select></label><div className="hb-buttons">
        <Button disabled={simulation.status !== 'idle'||dirty} onClick={() => setSimulation(startSimulation)}><Play size={15}/>开始测试</Button>
        <Button variant="outline" disabled={!['running', 'paused'].includes(simulation.status)} onClick={() => setSimulation(simulation.status === 'paused' ? resumeSimulation : pauseSimulation)}>{simulation.status === 'paused' ? <Play size={15}/> : <Pause size={15}/>} {simulation.status === 'paused' ? '继续测试' : '暂停测试'}</Button>
        <Button variant="outline" disabled={simulation.status !== 'failed'} onClick={() => setSimulation(retrySimulation)}><RotateCcw size={15}/>重试失败步骤</Button>
        <Button variant="ghost" disabled={simulation.status === 'running'} onClick={() => {setSimulation(createSimulation(simulation.scenario,savedSettings)); setSelectedId(null); setLogFilter('all')}}><RotateCcw size={15}/>重置测试</Button>
      </div></div>
      <ol className="hb-pipeline" aria-label="模拟流程步骤">{SIMULATION_STEPS.map((s, index) => {
        const done = simulation.status === 'completed'?simulation.jobs.some(j=>j.completedSteps.includes(s.id)):current?.completedSteps.includes(s.id)
        const active = current && current.stepIndex === index && !['idle', 'completed'].includes(simulation.status)
        return <li key={s.id} className={active ? 'active' : done ? 'done' : ''} aria-current={active ? 'step' : undefined}><span>{done ? <Check size={13}/> : index + 1}</span>{s.label}{index < SIMULATION_STEPS.length - 1 && <ChevronRight className="hb-step-arrow" size={13}/>}</li>
      })}</ol>
      <div className="hb-progress-label"><span>整体处理进度</span><strong>{summary.progress}%</strong></div><div className="hb-progress" role="progressbar" aria-label="模拟整体进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.progress}><span style={{width: `${summary.progress}%`}}/></div>
      <p className="hb-result">已完成 {summary.completed} · 已忽略 {summary.skipped} · 失败 {summary.failed} <span>模拟回帖 {summary.replies} · 模拟关注 {summary.follows}</span></p>
      {simulation.status === 'failed' && <div className="hb-error" role="alert">{current?.name} 的模拟私信首次失败，流程已停止。点击“重试失败步骤”后继续；不会重复已完成的回帖。</div>}
      {simulation.status === 'completed' && <div className="hb-complete" role="status"><Check size={16}/>{summary.completed?'本轮模拟流程已完成。真实平台接口、权限及送达情况尚未验证。':'本轮筛选完成，全部样本被忽略；未执行模拟回帖、关注或私信。'}</div>}
    </Panel>

    <div className="hb-workspace"><Panel title="用户任务" description="全部为合成样本。点击“查看”核对请求、草稿和执行条件。">
      <div className="hb-table-wrap"><table className="hb-table"><thead><tr><th>测试对象</th><th>当前步骤</th><th>回帖</th><th>关注</th><th>私信</th><th>详情</th></tr></thead><tbody>{simulation.jobs.map(j => <tr key={j.id} className={j.id === current?.id && simulation.status !== 'idle' ? 'current' : ''}>
        <td><strong>{j.name}</strong><small>{jobLabels[j.status]}</small></td><td data-label="当前步骤">{j.status === 'skipped' ? '无需后续处理' : j.status === 'completed' ? '结果已归档' : SIMULATION_STEPS[j.stepIndex].label}</td><td data-label="回帖"><ActionState job={j} step="reply"/></td><td data-label="关注"><ActionState job={j} step="follow"/></td><td data-label="私信"><ActionState job={j} step="message"/></td><td data-label="详情"><Button size="sm" variant={selected.id === j.id ? 'secondary' : 'ghost'} aria-label={`查看${j.name}`} onClick={() => setSelectedId(j.id)}>查看</Button></td>
      </tr>)}</tbody></table></div>
    </Panel><Panel title={selected.name} description="合成用户详情 · 未发送内容" className="hb-detail">
      <div className="hb-detail-label">原始请求</div><blockquote>{selected.text}</blockquote>
      <p className="hb-source-meta">话题：{selected.topic}<br/><code>{selected.sourceUrl}</code></p>
      <div className="hb-conditions"><div><span>请求指向</span><strong>{selected.target === 'self' ? '当前测试账号' : '其他用户'}</strong></div><div><span>私信请求</span><strong>{selected.messageRequested ? '样本预设为明确请求' : '没有向当前账号请求'}</strong></div><div><span>模拟私信尝试</span><strong>{selected.attempts} 次</strong></div></div>
      <div className="hb-detail-label">公开回复 · 模拟草稿</div><p className="hb-draft">{selected.draft || '需求判断后按本次保存的模板生成。'}</p><div className="hb-detail-label hb-message-label">私信内容 · 模拟草稿</div><p className="hb-draft">{selected.messageDraft||'尚未生成，或样本未明确请求私信。'}</p>{selected.reason && <p className="hb-reason">{selected.reason}</p>}
      <small>审核与同意条件均为测试预设，不能用于证明真实用户同意或平台许可。</small>
    </Panel></div>

    <Panel title="执行日志" description="最新记录在上方，每条操作均为模拟。" action={<div className="segmented hb-log-filters" aria-label="日志筛选">{([['all', '全部'], ['message', '私信'], ['error', '异常']] as const).map(([value, label]) => <button key={value} aria-pressed={logFilter === value} className={logFilter === value ? 'selected' : ''} onClick={() => setLogFilter(value)}>{label}</button>)}</div>}>
      <div className="hb-logs" tabIndex={0} aria-label="模拟执行日志">{logs.length ? logs.map(l => <div className={`hb-log ${l.result}`} key={l.id}><time>{timeLabel(l.time)}</time><Badge variant="outline" className={l.result === 'error' ? 'badge-red' : 'badge-muted'}>模拟</Badge><div><strong>{l.user} · {stepLabel(l.step)}</strong><p>{l.message}</p></div></div>) : <p className="hb-log-empty">当前筛选下暂无记录。</p>}</div>
    </Panel>
    </>}
    <p className="hb-footnote">规则和模板保存在当前浏览器，不同步云端。日志只在页面内存保存，离开控制台或刷新会停止并清空测试；模拟后台内切换分区不会停止运行。关键词匹配为字面规则，不能保证真实需求识别准确率。</p>
  </div>
}
