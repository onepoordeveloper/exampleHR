export class OptimisticLockError extends Error {
  constructor(message = 'Optimistic lock version mismatch') {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof OptimisticLockError) return true;
  // SQLite-specific: concurrent BEGIN IMMEDIATE contention on a single connection
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('cannot start a transaction within a transaction') ||
      msg.includes('database is locked') ||
      msg.includes('sqlite_busy') ||
      msg.includes('sqlite_locked')
    ) {
      return true;
    }
  }
  return false;
}

export async function retryOnOptimisticLock<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  baseDelayMs = 25,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) =>
          setTimeout(r, baseDelayMs * attempt + Math.random() * 10),
        );
      }
    }
  }
  throw lastErr;
}
