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
