// src/trading/pnlContext.js
export function createPnlContext({ symbol }) {
  let positionQty = 0;
  let avgPrice = 0;

  let lastPrice = null;
  let realizedPnl = 0;
  let tradeCount = 0;
  const trades = [];

  function getUnrealizedPnl() {
    if (lastPrice == null || positionQty === 0) return 0;
    // Long-only unrealized P&L
    return (lastPrice - avgPrice) * positionQty;
  }

  function snapshot() {
    const unrealizedPnl = getUnrealizedPnl();
    return {
      symbol,
      positionQty,
      avgPrice,
      lastPrice,
      realizedPnl,
      unrealizedPnl,
      totalPnl: realizedPnl + unrealizedPnl,
      tradeCount,
      trades
    };
  }

  return {
    getOpenQty() {
      return positionQty;
    },

    updateMarkPrice(price) {
      lastPrice = price;
      return snapshot();
    },

    getSnapshot() {
      return snapshot();
    },

    openPosition({ side, qty, price, meta = {} }) {
      // Long-only for now
      if (side === 'BUY') {
        const totalCost = avgPrice * positionQty + price * qty;
        positionQty += qty;
        avgPrice = positionQty > 0 ? totalCost / positionQty : 0;

        tradeCount += 1;
        trades.push({
          ts: Date.now(),
          type: 'OPEN',
          side,
          qty,
          price,
          meta
        });
      }
      return snapshot();
    },

    closePosition({ side, qty, price, meta = {} }) {
      // Closing long with a SELL
      if (side === 'SELL') {
        if (qty > positionQty) qty = positionQty; // safety

        const pnl = (price - avgPrice) * qty;
        realizedPnl += pnl;
        positionQty -= qty;

        if (positionQty <= 0) {
          positionQty = 0;
          avgPrice = 0;
        }

        tradeCount += 1;
        trades.push({
          ts: Date.now(),
          type: 'CLOSE',
          side,
          qty,
          price,
          pnl,
          meta
        });
      }
      return snapshot();
    }
  };
}
