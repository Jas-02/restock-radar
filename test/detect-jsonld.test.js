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
