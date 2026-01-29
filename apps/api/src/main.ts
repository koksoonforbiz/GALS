import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './env';
import { GlobalExceptionFilter } from './common';

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(env.PORT);
  console.log(`API running on port ${env.PORT} [${env.NODE_ENV}]`);
}

bootstrap();
