# ⌚ Restock Radar

Free watch-restock notifier. Paste product links into the
[web app](https://jas-02.github.io/restock-radar/); a GitHub Action checks
them every ~10–20 minutes and emails when something comes back in stock.

## How it works

- `docs/index.html` — web app (GitHub Pages) that edits `data/watchlist.json`
  via the GitHub API using your fine-grained token.
- `.github/workflows/check.yml` — cron job runs `src/check.js`: fetches each
  page, detects stock (JSON-LD → Shopify product JSON → text patterns),
  emails on the out-of-stock → in-stock transition, commits `data/state.json`.
- Statuses: **In stock / Out of stock / Unknown / Can't monitor** (a site that
  blocks 3 checks in a row is marked Can't monitor and you get one heads-up
  email; Amazon/Flipkart often do this).

## One-time setup

1. **Gmail app password** — Google Account → Security → 2-Step Verification
   (must be on) → App passwords → create one for "Mail".
2. **Repo secrets** (Settings → Secrets and variables → Actions):
   - `GMAIL_USER` — your Gmail address
   - `GMAIL_APP_PASSWORD` — the app password from step 1
   - `NOTIFY_TO` — comma-separated recipient emails (both of you)
3. **Fine-grained token for the web app** — GitHub → Settings → Developer
   settings → Fine-grained tokens → generate; Repository access: *only*
   `restock-radar`; Permissions: Contents → Read and write. Paste it into the
   web app once per device.

## Development

```bash
npm install
npm test          # unit tests (node --test)
node src/check.js # one manual check run (needs env vars to actually email)
```
