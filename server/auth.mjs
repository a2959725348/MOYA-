import { randomBytes,scrypt,timingSafeEqual,createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(scrypt);
export const hashToken=value=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) { const salt=randomBytes(16).toString('hex');return {salt,hash:(await derive(password,salt,64)).toString('hex')}; }
export async function verifyPassword(password,stored) { if(!stored) return false;const actual=await derive(password,stored.salt,64);const expected=Buffer.from(stored.hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected); }
export const token=()=>randomBytes(32).toString('base64url');
export function issueSession(store,reply,secure) {
  const value=token();store.db.prepare('INSERT INTO sessions VALUES (?,?)').run(hashToken(value),Date.now()+7*86400000);
  reply.setCookie('workbench_session',value,{path:'/',httpOnly:true,sameSite:'strict',secure,maxAge:7*86400});
  return value;
}
