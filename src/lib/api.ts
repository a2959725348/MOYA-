export class ApiError extends Error {status:number;constructor(message:string,status:number){super(message);this.name='ApiError';this.status=status}}
export async function api<T=Record<string,unknown>>(path:string,body?:unknown,method?:string):Promise<T>{
 const response=await fetch(`/api${path}`,{method:method??(body===undefined?'GET':'POST'),credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
 const result=await response.json().catch(()=>({error:'服务器返回了无法读取的数据'}))
 if(!response.ok)throw new ApiError(result.error??`请求失败 (${response.status})`,response.status)
 return result as T
}
