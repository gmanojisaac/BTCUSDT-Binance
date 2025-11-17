// src/trading/paperBroker.js

export function createPaperBroker({ symbol, pnlContext, logger }) {
  return {
    placeLimitBuy(qty, price, meta = {}) {
      logger.info({ symbol, qty, price, meta }, 'Paper LIMIT BUY');
      return pnlContext.openPosition({ side: 'BUY', qty, price, meta });
    },

    placeLimitSell(qty, price, meta = {}) {
      logger.info({ symbol, qty, price, meta }, 'Paper LIMIT SELL');
      return pnlContext.closePosition({ side: 'SELL', qty, price, meta });
    },

    getOpenQty() {
      return pnlContext.getOpenQty();
    }
  };
}
