import {useCallback,useEffect,useRef,useState,type ReactNode,type FormEvent} from 'react'
import {Activity,ArrowRight,Box,Check,CheckCheck,ChevronRight,ClipboardCheck,FileText,Filter,Layers,LoaderCircle,RefreshCw,Settings2,ShieldCheck,Unplug,X} from 'lucide-react'
import {api,ApiError} from '../lib/api'
import {useWorkbench} from '../lib/store'
import {dateTime} from '../lib/domain'
import {categoryLabels} from '../lib/demands'
import {canApproveReview,configEditorDirty,configEditorFrom,draftEditorDirty,draftEditorFrom,isReviewStale,matchManualText,parseKeywordInput,reconcileConfigEditor,reconcileDraftEditor,renderManualTemplate,type ConfigEditor,type DraftEditor,type HeyboxAdminData,type HeyboxConfig,type HeyboxReview} from '../lib/heybox-admin'
import './heybox-admin.css'
import './heybox-workspace.css'

const tabs=[['overview','总览',Layers],['config','任务配置',Settings2],['manual','人工需求',FileText],['reviews','草稿审核',ClipboardCheck],['logs','操作日志',Activity]] as const
type Tab=typeof tabs[number][0]
const reviewLabels={pending:'待审核',approved:'已批准 · 未发送',rejected:'已退回'}
const logLabels:Record<string,string>={config_saved:'配置已保存',demand_saved:'需求已保存',demands_imported:'需求已导入',demand_deleted:'需求已删除',analysis_completed:'分析已完成',draft_saved:'草稿已保存',review_approved:'审核已批准',review_rejected:'审核已退回',review_reset:'审核已重置'}
const demoAdmin:HeyboxAdminData={version:1,mode:'manual',config:{revision:0,topicKeywords:['ChatGPT','GPT','Plus'],demandKeywords:['如何订阅','支付失败','求教程','订阅'],excludeKeywords:['已经解决','不需要','广告'],replyTemplate:'关于“{{关键词}}”，建议先核对官方订阅说明和具体错误信息。{{摘要}}'},reviews:[],logs:[],capabilities:{platformConnected:false,autoRead:false,autoReply:false,follow:false,directMessage:false}}
function Card({title,description,children,action,className=''}:{title:string;description?:string;children:ReactNode;action?:ReactNode;className?:string}){return <section className={`hba-card ${className}`}><header><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</header>{children}</section>}
function Empty({title,children}:{title:string;children:ReactNode}){return <div className="hba-empty"><Box size={27}/><h3>{title}</h3><p>{children}</p></div>}
function Stamp({value}:{value:string}){return <time dateTime={value}>{dateTime(value)}</time>}
function cachedDraft(drafts:Record<string,DraftEditor>,id:string){return Object.prototype.hasOwnProperty.call(drafts,id)?drafts[id]:undefined}

