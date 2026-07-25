import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as path from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import type { PackProject, PackRelease } from './../src/packs/pack.types';
import { promises as fs } from 'fs';
import AdmZip from 'adm-zip';
import { DatabaseService } from './../src/database/database.service';

describe('Hub (e2e)', () => {
  let app: INestApplication<App>;
  const registryPath = path.join('/tmp', `nest-hub-registry-${process.pid}`);

  beforeAll(async () => {
    process.env.HOST = process.env.HOST || '127.0.0.1';
    process.env.PORT = process.env.PORT || '8787';
    await fs.rm(registryPath, { recursive: true, force: true });
    await fs.cp(
      path.resolve(__dirname, '../../../examples/knowledge-packs'),
      registryPath,
      { recursive: true },
    );
    process.env.REGISTRY_PATH = registryPath;
    process.env.DEBUG_MODE = process.env.DEBUG_MODE || 'false';
    process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
    process.env.DOWNLOAD_TIMEOUT_MS =
      process.env.DOWNLOAD_TIMEOUT_MS || '120000';
    process.env.DATABASE_PATH = path.join(
      '/tmp',
      `nest-hub-e2e-${process.pid}.sqlite3`,
    );
    await fs.unlink(process.env.DATABASE_PATH).catch(() => undefined);
    await fs.unlink(`${process.env.DATABASE_PATH}-wal`).catch(() => undefined);
    await fs.unlink(`${process.env.DATABASE_PATH}-shm`).catch(() => undefined);
    process.env.STAGING_PATH = path.join(
      '/tmp',
      `nest-hub-staging-${process.pid}`,
    );
    process.env.MAX_PACK_UPLOAD_BYTES = String(100 * 1024 * 1024);
    process.env.JWT_SECRET =
      'test-secret-that-is-at-least-thirty-two-characters';
    process.env.SUPERUSER_ID = 'root-admin';
    process.env.SUPERUSER_PASSWORD = 'test-superuser-password';
    process.env.SUPERUSER_NAME = 'Root Admin';
    process.env.MIN_PASSWORD_LENGTH = '12';
  });

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

  afterAll(async () => {
    await fs.unlink(process.env.DATABASE_PATH!).catch(() => undefined);
    await fs.unlink(`${process.env.DATABASE_PATH!}-wal`).catch(() => undefined);
    await fs.unlink(`${process.env.DATABASE_PATH!}-shm`).catch(() => undefined);
    await fs.rm(registryPath, { recursive: true, force: true });
    await fs.rm(process.env.STAGING_PATH!, { recursive: true, force: true });
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/ready (GET) when registry is present', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);
    expect(res.body).toMatchObject({ status: 'ready' });
    expect(typeof res.body.registryPath).toBe('string');
    expect(res.body.registryPath.length).toBeGreaterThan(0);
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
    expect(res.headers['content-length']).toMatch(/^\d+$/);
    expect(res.headers['x-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(Number(res.headers['content-length'])).toBe(
      (res.body as Buffer).length,
    );
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
    expect(res.headers['content-length']).toMatch(/^\d+$/);
    expect(res.headers['x-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('registers a regular user and returns authenticated identity', async () => {
    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        id: 'pack-author',
        password: 'a-secure-password',
        name: 'Pack Author',
      })
      .expect(201);
    expect(registration.body.user).toMatchObject({
      id: 'pack-author',
      name: 'Pack Author',
      role: 'user',
    });
    expect(registration.body.access_token).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registration.body.access_token}`)
      .expect(200)
      .expect(({ body }) => expect(body.id).toBe('pack-author'));
  });

  it('returns the configured password requirement when registration is too short', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ id: 'short-password', password: 'too-short', name: 'Short' })
      .expect(409);
    expect(response.body.message).toBe(
      'Password must contain at least 12 characters',
    );
  });

  it('updates the profile name and rotates the account password without changing the ID', async () => {
    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        id: 'profile-user',
        password: 'original-password',
        name: 'Original Name',
      })
      .expect(201);
    const profile = await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${registration.body.access_token}`)
      .send({ name: 'Updated Name' })
      .expect(200);
    expect(profile.body).toMatchObject({
      id: 'profile-user',
      name: 'Updated Name',
    });
    const password = await request(app.getHttpServer())
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${registration.body.access_token}`)
      .send({
        current_password: 'original-password',
        new_password: 'replacement-password',
      })
      .expect(201);
    expect(password.body.user).toMatchObject({
      id: 'profile-user',
      name: 'Updated Name',
    });
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'profile-user', password: 'original-password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'profile-user', password: 'replacement-password' })
      .expect(201);
  });

  it('locks the configured superuser and exposes its managed status', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const users = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);
    expect(users.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'root-admin',
          role: 'superuser',
          managed: true,
        }),
      ]),
    );
    const root = users.body.find(
      (user: { id: string }) => user.id === 'root-admin',
    );
    await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ name: 'Changed Root' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({
        current_password: 'test-superuser-password',
        new_password: 'replacement-root-password',
      })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${root.uuid}`)
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ role: 'admin' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${root.uuid}`)
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(403);
  });

  it('enforces the admin role and user deletion permission matrix', async () => {
    const rootLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const register = async (id: string, name: string) =>
      request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ id, password: 'role-test-password', name })
        .expect(201);
    const admin = await register('role-admin', 'Role Admin');
    const user = await register('deletable-user', 'Deletable User');
    const secondAdmin = await register('second-admin', 'Second Admin');

    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${user.body.access_token}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${admin.body.user.uuid}`)
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .send({ role: 'admin' })
      .expect(200)
      .expect(({ body }) => expect(body.role).toBe('admin'));

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/admin/packs')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${secondAdmin.body.user.uuid}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ role: 'admin' })
      .expect(200)
      .expect(({ body }) => expect(body.role).toBe('admin'));
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${secondAdmin.body.user.uuid}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ role: 'user' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${secondAdmin.body.user.uuid}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${user.body.user.uuid}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${user.body.access_token}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'deletable-user', password: 'role-test-password' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${secondAdmin.body.user.uuid}`)
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
  });

  it('reviews a release and enforces restricted pack visibility', async () => {
    const authorLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'pack-author', password: 'a-secure-password' })
      .expect(201);
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    const zip = new AdmZip();
    zip.addFile(
      'authored-pack/pack.json',
      Buffer.from(
        JSON.stringify({
          id: 'authored-pack',
          name: 'Authored Pack',
          description: 'Review workflow fixture',
          version: '1.0.0',
        }),
      ),
    );
    zip.addFile('authored-pack/README.md', Buffer.from('# Reviewed knowledge'));
    const submission = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach('file', zip.toBuffer(), 'authored-pack.zip')
      .expect(201);
    expect(submission.body.status).toBe('pending');
    const submittedMessages = await request(app.getHttpServer())
      .get('/api/messages')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    expect(submittedMessages.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'publish_submitted',
          publish_request_id: submission.body.id,
          read_at: null,
        }),
      ]),
    );
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${submission.body.id}/approve`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(201);
    const reviewedMessages = await request(app.getHttpServer())
      .get('/api/messages?filter=unread')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    expect(reviewedMessages.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'publish_submitted' }),
        expect.objectContaining({ kind: 'publish_approved' }),
      ]),
    );
    const approvedMessage = reviewedMessages.body.items.find(
      (item: { kind: string }) => item.kind === 'publish_approved',
    );
    await request(app.getHttpServer())
      .patch(`/api/messages/${approvedMessage.id}/read`)
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/messages/read')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200)
      .expect(({ body }) => expect(body.deleted).toBe(1));
    await request(app.getHttpServer()).get('/packs/authored-pack').expect(200);
    await request(app.getHttpServer())
      .patch('/api/admin/packs/authored-pack')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ visibility: 'restricted' })
      .expect(200);
    await request(app.getHttpServer()).get('/packs/authored-pack').expect(404);
    await request(app.getHttpServer())
      .get('/packs/authored-pack')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
  });

  it('notifies an author when a publish request is rejected', async () => {
    const authorLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'pack-author', password: 'a-secure-password' })
      .expect(201);
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const zip = new AdmZip();
    zip.addFile(
      'rejected-pack/pack.json',
      Buffer.from(
        JSON.stringify({
          id: 'rejected-pack',
          name: 'Rejected Pack',
          description: 'Rejection notification fixture',
          version: '1.0.0',
        }),
      ),
    );
    zip.addFile('rejected-pack/README.md', Buffer.from('# Needs work'));
    const submission = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach('file', zip.toBuffer(), 'rejected-pack.zip')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${submission.body.id}/reject`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ note: 'Add usage examples before publishing.' })
      .expect(201);
    const messages = await request(app.getHttpServer())
      .get('/api/messages')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    expect(messages.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'publish_rejected',
          publish_request_id: submission.body.id,
          body: expect.stringContaining('Add usage examples'),
        }),
      ]),
    );
  });

  it('still logs a receipt when the reviewer is the same account as the submitter', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    const packZip = (id: string, version: string) => {
      const zip = new AdmZip();
      zip.addFile(
        `${id}/pack.json`,
        Buffer.from(
          JSON.stringify({
            id,
            name: 'Self Review Pack',
            description: 'Self-review receipt fixture',
            version,
          }),
        ),
      );
      zip.addFile(`${id}/README.md`, Buffer.from(`# v${version}`));
      return zip;
    };

    const approved = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .attach(
        'file',
        packZip('self-review-approved', '1.0.0').toBuffer(),
        'self-review-approved.zip',
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${approved.body.id}/approve`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .attach(
        'file',
        packZip('self-review-rejected', '1.0.0').toBuffer(),
        'self-review-rejected.zip',
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${rejected.body.id}/reject`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ note: 'Not good enough, even from myself.' })
      .expect(201);

    const messages = await request(app.getHttpServer())
      .get('/api/messages')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(messages.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'publish_approved',
          publish_request_id: approved.body.id,
        }),
        expect.objectContaining({
          kind: 'publish_rejected',
          publish_request_id: rejected.body.id,
        }),
      ]),
    );
  });

  it('locks a pack against further submissions while any version is pending review, for anyone', async () => {
    const authorLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'pack-author', password: 'a-secure-password' })
      .expect(201);
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    const packZip = (version: string) => {
      const zip = new AdmZip();
      zip.addFile(
        'locked-pack/pack.json',
        Buffer.from(
          JSON.stringify({
            id: 'locked-pack',
            name: 'Locked Pack',
            description: 'Pack-wide lock fixture',
            version,
          }),
        ),
      );
      zip.addFile('locked-pack/README.md', Buffer.from(`# v${version}`));
      return zip;
    };
    // 0.1.0 goes through submit -> approve, so the pack exists and is free.
    const first = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach('file', packZip('0.1.0').toBuffer(), 'locked-pack-0.1.0.zip')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${first.body.id}/approve`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(201);

    // 0.2.0 submission leaves the pack with a pending request.
    const second = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach('file', packZip('0.2.0').toBuffer(), 'locked-pack-0.2.0.zip')
      .expect(201);
    expect(second.body.status).toBe('pending');

    // Resubmitting 0.2.0, and submitting a different 0.3.0, are both
    // rejected — by the original owner AND by an admin, proving there's no
    // role exception to the pack-wide lock.
    await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach(
        'file',
        packZip('0.2.0').toBuffer(),
        'locked-pack-0.2.0-again.zip',
      )
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .attach('file', packZip('0.3.0').toBuffer(), 'locked-pack-0.3.0.zip')
      .expect(409);

    const pendingStatus = await request(app.getHttpServer())
      .get('/api/publish-requests/pack/locked-pack/pending')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    expect(pendingStatus.body.pending).toEqual(
      expect.objectContaining({ id: second.body.id, version: '0.2.0' }),
    );
    const strangerLogin = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        id: 'locked-pack-stranger',
        name: 'Stranger',
        password: 'a-secure-password',
      })
      .expect(201);
    const strangerStatus = await request(app.getHttpServer())
      .get('/api/publish-requests/pack/locked-pack/pending')
      .set('Authorization', `Bearer ${strangerLogin.body.access_token}`)
      .expect(200);
    expect(strangerStatus.body.pending).toBeNull();

    // Once 0.2.0 is resolved, the lock releases and 0.3.0 succeeds.
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${second.body.id}/reject`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ note: 'Needs another look.' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach(
        'file',
        packZip('0.3.0').toBuffer(),
        'locked-pack-0.3.0-retry.zip',
      )
      .expect(201);
  });

  it('allows multiple maintainers to publish new versions for the same pack', async () => {
    const authorLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'pack-author', password: 'a-secure-password' })
      .expect(201);
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    const coMaintainer = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        id: 'co-maintainer',
        name: 'Co Maintainer',
        password: 'a-secure-password',
      })
      .expect(201);
    const packZip = (version: string) => {
      const zip = new AdmZip();
      zip.addFile(
        'shared-pack/pack.json',
        Buffer.from(
          JSON.stringify({
            id: 'shared-pack',
            name: 'Shared Pack',
            description: 'Multi-maintainer fixture',
            version,
          }),
        ),
      );
      zip.addFile('shared-pack/README.md', Buffer.from(`# v${version}`));
      return zip;
    };

    const first = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .attach('file', packZip('1.0.0').toBuffer(), 'shared-pack-1.0.0.zip')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${first.body.id}/approve`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(201);

    // Not a maintainer yet — forbidden.
    await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${coMaintainer.body.access_token}`)
      .attach(
        'file',
        packZip('1.1.0').toBuffer(),
        'shared-pack-1.1.0-denied.zip',
      )
      .expect(403);

    const users = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    const coMaintainerUuid = (
      users.body as Array<{ id: string; uuid: string }>
    ).find((u) => u.id === 'co-maintainer')!.uuid;

    await request(app.getHttpServer())
      .post(`/api/admin/packs/shared-pack/maintainers/${coMaintainerUuid}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ allowed: true })
      .expect(201);

    const packsAfterAdd = await request(app.getHttpServer())
      .get('/api/admin/packs')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    const sharedPackAfterAdd = (
      packsAfterAdd.body as Array<{
        id: string;
        maintainers: Array<{ id: string }>;
      }>
    ).find((p) => p.id === 'shared-pack')!;
    expect(sharedPackAfterAdd.maintainers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'pack-author' }),
        expect.objectContaining({ id: 'co-maintainer' }),
      ]),
    );

    // Now allowed to submit.
    await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${coMaintainer.body.access_token}`)
      .attach('file', packZip('1.1.0').toBuffer(), 'shared-pack-1.1.0.zip')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/packs/shared-pack/maintainers/${coMaintainerUuid}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ allowed: false })
      .expect(201);

    const packsAfterRemove = await request(app.getHttpServer())
      .get('/api/admin/packs')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    const sharedPackAfterRemove = (
      packsAfterRemove.body as Array<{
        id: string;
        maintainers: Array<{ id: string }>;
      }>
    ).find((p) => p.id === 'shared-pack')!;
    expect(sharedPackAfterRemove.maintainers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'co-maintainer' }),
      ]),
    );
  });

  it('deletes a single release without touching the pack, then deletes the whole pack once the last release goes', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    const packZip = (version: string) => {
      const zip = new AdmZip();
      zip.addFile(
        'multi-version-pack/pack.json',
        Buffer.from(
          JSON.stringify({
            id: 'multi-version-pack',
            name: 'Multi Version Pack',
            description: 'Version-delete fixture',
            version,
          }),
        ),
      );
      zip.addFile('multi-version-pack/README.md', Buffer.from(`# v${version}`));
      return zip;
    };
    const submitAndApprove = async (version: string) => {
      const submission = await request(app.getHttpServer())
        .post('/api/publish-requests')
        .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
        .attach(
          'file',
          packZip(version).toBuffer(),
          `multi-version-pack-${version}.zip`,
        )
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/publish-requests/${submission.body.id}/approve`)
        .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
        .expect(201);
    };
    await submitAndApprove('1.0.0');
    await submitAndApprove('1.1.0');

    // Deleting a non-last release leaves the pack (and its other version) intact.
    await request(app.getHttpServer())
      .delete('/api/admin/packs/multi-version-pack/releases/1.0.0')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/packs/multi-version-pack')
      .expect(200);
    await request(app.getHttpServer())
      .get('/packs/multi-version-pack/1.0.0')
      .expect(404);
    await request(app.getHttpServer())
      .get('/packs/multi-version-pack/1.1.0')
      .expect(200);

    // Deleting the only remaining release deletes the whole pack.
    await request(app.getHttpServer())
      .delete('/api/admin/packs/multi-version-pack/releases/1.1.0')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/packs/multi-version-pack')
      .expect(404);

    const database = app.get(DatabaseService).db;
    expect(
      database
        .prepare(
          "SELECT 1 FROM audit_log WHERE action = 'release.delete' AND target_id = ?",
        )
        .get('multi-version-pack@1.0.0'),
    ).toBeDefined();
    expect(
      database
        .prepare(
          "SELECT 1 FROM audit_log WHERE action = 'pack.delete' AND target_id = ?",
        )
        .get('multi-version-pack'),
    ).toBeDefined();
  });

  it('permanently deletes a pack while retaining reviewed and audit history', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'role-admin', password: 'role-test-password' })
      .expect(201);
    const zip = new AdmZip();
    zip.addFile(
      'disposable-pack/pack.json',
      Buffer.from(
        JSON.stringify({
          id: 'disposable-pack',
          name: 'Disposable Pack',
          description: 'Permanent deletion fixture',
          version: '1.0.0',
        }),
      ),
    );
    zip.addFile('disposable-pack/README.md', Buffer.from('# Disposable'));
    const upload = await request(app.getHttpServer())
      .post('/api/admin/packs/upload')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .attach('file', zip.toBuffer(), 'disposable-pack.zip')
      .expect(201);
    expect(upload.body.status).toBe('pending');
    const publication = await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${upload.body.id}/approve`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(201);
    expect(publication.body.status).toBe('approved');
    const nextVersion = new AdmZip();
    nextVersion.addFile(
      'disposable-pack/pack.json',
      Buffer.from(
        JSON.stringify({
          id: 'disposable-pack',
          name: 'Disposable Pack',
          description: 'Pending deletion fixture',
          version: '1.1.0',
        }),
      ),
    );
    nextVersion.addFile(
      'disposable-pack/README.md',
      Buffer.from('# Pending disposable release'),
    );
    const pending = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .attach('file', nextVersion.toBuffer(), 'disposable-pack-1.1.0.zip')
      .expect(201);
    expect(pending.body.status).toBe('pending');
    const database = app.get(DatabaseService).db;
    const staged = database
      .prepare('SELECT staging_path FROM publish_requests WHERE id = ?')
      .get(pending.body.id) as { staging_path: string };
    const projectPath = path.join(registryPath, 'disposable-pack');
    await expect(fs.stat(projectPath)).resolves.toBeDefined();

    await request(app.getHttpServer())
      .delete('/api/admin/packs/disposable-pack')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/packs/disposable-pack')
      .expect(404);
    await expect(fs.stat(projectPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const history = await request(app.getHttpServer())
      .get('/api/publish-requests/mine')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: publication.body.id,
          pack_id: 'disposable-pack',
          status: 'approved',
        }),
      ]),
    );
    expect(history.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pending.body.id }),
      ]),
    );
    await expect(fs.stat(staged.staging_path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(
      database
        .prepare('SELECT 1 FROM messages WHERE publish_request_id = ?')
        .get(pending.body.id),
    ).toBeUndefined();
    expect(
      database
        .prepare(
          "SELECT 1 FROM audit_log WHERE action = 'pack.delete' AND target_id = ?",
        )
        .get('disposable-pack'),
    ).toBeDefined();
  });

  it('keeps the managed superuser locked after bootstrap variables are removed', async () => {
    await app.close();
    const id = process.env.SUPERUSER_ID;
    const password = process.env.SUPERUSER_PASSWORD;
    const name = process.env.SUPERUSER_NAME;
    delete process.env.SUPERUSER_ID;
    delete process.env.SUPERUSER_PASSWORD;
    delete process.env.SUPERUSER_NAME;
    try {
      const moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      await app.init();
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ id: 'root-admin', password: 'test-superuser-password' })
        .expect(201);
      expect(login.body.user).toMatchObject({
        id: 'root-admin',
        name: 'Root Admin',
        role: 'superuser',
        managed: true,
      });
    } finally {
      if (id) process.env.SUPERUSER_ID = id;
      if (password) process.env.SUPERUSER_PASSWORD = password;
      if (name) process.env.SUPERUSER_NAME = name;
    }
  });
});
