import { handleRequest } from '../../cloudflare/app.mjs';

export function onRequest(context) {
  return handleRequest(context.request,context.env,context);
}
