---
title: "Time-Off Microservice — How It Was Implemented"
author: "ExampleHR Engineering"
date: "2026-05-12"
geometry: margin=2.5cm
fontsize: 11pt
mainfont: DejaVu Serif
colorlinks: true
linkcolor: blue
---

# Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | NestJS (Node.js + TypeScript strict) |
| Database | SQLite via TypeORM + `better-sqlite3`, WAL mode |
| HTTP client | `@nestjs/axios` + `axios-retry` |
| Validation | `class-validator` + `class-transformer` |
| Rate limiting | `@nestjs/throttler` |
| API documentation | `@nestjs/swagger` (OpenAPI 3.0, Swagger UI) |
| Tests | Jest + Supertest + nock |
| Mock HCM | Standalone NestJS app (port 3001) |

---

# Project Structure

```
src/
|-- config/               # Typed env vars with fail-fast validation
|-- common/
|   |-- concurrency/      # retryOnOptimisticLock + OptimisticLockError
|   |-- filters/          # Global HTTP exception > { data, error } envelope
|   |-- guards/           # JwtAuthGuard (stub) + HcmApiKeyGuard (timingSafeEqual)
|   \-- interceptors/     # ResponseInterceptor + LoggingInterceptor (X-Request-Id)
|-- database/
|   |-- transaction.helper.ts    # withImmediateTransaction (BEGIN IMMEDIATE)
|   \-- migrations/              # Single SQL migration, all 5 tables + indexes
\-- modules/
    |-- balance/          # Balance reads, HCM refresh, all repository mutations
    |-- time-off/         # State machine, balance algorithm, idempotency
    \-- hcm-sync/         # Batch/single sync reconciliation, HCM client

mock-hcm/                 # Standalone HCM mock (in-memory Map)
test/
|-- unit/                 # Fully mocked service tests
|-- integration/          # Supertest + nock, in-memory SQLite
\-- e2e/                  # Live mock HCM, real HTTP
```

Swagger UI is served at **`/api/docs`** (OpenAPI JSON at `/api/docs-json`). All endpoints, request bodies, and response shapes are annotated with `@ApiOperation`, `@ApiProperty`, and `@ApiResponse` decorators. Both auth schemes (Bearer token and `X-HCM-API-Key`) are configured so the Swagger UI's "Authorize" dialog is all that's needed to try any endpoint interactively.

---

# The Two Critical Helpers

Everything else in the implementation depends on these two utilities.

## `withImmediateTransaction`

```typescript
export async function withImmediateTransaction<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  await qr.query('BEGIN IMMEDIATE');
  // Patch TypeORM state so nested save() uses SAVEPOINT, not BEGIN
  (qr as any).isTransactionActive = true;
  (qr as any).transactionDepth = 1;
  try {
    const result = await fn(qr.manager);
    await qr.query('COMMIT');
    return result;
  } catch (err) {
    await qr.query('ROLLBACK');
    throw err;
  } finally {
    await qr.release();
  }
}
```

Why the TypeORM patch? When TypeORM's `EntityPersistExecutor` is called inside a `QueryRunner` that has `isTransactionActive = false`, it issues `BEGIN TRANSACTION` — which SQLite rejects because we're already inside `BEGIN IMMEDIATE`. Setting those flags makes TypeORM use `SAVEPOINT` instead.

## `retryOnOptimisticLock`

```typescript
export async function retryOnOptimisticLock<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (!(err instanceof OptimisticLockError)) throw err;
      await sleep(baseDelay * attempt + jitter);
    }
  }
  throw lastErr;
}
```

The retry loop wraps the *entire* transaction body — including re-reading the balance row — so each retry always sees fresh data.

---

# The Balance Repository

All six mutation methods follow the same pattern: a raw query-builder UPDATE with an explicit version check, throwing `OptimisticLockError` if zero rows were affected.

```typescript
// Example: reserving days when a request is created
async applyHcmRefreshAndIncrementPending(
  manager: EntityManager,
  balance: LeaveBalance,
  newHcmBalance: number,
  days: number,
): Promise<void> {
  const result = await manager
    .createQueryBuilder()
    .update(LeaveBalance)
    .set({
      hcmBalance: newHcmBalance,
      pendingDays: () => `pending_days + ${days}`,
      version:    () => 'version + 1',
    })
    .where('id = :id AND version = :version',
           { id: balance.id, version: balance.version })
    .execute();

  if (result.affected === 0) throw new OptimisticLockError();
}
```

**Why one method that both refreshes HCM balance AND increments pending?** Doing two separate updates would require two version checks, making the concurrency guarantee weaker. A single atomic UPDATE ensures the HCM balance is captured at the same moment the reservation is made.

