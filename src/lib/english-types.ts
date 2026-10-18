export type WordDiff={type:'ok'|'wrong'|'missing'|'extra';expected?:string;actual?:string};
export type EnglishCard={wordId:string;context:string;due:string;reps:number;state:number;intervals:Record<'1'|'2'|'3'|'4',string>};
export type EnglishDay={words:string[];articles:string[];sentences:string[]};
export type EnglishReviewLog={eventId:string;wordId:string;rating:1|2|3|4;at:string;due:string};
export type EnglishSnapshot={version:1;revision:number;serverNow:string;cards:EnglishCard[];days:Record<string,EnglishDay>;history:EnglishReviewLog[]};
export type EnglishAction=({kind:'collect';wordId:string;context?:string}|{kind:'spell';wordId:string;answer:string}|{kind:'reading';articleId:string}|{kind:'dictation';sentenceId:string;answer:string}|{kind:'review';wordId:string;rating:1|2|3|4});
export type EnglishActionResponse={snapshot:EnglishSnapshot;result:{correct?:boolean;accuracy?:number;parts?:WordDiff[];nextDue?:string}};
