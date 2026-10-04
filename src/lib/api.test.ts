import {afterEach,describe,it,expect,vi} from 'vitest'
import {api,ApiError} from './api'
afterEach(()=>vi.unstubAllGlobals())
describe('authenticated API responses',()=>{
 it('exposes session expiry distinctly so the workspace can return to login',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({error:'请先登录'}),{status:401}));await expect(api('/state')).rejects.toMatchObject({status:401,message:'请先登录'});try{await api('/state')}catch(e){expect(e).toBeInstanceOf(ApiError)}})
 it('keeps validation failures distinct from an expired login',async()=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({error:'字段无效'}),{status:400}));await expect(api('/settings',{},'PUT')).rejects.toMatchObject({status:400,message:'字段无效'})})
 it('sends credentials only to the same site and retains the JSON response',async()=>{const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:true})));vi.stubGlobal('fetch',fetch);expect(await api('/records/tasks',{title:'Test'})).toEqual({ok:true});expect(fetch).toHaveBeenCalledWith('/api/records/tasks',expect.objectContaining({method:'POST',credentials:'same-origin',body:'{"title":"Test"}'}))})
})
