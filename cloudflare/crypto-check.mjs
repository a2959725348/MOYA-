import { Buffer } from 'node:buffer';
import { Vault } from './vault.mjs';

// This opt-in check uses a fixed, public test vector and an ephemeral Map only.
// It never receives environment secrets, production records or user content.
export async function checkCrypto() {
  const raw = new Uint8Array(32).fill(3), sample = 'MOYA synthetic crypto check';
  const values = new Map(), result = { encrypt: 'skipped', decrypt: 'skipped', webCrypto: 'skipped' };
  const vault = new Vault({ get: name => values.get(name) ?? null, set: (name, value) => values.set(name, value) }, Buffer.from(raw).toString('base64'));
  const category = error => /not implemented|not supported/i.test(String(error?.message)) ? 'not_implemented' : 'failed';
  try { vault.set('ai.apiKey', sample); result.encrypt = 'ok'; } catch (error) { result.encrypt = category(error); }
  if (result.encrypt === 'ok') {
    try { result.decrypt = vault.get('ai.apiKey') === sample ? 'ok' : 'failed'; } catch (error) { result.decrypt = category(error); }
  }
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(sample));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encrypted);
    result.webCrypto = new TextDecoder().decode(decrypted) === sample ? 'ok' : 'failed';
  } catch (error) { result.webCrypto = category(error); }
  return result;
}
