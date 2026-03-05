# Fiat Buffer Trading - Manual Assistant Phase

This phase runs a deterministic manual-trading assistant for Kraken.

## Current scope

- `Assistant` tab:
  - deterministic BUY/WAIT suggestions (no AI calls)
  - live Kraken ticker feed (WebSocket)
  - MA-based signal checks from Kraken OHLC REST data
  - read-only manual autopilot monitoring (TP / SL / time stop alerts)
  - browser notifications for exit alerts
- `Automation` tab:
  - placeholder for later phase automation features

## Explicitly disabled in this phase

- Google Sheets integrations
- auto-trading execution (no place/cancel orders)
- OpenAI/LLM suggestion generation

Legacy automation API routes now return `410 Gone`.

## Environment variables

Use `.env.local`:

```bash
KRAKEN_API_KEY=
KRAKEN_API_SECRET=
KRAKEN_REST_BASE_URL=https://api.kraken.com
KRAKEN_WS_URL=wss://ws.kraken.com

BOT_TIMEZONE=Europe/Amsterdam
```

Kraken keys are optional for Assistant.
- Without keys: manual position fallback mode is available.
- With keys: account state is read in authenticated **read-only** mode.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tests

```bash
npm test
```

## Safety model

- Trade suggestions are deterministic code-based outputs.
- The app never places or cancels orders in this phase.
- Manual execution remains with the user on Kraken.
