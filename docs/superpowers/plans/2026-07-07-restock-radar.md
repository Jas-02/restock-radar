# Restock Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free GitHub-only utility: paste watch product URLs into a GitHub Pages web app; a scheduled GitHub Action checks stock every ~10 min and emails (Gmail SMTP) when an item comes back in stock.

**Architecture:** One public repo `Jas-02/restock-radar`. Static single-file web app on GitHub Pages writes `data/watchlist.json` via the GitHub Contents API. A cron GitHub Action runs `src/check.js`, which detects stock via layered heuristics (JSON-LD → Shopify product JSON → text patterns), applies pure transition rules, sends Gmail alerts, and commits `data/state.json` back.

**Tech Stack:** Node.js 20+ (ESM, native `fetch`, `node --test`), `nodemailer` (only dependency), plain HTML/CSS/JS web app (no framework, no build step), GitHub Actions + Pages.

## Global Constraints

- Cost: $0 — GitHub free tier + Gmail SMTP app password only. No other services.
- Standalone hobby project at `/Users/jasminechourasiya/restock-radar`; repo `Jas-02/restock-radar` (public) on the personal account. Never touch `~/uxoverflow`.
- Only npm dependency allowed: `nodemailer`. Tests use Node's built-in runner (`node --test`), no test framework.
- `package.json` has `"type": "module"` — all Node code is ESM.
- Statuses everywhere are exactly: `IN_STOCK`, `OUT_OF_STOCK`, `UNKNOWN`, `BLOCKED`. UI labels: "In stock", "Out of stock", "Unknown", "Can't monitor".
- Notify only on *transition* to IN_STOCK; first-ever check of an item never notifies; BLOCKED warning email at 3 consecutive failures, once per blocked episode.
- Secrets (`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_TO`) live only in GitHub Actions encrypted secrets / local env — never in code or committed files.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `data/watchlist.json`
- Create: `data/state.json`

