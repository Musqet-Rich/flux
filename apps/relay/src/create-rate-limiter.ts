// Fixed-window counter per key (protocol.md § 2: connections per IP per minute). Counters live
// in memory only and are pruned as windows expire, so the relay never accumulates addresses
// (engineering.md § Security).

export interface RateLimiter {
  allow: (key: string) => boolean;
  size: () => number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

interface Window {
  start: number;
  count: number;
}

export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  const prune = (at: number): void => {
    for (const [key, w] of windows) {
      if (at - w.start >= options.windowMs) windows.delete(key);
    }
  };

  const allow = (key: string): boolean => {
    const at = now();
    prune(at);
    const w = windows.get(key);
    if (w === undefined) {
      windows.set(key, { start: at, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= options.limit;
  };

  return { allow, size: () => windows.size };
};
