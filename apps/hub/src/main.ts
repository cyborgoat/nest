import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? 8787);
  const fixturesPath = path.resolve(
    process.cwd(),
    config.get<string>('FIXTURES_PATH') ?? '../../fixtures/knowledge',
  );
  await app.listen(port);
  console.log(`Nest Knowledge Hub listening on http://127.0.0.1:${port}`);
  console.log(`Fixtures path: ${fixturesPath}`);
}
void bootstrap();
