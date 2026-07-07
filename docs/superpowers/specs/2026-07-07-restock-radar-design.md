# Restock Radar — Design Spec

**Date:** 2026-07-07
**Status:** Approved pending user review
**Owner:** Jasmine (GitHub: Jas-02)

## Purpose

A free, zero-maintenance utility for tracking watch product pages that are
usually out of stock. Paste a product URL into a small web app; when the
product comes back in stock, both configured email addresses get an alert.

This is a standalone hobby project. It lives in its own public repo on the
`Jas-02` personal GitHub account and shares nothing with any other project.

## Constraints (agreed with user)

- **Cost:** $0. No paid services, no new paid accounts.
- **Infrastructure:** GitHub only — public repo, GitHub Pages, GitHub Actions.
- **Email:** Gmail SMTP with an app password (user's own Gmail). Explicitly
  NOT the Resend account used elsewhere.
- **Sites:** Arbitrary/mixed product URLs (brand stores, Indian retailers,
  marketplaces). Best-effort monitoring; unsupported sites must be visibly
  flagged, never silently ignored.
- **Repo visibility:** Public is accepted (watch URLs visible; credentials in
  encrypted Actions secrets).

## Architecture

One public repo, `Jas-02/restock-radar`, containing three cooperating parts:

```
restock-radar/
├── docs/                       # GitHub Pages site (web app)
│   ├── index.html              # single-page app, plain HTML/CSS/JS
│   └── superpowers/specs/      # design docs (this file; public, that's fine)
├── data/
│   ├── watchlist.json          # what to watch (written by web app)
│   └── state.json              # last known status per item (written by checker)
├── src/
│   ├── check.js                # entry point run by the Action
│   ├── detect.js               # stock-detection heuristics (pure functions)
│   └── notify.js               # Gmail SMTP email sending
├── test/
│   ├── fixtures/               # saved real HTML pages
│   └── detect.test.js          # unit tests for detection
└── .github/workflows/check.yml # cron schedule (~every 10 min)
```

Runtime: Node.js 20+. Dependencies kept minimal: `nodemailer` for SMTP;
native `fetch` for HTTP; Node's built-in test runner (`node --test`).

## Component 1: Web app (GitHub Pages)

A single static page served from `docs/` on the `main` branch.

**Features:**
- Paste product URL + optional nickname → **Add** appends to
  `data/watchlist.json` via the GitHub Contents API.
- List all watched items with: nickname (or hostname), current status badge
  (**In stock / Out of stock / Unknown / Can't monitor**), detected price if
  any, last-checked time, link to product, **Remove** button.
- Status data read from the public raw URL of `data/state.json` (no auth
  needed for reading).
- Pause/resume a watch (sets `active: false` instead of deleting).

**Auth:** a fine-grained personal access token (PAT) scoped to only this
repo with Contents read/write permission. Entered once per device, stored in
`localStorage`. Both users can share one token or use their own. The page
shows a small setup screen when no token is stored.

**Write-conflict handling:** writes use the Contents API `sha` field; on a
409/conflict the app re-fetches and retries once, then asks the user to
retry.

**No framework, no build step** — one HTML file with inline CSS/JS.

## Component 2: Data files

`data/watchlist.json`:
```json
{
  "items": [
    {
      "id": "a1b2c3",            // short random id
      "url": "https://…",
      "label": "Seiko Alpinist",  // optional user nickname
      "active": true,
      "addedAt": "2026-07-07T12:00:00Z"
    }
  ]
}
```

`data/state.json` (checker-owned; keyed by item id):
```json
{
  "a1b2c3": {
    "status": "OUT_OF_STOCK",     // IN_STOCK | OUT_OF_STOCK | UNKNOWN | BLOCKED
    "price": "₹34,500",           // optional, when detectable
    "lastCheckedAt": "…",
    "lastChangedAt": "…",
    "consecutiveErrors": 0,
    "notifiedInStock": false,      // anti-repeat flag
    "notifiedBlocked": false       // one-time can't-monitor warning sent
  }
}
```

## Component 3: Checker (GitHub Actions)

**Schedule:** cron `*/10 * * * *` (GitHub jitter means real-world every
10–20 min; accepted limitation). Also `workflow_dispatch` for manual runs.

**Per run:** for each `active` watchlist item —
1. Fetch the page with browser-like headers (realistic User-Agent,
   Accept-Language), 15 s timeout.
2. Determine status via detection layers (see below).
3. Compare with previous state; on **transition to IN_STOCK** (from
   OUT_OF_STOCK or UNKNOWN) with `notifiedInStock: false` → send alert
   email, set `notifiedInStock: true`.
4. When status leaves IN_STOCK → reset `notifiedInStock: false` (so the
   next restock alerts again).
5. HTTP 403/429/blocked or fetch failure → increment `consecutiveErrors`;
   after 3 consecutive failures mark **BLOCKED** and send a one-time
   "can't monitor this link" email (`notifiedBlocked: true`). A later
   successful check resets errors and the flag.
6. Write `state.json` back with a `[skip ci]` commit (only if changed).

Items are checked sequentially with a short delay (1–2 s) between requests;
per-item try/catch so one bad site never kills the run. First-ever check of
an item establishes a baseline and never notifies.

## Component 4: Stock detection (`detect.js`)

Layered, first conclusive answer wins; pure functions over fetched HTML so
they're unit-testable:

1. **JSON-LD structured data** — parse `<script type="application/ld+json">`
   blocks; look for schema.org `Product`/`Offer` `availability`
   (`InStock`, `OutOfStock`, `SoldOut`, `PreOrder`…). Most reliable signal;
   also yields price.
2. **Shopify product JSON** — if the page looks like Shopify, fetch
   `<product-url>.js` (Shopify's public product endpoint) and read
   `available` / `variants[].available`. Many watch microbrands are Shopify.
3. **Text heuristics** — case-insensitive search of visible page text/buttons.
   Negative signals: "sold out", "out of stock", "notify me", "email when
   available", "currently unavailable". Positive signals: "add to cart",
   "add to bag", "buy now", "in stock". Negative signals win over positive
   when both present (sold-out pages often keep a disabled add-to-cart).
4. Nothing conclusive → **UNKNOWN** (shown in UI; treated like
   OUT_OF_STOCK for transition purposes so a later clear IN_STOCK still
   alerts).

## Component 5: Notifications (`notify.js`)

- Gmail SMTP (`smtp.gmail.com:465`) via `nodemailer`.
- Secrets (GitHub Actions encrypted secrets): `GMAIL_USER`,
  `GMAIL_APP_PASSWORD`, `NOTIFY_TO` (comma-separated list — both emails).
- **In-stock email:** subject `🎉 Back in stock: <label>`; body has label,
  price if known, big product link, and the time detected.
- **Blocked email (one-time per item):** explains the site can't be
  monitored automatically and suggests checking it manually.

## Error handling summary

| Failure | Behaviour |
|---|---|
| One site down/blocked | Item marked, others unaffected |
| 3+ consecutive item failures | BLOCKED + one-time warning email |
| Gmail send failure | Action logs error, run fails visibly in repo Actions tab; state not marked notified (retried next run) |
| watchlist.json edit conflict (web app) | sha-based retry once, then user-visible error |
| Malformed watchlist entry | Skipped with log, never crashes run |

## Testing

- **Unit:** `detect.js` against saved fixtures — a Shopify in-stock page, a
  JSON-LD out-of-stock page, a text-heuristics-only page, a bot-block page.
  Run with `node --test`; also run in CI on push.
- **End-to-end (manual, before done):** add a real watch URL through the
  deployed web app, trigger the workflow manually, verify state badge
  updates and a test email arrives (temporarily point at an in-stock
  product to force the transition path).

## Out of scope (YAGNI)

- WhatsApp/Telegram/push channels
- Price-drop alerts (status only; price is display-only)
- Headless-browser fallback (revisit only if too many BLOCKED links)
- Multi-user accounts/auth beyond the shared PAT
- Any connection to other projects or paid infrastructure

## User setup checklist (post-implementation)

1. Create Gmail app password (2FA required on the Google account).
2. Add the three repo secrets.
3. Create a fine-grained PAT (this repo only, Contents read/write) and
   paste it into the web app once per device.
4. Enable GitHub Pages (main branch, `/docs` folder).
