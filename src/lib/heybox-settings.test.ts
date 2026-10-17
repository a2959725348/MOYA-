import {describe, expect, it} from 'vitest'
import {defaultHeyboxSettings, validateHeyboxSettings, matchHeyboxSample, renderHeyboxTemplate, previewHeyboxReplies, loadHeyboxSettings, saveHeyboxSettings} from './heybox-settings'

const sample = {name:'测试用户',title:'ChatGPT 订阅求助',text:'支付失败，求教程',topic:'AI 工具',sourceUrl:'https://example.invalid/heybox/post/1001'}

describe('heybox task rules and reply templates', () => {
  it('requires both a topic keyword and a demand expression and explains exclusions', () => {
    const config = defaultHeyboxSettings()
    expect(matchHeyboxSample(config,sample).matched).toBe(true)
    expect(matchHeyboxSample(config,{...sample,title:'游戏求助',text:'求教程'}).matched).toBe(false)
    expect(matchHeyboxSample(config,{...sample,text:'已经解决，不需要教程'})).toMatchObject({matched:false})
    expect(matchHeyboxSample(config,{...sample,text:'看看大家的讨论'}).matched).toBe(false)
  })
  it('honors exact topic and post scope without fetching URLs', () => {
    const config = defaultHeyboxSettings()
    expect(matchHeyboxSample({...config,scope:'topics',topics:'订阅问答'},sample).matched).toBe(false)
    expect(matchHeyboxSample({...config,scope:'topics',topics:'AI 工具'},sample).matched).toBe(true)
    expect(matchHeyboxSample({...config,scope:'posts',postUrls:'https://example.invalid/heybox/post/2000'},sample).matched).toBe(false)
    expect(matchHeyboxSample({...config,scope:'posts',postUrls:sample.sourceUrl},sample).matched).toBe(true)
  })
  it('matches case-insensitively, splits Chinese commas and preserves multiword phrases', () => {
    const config = {...defaultHeyboxSettings(),topicKeywords:'chatgpt，DeepSeek',demandKeywords:'支付失败\n求教程'}
    expect(matchHeyboxSample(config,sample).topicTerms).toContain('chatgpt')
    expect(matchHeyboxSample({...config,topicKeywords:'ChatGPT Plus'},sample).matched).toBe(false)
    expect(matchHeyboxSample({...config,excludeKeywords:'支付失败'},sample).reason).toContain('支付失败')
  })
  it('validates required groups, scope URLs, lengths and placeholder names', () => {
    const config=defaultHeyboxSettings()
    for(const input of [{...config,topicKeywords:''},{...config,demandKeywords:''},{...config,scope:'posts',postUrls:'javascript:alert(1)'},{...config,tutorialUrl:'https://user:secret@example.invalid/'},{...config,publicReply:'{{未知变量}}'},{...config,publicReply:'x'.repeat(2001)}])expect(()=>validateHeyboxSettings(input)).toThrow()
    expect(()=>validateHeyboxSettings({...config,publicReply:'添加 {{联系方式}}'})).toThrow(/联系方式/)
    expect(validateHeyboxSettings(config)).toEqual(config)
  })
  it('substitutes plain text safely without interpreting replacement values', () => {
    expect(renderHeyboxTemplate('你好 {{用户}}，关于 {{关键词}}：{{教程链接}}',{用户:'$& <测试>',关键词:'ChatGPT',教程链接:'https://example.invalid/a',联系方式:''})).toBe('你好 $& <测试>，关于 ChatGPT：https://example.invalid/a')
  })
  it('prevents tutorial links and rendered variables from leaking the configured contact into other templates',()=>{
    const config={...defaultHeyboxSettings(),contactValue:'TEST_CONTACT_ONLY',publicReply:'教程 {{教程链接}}',tutorialUrl:'https://example.invalid/tutorial?contact=TEST_CONTACT_ONLY'}
    expect(()=>validateHeyboxSettings(config)).toThrow(/联系方式/)
    expect(()=>validateHeyboxSettings({...config,tutorialUrl:'https://example.invalid/?contact=%54EST_CONTACT_ONLY'})).toThrow(/联系方式/)
    expect(()=>validateHeyboxSettings({...config,tutorialUrl:'https://example.invalid/?contact=%54EST_CONTACT_ONLY&other=%'})).toThrow(/联系方式/)
    const replies=previewHeyboxReplies({...defaultHeyboxSettings(),publicReply:'你好 {{用户}}',contactValue:'TEST_CONTACT_ONLY'}, {...sample,name:'TEST_CONTACT_ONLY',target:'self',messageRequested:true,contactRequested:false})
    expect(replies.publicReply).toBe('')
    expect(replies.tutorialMessage).not.toContain('TEST_CONTACT_ONLY')
    expect(replies.contactMessage).toBe('')
  })
  it('saves locally and restores validated settings, with safe fallbacks for unavailable storage', () => {
    let data:string|null=null
    const storage={getItem:()=>data,setItem:(_key:string,value:string)=>{data=value}}
    const config={...defaultHeyboxSettings(),contactValue:'测试联系方式',publicReply:'关于 {{关键词}} 的测试回答'}
    expect(saveHeyboxSettings(storage,config).persisted).toBe(true)
    expect(loadHeyboxSettings(storage).settings).toEqual(config)
    data='{bad'
    expect(loadHeyboxSettings(storage).warning).toBeTruthy()
    expect(loadHeyboxSettings(storage).settings).toEqual(defaultHeyboxSettings())
    expect(saveHeyboxSettings(null,config).persisted).toBe(false)
    expect(loadHeyboxSettings({getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}}).warning).toBeTruthy()
  })
})
