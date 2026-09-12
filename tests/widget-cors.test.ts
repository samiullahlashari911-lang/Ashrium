import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isWidgetApiPath,
  isWidgetPreflightOrigin,
  resolveApiCorsOrigin,
} from '@/lib/server/widget-cors';

const APP = 'https://www.ashrium.org';
const SHOP = 'https://brand.example';

test('widget API paths include token, available, and script', () => {
  assert.equal(isWidgetApiPath('/api/v1/widget/available'), true);
  assert.equal(isWidgetApiPath('/api/v1/widget/token'), true);
  assert.equal(isWidgetApiPath('/api/v1/widget/script'), true);
  assert.equal(isWidgetApiPath('/api/v1/widget'), true);
  assert.equal(isWidgetApiPath('/api/v1/hmr/status'), false);
  assert.equal(isWidgetApiPath('/api/v1/catalog/sync'), false);
});

test('widget preflight origins must be exact https origins', () => {
  assert.equal(isWidgetPreflightOrigin(SHOP), true);
  assert.equal(isWidgetPreflightOrigin('https://www.brand.com'), true);
  assert.equal(isWidgetPreflightOrigin('http://brand.example'), false);
  assert.equal(isWidgetPreflightOrigin('https://brand.example/products/tee'), false);
  assert.equal(isWidgetPreflightOrigin('null'), false);
  assert.equal(isWidgetPreflightOrigin(null), false);
});

test('OPTIONS for widget routes is 204 for a new https shop origin not on ASHRIUM_ALLOWED_ORIGINS', () => {
  assert.equal(
    resolveApiCorsOrigin({
      configuredOrigins: [],
      isDevelopment: false,
      origin: SHOP,
      pathname: '/api/v1/widget/available',
      requestOrigin: APP,
    }),
    SHOP,
  );
  assert.equal(
    resolveApiCorsOrigin({
      configuredOrigins: [],
      isDevelopment: false,
      origin: SHOP,
      pathname: '/api/v1/widget/token',
      requestOrigin: APP,
    }),
    SHOP,
  );
});

test('OPTIONS for non-widget APIs stays 403 unless the origin is configured', () => {
  assert.equal(
    resolveApiCorsOrigin({
      configuredOrigins: [],
      isDevelopment: false,
      origin: SHOP,
      pathname: '/api/v1/hmr/status',
      requestOrigin: APP,
    }),
    null,
  );
  assert.equal(
    resolveApiCorsOrigin({
      configuredOrigins: [SHOP],
      isDevelopment: false,
      origin: SHOP,
      pathname: '/api/v1/hmr/status',
      requestOrigin: APP,
    }),
    SHOP,
  );
});

test('widget OPTIONS without Origin or with http stays 403', () => {
  assert.equal(
    resolveApiCorsOrigin({
      configuredOrigins: [],
      isDevelopment: false,
      origin: null,
      pathname: '/api/v1/widget/available',
      requestOrigin: APP,
    }),
    null,
  );
  assert.equal(
    resolveApiCorsOrigin({
      configuredOrigins: [],
      isDevelopment: false,
      origin: 'http://brand.example',
      pathname: '/api/v1/widget/available',
      requestOrigin: APP,
    }),
    null,
  );
});
