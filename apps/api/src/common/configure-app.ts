import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DatabaseExceptionFilter } from './database-exception.filter';

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DatabaseExceptionFilter());
}
