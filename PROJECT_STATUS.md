# Alpha Autopilot — Project Status

**Last updated:** 2026-07-02  
**App version (constants):** `0.8.0`  
**Package version (`package.json`):** `0.1.0` (not bumped — cosmetic mismatch)  
**Phases completed:** Prompt 1–8 of 8 (all prompts complete)  
**Next phase:** None — production hardening / live exchange wiring as needed

This document describes the **actual** state of the codebase. Nothing here is aspirational.

---

## 1. What Has Been Built (Prompt 8 Additions)

### Prompt 8 — Reporting, Reality Check, Auto Unlock, Learning, Dashboard, Testing, Security, Deployment
- **Production Profitability Reporting Engine** — net P&L primary, costs/drawdown/breakdowns, no fake claims
- **Same-Day Deployment Reality Check** — truthful evidence statements, never overstates proof
- **Auto Mode Strict Unlock** — 50+ gates; returns BLOCK/WATCH/WAIT/MANUAL_ONLY/PAPER_ONLY/TINY_CANARY_ONLY/REVALIDATION_REQUIRED
- **Bounded Learning Engine** — observations only; cannot increase risk, approve Auto, or bypass permission
- **Dashboard UI** — mode, auto unlock, reality check, P&L placeholders (no fake metrics), readiness snapshot
- **Security hardening helpers** — rate limits, input validation, server-side Auto auth, secret redaction rules
- **Worker registry** — 35 workers defined for deployment readiness (Redis queue not wired)
- **Final readiness check** — programmatic verification of all major subsystems
- **API routes:** `/api/dashboard`, `/api/readiness`, `/api/reports/profitability`, `/api/reality/same-day`, `/api/auto/unlock`, `/api/learning`
- **Tests:** `tests/prompt8.test.ts` (34 tests covering auto blocks, reality check, learning bounds, report integrity)

### Still NOT Built (by design or deferred)
- **Auto execution (live order placement)** — unlock engine exists; `executionEngineWired: false`
- **Live exchange private API** — balance/fill ingestion from Kraken auth
- **Redis / background worker processes** — registry only
- **User authentication**
- **Playwright UI tests**
- **Scheduled cron jobs** — worker schedules defined, not running

---

## 2. Exact Files Created (Prompt 8)

- `lib/trading/reports/types.ts`
- `lib/trading/reports/profitability-report.ts`
- `lib/trading/reality/same-day-check.ts`
- `lib/trading/reality/index.ts`
- `lib/trading/auto/types.ts`
- `lib/trading/auto/unlock.ts`
- `lib/trading/auto/index.ts`
- `lib/trading/learning/engine.ts`
- `lib/trading/learning/index.ts`
- `lib/trading/readiness/types.ts`
- `lib/trading/readiness/check.ts`
- `lib/trading/readiness/index.ts`
- `lib/security/api-guards.ts`
- `app/api/dashboard/route.ts`
- `app/api/readiness/route.ts`
- `app/api/reports/profitability/route.ts`
- `app/api/reality/same-day/route.ts`
- `app/api/auto/unlock/route.ts`
- `app/api/learning/route.ts`
- `tests/prompt8.test.ts`

---

## 3. Exact Files Changed (Prompt 8)

| File | Change |
|------|--------|
| `lib/trading/mode-evaluation.ts` | Integrated strict auto unlock gates |
| `lib/trading/reports/index.ts` | Export profitability report |
| `lib/config/constants.ts` | Version `0.8.0` |
| `components/dashboard-shell.tsx` | Full dashboard with reality check + auto unlock |
| `workers/index.ts` | Worker registry + deployment services map |
| `PROJECT_STATUS.md` | This file |

---

## 4. How to Run Locally

```bash
npm install
cp .env.example .env
# Set DATABASE_URL (required)
# Optional: ENCRYPTION_KEY for production-safe vault

npm run db:push
npm run dev
```

- Dashboard: http://localhost:3000  
- API Vault: http://localhost:3000/settings/api  

---

## 5. How to Test

```bash
npm test          # 12 test files, 88 tests
npx tsc --noEmit  # Pre-existing TS errors in older files (decay, kelly, leverage)
npm run lint
```

Manual API:
```bash
curl http://localhost:3000/api/dashboard
curl http://localhost:3000/api/readiness
curl http://localhost:3000/api/auto/unlock
curl http://localhost:3000/api/reality/same-day
```

---

## 6. How to Safely Enable Paper

1. Start with `PAPER` mode (default).
2. Paper broker models fees, spread, slippage, funding — profits are **simulated**.
3. Use `/api/paper-broker` and `/api/paper-forward` — same-day signals only.
4. Never treat paper P&L as live edge; reality check labels paper profit as not real.

---

## 7. How to Safely Enable Manual

1. Switch to `MANUAL` via dashboard or `POST /api/mode {"mode":"manual"}`.
2. Request trade cards: `POST /api/trade-cards` with symbol + strategy.
3. Cards return `WAIT` when no clean setup — this is correct safety behavior.
4. Permission engine must return `ALLOW` or `MANUAL_ONLY` before acting.
5. Execute only after reviewing stop, size, costs, and evidence level on the card.

---

## 8. What Must Be True Before Auto

All of the following (non-exhaustive — see `/api/auto/unlock`):

- Evidence level ≥ 10 (tiny-live canary minimum)
- Same-day market proof available
- Live reconciliation passed
- Benchmark alpha, Monte Carlo, adversarial tests passed
- No edge decay, live drift, or strategy degradation
- Profit attribution supports real edge (not beta/luck)
- Live sample size statistically meaningful (≥20 trades minimum)
- User manually approved Auto stage
- **Execution engine wired** (NOT_IMPLEMENTED — Auto remains locked)
- No withdrawal permission on API keys
- All 50+ unlock gates pass

Auto **never** scales because of backtest profit alone or one big live win.

---

## 9. Real-Money Risk Warning

**This software can lose money.** Auto execution is locked but Manual mode can guide real trades. Cryptocurrency trading involves substantial risk of loss. Past backtest, paper, or shadow results do not guarantee future performance. Net P&L after fees, slippage, and funding is often negative. Do not trade with money you cannot afford to lose. Verify all API keys have **no withdrawal permission**. Use tiny canary sizes only after reconciled live evidence. The system intentionally blocks most setups — blocking is a feature, not a bug.

---

## 10. What Works Now

| Area | Status |
|------|--------|
| Paper / Manual / Auto modes | ✅ Auto selectable, execution locked |
| Profitability reporting | ✅ Input-driven, no fake P&L |
| Same-day reality check | ✅ Truthful evidence labels |
| Auto strict unlock | ✅ 50+ gates evaluated |
| Bounded learning | ✅ Forbidden actions blocked |
| Dashboard | ✅ Live system state (no fake metrics) |
| Security helpers | ✅ Rate limit, server-side Auto auth |
| Worker registry | ✅ Defined, not running |
| Final readiness check | ✅ Programmatic |
| All prior prompts (1–7) | ✅ As documented previously |
| Unit tests | ✅ 88 passing |

---

## 11. Placeholders Still Remaining

| Component | Status |
|-----------|--------|
| Auto order placement | NOT_IMPLEMENTED |
| Live private API | NOT_IMPLEMENTED |
| Redis queue | NOT_IMPLEMENTED |
| Worker processes | DEFINED only |
| User auth | NOT_IMPLEMENTED |
| Dashboard live P&L | Shows `—` until verified trades supplied |
| Exchange permission detection | NOT_IMPLEMENTED |

---

*Prompt 8 complete. All 8 prompts delivered.*
