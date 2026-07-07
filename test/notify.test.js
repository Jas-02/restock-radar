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

test('sendEmail rejects with a clear error when email env vars are missing', async () => {
  const { sendEmail } = await import('../src/notify.js');
  await assert.rejects(() => sendEmail({ subject: 's', text: 't' }, {}), /GMAIL_USER/);
});
