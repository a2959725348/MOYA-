export class ApiError extends Error {status:number;constructor(message:string,status:number){super(message);this.name='ApiError';this.status=status}}
export async function readApiError(response:Response):Promise<ApiError>{
 let message=response.status>=500?`服务暂时不可用（HTTP ${response.status}），请稍后重试`:`请求失败（HTTP ${response.status}）`
 try{const result=await response.json();if(typeof result?.error==='string'&&result.error.trim())message=result.error}catch{/* A gateway may return HTML instead of the application's JSON. */}
 return new ApiError(message,response.status)
}
export async function api<T=Record<string,unknown>>(path:string,body?:unknown,method?:string):Promise<T>{
 const response=await fetch(`/api${path}`,{method:method??(body===undefined?'GET':'POST'),credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
 const result=await response.json().catch(()=>({error:'服务器返回了无法读取的数据'}))
 if(!response.ok)throw new ApiError(result.error??`请求失败 (${response.status})`,response.status)
 return result as T
}
