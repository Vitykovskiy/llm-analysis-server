import { config } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

config({
  path: resolve(__dirname, '..', '.env'),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CLIENT_URL ?? true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
