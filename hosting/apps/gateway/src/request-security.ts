import type { RequestHandler } from 'express';

/** Bounded, per-process limiter. The proxy also limits IP requests. */
export class WindowLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(private limit: number, private windowMs: number, private capacity = 10000) {}
  allow(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (entry && entry.until > now) return ++entry.count <= this.limit;
    if (!entry && this.entries.size >= this.capacity) {
      for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
      if (this.entries.size >= this.capacity) return false;
    }
    this.entries.set(key, { count: 1, until: now + this.windowMs });
    return true;
  }
}

const ips = new WindowLimiter(120, 60000);
export const users = new WindowLimiter(180, 60000);
export const requestSecurity: RequestHandler = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.origin;
  const allowed = [process.env.APP_URL, process.env.MCP_PUBLIC_URL].filter(Boolean).map(v => new URL(v!).origin);
  if (origin && !allowed.includes(origin)) { res.status(403).json({ error: 'origin_not_allowed' }); return; }
  if (!ips.allow(req.ip ?? req.socket.remoteAddress ?? 'unknown')) {
    res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'rate_limit' }); return;
  }
  next();
};
