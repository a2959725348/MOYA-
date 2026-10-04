export function onRequestGet() {
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
