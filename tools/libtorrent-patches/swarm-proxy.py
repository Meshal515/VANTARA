# وسيط تأخير: كل منفذ Q+i يمرّر إلى P+i بتأخير اتجاه واحد d_i (يحاكي زمن رحلة مشارك حقيقي)
import asyncio, sys, time
Q, P, N = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
def delay(i): return (30 + (i * 37) % 120) / 1000.0   # رحلة ذهاب وعودة 60–300ms
async def pump(r, w, d):
    q = asyncio.Queue()
    async def writer():
        while True:
            t, data = await q.get()
            if data is None: break
            dt = t - time.monotonic()
            if dt > 0: await asyncio.sleep(dt)
            w.write(data)
            try: await w.drain()
            except Exception: break
        try: w.close()
        except Exception: pass
    wt = asyncio.ensure_future(writer())
    try:
        while True:
            data = await r.read(65536)
            if not data: break
            q.put_nowait((time.monotonic() + d, data))
    except Exception: pass
    q.put_nowait((0, None)); await wt
async def serve(i):
    d = delay(i)
    async def handle(cr, cw):
        try: sr, sw = await asyncio.open_connection('127.0.0.1', P + i)
        except Exception: cw.close(); return
        await asyncio.gather(pump(cr, sw, d), pump(sr, cw, d))
    await asyncio.start_server(handle, '127.0.0.1', Q + i)
async def main():
    for i in range(N): await serve(i)
    print('READY', flush=True)
    await asyncio.Event().wait()
asyncio.run(main())
