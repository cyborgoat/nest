import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });
  app.enableCors();
  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? 8787);
  const fixturesPath = path.resolve(
    process.cwd(),
    config.get<string>('FIXTURES_PATH') ?? '../../fixtures/knowledge',
  );
  const debug = ['1', 'true', 'yes', 'on'].includes(
    (config.get<string>('NEST_DEBUG') ?? '').trim().toLowerCase(),
  );
  await app.listen(port);
  console.log(`Nest Knowledge Hub listening on port ${port}`);
  console.log(`Fixtures path: ${fixturesPath}`);
  if (debug) {
    console.log('NEST_DEBUG is on');
  }
}
void bootstrap();
