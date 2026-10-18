export type EnglishWord={id:string;w:string;p:string;cn:string;ex:string;zh:string;audio:string};
export type EnglishArticle={id:string;title:string;paragraphs:string[];translations:string[]};
export type EnglishSentence={id:string;text:string;zh:string;target:string;topic:string;hint:string;audio:string};
export const englishWords:EnglishWord[];
export const englishArticle:EnglishArticle;
export const englishSentences:EnglishSentence[];
