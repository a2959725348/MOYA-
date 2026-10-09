import { z } from 'zod';
import { demandInputSchema,consultationSchema } from './demands.mjs';
const text=z.string().trim().max(1000), required=z.string().trim().min(1).max(500), long=z.string().max(30000);
const number=z.number().finite().nonnegative(), nullableNumber=number.nullable().default(null);
export const iso=z.string().max(50).refine(v=>/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v)),'Invalid ISO timestamp');
const nullableDate=iso.nullable().default(null);
const day=z.string().regex(/^\d{4}-\d\d-\d\d$/).refine(v=>{const stamp=Date.parse(`${v}T00:00:00Z`);return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===v;},'Invalid date');
const url=z.string().max(2000).refine(v=>!v||/^https?:\/\//.test(v),'URL must be http(s)').default('');
export const collections={
  demands:demandInputSchema,
  consultations:consultationSchema,
  accounts:z.object({name:required,provider:text.default(''),type:z.enum(['subscription','api']).default('api'),currency:z.enum(['CNY','USD','percent']).default('CNY'),balance:nullableNumber,total:nullableNumber,resetsAt:nullableDate,note:text.default(''),source:z.enum(['manual','api']).default('manual'),threshold:nullableNumber}).strict(),
  watchlist:z.object({symbol:z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.:-]+$/),name:text.default(''),market:z.enum(['US','CN']),targetAbove:nullableNumber,targetBelow:nullableNumber}).strict(),
  tasks:z.object({title:required,course:text.default(''),type:z.enum(['assignment','exam','other']).default('other'),dueAt:nullableDate,status:z.enum(['pending','completed']).default('pending'),url,note:text.default(''),source:z.enum(['manual','chaoxing']).default('manual'),platformId:z.string().min(1).max(200).optional()}).strict(),
  goals:z.object({exam:z.enum(['postgraduate','cet4','cet6']),title:required,targetDate:nullableDate,subjects:z.array(required).max(30).default([]),dailyMinutes:number.max(1440).default(60)}).strict(),
  studyPlans:z.object({title:required,subject:required,date:day,status:z.enum(['pending','completed']).default('pending'),minutes:number.max(1440),content:long.optional()}).strict(),
  studySessions:z.object({subject:required,minutes:number.max(1440),date:day}).strict(),
  mistakes:z.object({subject:required,question:long.min(1),answer:long.default(''),notes:long.default(''),nextReview:nullableDate}).strict(),
  chatMessages:z.object({role:z.enum(['user','assistant']),content:long.min(1),model:text.optional(),tokens:number.int().optional(),cost:number.optional(),currency:z.enum(['CNY','USD']).optional()}).strict(),
  alerts:z.object({title:required,message:long,kind:z.enum(['task','market','quota','balance']),read:z.boolean().default(false),eventKey:z.string().max(500).optional()}).strict()
};
export const recordMeta=z.object({id:z.string().min(1).max(100),createdAt:iso,updatedAt:iso});
export const windowSchema=z.object({usedPercent:z.number().finite().min(0).max(100).nullable().optional(),windowDurationMins:number.nullable().optional(),resetsAt:number.nullable().optional()}).strict();
export const quotaSchema=z.object({limitId:text.nullable().optional(),limitName:text.nullable().optional(),primary:windowSchema.nullable().optional(),secondary:windowSchema.nullable().optional(),planType:text.nullable().optional(),credits:z.object({hasCredits:z.boolean().nullable().optional(),unlimited:z.boolean().nullable().optional(),balance:z.union([number,z.string().max(100).regex(/^\d+(\.\d+)?$/)]).nullable().optional()}).strict().nullable().optional(),rateLimitReachedType:text.nullable().optional()}).strict();
export const codexSchema=z.object({eventId:z.string().min(1).max(200),observedAt:iso,rateLimits:quotaSchema.nullable().optional(),rateLimitsByLimitId:z.record(z.string().max(100),quotaSchema).nullable().optional(),dailyUsageBuckets:z.array(z.object({startDate:day,tokens:number.int()}).strict()).max(400).nullable().optional(),error:z.string().max(200).regex(/^[A-Z0-9_]+$/).optional()}).strict();
export const tasksSyncSchema=z.object({eventId:z.string().min(1).max(200),observedAt:iso,tasks:z.array(collections.tasks.omit({note:true,source:true}).required({platformId:true})).max(1000)}).strict();
export const settingsDefaults={profile:{name:'',timezone:'Asia/Shanghai'},ai:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-chat',dailyRequestLimit:30,dailyBudget:null,maxTokens:2048,inputPrice:0,outputPrice:0,currency:'CNY'},deepseek:{},openai:{},market:{usProvider:'alpaca',alpacaFeed:'iex',refreshSeconds:60},notifications:{quotaBelow:20,balanceBelow:10,taskHours:24},agent:{}};
const secret=z.string().max(2000);
export const settingsSchema=z.object({
  profile:z.object({name:text.optional(),timezone:z.literal('Asia/Shanghai').optional()}).strict().optional(),
  ai:z.object({provider:z.enum(['deepseek','openai','custom']).optional(),baseUrl:z.string().max(1000).optional(),model:required.optional(),apiKey:secret.optional(),dailyRequestLimit:z.number().int().min(1).max(1000).optional(),dailyBudget:z.number().finite().positive().nullable().optional(),maxTokens:z.number().int().min(1).max(16384).optional(),inputPrice:number.max(10000).optional(),outputPrice:number.max(10000).optional(),currency:z.enum(['CNY','USD']).optional()}).strict().optional(),
  deepseek:z.object({apiKey:secret.optional()}).strict().optional(),openai:z.object({apiKey:secret.optional()}).strict().optional(),
  market:z.object({usProvider:z.literal('alpaca').optional(),alpacaFeed:z.enum(['iex','sip','delayed_sip']).optional(),alpacaKey:secret.optional(),alpacaSecret:secret.optional(),tushareToken:secret.optional(),refreshSeconds:z.number().int().min(30).max(86400).optional()}).strict().optional(),
  notifications:z.object({quotaBelow:number.max(100).optional(),balanceBelow:number.optional(),taskHours:number.max(720).optional()}).strict().optional(),
  clearSecrets:z.array(z.enum(['ai.apiKey','deepseek.apiKey','openai.apiKey','market.alpacaKey','market.alpacaSecret','market.tushareToken'])).max(6).optional()
}).strict();
