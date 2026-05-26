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

  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Strip unknown fields from all request bodies
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
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
