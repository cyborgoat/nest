import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import type { Pack } from './../src/packs/pack.types';

describe('Knowledge Hub (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableCors();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/packs (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/packs').expect(200);
    const packs = res.body as Pack[];
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]).toHaveProperty('id');
  });

  it('/packs/:id/download (GET)', async () => {
    const res = await request(app.getHttpServer())
      .get('/packs/getting-started/download')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/zip/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });
});
