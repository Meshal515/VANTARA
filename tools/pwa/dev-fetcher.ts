/**
 * جالب ويب محلي للتجربة (لا إنتاج): نفس كود الـWorker (services/web-fetcher)
 * يعمل على Node، وطلباته الخارجية عبر curl (يحترم وكيل الشبكة في بيئة التطوير).
 *
 *   VANTARA_IDENTITY_SECRET=… ALLOWED_ORIGINS=http://127.0.0.1:8765 npx tsx tools/pwa/dev-fetcher.ts
 */
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createHandler } from '../../services/web-fetcher/src/index.ts';

function curlFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const args = ['-s', '-m', '30', '-D', '-', '-o', '-', '-X', init?.method ?? 'GET'];
  new Headers(init?.headers).forEach((v, k) => args.push('-H', `${k}: ${v}`));
  if (typeof init?.body === 'string') args.push('--data-binary', init.body);
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile('curl', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout?.length) return reject(error);
      let buf = stdout as Buffer;
      let head = '';
      // آخر كتلة ترويسات (100 Continue وغيرها قبلها)
      while (buf.subarray(0, 5).toString() === 'HTTP/') {
        const end = buf.indexOf('\r\n\r\n');
        head = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 4);
      }
      const [statusLine, ...lines] = head.split('\r\n');
      const status = Number(statusLine?.split(' ')[1] ?? 502);
      const headers = new Headers();
      for (const line of lines) {
        const i = line.indexOf(':');
        if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
      resolve(new Response(status === 204 || status === 304 || (status >= 300 && status < 400 && !buf.length) ? null : buf, { status, headers }));
    });
  });
}

const handle = createHandler(curlFetch as typeof fetch);
const env = { VANTARA_IDENTITY_SECRET: process.env.VANTARA_IDENTITY_SECRET ?? '', ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '' };
const port = Number(process.env.PORT ?? 8790);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '') ? null : Buffer.concat(chunks) });
  const out = await handle(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`dev fetcher on :${port}`));
