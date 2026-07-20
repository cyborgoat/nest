import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import type { PackProject, PackRelease } from './../src/packs/pack.types';

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

  it('/packs (GET) returns projects with versions', async () => {
    const res = await request(app.getHttpServer()).get('/packs').expect(200);
    const packs = res.body as PackProject[];
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
    const cs = packs.find((p) => p.id === 'customer-support');
    expect(cs).toBeDefined();
    expect(cs!.latest_version).toBe('1.1.0');
    expect(cs!.versions).toEqual(expect.arrayContaining(['1.0.0', '1.1.0']));
  });

  it('/packs/:id/:version (GET)', async () => {
    const res = await request(app.getHttpServer())
      .get('/packs/customer-support/1.0.0')
      .expect(200);
    const release = res.body as PackRelease;
    expect(release.id).toBe('customer-support');
    expect(release.version).toBe('1.0.0');
    expect(release.path).toBe('customer-support');
  });

  it('/packs/:id/download (GET) latest', async () => {
    const res = await request(app.getHttpServer())
      .get('/packs/customer-support/download')
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
    expect(res.headers['x-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });

  it('/packs/:id/:version/download (GET)', async () => {
    const res = await request(app.getHttpServer())
      .get('/packs/customer-support/1.0.0/download')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain(
      'customer-support-1.0.0.zip',
    );
    expect(res.headers['x-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
  });
});
