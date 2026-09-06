import assert from 'node:assert/strict';
import { test } from 'node:test';

import { POST as postWidgetToken } from '@/app/api/v1/widget/token/route';
import { GET as getKeepAlive } from '@/app/api/v1/hmr/keepalive/route';
import { GET as getTtlSweep } from '@/app/api/v1/cron/ttl-sweep/route';
import { GET as getWidgetScript } from '@/app/api/v1/widget/script/route';
import { createWidgetEmbedToken, verifyWidgetEmbedToken } from '@/lib/server/widget-embed';

test('widget token refuses requests without an Origin', async () => {
  const response = await postWidgetToken(
    new Request('http://localhost/api/v1/widget/token', { method: 'POST', body: '{}' }),
  );
  assert.equal(response.status, 403);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, 'UNAUTHORIZED_DOMAIN');
});

test('widget script refuses a missing token', async () => {
  const response = await getWidgetScript(new Request('http://localhost/api/v1/widget/script'));
  assert.equal(response.status, 400);
});

test('keep-alive and TTL sweep require CRON_SECRET', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;

  const keepAlive = await getKeepAlive(new Request('http://localhost/api/v1/hmr/keepalive'));
  const ttlSweep = await getTtlSweep(new Request('http://localhost/api/v1/cron/ttl-sweep'));
  assert.equal(keepAlive.status, 503);
  assert.equal(ttlSweep.status, 503);

  process.env.CRON_SECRET = 'cron-secret-value-ok';
  const unauthorized = await getTtlSweep(
    new Request('http://localhost/api/v1/cron/ttl-sweep', {
      headers: { authorization: 'Bearer totally-not-the-secret' },
    }),
  );
  assert.equal(unauthorized.status, 401);

  if (previous === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = previous;
  }
});

test('widget embed tokens round-trip and reject tampering', () => {
  const previous = process.env.WIDGET_EMBED_SIGNING_SECRET;
  process.env.WIDGET_EMBED_SIGNING_SECRET = 'widget-embed-signing-secret-32chars!!';
  const tenantId = '550e8400-e29b-41d4-a716-446655440000';
  const token = createWidgetEmbedToken(tenantId, 'TEE-1');
  const claims = verifyWidgetEmbedToken(token);

  assert.ok(claims);
  assert.equal(claims.tenantId, tenantId);
  assert.equal(claims.sku, 'TEE-1');
  assert.equal(verifyWidgetEmbedToken(`${token}x`), null);

  if (previous === undefined) {
    delete process.env.WIDGET_EMBED_SIGNING_SECRET;
  } else {
    process.env.WIDGET_EMBED_SIGNING_SECRET = previous;
  }
});
