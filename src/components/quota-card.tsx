import {useEffect,useState} from 'react'
import {Clock,Terminal,CalendarClock,ArrowUpRight} from 'lucide-react'
import {Card,CardContent,Badge,Progress} from './common'
import {remainingPercent,countdown,dateTime} from '../lib/domain'
import type {QuotaWindow} from '../lib/types'
export function QuotaCard({window,kind='primary',status,onConnect}:{window:QuotaWindow|null|undefined;kind?:string;status:string;onConnect?:()=>void}){
 const [now,setNow]=useState(Date.now());useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[])
 const percent=remainingPercent(window),weekly=kind==='secondary',expired=window?.resetsAt!=null&&window.resetsAt*1000<=now
 const title=window?.windowDurationMins===300?'5 小时额度':window?.windowDurationMins===10080?'周额度':window?.windowDurationMins?`${window.windowDurationMins} 分钟额度`:weekly?'周额度':'5 小时额度'
 return <Card className={`quota-card ${weekly?'weekly':''}`}><CardContent><div className="quota-top"><span className={`quota-icon ${weekly?'violet':'blue'}`}>{weekly?<CalendarClock size={18}/>:<Terminal size={18}/>}</span><span>{title}</span><Badge variant="outline" className={status==='ok'&&!expired?'badge-green':'badge-muted'}>{expired?'待刷新':status==='ok'?'已同步':status==='stale'?'同步过期':status==='error'?'同步失败':'未连接'}</Badge></div><div className="quota-main">{percent===null?<span className="unknown">—</span>:<>{percent}<span>%</span></>}<small>剩余可用</small></div><Progress value={percent} tone={weekly?'violet':'blue'}/><div className="quota-footer">{window&&<span>已用 {window.usedPercent==null?'—':`${window.usedPercent}%`}</span>}<div><Clock size={14}/><span>{window?countdown(window.resetsAt,now):'连接后显示倒计时'}</span></div>{!window&&onConnect?<button onClick={onConnect}>连接助手 <ArrowUpRight size={13}/></button>:<small>刷新于 {dateTime(window?.resetsAt)}</small>}</div></CardContent></Card>
}
