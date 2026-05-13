# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is the **Time-Off Microservice** for ExampleHR — a NestJS + SQLite service that manages time-off request lifecycle and keeps leave balances in sync with an external HCM (Workday/SAP). The HCM is the Source of Truth; ExampleHR maintains a local shadow copy plus a pending-requests overlay.

Full design rationale is in [`TRD.md`](./TRD.md). Read it before touching balance logic, sync logic, or the concurrency model.

## Tech Stack

- **Framework:** NestJS (latest stable)
- **Database:** SQLite via TypeORM, WAL mode enabled
- **Language:** TypeScript, strict mode
- **Testing:** Jest + Supertest; coverage threshold 80 % lines / 75 % branches
- **Validation:** `class-validator` + `class-transformer` on all DTOs
- **HTTP client:** `@nestjs/axios` (wraps HCM calls in `HcmClientService`)
- **Rate limiting:** `@nestjs/throttler`
- **Mock HCM:** separate NestJS app in `mock-hcm/`, runs on :3001

## Common Commands

```bash
# Install dependencies
npm install
cd mock-hcm && npm install && cd ..

# Development (both services)
npm run start:dev          # main service :3000
npm run start:mock-hcm     # mock HCM :3001

# Build
npm run build

# Unit tests (mocked dependencies, no IO)
npm run test

# Integration tests (Supertest, in-process SQLite, HCM calls mocked with nock)
npm run test:integration

# E2E tests (requires mock HCM running on :3001)
npm run test:e2e

# All tests with coverage report
npm run test:cov

# Lint
npm run lint

# Run a single test file
npx jest --testPathPattern="time-off.service"

# Reset local SQLite database
rm -f ./data/timeoff.sqlite && npm run migration:run
```

## Architecture: The Balance Model

The central invariant — memorise it before writing any service code:

```
available_days = hcm_balance − pending_days   (must never be negative)
```

- `hcm_balance` — what HCM currently reports as available (after all approved/completed requests HCM knows about)
- `pending_days` — sum of `days` across all `PENDING` requests in ExampleHR (not yet submitted to HCM)
- `available_days` — **computed on every read**, never stored

When a request is created → `pending_days` increases.  
When a request is approved → HCM is called to deduct. Then `hcm_balance` decreases AND `pending_days` decreases by the same amount. Net `available_days` is unchanged on approval.  
When a batch sync arrives → `hcm_balance` is updated to HCM's value; `pending_days` is recalculated from live DB rows.

## Concurrency: Optimistic Locking

Every `leave_balances` row has a `version` integer. All writes do:
```sql
UPDATE leave_balances
  SET ..., version = version + 1
  WHERE id = ? AND version = ?expectedVersion
```
If `rowsAffected == 0`, retry up to 3 times before returning 409. All writes use `BEGIN IMMEDIATE` transactions in SQLite to serialize writers.

Do NOT bypass this mechanism. Do NOT add application-level locks.

## Module Map

| Module | Responsibility |
|--------|---------------|
| `balance/` | Balance reads and manual HCM refresh |
| `time-off/` | Request CRUD, state machine (PENDING→APPROVED→CANCELLED etc.) |
| `hcm-sync/` | Receives batch/single sync from HCM; contains reconciliation logic |
| `hcm-sync/hcm-client.service.ts` | All outbound calls to HCM — this is the only place that talks to HCM |
| `common/guards/hcm-api-key.guard.ts` | Protects the `/hcm/sync/*` endpoints |
| `database/` | TypeORM setup, WAL pragma, migrations |
| `mock-hcm/` | Standalone mock HCM server for tests; has a `/hcm/debug/*` control API |

## Request State Machine

```
PENDING ──(approve)──► APPROVED ──(period ends)──► COMPLETED
   │                       │
   │(reject)               │(cancel)
   ▼                       ▼
REJECTED               CANCELLED
   │
   │(cancel by employee before manager action)
   ▼
CANCELLED
```

State transitions are enforced in `TimeOffService`. Illegal transitions return 409.

## HCM Interaction Rules

- `HcmClientService` is the **only** class that makes HTTP calls to HCM. Inject and mock it in all tests.
- Real-time GET call happens during **request creation** (authoritative pre-flight after local check).
- POST deduct happens during **approval**. If HCM returns 4xx, approval fails gracefully and the request stays PENDING. If HCM returns 5xx/timeout, return 502 to caller — do not change DB state.
- POST credit happens when cancelling an **APPROVED** request.
- Retry policy: 3 attempts, exponential backoff 100 / 400 / 1600 ms.

## Testing Conventions

- **Unit tests** (`test/unit/`): mock all repositories and `HcmClientService` with Jest. Test one function at a time. Cover every branch in the service layer.
- **Integration tests** (`test/integration/`): use `@nestjs/testing` + Supertest against real in-memory SQLite. Use `nock` to intercept HCM HTTP calls.
- **E2E tests** (`test/e2e/`): start mock HCM in `beforeAll` via `NestFactory`. Use `/hcm/debug/reset` between suites. These tests prove the two services work together.

Critical test scenarios that **must** exist (regression guard):
1. Two concurrent `POST /time-off/requests` that together exceed balance — only one succeeds.
2. `POST /hcm/sync/batch` with anniversary bonus — `available_days` increases correctly.
3. Approve fails when HCM returns 422 — request stays PENDING, balance unchanged.
4. Cancel approved request — HCM credit endpoint is called exactly once.
5. Idempotency key replay — second POST returns same response, no duplicate DB row.

## Sensitive Invariants (Do Not Break)

- `balance_audit_logs` is append-only. Never UPDATE or DELETE rows in this table.
- `pending_days` must always equal the live sum of `days` for PENDING requests for that (employee, location, leaveType). After any state transition, re-verify this holds.
- `hcm_balance` must only be updated from actual HCM API responses or batch sync payloads — never set it to a locally computed value.
- All balance mutations (even single-record updates) must write an audit log row in the same transaction.

## Mock HCM Details

`mock-hcm/src/hcm.service.ts` holds an in-memory `Map` keyed by `${employeeId}:${locationId}:${leaveType}`. The deduct endpoint returns HTTP 422 when `availableBalance < days`. The debug endpoints are only available when `NODE_ENV !== 'production'`.

To simulate an anniversary bonus in a test:
```
POST http://localhost:3001/hcm/debug/anniversary
{ "employeeId": "EMP-1", "locationId": "LOC-1", "leaveType": "VACATION", "bonusDays": 5 }
```
The mock HCM automatically pushes a single-balance webhook to `EXAMPLEHR_BASE_URL/api/v1/hcm/sync/single` after crediting the balance.
