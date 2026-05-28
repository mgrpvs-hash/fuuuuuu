import { AppError } from "../types/errors.js";

interface Bucket {
  count: number;
  windowStartMs: number;
}

export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number
  ) {}

  check(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartMs >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStartMs: now });
      return;
    }

    if (bucket.count >= this.maxRequests) {
      throw new AppError("Too many requests. Please retry in a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        details: { windowMs: this.windowMs, maxRequests: this.maxRequests }
      });
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
  }
}
