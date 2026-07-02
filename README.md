# Alpha Autopilot

Crypto intraday trading operating system. Search aggressively. Execute selectively. Protect capital first.

**This is not a gambling bot, fake AI profit bot, or get-rich-quick machine.**

## Prompt 1 Scope

Foundation only — no real trading, no Auto execution, no exchange connections, no fake P&L.

### What works now

- Next.js App Router + TypeScript + Tailwind + shadcn/ui-style components
- PostgreSQL schema (Prisma) with full ledger-oriented models
- Zod-validated environment config (server-only)
- Pino logger with secret redaction
- Audit logger (DB + structured logs)
- Health endpoint: `GET /api/health`
- Mode endpoints: `GET /api/mode`, `POST /api/mode`
- Dashboard shell with mode selector
- Three modes: Paper, Manual, Auto (Auto execution **locked**)

### Modes

| Mode   | Behavior |
|--------|----------|
| Paper  | Realistic simulation only (engine NOT_IMPLEMENTED) |
| Manual | One trade card at a time (NOT_IMPLEMENTED) |
| Auto   | Visible/selectable; execution locked until all proof gates pass |

Auto is always blocked with reason `PROOF_GATES_NOT_IMPLEMENTED` until later prompts implement real gates.

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS 4
- shadcn/ui (manual setup)
- PostgreSQL + Prisma ORM
- Redis (config placeholder only)
- Zod, Pino, Vitest

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- (Optional) Redis — not required for Prompt 1

## Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit DATABASE_URL in .env

# Push schema to database
npm run db:push

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## ENCRYPTION_KEY (API Vault)

Before storing **real** exchange API keys, set a production-safe encryption key in `.env`:

```bash
# macOS / Linux / Git Bash
openssl rand -base64 32
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Add to `.env`:

```env
ENCRYPTION_KEY=<paste output here>
```

**Rules:**
- Must be base64 decoding to **32+ bytes**
- Never commit or expose to the frontend
- Restart `npm run dev` after changing `.env`
- Without it: dev uses unsafe fallback; **vault writes are blocked**
- User authentication is **NOT implemented** — vault writes stay blocked until auth exists

## API

### Health

```bash
curl http://localhost:3000/api/health
```

### Get mode

```bash
curl http://localhost:3000/api/mode
```

Response:

```json
{
  "current_mode": "paper",
  "paper_enabled": true,
  "manual_enabled": true,
  "auto_visible": true,
  "auto_selected": false,
  "auto_execution_enabled": false,
  "auto_blocked_reason": "PROOF_GATES_NOT_IMPLEMENTED",
  "auto_state": "locked",
  "last_changed_at": "2026-07-02T..."
}
```

### Set mode

```bash
curl -X POST http://localhost:3000/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"auto"}'
```

Emergency pause:

```bash
curl -X POST http://localhost:3000/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"auto","emergency_pause":true}'
```

## Tests

```bash
npm test
```

Unit tests cover mode evaluation logic and error utilities. Integration tests require a running PostgreSQL instance.

## Folder Structure

```
app/                    # Next.js App Router pages & API routes
components/             # React components
components/ui/          # shadcn/ui primitives
lib/
  config/               # env, constants, redis placeholder
  logger/               # pino logger + audit logger
  security/             # error utilities
  db/                   # Prisma client
  types/                # shared TypeScript types
  trading/              # trading engines (stubs)
    data/ features/ strategies/ risk/ execution/
    proof/ paper/ live/ reports/
workers/                # background job workers (stub)
prisma/                 # database schema
tests/                  # Vitest tests
```

## NOT_IMPLEMENTED (Prompt 2+)

- Redis client & job queues
- Market data ingestion
- Strategy engines
- Risk engine & Trade Permission Engine
- Proof gates
- Paper simulation
- Live execution
- Exchange API connections
- Authentication

## License

Private — all rights reserved.
