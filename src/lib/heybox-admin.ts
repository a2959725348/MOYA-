export type HeyboxConfig={revision:number;topicKeywords:string[];demandKeywords:string[];excludeKeywords:string[];replyTemplate:string}
export type HeyboxReview={id:string;demandId:string;sourceUpdatedAt:string;draft:string;status:'pending'|'approved'|'rejected';note:string;createdAt:string;updatedAt:string;stale:boolean}
export type HeyboxLog={id:string;at:string;action:string;label:string;targetId?:string}
export type HeyboxAdminData={version:1;mode:'manual';config:HeyboxConfig;reviews:HeyboxReview[];logs:HeyboxLog[];capabilities:{platformConnected:false;autoRead:false;autoReply:false;follow:false;directMessage:false}}
export type SourceVersion={id:string;updatedAt:string}
export type ConfigEditor={base:HeyboxConfig;topicText:string;demandText:string;excludeText:string;replyTemplate:string}
export type DraftEditor={demandId:string;sourceUpdatedAt:string;expectedUpdatedAt:string|null;draft:string;note:string;baseDraft:string;baseNote:string;baseSourceUpdatedAt:string}

export function parseKeywordInput(value:string){return [...new Set(value.split(/[\n\r,，、]/).map(term=>term.trim()).filter(Boolean))]}
export function matchManualText(config:HeyboxConfig,text:string){
 const lower=text.toLocaleLowerCase(),hits=(terms:string[])=>terms.filter(term=>term.trim()&&lower.includes(term.toLocaleLowerCase()))
 const topicTerms=hits(config.topicKeywords),demandTerms=hits(config.demandKeywords),excludedTerms=hits(config.excludeKeywords)
 return {matched:!excludedTerms.length&&!!topicTerms.length&&!!demandTerms.length,topicTerms,demandTerms,excludedTerms}
}
export function renderManualTemplate(template:string,values:Record<'问题'|'摘要'|'关键词',string>){
 if(/[{}]/.test(template.replace(/\{\{(?:问题|摘要|关键词)\}\}/g,'')))throw new Error('模板仅允许 {{问题}}、{{摘要}}、{{关键词}}')
 return template.replace(/\{\{(问题|摘要|关键词)\}\}/g,(_match,key:keyof typeof values)=>values[key])
}
export function configEditorFrom(config:HeyboxConfig):ConfigEditor{return {base:config,topicText:config.topicKeywords.join('\n'),demandText:config.demandKeywords.join('\n'),excludeText:config.excludeKeywords.join('\n'),replyTemplate:config.replyTemplate}}
export function configEditorDirty(editor:ConfigEditor){return editor.topicText!==editor.base.topicKeywords.join('\n')||editor.demandText!==editor.base.demandKeywords.join('\n')||editor.excludeText!==editor.base.excludeKeywords.join('\n')||editor.replyTemplate!==editor.base.replyTemplate}
export function reconcileConfigEditor(editor:ConfigEditor|null,config:HeyboxConfig){return editor&&configEditorDirty(editor)?editor:configEditorFrom(config)}
export function draftEditorFrom(source:SourceVersion,review?:HeyboxReview):DraftEditor{
 const sourceUpdatedAt=review?.sourceUpdatedAt??source.updatedAt
 return {demandId:source.id,sourceUpdatedAt,baseSourceUpdatedAt:sourceUpdatedAt,expectedUpdatedAt:review?.updatedAt??null,draft:review?.draft??'',note:review?.note??'',baseDraft:review?.draft??'',baseNote:review?.note??''}
}
export function draftEditorDirty(editor:DraftEditor){return editor.draft!==editor.baseDraft||editor.note!==editor.baseNote||editor.sourceUpdatedAt!==editor.baseSourceUpdatedAt}
export function reconcileDraftEditor(editor:DraftEditor,source:SourceVersion|undefined,review?:HeyboxReview){return draftEditorDirty(editor)?editor:draftEditorFrom(source??{id:editor.demandId,updatedAt:editor.sourceUpdatedAt},review)}
export function isReviewStale(review:HeyboxReview,source:SourceVersion|undefined){return review.stale||!source||source.updatedAt!==review.sourceUpdatedAt}
export function canApproveReview(editor:DraftEditor,review:HeyboxReview|undefined,source:SourceVersion|undefined){return !!review&&review.status==='pending'&&!isReviewStale(review,source)&&editor.demandId===review.demandId&&editor.expectedUpdatedAt===review.updatedAt&&editor.sourceUpdatedAt===review.sourceUpdatedAt&&editor.draft===review.draft&&editor.note===review.note}
