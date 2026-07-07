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
