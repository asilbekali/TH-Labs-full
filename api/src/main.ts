import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();



// Hi this codes are written by Alien :)  </> yeah I'm a alien and I love to code in typescript and nestjs.