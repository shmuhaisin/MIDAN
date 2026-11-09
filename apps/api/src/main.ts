import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { loadEnv } from './common/load-env';

async function bootstrap() {
  loadEnv('.env');
  // The API reads and writes through the same Supabase project as the web app (DATABASE_URL, as the midan_api role).
  // Without it there is no database to use, and no other one is tried.
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set: the API needs the Supabase project's database connection (docs/supabase-cloud.md). Not starting.");
    process.exit(1);
  }
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  configureApp(app);
  const config = new DocumentBuilder().setTitle('Midan Core API').setVersion('0.2.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(process.env.PORT ?? 4000);
}

void bootstrap();
