# Fiat Buffer Trading Assistant

This repository is an existing Next.js + TypeScript crypto assistant focused on read-only Kraken workflows.

The current phase is manual-assistant only:

- no auto-trading
- no order placement
- no order cancellation
- no Google Sheets usage in the active workflow
- AI is advisory only

## What the app does now

The `Assistant` tab is the active product surface.

It helps with:

- reading Kraken balances, open orders, and latest account activity
- generating deterministic balance-driven suggestions
- opening Kraken-ready copy forms for those suggestions
- asking contextual questions in the `Explain & Ask` panel
- viewing glossary explanations for trading concepts and order types

Top navigation stays:

- `Assistant`
- `System Automation`
- `Glossary`

`System Automation` is a placeholder. Legacy `/api/bot/*` routes still exist and return `410 Gone`.

## Password protection

The whole app is password protected.

Protection applies to:

- the page itself
- the Assistant UI
- the API routes used by the app

Implementation details:

- password is read from `APP_PASSWORD`
- successful login sets a long-lived HTTP-only cookie
- the session remains valid until the cookie is cleared or `APP_PASSWORD` changes
- authentication is enforced both by middleware and by server-side page/API checks
- if the cookie is missing or invalid, page requests redirect to `/login`
- unauthorized API requests return `401`

There is no separate user system in this phase. This is one shared application password.

## Current Assistant layout

The `Assistant` tab is now organized like this:

Top row:

- left column:
  - `Balances`
- right column:
  - `Sentiment`

Below the top row:

- full width:
  - `Suggestions`

Below that:

- Kraken subtab row with:
  - `Kraken`
  - `Refresh Kraken`

Lower layout:

- main column:
  - `Explain & Ask`
- right sidebar:
  - `Account`
  - `Advanced Strategy`
  - `Diagnostics`

## Balances

`Balances` is a dedicated top-level panel.

It shows:

- positive Kraken balances
- asset
- available amount
- cache/live state
- last checked time

## Suggestions

`Suggestions` is balance-driven and deterministic.

Each row represents one positive balance and tries to turn it into a practical Kraken-oriented idea.

Current front-of-table order:

1. `Asset`
2. `Available`
3. `Pair`
4. `Action`
5. `Status`
6. `Explain`
7. `Kraken`
8. `Snapshot`

The remaining execution fields follow after that:

- `Primary Order`
- `Order Qty`
- `Price`
- `Trigger`
- `Est. Total`

Meaning of the two similar amount fields:

- `Available`: the balance you currently hold in Kraken for that asset
- `Order Qty`: the amount this specific suggested order would use

Suggestion actions:

- `Draft`: prefills a question into `Explain & Ask`
- `Ask`: prefills and immediately sends that question
- `Ignore`: suppresses browser notifications for that exact ready suggestion fingerprint
- `Open`: opens the relevant Kraken market

READY notifications:

- when a suggestion reaches `READY`, the browser can notify you after permission is granted
- notifications are sent once per suggestion fingerprint so the same ready setup does not spam repeatedly
- `Ignore` stores that suppression locally and also attempts to persist it into `data/ignored-ready-suggestions.md`
- if the app is running on a read-only filesystem, browser local storage still keeps the suppression for that browser

Clicking a suggestion row opens a Kraken-style modal copy form.

Supported suggestion templates:

- `Limit`
- `Take Profit`
- `Take Profit Limit`
- `Iceberg`
- `Trailing Stop`
- `Trailing Stop Limit`

The modal provides:

- Kraken-like order layout
- field-by-field copy buttons
- TP/SL yes/no state
- trailing mode when relevant
- direct `Open Kraken` link

## Explain & Ask

`Explain & Ask` is the AI panel.

Rules:

- it is advisory only
- it does not place orders
- it does not cancel orders
- it does not replace deterministic suggestion logic

It can:

- answer freeform questions grounded in the current snapshot
- show the exact snapshot payload sent to the AI route
- receive prefilled context directly from a suggestion row

## Sentiment

`Sentiment` is a compact deterministic market context panel.

It shows:

- sentiment label
- score in `%`
- score in `bps`
- basket size
- reference source
- risk thresholds

## Account

`Account` is a sidebar panel containing:

- `Open Orders`
- `Latest Activity`

Both inner tables are independently collapsible.

`Refresh Kraken` forces a fresh authenticated account read and bypasses the in-memory account cache for the next fetch.

## Advanced Strategy

`Advanced Strategy` is collapsed by default.

It contains:

- take profit
- stop loss
- hold time
- MA settings
- spread guardrails
- fee/slippage assumptions
- net-edge thresholds

It also includes `Reset to safe defaults`.

## Glossary

The `Glossary` tab explains the terms used by the Assistant in plain language.

It includes:

- spread
- mid
- fee
- slippage
- net edge
- MA(50)
- deviation vs MA
- signal
- viability
- TP
- SL
- time stop
- notional
- quantity
- bps

It also explains the Kraken-style order types used in the suggestion modal:

- limit order
- stop loss order
- take profit order
- take profit limit order
- iceberg order
- trailing stop order
- trailing stop limit order

## Kraken integration

Kraken is read-only in this phase.

Used for:

- balances
- open orders
- latest account activity
- public ticker data
- public OHLC candle data
- instrument metadata

Not used for:

- live order placement
- cancel workflows
- automation

## Caching

The app uses in-memory caches for read-heavy Kraken data.

Current important behavior:

- authenticated account data is cached for about `60 seconds`
- market lookups also use in-memory caching where appropriate
- `Refresh Kraken` bypasses the account cache for the next read

Important for Vercel:

- these caches are instance-local and ephemeral
- they work on Vercel, but cache hit behavior is not guaranteed across serverless instances

## Environment variables

Configure `.env.local` for local development:

```bash
APP_PASSWORD=

KRAKEN_API_KEY=
KRAKEN_API_SECRET=
KRAKEN_REST_BASE_URL=https://api.kraken.com
KRAKEN_WS_URL=wss://ws.kraken.com

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

BOT_TIMEZONE=Europe/Amsterdam
```

Notes:

- `APP_PASSWORD` is required for access
- Kraken keys are optional for public market data, but required for balances/open orders/latest activity
- OpenAI is optional; without it, the AI route falls back to deterministic server-built responses

## Local development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Then open:

- [http://localhost:3000](http://localhost:3000)

You will be redirected to `/login` until `APP_PASSWORD` is set and entered correctly.

## Deploying on Vercel

Yes, the current manual-assistant app can be deployed on Vercel.

Recommended setup:

1. Import the repository into Vercel.
2. Set the required environment variables:
   - `APP_PASSWORD`
   - `KRAKEN_API_KEY`
   - `KRAKEN_API_SECRET`
   - `OPENAI_API_KEY` if AI responses should use OpenAI
   - optional Kraken/OpenAI overrides
3. Deploy normally as a Next.js project.

Important caveat:

- the current assistant works on Vercel
- the auth flow is enforced server-side as well as in middleware so Vercel edge/runtime differences do not bypass the password gate
- long-running automation, background runners, or durable in-memory queues should not be hosted on Vercel serverless functions

That limitation matters for the legacy automation layer, not for the current read-only assistant workflow.

## Verification

Run tests:

```bash
npm test
```

Run lint:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```
