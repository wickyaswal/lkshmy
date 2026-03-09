# Fiat Buffer Trading Assistant

This project is a private, password-protected crypto assistant built around a manual Kraken workflow.

Its purpose is simple:

- show your Kraken balances, open orders, and latest activity in one place
- turn live balances into practical manual buy or sell suggestions
- help you understand those suggestions before you copy anything into Kraken
- keep trading support read-only and non-automated

The current product is an assistant, not a bot.

- no order placement
- no order cancellation
- no live auto-trading
- no Google Sheets in the active workflow
- AI is advisory only and does not override deterministic suggestions

## Current product scope

The active navigation is:

- `Assistant`
- `System Automation`
- `Glossary`

What these tabs mean:

- `Assistant`: the live product surface you use today
- `System Automation`: placeholder area for later phases
- `Glossary`: plain-language explanations of trading terms and order types

Legacy `/api/bot/*` routes still exist in the repository for compatibility, but they return `410 Gone` in this manual-assistant phase.

## What the Assistant does

The `Assistant` tab is designed around a practical review flow:

1. See what is currently in your account.
2. See which balances might be worth acting on.
3. Open a Kraken-style copy form for those suggestions.
4. Ask follow-up questions in `Explain & Ask`.

The page is currently organized like this:

- top row:
  - `Balances`
  - `Sentiment`
- below that:
  - `Suggestions` (full width)
- lower area:
  - `Explain & Ask`
  - `Account`
  - `Advanced Strategy`
  - `Diagnostics`

## Main features

### Balances

Shows:

- positive Kraken balances
- asset symbol
- available amount
- whether the last response came from cache or live fetch
- last checked time

### Suggestions

`Suggestions` is the core workflow.

Each row starts from a live balance and turns it into a practical manual suggestion. That suggestion can be:

- a buy idea using a quote balance such as EUR, USD, or USDT
- a sell or protective exit idea using an asset you already hold

Front-of-table column order:

1. `Asset`
2. `Available`
3. `Pair`
4. `Action`
5. `Status`
6. `Explain`
7. `Kraken`
8. `Snapshot`

Additional execution detail columns follow after that:

- `Primary Order`
- `Order Qty`
- `Price`
- `Trigger`
- `Est. Total`

Important distinction:

- `Available` = what is currently in your Kraken account
- `Order Qty` = how much this specific suggestion would use

Suggestion actions:

- `Draft`: pre-fills a question into `Explain & Ask`
- `Ask`: pre-fills and immediately sends that question
- `Ignore`: suppresses notifications for that specific ready suggestion
- `Open`: opens the matching Kraken market

Clicking a row opens a Kraken-style copy form modal.

Supported modal templates:

- `Limit`
- `Take Profit`
- `Take Profit Limit`
- `Iceberg`
- `Trailing Stop`
- `Trailing Stop Limit`

The modal is meant to make manual entry easier. It includes:

- Kraken-like layout
- direct link to the relevant Kraken market
- field-by-field copy buttons
- TP/SL state
- trailing mode where relevant

### Explain & Ask

This is the AI support panel.

It can:

- answer freeform questions about the current state
- explain a suggestion in plain language
- show the exact snapshot payload sent to the AI route

It cannot:

- place orders
- cancel orders
- replace the deterministic logic used by the suggestion system

If `OPENAI_API_KEY` is not set, the app still works and falls back to a deterministic server-built response.

### Sentiment

The `Sentiment` panel is a compact market context view.

It shows:

- current label (`Risk-off`, `Neutral`, `Risk-on`)
- score in percent
- score in basis points
- basket size
- reference source
- active thresholds

### Account

The `Account` panel contains:

- `Open Orders`
- `Latest Activity`

Both tables are collapsible.

`Refresh Kraken` forces a fresh authenticated Kraken read and bypasses the cached account response for that request.

### Advanced Strategy

This panel is collapsed by default.

It contains the settings that influence deterministic suggestions, such as:

