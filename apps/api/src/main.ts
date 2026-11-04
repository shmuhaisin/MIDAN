import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';

async function bootstrap() {
  loadEnv('.env');
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  configureApp(app);
  const config = new DocumentBuilder().setTitle('Midan Core API').setVersion('0.2.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
