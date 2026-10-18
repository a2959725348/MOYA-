import {describe, expect, it} from 'vitest'
import {apiBalances} from './workspace'
import type {Account} from './types'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import Overview from '../pages/overview'
import {demoState} from './demo'
import {vi} from 'vitest'

const fixture=vi.hoisted(()=>({workbench:{} as unknown}))
vi.mock('./store',()=>({useWorkbench:()=>fixture.workbench}))

const account = (values: Partial<Account>): Account => ({id:'a',name:'API',provider:'test',type:'api',currency:'CNY',balance:null,total:null,resetsAt:null,note:'',source:'manual',threshold:null,createdAt:'',updatedAt:'',...values})

describe('overview API balance summary', () => {
  it('does not turn missing balances into an available zero balance', () => {
    expect(apiBalances([])).toEqual([])
    expect(apiBalances([account({balance:null})])).toEqual([])
  })
  it('keeps currencies separate while preserving an actual zero balance', () => {
    expect(apiBalances([account({balance:12.5}),account({balance:4.3}),account({currency:'USD',balance:0})])).toEqual([
      {currency:'CNY',balance:16.8,count:2},
      {currency:'USD',balance:0,count:1},
    ])
  })
  it('excludes subscription quotas, percentage units and unusable numeric values', () => {
    expect(apiBalances([
      account({type:'subscription',balance:90}),account({currency:'percent',balance:70}),
      account({balance:NaN}),account({balance:Infinity}),account({balance:-10}),
    ])).toEqual([])
  })
})

it('shows no invented daily target when the account has not saved a goal',()=>{
  const state=demoState()
  state.goals=[]
  fixture.workbench={state,demo:true,setPage:vi.fn(),save:vi.fn(),notify:vi.fn()}
  const html=renderToStaticMarkup(createElement(Overview))
  expect(html).toContain('未设置学习目标')
  expect(html).not.toContain('每日目标')
})
