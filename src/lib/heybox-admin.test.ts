import {describe,expect,it,vi} from 'vitest'
import HeyboxAdmin from '../components/heybox-admin'
import {matchManualText,parseKeywordInput,renderManualTemplate,configEditorFrom,configEditorDirty,reconcileConfigEditor,draftEditorFrom,draftEditorDirty,reconcileDraftEditor,isReviewStale,canApproveReview,type HeyboxConfig,type HeyboxReview} from './heybox-admin'

const config:HeyboxConfig={revision:2,topicKeywords:['ChatGPT','Plus'],demandKeywords:['如何订阅','支付失败'],excludeKeywords:['已经解决','广告'],replyTemplate:'{{问题}} / {{摘要}} / {{关键词}}'}
const source={id:'d1',updatedAt:'2026-10-17T00:00:00.000Z'}
const review:HeyboxReview={id:'d1',demandId:'d1',sourceUpdatedAt:source.updatedAt,draft:'已有草稿',status:'pending',note:'原备注',createdAt:source.updatedAt,updatedAt:'2026-10-17T00:01:00.000Z',stale:false}

// Exercise the component's own handlers and reconciliation without a DOM dependency.
const component=vi.hoisted(()=>({values:[] as unknown[],cursor:0,effects:[] as (()=>unknown)[],workbench:{} as unknown}))
vi.mock('./store',()=>({useWorkbench:()=>component.workbench}))
vi.mock('react',async importOriginal=>({
 ...await importOriginal<typeof import('react')>(),
 useState(initial:unknown){
  const index=component.cursor++
  if(!(index in component.values))component.values[index]=typeof initial==='function'?initial():initial
  return [component.values[index],(next:unknown)=>{component.values[index]=typeof next==='function'?next(component.values[index]):next}]
 },
 useEffect(effect:()=>unknown){component.effects.push(effect)},
 useCallback(callback:unknown){return callback},
 useRef(current:unknown){return {current}},
}))
type TestElement={type:unknown;props:{children?:unknown;value?:unknown;className?:string;onChange?:(event:{target:{value:string}})=>void;onClick?:()=>void}}
function findElement(tree:unknown,predicate:(element:TestElement)=>boolean):TestElement|undefined{
 if(Array.isArray(tree)){for(const child of tree){const found=findElement(child,predicate);if(found)return found}return}
 if(!tree||typeof tree!=='object'||!('props' in tree))return
 const element=tree as TestElement
 return predicate(element)?element:findElement(element.props.children,predicate)
}
function renderAdmin(){component.cursor=0;component.effects=[];return HeyboxAdmin({children:null})}
function sourceSelector(tree:unknown){return findElement(tree,element=>element.type==='select'&&!!findElement(element.props.children,child=>child.type==='option'&&child.props.children==='选择一条已录入的需求'))!}
function draftTextarea(tree:unknown){return findElement(tree,element=>element.type==='textarea'&&typeof element.props.value==='string')!}
function mountLegacySource(id:string,saved=false){
 const legacy={...source,id,text:'可人工审核的旧记录'}
 const savedReview={...review,id,demandId:id}
 const admin={version:1,mode:'manual',config,reviews:saved?[savedReview]:[],logs:[],capabilities:{platformConnected:false,autoRead:false,autoReply:false,follow:false,directMessage:false}}
 component.values=['reviews',admin];component.workbench={state:{demands:[legacy,{...legacy,id:'other'}],consultations:[],settings:{ai:{model:'test'}}},demo:false,busy:false}
 return {tree:renderAdmin(),legacy,savedReview,admin}
}

describe.each(['constructor','toString','__proto__'])('legacy source draft cache: %s',id=>{
 it('initializes an empty editable draft for a newly selected source',()=>{
  const {tree}=mountLegacySource(id)
  sourceSelector(tree).props.onChange!({target:{value:id}})
  expect(draftTextarea(renderAdmin()).props.value).toBe('')
 })
 it('opens a saved review without treating inherited cache properties as drafts',()=>{
  const {tree}=mountLegacySource(id,true)
  const row=findElement(tree,element=>element.type==='button'&&!!findElement(element.props.children,child=>child.type==='strong'&&child.props.children==='可人工审核的旧记录'))!
  row.props.onClick!()
  expect(draftTextarea(renderAdmin()).props.value).toBe('已有草稿')
 })
 it('preserves unsaved text and original version tokens across refresh and source switches',()=>{
  const {tree,legacy,savedReview,admin}=mountLegacySource(id,true)
  sourceSelector(tree).props.onChange!({target:{value:id}})
  let rendered=renderAdmin()
  draftTextarea(rendered).props.onChange!({target:{value:'保留本地未保存草稿'}})
  rendered=renderAdmin()
  // A background read returns a newer source and review before switching away.
  component.values[1]={...admin,reviews:[{...savedReview,draft:'另一设备更新',updatedAt:'2026-10-17T00:09:00.000Z'}]}
  component.workbench={state:{demands:[{...legacy,updatedAt:'2026-10-17T00:08:00.000Z'},{...legacy,id:'other'}],consultations:[],settings:{ai:{model:'test'}}},demo:false,busy:false}
  renderAdmin();component.effects[2]()
  rendered=renderAdmin()
  sourceSelector(rendered).props.onChange!({target:{value:'other'}})
  rendered=renderAdmin()
  sourceSelector(rendered).props.onChange!({target:{value:id}})
  rendered=renderAdmin()
  expect(draftTextarea(rendered).props.value).toBe('保留本地未保存草稿')
  expect(findElement(rendered,element=>element.type==='small'&&element.props.className==='hba-unsaved')).toBeDefined()
  const cached=(component.values[10] as Record<string,unknown>)[id]
  expect(cached).toMatchObject({demandId:id,sourceUpdatedAt:'2026-10-17T00:00:00.000Z',expectedUpdatedAt:'2026-10-17T00:01:00.000Z',draft:'保留本地未保存草稿'})
 })
})

