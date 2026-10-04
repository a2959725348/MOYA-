import {createContext,useContext,useState,useEffect,useCallback,type ReactNode,type Dispatch,type SetStateAction} from 'react'
import {api,ApiError} from './api'
import {demoState} from './demo'
import type {State,Collection,Page} from './types'
type FocusTimer={startedAt:number|null;elapsed:number;subject:string}
type Store={state:State|null;demo:boolean;page:Page;setPage:(page:Page)=>void;refresh:()=>Promise<void>;save:(collection:Collection,record:Record<string,unknown>,id?:string)=>Promise<void>;remove:(collection:Collection,id:string)=>Promise<void>;action:<T=Record<string,unknown>>(path:string,body?:unknown,method?:string)=>Promise<T>;notify:(text:string,kind?:'success'|'error')=>void;busy:boolean;timer:FocusTimer;setTimer:Dispatch<SetStateAction<FocusTimer>>}
const Context=createContext<Store|null>(null)
export const useWorkbench=()=>{const c=useContext(Context);if(!c)throw new Error('Missing workbench provider');return c}
export function WorkbenchProvider({demo,children,onExpired}:{demo:boolean;children:ReactNode;onExpired:()=>void}){
 const [state,setState]=useState<State|null>(demo?demoState():null),[page,setPage]=useState<Page>('overview'),[busy,setBusy]=useState(false),[toast,setToast]=useState<{text:string;kind:string}|null>(null)
 const [timer,setTimer]=useState<FocusTimer>({startedAt:null,elapsed:0,subject:'学习'})
 const notify=useCallback((text:string,kind='success')=>setToast({text,kind}),[])
 useEffect(()=>{if(toast){const timer=setTimeout(()=>setToast(null),5000);return()=>clearTimeout(timer)}},[toast])
 const refresh=useCallback(async()=>{if(demo)return;try{setState(await api<State>('/state'))}catch(e){if(e instanceof ApiError&&e.status===401){setState(null);onExpired();return}notify((e as Error).message,'error')}},[demo,notify,onExpired])
 useEffect(()=>{void refresh();if(!demo){const timer=setInterval(()=>void refresh(),30000);return()=>clearInterval(timer)}},[refresh,demo])
 const action=useCallback(async<T,>(path:string,body?:unknown,method?:string):Promise<T>=>{if(demo)throw new Error('演示模式只供浏览，请退出演示并创建个人账户后保存。');setBusy(true);try{const r=await api<T>(path,body,method);await refresh();return r}catch(e){if(e instanceof ApiError&&e.status===401){setState(null);onExpired()}throw e}finally{setBusy(false)}},[demo,refresh,onExpired])
 const save=async(collection:Collection,record:Record<string,unknown>,id?:string)=>{await action(`/records/${collection}${id?`/${id}`:''}`,record,id?'PATCH':'POST');notify('已保存，电脑和手机共用这份记录')}
 const remove=async(collection:Collection,id:string)=>{await action(`/records/${collection}/${id}`,undefined,'DELETE');notify('记录已删除')}
 return <Context.Provider value={{state,demo,page,setPage,refresh,save,remove,action,notify,busy,timer,setTimer}}>{children}{toast&&<div className={`toast ${toast.kind}`} role="status">{toast.text}<button aria-label="关闭通知" onClick={()=>setToast(null)}>×</button></div>}</Context.Provider>
}
