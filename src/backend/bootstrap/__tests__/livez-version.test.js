/** /livez reports the deployed commit when known (staging smoke waits on it). */
import request from 'supertest';
import { bootstrap } from '../main.js';

describe('/livez version', () => {
  test.each([
    [{ GIT_SHA: 'abc1234' }, 'abc1234'],
    [{ RAILWAY_GIT_COMMIT_SHA: 'def5678' }, 'def5678'],
    [{ GIT_SHA: 'abc1234', RAILWAY_GIT_COMMIT_SHA: 'def5678' }, 'abc1234'],
    [{}, undefined],
  ])('%p → %p', async (env, version) => {
    const b = await bootstrap({ JWT_SECRET: 'v', LOG_LEVEL: 'error', NODE_ENV: 'test', ...env });
    try {
      const res = await request(b.app).get('/livez').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBe(version);
    } finally {
      await b.shutdown();
    }
  });
});
