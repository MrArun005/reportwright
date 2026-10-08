// @ts-check
/**
 * An export bounded by opt.timeoutMs: past it the promise rejects with status 504. The work itself is not stopped
 * (a server render runs in a worker that the pool terminates); the caller is not left waiting.
 * @template T @param {Promise<T>} work @param {number|undefined} ms @returns {Promise<T>}
 */
export function withDeadline(work, ms) {
  if (!(Number(ms) > 0)) return work;
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`The export took longer than ${ms} ms`), { status: 504 })), Number(ms)); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
