// A counter of recent turns per network address, kept in this server instance's memory.
// It resets when the instance does and is not shared between instances, so it only ever
// backs up the platform's rate limit. Nothing she writes is kept here, only times.
const ADDRESSES_BEFORE_TIDYING = 500;

export function createLimiter(windowMs: number, max: number, now: () => number = Date.now) {
  const calls = new Map<string, number[]>();
  // True when this address is over the cap. A turn that is let through is counted.
  return function over(address: string): boolean {
    const at = now();
    const recent = (calls.get(address) ?? []).filter((t) => at - t < windowMs);
    const isOver = recent.length >= max;
    if (!isOver) recent.push(at);
    calls.set(address, recent);
    // Forget addresses that have gone quiet.
    if (calls.size > ADDRESSES_BEFORE_TIDYING) {
      for (const [key, times] of calls) if (!times.some((t) => at - t < windowMs)) calls.delete(key);
    }
    return isOver;
  };
}
