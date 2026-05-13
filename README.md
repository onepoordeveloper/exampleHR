# Time-Off Microservice — ExampleHR

A NestJS + SQLite microservice that manages the full time-off request lifecycle and keeps leave balances in sync with an external HCM (Workday / SAP).

## Quick Start

```bash
# Install dependencies
npm install
cd mock-hcm && npm install && cd ..

# Start the mock HCM (port 3001) — required for E2E tests and manual testing
npm run start:mock-hcm

# Start the main service (port 3000)
npm run start:dev
```

Swagger UI is available at **http://localhost:3000/api/docs** once the service is running.

## API Overview

### Balance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/employees/:employeeId/balances` | List all balances for an employee |
| GET | `/api/v1/employees/:employeeId/balances/:locationId` | Get balance for a specific location |
| POST | `/api/v1/employees/:employeeId/balances/:locationId/refresh` | Force refresh from HCM |

### Time-Off Requests

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/time-off/requests` | Create a new request |
| GET | `/api/v1/time-off/requests` | List requests (filterable by employee, status) |
| GET | `/api/v1/time-off/requests/:id` | Get a single request |
| PATCH | `/api/v1/time-off/requests/:id/approve` | Approve (calls HCM deduct) |
| PATCH | `/api/v1/time-off/requests/:id/reject` | Reject |
| PATCH | `/api/v1/time-off/requests/:id/complete` | Mark completed |
| DELETE | `/api/v1/time-off/requests/:id` | Cancel (credits HCM if already approved) |

### HCM Sync (protected by `X-HCM-API-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/hcm/sync/batch` | Receive a full balance snapshot from HCM |
| POST | `/api/v1/hcm/sync/single` | Receive a single balance update from HCM |

All responses are wrapped in `{ data, error }` envelope.

## Authentication

- **Employee/Manager endpoints** — `Authorization: Bearer <token>` (JWT stub; any non-empty token accepted)
- **HCM sync endpoints** — `X-HCM-API-Key: <key>` header (set via `HCM_API_KEY` env var)

## Environment Variables

Copy `.env.example` to `.env` before starting:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `HCM_BASE_URL` | `http://localhost:3001` | HCM service URL |
| `HCM_API_KEY` | `supersecret` | API key for outbound HCM calls AND inbound sync endpoint validation |
| `DATABASE_PATH` | `./data/timeoff.sqlite` | SQLite file path |

## Running Tests

```bash
# Unit tests (mocked dependencies)
npm run test

# Integration tests (Supertest + nock + in-memory SQLite)
npm run test:integration

# E2E tests (requires mock HCM on :3001)
npm run test:e2e

# All tests with coverage report
npm run test:cov
```

Coverage thresholds: **80% lines / 75% branches / 80% functions**.

Current results: 92% statements · 80% branches · 92% functions · 92% lines across 105 tests.

## Architecture Notes

The central invariant: `available_days = hcm_balance − pending_days` (computed on every read, never stored).

Key design decisions:
- **Optimistic locking** — every `leave_balances` write uses `UPDATE ... WHERE version = ?`; 0 rows affected triggers a retry
- **BEGIN IMMEDIATE transactions** — SQLite write lock acquired upfront to prevent phantom reads
- **HCM calls outside transactions** — no lock held during network I/O
- **Idempotency keys** — UNIQUE constraint on `time_off_requests.idempotency_key`; races handled via constraint catch

See [`TRD.md`](./TRD.md) for the full technical design.

### Narrative Reports

| Report | Description |
|--------|-------------|
| [01 — Requirements Simplified](./reports/01-requirements-simplified.pdf) | The problem and business rules in plain English — no technical jargon |
| [02 — The Plan](./reports/02-the-plan.pdf) | Architecture decisions, phased implementation strategy, and locked design choices |
| [03 — Implementation](./reports/03-implementation.pdf) | How the critical pieces were built: `BEGIN IMMEDIATE`, optimistic locking, the balance algorithm, batch sync, and test results |
| [04 — Solution Quality (NFR)](./reports/04-solution-quality-nfr.pdf) | Scored assessment of correctness, reliability, scalability, security, observability, and maintainability |
| [05 — Loopholes](./reports/05-loopholes.pdf) | Known gaps, edge cases, and production upgrade paths |

## Mock HCM Debug API

When running locally, the mock HCM exposes control endpoints at `http://localhost:3001`:

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/hcm/debug/balance` | Set balance directly |
| POST | `/hcm/debug/anniversary` | Add bonus days and push sync webhook |
| POST | `/hcm/debug/reset` | Reset all state |
| GET | `/hcm/debug/state` | Inspect current in-memory state |
