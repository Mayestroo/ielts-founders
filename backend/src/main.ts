import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

import { INestApplication } from '@nestjs/common';

export async function setupApp(app: INestApplication) {
  const configService = app.get(ConfigService);

  // Security: Helmet headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Needed for serving images to frontend
    }),
  );

  // Performance: Compression
  app.use(compression());

  // Enable CORS for frontend apps
  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
  const adminUrl =
    configService.get<string>('ADMIN_URL') || 'http://localhost:3002';

  app.enableCors({
    origin: [frontendUrl, adminUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  await setupApp(app);

  const configService = app.get(ConfigService);
  const port = process.env.PORT || 3000;
  await app.listen(port);

  if (process.env.NODE_ENV === 'production') {
    if (!configService.get('JWT_SECRET')) {
      console.warn('WARNING: JWT_SECRET is not set in production!');
    }
    if (!configService.get('FRONTEND_URL')) {
      console.warn(
        'WARNING: FRONTEND_URL is not set, falling back to localhost.',
      );
    }
  }

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap().catch((err) => {
  console.error('Error during bootstrap:', err);
  process.exit(1);
});
