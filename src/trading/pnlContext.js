export function createPnlContext({ symbol }) {
  let positionQty = 0;
  let avgPrice = 0;

  return {
    getOpenQty() {
      return positionQty;
    },

    openPosition({ side, qty, price }) {
      if (side === 'BUY') {
        const totalCost = avgPrice * positionQty + price * qty;
        positionQty += qty;
        avgPrice = totalCost / positionQty;
      }
      // For now, ignore SELL-opening (short) – only long.
      return { positionQty, avgPrice };
    },

    closePosition({ side, qty, price }) {
      if (side === 'SELL') {
        positionQty -= qty;
        if (positionQty <= 0) {
          positionQty = 0;
          avgPrice = 0;
        }
      }
      return { positionQty, avgPrice };
    }
  };
}
