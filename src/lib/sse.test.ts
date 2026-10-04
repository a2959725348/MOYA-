import {it,expect} from 'vitest'
import {SSEParser} from './sse'
it('retains frame boundaries when split between network chunks',()=>{const p=new SSEParser();expect(p.push('data: {"type":"delta","text":"你好')).toEqual([]);expect(p.push('"}\n\ndata: {"type":"done"}\n\n')).toEqual([{type:'delta',text:'你好'},{type:'done'}])})
it('accepts CRLF and ignores comment heartbeats',()=>{const p=new SSEParser();expect(p.push(': ping\r\n\r\ndata: {"type":"delta","text":"x"}\r')).toEqual([]);expect(p.push('\n\r\n')).toEqual([{type:'delta',text:'x'}])})
it('surfaces malformed frames rather than silently claiming a complete response',()=>{const p=new SSEParser();expect(()=>p.push('data: nope\n\n')).toThrow('无法读取 AI 回复')})
