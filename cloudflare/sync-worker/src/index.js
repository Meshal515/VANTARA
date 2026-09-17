const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      let database = 'unknown';
      try {
        await env.DB.prepare('SELECT 1 AS ok').first();
        database = 'ok';
      } catch {
        database = 'error';
      }

      return json({
        service: 'vantara-sync',
        status: database === 'ok' ? 'ok' : 'degraded',
        database,
      }, database === 'ok' ? 200 : 503);
    }

    if (url.pathname.startsWith('/v1/')) {
      return json({
        error: 'not_implemented',
        message: 'VANTARA Sync API foundation is online; endpoint implementation is pending.',
      }, 501);
    }

    return json({
      service: 'vantara-sync',
      message: 'VANTARA Cloudflare sync worker',
    });
  },
};
