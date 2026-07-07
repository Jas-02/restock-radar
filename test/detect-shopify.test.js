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