- take profit
- stop loss
- hold time
- moving-average settings
- spread guardrails
- fee and slippage assumptions
- net-edge thresholds

It also includes `Reset to safe defaults`.

### Glossary

The `Glossary` tab explains the assistant in plain language.

It covers:

- spread
- mid
- fees
- slippage
- net edge
- MA(50)
- deviation vs MA
- signal
- viability
- TP / SL
- time stop
- notional
- quantity
- basis points

It also explains the Kraken-style order types used by the copy form.

## Kraken integration

Kraken is read-only in the current phase.

Used for:

- balances
- open orders
- latest activity
- ticker data
- OHLC candle data
- instrument metadata

Not used for:

- order placement
- cancel workflows
- unattended automation

## Notifications and ignored suggestions

When a suggestion becomes `READY`, the app can notify you in the browser after permission is granted.

Important behavior:

- notifications are only for `READY` suggestions
- the same ready suggestion is not repeatedly spammed
- `Ignore` suppresses that specific ready suggestion

Ignored suggestions are persisted in two ways:

- primary local store: `data/ignored-ready-suggestions.md`
- browser fallback: `localStorage`

This matters for deployment:

- on a normal writable local server, ignored suggestions can be written to the markdown file
- on read-only or ephemeral environments such as Vercel serverless storage, browser storage still keeps the suppression for that browser session/profile

## Password protection

The whole app is password protected.

Protection applies to:

- the page itself
- the Assistant UI
- the API routes used by the page

Current behavior:

- password comes from `APP_PASSWORD`
- successful login sets a long-lived HTTP-only cookie
- the session remains valid until the cookie is cleared or the password changes
- page access redirects to `/login` when unauthenticated
- protected API calls return `401` when unauthenticated

This is a shared app password, not a multi-user account system.

## Caching

The app uses in-memory caching for read-heavy Kraken data.

Current practical behavior:

- authenticated account data is cached for about `60 seconds`
- market reads also use in-memory caching where appropriate
- `Refresh Kraken` bypasses the account cache for the next read

Important caveat for Vercel:

- caches are instance-local
- they are not durable across deployments or serverless instances

That is acceptable for the current read-only assistant workflow.

## Environment variables

Create `.env.local` for local development.

Minimum useful setup:

```bash
APP_PASSWORD=your-password

KRAKEN_API_KEY=
KRAKEN_API_SECRET=
KRAKEN_REST_BASE_URL=https://api.kraken.com
KRAKEN_WS_URL=wss://ws.kraken.com

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

BOT_TIMEZONE=Europe/Amsterdam
```

Notes:

- `APP_PASSWORD` is required
- Kraken keys are optional if you only want public market data
- Kraken keys are required for balances, open orders, and latest activity
- OpenAI is optional

## Local development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Then open:

- [http://localhost:3000](http://localhost:3000)

If `APP_PASSWORD` is set correctly, the app will show the login page first.

## Deploying on Vercel

This app can be deployed on Vercel in its current manual-assistant form.

Recommended environment variables:

- `APP_PASSWORD`
- `KRAKEN_API_KEY`
- `KRAKEN_API_SECRET`
- `OPENAI_API_KEY` if you want AI responses from OpenAI
- optional Kraken/OpenAI overrides

Important deployment notes:

- the password gate is enforced both in middleware and server-side route/page checks
- the current read-only assistant workflow works on Vercel
- markdown persistence for ignored suggestions is not durable on Vercel serverless storage
- browser `localStorage` still preserves ignored suggestions for that browser
- long-running automation or background bot runners are not a good fit for Vercel serverless hosting

## Legacy and inactive parts of the repository

This repository still contains older exchange/bot-oriented code and some legacy environment parsing.

That code is not the active product surface right now.

In particular:

- Google Sheets is not part of the current user workflow
- the automation area is intentionally a placeholder
- `/api/bot/*` endpoints return `410 Gone`

## Verification

Useful checks:

```bash
npm run lint
npm test
npm run build
```
