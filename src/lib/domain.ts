import type { QuotaWindow, QuotaBucket, QuotaHistory } from './types'
export function remainingPercent(window:Partial<QuotaWindow>|null|undefined): number|null {
  return typeof window?.usedPercent==='number' && Number.isFinite(window.usedPercent) ? Math.min(100,Math.max(0,100-window.usedPercent)) : null
}
export function countdown(reset:number|null|undefined,now=Date.now()):string {
  if (!reset || !Number.isFinite(reset)) return '未提供刷新时间'
  const seconds=Math.ceil((reset*1000-now)/1000)
  if(seconds<=0)return '等待同步'
  const days=Math.floor(seconds/86400)
  return (days ? `${days} 天 ` : '') + [Math.floor(seconds%86400/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':')
}
export function taskDueState(task:{status:string;dueAt:string|null},now=Date.now()):string {
  if(task.status==='completed')return 'completed'
  if(!task.dueAt || !Number.isFinite(Date.parse(task.dueAt)))return 'pending'
  return Date.parse(task.dueAt)<now?'overdue':Date.parse(task.dueAt)-now<24*3600000?'soon':'pending'
}
type QuotaChartSnapshot=Omit<QuotaHistory,'syncedAt'>&{syncedAt?:string|null;error?:string}
function quotaSamples(history:QuotaChartSnapshot[],bucketId:string) {
 const points=new Map<number,{stamp:number;bucket:QuotaBucket;bucketId:string;observedAt:string}>()
 for(const h of history) {
  // Failed attempts carry retained quota; only its last successful time is a sample.
  const observedAt=h.syncedAt===undefined?(!h.error||h.error==='CODEX_USAGE_UNAVAILABLE'?h.observedAt:null):h.syncedAt
  if(!observedAt)continue
  const stamp=Date.parse(observedAt)
  if(!Number.isFinite(stamp))continue
  const available=buckets(h),selected=available.find(([id])=>id===bucketId)??available[0]
  if(!selected)continue
  if(!points.has(stamp)||!h.error||h.error==='CODEX_USAGE_UNAVAILABLE')points.set(stamp,{stamp,bucket:selected[1],bucketId:selected[0],observedAt})
 }
 return [...points.entries()].sort(([a],[b])=>a-b).map(([,point])=>point)
}
export function quotaChartData(history:QuotaChartSnapshot[],bucketId='codex') {
 return quotaSamples(history,bucketId).map(({stamp,bucket,observedAt})=>({time:new Date(stamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),remaining:remainingPercent(bucket.primary),weekly:remainingPercent(bucket.secondary),observedAt}))
}
export function dailyQuotaEstimate(history:QuotaChartSnapshot[],bucketId='codex',day=dateKey()):{primary:number|null;secondary:number|null;sampleCount:number;from:string|null;to:string|null;skippedPairs:number} {
 const samples=quotaSamples(history,bucketId).filter(sample=>dateKey(new Date(sample.stamp))===day)
 const result={primary:null as number|null,secondary:null as number|null,sampleCount:samples.length,from:samples[0]?.observedAt??null,to:samples.at(-1)?.observedAt??null,skippedPairs:0}
 const validUsage=(value:number|null|undefined):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100
 const validWindow=(value:QuotaWindow|null|undefined):value is QuotaWindow&{usedPercent:number;windowDurationMins:number;resetsAt:number}=>value!=null&&validUsage(value.usedPercent)&&typeof value.windowDurationMins==='number'&&Number.isFinite(value.windowDurationMins)&&value.windowDurationMins>0&&typeof value.resetsAt==='number'&&Number.isFinite(value.resetsAt)&&value.resetsAt>0
 for(let i=1;i<samples.length;i++) {
  const previous=samples[i-1],current=samples[i]
  const separated=current.stamp-previous.stamp>5*60_000||current.bucketId!==previous.bucketId
  let skipped=separated
  for(const key of ['primary','secondary'] as const) {
   const before=previous.bucket[key],after=current.bucket[key]
   if(!before&&!after)continue
   if(separated||!validWindow(before)||!validWindow(after)||before.resetsAt!==after.resetsAt||before.windowDurationMins!==after.windowDurationMins||after.usedPercent<before.usedPercent) {skipped=true;continue}
   result[key]=(result[key]??0)+(after.usedPercent-before.usedPercent)
  }
  // Count an interval once even when both quota windows cannot be compared.
  if(skipped)result.skippedPairs++
 }
 return result
}
export function dailyTokens(buckets:{startDate:string;tokens:number}[]|null,date:string):number|null {
 const bucket=buckets?.find(b=>b.startDate===date);return bucket&&typeof bucket.tokens==='number'?bucket.tokens:null
}
export function buckets(codex:{rateLimitsByLimitId?:Record<string,QuotaBucket>|null;rateLimits?:QuotaBucket|null}):[string,QuotaBucket][] {
 const mapped=Object.entries(codex.rateLimitsByLimitId??{}).filter(([,bucket])=>bucket!=null&&typeof bucket==='object')
 return mapped.length?mapped:codex.rateLimits?[['codex',codex.rateLimits]]:[]
}
export const dateKey=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
export function dateInputValue(value:string,key:string):string {return key==='targetDate'?dateKey(new Date(value)):value.slice(0,10)}
export function dateTime(value:string|number|null|undefined):string { if(!value)return '暂无记录';const d=new Date(typeof value==='number'?value*1000:value);return Number.isNaN(d.getTime())?'未知时间':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) }
export function money(value:number|null|undefined,currency='CNY'):string { return value==null?'—':currency==='percent'?`${value}%`:new Intl.NumberFormat('zh-CN',{style:'currency',currency,maximumFractionDigits:2}).format(value) }
export const compact=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(n)
