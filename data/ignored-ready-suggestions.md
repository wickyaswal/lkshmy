# Ignored READY Suggestion Notifications

This markdown file acts as a local database for READY suggestions that the user suppressed in the Assistant UI.
When the app runs on a writable local filesystem, suppression changes are persisted here.

```json
[
  {
    "id": "asset-XRP|XRP|XRPUSD|SELL|READY|TRAILING_STOP_LIMIT|XRP is below the recent buy anchor.",
    "suggestionKey": "asset-XRP",
    "asset": "XRP",
    "marketPair": "XRPUSD",
    "side": "SELL",
    "status": "READY",
    "primaryOrderType": "TRAILING_STOP_LIMIT",
    "headline": "XRP is below the recent buy anchor.",
    "ignoredAt": "2026-03-06T13:40:45.710Z"
  }
]
```
