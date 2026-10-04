/** نتائج تدريجية وحد فعلي للتوازي لكل origin، لا awaitAll قبل أول نتيجة. */
export async function runProgressive(
  jobs,
  { signal, onResult = () => {}, onError = () => {}, stagger = 250 } = {},
) {
  const queue = [...jobs],
    origins = new Map();
  let active = 0,
    limit = 3;
  const timers = [];
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      signal?.removeEventListener("abort", pump);
      resolve();
    };
    function pump() {
      if (finished) return;
      if (signal?.aborted) {
        done();
        return;
      }
      while (active < limit) {
        const i = queue.findIndex((j) => (origins.get(j.origin) ?? 0) < 3);
        if (i < 0) break;
        const job = queue.splice(i, 1)[0];
        active++;
        origins.set(job.origin, (origins.get(job.origin) ?? 0) + 1);
        Promise.resolve()
          .then(() => job.run(signal))
          .then(
            (result) => {
              if (!signal?.aborted) onResult(result, job);
            },
            (error) => {
              if (!signal?.aborted) onError(error, job);
            },
          )
          .catch(() => {
            /* مستمع UI معطوب لا يوقف باقي المزوّدين */
          })
          .finally(() => {
            active--;
            origins.set(job.origin, origins.get(job.origin) - 1);
            pump();
          });
      }
      if (!queue.length && !active) done();
    }
    signal?.addEventListener("abort", pump, { once: true });
    for (const [delay, n] of [
      [stagger, 4],
      [stagger * 2.8, 5],
      [stagger * 6, 6],
    ])
      timers.push(
        setTimeout(() => {
          limit = n;
          pump();
        }, delay),
      );
    pump();
  });
}
