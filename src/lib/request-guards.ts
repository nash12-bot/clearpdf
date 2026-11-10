type RateLimitBucket = { startedAt: number; count: number };
type RateLimitRegistry = typeof globalThis & { __clearpdfRateLimits?: Map<string, RateLimitBucket> };

const registry = globalThis as RateLimitRegistry;
const rateLimits = registry.__clearpdfRateLimits ??= new Map<string, RateLimitBucket>();

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  let bucket = rateLimits.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    rateLimits.set(key, bucket);
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const requestUrl = new URL(request.url);
      const host = firstForwardedValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host") ?? requestUrl.host;
      const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.slice(0, -1);
      return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
    } catch {
      return false;
    }
  }

  return request.headers.get("sec-fetch-site") === "same-origin";
}
