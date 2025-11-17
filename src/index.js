// src/index.js
import './config/env.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { startMarketStream } from './exchange/marketStream.js';
import { startTradingViewServer } from './signals/tradingviewServer.js';
import { createSignalBus } from './signals/signalBus.js';
import { createFSM } from './trading/fsm.js';
import { createPaperBroker } from './trading/paperBroker.js';
import { createPnlContext } from './trading/pnlContext.js';

async function main() {
  const symbol = config.symbol;

  logger.info(`Starting BTCUSDT paper trader for ${symbol}...`);

  const signalBus = createSignalBus();
  const pnlContext = createPnlContext({ symbol });
  const broker = createPaperBroker({ symbol, pnlContext, logger });

  const fsm = createFSM({
    symbol,
    signalBus,
    broker,
    pnlContext,
    logger
  });

  // TradingView webhook server (Entry/Exit → BUY/SELL)
  startTradingViewServer({ signalBus, logger });

  // Binance market stream (ticks)
  startMarketStream({
    symbol,
    onTick: (tick) => fsm.onTick(tick),
    logger
  });

  logger.info('System initialized.');
}

main().catch((err) => {
  console.error('Fatal error in main()', err);
  process.exit(1);
});
