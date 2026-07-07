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
