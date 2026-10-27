import http from 'node:http';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSocket } from './realtime/socket.js';
import { startHoldSweeper } from './jobs/holdSweeper.js';
import { startEventEmailJob } from './jobs/eventEmails.js';

async function main() {
  await connectDB(env.MONGODB_URI);
  console.log('MongoDB connected');

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  const stopSweeper = startHoldSweeper();
  const stopEventEmails = startEventEmailJob();

  server.listen(env.PORT, () => console.log(`Housefull API listening on :${env.PORT}`));

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    stopSweeper();
    stopEventEmails();
    server.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
