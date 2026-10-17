export type HeyboxSettings={scope:'all'|'topics'|'posts';topics:string;postUrls:string;topicKeywords:string;demandKeywords:string;excludeKeywords:string;publicReply:string;tutorialMessage:string;contactMessage:string;tutorialUrl:string;contactChannel:string;contactValue:string}
export type HeyboxSample={name:string;title:string;text:string;topic:string;sourceUrl:string}
export function defaultHeyboxSettings():HeyboxSettings{return {
  scope:'all',topics:'AI 工具\n订阅问答',postUrls:'',topicKeywords:'ChatGPT\nPlus\nDeepSeek',
  demandKeywords:'怎么订阅\n支付失败\n求教程\n免费教程\n求私\n私信',excludeKeywords:'已经解决\n不需要教程\n广告',
  publicReply:'你好，关于 {{关键词}}，建议先核对官方订阅与支付说明。我整理了免费教程供你参考，不保证订阅成功。',
  tutorialMessage:'你好 {{用户}}，你向我请求的免费教程在这里：{{教程链接}}。实际费用和支持范围以服务商当时说明为准。',
  contactMessage:'你希望进一步联系，可以通过 {{联系方式}} 咨询具体问题。',tutorialUrl:'',contactChannel:'微信',contactValue:'',
}}
const variables=new Set(['用户','关键词','教程链接','联系方式'])
function containsContact(text:string,contact:string){
  if(!contact)return false
  const needle=contact.toLocaleLowerCase()
  if(text.toLocaleLowerCase().includes(needle))return true
  let invalidEncoding=false
  const decoded=text.replace(/(?:%[0-9a-f]{2})+/gi,chunk=>{try{return decodeURIComponent(chunk)}catch{invalidEncoding=true;return chunk}})
  return invalidEncoding||decoded.toLocaleLowerCase().includes(needle)
}
export function splitHeyboxTerms(value:string){return [...new Set(value.split(/[\n,，;；]/).map(v=>v.trim()).filter(Boolean))]}
function safeUrl(value:string){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();return url.href}catch{throw Error('链接须为不含账号密码的 HTTP/HTTPS 地址')}}
export function validateHeyboxSettings(value:unknown):HeyboxSettings{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('设置格式无效')
  const defaults=defaultHeyboxSettings(),record=value as Record<string,unknown>,settings={} as HeyboxSettings
  for(const key of Object.keys(defaults) as (keyof HeyboxSettings)[]){
    const text=record[key];if(typeof text!=='string'||text.length>(key==='postUrls'?8000:2000))throw Error('设置字段无效或超过长度限制')
    ;(settings as Record<string,string>)[key]=text.trim()
  }
  if(!['all','topics','posts'].includes(settings.scope))throw Error('请选择有效搜索范围')
  if(!['微信','QQ','邮箱','其他'].includes(settings.contactChannel))throw Error('请选择联系方式渠道')
  if(settings.contactValue.length>200)throw Error('联系方式最多 200 字')
  for(const key of ['topicKeywords','demandKeywords','excludeKeywords','topics'] as const){
    const terms=splitHeyboxTerms(settings[key]);if(terms.length>40||terms.some(t=>t.length>80))throw Error('每组最多 40 个词，每词最多 80 字')
    if(['topicKeywords','demandKeywords'].includes(key)&&!terms.length)throw Error('主题关键词和需求表达都至少填写一个')
  }
  if(settings.scope==='topics'&&!splitHeyboxTerms(settings.topics).length)throw Error('请填写指定话题')
  const urls=settings.postUrls.split(/\n/).map(v=>v.trim()).filter(Boolean)
  if(urls.length>20)throw Error('最多指定 20 个帖子链接')
  if(settings.scope==='posts'&&!urls.length)throw Error('请填写指定帖子链接')
  urls.forEach(safeUrl);if(settings.tutorialUrl)safeUrl(settings.tutorialUrl)
  if(containsContact(settings.tutorialUrl,settings.contactValue))throw Error('教程链接包含所填联系方式，请使用独立的联系方式模板')
  for(const key of ['publicReply','tutorialMessage','contactMessage'] as const){
    if(!settings[key])throw Error('三个回复模板都需要填写')
    const tokens=[...settings[key].matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(m=>m[1].trim())
    if(tokens.some(t=>!variables.has(t)))throw Error('模板仅支持 {{用户}}、{{关键词}}、{{教程链接}} 和 {{联系方式}}')
    if(key!=='contactMessage'&&(tokens.includes('联系方式')||containsContact(settings[key],settings.contactValue)))throw Error('联系方式请放在独立的联系方式模板中')
  }
  return settings
}
export function matchHeyboxSample(settings:HeyboxSettings,sample:HeyboxSample){
  const topicText=`${sample.title}\n${sample.text}`.toLocaleLowerCase(),demandText=sample.text.toLocaleLowerCase()
  const topicTerms=splitHeyboxTerms(settings.topicKeywords).filter(t=>topicText.includes(t.toLocaleLowerCase()))
  const demandTerms=splitHeyboxTerms(settings.demandKeywords).filter(t=>demandText.includes(t.toLocaleLowerCase()))
  let reason=''
  if(settings.scope==='topics'&&!splitHeyboxTerms(settings.topics).includes(sample.topic))reason='不在指定话题范围'
  if(settings.scope==='posts'&&!settings.postUrls.split(/\n/).filter(v=>v.trim()).some(v=>safeUrl(v.trim())===safeUrl(sample.sourceUrl)))reason='不在指定帖子范围'
  const excluded=splitHeyboxTerms(settings.excludeKeywords).find(t=>demandText.includes(t.toLocaleLowerCase()))
  if(!reason&&excluded)reason=`命中排除条件「${excluded}」`
  if(!reason&&!topicTerms.length)reason='未命中主题关键词'
  if(!reason&&!demandTerms.length)reason='未命中需求表达'
  return {matched:!reason,reason:reason||`命中主题「${topicTerms.join('、')}」及需求「${demandTerms.join('、')}」`,topicTerms,demandTerms}
}
export function renderHeyboxTemplate(text:string,values:Record<string,string>){return text.replace(/{{\s*([^{}]+?)\s*}}/g,(_match,key:string)=>values[key.trim()]??'')}
export function previewHeyboxReplies(settings:HeyboxSettings,sample:HeyboxSample&{target:'self'|'other';messageRequested:boolean;contactRequested:boolean}){
  const match=matchHeyboxSample(settings,sample),allowed=match.matched&&sample.target==='self'
  const values={用户:sample.name,关键词:match.topicTerms.join('、')||'相关问题',教程链接:settings.tutorialUrl||'（未填写教程链接）',联系方式:settings.contactValue?`${settings.contactChannel}：${settings.contactValue}`:'（未填写联系方式）'}
  const publicRaw=allowed?renderHeyboxTemplate(settings.publicReply,values):'',tutorialRaw=allowed&&sample.messageRequested?renderHeyboxTemplate(settings.tutorialMessage,values):''
  const publicBlocked=containsContact(publicRaw,settings.contactValue),tutorialBlocked=containsContact(tutorialRaw,settings.contactValue)
  return {publicReply:publicBlocked?'':publicRaw,tutorialMessage:tutorialBlocked?'':tutorialRaw,contactMessage:allowed&&sample.messageRequested&&sample.contactRequested&&settings.contactValue?renderHeyboxTemplate(settings.contactMessage,values):'',notice:publicBlocked||tutorialBlocked?'所填联系方式出现在其他模板的渲染结果中，相关草稿已阻止生成。':''}
}
type SettingsStorage={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void}
const storageKey='workbench.heybox.simulation.settings.v1'
export function loadHeyboxSettings(storage:SettingsStorage|null){
  try{const raw=storage?.getItem(storageKey);if(!raw)return {settings:defaultHeyboxSettings(),warning:''};const saved=JSON.parse(raw);if(saved.version!==1)throw Error();return {settings:validateHeyboxSettings(saved.settings),warning:''}}
  catch{return {settings:defaultHeyboxSettings(),warning:'浏览器设置不可读取或格式无效，已使用默认设置。'}}
}
export function saveHeyboxSettings(storage:SettingsStorage|null,value:HeyboxSettings){
  const settings=validateHeyboxSettings(value)
  try{if(!storage)throw Error();storage.setItem(storageKey,JSON.stringify({version:1,settings}));return {persisted:true,warning:''}}
  catch{return {persisted:false,warning:'设置已应用到本页，但浏览器不允许保存；刷新后可能丢失。'}}
}