export default function HeyboxAdmin({children}:{children:ReactNode}){
 const {state,demo,busy,action,refresh}=useWorkbench()
 const [tab,setTab]=useState<Tab>('overview'),[admin,setAdmin]=useState<HeyboxAdminData|null>(demo?demoAdmin:null)
 const [loading,setLoading]=useState(false),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState('')
 const [config,setConfig]=useState<ConfigEditor|null>(demo?configEditorFrom(demoAdmin.config):null),[previewId,setPreviewId]=useState('')
 const [selectedId,setSelectedId]=useState(''),[drafts,setDrafts]=useState<Record<string,DraftEditor>>({})
 const [logType,setLogType]=useState('all'),[logSearch,setLogSearch]=useState('')
 const sequence=useRef(0),locked=useRef(false)
 const demands=state?.demands??[],source=demands.find(item=>item.id===selectedId),review=admin?.reviews.find(item=>item.demandId===selectedId),draft=cachedDraft(drafts,selectedId)
 const sourceSignature=JSON.stringify(demands.map(item=>[item.id,item.updatedAt]))
 const loadedState=!!state
 const loadAdmin=useCallback(async()=>{
  if(demo)return demoAdmin
  const request=++sequence.current;setLoading(true);setLoadError('')
  try{const data=await api<HeyboxAdminData>('/heybox/admin');if(request!==sequence.current)return null;setAdmin(data);return data}
  catch(cause){if(request===sequence.current)setLoadError(cause instanceof ApiError&&cause.status===401?'会话已失效，请重新登录后读取后台。':`后台读取失败：${cause instanceof Error?cause.message:'请重试'}`);return null}
  finally{if(request===sequence.current)setLoading(false)}
 },[demo])
 useEffect(()=>{if(loadedState)void loadAdmin();return()=>{sequence.current++}},[loadAdmin,loadedState,sourceSignature])
 useEffect(()=>{if(admin)setConfig(current=>reconcileConfigEditor(current,admin.config))},[admin])
 useEffect(()=>{if(!admin||!selectedId)return;setDrafts(current=>{const existing=cachedDraft(current,selectedId);return existing?{...current,[selectedId]:reconcileDraftEditor(existing,source,review)}:current})},[admin,selectedId,source?.updatedAt,review])
 const disabled=demo||busy||!!pending||loading||!admin||!!loadError
 const configDirty=config?configEditorDirty(config):false,configConflict=!!config&&!!admin&&config.base.revision!==admin.config.revision
 const draftDirty=draft?draftEditorDirty(draft):false,draftConflict=!!draft&&draft.expectedUpdatedAt!==(review?.updatedAt??null)
 const sourceChanged=!!draft&&(!source||source.updatedAt!==draft.sourceUpdatedAt)
 const stale=!!review&&isReviewStale(review,source)
 const previewSource=demands.find(item=>item.id===(previewId||demands[0]?.id))
 const previewMatch=previewSource&&admin?matchManualText(admin.config,previewSource.text):null
 let templatePreview='',templateError=''
 if(previewSource&&admin){try{templatePreview=renderManualTemplate(admin.config.replyTemplate,{问题:previewSource.text,摘要:previewSource.analysis?.summary??'',关键词:previewMatch?.topicTerms.join('、')??''})}catch(cause){templateError=(cause as Error).message}}
 const currentApproved=admin?.reviews.filter(item=>item.status==='approved'&&!isReviewStale(item,demands.find(record=>record.id===item.demandId))).length??0
 const pendingCount=admin?.reviews.filter(item=>item.status==='pending').length??0
 const staleCount=admin?.reviews.filter(item=>isReviewStale(item,demands.find(record=>record.id===item.demandId))).length??0
 const analyzed=demands.filter(item=>item.analysis).length
 const logs=admin?.logs.filter(item=>(logType==='all'||item.action===logType)&&`${item.label} ${item.targetId??''}`.toLocaleLowerCase().includes(logSearch.toLocaleLowerCase()))??[]
 function selectSource(id:string){
  setSelectedId(id);setError('');setNotice('')
  if(!id)return
  const item=demands.find(record=>record.id===id),saved=admin?.reviews.find(record=>record.demandId===id)
  if(item||saved)setDrafts(current=>cachedDraft(current,id)?current:{...current,[id]:draftEditorFrom(item??{id,updatedAt:saved!.sourceUpdatedAt},saved)})
 }
 function updateDraft(update:(current:DraftEditor)=>DraftEditor){setDrafts(current=>{const existing=cachedDraft(current,selectedId);return existing?{...current,[selectedId]:update(existing)}:current})}
 async function run<T,>(label:string,operation:()=>Promise<T>,onSuccess:(value:T)=>void){
  if(locked.current||disabled)return
  locked.current=true;setPending(label);setError('');setNotice('')
  try{const value=await operation();onSuccess(value);setNotice(label);await loadAdmin()}
  catch(cause){
   const conflict=cause instanceof ApiError&&(cause.status===404||cause.status===409)
   setError(`${cause instanceof Error?cause.message:'请求失败，请重试'}${conflict?'。已尝试重新读取云端；本地编辑仍保留，请核对版本并使用下方重新读取按钮。':''}`)
   if(conflict){await refresh();await loadAdmin()}
  }finally{locked.current=false;setPending('')}
 }
 function saveConfig(event:FormEvent){event.preventDefault();if(!config)return;void run('配置已保存到云端',()=>action<{config:HeyboxConfig}>('/heybox/config',{expectedRevision:config.base.revision,config:{topicKeywords:parseKeywordInput(config.topicText),demandKeywords:parseKeywordInput(config.demandText),excludeKeywords:parseKeywordInput(config.excludeText),replyTemplate:config.replyTemplate}},'PUT'),value=>{setAdmin(current=>current?{...current,config:value.config}:current);setConfig(configEditorFrom(value.config))})}
 function acceptReview(value:{review:HeyboxReview}){
  setAdmin(current=>current?{...current,reviews:[...current.reviews.filter(item=>item.id!==value.review.id),value.review]}:current)
  setDrafts(current=>({...current,[value.review.demandId]:draftEditorFrom(source??{id:value.review.demandId,updatedAt:value.review.sourceUpdatedAt},value.review)}))
 }
 function saveDraft(){
  if(!draft||!source)return
  const sameSource=review&&review.sourceUpdatedAt===draft.sourceUpdatedAt
  void run('草稿已保存为待审核',()=>sameSource?action<{review:HeyboxReview}>(`/heybox/reviews/${encodeURIComponent(review.id)}`,{expectedUpdatedAt:draft.expectedUpdatedAt,status:'pending',draft:draft.draft,note:draft.note},'PATCH'):action<{review:HeyboxReview}>('/heybox/reviews',{demandId:source.id,sourceUpdatedAt:draft.sourceUpdatedAt,draft:draft.draft,expectedUpdatedAt:draft.expectedUpdatedAt}),acceptReview)
 }
 function setStatus(status:HeyboxReview['status']){if(!review||!draft)return;void run(status==='approved'?'审核已批准，仅保存到数据库':status==='rejected'?'审核已退回':'审核已恢复待审核',()=>action<{review:HeyboxReview}>(`/heybox/reviews/${encodeURIComponent(review.id)}`,{expectedUpdatedAt:draft.expectedUpdatedAt,status},'PATCH'),acceptReview)}
 async function reloadConfig(){const data=await loadAdmin();if(data){setConfig(configEditorFrom(data.config));setError('');setNotice('已采用云端配置，本地修改已放弃')}}
 async function reloadDraft(){const data=await loadAdmin();if(!data||!selectedId)return;const saved=data.reviews.find(item=>item.demandId===selectedId);setDrafts(current=>({...current,[selectedId]:draftEditorFrom(source??{id:selectedId,updatedAt:saved?.sourceUpdatedAt??draft?.sourceUpdatedAt??''},saved)}));setError('');setNotice('已重新读取审核版本，本地编辑已放弃')}
 function useTemplate(){if(!source||!admin)return;try{const match=matchManualText(admin.config,source.text);const text=renderManualTemplate(admin.config.replyTemplate,{问题:source.text,摘要:source.analysis?.summary??'',关键词:match.topicTerms.join('、')});updateDraft(current=>({...current,draft:text}));setNotice('已填入云端已保存模板，请编辑后保存待审核')}catch(cause){setError((cause as Error).message)}}
 if(!state)return <div className="page-loading">正在读取工作台记录…</div>
 return <div className="hba page-enter">
  <header className="hba-hero"><div className="hba-brand"><span className="hba-mark"><Box size={25}/></span><div><span className="hba-eyebrow">HEYBOX / MANUAL WORKSPACE</span><h1>小黑盒工作台</h1><p>把问题留给判断，把结果交给人工。</p></div></div><div className="hba-hero-actions"><span className="hba-pill"><i/>人工模式</span><button className="hba-button hba-quiet" disabled={demo||loading||!!pending||busy} onClick={()=>void loadAdmin()}><RefreshCw size={15} className={loading?'spin':''}/>{loading?'读取中':'刷新后台'}</button></div></header>
  <div className="hba-status-strip"><span><Unplug size={15}/><strong>平台未接入</strong></span><span>录入 · 分析 · 草稿 · 人工审核</span><span className="hba-status-tail"><ShieldCheck size={14}/>批准仅保存，不发送</span></div>
  {demo&&<div className="hba-message" role="status">演示模式 · 这里是静态空态。登录后读取云端记录；AI 仅在人工需求中明确点击时调用。</div>}
  {loadError&&<div className="hba-message hba-error" role="alert"><strong>{loadError}</strong><button className="hba-button hba-quiet" disabled={loading||!!pending} onClick={()=>void loadAdmin()}>重试读取</button></div>}
  {error&&<div className="hba-message hba-error" role="alert">{error}</div>}
  {notice&&<div className="hba-message hba-success" role="status"><Check size={16}/>{notice}</div>}
  {pending&&<div className="hba-message" role="status"><LoaderCircle size={16} className="spin"/>正在保存，请勿重复操作。</div>}
  <nav className="hba-tabs" aria-label="小黑盒后台分区">{tabs.map(([value,label,Icon])=><button key={value} aria-pressed={tab===value} aria-controls={`hba-${value}`} className={tab===value?'selected':''} onClick={()=>setTab(value)}><Icon size={17}/>{label}{value==='reviews'&&pendingCount>0&&<small>{pendingCount}</small>}</button>)}</nav>
  {loading&&!admin&&<div className="hba-message" role="status"><LoaderCircle size={16} className="spin"/>正在读取云端配置、审核与日志…</div>}
  {tab==='overview'&&<section id="hba-overview" className="hba-section"><div className="hba-section-heading"><div><span className="hba-eyebrow">WORKSPACE OVERVIEW</span><h2>每一条记录，都有来处</h2></div><span className="hba-muted">{demo?'演示空态':'来自已保存的工作台记录'}</span></div>
   <div className="hba-stats">{[{label:'需求原文',value:demands.length,hint:`${state.consultations.length} 条自愿咨询`,Icon:FileText},{label:'已完成分析',value:analyzed,hint:`${demands.length-analyzed} 条等待人工调用`,Icon:Filter},{label:'待审核草稿',value:admin?pendingCount:'—',hint:admin?`${admin.reviews.length} 份已保存草稿`:'后台数据尚未读取',Icon:ClipboardCheck},{label:'有效批准',value:admin?currentApproved:'—',hint:admin?`${staleCount} 份草稿来源已过期`:'后台数据尚未读取',Icon:CheckCheck}].map(({label,value,hint,Icon})=><article className="hba-stat" key={label}><div><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{hint}</small></article>)}</div>
   <div className="hba-overview-grid"><Card title="人工处理流程" description="每一步由你明确操作；所有草稿都留在工作台。"><ol className="hba-workflow">{[{title:'录入有权使用的原文',text:'导入去标识化问题，保留真实来源。',target:'manual' as Tab},{title:'按需调用 AI 分析',text:`当前模型 ${state.settings.ai.model}，沿用现有预算。`,target:'manual' as Tab},{title:'核对证据，编辑草稿',text:'从原文、AI 建议或已保存模板开始。',target:'reviews' as Tab},{title:'人工批准或退回',text:'批准只记录审核结果，不发送内容。',target:'reviews' as Tab}].map((step,index)=><li key={step.title}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{step.title}</strong><p>{step.text}</p></div><button className="hba-icon-button" aria-label={`前往${step.title}`} onClick={()=>setTab(step.target)}><ArrowRight size={17}/></button></li>)}</ol></Card>
   <Card title="最近操作" description="仅记录操作类型、时间和记录 ID。" action={<button className="hba-link" onClick={()=>setTab('logs')}>全部日志 <ChevronRight size={14}/></button>}>{admin?.logs.length?<ul className="hba-events">{admin.logs.slice(0,5).map(item=><li key={item.id}><span className="hba-event-dot"/><div><strong>{item.label}</strong><small>{item.targetId??'后台配置'}</small></div><Stamp value={item.at}/></li>)}</ul>:<Empty title={loadError?'日志读取失败':'还没有操作日志'}>{loadError?'点击刷新后台重试。':'保存配置、录入原文或审核后，操作会记录在这里。'}</Empty>}</Card></div>
   <div className="hba-capabilities"><div><Unplug size={20}/><div><strong>小黑盒平台 · 未接入</strong><p>当前工作台使用人工提供的原文。</p></div></div><div className="hba-capability-tags">{['自动读取','自动回复','自动关注','自动私信'].map(label=><span key={label}><X size={12}/>{label}未启用</span>)}</div></div>
  </section>}
  {tab==='config'&&<section id="hba-config" className="hba-section"><div className="hba-section-heading"><div><span className="hba-eyebrow">SAVED RULES</span><h2>任务配置</h2><p>关键词只对人工原文字面预筛选，命中不代表真实意愿。</p></div><span className="hba-pill">云端版本 {admin?.config.revision??'—'}</span></div><div className="hba-config-grid"><Card title="关键词与回复模板" description="主题组与需求组同时命中；每组内任意一项命中；排除词优先。">
   {config?<form onSubmit={saveConfig} className="hba-form"><div className="hba-two-fields"><label><span>主题关键词 *</span><textarea rows={4} value={config.topicText} disabled={disabled} onChange={event=>setConfig({...config,topicText:event.target.value})}/><small>1–40 项，每项最多 80 字</small></label><label><span>需求关键词 *</span><textarea rows={4} value={config.demandText} disabled={disabled} onChange={event=>setConfig({...config,demandText:event.target.value})}/><small>换行或中英文逗号分隔，短语保留空格</small></label></div><label><span>排除关键词</span><textarea rows={3} value={config.excludeText} disabled={disabled} onChange={event=>setConfig({...config,excludeText:event.target.value})}/><small>最多 40 项；可留空</small></label><label><span>回复模板 *</span><textarea required rows={5} maxLength={2000} value={config.replyTemplate} disabled={disabled} onChange={event=>setConfig({...config,replyTemplate:event.target.value})}/><small>{config.replyTemplate.length} / 2000 字 · 允许 {'{{问题}}'}、{'{{摘要}}'}、{'{{关键词}}'}</small></label>
    {configConflict&&<div className="hba-message hba-warning">云端配置已更新，本地编辑保留在版本 {config.base.revision}。请重新读取后编辑，避免覆盖其他设备的修改。</div>}
    <div className="hba-form-footer"><span>{configDirty?'有未保存修改，预览仍使用已保存规则':'与已读取的云端版本一致'}</span><div><button className="hba-button hba-quiet" type="button" disabled={demo||loading||!!pending||busy} onClick={()=>void reloadConfig()}>重新读取并放弃本地修改</button><button className="hba-button hba-primary" type="submit" disabled={disabled||!configDirty||configConflict}>保存云端配置</button></div></div></form>:<Empty title="尚未读取配置">请刷新后台读取配置，失败时会显示具体原因。</Empty>}
   </Card><Card title="已保存规则预览" description="只在本地计算；不会调用 AI 或访问来源链接。" className="hba-preview-card"><label className="hba-field"><span>选择已有需求原文</span><select value={previewSource?.id??''} onChange={event=>setPreviewId(event.target.value)}><option value="">{demands.length?'选择原文':'暂无需求记录'}</option>{demands.map(item=><option key={item.id} value={item.id}>{item.text.slice(0,70)}</option>)}</select></label>{previewSource&&admin?<><blockquote className="hba-quote">{previewSource.text}</blockquote><div className="hba-preview-result"><span className={`hba-badge ${previewMatch?.matched?'hba-good':'hba-neutral'}`}>{previewMatch?.matched?'字面预筛选命中':'未命中预筛选'}</span><dl><div><dt>主题命中</dt><dd>{previewMatch?.topicTerms.join('、')||'无'}</dd></div><div><dt>需求命中</dt><dd>{previewMatch?.demandTerms.join('、')||'无'}</dd></div><div><dt>排除命中</dt><dd>{previewMatch?.excludedTerms.join('、')||'无'}</dd></div></dl></div><h3 className="hba-small-title">模板结果 · 版本 {admin.config.revision}</h3><p className="hba-draft-preview">{templateError||templatePreview||'模板结果为空'}</p><small className="hba-muted">摘要来自已保存的 AI 分析，尚未分析时为空。渲染结果仍需去标识化并由服务端验证。</small></>:<Empty title="先录入一条原文">在人工需求中录入内容后，即可用已保存规则预览。</Empty>}</Card></div></section>}
  <section id="hba-manual" className="hba-section hba-manual" hidden={tab!=='manual'}><div className="hba-message"><FileText size={17}/><span>人工录入与自愿咨询沿用现有流程。AI 分析会调用当前配置模型并计入请求与费用限额。</span></div>{children}</section>
  {tab==='reviews'&&<section id="hba-reviews" className="hba-section"><div className="hba-section-heading"><div><span className="hba-eyebrow">HUMAN REVIEW</span><h2>草稿审核</h2><p>核对来源和 AI 依据，再保存、批准或退回。批准不发送。</p></div><span className="hba-muted">{admin?.reviews.length??'—'} / 200 份草稿</span></div><div className="hba-review-grid"><Card title="已保存的草稿" description="每条需求只有一份当前草稿。">{admin?.reviews.length?<ul className="hba-review-list">{admin.reviews.map(item=>{const original=demands.find(record=>record.id===item.demandId),localDraft=cachedDraft(drafts,item.demandId);return <li key={item.id}><button className={selectedId===item.demandId?'selected':''} onClick={()=>selectSource(item.demandId)}><span className="hba-review-row-meta"><span className={`hba-badge ${item.status==='approved'?'hba-good':'hba-neutral'}`}>{reviewLabels[item.status]}</span>{isReviewStale(item,original)&&<span className="hba-badge hba-warn">来源过期</span>}</span><strong>{original?.text??'来源已删除'}</strong><small><Stamp value={item.updatedAt}/></small>{localDraft&&draftEditorDirty(localDraft)&&<small className="hba-unsaved">本地有未保存修改</small>}</button></li>})}</ul>:<Empty title="还没有审核草稿">从右侧选择已有需求，编辑并保存第一份草稿。</Empty>}</Card>
   <Card title="来源与草稿" description="采用 AI 草稿和模板都是本地填入，保存后才进入待审核。"><div className="hba-form"><label><span>选择需求来源</span><select value={selectedId} onChange={event=>selectSource(event.target.value)}><option value="">选择一条已录入的需求</option>{demands.map(item=><option key={item.id} value={item.id}>{item.text.slice(0,90)}</option>)}{admin?.reviews.filter(item=>!demands.some(record=>record.id===item.demandId)).map(item=><option key={item.id} value={item.demandId}>来源已删除 · {item.demandId}</option>)}</select></label>
    {draft?<><div className="hba-source-meta"><span>记录 ID <code>{draft.demandId}</code></span><span>草稿来源版本 <code>{draft.sourceUpdatedAt}</code></span>{source&&<span>当前原文版本 <code>{source.updatedAt}</code></span>}</div>
     {source?<><h3 className="hba-small-title">需求原文</h3><blockquote className="hba-quote">{source.text}</blockquote>{source.analysis?<div className="hba-evidence"><div><span className="hba-badge hba-neutral">{categoryLabels[source.analysis.category]}</span><small>模型 {source.analysis.model} · <Stamp value={source.analysis.analyzedAt}/></small></div><h3>AI 判断依据</h3><p>{source.analysis.summary}</p><p><strong>理由：</strong>{source.analysis.reason}</p>{source.analysis.evidence.map((text,index)=><blockquote key={index}>{text}</blockquote>)}<small>AI 建议需人工核对；模型自评置信度 {Math.round(source.analysis.confidence*100)}%。</small></div>:<p className="hba-muted">尚无 AI 分析。可直接手写草稿，或到人工需求中明确点击 AI 分析。</p>}</>:<div className="hba-message hba-warning">来源已删除，无法保存新版本或批准。仍可查看已保存草稿并退回。</div>}
     {(stale||sourceChanged)&&source&&<div className="hba-message hba-warning"><div><strong>来源已修改或重新分析，旧草稿不能批准。</strong><p>先核对上方最新原文和依据，再采用当前来源版本；本地草稿文字保留，旧审核备注清空。</p></div><button className="hba-button hba-quiet" disabled={disabled||!sourceChanged} onClick={()=>{updateDraft(current=>({...current,sourceUpdatedAt:source.updatedAt,note:''}));setNotice('已采用当前来源，请核对草稿并重新保存待审核')}}>采用当前来源版本</button></div>}
     {draftConflict&&<div className="hba-message hba-warning">审核已被其他设备更新或删除。本地文字已保留；重新读取云端审核后再编辑。</div>}
     <div className="hba-draft-tools"><button className="hba-button hba-quiet" disabled={disabled||!source?.analysis?.draftReply} onClick={()=>{if(source?.analysis)updateDraft(current=>({...current,draft:source.analysis!.draftReply}))}}>采用已保存 AI 草稿</button><button className="hba-button hba-quiet" disabled={disabled||!source} onClick={useTemplate}>按已保存模板填入</button></div>
     <label><span>可编辑草稿 · 未发送 *</span><textarea rows={8} maxLength={2000} value={draft.draft} disabled={disabled} onChange={event=>updateDraft(current=>({...current,draft:event.target.value}))} placeholder="核对原文和证据后写下回复草稿…"/><small>{draft.draft.length} / 2000 字 · 请去除身份与联系信息</small></label>
     <label><span>审核备注（选填）</span><textarea rows={3} maxLength={1000} value={draft.note} disabled={disabled||!review||review.sourceUpdatedAt!==draft.sourceUpdatedAt} onChange={event=>updateDraft(current=>({...current,note:event.target.value}))} placeholder="记录审核依据，先保存待审核再批准或退回"/><small>最多 1000 字。采用新来源版本后，请先保存草稿再填写新备注。</small></label>
     <div className="hba-review-state"><span className="hba-badge hba-neutral">{review?reviewLabels[review.status]:'尚未保存'}</span><span>{draftDirty?'本地有未保存修改':'本地内容与已读取版本一致'}</span></div>
     <div className="hba-review-actions"><button className="hba-button hba-primary" disabled={disabled||!source||sourceChanged||draftConflict||!draft.draft.trim()} onClick={saveDraft}>保存待审核</button><button className="hba-button hba-approve" disabled={disabled||!canApproveReview(draft,review,source)} onClick={()=>setStatus('approved')}><Check size={16}/>批准（不发送）</button><button className="hba-button hba-quiet" disabled={disabled||!review||draftDirty||draftConflict||review.status==='rejected'} onClick={()=>setStatus('rejected')}>退回</button>{review&&review.status!=='pending'&&<button className="hba-button hba-quiet" disabled={disabled||draftDirty||draftConflict} onClick={()=>setStatus('pending')}>恢复待审核</button>}</div>
     <button className="hba-link hba-reload" disabled={demo||loading||!!pending||busy} onClick={()=>void reloadDraft()}>重新读取审核并放弃本地编辑</button><p className="hba-muted">修改草稿或备注后先保存待审核，再单独批准。保存与审核仅写入工作台数据库。</p>
    </>:<Empty title="选择一条需求开始">从已录入原文或左侧已有草稿开始。切换来源会保留本页其他来源的未保存编辑。</Empty>}
   </div></Card></div></section>}
  {tab==='logs'&&<section id="hba-logs" className="hba-section"><div className="hba-section-heading"><div><span className="hba-eyebrow">ACTIVITY LOG</span><h2>操作日志</h2><p>服务端保留最近 300 条操作元数据；不记录原文、草稿或密钥。</p></div><span className="hba-muted">{logs.length} / {admin?.logs.length??'—'} 条</span></div><Card title="工作台操作记录" description="按时间倒序显示，刷新后台读取最新记录。"><div className="hba-log-filters"><label className="hba-field"><span>操作类型</span><select value={logType} onChange={event=>setLogType(event.target.value)}><option value="all">全部类型</option>{Object.entries(logLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="hba-field"><span>搜索标签或记录 ID</span><input type="search" value={logSearch} onChange={event=>setLogSearch(event.target.value)} placeholder="输入操作名称或记录 ID…"/></label></div>{logs.length?<ol className="hba-log-list">{logs.map(item=><li key={item.id}><span className="hba-log-icon"><Activity size={15}/></span><div><strong>{item.label}</strong><small>{item.targetId?<>记录 <code>{item.targetId}</code></>:'工作台配置'}</small></div><Stamp value={item.at}/></li>)}</ol>:<Empty title={loadError?'日志读取失败':admin?.logs.length?'没有匹配的操作':'还没有操作记录'}>{loadError?'点击上方重试读取，查看服务端日志。':admin?.logs.length?'更换操作类型或搜索内容。':'录入、分析、配置和审核操作会在保存成功后出现在这里。'}</Empty>}</Card></section>}
  <footer className="hba-footer"><span><ShieldCheck size={13}/>人工工作流 · 云端保存</span><span>没有自动读取或对外发送</span></footer>
 </div>
}
