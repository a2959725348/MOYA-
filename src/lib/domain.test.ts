import { describe,it,expect } from 'vitest'
import { remainingPercent, countdown, taskDueState, quotaChartData, dailyTokens, dateInputValue, buckets, dailyQuotaEstimate } from './domain'
describe('quota truthfulness',()=>{
 it('returns 75% for 25 used and unknown for missing values',()=>{expect(remainingPercent({usedPercent:25})).toBe(75);expect(remainingPercent(null)).toBe(null);expect(remainingPercent({usedPercent:null})).toBe(null)})
 it('clamps usage bounds',()=>{expect(remainingPercent({usedPercent:150})).toBe(0);expect(remainingPercent({usedPercent:-2})).toBe(100)})
 it('does not infer reset after its deadline',()=>{expect(countdown(1000,1_000_001)).toBe('等待同步');expect(countdown(null,1_000_001)).toBe('未提供刷新时间')})
 it('calculates reset seconds from server seconds not milliseconds',()=>{expect(countdown(1061,1_000_000)).toBe('00:01:01')})
 it('does not join different reset cycles into a fabricated daily total',()=>{const r=quotaChartData([{observedAt:'2026-10-02T00:00:00Z',rateLimits:{primary:{usedPercent:80,resetsAt:100}}},{observedAt:'2026-10-02T01:00:00Z',rateLimits:{primary:{usedPercent:2,resetsAt:200}}}]);expect(r[0].remaining).toBe(20);expect(r[1].remaining).toBe(98)})
 it('keeps missing daily tokens distinct from zero usage',()=>{expect(dailyTokens(null,'2026-10-02')).toBe(null);expect(dailyTokens([{startDate:'2026-10-02',tokens:0}],'2026-10-02')).toBe(0);expect(dailyTokens([],'2026-10-02')).toBe(null)})
 it('does not plot failed retries as newly successful quota observations',()=>{
  const quota={primary:{usedPercent:25}},sample='2026-10-02T00:00:00Z'
  const chart=quotaChartData([{observedAt:sample,syncedAt:sample,rateLimits:quota},{observedAt:'2026-10-02T01:00:00Z',syncedAt:sample,rateLimits:quota,error:'CODEX_TIMEOUT'},{observedAt:'2026-10-02T02:00:00Z',syncedAt:'2026-10-02T08:00:00+08:00',rateLimits:quota,error:'CODEX_AUTH_REQUIRED'}])
  expect(chart).toHaveLength(1);expect(chart[0].observedAt).toBe(sample);expect(chart[0].remaining).toBe(75)
 })
 it('retains a partial daily usage failure when quota has a new successful timestamp',()=>{
  const chart=quotaChartData([{observedAt:'2026-10-02T00:00:00Z',syncedAt:'2026-10-02T00:00:00Z',rateLimits:{primary:{usedPercent:25}}},{observedAt:'2026-10-02T01:00:00Z',syncedAt:'2026-10-02T01:00:00Z',error:'CODEX_USAGE_UNAVAILABLE',rateLimits:{primary:{usedPercent:30}}}])
  expect(chart.map(row=>row.remaining)).toEqual([75,70]);expect(chart[1].observedAt).toBe('2026-10-02T01:00:00Z')
 })
 it('never invents a successful timestamp for failed-only or invalid history',()=>{
  expect(quotaChartData([{observedAt:'2026-10-02T01:00:00Z',syncedAt:null,error:'CODEX_TIMEOUT',rateLimits:{primary:{usedPercent:25}}},{observedAt:'2026-10-02T02:00:00Z',error:'CODEX_TIMEOUT',rateLimits:{primary:{usedPercent:25}}},{observedAt:'invalid',rateLimits:{primary:{usedPercent:25}}}])).toEqual([])
 })
 it('uses the original success time if bounded history contains only a retained failed snapshot',()=>{
  const chart=quotaChartData([{observedAt:'2026-10-02T01:00:00Z',syncedAt:'2026-10-02T00:00:00Z',error:'CODEX_TIMEOUT',rateLimits:{primary:{usedPercent:25}}}])
  expect(chart).toHaveLength(1);expect(chart[0].observedAt).toBe('2026-10-02T00:00:00Z')
 })
 it('plots the first real map-only bucket even when its id is not codex',()=>{
  const q={primary:{usedPercent:40}}
  expect(buckets({rateLimitsByLimitId:{research:q}})).toEqual([['research',q]])
  const chart=quotaChartData([{observedAt:'2026-10-02T00:00:00Z',rateLimitsByLimitId:{research:q}}]);expect(chart[0].remaining).toBe(60)
 })
 it('falls back to legacy quota when the bucket map is empty',()=>{
  const q={primary:{usedPercent:25}}
  expect(buckets({rateLimitsByLimitId:{},rateLimits:q})).toEqual([['codex',q]])
  expect(quotaChartData([{observedAt:'2026-10-02T00:00:00Z',rateLimitsByLimitId:{},rateLimits:q}])[0].remaining).toBe(75)
 })
})
describe('task deadline',()=>{
 it('marks pending task overdue and leaves completed task complete',()=>{expect(taskDueState({status:'pending',dueAt:'2026-10-01T00:00:00Z'},Date.parse('2026-10-02T00:00:00Z'))).toBe('overdue');expect(taskDueState({status:'completed',dueAt:'2026-10-01T00:00:00Z'})).toBe('completed')})
 it('preserves unknown deadlines',()=>expect(taskDueState({status:'pending',dueAt:null})).toBe('pending'))
})
describe('date editor',()=>{
 it('round-trips a Beijing target date without losing a day on each edit',()=>{const stored=new Date('2026-10-10T00:00:00+08:00').toISOString();expect(dateInputValue(stored,'targetDate')).toBe('2026-10-10');expect(dateInputValue('2026-10-10','date')).toBe('2026-10-10')})
})
describe('daily monitored quota estimate',()=>{
 const sample=(time:string,primary:number,secondary=10,reset=1800000000)=>({observedAt:time,rateLimits:{primary:{usedPercent:primary,windowDurationMins:300,resetsAt:reset},secondary:{usedPercent:secondary,windowDurationMins:10080,resetsAt:1800600000}}})
 it('sums observed positive changes within unchanged windows without extrapolation',()=>{
  const result=dailyQuotaEstimate([sample('2026-10-02T08:00:00+08:00',20,10),sample('2026-10-02T08:04:00+08:00',23,12),sample('2026-10-02T08:09:00+08:00',25,12)],'codex','2026-10-02')
  expect(result).toEqual({primary:5,secondary:2,sampleCount:3,from:'2026-10-02T08:00:00+08:00',to:'2026-10-02T08:09:00+08:00',skippedPairs:0})
 })
 it('keeps a measured zero distinct from an unavailable estimate',()=>{
  expect(dailyQuotaEstimate([sample('2026-10-02T00:00:00Z',0,0),sample('2026-10-02T00:01:00Z',0,0)],'codex','2026-10-02').primary).toBe(0)
  expect(dailyQuotaEstimate([],'codex','2026-10-02')).toEqual({primary:null,secondary:null,sampleCount:0,from:null,to:null,skippedPairs:0})
  expect(dailyQuotaEstimate([sample('2026-10-02T00:00:00Z',20)],'codex','2026-10-02').primary).toBe(null)
 })
 it('uses Beijing day boundaries and successful timestamps, deduplicating failed retries',()=>{
  const first=sample('2026-10-01T16:00:00Z',20),next=sample('2026-10-01T16:03:00Z',22)
  const result=dailyQuotaEstimate([sample('2026-10-01T15:59:00Z',18),first,{...first,observedAt:'2026-10-01T16:01:00Z',syncedAt:first.observedAt,error:'CODEX_TIMEOUT'},{...next,syncedAt:next.observedAt,error:'CODEX_USAGE_UNAVAILABLE'},sample('2026-10-02T16:00:00Z',30)],'codex','2026-10-02')
  expect(result.primary).toBe(2);expect(result.sampleCount).toBe(2);expect(result.from).toBe(first.observedAt);expect(result.to).toBe(next.observedAt);expect(result.skippedPairs).toBe(0)
 })
 it('skips resets, long gaps and declines independently for each window',()=>{
  const result=dailyQuotaEstimate([sample('2026-10-02T00:00:00Z',20,10),sample('2026-10-02T00:01:00Z',2,11,1800010000),sample('2026-10-02T00:02:00Z',1,12,1800010000),sample('2026-10-02T00:08:00Z',10,13,1800010000),sample('2026-10-02T00:09:00Z',12,14,1800010000)],'codex','2026-10-02')
  expect(result.primary).toBe(2);expect(result.secondary).toBe(3);expect(result.skippedPairs).toBe(3)
 })
 it('returns unknown when windows lack matching duration/reset or valid usage',()=>{
  const base=sample('2026-10-02T00:00:00Z',20)
  const rows=[base,{observedAt:'2026-10-02T00:01:00Z',rateLimits:{primary:{usedPercent:25,windowDurationMins:60,resetsAt:1800000000}}},{observedAt:'2026-10-02T00:02:00Z',rateLimits:{primary:{usedPercent:101,windowDurationMins:60,resetsAt:1800000000}}},{observedAt:'2026-10-02T00:03:00Z',rateLimits:{primary:{usedPercent:26,windowDurationMins:60,resetsAt:null}}}]
  const result=dailyQuotaEstimate(rows,'codex','2026-10-02');expect(result.primary).toBe(null);expect(result.secondary).toBe(null);expect(result.skippedPairs).toBe(3)
 })
 it('matches chart semantics for map-only buckets and empty map legacy fallback',()=>{
  const first=sample('2026-10-02T00:00:00Z',20),next=sample('2026-10-02T00:01:00Z',23)
  expect(dailyQuotaEstimate([{observedAt:first.observedAt,rateLimitsByLimitId:{research:first.rateLimits}},{observedAt:next.observedAt,rateLimitsByLimitId:{research:next.rateLimits}}],'codex','2026-10-02').primary).toBe(3)
  expect(dailyQuotaEstimate([{...first,rateLimitsByLimitId:{}},{...next,rateLimitsByLimitId:{}}],'codex','2026-10-02').primary).toBe(3)
 })
})
