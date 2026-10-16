# NEXUS//INFRA — BrutalistCrypto Trading Engine

Raw, deterministic algorithmic trading engine for crypto markets. Zero ornamentation.
Pure signal → decision → execution → notification.

---

## 1. Architecture

```
market ticks ──▶ STRATEGY ENGINE ──▶ signals ──▶ EXECUTION ──▶ trades log
                     │                                   │
                     ▼                                   ▼
              algorithm params                    WEBHOOK DISPATCHER
              (per strategy)                      (HMAC signed, retried)
```

- **Market ticks** — price/volume observations per symbol, ingested via API or simulated.
- **Strategies** — algorithm instances with tunable parameters and risk limits.
- **Trades** — immutable log entries. Every execution (live, simulated, or backtest) is appended to the trades log.
- **Webhooks** — outbound HTTP notifications signed with HMAC-SHA256, delivered with retries and a full delivery audit trail.

---

## 2. Algorithm Parameters

Each strategy has `algorithm` (one of the types below) and a `params` object.
All strategies also share **risk limits**: `maxPositionSize`, `maxNotionalUsd`,
`feeBps`, `slippageBps`, `cooldownMs`.

### 2.1 `momentum` — MA crossover with RSI filter

| Param            | Default | Description                                        |
| ---------------- | ------- | -------------------------------------------------- |
| `fastPeriod`     | 5       | Fast SMA window (ticks)                            |
| `slowPeriod`     | 20      | Slow SMA window (ticks)                            |
| `rsiPeriod`      | 14      | RSI lookback                                        |
| `rsiOverbought`  | 70      | Block BUY when RSI ≥ this                           |
| `rsiOversold`    | 30      | Block SELL when RSI ≤ this                          |
| `minVolume`      | 0       | Minimum tick volume required to trade               |
| `orderSize`      | 1       | Base quantity per order                             |

**Signal:** fast SMA crosses above slow SMA → BUY; crosses below → SELL, subject to RSI/volume filters.

### 2.2 `mean_reversion` — Bollinger band snap-back

| Param             | Default | Description                                  |
| ----------------- | ------- | -------------------------------------------- |
| `lookbackPeriod`  | 20      | SMA/StdDev window                            |
| `entryStdDev`     | 2.0     | Enter when price deviates ≥ N·σ from mean    |
| `exitStdDev`      | 0.5     | Exit when price reverts within N·σ of mean   |
| `maxHoldTicks`    | 100     | Force-close position after N ticks           |
| `orderSize`       | 1       | Base quantity per order                      |

**Signal:** price below mean − `entryStdDev`·σ → BUY; above mean + `entryStdDev`·σ → SELL; revert within `exitStdDev`·σ → close.

### 2.3 `grid` — fixed-interval grid trading

| Param        | Default | Description                                   |
| ------------ | ------- | --------------------------------------------- |
| `gridLevels` | 10      | Number of grid lines                          |
| `lowerPrice` | 0       | Grid floor (0 = derive from first tick − range %) |
| `upperPrice` | 0       | Grid ceiling (0 = derive from first tick + range %) |
| `rangePct`   | 10      | ±% used to derive bounds when not explicit    |
| `orderSize`  | 1       | Base quantity per grid level                  |

**Signal:** price crossing down through a grid line → BUY; crossing up → SELL.

### 2.4 `breakout` — Donchian channel breakout

| Param              | Default | Description                                  |
| ------------------ | ------- | -------------------------------------------- |
| `channelPeriod`    | 20      | Highest-high / lowest-low lookback           |
| `confirmationTicks`| 2       | Consecutive closes beyond channel required   |
| `orderSize`        | 1       | Base quantity per order                      |

**Signal:** close above N-period high for `confirmationTicks` ticks → BUY; below N-period low → SELL.

### 2.5 `dca` — time-based dollar-cost averaging

| Param          | Default | Description                                |
| -------------- | ------- | ------------------------------------------ |
| `intervalTicks`| 10      | Buy every N ticks                          |
| `orderSize`    | 1       | Base quantity per interval                 |
| `takeProfitPct`| 0       | If > 0, SELL all when P&L ≥ this %         |

---

## 3. Trades Log

Every executed trade is an immutable record:

| Field        | Type     | Notes                                              |
| ------------ | -------- | -------------------------------------------------- |
| `id`         | uuid     |                                                    |
| `strategyId` | uuid     | FK → strategy                                      |
| `symbol`     | text     | e.g. `BTC/USDT`                                    |
| `side`       | BUY/SELL |                                                    |
| `quantity`   | number   |                                                    |
| `price`      | number   | Execution price (incl. slippage)                   |
| `notionalUsd`| number   | quantity × price                                   |
| `feeUsd`     | number   | `feeBps` applied to notional                       |
| `pnlUsd`     | number   | Realized P&L (closing trades)                      |
| `mode`       | enum     | `live` \| `simulated` \| `backtest`                |
| `signal`     | text     | Human-readable reason the algo fired               |
| `executedAt` | timestamp|                                                    |

---

## 4. Webhooks

Register endpoints to receive signed event notifications.

### 4.1 Events

| Event                | Payload            | Fired when                          |
| -------------------- | ------------------ | ----------------------------------- |
| `trade.executed`     | trade object       | Any trade enters the trades log     |
| `strategy.started`   | strategy object    | Strategy status → `running`         |
| `strategy.stopped`   | strategy object    | Strategy status → `stopped`         |
| `backtest.completed` | backtest summary   | Backtest run finishes               |

### 4.2 Delivery

- HTTP `POST` to the registered `url` with JSON body:
  `{ "id", "event", "timestamp", "data" }`
- Headers:
  - `X-Nexus-Event` — event name
  - `X-Nexus-Delivery` — delivery id
  - `X-Nexus-Signature` — `sha256=<hmac_hex>` HMAC-SHA256 of the raw body using the webhook `secret`
  - `X-Nexus-Timestamp` — unix ms
- **Retries:** up to 3 attempts, exponential backoff (1s → 2s → 4s).
- Every attempt is recorded in `webhook_deliveries` with status, HTTP code, latency, and error.

### 4.3 Signature verification (receiver side)

```
signature == "sha256=" + HMAC_SHA256(webhook.secret, raw_body)
```

---

## 5. API Reference

### Strategies

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/strategies`               | List strategies                      |
| POST   | `/api/strategies`               | Create strategy                      |
| GET    | `/api/strategies/:id`           | Get strategy                         |
| PATCH  | `/api/strategies/:id`           | Update params / risk limits          |
| DELETE | `/api/strategies/:id`           | Delete strategy                      |
| POST   | `/api/strategies/:id/start`     | Start (status → running)             |
| POST   | `/api/strategies/:id/stop`      | Stop (status → stopped)              |

### Trades

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/trades`                   | Query trades log (`?strategyId=&symbol=&mode=&limit=`) |
| GET    | `/api/trades/stats`             | Aggregate stats (`?strategyId=`)     |

### Market data & simulation

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/market/ticks?symbol=`     | List recent ticks                    |
| POST   | `/api/market/ticks`             | Ingest a tick `{symbol, price, volume?}` |
| POST   | `/api/market/simulate`          | Generate synthetic ticks `{symbol, ticks, startPrice, volatilityPct, trendPct}` |

### Backtests

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| POST   | `/api/backtests`                | Run backtest `{strategyId, ticks, startPrice, volatilityPct, trendPct}` → summary incl. win rate, total P&L, max drawdown, sharpe |

### Webhooks

| Method | Path                            | Description                          |
| ------ | ------------------------------- | ------------------------------------ |
| GET    | `/api/webhooks`                 | List webhooks                        |
| POST   | `/api/webhooks`                 | Create webhook `{url, events, secret?}` |
| PATCH  | `/api/webhooks/:id`             | Update (url, events, active)         |
| DELETE | `/api/webhooks/:id`             | Delete                               |
| GET    | `/api/webhooks/:id/deliveries`  | Delivery audit log                   |
| POST   | `/api/webhooks/:id/test`        | Send test ping event                 |

---

## 6. Running

```bash
npm install
npm run dev        # serves client + API on :5000
npm run check      # typecheck
```

Open `/trades` for the engine console: create a strategy, start it, simulate market
ticks, watch the trades log fill, and wire a webhook to stream signed events out.
