import {describe,it,expect} from 'vitest'
import type {Task} from './types'
import {buildTaskImport,compareTaskDueAt} from './task-import'
const now='2026-10-02T12:00:00.000Z'
const old:Task={id:'existing-id',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-02T00:00:00.000Z',platformId:'shared',title:'Old',course:'Math',type:'assignment',dueAt:'2026-10-04T12:00:00Z',status:'completed',url:'https://example.edu/task',note:'Keep my note',source:'chaoxing'}
function build(data:unknown,existing:Task[]=[]):Task[]{
  return buildTaskImport(data,existing,now)
}
describe('task file import',()=>{
  it('uses a short independent UUID for a valid long platform ID',()=>{
    const platformId='p'.repeat(100),records=build({tasks:[{platformId,title:'Assignment'}]})
    expect(records).toHaveLength(1);expect(records[0].platformId).toBe(platformId)
    expect(records[0].id).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i)
    expect(records[0].id.length).toBeLessThanOrEqual(100)
  })
  it('merges duplicate platform IDs using later provided fields and earlier missing fields',()=>{
    const records=build([{platformId:'same',title:'First',course:'Math',type:'exam',dueAt:'2026-10-03T12:00:00Z'},{platformId:'same',title:'Last',url:'https://example.edu/task',dueAt:null}])
    expect(records).toHaveLength(1);expect(records[0]).toMatchObject({title:'Last',course:'Math',type:'exam',dueAt:null,url:'https://example.edu/task'})
  })
  it('preserves existing Chaoxing ID, source, status, creation time and notes',()=>{
    const records=build([{platformId:'shared',title:'Updated'}],[old])
    expect(records[0]).toMatchObject({id:'existing-id',source:'chaoxing',status:'completed',createdAt:old.createdAt,updatedAt:now,title:'Updated',course:'Math',note:'Keep my note'})
    expect(old.title).toBe('Old')
  })
  it('updates an existing pending task when imported status is explicitly completed',()=>{
    const records=build([{platformId:'shared',title:'Submitted',status:'completed'}],[{...old,status:'pending'}])
    expect(records[0].id).toBe('existing-id');expect(records[0].status).toBe('completed')
  })
  it('restores an existing completed task when imported status is explicitly pending',()=>{
    const records=build([{platformId:'shared',title:'Reopened',status:'pending'}],[old])
    expect(records[0].id).toBe('existing-id');expect(records[0].status).toBe('pending')
  })
  it('does not reuse an unrelated manual task with the same platform ID',()=>{
    const records=build([{platformId:'shared',title:'Platform task'}],[{...old,source:'manual'}])
    expect(records[0].id).not.toBe('existing-id');expect(records[0].source).toBe('chaoxing');expect(records[0].status).toBe('pending')
  })
  it('rejects the whole import when any item is invalid, including an invalid duplicate',()=>{
    for(const invalid of [{platformId:'x',title:''},{platformId:'x',title:'Bad',type:'unknown'},{platformId:'x',title:'Bad',dueAt:'not-a-date'},{platformId:'x',title:'Bad',status:'unknown'},{platformId:'x',title:'Bad',url:'javascript:alert(1)'},{platformId:' '.repeat(4),title:'Bad'},null]){
      expect(()=>build([{platformId:'x',title:'Good'},invalid],[old])).toThrow()
      expect(old.title).toBe('Old')
    }
  })
  it('accepts an empty tasks list but rejects malformed input or more than 1000 items',()=>{
    expect(build({tasks:[]})).toEqual([])
    expect(()=>build({items:[]})).toThrow()
    expect(()=>build(Array.from({length:1001},(_,i)=>({platformId:String(i),title:'Task'})))).toThrow()
  })
})
describe('task deadline ordering',()=>{
  it('sorts by the actual instant across offsets and puts missing or invalid dates last',()=>{
    const records=[{dueAt:null,title:'Missing'},{dueAt:'2026-10-03T00:00:00+08:00',title:'Earlier'},{dueAt:'2026-10-02T20:00:00Z',title:'Later'},{dueAt:'invalid',title:'Invalid'}]
    expect(records.sort(compareTaskDueAt).map(item=>item.title)).toEqual(['Earlier','Later','Missing','Invalid'])
  })
})
