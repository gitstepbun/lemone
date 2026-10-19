import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { attachWebSocket } from './chat/ws';
import { redact } from './common/crypto';
import { config } from './config';
import { migrate } from './db/migrate';

async function bootstrap() {
  const c = config();
  await migrate();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: true,
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Log akses tanpa token/secret.
  app.use((req: { method: string; originalUrl: string }, res: { on: (ev: string, fn: () => void) => void; statusCode: number }, next: () => void) => {
    const start = Date.now();
    res.on('finish', () => {
      if (c.LOG_LEVEL === 'debug' || res.statusCode >= 400) console.log(`${req.method} ${redact(req.originalUrl)} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  await app.init();
  const server = app.getHttpServer();
  attachWebSocket(server);
  await app.listen(c.API_PORT);
  console.log(`API Lemone siap di :${c.API_PORT} (ERP=${c.ERP_ADAPTER}, issuer=${c.OIDC_ISSUER})`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
