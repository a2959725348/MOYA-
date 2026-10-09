import {describe,it,expect} from 'vitest'
import {filterDemands,evaluateDemands,parseDemandImport,normalizeDemandCollections} from './demands'

const base={id:'a',createdAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z',text:'订阅付款失败，想了解官方排查方法',source:'manual' as const,sourceUrl:'',rightsConfirmed:true as const,status:'pending' as const,analysis:null}
const analysis={category:'payment_failure' as const,summary:'付款问题',reason:'仍在提问',evidence:['付款失败'],draftReply:'请查看官方帮助。',confidence:0.8,model:'fixture-model',analyzedAt:'2026-10-09T00:01:00Z'}

describe('demand review selection',()=>{
 it('combines text search with independent AI category and review status filters',()=>{
  const records=[{...base,analysis},{...base,id:'b',status:'approved' as const,analysis},{...base,id:'c',text:'已经解决',analysis:{...analysis,category:'already_solved' as const}}]
  expect(filterDemands(records,{search:'  官方  ',category:'payment_failure',status:'pending'}).map(r=>r.id)).toEqual(['a'])
  expect(filterDemands(records,{search:'',category:'unanalyzed',status:'all'})).toEqual([])
  expect(filterDemands([{...base,expectedCategory:'payment_failure' as const}],{search:'',category:'payment_failure',status:'all'})).toEqual([])
 })
 it('searches source text and URL without treating AI draft text as original evidence',()=>{
  expect(filterDemands([{...base,analysis}],{search:'请查看',category:'all',status:'all'})).toEqual([])
  expect(filterDemands([{...base,sourceUrl:'https://EXAMPLE.com/post'}],{search:'example',category:'all',status:'all'})).toHaveLength(1)
 })
 it('counts only labelled analyzed records, including mismatches and reviewed dismissals',()=>{
  const records=[{...base,analysis,expectedCategory:'payment_failure' as const},{...base,id:'b',analysis,expectedCategory:'unrelated' as const,status:'dismissed' as const},{...base,id:'c',analysis},{...base,id:'d',expectedCategory:'payment_failure' as const}]
  expect(evaluateDemands(records)).toEqual({labelled:3,analyzed:3,total:2,agreed:1,agreement:0.5,models:['fixture-model']})
  expect(evaluateDemands([base])).toEqual({labelled:0,analyzed:0,total:0,agreed:0,agreement:null,models:[]})
 })
})
describe('editable JSON import',()=>{
 it('builds only editable fields and requires an explicit external rights confirmation',()=>{
  expect(()=>parseDemandImport('[{"text":"问题","source":"manual"}]',false)).toThrow(/确认/)
  expect(parseDemandImport('[{"text":"  问题  ","source":"manual","expectedCategory":"uncertain"}]',true)).toEqual([{text:'问题',source:'manual',sourceUrl:'',rightsConfirmed:true,expectedCategory:'uncertain',status:'pending'}])
 })
 it('rejects malformed, empty, oversized or partially invalid batches before submission',()=>{
  for(const text of ['{bad','{}','[]',JSON.stringify(Array.from({length:21},()=>({text:'问题',source:'manual'}))), '[{"text":"问题","source":"manual"},null]', '[{"text":"问题","source":"manual","analysis":null}]','[{"text":"问题","source":"manual","expectedCategory":"fake"}]'])expect(()=>parseDemandImport(text,true)).toThrow()
 })
 it('rejects unsafe URLs and source fields while accepting the maximum valid batch',()=>{
  for(const url of ['https://a.test/?token=x','javascript:alert(1)','https://user:pass@a.test/'])expect(()=>parseDemandImport(JSON.stringify([{text:'问题',source:'sample',sourceUrl:url}]),true)).toThrow(/链接/)
  expect(()=>parseDemandImport('[{"text":"问题","source":"scraped"}]',true)).toThrow(/来源/)
  expect(parseDemandImport(JSON.stringify(Array.from({length:20},()=>({text:'问题',source:'sample'}))),true)).toHaveLength(20)
 })
})
describe('older state compatibility',()=>{
 it('defaults only absent new collections and preserves historical market records',()=>{
  const older={watchlist:[{id:'old'}],quotes:[{price:1}]}
  expect(normalizeDemandCollections(older)).toEqual({...older,demands:[],consultations:[]})
  expect(older).not.toHaveProperty('demands')
  const current={...older,demands:[base],consultations:[{id:'consult'}]}
  expect(normalizeDemandCollections(current)).toEqual(current)
 })
})
