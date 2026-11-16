import { createApp } from './app.mjs';
import { createConnectionStore } from './connection-store.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const accessToken = process.env.APP_ACCESS_TOKEN || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && accessToken.length < 24) {
  throw new Error('Para exponer la aplicación en red, configura APP_ACCESS_TOKEN con al menos 24 caracteres.');
}
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const connectionStore = createConnectionStore();
const { app, close } = createApp({ connections: await connectionStore.load(), saveConnections: entries => connectionStore.save(entries), accessToken, allowedOrigin: origin, enableProductionWrites: process.env.ENABLE_PRODUCTION_WRITES === 'true' });
const server = app.listen(port, host, () => console.log(`Scotia Compass: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(async () => { await close(); process.exit(0); }); });
