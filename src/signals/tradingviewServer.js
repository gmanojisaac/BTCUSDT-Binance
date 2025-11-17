// src/signals/tradingviewServer.js
import express from 'express';
import { config } from '../config/env.js';
import { parseTradingViewMessage } from './parseTradingViewMessage.js';

export function startTradingViewServer({ signalBus, logger }) {
  const app = express();
  app.use(express.json());

  app.post('/webhook', (req, res) => {
    const body = req.body || {};

    // Typical TradingView body: { "message": "Accepted Entry ..." }
    const message =
      body.message ??
      body.text ??
      body.signal ??
      (typeof body === 'string' ? body : null);

    if (!message || typeof message !== 'string') {
      logger.warn({ body }, 'Webhook without usable message text');
      return res.status(400).json({ error: 'Missing message text' });
    }

    const { side } = parseTradingViewMessage(message);

    if (!side) {
      logger.warn({ message }, 'Unknown TradingView message format');
      return res.status(400).json({ error: 'Unknown message format' });
    }

    logger.info({ side, message }, 'Received TradingView signal');

    // ✅ Only pass BUY/SELL, no extra metadata
    if (side === 'BUY') {
      signalBus.emitBuy();
    } else if (side === 'SELL') {
      signalBus.emitSell();
    }

    res.json({ status: 'ok' });
  });

  app.listen(config.port, () => {
    logger.info(`TradingView webhook server listening on port ${config.port}`);
  });
}
