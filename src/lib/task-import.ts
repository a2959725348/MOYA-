import {z} from 'zod'
import type {Task} from './types'

const text=z.string().trim().max(1000)
const inputSchema=z.object({
  platformId:z.string().trim().min(1).max(200),
  title:z.string().trim().min(1).max(500),
  course:text.optional(),
  type:z.enum(['assignment','exam','other']).optional(),
  dueAt:z.string().max(50).refine(value=>/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),'截止时间无效').nullable().optional(),
  status:z.enum(['pending','completed']).optional(),
  url:z.string().max(2000).refine(value=>{if(value==='')return true;try{return ['http:','https:'].includes(new URL(value).protocol)}catch{return false}},'任务链接必须为有效的 HTTP(S) 地址').optional(),
  note:text.optional(),
}).strict()

/** Validate every input before returning a deduplicated, restore-ready task batch. */
export function buildTaskImport(data:unknown,existing:Task[],now=new Date().toISOString()):Task[]{
  const rows=Array.isArray(data)?data:data&&typeof data==='object'?'tasks' in data?data.tasks:undefined:undefined
  if(!Array.isArray(rows)||rows.length>1000)throw new Error('请提供最多 1000 项的 tasks 数组')
  const parsed=rows.map((row,index)=>{
    const result=inputSchema.safeParse(row)
    if(!result.success)throw new Error(`第 ${index+1} 项任务无效，请检查 platformId、标题、类型、截止时间、状态和链接`)
    return result.data
  })
  const previous=new Map(existing.filter(task=>task.source==='chaoxing'&&task.platformId).map(task=>[task.platformId!.trim(),task]))
  const merged=new Map<string,Task>()
  for(const row of parsed){
    const old=previous.get(row.platformId),prior=merged.get(row.platformId)??old
    merged.set(row.platformId,{
      id:prior?.id??crypto.randomUUID(),createdAt:prior?.createdAt??now,updatedAt:now,
      platformId:row.platformId,title:row.title,course:row.course??prior?.course??'',
      type:row.type??prior?.type??'assignment',dueAt:row.dueAt===undefined?prior?.dueAt??null:row.dueAt,
      status:row.status??prior?.status??'pending',
      url:row.url??prior?.url??'',note:old?.note??row.note??prior?.note??'',source:old?.source??'chaoxing',
    })
  }
  return [...merged.values()]
}

export function compareTaskDueAt(a:{dueAt:string|null},b:{dueAt:string|null}):number{
  const stamp=(value:string|null)=>{const parsed=value?Date.parse(value):NaN;return Number.isFinite(parsed)?parsed:Infinity}
  const first=stamp(a.dueAt),second=stamp(b.dueAt)
  return first===second?0:first<second?-1:1
}
