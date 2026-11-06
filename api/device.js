import { serverContext } from '../src/server-context.mjs';
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const context = await serverContext(request);
    if (context.error) return response.status(context.status).json({ error: context.error });
    // The published contract has no device registration/approval endpoint.
    // Never trust a browser-supplied deviceRegistered/role/header or pretend approval.
    if (request.method === 'POST') return response.status(503).json({ error: 'ENGINE_NOT_CONNECTED', requested: false });
    return response.status(200).json({ status: 'not_connected', registered: null,
      canRequestApproval: false, checkedAt: new Date().toISOString() });
  } catch { return response.status(502).json({ error: 'DEVICE_STATUS_UNAVAILABLE' }); }
}
