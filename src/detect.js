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
