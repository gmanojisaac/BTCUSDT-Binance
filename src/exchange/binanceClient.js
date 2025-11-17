import WebSocket from 'ws';

export function connectTradeStream({ symbol, onMessage, onError, onClose }) {
  const lower = symbol.toLowerCase();
  const url = `wss://stream.binance.com:9443/ws/${lower}@trade`;

  const ws = new WebSocket(url);

  ws.on('open', () => {
    console.log(`Connected to Binance trade stream for ${symbol}`);
  });

  ws.on('message', (data) => {
    try {
      const json = JSON.parse(data.toString());
      onMessage && onMessage(json);
    } catch (err) {
      console.error('Error parsing Binance message', err);
    }
  });

  ws.on('error', (err) => {
    console.error('Binance WS error', err);
    onError && onError(err);
  });

  ws.on('close', (code, reason) => {
    console.warn(`Binance WS closed: ${code} ${reason}`);
    onClose && onClose(code, reason);
  });

  return ws;
}
