import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger / OpenAPI 文档（供 Apifox 导入）
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Dream-LLM Chat')
    .setDescription('chat 微服务 API：会话、消息、文档上传、向量检索')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  // 开启 CORS，只开放本地 web（开发环境）
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3002',
    credentials: true,
  });

  const port = process.env.PORT ?? 4001;
  await app.listen(port);
}
bootstrap();
