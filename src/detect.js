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
