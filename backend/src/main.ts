import * as dotenv from 'dotenv';
import * as path from 'path';
// Load the environment-specific .env file first, overriding any defaults already in process.env.
// process.cwd() is always the backend/ root regardless of ts-node vs compiled dist.
dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'dev'}`), override: true });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SystemParamsService } from './system-params/system-params.service';
import helmet from 'helmet';

async function bootstrap() {
  // Fail fast — never start without a real JWT secret
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
    process.exit(1);
  }

  const env  = process.env.NODE_ENV ?? 'dev';
  const port = process.env.PORT ?? '3000';
  const db   = (process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@');
  console.log(`\n🚀 NightOps Backend`);
  console.log(`   ENV  : ${env}`);
  console.log(`   PORT : ${port}`);
  console.log(`   DB   : ${db}`);
  console.log(`   PID  : ${process.pid}\n`);

  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Strip unknown fields from all request bodies
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  app.enableCors({
    origin: [
      'http://localhost:3002', // TEST frontend
      'http://localhost:3003', // DEV frontend
      'http://localhost:3011', // PROD frontend
    ],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Seed default system params (no-op if already exist)
  const systemParams = app.get(SystemParamsService);
  await systemParams.seed();

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
