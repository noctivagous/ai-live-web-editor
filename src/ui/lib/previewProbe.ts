/**
 * Preview server readiness: after a project switch the launcher kills and
 * restarts :5173, so a single probe can fire inside the dead window and
 * stick on "down" forever. Poll with backoff until the server answers or
 * the budget (Vite cold boot) runs out.
 */

export type ProbeFn = () => Promise<boolean>

export async function pollUntilUp(
  probe: ProbeFn,
  opts: { budgetMs?: number, intervalMs?: number, signal?: AbortSignal } = {},
): Promise<boolean> {
  const budgetMs = opts.budgetMs ?? 90000
  const intervalMs = opts.intervalMs ?? 2000
  const t0 = Date.now()
  for (;;) {
    if (opts.signal?.aborted) return false
    let up = false
    try {
      up = await probe()
    } catch {
      up = false
    }
    if (up) return true
    if (Date.now() - t0 >= budgetMs) return false
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs)
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        }, { once: true })
      }
    }).catch(() => {})
    if (opts.signal?.aborted) return false
  }
}