---

# The createRequest Flow (The Hardest Method)

```
1. Check idempotency key in DB (outside txn — UNIQUE constraint handles races)
2. Call HCM getBalance (outside txn — don't hold write lock during network IO)
   \- If HCM down: use -1 sentinel (fall back to local shadow)
3. retryOnOptimisticLock:
   \- withImmediateTransaction:
      a. Load balance row
      b. LOCAL check: hcmBalance - pendingDays >= days  >  409 if not
      c. AUTHORITATIVE check: hcmAvailable - pendingDays >= days  >  409 if not
      d. applyHcmRefreshAndIncrementPending (optimistic lock)
         \- throws OptimisticLockError  >  retry from step 3
      e. INSERT time_off_request
         \- UNIQUE violation on idempotency_key  >  return cached row
      f. INSERT balance_audit_log (same transaction)
4. Return 201
```

**Why two balance checks (b and c)?** Check (b) uses the local shadow — it's fast and catches the obvious case. Check (c) uses the fresh HCM value — it catches the case where the HCM balance decreased externally (e.g., a manager directly cancelled something in Workday) but our shadow hasn't caught up yet. The HCM call happens outside the transaction precisely so the lock isn't held during the network round-trip.

---

# The approveRequest Flow

```
1. Load request, assert PENDING
2. Call HCM deductBalance (outside txn)
   |- 422 (insufficient) > throw 409, DB unchanged
   \- 5xx / timeout > throw 502, DB unchanged
3. retryOnOptimisticLock:
   \- withImmediateTransaction:
      a. Re-read request (guard against double-approve)
      b. Load balance row
      c. applyApproval: hcm_balance -= days, pending_days -= days, version += 1
      d. UPDATE request status to APPROVED + hcm_reference_id
      e. INSERT balance_audit_log
4. Return 200
```

**Why re-read the request inside the transaction?** The manager could double-click "Approve". The first call succeeds and commits. The second call re-reads the request, sees it's already `APPROVED`, and returns silently — idempotent without any HCM re-call.

---

# Batch Sync Reconciliation

Each balance entry in the HCM batch payload is processed in its own isolated `BEGIN IMMEDIATE` transaction:

```
For each entry:
  1. Upsert leave_balance with new hcm_balance (INSERT or UPDATE + version bump)
  2. Recompute pending_from_db = SUM(days) WHERE status='PENDING' for this key
  3. If (new_hcm_balance - pending_from_db) < 0:
        > LOG WARN discrepancy
        > do NOT auto-cancel requests (human must review)
  4. INSERT balance_audit_log (source='BATCH_SYNC')
```

Processing entries individually (not in one giant transaction) means a single contended row doesn't roll back the entire batch.

---

# Mock HCM Server

The mock HCM is a fully functional NestJS server with:
- In-memory `Map<string, number>` for balances
- Real `422 Unprocessable Entity` responses when `availableBalance < requestedDays`
- `POST /hcm/debug/anniversary` that increments balance then asynchronously fires a real `POST` to `EXAMPLEHR_BASE_URL/api/v1/hcm/sync/single` — proving the webhook integration works
- `POST /hcm/debug/reset` for test isolation

---

# Test Results

| Suite | Files | Tests | Coverage |
|-------|-------|-------|----------|
| Unit | 6 | 67 | — |
| Integration | 6 | 30 | — |
| E2E | 4 | 8 | — |
| **Total** | **15** | **105** | — |

| Metric | Score | Threshold |
|--------|-------|-----------|
| Statements | 92.1% | 80% OK |
| Branches | 80.3% | 75% OK |
| Functions | 92.3% | 80% OK |
| Lines | 91.7% | 80% OK |

All 5 mandatory regression scenarios have dedicated, named test files.

---

# Notable Implementation Discoveries

**The SAVEPOINT problem.** TypeORM's `manager.save()` internally checks `isTransactionActive` on the QueryRunner to decide between `BEGIN TRANSACTION` and `SAVEPOINT`. Since we issue `BEGIN IMMEDIATE` as a raw SQL query, TypeORM's flag is never set, causing it to try `BEGIN TRANSACTION` again — which SQLite rejects. Patching `qr.isTransactionActive = true` after the raw `BEGIN IMMEDIATE` fixed this. This is a real-world TypeORM + SQLite gotcha not documented anywhere.

**SQLite WAL + optimistic locking.** SQLite in WAL mode allows concurrent readers even with an active writer. Combined with `PRAGMA busy_timeout = 5000`, the system gracefully handles bursts of concurrent requests without "database is locked" errors — the timeout gives the optimistic-lock retry loop time to work.
