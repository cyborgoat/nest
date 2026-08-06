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
    await fs.mkdir(path.join(registryPath, 'getting-started'), {
      recursive: true,
    });
    await fs.cp(
      path.resolve(
        __dirname,
        '../../../examples/knowledge-packs/getting-started/1.0.0',
      ),
      path.join(registryPath, 'getting-started', '1.0.0'),
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
    process.env.MIN_PASSWORD_LENGTH = '8';
    process.env.DEFAULT_RESET_PASSWORD = 'test-default-reset-password';
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
    expect(packs).toHaveLength(1);
    const gettingStarted = packs.find((p) => p.id === 'getting-started');
    expect(gettingStarted).toBeDefined();
    expect(gettingStarted!.latest_version).toBe('1.0.0');
    expect(gettingStarted!.versions).toEqual(['1.0.0']);
  });

  it('/packs/:id/:version (GET)', async () => {
    const res = await request(app.getHttpServer())
      .get('/packs/getting-started/1.0.0')
      .expect(200);
    const release = res.body as PackRelease;
    expect(release.id).toBe('getting-started');
    expect(release.version).toBe('1.0.0');
    expect(release.path).toBe('getting-started');
  });

  it('/packs/:id/download (GET) latest', async () => {
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
      .get('/packs/getting-started/1.0.0/download')
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
      'getting-started-1.0.0.zip',
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

  it('marks session cookies secure only for HTTPS requests', async () => {
    const credentials = {
      id: 'root-admin',
      password: 'test-superuser-password',
    };
    const httpLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(credentials)
      .expect(201);
    expect(String(httpLogin.headers['set-cookie'])).not.toContain('Secure');

    const httpsLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send(credentials)
      .expect(201);
    expect(String(httpsLogin.headers['set-cookie'])).toContain('Secure');
  });

  it('returns the configured password requirement when registration is too short', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ id: 'short-password', password: 'short', name: 'Short' })
      .expect(409);
    expect(response.body.message).toBe(
      'Password must contain at least 8 characters',
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
      .post('/api/publish-requests/releases')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .field('commit_message', 'Add the initial reviewed knowledge')
      .attach('file', zip.toBuffer(), 'authored-pack.zip')
      .expect(201);
    expect(submission.body.status).toBe('pending');
    expect(submission.body.commit_message).toBe(
      'Add the initial reviewed knowledge',
    );
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
      .send({ note: 'Documentation and validation checks passed.' })
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

  it('reviews and serves a live patch without changing SemVer', async () => {
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
    zip.addFile(
      'authored-pack/README.md',
      Buffer.from('# Reviewed knowledge\n\nPatched guidance.'),
    );
    await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .field('request_type', 'live_patch')
      .field('target_version', '1.0.0')
      .attach('file', zip.toBuffer(), 'authored-pack-patch.zip')
      .expect(409);
    const submission = await request(app.getHttpServer())
      .post('/api/publish-requests/live-patches/authored-pack/1.0.0')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .field('commit_message', 'Correct the reviewed guidance')
      .attach('file', zip.toBuffer(), 'authored-pack-patch.zip')
      .expect(201);
    expect(submission.body).toMatchObject({
      request_type: 'live_patch',
      commit_message: 'Correct the reviewed guidance',
      version: '1.0.0',
      base_patch_revision: 0,
      patch_revision: 1,
    });
    const queue = await request(app.getHttpServer())
      .get('/api/admin/publish-requests')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(queue.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: submission.body.id,
          request_type: 'live_patch',
          commit_message: 'Correct the reviewed guidance',
          pack_id: 'authored-pack',
          version: '1.0.0',
          patch_revision: 1,
        }),
      ]),
    );
    const review = await request(app.getHttpServer())
      .get(`/api/admin/publish-requests/${submission.body.id}/review`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(review.body).toMatchObject({
      request_type: 'live_patch',
      commit_message: 'Correct the reviewed guidance',
      base_version: '1.0.0',
      base_patch_revision: 0,
      patch_revision: 1,
      diff_available: true,
    });
    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${submission.body.id}/approve`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ note: 'Safe live correction.' })
      .expect(201);
    const download = await request(app.getHttpServer())
      .get('/packs/authored-pack/1.0.0/download')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    expect(download.headers['x-pack-patch-revision']).toBe('1');
    const project = await request(app.getHttpServer())
      .get('/packs/authored-pack')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200);
    expect(project.body.latest_version).toBe('1.0.0');
    expect(project.body.releases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: '1.0.0',
          patch_revision: 1,
        }),
      ]),
    );
  });

  it('serves durable browser diffs for text, images, and rejected requests', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const zip = new AdmZip();
    zip.addFile(
      'getting-started/pack.json',
      Buffer.from(
        JSON.stringify({
          id: 'getting-started',
          name: 'Getting Started',
          description: 'Browser review fixture',
          version: '1.0.1',
        }),
      ),
    );
    zip.addFile(
      'getting-started/README.md',
      Buffer.from('# Getting Started\n\nUpdated review content.\n'),
    );
    zip.addFile(
      'getting-started/guides/new-review-guide.md',
      Buffer.from('# New review guide\n'),
    );
    zip.addFile(
      'getting-started/images/review.png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const submission = await request(app.getHttpServer())
      .post('/api/publish-requests')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .attach('file', zip.toBuffer(), 'getting-started-1.0.1.zip')
      .expect(201);

    const reviewUrl = `/api/admin/publish-requests/${submission.body.id}/review`;
    const detail = await request(app.getHttpServer())
      .get(reviewUrl)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      base_version: '1.0.0',
      diff_available: true,
      status: 'pending',
      summary: {
        added_files: 2,
        modified_files: 2,
      },
    });
    expect(detail.body.summary.deleted_files).toBeGreaterThan(0);
    expect(detail.body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'README.md',
          status: 'modified',
          kind: 'text',
        }),
        expect.objectContaining({
          path: 'guides/new-review-guide.md',
          status: 'added',
          kind: 'text',
        }),
        expect.objectContaining({
          path: 'images/review.png',
          status: 'added',
          kind: 'image',
        }),
      ]),
    );

    const text = await request(app.getHttpServer())
      .get(`${reviewUrl}/file`)
      .query({ path: 'README.md' })
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(text.body.kind).toBe('text');
    expect(text.body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'added',
          content: 'Updated review content.',
        }),
      ]),
    );
    await request(app.getHttpServer())
      .get(`${reviewUrl}/image`)
      .query({ path: 'images/review.png', side: 'new' })
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect('Content-Type', /image\/png/)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${reviewUrl}/file`)
      .query({ path: '../pack.json' })
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/admin/publish-requests/${submission.body.id}/reject`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .send({ note: 'Please revise the new guide.' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/admin/publish-requests/${submission.body.id}/download`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(reviewUrl)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('rejected');
        expect(body.diff_available).toBe(true);
        expect(body.files.length).toBeGreaterThan(0);
      });
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
    expect(pendingStatus.body.can_cancel).toBe(true);
    const adminPendingStatus = await request(app.getHttpServer())
      .get('/api/publish-requests/pack/locked-pack/pending')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(200);
    expect(adminPendingStatus.body.can_cancel).toBe(false);
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

    await request(app.getHttpServer())
      .delete(`/api/publish-requests/${second.body.id}`)
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .expect(403);

    // Once the original submitter cancels 0.2.0, the lock releases and
    // 0.3.0 succeeds. The cancelled request is no longer addressable.
    await request(app.getHttpServer())
      .delete(`/api/publish-requests/${second.body.id}`)
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          success: true,
          request_id: second.body.id,
          pack_id: 'locked-pack',
        });
      });
    await request(app.getHttpServer())
      .get(`/api/publish-requests/${second.body.id}`)
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/publish-requests/${first.body.id}`)
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .expect(409);
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
    const pendingId = String(pending.body.id);
    const database = app.get(DatabaseService).db;
    const staged = database
      .prepare('SELECT staging_path FROM publish_requests WHERE id = ?')
      .get(pendingId) as { staging_path: string };
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
        .get(pendingId),
    ).toBeUndefined();
    expect(
      database
        .prepare(
          "SELECT 1 FROM audit_log WHERE action = 'pack.delete' AND target_id = ?",
        )
        .get('disposable-pack'),
    ).toBeDefined();
  });

  it('resynchronizes manual registry changes without overwriting administrative settings', async () => {
    const rootLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const authorLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'pack-author', password: 'a-secure-password' })
      .expect(201);
    const authorization = `Bearer ${rootLogin.body.access_token}`;
    const packRoot = path.join(registryPath, 'manual-sync-pack');
    const writeRelease = async (
      version: string,
      name: string,
      description: string,
      id = 'manual-sync-pack',
    ) => {
      const releaseRoot = path.join(packRoot, version);
      await fs.mkdir(releaseRoot, { recursive: true });
      await fs.writeFile(
        path.join(releaseRoot, 'pack.json'),
        JSON.stringify({ id, name, description, version }),
      );
      await fs.writeFile(path.join(releaseRoot, 'README.md'), `# ${name}\n`);
    };

    await request(app.getHttpServer())
      .post('/api/admin/packs/resync')
      .set('Authorization', `Bearer ${authorLogin.body.access_token}`)
      .send({})
      .expect(403);

    await writeRelease('1.0.0', 'Manual Pack', 'Initial metadata');
    const first = await request(app.getHttpServer())
      .post('/api/admin/packs/resync')
      .set('Authorization', authorization)
      .send({})
      .expect(201);
    expect(first.body).toMatchObject({
      packs_added: ['manual-sync-pack'],
      releases_added: ['manual-sync-pack@1.0.0'],
      issues: [],
    });

    await request(app.getHttpServer())
      .patch('/api/admin/packs/manual-sync-pack')
      .set('Authorization', authorization)
      .send({ visibility: 'restricted', archived: true })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/api/admin/packs/manual-sync-pack/maintainers/${authorLogin.body.user.uuid}`,
      )
      .set('Authorization', authorization)
      .send({ allowed: true })
      .expect(201);

    await fs.rm(path.join(packRoot, '1.0.0'), {
      recursive: true,
      force: true,
    });
    await writeRelease('1.1.0', 'Manual Pack Updated', 'Current metadata');
    await writeRelease(
      '2.0.0',
      'Broken Manual Pack',
      'Should not replace metadata',
      'wrong-id',
    );
    const second = await request(app.getHttpServer())
      .post('/api/admin/packs/resync')
      .set('Authorization', authorization)
      .send({})
      .expect(201);
    expect(second.body.packs_updated).toEqual(['manual-sync-pack']);
    expect(second.body.releases_added).toEqual(['manual-sync-pack@1.1.0']);
    expect(second.body.releases_removed).toEqual(['manual-sync-pack@1.0.0']);
    expect(second.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'manual-sync-pack/2.0.0' }),
      ]),
    );
    expect(JSON.stringify(second.body.issues)).not.toContain(registryPath);

    await request(app.getHttpServer())
      .post('/api/admin/packs/manual-sync-pack/releases/1.1.0/yank')
      .set('Authorization', authorization)
      .send({ yanked: true })
      .expect(201);
    const packs = await request(app.getHttpServer())
      .get('/api/admin/packs')
      .set('Authorization', authorization)
      .expect(200);
    expect(packs.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manual-sync-pack',
          name: 'Manual Pack Updated',
          description: 'Current metadata',
          visibility: 'restricted',
          archived: true,
          releases: [
            expect.objectContaining({ version: '1.1.0', yanked: true }),
          ],
          maintainers: [expect.objectContaining({ id: 'pack-author' })],
        }),
      ]),
    );

    await writeRelease(
      '1.1.0',
      'Temporarily Invalid',
      'Existing row must survive',
      'wrong-id',
    );
    const invalidExisting = await request(app.getHttpServer())
      .post('/api/admin/packs/resync')
      .set('Authorization', authorization)
      .send({})
      .expect(201);
    expect(invalidExisting.body.releases_removed).not.toContain(
      'manual-sync-pack@1.1.0',
    );
    const preserved = await request(app.getHttpServer())
      .get('/api/admin/packs')
      .set('Authorization', authorization)
      .expect(200);
    expect(
      preserved.body.find(
        (pack: { id: string }) => pack.id === 'manual-sync-pack',
      ).releases,
    ).toEqual([expect.objectContaining({ version: '1.1.0', yanked: true })]);

    await fs.rm(path.join(packRoot, '1.1.0'), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(packRoot, '2.0.0'), {
      recursive: true,
      force: true,
    });
    const emptied = await request(app.getHttpServer())
      .post('/api/admin/packs/resync')
      .set('Authorization', authorization)
      .send({})
      .expect(201);
    expect(emptied.body.releases_removed).toEqual(['manual-sync-pack@1.1.0']);
    expect(emptied.body.packs_removed).not.toContain('manual-sync-pack');

    await fs.rm(packRoot, { recursive: true, force: true });
    const removed = await request(app.getHttpServer())
      .post('/api/admin/packs/resync')
      .set('Authorization', authorization)
      .send({})
      .expect(201);
    expect(removed.body.packs_removed).toEqual(['manual-sync-pack']);
    expect(
      app
        .get(DatabaseService)
        .db.prepare(
          "SELECT 1 FROM audit_log WHERE action = 'registry.resync' AND actor_uuid = ?",
        )
        .get(String(rootLogin.body.user.uuid)),
    ).toBeDefined();

    const database = app.get(DatabaseService).db;
    const beforeUnavailable = (
      database.prepare('SELECT COUNT(*) AS count FROM packs').get() as {
        count: number;
      }
    ).count;
    const unavailablePath = `${registryPath}-unavailable`;
    await fs.rename(registryPath, unavailablePath);
    try {
      await request(app.getHttpServer())
        .post('/api/admin/packs/resync')
        .set('Authorization', authorization)
        .send({})
        .expect(503);
      const afterUnavailable = (
        database.prepare('SELECT COUNT(*) AS count FROM packs').get() as {
          count: number;
        }
      ).count;
      expect(afterUnavailable).toBe(beforeUnavailable);
    } finally {
      await fs.rename(unavailablePath, registryPath);
    }
  });

  it('lists filtered review history with comments, identities, and cursors', async () => {
    const rootLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const firstPage = await request(app.getHttpServer())
      .get('/api/admin/publish-requests/history?status=all&limit=1')
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.next_cursor).toEqual(expect.any(String));
    const historyCursor = String(firstPage.body.next_cursor);
    const secondPage = await request(app.getHttpServer())
      .get(
        `/api/admin/publish-requests/history?status=all&limit=1&cursor=${encodeURIComponent(historyCursor)}`,
      )
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);

    const approved = await request(app.getHttpServer())
      .get('/api/admin/publish-requests/history?status=approved')
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    expect(approved.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pack_id: 'authored-pack',
          status: 'approved',
          submitter_id: 'pack-author',
          reviewer_id: 'role-admin',
          review_note: 'Documentation and validation checks passed.',
        }),
      ]),
    );

    const rejected = await request(app.getHttpServer())
      .get('/api/admin/publish-requests/history?status=rejected')
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    expect(rejected.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pack_id: 'rejected-pack',
          status: 'rejected',
          submitter_id: 'pack-author',
          reviewer_id: 'root-admin',
          review_note: 'Add usage examples before publishing.',
        }),
      ]),
    );
    await request(app.getHttpServer())
      .get('/api/admin/publish-requests/history?status=unknown')
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(400);
  });

  it('retains submitter identity snapshots after account deletion', async () => {
    const rootLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const users = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    const author = users.body.find(
      (user: { id: string }) => user.id === 'pack-author',
    );
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${author.uuid}`)
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    const history = await request(app.getHttpServer())
      .get('/api/admin/publish-requests/history?status=rejected')
      .set('Authorization', `Bearer ${rootLogin.body.access_token}`)
      .expect(200);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pack_id: 'rejected-pack',
          submitter_id: 'pack-author',
          submitter_name: 'Pack Author',
        }),
      ]),
    );
  });

  it('refreshes the managed superuser password from the environment', async () => {
    const database = app.get(DatabaseService).db;
    database
      .prepare(
        "UPDATE users SET password_hash = '$argon2id$legacy-development-hash' WHERE managed_by_env = 1",
      )
      .run();
    await app.close();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ id: 'root-admin', password: 'test-superuser-password' })
      .expect(201);
    const refreshed = app
      .get(DatabaseService)
      .db.prepare('SELECT password_hash FROM users WHERE managed_by_env = 1')
      .get() as { password_hash: string };
    expect(refreshed.password_hash).toMatch(/^scrypt:v1:/);
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
