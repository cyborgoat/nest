import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { loadHubConfig } from './hub.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });
  const config = app.get(ConfigService);
  const hub = loadHubConfig(config);
  const logger = new Logger('Bootstrap');

  if (hub.cors.mode === 'all') {
    app.enableCors();
  } else {
    app.enableCors({ origin: hub.cors.origins });
  }

  await app.listen(hub.port, hub.host);
  logger.log(`Nest Hub listening on ${hub.host}:${hub.port}`);
  logger.log(`Registry path: ${hub.registryPath}`);
  logger.log(
    `CORS: ${hub.cors.mode === 'all' ? '*' : hub.cors.origins.join(', ')}`,
  );
  if (hub.debug) {
    logger.log('DEBUG_MODE is on');
  }
}
void bootstrap();
