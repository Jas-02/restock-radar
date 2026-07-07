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
