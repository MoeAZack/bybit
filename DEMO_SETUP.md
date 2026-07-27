# Bybit Demo Setup

Shakedown run for the trading terminal against Bybit's demo environment
(`api-demo.bybit.com`) — real API, real signing, real fills, fake money.

Verified 2026-07-27: demo endpoint reachable, `XAUUSDT` status `Trading`.

---

## 1. Environment

Copy `.env.demo.example` to `.env.local` and fill it in.

```bash
cp .env.demo.example .env.local
```

| Variable | Why |
|---|---|
| `API_AUTH_TOKEN` | **Required.** All `/api/*` routes reject requests without it. Use a long random string. |
| `DATA_DIR` | Where `db.json` lives. Set it to a **persistent** path — on Cloud Run the container filesystem is wiped on every redeploy and scale-to-zero. |
| `PORT` | Defaults to 3000. |
| `GEMINI_API_KEY` | Optional. Without it the MetaLabeler uses its local deterministic classifier. |
| `MT5_BRIDGE_TOKEN` | Only needed when you go back to MT5 for a prop firm. |

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Apply the demo profile

```bash
npm install
npm run dev
```

Stop it once `db.json` exists, then:

```bash
node scripts/setup-demo.mjs
```

This sets:

| Setting | Value | Why |
|---|---|---|
| `activeBroker` | `bybit` | MT5 config is preserved, just not routed to |
| `bybitEnvironment` | `demo` | hits `api-demo.bybit.com` |
| `isPaperTrading` | `false` | **intentional** — paper mode keeps orders inside the process and proves nothing. This exercises the real signing/order/fill path with fake funds |
| `autoMode` | `approve` | signals queue for one-click firing; you watch before going hands-off |
| `isCircuitBreakerActive` | `true` (5%) | on Bybit this was dead code until now — first run where it actually protects |
| `isDynamicSlActive` | `true`, ATR ×1.5 | ATR stops, not fixed percentages |
| `defaultOrderSize` | `0.05` | ~$1 risk per trade at a ~$20 ATR stop. Deliberately tiny while validating |

Check state at any time without changing anything:

```bash
node scripts/setup-demo.mjs --check
```

## 3. API credentials — you enter these, not a script

1. Bybit → switch to **Demo Trading** → create API keys there.
   Demo keys are separate from live keys.
2. Permissions: **Contracts (Orders + Positions)** and **Wallet (read)**.
   **Do not enable Withdrawals.**
3. Terminal UI → **Settings** → paste key + secret → Save.

Keys go in the UI only — never in a script, env file committed to git, or a shell
command that lands in history.

## 4. Verify before letting it trade

```bash
npx tsx server/verify-fixes.ts     # 15 assertions: dead-man switch, venue routing, no synthetic data
npm run lint                       # tsc --noEmit
```

Then in the UI confirm:

- **Balance & Margin** shows your demo balance (proves the keys and signing work)
- **DXY / US10Y** show real numbers, not `—`. If they show `FEED UNAVAILABLE` that is
  honest reporting, not a bug — the macro veto is skipped and says so
- **Win rate / PnL / expectancy all start at zero.** The old build shipped four fabricated
  trades (a fake "75% win rate") and a phantom `SHORT 0.2 @ 2368.10`. Those are gone. If you
  ever see a track record you did not earn, something is wrong
- **Kill switch** toggles and blocks entries (dead-man switch — previously inert)

## 5. Run it

Leave `autoMode: approve` for several days. Approve signals by hand and compare fills
against what the terminal predicted. Only switch to `auto` once:

- fills land where the stops said they would
- the circuit breaker has been observed tripping correctly (test it with a tight
  `maxDrawdownPercent` on demo)
- you have enough trades for the win rate to mean anything — a handful does not

## 6. Before live money

- [ ] Honest backtest (the backtester refuses synthetic data — it will error rather than fake it)
- [ ] Demo run long enough to be statistically meaningful
- [ ] `DATA_DIR` on persistent storage, `--min-instances=1` if on Cloud Run
- [ ] `defaultOrderSize` sized to the real account (~$200–300), not the demo balance
- [ ] `bybitEnvironment` → `live` and **new live API keys** (never reuse demo keys)

## Going back to MT5 for a prop firm

Nothing was deleted. Set `activeBroker` to `mt5`, fill in the MT5 credentials, and start
the MoebyBridge EA. The bridge, EA, heartbeat, and command queue are untouched.
