import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ChatService } from './chat/chat.service';
import { config } from './config';
import { migrate } from './db/migrate';
import { LeaveService } from './hr/leave.service';
import { makeOutboxHandler } from './provisioning/outbox';
import { workerTick } from './provisioning/jobs';
import './provisioning/handlers';

/** Worker: job provisioning + outbox. Boleh dijalankan lebih dari satu instance (SKIP LOCKED). */
export async function startWorker(intervalMs = 2000) {
  const c = config();
  await migrate();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const handler = makeOutboxHandler(app.get(ChatService), app.get(LeaveService));
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const n = await workerTick(c.WORKER_ID, handler);
        if (n === 0) await new Promise((r) => setTimeout(r, intervalMs));
      } catch (e) {
        console.error('worker tick gagal:', (e as Error).message);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  };
  void loop();
  console.log(`Worker ${c.WORKER_ID} berjalan`);
  return { stop: () => { stopped = true; return app.close(); } };
}

if (process.argv[1] && /worker\.(ts|js)$/.test(process.argv[1])) {
  startWorker().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
