import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 开启 CORS，只开放本地 web（开发环境）
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3002',
    credentials: true,
  });

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
}
bootstrap();
