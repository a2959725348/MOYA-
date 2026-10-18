import {useState} from 'react'
import {ArrowUpRight,BookOpen,Check,Clock,Plus,Target,Wallet,Activity,CalendarDays,ChevronRight} from 'lucide-react'
import {AreaChart,Area,CartesianGrid,Tooltip,XAxis,ResponsiveContainer,BarChart,Bar} from 'recharts'
import {useWorkbench} from '../lib/store'
import {buckets,compact,dailyTokens,dateKey,dateTime,money} from '../lib/domain'
import {apiBalances} from '../lib/workspace'
import {Panel,Button,Card,CardContent,Badge,Empty,TaskRow,RecordEditor,taskFields,Progress} from '../components/common'
import {QuotaCard} from '../components/quota-card'
import {compareTaskDueAt} from '../lib/task-import'

export default function Overview(){
 const {state,demo,setPage,save,notify}=useWorkbench()
 const [addTask,setAddTask]=useState(false),[range,setRange]=useState<7|30>(7)
 if(!state)return <div className="page-loading"><Activity className="spin"/>正在读取你的工作台…</div>
 const today=dateKey(),bucket=buckets(state.codex)[0]?.[1]
 const pending=state.tasks.filter(t=>t.status!=='completed').sort(compareTaskDueAt)
 const plans=state.studyPlans.filter(p=>p.date===today),completed=plans.filter(p=>p.status==='completed').length
 const minutes=state.studySessions.filter(s=>s.date===today).reduce((a,s)=>a+s.minutes,0)
 const dailyGoal=state.goals[0]?.dailyMinutes??null,progress=dailyGoal?Math.min(100,minutes/dailyGoal*100):null
 const balances=apiBalances(state.accounts),token=dailyTokens(state.codex.dailyUsageBuckets,today)
 const usage=state.codex.dailyUsageBuckets?.slice(-range)
 const study=Array.from({length:7},(_,i)=>{const date=dateKey(new Date(Date.now()-(6-i)*86400000));return {date:date.slice(5),minutes:state.studySessions.filter(s=>s.date===date).reduce((a,s)=>a+s.minutes,0)}})
 const tooltipStyle={background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,fontSize:12,color:'var(--foreground)'}
 return <div className="page-enter workspace-overview">
  <div className="overview-heading">
   <div className="greeting"><div className="eyebrow">我的空间 · 我的节奏</div><h1>把今天，安排得刚刚好。</h1><p>你好，{state.settings.profile.name||'学习者'}。重要的事，就从眼前这一件开始。</p></div>
   <div className="overview-heading-actions"><span className="workspace-date">{new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date())}</span><Button onClick={()=>setAddTask(true)}><Plus size={15}/>新建任务</Button></div>
  </div>
  <div className="workspace-sectionbar"><span><CalendarDays size={14}/>今日概览</span><button className="text-button" onClick={()=>setPage('settings')}><span className={`status-dot ${!demo&&state.sync.connected?'online':''}`}/>{demo?'示例数据':state.sync.connected?'同步助手在线':'同步助手未连接'}<ChevronRight size={12}/></button></div>
  <div className="overview-stats workspace-stats">
   <QuotaCard window={bucket?.primary} status={state.codex.status} onConnect={()=>setPage('settings')}/>
   <QuotaCard window={bucket?.secondary} kind="secondary" status={state.codex.status} onConnect={()=>setPage('settings')}/>
   <Card className="learning-stat"><CardContent><div className="stat-top"><span>今日专注</span><Clock size={16}/></div><div className="learning-number">{minutes}<small>分钟</small></div><Progress value={progress}/><div className="workspace-stat-foot">{dailyGoal&&progress!=null?<><span>每日目标 {dailyGoal} 分钟</span><span>完成 {Math.round(progress)}%</span></>:<><span>未设置学习目标</span><button className="text-button" onClick={()=>setPage('study')}>设置目标 <ArrowUpRight size={12}/></button></>}</div></CardContent></Card>
   <Card className="workspace-balance"><CardContent><div className="stat-top"><span>API 记录余额</span><Wallet size={16}/></div>{balances.length?<div className="workspace-balance-values">{balances.map(b=><strong key={b.currency}>{money(b.balance,b.currency)}<small>{b.count} 个账户 · {b.currency}</small></strong>)}</div>:<div className="workspace-balance-empty"><strong>—</strong><span>尚无可用余额记录</span></div>}<div className="workspace-stat-foot"><span>按币种统计 · 含手动记录</span><button className="text-button" onClick={()=>setPage('quota')}>查看账户 <ArrowUpRight size={12}/></button></div></CardContent></Card>
  </div>
  <div className="overview-middle workspace-middle">
   <Panel title="AI 使用趋势" description={`最近 ${range} 个来源日的词元记录，不等同于额度百分比`} action={<div className="workspace-range" aria-label="趋势时间范围">{([7,30] as const).map(n=><button key={n} className={range===n?'selected':''} aria-pressed={range===n} onClick={()=>setRange(n)}>{n} 天</button>)}</div>}>
    <div className="chart-summary"><strong>{compact(token)}<small>词元 / 今日来源日</small></strong><Badge variant="outline" className="badge-muted">{demo?'演示统计':today}</Badge></div>
    {usage?.length?<><div className="workspace-chart-legend"><i/>Codex · 来源日用量</div><div className="chart-area"><ResponsiveContainer width="100%" height={190}><AreaChart data={usage}><defs><linearGradient id="workspace-usage-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.2}/><stop offset="100%" stopColor="var(--primary)" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--chart-grid)"/><XAxis dataKey="startDate" tickFormatter={v=>String(v).slice(5)} axisLine={false} tickLine={false} minTickGap={20} tick={{fill:'var(--muted-foreground)',fontSize:10}} dy={7}/><Tooltip contentStyle={tooltipStyle} formatter={v=>[Number(v).toLocaleString(),'词元']}/><Area type="linear" dataKey="tokens" stroke="var(--primary)" strokeWidth={2} fill="url(#workspace-usage-fill)"/></AreaChart></ResponsiveContainer></div></>:<Empty title="等待第一份使用记录" description="连接 Codex 助手后，自动记录用量变化。" onClick={()=>setPage('settings')} action="连接同步助手"/>}
    <div className="workspace-panel-footer"><span>{demo?'本页为演示数据':`日统计采样于 ${dateTime(state.codex.dailyUsageObservedAt??state.codex.syncedAt)}`}</span><button className="text-button" onClick={()=>setPage('quota')}>查看详情 <ArrowUpRight size={13}/></button></div>
   </Panel>
   <Panel title="今日学习计划" description="一步一步，把目标变成日常" action={<button className="icon-button" aria-label="打开学习计划" onClick={()=>setPage('study')}><ArrowUpRight size={16}/></button>}>
    <div className="workspace-plan-summary"><span>{completed} / {plans.length} 项已完成</span><span>{plans.length?Math.round(completed/plans.length*100):0}%</span></div><Progress value={plans.length?completed/plans.length*100:0}/>
    {plans.length?<div className="workspace-plan-list">{plans.slice(0,3).map(p=><div className={`workspace-plan ${p.status==='completed'?'completed':''}`} key={p.id}><button className={`task-check ${p.status==='completed'?'checked':''}`} aria-label={`${p.status==='completed'?'恢复':'完成'}${p.title}`} disabled={demo} onClick={async()=>{try{await save('studyPlans',{status:p.status==='completed'?'pending':'completed'},p.id)}catch(e){notify((e as Error).message,'error')}}}>{p.status==='completed'&&<Check size={12}/>}</button><div><strong>{p.title}</strong><small>{p.subject}</small></div><span>{p.minutes} 分钟</span></div>)}</div>:<Empty icon={BookOpen} title="今天，先完成一件事" description="在学习中心添加计划，或让 AI 帮你拆解目标。" action="安排今日计划" onClick={()=>setPage('study')}/>}
    <div className="workspace-panel-footer"><span>还有 {plans.length-completed} 项计划待完成</span><button className="text-button" onClick={()=>setPage('study')}>进入学习中心 <ArrowUpRight size={13}/></button></div>
   </Panel>
  </div>
  <Panel className="workspace-tasks" title="近期截止" description="先完成最接近截止的任务" action={<button className="text-button" onClick={()=>setPage('tasks')}>查看全部 {pending.length} 项 <ArrowUpRight size={13}/></button>}>
   {pending.length?<div className="task-list">{pending.slice(0,3).map(t=><TaskRow key={t.id} task={t} compact/>)}</div>:<Empty icon={Check} title="暂时没有待完成任务" description="把学习通作业、考试和其他待办记录在这里。" onClick={()=>setAddTask(true)} action="添加任务"/>}
  </Panel>
  <div className="overview-bottom">
   <Panel title="需求与咨询" description="核对原文与 AI 建议，再人工决定" action={<button className="text-button" onClick={()=>setPage('demands')}>打开小黑盒后台 <ArrowUpRight size={13}/></button>}><div className="demand-overview-counts"><div><strong>{state.demands.filter(r=>r.status==='pending').length}</strong><span>待审核</span></div><div><strong>{state.demands.filter(r=>r.analysis).length}</strong><span>已分析</span></div><div><strong>{state.demands.filter(r=>r.status==='approved').length}</strong><span>人工通过</span></div><div><strong>{state.consultations.length}</strong><span>自愿咨询</span></div></div><p className="helper-text">小黑盒读取待授权评估。导入不会自动调用 AI，回复草稿不会自动发送。</p></Panel>
   <Panel title="学习节奏" description="最近七天的专注时长" action={<Target size={16} className="workspace-accent"/>}><div className="chart-summary"><strong>{study.reduce((n,d)=>n+d.minutes,0)}<small>分钟 / 7 天</small></strong></div><div className="chart-area"><ResponsiveContainer width="100%" height={120}><BarChart data={study}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5"/><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill:'var(--muted-foreground)',fontSize:10}}/><Tooltip formatter={v=>[v,'分钟']} contentStyle={tooltipStyle}/><Bar dataKey="minutes" fill="var(--chart-secondary)" radius={[3,3,0,0]} maxBarSize={18}/></BarChart></ResponsiveContainer></div></Panel>
  </div>
  <div className="dashboard-foot"><span><span className={`status-dot ${!demo&&state.sync.connected?'online':''}`}/>{demo?'此页数字均为演示数据':`最后成功同步：${dateTime(state.codex.syncedAt)}`}</span><span>按自己的节奏，持续积累。</span></div>
  <RecordEditor open={addTask} onClose={()=>setAddTask(false)} collection="tasks" title="新增学习任务" fields={taskFields} defaults={{source:'manual'}}/>
 </div>
}
