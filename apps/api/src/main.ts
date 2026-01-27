import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './env';

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');

  await app.listen(env.PORT);
  console.log(`API running on port ${env.PORT} [${env.NODE_ENV}]`);
}

bootstrap();
