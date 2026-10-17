import {useState} from 'react'
import {Badge,Button,Panel} from './common'
import {validateHeyboxSettings,matchHeyboxSample,previewHeyboxReplies,type HeyboxSettings} from '../lib/heybox-settings'
import type {SimulationJob} from '../lib/heybox-simulation'
import './heybox-settings-editor.css'

type Props={tab:'rules'|'templates';settings:HeyboxSettings;samples:SimulationJob[];disabled:boolean;dirty:boolean;onChange:(settings:HeyboxSettings)=>void;onSave:()=>void;onDefaults:()=>void}
export default function HeyboxSettingsEditor({tab,settings,samples,disabled,dirty,onChange,onSave,onDefaults}:Props){
  const [sampleId,setSampleId]=useState(samples[0].id)
  const sample=samples.find(s=>s.id===sampleId)??samples[0]
  let validated:HeyboxSettings|undefined,error=''
  try{validated=validateHeyboxSettings(settings)}catch(e){error=(e as Error).message}
  const match=validated?matchHeyboxSample(validated,sample):null
  const replies=validated?previewHeyboxReplies(validated,sample):null
  const field=(key:keyof HeyboxSettings,value:string)=>onChange({...settings,[key]:value})
  const textarea=(key:keyof HeyboxSettings,label:string,hint:string,rows=3)=><label className="field"><span>{label}</span><textarea value={settings[key]} disabled={disabled} maxLength={key==='postUrls'?8000:2000} rows={rows} onChange={e=>field(key,e.target.value)}/><small>{hint}</small></label>

  return <div className="hb-settings-grid"><Panel title={tab==='rules'?'任务规则':'回复模板'} description="仅用于模拟样本。保存并应用会创建一轮新测试，设置只保存在当前浏览器。">
    <form className="hb-settings-form" onSubmit={e=>{e.preventDefault();onSave()}}>
      {tab==='rules'?<>
        <label className="field"><span>搜索范围</span><select value={settings.scope} disabled={disabled} onChange={e=>field('scope',e.target.value)}><option value="all">全部合成样本</option><option value="topics">指定话题</option><option value="posts">指定帖子链接</option></select><small>这是样本范围筛选，不会搜索或读取真实帖子。</small></label>
        {settings.scope==='topics'&&textarea('topics','指定话题','每行一个，按完整话题名称匹配。样本话题：AI 工具、订阅问答、游戏交流。')}
        {settings.scope==='posts'&&textarea('postUrls','指定帖子链接','每行一个，最多 20 个。请从右侧样本详情复制测试链接；填写真实链接不会自动抓取。')}
        {textarea('topicKeywords','主题关键词','组内任意一个命中即可；检查样本标题和评论。支持换行、中文逗号或英文逗号。')}
        {textarea('demandKeywords','需求表达','还必须命中这组至少一个词，只检查评论原文，避免把帖子标题当成用户需求。')}
        {textarea('excludeKeywords','排除条件','评论命中任意一个即忽略；这是字面匹配，不是大模型语义判断。可留空。')}
      </>:<>
        {textarea('publicReply','公开回复模板','只生成草稿；联系方式请使用独立模板，不放入公开回复。',4)}
        {textarea('tutorialMessage','教程私信模板','只在样本明确向当前账号请求私信时生成。',4)}
        {textarea('contactMessage','联系方式模板','只在样本另外明确请求联系方式、且你已填写联系方式时生成。回关不会自动触发。',3)}
        <label className="field"><span>教程链接（选填）</span><input value={settings.tutorialUrl} disabled={disabled} maxLength={2000} placeholder="https://example.com/tutorial" onChange={e=>field('tutorialUrl',e.target.value)}/><small>链接仅插入模拟草稿，不会被自动访问。</small></label>
        <div className="form-grid"><label className="field"><span>你的联系方式渠道</span><select value={settings.contactChannel} disabled={disabled} onChange={e=>field('contactChannel',e.target.value)}>{['微信','QQ','邮箱','其他'].map(c=><option key={c}>{c}</option>)}</select></label><label className="field"><span>你的联系方式（选填）</span><input value={settings.contactValue} disabled={disabled} maxLength={200} placeholder="仅填写你自己的联系方式" onChange={e=>field('contactValue',e.target.value)}/></label></div>
        <p className="hb-template-help">可用变量：<code>{'{{用户}}'}</code> <code>{'{{关键词}}'}</code> <code>{'{{教程链接}}'}</code> <code>{'{{联系方式}}'}</code>。联系方式变量仅供联系方式模板使用。模板内容仍需人工核对。</p>
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="hb-settings-actions"><Button type="submit" disabled={disabled||!validated}>保存并应用到新测试</Button><Button type="button" variant="outline" disabled={disabled} onClick={onDefaults}>填入默认设置</Button></div>
      <p className="helper-text">{disabled?'测试运行中不可修改；先暂停再编辑。':dirty?'有未保存修改；开始测试前请先保存。':'当前表单与已保存设置一致。'} 设置不随工作台账号同步，浏览器清理站点数据也会删除设置。</p>
    </form>
  </Panel><div className="hb-settings-preview"><Panel title="样本预览" description="预览当前表单，尚未保存的修改也会实时显示。">
    <label className="field"><span>选择测试对象</span><select aria-label="选择测试对象" value={sample.id} onChange={e=>setSampleId(e.target.value)}>{samples.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <div className="hb-preview-source"><strong>{sample.title}</strong><p>话题：{sample.topic}</p><code>{sample.sourceUrl}</code></div>
    <blockquote className="hb-preview-original">{sample.text}</blockquote>
    <Badge variant="outline" className={match?.matched?'badge-green':'badge-muted'}>{!match?'设置未完成':match.matched?'规则命中':'规则未命中'}</Badge><p className="hb-preview-reason">{match?.reason??error}</p>
    {sample.target==='other'&&<p className="hb-reason">该请求指向其他用户，不生成当前账号的互动草稿。</p>}
    {replies?.notice&&<p className="hb-reason" role="alert">{replies.notice}</p>}
    {tab==='templates'&&<div className="hb-preview-messages"><div><strong>公开回复 · 模拟草稿</strong><p>{replies?.publicReply||'当前样本不符合生成条件。'}</p></div><div><strong>教程私信 · 模拟草稿</strong><p>{replies?.tutorialMessage||'当前样本未向当前账号明确请求私信，或不符合规则。'}</p></div><div><strong>联系方式 · 模拟草稿</strong><p>{replies?.contactMessage||'未明确请求联系方式，或你尚未填写联系方式，不生成这一段。'}</p></div></div>}
  </Panel><Panel title="所有样本匹配结果" description="检查规则是否过宽或过窄，再决定保存。"><div className="hb-rule-results">{samples.map(s=>{const result=validated?matchHeyboxSample(validated,s):null;return <div key={s.id}><strong>{s.name}</strong><span>{result?.matched?(s.target==='other'?'规则命中，对象不符':'规则命中'):result?.reason||'等待有效设置'}</span></div>})}</div></Panel></div></div>
}
