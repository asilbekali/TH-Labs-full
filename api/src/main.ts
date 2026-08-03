// Hi, these codes are written by Alien :)  </>
// Yeah, I'm an alien and I love coding with TypeScript & NestJS. 👽

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

// Browser origins allowed to call this API directly. The Studio needs it to
// redeem a handoff code (POST /v1/auth/handoff/exchange) and to refresh, both
// of which run in the browser from a different origin.
//
// The landing page is NOT in this list and does not need to be: its browser
// code only ever talks to its own Next.js route handlers, which reach this API
// server-side where CORS does not apply.
//
// Override with a comma-separated CORS_ORIGINS when an origin changes — the
// Studio's Modal URL in particular is account-scoped and will differ per
// deployment.
const DEFAULT_CORS_ORIGINS = [
  'https://isoqovjorabek2--th-labs-dubbing-web.modal.run',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
];

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function bootstrap() {
  // rawBody: true keeps the untouched request buffer on `req.rawBody`, which the
  // Stripe webhook needs — signature verification silently fails on a body that
  // the JSON parser has already re-serialized.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const PORT = Number(process.env.PORT) || 3001;
  const HOST = process.env.HOST || 'localhost';

  // Parse the httpOnly refresh cookie into req.cookies for the auth routes.
  app.use(cookieParser());

  // contentSecurityPolicy is disabled so the Swagger UI at /docs (inline
  // scripts/styles) still loads; all other helmet protections stay on.
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS restricted to the app origin (APP_URL), with credentials so the
  // refresh cookie flows.
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  app.enableCors({
    origin: appUrl,
    credentials: true,
  });

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('TH-LABS API')
    .setDescription(
      '🚀 TH-LABS Backend API\n\nBuilding the future of AI Dubbing & Language Translation.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'TH-LABS API Docs',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(PORT);

  console.clear();

  console.log(`
\x1b[36m
████████╗██╗  ██╗      ██╗      █████╗ ██████╗ ███████╗
╚══██╔══╝██║  ██║      ██║     ██╔══██╗██╔══██╗██╔════╝
   ██║   ███████║█████╗██║     ███████║██████╔╝███████╗
   ██║   ██╔══██║╚════╝██║     ██╔══██║██╔══██╗╚════██║
   ██║   ██║  ██║      ███████╗██║  ██║██████╔╝███████║
   ╚═╝   ╚═╝  ╚═╝      ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝
\x1b[0m
`);

  console.log('\x1b[32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log('\x1b[36m🚀 TH-LABS Backend is Online\x1b[0m');
  console.log(
    '\x1b[32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n',
  );

  console.log(`🌐 API       : \x1b[33mhttp://${HOST}:${PORT}\x1b[0m`);
  console.log(`📚 Swagger   : \x1b[33mhttp://${HOST}:${PORT}/docs\x1b[0m`);
  console.log(`🔖 Version   : \x1b[33mv1\x1b[0m`);
  console.log(
    `⚡ Environment: \x1b[33m${process.env.NODE_ENV || 'development'}\x1b[0m`,
  );
  console.log(`🟢 Status    : \x1b[32mRUNNING\x1b[0m\n`);

  console.log('\x1b[35m══════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[35m⚡ Waiting for incoming requests...\x1b[0m');
  console.log('\x1b[35m══════════════════════════════════════════════\x1b[0m');
}

bootstrap();
