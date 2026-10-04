export type SSEEvent={type:'delta'|'done'|'error';text?:string;error?:string;usage?:Record<string,unknown>}
export class SSEParser{
 private buffer=''
 push(chunk:string):SSEEvent[]{
  this.buffer=(this.buffer+chunk).replace(/\r\n/g,'\n');const result:SSEEvent[]=[];let boundary:number
  while((boundary=this.buffer.indexOf('\n\n'))>=0){const block=this.buffer.slice(0,boundary);this.buffer=this.buffer.slice(boundary+2);const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;try{const event=JSON.parse(data);if(!['delta','done','error'].includes(event.type))throw new Error();result.push(event)}catch{throw new Error('无法读取 AI 回复，请重试')}}
  if(this.buffer.length>2_000_000)throw new Error('AI 回复过大，请缩短问题')
  return result
 }
}
