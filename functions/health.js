import { checkCrypto } from '../cloudflare/crypto-check.mjs';

export async function onRequestGet({request}) {
  const check=new URL(request.url).searchParams.get('check')==='crypto';
  return Response.json({ok:true,...(check?{crypto:await checkCrypto()}:{})},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
