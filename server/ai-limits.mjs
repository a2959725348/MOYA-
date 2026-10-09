import { fail } from './demands.mjs';
export const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const analysisCostKey=(id,analysis)=>JSON.stringify([id,analysis.analyzedAt,analysis.cost,analysis.currency]);
const entryCostKey=entry=>entry.analysisKey||JSON.stringify([entry.id,entry.at,entry.cost,entry.currency]);
export function knownDailyCost(store,ai){
  const day=dayFormat.format(new Date()),ledger=store.get('demandAnalysisCosts',{day,entries:[]});
  const entries=ledger.day===day?ledger.entries:[],tracked=new Set(entries.map(entryCostKey));
  const costs=[...store.list('chatMessages').filter(r=>r.role==='assistant').map(r=>({...r,at:r.createdAt})),...store.list('demands').filter(r=>r.analysis&&!tracked.has(analysisCostKey(r.id,r.analysis))).map(r=>({...r.analysis,at:r.analysis.analyzedAt})),...entries];
  return costs.filter(r=>r.currency===ai.currency&&typeof r.cost==='number'&&dayFormat.format(new Date(r.at))===day).reduce((sum,r)=>sum+r.cost,0);
}
export function reserveAIRequest(store,ai){
  if(ai.dailyBudget!=null&&knownDailyCost(store,ai)>=ai.dailyBudget)throw Object.assign(fail('今天已记录的估算费用达到预算阈值；此阈值在下一次调用前检查，不保证实际账单上限',429),{code:'ESTIMATED_BUDGET_REACHED'});
  const day=dayFormat.format(new Date()),previous=store.get('chatCounter',{day,count:0}),counter=previous.day===day?{...previous}:{day,count:0};
  if(counter.count>=ai.dailyRequestLimit)throw fail('今天的 AI 请求次数已达到上限',429);
  counter.count++;store.set('chatCounter',counter);
}
export function recordAnalysisCost(store,original,analysis,eventId){
  const day=dayFormat.format(new Date()),previous=store.get('demandAnalysisCosts',{day,entries:[]}),entries=previous.day===day?previous.entries:[];
  const previousCount=entries.length;
  // A call owns this identity before any CAS retries. Replaying accounting is
  // harmless, even if its answer cannot be attached after editing or logout.
  if(entries.some(e=>e.eventId===eventId))return;
  const prior=original.analysis,priorKey=prior&&analysisCostKey(original.id,prior);
  if(prior?.cost!==undefined&&dayFormat.format(new Date(prior.analyzedAt))===day&&!entries.some(e=>entryCostKey(e)===priorKey))entries.push({id:original.id,analysisKey:priorKey,cost:prior.cost,currency:prior.currency,at:prior.analyzedAt});
  if(analysis.cost!==undefined)entries.push({eventId,id:original.id,analysisKey:analysisCostKey(original.id,analysis),cost:analysis.cost,currency:analysis.currency,at:analysis.analyzedAt});
  if(entries.length!==previousCount)store.set('demandAnalysisCosts',{day,entries});
}
