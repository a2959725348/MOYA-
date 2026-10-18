import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createEmptyCard,fsrs } from 'ts-fsrs';
import { englishWords,englishArticle,englishSentences } from '../shared/english-data.mjs';

const key='englishStudy';
const scheduler=fsrs({enable_fuzz:false});
const words=new Map(englishWords.map(word=>[word.id,word]));
const sentences=new Map(englishSentences.map(sentence=>[sentence.id,sentence]));
const wordId=z.enum(englishWords.map(word=>word.id));
const common={eventId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1)};
const actionSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('collect'),wordId,context:z.string().min(1).max(600).optional()}).strict(),
  z.object({...common,kind:z.literal('spell'),wordId,answer:z.string().max(500)}).strict(),
  z.object({...common,kind:z.literal('reading'),articleId:z.literal(englishArticle.id)}).strict(),
  z.object({...common,kind:z.literal('dictation'),sentenceId:z.enum(englishSentences.map(sentence=>sentence.id)),answer:z.string().max(1000)}).strict(),
  z.object({...common,kind:z.literal('review'),wordId,rating:z.number().int().min(1).max(4)}).strict(),
]);
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const empty=()=>({version:1,revision:0,cards:[],days:{},history:[],receipts:[]});
const load=store=>store.get(key)??empty();
const iso=date=>new Date(date).toISOString();
const tokens=text=>text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z0-9]+)*/g)??[];
const materials=[...englishWords.map(word=>word.ex),...englishArticle.paragraphs,...englishArticle.paragraphs.flatMap(paragraph=>paragraph.match(/[^.!?]+[.!?]/g)?.map(sentence=>sentence.trim())??[]),...englishSentences.map(sentence=>sentence.text)];

// Levenshtein alignment keeps later words aligned when a word is omitted or added.
function dictationResult(sentenceId,answer){
  const expected=tokens(sentences.get(sentenceId).text),actual=tokens(answer);
  const matrix=Array.from({length:expected.length+1},()=>Array(actual.length+1).fill(0));
  for(let i=0;i<=expected.length;i++)matrix[i][0]=i;
  for(let j=0;j<=actual.length;j++)matrix[0][j]=j;
  for(let i=1;i<=expected.length;i++)for(let j=1;j<=actual.length;j++)matrix[i][j]=Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+Number(expected[i-1]!==actual[j-1]));
  const parts=[];let i=expected.length,j=actual.length;
  while(i||j){
    if(i&&j&&matrix[i][j]===matrix[i-1][j-1]+Number(expected[i-1]!==actual[j-1])){parts.push({type:expected[i-1]===actual[j-1]?'ok':'wrong',expected:expected[--i],actual:actual[--j]});}
    else if(i&&matrix[i][j]===matrix[i-1][j]+1)parts.push({type:'missing',expected:expected[--i]});
    else parts.push({type:'extra',actual:actual[--j]});
  }
  return {correct:matrix[expected.length][actual.length]===0,accuracy:Math.round(100*Math.max(0,1-matrix[expected.length][actual.length]/Math.max(expected.length,actual.length))),parts:parts.reverse()};
}
function view(state,now){
  return {version:1,revision:state.revision,serverNow:now.toISOString(),cards:state.cards.map(card=>{
    const preview=scheduler.repeat(card.fsrs,now);
    return {wordId:card.wordId,context:card.context,due:iso(card.fsrs.due),reps:card.fsrs.reps,state:card.fsrs.state,intervals:Object.fromEntries([1,2,3,4].map(rating=>[rating,iso(preview[rating].card.due)]))};
  }),days:structuredClone(state.days),history:structuredClone(state.history)};
}
export function englishSnapshot(store){return view(load(store),new Date());}

export function englishExport(store){
  // This intentionally exports only this feature's state, never account settings or secrets.
  return {version:1,kind:'english-study',exportedAt:new Date().toISOString(),state:structuredClone(load(store))};
}

export function englishAction(store,input){
  const action=actionSchema.parse(input),state=load(store),now=new Date();
  const digest=createHash('sha256').update(JSON.stringify(action)).digest('hex');
  const receipt=state.receipts.find(receipt=>receipt.eventId===action.eventId);
  // Resolve receipts before checking revision: a response may be lost after a successful commit.
  if(receipt){
    if(receipt.digest!==digest)throw fail('该操作编号已经用于其他内容，请重新操作',409);
    return {snapshot:view(state,now),result:action.kind==='dictation'?dictationResult(action.sentenceId,action.answer):receipt.result};
  }
  if(state.revision!==action.expectedRevision)throw fail('学习记录已在其他页面更新，请刷新后重试',409);
  if(action.kind==='collect'&&action.context!==undefined&&(!materials.includes(action.context)||!tokens(action.context).includes(action.wordId)))throw fail('请选择当前材料中的单词语境');
  const ensureCard=(wordId,context)=>{
    let card=state.cards.find(card=>card.wordId===wordId);
    if(!card){card={wordId,context:context??words.get(wordId).ex,fsrs:createEmptyCard(now)};state.cards.push(card);}
    return card;
  };
  const complete=(category,id)=>{
    const day=iso(now.getTime()+8*60*60*1000).slice(0,10);
    state.days[day]??={words:[],articles:[],sentences:[]};
    if(!state.days[day][category].includes(id))state.days[day][category].push(id);
  };
  let result={};
  if(action.kind==='collect')ensureCard(action.wordId,action.context);
  if(action.kind==='spell'){
    result={correct:action.answer.trim().toLowerCase()===words.get(action.wordId).w};
    if(result.correct){ensureCard(action.wordId);complete('words',action.wordId);}
  }
  if(action.kind==='reading')complete('articles',action.articleId);
  if(action.kind==='dictation'){
    result=dictationResult(action.sentenceId,action.answer);
    if(result.correct)complete('sentences',action.sentenceId);
  }
  if(action.kind==='review'){
    const card=state.cards.find(card=>card.wordId===action.wordId);
    if(!card)throw fail('请先收藏单词再复习',409);
    if(Date.parse(card.fsrs.due)>now.getTime())throw fail('该单词尚未到复习时间',409);
    card.fsrs=scheduler.next(card.fsrs,now,action.rating).card;
    result={nextDue:iso(card.fsrs.due)};
    state.history.push({eventId:action.eventId,wordId:action.wordId,rating:action.rating,at:now.toISOString(),due:result.nextDue});
    complete('words',action.wordId);
  }
  state.revision++;
  state.history=state.history.slice(-200);
  state.days=Object.fromEntries(Object.entries(state.days).sort(([a],[b])=>a.localeCompare(b)).slice(-366));
  // Do not retain typed dictation answers/diffs; the canonical input reproduces a retry result.
  const {parts,...storedResult}=result;
  state.receipts.push({eventId:action.eventId,digest,result:storedResult});state.receipts=state.receipts.slice(-500);
  store.set(key,state);
  return {snapshot:view(state,now),result};
}
