/**
 * Published template versions are immutable (roadmap P9).
 *
 * Publishing used to upsert: re-publishing (key, version) silently replaced
 * a published template, and concurrent "publish next version" calls both
 * wrote the same version (last writer won). Now identical content is an
 * idempotent no-op, different content is 409, and the write is create-only.
 */
import request from 'supertest';
import { bootstrap } from '../main.js';
import { InMemoryWorkflowTemplateRepository } from '../../contexts/workflow-orchestration/infrastructure/persistence/inmemory-workflow-template-repository.js';
import { CachedWorkflowTemplateRepository } from '../../contexts/workflow-orchestration/infrastructure/persistence/cached-workflow-template-repository.js';
import { WorkflowTemplate } from '../../contexts/workflow-orchestration/domain/template/workflow-template.js';
import { TemplateVersionExistsError } from '../../contexts/workflow-orchestration/domain/errors.js';

const draft = (version, name = 'T') => {
  const t = WorkflowTemplate.draft({ key: 'imm-flow', version, name, now: new Date() });
  t.addStep({ name: 'a', kind: 'automated' });
  t.publish({ now: new Date(), actor: { type: 'system' } });
  return t;
};

describe('template repository createOnly', () => {
  test('in-memory: second create of the same (key, version) is refused; plain save still updates', async () => {
    const repo = new InMemoryWorkflowTemplateRepository();
    await repo.save(draft(1), { createOnly: true });
    await expect(repo.save(draft(1, 'other'), { createOnly: true })).rejects.toBeInstanceOf(TemplateVersionExistsError);
    expect((await repo.findVersion('imm-flow', 1)).name).toBe('T');
    await repo.save(draft(1, 'updated')); // deprecate path: plain save
    expect((await repo.findVersion('imm-flow', 1)).name).toBe('updated');
  });

  test('the caching decorator forwards createOnly (it used to drop the options)', async () => {
    const inner = new InMemoryWorkflowTemplateRepository();
    const cached = new CachedWorkflowTemplateRepository({ delegate: inner });
    await cached.save(draft(1), { createOnly: true });
    await expect(cached.save(draft(1, 'other'), { createOnly: true })).rejects.toBeInstanceOf(TemplateVersionExistsError);
  });
});

describe('publish over HTTP (booted app)', () => {
  let booted; let auth;
  const body = (over = {}) => ({ key: 'invoice-flow', name: 'Invoice', steps: [{ name: 'collect', kind: 'automated' }, { name: 'approve', kind: 'human' }], ...over });
  const publish = (b) => request(booted.app).post('/api/v1/workflows/templates').set('Authorization', auth).send(b);

  beforeAll(async () => {
    booted = await bootstrap({ JWT_SECRET: 'tpl-secret', LOG_LEVEL: 'error', NODE_ENV: 'test' });
    const reg = await booted.ctx.identity.useCases.registerUser.execute({ email: 'tpl@example.com', username: 'tpl_admin', password: 'template admin passphrase', role: 'admin' });
    const { token } = await booted.ctx.identity.tokenIssuer.issueAccess({ sub: reg.id, role: 'admin', sid: 'tpl' }, 900);
    auth = `Bearer ${token}`;
  });
  afterAll(() => booted?.shutdown());

  test('first publish creates; identical re-publish is an idempotent no-op', async () => {
    expect((await publish(body({ version: 1 })).expect(201)).body.data).toEqual({ key: 'invoice-flow', version: 1, status: 'published' });
    expect((await publish(body({ version: 1 })).expect(201)).body.data).toEqual({ key: 'invoice-flow', version: 1, status: 'published' });
  });

  test('re-publishing an existing version with different content → 409, original untouched', async () => {
    const res = await publish(body({ version: 1, name: 'Hijacked', steps: [{ name: 'only', kind: 'automated' }] }));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/already published/);
    const current = await request(booted.app).get('/api/v1/workflows/templates/invoice-flow?version=1').set('Authorization', auth).expect(200);
    expect(current.body.data.template.name).toBe('Invoice');
    expect(current.body.data.template.steps).toHaveLength(2);
  });

  test('omitting the version publishes the next one; old versions stay as they were', async () => {
    const res = await publish(body({ name: 'Invoice v2' })).expect(201);
    expect(res.body.data.version).toBe(2);
    const v1 = await request(booted.app).get('/api/v1/workflows/templates/invoice-flow?version=1').set('Authorization', auth).expect(200);
    expect(v1.body.data.template.name).toBe('Invoice');
  });

  test('concurrent "publish next version" with different content never share a version', async () => {
    const results = await Promise.all([
      publish(body({ key: 'race-flow', name: 'A' })),
      publish(body({ key: 'race-flow', name: 'B' })),
    ]);
    // Either one loses with 409, or they land on different versions — but two
    // different templates never both claim the same (key, version).
    const ok = results.filter((r) => r.status === 201).map((r) => r.body.data.version);
    expect(new Set(ok).size).toBe(ok.length);
    for (const r of results) expect([201, 409]).toContain(r.status);
    for (const v of ok) {
      const t = await request(booted.app).get(`/api/v1/workflows/templates/race-flow?version=${v}`).set('Authorization', auth).expect(200);
      expect(['A', 'B']).toContain(t.body.data.template.name);
    }
  });

  test('deprecating a version is still allowed and does not touch other versions', async () => {
    await request(booted.app).post('/api/v1/workflows/templates/invoice-flow/deprecate').set('Authorization', auth).send({ version: 1 }).expect(200);
    const current = await request(booted.app).get('/api/v1/workflows/templates/invoice-flow').set('Authorization', auth).expect(200);
    expect(current.body.data.template).toMatchObject({ version: 2, status: 'published' });
  });
});
