import {describe,it,expect} from 'vitest'
import {shanghaiDay,dueCards,intervalLabel,sentenceContext,diffLabel,newerSnapshot,retainActionForRetry} from './english'
import type {EnglishCard,EnglishSnapshot} from './english-types'
const now=Date.parse('2026-10-18T00:00:00Z')
const snapshot=(revision:number):EnglishSnapshot=>({version:1,revision,serverNow:new Date(now).toISOString(),cards:[],days:{},history:[]})
describe('English display and synchronization helpers',()=>{
 it('uses Shanghai midnight for daily progress',()=>{expect(shanghaiDay(Date.parse('2026-10-17T16:01:00Z'))).toBe('2026-10-18')})
 it('orders only genuinely due cards and excludes malformed dates',()=>{const cards=[{wordId:'future',due:'2026-10-19'},{wordId:'bad',due:'invalid'},{wordId:'later',due:'2026-10-17'},{wordId:'earlier',due:'2026-10-16'}] as EnglishCard[];expect(dueCards(cards,now).map(c=>c.wordId)).toEqual(['earlier','later'])})
 it('formats server interval previews without calculating schedules',()=>{expect(intervalLabel('invalid',now)).toBe('时间待更新');expect(intervalLabel('2026-10-18T00:00:30Z',now)).toBe('不足 1 分钟');expect(intervalLabel('2026-10-18T02:00:00Z',now)).toBe('2 小时');expect(intervalLabel('2026-10-17T00:00:00Z',now)).toBe('现在')})
 it('preserves the exact clicked occurrence sentence',()=>{const p='A routine helps. This routine is consistent.';expect(sentenceContext(p,p.lastIndexOf('routine'))).toBe('This routine is consistent.')})
 it('represents missing, extra, and replacement words accessibly',()=>{expect(diffLabel({type:'missing',expected:'a'})).toEqual({text:'＋a',title:'漏写：a'});expect(diffLabel({type:'wrong',actual:'word',expected:'words'}).text).toBe('word → words');expect(diffLabel({type:'extra',actual:'the'}).title).toBe('多写：the')})
 it('never lets an older refresh roll back confirmed state',()=>{expect(newerSnapshot(snapshot(4),snapshot(3)).revision).toBe(4);expect(newerSnapshot(snapshot(4),snapshot(5)).revision).toBe(5)})
 it('keeps ambiguous failures retryable but releases rejected writes',()=>{expect(retainActionForRetry(new TypeError('network'))).toBe(true);expect(retainActionForRetry({status:503})).toBe(true);expect(retainActionForRetry({status:409})).toBe(false);expect(retainActionForRetry({status:400})).toBe(false)})
})