describe('manual keyword prefilter',()=>{
 it('requires both groups but accepts any literal term within each group',()=>{
  expect(matchManualText(config,'chatgpt 如何订阅')).toEqual({matched:true,topicTerms:['ChatGPT'],demandTerms:['如何订阅'],excludedTerms:[]})
  expect(matchManualText(config,'Plus 支付失败')).toEqual({matched:true,topicTerms:['Plus'],demandTerms:['支付失败'],excludedTerms:[]})
  expect(matchManualText(config,'ChatGPT 讨论')).toMatchObject({matched:false})
  expect(matchManualText(config,'如何订阅游戏')).toMatchObject({matched:false})
 })
 it('gives exclusions priority even when both positive groups match',()=>{
  expect(matchManualText(config,'ChatGPT 支付失败，但是已经解决')).toMatchObject({matched:false,excludedTerms:['已经解决']})
 })
 it('treats punctuation and phrases literally without regex matching',()=>{
  expect(matchManualText({...config,topicKeywords:['C++'],demandKeywords:['how to pay']},'C++ how to pay')).toMatchObject({matched:true})
  expect(matchManualText({...config,topicKeywords:['C++'],demandKeywords:['how to pay']},'CCCC how pay')).toMatchObject({matched:false})
 })
 it('parses commas and lines, trims and deduplicates without splitting phrases',()=>{
  expect(parseKeywordInput(' ChatGPT，Plus\nChatGPT、how to pay, GPT ')).toEqual(['ChatGPT','Plus','how to pay','GPT'])
 })
})

describe('manual template rendering',()=>{
 it('replaces repeated allowed variables without interpreting replacement text',()=>{
  expect(renderManualTemplate('{{问题}} — {{摘要}} — {{关键词}} {{问题}}',{问题:'$& <原文>',摘要:'{{关键词}}',关键词:'ChatGPT'})).toBe('$& <原文> — {{关键词}} — ChatGPT $& <原文>')
 })
 it.each(['{{用户}}','{{问题','{摘要}','{{ 问题 }}'])('rejects unknown or malformed variable %s',template=>{
  expect(()=>renderManualTemplate(template,{问题:'q',摘要:'s',关键词:'k'})).toThrow(/模板/)
 })
})

describe('config editing across refreshes',()=>{
 it('adopts fresh cloud config only when the form is clean',()=>{
  const fresh={...config,revision:3,replyTemplate:'新模板 {{摘要}}'}
  expect(configEditorDirty(configEditorFrom(config))).toBe(false)
  expect(reconcileConfigEditor(configEditorFrom(config),fresh)).toMatchObject({base:fresh,replyTemplate:'新模板 {{摘要}}'})
 })
 it('keeps local unsaved values and their original CAS revision',()=>{
  const editor={...configEditorFrom(config),replyTemplate:'我的未保存文字'}
  expect(configEditorDirty(editor)).toBe(true)
  expect(reconcileConfigEditor(editor,{...config,revision:3})).toEqual(editor)
 })
})

describe('review draft editing and source versions',()=>{
 it('preserves unsaved draft and note during state and admin refresh',()=>{
  const editor={...draftEditorFrom(source,review),draft:'未保存的文字',note:'新备注'}
  expect(draftEditorDirty(editor)).toBe(true)
  expect(reconcileDraftEditor(editor,source,{...review,draft:'另一设备文字',updatedAt:'2026-10-17T00:02:00.000Z'})).toEqual(editor)
 })
 it('adopts newer cloud review if no local edits exist',()=>{
  const next={...review,draft:'已更新的文字',updatedAt:'2026-10-17T00:02:00.000Z'}
  expect(draftEditorDirty(draftEditorFrom(source,review))).toBe(false)
  expect(reconcileDraftEditor(draftEditorFrom(source,review),source,next)).toMatchObject({draft:'已更新的文字',expectedUpdatedAt:'2026-10-17T00:02:00.000Z'})
 })
 it('detects source reanalysis via live state even before GET stale flag refreshes',()=>{
  expect(isReviewStale(review,{...source,updatedAt:'2026-10-17T00:03:00.000Z'})).toBe(true)
  expect(isReviewStale(review,undefined)).toBe(true)
  expect(isReviewStale({...review,stale:true},source)).toBe(true)
  expect(isReviewStale(review,source)).toBe(false)
 })
 it('only allows an unchanged saved pending review at its current source and CAS versions',()=>{
  const editor=draftEditorFrom(source,review)
  expect(canApproveReview(editor,review,source)).toBe(true)
  expect(canApproveReview({...editor,draft:'已编辑'},review,source)).toBe(false)
  expect(canApproveReview(editor,{...review,updatedAt:'2026-10-17T00:04:00.000Z'},source)).toBe(false)
  expect(canApproveReview(editor,review,{...source,updatedAt:'2026-10-17T00:04:00.000Z'})).toBe(false)
  expect(canApproveReview(editor,{...review,status:'approved'},source)).toBe(false)
  expect(canApproveReview(editor,undefined,source)).toBe(false)
 })
})
