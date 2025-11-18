// src/signals/tradingviewServer.js
import express from 'express';
import { config } from '../config/env.js';
import { parseTradingViewMessage } from './parseTradingViewMessage.js';

const relays = new Set();

// If your Node version does NOT have global fetch, install node-fetch:
//   npm install node-fetch
// and uncomment the next line:
// import fetch from 'node-fetch';

async function broadcastToRelays(event, logger) {
  for (const url of relays) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
    } catch (err) {
      logger.error({ err, url }, 'Relay POST failed');
    }
  }
}

export function startTradingViewServer({ signalBus, fsm, pnlContext, logger }) {
  const app = express();
  app.use(express.json());

  // --- TradingView webhook ---
  app.post('/webhook', async (req, res) => {
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

    // Emit into internal bus
    if (side === 'BUY') {
      signalBus.emitBuy();
    } else if (side === 'SELL') {
      signalBus.emitSell();
    }

    // Relay outwards
    await broadcastToRelays(
      {
        type: 'tradingview-signal',
        side,
        rawMessage: message,
        ts: Date.now()
      },
      logger
    );

    res.json({ status: 'ok' });
  });

  // --- Status API for dashboard ---
  app.get('/status', (req, res) => {
    const state = fsm?.getState?.() ?? 'UNKNOWN';
    const position = fsm?.getPosition?.() ?? null;
    const anchors = fsm?.getAnchors?.() ?? null;
    const pnl = pnlContext?.getSnapshot?.() ?? null;

    res.json({
      state,
      position,
      anchors,
      pnl
    });
  });

  // --- HTML dashboard (root) ---
  app.get('/', (req, res) => {
    res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${config.symbol} Paper Trader Dashboard</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #050509;
      color: #f5f5f5;
    }
    h1 {
      margin-top: 0;
      font-size: 24px;
    }
    .sub {
      color: #9a9a9a;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 16px;
      margin-bottom: 16px;
    }
    .card {
      background: #15151b;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 0 12px rgba(0,0,0,0.45);
    }
    .label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #9a9a9a;
      margin-bottom: 4px;
    }
    .value {
      font-size: 18px;
    }
    .pnl-pos { color: #2ecc71; }
    .pnl-neg { color: #e74c3c; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 12px;
    }
    th, td {
      padding: 4px 6px;
      border-bottom: 1px solid #222;
      text-align: left;
    }
    th {
      font-weight: 600;
      color: #bbbbbb;
    }
    .relay-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
      padding: 4px 0;
      border-bottom: 1px solid #222;
      font-size: 12px;
    }
    button {
      border-radius: 6px;
      border: 1px solid #444;
      background: #1f1f27;
      color: #f5f5f5;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover {
      background: #2a2a34;
    }
    input[type="text"] {
      width: 100%;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid #444;
      background: #0b0b11;
      color: #f5f5f5;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .small {
      font-size: 11px;
      color: #9a9a9a;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <h1>${config.symbol} Paper Trader</h1>
  <div class="sub">Dashboard · FSM state, position, anchors, P&L and relays</div>

  <div id="cards">Loading...</div>

  <div class="grid">
    <div class="card" style="grid-column: 1 / -1;">
      <div class="label">Trades</div>
      <div id="trades-table">No trades yet.</div>
    </div>

    <div class="card" style="grid-column: 1 / -1;">
      <div class="label">Relays</div>
      <div>
        <input id="relay-url" type="text" placeholder="https://your-endpoint.example.com/hook" />
        <button id="add-relay-btn">Add Relay</button>
        <div class="small">All TradingView signals will be forwarded to these URLs as JSON.</div>
      </div>
      <div id="relays-list" style="margin-top: 8px;">Loading relays...</div>
    </div>
  </div>

  <script>
    function fmt(n, digits) {
      if (n == null || Number.isNaN(n)) return "-";
      return Number(n).toFixed(digits ?? 2);
    }

    function pnlClass(v) {
      if (v > 0) return "pnl-pos";
      if (v < 0) return "pnl-neg";
      return "";
    }

    async function fetchStatus() {
      const res = await fetch('/status');
      return res.json();
    }

    async function fetchRelays() {
      const res = await fetch('/relays');
      return res.json();
    }

    async function addRelay(url) {
      const res = await fetch('/relays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      return res.json();
    }

    async function removeRelay(url) {
      const res = await fetch('/relays', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      return res.json();
    }

    function renderCards(data) {
      const root = document.getElementById('cards');
      const pnl = data.pnl || {};
      const pos = data.position || {};
      const anchors = data.anchors || {};

      root.innerHTML = \`
        <div class="grid">
          <div class="card">
            <div class="label">FSM State</div>
            <div class="value">\${data.state}</div>
          </div>

          <div class="card">
            <div class="label">Position</div>
            <div>Side: \${pos && pos.side ? pos.side : '-'}</div>
            <div>Qty: \${pos && pos.qty != null ? pos.qty : 0}</div>
            <div>Entry Price: \${pos && pos.entryPrice != null ? pos.entryPrice : '-'}</div>
          </div>

          <div class="card">
            <div class="label">Anchors</div>
            <div>Buy Trigger: \${anchors && anchors.buyEntryTrigger != null ? anchors.buyEntryTrigger : '-'}</div>
            <div>Buy Stop: \${anchors && anchors.buyStop != null ? anchors.buyStop : '-'}</div>
            <div>Sell Trigger: \${anchors && anchors.sellEntryTrigger != null ? anchors.sellEntryTrigger : '-'}</div>
            <div>Sell Stop: \${anchors && anchors.sellStop != null ? anchors.sellStop : '-'}</div>
          </div>

          <div class="card">
            <div class="label">P&L</div>
            <div>Last Price: \${pnl.lastPrice != null ? pnl.lastPrice : '-'}</div>
            <div class="\${pnlClass(pnl.realizedPnl)}">Realized: \${fmt(pnl.realizedPnl)}</div>
            <div class="\${pnlClass(pnl.unrealizedPnl)}">Unrealized: \${fmt(pnl.unrealizedPnl)}</div>
            <div class="\${pnlClass(pnl.totalPnl)}">Total: \${fmt(pnl.totalPnl)}</div>
            <div>Trades: \${pnl.tradeCount ?? 0}</div>
          </div>
        </div>
      \`;
    }

    function renderTrades(pnl) {
      const host = document.getElementById('trades-table');
      const trades = (pnl && pnl.trades) || [];
      if (!trades.length) {
        host.textContent = 'No trades yet.';
        return;
      }

      const rows = trades.slice().reverse().map(t => {
        const d = new Date(t.ts);
        const ts = d.toLocaleString();
        const pnlTxt = t.pnl != null ? fmt(t.pnl) : '-';
        const pnlCls = pnlClass(t.pnl || 0);
        return \`
          <tr>
            <td>\${ts}</td>
            <td>\${t.type}</td>
            <td>\${t.side}</td>
            <td>\${t.qty}</td>
            <td>\${t.price}</td>
            <td class="\${pnlCls}">\${pnlTxt}</td>
          </tr>
        \`;
      }).join('');

      host.innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Price</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>\${rows}</tbody>
        </table>
      \`;
    }

    function renderRelays(relayData) {
      const host = document.getElementById('relays-list');
      const list = (relayData && relayData.relays) || [];
      if (!list.length) {
        host.textContent = 'No relays registered.';
        return;
      }

      host.innerHTML = list.map(url => \`
        <div class="relay-row">
          <div>\${url}</div>
          <button data-url="\${url}" class="remove-relay-btn">Remove</button>
        </div>
      \`).join('');

      host.querySelectorAll('.remove-relay-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const url = btn.getAttribute('data-url');
          await removeRelay(url);
          const fresh = await fetchRelays();
          renderRelays(fresh);
        });
      });
    }

    async function refreshAll() {
      try {
        const [status, relayData] = await Promise.all([
          fetchStatus(),
          fetchRelays()
        ]);
        renderCards(status);
        renderTrades(status.pnl);
        renderRelays(relayData);
      } catch (e) {
        document.getElementById('cards').textContent = 'Error loading status: ' + e;
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('add-relay-btn');
      const input = document.getElementById('relay-url');

      btn.addEventListener('click', async () => {
        const url = input.value.trim();
        if (!url) return;
        await addRelay(url);
        input.value = '';
        const fresh = await fetchRelays();
        renderRelays(fresh);
      });

      refreshAll();
      setInterval(refreshAll, 2000);
    });
  </script>
</body>
</html>`);
  });

  // --- Relay management API ---

  app.get('/relays', (req, res) => {
    res.json({ relays: Array.from(relays) });
  });

  app.post('/relays', (req, res) => {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }
    relays.add(url);
    logger.info({ url }, 'Added relay URL');
    res.json({ ok: true, relays: Array.from(relays) });
  });

  app.delete('/relays', (req, res) => {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }
    relays.delete(url);
    logger.info({ url }, 'Removed relay URL');
    res.json({ ok: true, relays: Array.from(relays) });
  });

  app.listen(config.port, () => {
    logger.info(
      `TradingView webhook server + dashboard listening on port ${config.port}`
    );
  });
}