**Interfaces:**
- Consumes: nothing (first task; git repo already initialized with spec committed).
- Produces: `npm test` runs Node's test runner over `test/`; `data/watchlist.json` shape `{"items": []}`; `data/state.json` shape `{}`. All later tasks rely on `"type": "module"`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "restock-radar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "check": "node src/check.js"
  },
  "dependencies": {
    "nodemailer": "^6.9.14"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 3: Write seed data files**

`data/watchlist.json`:
```json
{
  "items": []
}
```

`data/state.json`:
```json
{}
```

- [ ] **Step 4: Install and sanity-check**

Run: `cd /Users/jasminechourasiya/restock-radar && npm install && mkdir -p test && npm test`
Expected: install succeeds; `npm test` exits 0 with no tests found (empty `test/` dir is fine — it prints a summary with `tests 0`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore data/
git commit -m "chore: scaffold project (npm, seed data files)"
```

---

### Task 2: JSON-LD stock detection

**Files:**
- Create: `src/detect.js`
- Create: `test/fixtures/jsonld-in-stock.html`
- Create: `test/fixtures/jsonld-out-of-stock.html`
- Test: `test/detect-jsonld.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: from `src/detect.js` — status constants `IN_STOCK`, `OUT_OF_STOCK`, `UNKNOWN`, `BLOCKED` (strings equal to their names) and `jsonLdAvailability(html: string) → {status, price?: string} | null`. Returns `null` when no conclusive JSON-LD availability found.

- [ ] **Step 1: Write fixtures**

`test/fixtures/jsonld-in-stock.html`:
```html
<!doctype html>
<html><head><title>Field Watch 38mm</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Field Watch 38mm",
  "offers": {
    "@type": "Offer",
    "price": "34500",
    "priceCurrency": "INR",
    "availability": "https://schema.org/InStock"
  }
}
</script>
</head><body><h1>Field Watch 38mm</h1></body></html>
```

`test/fixtures/jsonld-out-of-stock.html`:
```html
<!doctype html>
<html><head><title>Diver 200m</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "name": "Watch Store" },
    {
      "@type": "Product",
      "name": "Diver 200m",
      "offers": [
        { "@type": "Offer", "price": 21999, "priceCurrency": "INR", "availability": "http://schema.org/OutOfStock" }
      ]
    }
  ]
}
</script>
</head><body><h1>Diver 200m</h1><button>Add to cart</button></body></html>
```
(Note the out-of-stock fixture deliberately contains "Add to cart" text — JSON-LD must win over text.)

- [ ] **Step 2: Write the failing tests**

`test/detect-jsonld.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsonLdAvailability, IN_STOCK, OUT_OF_STOCK } from '../src/detect.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('reads InStock availability and price from JSON-LD', () => {
  assert.deepEqual(jsonLdAvailability(fx('jsonld-in-stock.html')), {
    status: IN_STOCK,
    price: 'INR 34500',
  });
});

test('reads OutOfStock from @graph with offers array (http scheme)', () => {
  assert.deepEqual(jsonLdAvailability(fx('jsonld-out-of-stock.html')), {
    status: OUT_OF_STOCK,
    price: 'INR 21999',
  });
});

test('returns null when there is no JSON-LD', () => {
  assert.equal(jsonLdAvailability('<html><body>hello</body></html>'), null);
});

test('returns null on malformed JSON-LD instead of throwing', () => {
  const html = '<script type="application/ld+json">{not json</script>';
  assert.equal(jsonLdAvailability(html), null);
});

test('handles bare availability values without URL prefix', () => {
  const html = `<script type="application/ld+json">
    {"@type":"Product","offers":{"availability":"InStock"}}
  </script>`;
  assert.deepEqual(jsonLdAvailability(html), { status: IN_STOCK, price: undefined });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/detect.js'` (or similar) for all 5 tests.

- [ ] **Step 4: Write the implementation**

`src/detect.js`:
```js
export const IN_STOCK = 'IN_STOCK';
export const OUT_OF_STOCK = 'OUT_OF_STOCK';
export const UNKNOWN = 'UNKNOWN';
export const BLOCKED = 'BLOCKED';

// schema.org availability → status. PreOrder/PreSale count as buyable.
const AVAILABILITY_MAP = {
  instock: IN_STOCK,
  instoreonly: IN_STOCK,
  onlineonly: IN_STOCK,
  limitedavailability: IN_STOCK,
  presale: IN_STOCK,
  preorder: IN_STOCK,
  backorder: OUT_OF_STOCK,
  outofstock: OUT_OF_STOCK,
  soldout: OUT_OF_STOCK,
  discontinued: OUT_OF_STOCK,
};

export function jsonLdAvailability(html) {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const [, raw] of blocks) {
    let data;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    for (const node of flattenNodes(data)) {
      if (!isProduct(node)) continue;
      for (const offer of [].concat(node.offers ?? [])) {
        const key = String(offer?.availability ?? '').split('/').pop().toLowerCase();
        const status = AVAILABILITY_MAP[key];
        if (status) {
          const price =
            offer.price != null
              ? `${offer.priceCurrency ?? ''} ${offer.price}`.trim()
              : undefined;
          return { status, price };
        }
      }
    }
  }
  return null;
}

function flattenNodes(data) {
  if (Array.isArray(data)) return data.flatMap(flattenNodes);
  if (data && typeof data === 'object') {
    return [data, ...flattenNodes(data['@graph'] ?? [])];
  }
  return [];
}

function isProduct(node) {
  return [].concat(node['@type'] ?? []).some(
    (t) => String(t).toLowerCase() === 'product'
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/detect.js test/
git commit -m "feat: JSON-LD availability detection"
```

---

### Task 3: Shopify stock detection

**Files:**
- Modify: `src/detect.js` (append)
- Create: `test/fixtures/shopify-page.html`
- Test: `test/detect-shopify.test.js`

**Interfaces:**
- Consumes: `IN_STOCK`, `OUT_OF_STOCK` constants from Task 2.
- Produces: `isShopifyPage(html: string) → boolean`; `shopifyProductJsonUrl(pageUrl: string) → string | null` (the `<product-url>.js` endpoint, or null if the URL has no `/products/<handle>` path); `shopifyAvailability(productJson: object) → {status, price?: string} | null` (price is store-currency units as a plain number string, e.g. `"345.00"`; Shopify's `.js` endpoint reports cents).

- [ ] **Step 1: Write fixture**

`test/fixtures/shopify-page.html`:
```html
<!doctype html>
<html><head><title>Microbrand Diver</title>
<link rel="preconnect" href="https://cdn.shopify.com">
<script src="https://cdn.shopify.com/s/files/1/0001/assets/theme.js"></script>
</head><body><h1>Microbrand Diver</h1></body></html>
```

- [ ] **Step 2: Write the failing tests**

`test/detect-shopify.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isShopifyPage,
  shopifyProductJsonUrl,
  shopifyAvailability,
  IN_STOCK,
  OUT_OF_STOCK,
} from '../src/detect.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('recognises a Shopify page by cdn.shopify.com', () => {
  assert.equal(isShopifyPage(fx('shopify-page.html')), true);
  assert.equal(isShopifyPage('<html><body>plain store</body></html>'), false);
});

test('builds the product .js URL from a product page URL', () => {
  assert.equal(
    shopifyProductJsonUrl('https://store.com/products/diver-2?variant=123'),
    'https://store.com/products/diver-2.js'
  );
  assert.equal(
    shopifyProductJsonUrl('https://store.com/en-in/products/diver-2/'),
    'https://store.com/en-in/products/diver-2.js'
  );
  assert.equal(shopifyProductJsonUrl('https://store.com/pages/about'), null);
});

test('reads availability and price from Shopify product JSON', () => {
  assert.deepEqual(
    shopifyAvailability({ available: true, price: 34500, variants: [] }),
    { status: IN_STOCK, price: '345.00' }
  );
  assert.deepEqual(
    shopifyAvailability({ available: false, variants: [{ price: 21999 }] }),
    { status: OUT_OF_STOCK, price: '219.99' }
  );
  assert.equal(shopifyAvailability({ title: 'no available field' }), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the three new tests fail with "isShopifyPage is not a function" (or not exported); the 5 Task-2 tests still pass.

- [ ] **Step 4: Append implementation to `src/detect.js`**

```js
export function isShopifyPage(html) {
  return /cdn\.shopify\.com|Shopify\.theme|shopify-digital-wallet/i.test(html);
}

export function shopifyProductJsonUrl(pageUrl) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  const m = u.pathname.match(/^(.*\/products\/[^/]+?)\/?$/);
  return m ? `${u.origin}${m[1]}.js` : null;
}

export function shopifyAvailability(product) {
  if (typeof product?.available !== 'boolean') return null;
  const cents = typeof product.price === 'number' ? product.price : product.variants?.[0]?.price;
  return {
    status: product.available ? IN_STOCK : OUT_OF_STOCK,
    price: typeof cents === 'number' ? (cents / 100).toFixed(2) : undefined,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/detect.js test/
git commit -m "feat: Shopify product JSON detection"
```

---

### Task 4: Text-heuristics detection

**Files:**
- Modify: `src/detect.js` (append)
- Create: `test/fixtures/text-sold-out.html`
- Test: `test/detect-text.test.js`

**Interfaces:**
- Consumes: `IN_STOCK`, `OUT_OF_STOCK` from Task 2.
- Produces: `textHeuristics(html: string) → {status} | null` — never returns a price; `null` means no signal (caller treats as UNKNOWN). Negative signals always win over positive ones.

- [ ] **Step 1: Write fixture**

`test/fixtures/text-sold-out.html`:
```html
<!doctype html>
<html><head><title>Chrono GMT</title></head>
<body>
  <h1>Chrono GMT</h1>
  <button disabled>Add to cart</button>
  <p class="badge">Sold out</p>
  <a href="#">Notify me when available</a>
</body></html>
```

- [ ] **Step 2: Write the failing tests**

`test/detect-text.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHeuristics, IN_STOCK, OUT_OF_STOCK } from '../src/detect.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('negative signals win even when add-to-cart text is present', () => {
  assert.deepEqual(textHeuristics(fx('text-sold-out.html')), { status: OUT_OF_STOCK });
});

test('detects in-stock from buy buttons', () => {
  assert.deepEqual(textHeuristics('<button>Add to Cart</button>'), { status: IN_STOCK });
  assert.deepEqual(textHeuristics('<a>BUY NOW</a>'), { status: IN_STOCK });
});

test('detects common out-of-stock phrases', () => {
  for (const phrase of ['Sold Out', 'out of stock', 'Currently unavailable', 'Email when available']) {
    assert.deepEqual(textHeuristics(`<p>${phrase}</p>`), { status: OUT_OF_STOCK }, phrase);
  }
});

test('returns null when no signals exist', () => {
  assert.equal(textHeuristics('<html><body><h1>A watch</h1></body></html>'), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — new tests fail ("textHeuristics is not a function"); previous 8 pass.

- [ ] **Step 4: Append implementation to `src/detect.js`**

```js
const NEGATIVE_SIGNALS = [
  'sold out',
  'sold-out',
  'out of stock',
  'out-of-stock',
  'notify me when',
  'email when available',
  'back in stock soon',
  'currently unavailable',
];

const POSITIVE_SIGNALS = ['add to cart', 'add to bag', 'add to basket', 'buy now', 'in stock'];

export function textHeuristics(html) {
  const text = html.toLowerCase();
  if (NEGATIVE_SIGNALS.some((p) => text.includes(p))) return { status: OUT_OF_STOCK };
  if (POSITIVE_SIGNALS.some((p) => text.includes(p))) return { status: IN_STOCK };
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 12 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/detect.js test/
git commit -m "feat: text-pattern stock heuristics"
```

---

### Task 5: Transition engine

**Files:**
- Create: `src/transitions.js`
- Test: `test/transitions.test.js`

**Interfaces:**
- Consumes: status constants from `src/detect.js`.
- Produces: `MAX_ERRORS = 3` and `applyCheck(prev, result, now) → { state, notifications }` where:
  - `prev`: previous per-item state object or `undefined` (first-ever check)
  - `result`: `{ ok: true, status, price?: string }` or `{ ok: false }`
  - `now`: ISO timestamp string
  - `state`: `{ status, price?, lastCheckedAt, lastChangedAt, consecutiveErrors, notifiedInStock, notifiedBlocked }`
  - `notifications`: array containing `'IN_STOCK'` and/or `'BLOCKED'` (usually empty)

- [ ] **Step 1: Write the failing tests**

`test/transitions.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheck, MAX_ERRORS } from '../src/transitions.js';

const NOW = '2026-07-07T12:00:00.000Z';
const ok = (status, price) => ({ ok: true, status, price });

test('first check establishes baseline and never notifies, even if in stock', () => {
  const { state, notifications } = applyCheck(undefined, ok('IN_STOCK', 'INR 34500'), NOW);
  assert.deepEqual(notifications, []);
  assert.equal(state.status, 'IN_STOCK');
  assert.equal(state.notifiedInStock, true); // guarded so later flapping can't re-alert
  assert.equal(state.lastCheckedAt, NOW);
  assert.equal(state.lastChangedAt, NOW);
});

test('OUT_OF_STOCK → IN_STOCK notifies once', () => {
  const prev = applyCheck(undefined, ok('OUT_OF_STOCK'), NOW).state;
  const { state, notifications } = applyCheck(prev, ok('IN_STOCK'), NOW);
  assert.deepEqual(notifications, ['IN_STOCK']);
  assert.equal(state.notifiedInStock, true);
  // still in stock next run → no repeat
  const again = applyCheck(state, ok('IN_STOCK'), NOW);
  assert.deepEqual(again.notifications, []);
});

test('UNKNOWN → IN_STOCK also notifies', () => {
  const prev = applyCheck(undefined, ok('UNKNOWN'), NOW).state;
  const { notifications } = applyCheck(prev, ok('IN_STOCK'), NOW);
  assert.deepEqual(notifications, ['IN_STOCK']);
});

test('leaving IN_STOCK resets the flag so the next restock alerts again', () => {
  let s = applyCheck(undefined, ok('OUT_OF_STOCK'), NOW).state;
  s = applyCheck(s, ok('IN_STOCK'), NOW).state;          // notified
  s = applyCheck(s, ok('OUT_OF_STOCK'), NOW).state;       // sold out again
  assert.equal(s.notifiedInStock, false);
  const { notifications } = applyCheck(s, ok('IN_STOCK'), NOW);
  assert.deepEqual(notifications, ['IN_STOCK']);
});

test('errors accumulate; 3rd consecutive error → BLOCKED with one-time notification', () => {
  let s = applyCheck(undefined, ok('OUT_OF_STOCK'), NOW).state;
  let r = applyCheck(s, { ok: false }, NOW);
  assert.equal(r.state.consecutiveErrors, 1);
  assert.equal(r.state.status, 'OUT_OF_STOCK'); // keeps last known status
  assert.deepEqual(r.notifications, []);
  r = applyCheck(r.state, { ok: false }, NOW);
  assert.equal(r.state.consecutiveErrors, 2);
  r = applyCheck(r.state, { ok: false }, NOW);
  assert.equal(r.state.status, 'BLOCKED');
  assert.deepEqual(r.notifications, ['BLOCKED']);
  // stays blocked, but no second email
  r = applyCheck(r.state, { ok: false }, NOW);
  assert.equal(r.state.status, 'BLOCKED');
  assert.deepEqual(r.notifications, []);
  assert.equal(MAX_ERRORS, 3);
});

test('a successful check recovers from BLOCKED and re-arms the blocked email', () => {
  let s = { status: 'BLOCKED', consecutiveErrors: 5, notifiedInStock: false, notifiedBlocked: true, lastCheckedAt: NOW, lastChangedAt: NOW };
  const r = applyCheck(s, ok('OUT_OF_STOCK'), NOW);
  assert.equal(r.state.status, 'OUT_OF_STOCK');
  assert.equal(r.state.consecutiveErrors, 0);
  assert.equal(r.state.notifiedBlocked, false);
});

test('successful check keeps previous price when new one is missing', () => {
  let s = applyCheck(undefined, ok('OUT_OF_STOCK', 'INR 21999'), NOW).state;
  s = applyCheck(s, ok('OUT_OF_STOCK'), NOW).state;
  assert.equal(s.price, 'INR 21999');
});

test('lastChangedAt only moves when status changes', () => {
  const T1 = '2026-07-07T12:00:00.000Z';
  const T2 = '2026-07-07T12:10:00.000Z';
  const T3 = '2026-07-07T12:20:00.000Z';
  let s = applyCheck(undefined, ok('OUT_OF_STOCK'), T1).state;
  s = applyCheck(s, ok('OUT_OF_STOCK'), T2).state;
  assert.equal(s.lastChangedAt, T1);
  assert.equal(s.lastCheckedAt, T2);
  s = applyCheck(s, ok('IN_STOCK'), T3).state;
  assert.equal(s.lastChangedAt, T3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/transitions.js'`; the 12 detect tests still pass.

- [ ] **Step 3: Write the implementation**

`src/transitions.js`:
```js
import { IN_STOCK, UNKNOWN, BLOCKED } from './detect.js';

export const MAX_ERRORS = 3;

// Pure transition function. See test/transitions.test.js for the full contract.
export function applyCheck(prev, result, now) {
  const notifications = [];

  if (!result.ok) {
    const consecutiveErrors = (prev?.consecutiveErrors ?? 0) + 1;
    const state = {
      status: prev?.status ?? UNKNOWN,
      price: prev?.price,
      lastCheckedAt: now,
      lastChangedAt: prev?.lastChangedAt ?? now,
      consecutiveErrors,
      notifiedInStock: prev?.notifiedInStock ?? false,
      notifiedBlocked: prev?.notifiedBlocked ?? false,
    };
    if (consecutiveErrors >= MAX_ERRORS && state.status !== BLOCKED) {
      state.status = BLOCKED;
      state.lastChangedAt = now;
      if (!state.notifiedBlocked) {
        notifications.push('BLOCKED');
        state.notifiedBlocked = true;
      }
    }
    return { state, notifications };
  }

  const state = {
    status: result.status,
    price: result.price ?? prev?.price,
    lastCheckedAt: now,
    lastChangedAt: prev && prev.status === result.status ? prev.lastChangedAt : now,
    consecutiveErrors: 0,
    notifiedInStock: prev?.notifiedInStock ?? false,
    notifiedBlocked: false,
  };

  if (result.status === IN_STOCK) {
    if (prev === undefined) {
      state.notifiedInStock = true; // baseline: never notify on first check
    } else if (!state.notifiedInStock) {
      notifications.push('IN_STOCK');
      state.notifiedInStock = true;
    }
  } else {
    state.notifiedInStock = false;
  }

  return { state, notifications };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 20 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/transitions.js test/transitions.test.js
git commit -m "feat: pure state-transition engine with notification rules"
```

---

### Task 6: Email building and sending

**Files:**
- Create: `src/notify.js`
- Test: `test/notify.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (item objects come from `watchlist.json`: `{id, url, label?, active, addedAt}`).
- Produces: `buildInStockEmail(item, price, detectedAt) → {subject, text}`; `buildBlockedEmail(item) → {subject, text}`; `sendEmail({subject, text}, env = process.env) → Promise<void>` using Gmail SMTP with `env.GMAIL_USER`, `env.GMAIL_APP_PASSWORD`, `env.NOTIFY_TO` (comma-separated recipients).

- [ ] **Step 1: Write the failing tests** (builders only — `sendEmail` is a thin nodemailer wrapper verified in the manual E2E of Task 10)

`test/notify.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInStockEmail, buildBlockedEmail } from '../src/notify.js';

const item = { id: 'a1', url: 'https://store.com/products/diver', label: 'Seiko Alpinist', active: true };

test('in-stock email has celebratory subject, link, price and time', () => {
  const { subject, text } = buildInStockEmail(item, 'INR 34500', '2026-07-07T12:00:00.000Z');
  assert.equal(subject, '🎉 Back in stock: Seiko Alpinist');
  assert.match(text, /https:\/\/store\.com\/products\/diver/);
  assert.match(text, /INR 34500/);
  assert.match(text, /2026-07-07T12:00:00\.000Z/);
});

test('falls back to hostname when there is no label, and omits missing price', () => {
  const { subject, text } = buildInStockEmail({ url: 'https://store.com/products/diver' }, undefined, '2026-07-07T12:00:00.000Z');
  assert.equal(subject, '🎉 Back in stock: store.com');
  assert.doesNotMatch(text, /price/i);
});

test('blocked email explains the situation and links the product', () => {
  const { subject, text } = buildBlockedEmail(item);
  assert.equal(subject, "⚠️ Can't monitor: Seiko Alpinist");
  assert.match(text, /https:\/\/store\.com\/products\/diver/);
  assert.match(text, /manually/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/notify.js'`; 20 earlier tests pass.

- [ ] **Step 3: Write the implementation**

`src/notify.js`:
```js
import nodemailer from 'nodemailer';

function displayName(item) {
  if (item.label) return item.label;
  try {
    return new URL(item.url).hostname;
  } catch {
    return item.url;
  }
}

export function buildInStockEmail(item, price, detectedAt) {
  const name = displayName(item);
  return {
    subject: `🎉 Back in stock: ${name}`,
    text: [
      `${name} looks IN STOCK right now${price ? ` (price: ${price})` : ''}.`,
      '',
      `Go go go: ${item.url}`,
      '',
      `Detected at ${detectedAt} by Restock Radar.`,
    ].join('\n'),
  };
}

export function buildBlockedEmail(item) {
  const name = displayName(item);
  return {
    subject: `⚠️ Can't monitor: ${name}`,
    text: [
      `Restock Radar failed to check ${name} three times in a row — the site is probably blocking automated checks.`,
      '',
      `You'll need to watch this one manually: ${item.url}`,
      '',
      `It stays on the list; if checks start working again it resumes automatically.`,
    ].join('\n'),
  };
}

export async function sendEmail({ subject, text }, env = process.env) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `Restock Radar <${env.GMAIL_USER}>`,
    to: env.NOTIFY_TO,
    subject,
    text,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 23 tests pass. (Note the second test's `doesNotMatch /price/i` is why the price clause is only added when a price exists.)

- [ ] **Step 5: Commit**

```bash
git add src/notify.js test/notify.test.js
git commit -m "feat: Gmail notification emails (builders + SMTP sender)"
```

---

### Task 7: Checker orchestrator

**Files:**
- Create: `src/check.js`
- Test: `test/check.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2–6 (`jsonLdAvailability`, `isShopifyPage`, `shopifyProductJsonUrl`, `shopifyAvailability`, `textHeuristics`, `UNKNOWN`, `applyCheck`, `buildInStockEmail`, `buildBlockedEmail`, `sendEmail`).
- Produces: `checkItem(item, fetchFn = fetch) → Promise<{ok: true, status, price?} | {ok: false}>` and `run({fetchFn, send, dataDir, delayMs} = {}) → Promise<void>`; `dataDir` is a `file://` URL ending in `/` (defaults to the repo's `data/` dir); `delayMs` defaults to 1500 (tests pass 0). Running `node src/check.js` executes `run()`.

- [ ] **Step 1: Write the failing tests**

`test/check.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkItem, run } from '../src/check.js';

const IN_STOCK_HTML = `<script type="application/ld+json">
  {"@type":"Product","offers":{"availability":"https://schema.org/InStock","price":"345","priceCurrency":"USD"}}
</script>`;

const htmlResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  json: async () => JSON.parse(body),
});

function tempDataDir(watchlist, state) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-'));
  writeFileSync(join(dir, 'watchlist.json'), JSON.stringify(watchlist));
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  return { dir, url: pathToFileURL(dir + '/') };
}

test('checkItem: JSON-LD page → IN_STOCK with price', async () => {
  const result = await checkItem({ url: 'https://x.com/p/1' }, async () => htmlResponse(IN_STOCK_HTML));
  assert.deepEqual(result, { ok: true, status: 'IN_STOCK', price: 'USD 345' });
});

test('checkItem: HTTP 403 → not ok', async () => {
  const result = await checkItem({ url: 'https://x.com/p/1' }, async () => htmlResponse('denied', 403));
  assert.deepEqual(result, { ok: false });
});

test('checkItem: fetch throwing → not ok', async () => {
  const result = await checkItem({ url: 'https://x.com/p/1' }, async () => { throw new Error('boom'); });
  assert.deepEqual(result, { ok: false });
});

test('checkItem: Shopify fallback fetches the product .js', async () => {
  const shopifyHtml = '<script src="https://cdn.shopify.com/theme.js"></script>';
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.endsWith('.js')) return htmlResponse(JSON.stringify({ available: false, price: 21999 }));
    return htmlResponse(shopifyHtml);
  };
  const result = await checkItem({ url: 'https://store.com/products/diver' }, fetchFn);
  assert.deepEqual(result, { ok: true, status: 'OUT_OF_STOCK', price: '219.99' });
  assert.deepEqual(calls, ['https://store.com/products/diver', 'https://store.com/products/diver.js']);
});

test('checkItem: no signals at all → UNKNOWN', async () => {
  const result = await checkItem({ url: 'https://x.com/p/1' }, async () => htmlResponse('<h1>watch</h1>'));
  assert.deepEqual(result, { ok: true, status: 'UNKNOWN', price: undefined });
});

test('run: emails on restock transition and persists state', async () => {
  const { dir, url } = tempDataDir(
    { items: [{ id: 'a1', url: 'https://x.com/p/1', label: 'Diver', active: true }] },
    { a1: { status: 'OUT_OF_STOCK', lastCheckedAt: 't', lastChangedAt: 't', consecutiveErrors: 0, notifiedInStock: false, notifiedBlocked: false } }
  );
  const sent = [];
  await run({ fetchFn: async () => htmlResponse(IN_STOCK_HTML), send: async (m) => sent.push(m), dataDir: url, delayMs: 0 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Back in stock: Diver/);
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.a1.status, 'IN_STOCK');
  assert.equal(state.a1.notifiedInStock, true);
});

test('run: paused items are skipped but keep their state', async () => {
  const prev = { status: 'OUT_OF_STOCK', lastCheckedAt: 't', lastChangedAt: 't', consecutiveErrors: 0, notifiedInStock: false, notifiedBlocked: false };
  const { dir, url } = tempDataDir(
    { items: [{ id: 'a1', url: 'https://x.com/p/1', active: false }] },
    { a1: prev }
  );
  let fetched = 0;
  await run({ fetchFn: async () => { fetched++; return htmlResponse(IN_STOCK_HTML); }, send: async () => {}, dataDir: url, delayMs: 0 });
  assert.equal(fetched, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).a1, prev);
});

test('run: removed items are pruned from state', async () => {
  const { dir, url } = tempDataDir({ items: [] }, { gone: { status: 'IN_STOCK' } });
  await run({ fetchFn: async () => htmlResponse(IN_STOCK_HTML), send: async () => {}, dataDir: url, delayMs: 0 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')), {});
});

test('run: email failure keeps notifiedInStock false and sets a failing exit code', async () => {
  const { dir, url } = tempDataDir(
    { items: [{ id: 'a1', url: 'https://x.com/p/1', active: true }] },
    { a1: { status: 'OUT_OF_STOCK', lastCheckedAt: 't', lastChangedAt: 't', consecutiveErrors: 0, notifiedInStock: false, notifiedBlocked: false } }
  );
  await run({ fetchFn: async () => htmlResponse(IN_STOCK_HTML), send: async () => { throw new Error('smtp down'); }, dataDir: url, delayMs: 0 });
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.a1.notifiedInStock, false); // retried next run
  assert.equal(process.exitCode, 1);
  process.exitCode = 0; // reset so the test run itself doesn't fail
});

test('run: malformed item (bad URL) is skipped without crashing the run', async () => {
  const { dir, url } = tempDataDir(
    { items: [
      { id: 'bad', url: 'not a url', active: true },
      { id: 'ok', url: 'https://x.com/p/1', active: true },
    ] },
    {}
  );
  await run({ fetchFn: async () => htmlResponse(IN_STOCK_HTML), send: async () => {}, dataDir: url, delayMs: 0 });
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.ok.status, 'IN_STOCK');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/check.js'`; 23 earlier tests pass.

- [ ] **Step 3: Write the implementation**

`src/check.js`:
```js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  jsonLdAvailability,
  isShopifyPage,
  shopifyProductJsonUrl,
  shopifyAvailability,
  textHeuristics,
  UNKNOWN,
} from './detect.js';
import { applyCheck } from './transitions.js';
import { buildInStockEmail, buildBlockedEmail, sendEmail } from './notify.js';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function checkItem(item, fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(item.url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };

  const html = await res.text();
  let result = jsonLdAvailability(html);

  if (!result && isShopifyPage(html)) {
    const jsonUrl = shopifyProductJsonUrl(item.url);
    if (jsonUrl) {
      try {
        const pRes = await fetchFn(jsonUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
        if (pRes.ok) result = shopifyAvailability(await pRes.json());
      } catch {
        // fall through to text heuristics
      }
    }
  }

  if (!result) result = textHeuristics(html);
  return { ok: true, status: result?.status ?? UNKNOWN, price: result?.price };
}

export async function run({
  fetchFn = fetch,
  send = sendEmail,
  dataDir = new URL('../data/', import.meta.url),
  delayMs = 1500,
} = {}) {
  const watchlist = JSON.parse(readFileSync(new URL('watchlist.json', dataDir), 'utf8'));
  const statePath = new URL('state.json', dataDir);
  let prevStates = {};
  try {
    prevStates = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    // missing/corrupt state: start fresh, every item re-baselines
  }

  const newStates = {};

  for (const item of watchlist.items) {
    try {
      if (!item.active) {
        if (prevStates[item.id]) newStates[item.id] = prevStates[item.id];
        continue;
      }
      const result = await checkItem(item, fetchFn);
      const now = new Date().toISOString();
      const { state, notifications } = applyCheck(prevStates[item.id], result, now);

      for (const kind of notifications) {
        const email =
          kind === 'IN_STOCK' ? buildInStockEmail(item, state.price, now) : buildBlockedEmail(item);
        try {
          await send(email);
          console.log(`notified ${kind}: ${item.label ?? item.url}`);
        } catch (err) {
          console.error(`email failed for ${item.url}: ${err.message}`);
          if (kind === 'IN_STOCK') state.notifiedInStock = false;
          else state.notifiedBlocked = false;
          process.exitCode = 1; // visible failure; flags stay unset so next run retries
        }
      }

      newStates[item.id] = state;
      console.log(`${state.status}  ${item.label ?? item.url}`);
    } catch (err) {
      console.error(`skipping item ${item?.id}: ${err.message}`);
      if (item?.id && prevStates[item.id]) newStates[item.id] = prevStates[item.id];
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }

  writeFileSync(statePath, JSON.stringify(newStates, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 33 tests pass.

- [ ] **Step 5: Smoke-run the CLI against the empty watchlist**

Run: `node src/check.js && cat data/state.json`
Expected: exits 0, prints nothing per-item, `data/state.json` is `{}`.

- [ ] **Step 6: Commit**

```bash
git add src/check.js test/check.test.js
git commit -m "feat: checker orchestrator wiring detection, transitions and email"
```

---

### Task 8: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/check.yml`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: `node src/check.js` entry point (Task 7); `npm test` (Task 1).
- Produces: scheduled checking with state commits tagged `[skip ci]`; CI tests on every push (the `[skip ci]` tag makes state commits skip CI automatically).

- [ ] **Step 1: Write `.github/workflows/check.yml`**

```yaml
name: Check stock

on:
  schedule:
    - cron: '*/10 * * * *'   # GitHub adds jitter; real-world every 10-20 min
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: check-stock
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Run checker
        env:
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          NOTIFY_TO: ${{ secrets.NOTIFY_TO }}
        run: node src/check.js
      - name: Commit updated state
        run: |
          git config user.name "restock-radar bot"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/state.json
          if git diff --cached --quiet; then
            echo "No state changes."
            exit 0
          fi
          git commit -m "chore: update stock state [skip ci]"
          git pull --rebase
          git push
```

- [ ] **Step 2: Write `.github/workflows/test.yml`**

```yaml
name: Tests

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
```

- [ ] **Step 3: Validate YAML parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/check.yml','utf8'); console.log('bytes:',y.length)" && npx --yes yaml-lint .github/workflows/check.yml .github/workflows/test.yml 2>/dev/null || node --input-type=module -e "console.log('yaml-lint unavailable, rely on GitHub validation')"`
Expected: no YAML errors (GitHub will also validate on push in Task 10; a failure shows in the Actions tab).

- [ ] **Step 4: Commit**

```bash
git add .github/
git commit -m "ci: scheduled stock checker and test workflows"
```

Note: if the checker step exits 1 (email failure), the commit step is skipped by the job failing — that is intended: `notifiedInStock` stays false in the repo, so the next run retries the email.

---

### Task 9: Web app (GitHub Pages)

**Files:**
- Create: `docs/index.html`

**Interfaces:**
- Consumes: `data/watchlist.json` shape (Task 1), `data/state.json` shape (Task 5 state objects keyed by item id), GitHub Contents API.
- Produces: the complete user-facing app at `https://jas-02.github.io/restock-radar/`.

- [ ] **Step 1: Write `docs/index.html`** (complete file)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Restock Radar</title>
<style>
  :root { color-scheme: light dark; --ok:#1a7f37; --bad:#b35900; --warn:#8250df; --blocked:#cf222e; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.4rem; }
  input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #8888; }
  button { cursor: pointer; background: #2da44e; color: #fff; border: none; }
  button.secondary { background: none; color: inherit; border: 1px solid #8888; }
  form { display: grid; gap: 8px; margin-bottom: 20px; }
  ul { list-style: none; padding: 0; display: grid; gap: 10px; }
  li { border: 1px solid #8884; border-radius: 10px; padding: 12px; display: grid; gap: 6px; }
  li.paused { opacity: .55; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge { font-size: .8rem; font-weight: 600; padding: 2px 10px; border-radius: 999px; color: #fff; }
  .IN_STOCK { background: var(--ok); } .OUT_OF_STOCK { background: var(--bad); }
  .UNKNOWN { background: var(--warn); } .BLOCKED { background: var(--blocked); } .NEW { background: #57606a; }
  .meta { font-size: .8rem; opacity: .7; }
  .actions button { font-size: .8rem; padding: 4px 10px; }
  #msg { min-height: 1.2em; font-size: .9rem; }
  #msg.error { color: var(--blocked); }
  a { color: inherit; }
</style>
</head>
<body>
<h1>⌚ Restock Radar</h1>

<section id="setup" hidden>
  <p>One-time setup: paste a fine-grained GitHub token with <strong>Contents read &amp; write</strong> access to <strong>only</strong> the <code>restock-radar</code> repo. It is stored only in this browser.</p>
  <form id="tokenForm">
    <input id="tokenInput" type="password" placeholder="github_pat_…" required>
    <button>Save token</button>
  </form>
</section>

<section id="app" hidden>
  <form id="addForm">
    <input id="urlInput" type="url" placeholder="https://store.com/products/that-watch" required>
    <input id="labelInput" type="text" placeholder="Nickname (optional), e.g. Seiko Alpinist">
    <button>Add to watchlist</button>
  </form>
  <p id="msg"></p>
  <ul id="list"></ul>
  <p><button class="secondary" id="changeToken">Change token</button></p>
</section>

<script>
const OWNER = 'Jas-02', REPO = 'restock-radar', BRANCH = 'main';
const FILE_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/data/watchlist.json`;
const rawUrl = (f) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/data/${f}?t=${Date.now()}`;
const BADGES = { IN_STOCK: 'In stock', OUT_OF_STOCK: 'Out of stock', UNKNOWN: 'Unknown', BLOCKED: "Can't monitor", NEW: 'Not checked yet' };

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('rr_token');

function showScreen() {
  $('setup').hidden = !!token;
  $('app').hidden = !token;
  if (token) refresh();
}

function msg(text, isError = false) {
  $('msg').textContent = text;
  $('msg').className = isError ? 'error' : '';
}

const ghHeaders = () => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function getWatchlist() {
  const res = await fetch(`${FILE_API}?ref=${BRANCH}&t=${Date.now()}`, { headers: ghHeaders() });
  if (res.status === 401) { throw new Error('Token rejected — check it and try again.'); }
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  const file = await res.json();
  const items = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)))).items;
  return { items, sha: file.sha };
}

async function saveWatchlist(items, sha, retried = false) {
  const body = {
    message: 'chore: update watchlist via web app [skip ci]',
    branch: BRANCH,
    sha,
    content: btoa(unescape(encodeURIComponent(JSON.stringify({ items }, null, 2) + '\n'))),
  };
  const res = await fetch(FILE_API, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (res.status === 409 && !retried) {
    const fresh = await getWatchlist(); // someone else wrote meanwhile; retry once on fresh sha
    return saveWatchlist(items, fresh.sha, true);
  }
  if (!res.ok) throw new Error(`Save failed (${res.status}). Try again.`);
}

async function getState() {
  try {
    const res = await fetch(rawUrl('state.json'));
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}

function render(items, state) {
  const list = $('list');
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<li>No watches yet — paste a product link above.</li>'; return; }
  for (const item of items) {
    const s = state[item.id];
    const status = s?.status ?? 'NEW';
    const li = document.createElement('li');
    li.className = item.active ? '' : 'paused';
    const name = document.createElement('a');
    name.href = item.url; name.target = '_blank'; name.rel = 'noopener';
    name.textContent = item.label || new URL(item.url).hostname;
    const badge = document.createElement('span');
    badge.className = `badge ${status}`;
    badge.textContent = item.active ? BADGES[status] : 'Paused';
    const top = document.createElement('div'); top.className = 'row';
    top.append(name, badge);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [
      s?.price ? `Price: ${s.price}` : null,
      s?.lastCheckedAt ? `Checked: ${new Date(s.lastCheckedAt).toLocaleString()}` : null,
    ].filter(Boolean).join(' · ');
    const actions = document.createElement('div'); actions.className = 'row actions';
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'secondary';
    pauseBtn.textContent = item.active ? 'Pause' : 'Resume';
    pauseBtn.onclick = () => mutate((items) => { items.find((i) => i.id === item.id).active = !item.active; return items; });
    const removeBtn = document.createElement('button');
    removeBtn.className = 'secondary';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => confirm(`Remove ${item.label || item.url}?`) &&
      mutate((items) => items.filter((i) => i.id !== item.id));
    actions.append(pauseBtn, removeBtn);
    li.append(top, meta, actions);
    list.append(li);
  }
}

async function refresh() {
  try {
    msg('Loading…');
    const [{ items }, state] = await Promise.all([getWatchlist(), getState()]);
    render(items, state);
    msg('');
  } catch (err) { msg(err.message, true); }
}

async function mutate(fn) {
  try {
    msg('Saving…');
    const { items, sha } = await getWatchlist();
    await saveWatchlist(fn(items), sha);
    await refresh();
    msg('Saved ✓');
  } catch (err) { msg(err.message, true); }
}

$('tokenForm').onsubmit = (e) => {
  e.preventDefault();
  token = $('tokenInput').value.trim();
  localStorage.setItem('rr_token', token);
  showScreen();
};

$('changeToken').onclick = () => {
  localStorage.removeItem('rr_token');
  token = null;
  showScreen();
};

$('addForm').onsubmit = (e) => {
  e.preventDefault();
  const url = $('urlInput').value.trim();
  const label = $('labelInput').value.trim();
  mutate((items) => [...items, {
    id: crypto.randomUUID().slice(0, 8),
    url,
    label: label || undefined,
    active: true,
    addedAt: new Date().toISOString(),
  }]).then(() => { $('urlInput').value = ''; $('labelInput').value = ''; });
};

showScreen();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual smoke test locally**

Run: `open docs/index.html`
Expected: the setup screen shows (no token stored). Paste any junk token, save → app screen appears, "Token rejected" or API error message appears in red when it tries to load (expected before the repo exists / with a junk token). Click "Change token" → back to setup screen. No console errors other than the failed API call.

- [ ] **Step 3: Commit**

```bash
git add docs/index.html
git commit -m "feat: GitHub Pages web app for managing the watchlist"
```

---

### Task 10: README, repo creation, Pages, end-to-end verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything — this task ships it.
- Produces: live repo `github.com/Jas-02/restock-radar`, Pages site, running schedule. Requires user participation for secrets (Gmail app password) and PAT.

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Full test suite green before shipping**

Run: `npm test`
Expected: PASS — 33 tests.

- [ ] **Step 3: Commit, create the public repo on the personal account, push**

```bash
git add README.md
git commit -m "docs: README with setup instructions"
git branch -M main
gh repo create Jas-02/restock-radar --public --source . --push
```
Expected: repo visible at https://github.com/Jas-02/restock-radar with all commits on `main`.

- [ ] **Step 4: Enable GitHub Pages from `main:/docs`**

```bash
gh api repos/Jas-02/restock-radar/pages -X POST \
  -f "source[branch]=main" -f "source[path]=/docs"
```
Expected: HTTP 201. A minute later `https://jas-02.github.io/restock-radar/` serves the app. (If it 409s because Pages already exists, use `-X PUT` on the same endpoint.)

- [ ] **Step 5: User adds secrets (blocked on user — ask, don't guess)**

Ask the user for: Gmail address, the app password they created, and both recipient emails. Then:
```bash
gh secret set GMAIL_USER --repo Jas-02/restock-radar
gh secret set GMAIL_APP_PASSWORD --repo Jas-02/restock-radar
gh secret set NOTIFY_TO --repo Jas-02/restock-radar
```
(each command prompts for the value; nothing lands in shell history or code).

- [ ] **Step 6: End-to-end verification**

1. Verify the Tests workflow passed on the push (Actions tab): `gh run list --repo Jas-02/restock-radar --limit 5`
2. Open the Pages app, paste the fine-grained token, add a real product URL
   that is currently **in stock** plus one that is **sold out**.
3. Trigger a manual run: `gh workflow run check.yml --repo Jas-02/restock-radar` then watch `gh run watch --repo Jas-02/restock-radar`.
4. Expected after the run: `data/state.json` committed with correct statuses;
   web app badges update on reload; **no** email yet (first check = baseline).
5. Force the notification path: in the web app pause/remove nothing — instead
   temporarily edit `data/state.json` on github.com to set the in-stock item's
   `status` to `"OUT_OF_STOCK"` and `notifiedInStock` to `false`, commit, then
   trigger another manual run. Expected: 🎉 email arrives at both addresses.
6. Confirm the schedule is live: Actions tab shows "Check stock" runs
   appearing on their own over the next half hour.

- [ ] **Step 7: Final commit if E2E surfaced fixes; otherwise done**

```bash
git status   # should be clean
```

---

## Self-Review Notes

- Spec coverage: web app (Task 9), data files (Task 1), checker+schedule (Tasks 7–8), detection layers (Tasks 2–4), transitions/anti-repeat/BLOCKED rules (Task 5), Gmail notifications (Task 6), error-handling table (Tasks 5, 7), unit tests via fixtures + manual E2E (Tasks 2–7, 10), user setup checklist (Task 10 README). Write-conflict sha retry: Task 9 `saveWatchlist`.
- Type consistency: `{ok, status, price}` result shape shared by `checkItem` (Task 7) and `applyCheck` (Task 5); state object fields identical in Tasks 5, 7, 9; email builder signatures match between Tasks 6 and 7.
- Known accepted deviations from spec text: fixtures are small synthetic pages (not saved full store pages) — they exercise the same code paths and keep the repo tiny.
```
