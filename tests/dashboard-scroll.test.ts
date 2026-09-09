import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { isViewportRenderActive } from '@/lib/graphics/viewport-activity';
import { glassTokens } from '@/lib/design-tokens';

const root = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('WebGL and capture pause unless the element is on-screen and the document is visible', () => {
  assert.equal(
    isViewportRenderActive({ documentHidden: false, isIntersecting: true }),
    true,
  );
  assert.equal(
    isViewportRenderActive({ documentHidden: true, isIntersecting: true }),
    false,
  );
  assert.equal(
    isViewportRenderActive({ documentHidden: false, isIntersecting: false }),
    false,
  );
});

test('debug garment previews default to a still mesh', () => {
  assert.match(
    readSource('components/dashboard/garments-workspace.tsx'),
    /autoRotate:\s*false/,
  );
  assert.match(
    readSource('app/(dashboard)/sandbox/sandbox-preview.tsx'),
    /autoRotate:\s*false/,
  );
  assert.doesNotMatch(
    readSource('components/dashboard/garments-workspace.tsx'),
    /autoRotate:\s*true/,
  );
  assert.doesNotMatch(
    readSource('app/(dashboard)/sandbox/sandbox-preview.tsx'),
    /autoRotate:\s*true/,
  );
});

test('canvases and capture subscribe to viewport activity before scheduling frames', () => {
  const vfr = readSource('components/vfr/vfr-canvas.tsx');
  const anny = readSource('components/vfr/anny-canvas.tsx');
  const capture = readSource('components/widget/guided-capture/capture-viewport.tsx');

  assert.match(vfr, /subscribeViewportActivity/);
  assert.match(vfr, /stopLoop\(\)/);
  assert.match(anny, /subscribeViewportActivity/);
  assert.match(anny, /stopLoop\(\)/);
  assert.match(capture, /subscribeViewportActivity/);
  assert.match(capture, /viewportActiveRef/);
  assert.match(capture, /videoRef\.current\?\.pause\(\)/);
  assert.match(capture, /POSE_DETECT_INTERVAL_MS/);
  assert.match(capture, /lastGateRef/);
  assert.match(readSource('lib/graphics/viewport-activity.ts'), /let isIntersecting = false/);
});

test('sandbox defers vfr-widget.js until the Try On panel intersects the viewport', () => {
  const sandbox = readSource('app/(dashboard)/sandbox/storefront-sandbox.tsx');
  assert.match(sandbox, /IntersectionObserver/);
  assert.match(sandbox, /widgetHostVisible/);
  assert.match(sandbox, /getBoundingClientRect/);
  assert.match(sandbox, /if \(!mount \|\| !initialSku \|\| !widgetHostVisible\)/);
  assert.match(sandbox, /Try On loads when this panel is on screen/);
});

test('dashboard glass and sticky nav do not use backdrop-filter', () => {
  const css = readSource('app/globals.css');
  const nav = readSource('app/(dashboard)/dashboard-navigation.tsx');
  const layout = readSource('app/(dashboard)/layout.tsx');
  const atmosphere = readSource('components/theme/atmosphere-backdrop.tsx');

  assert.equal(glassTokens.dashboardBlurPx, 0);
  assert.match(layout, /surface="dashboard"/);
  assert.match(css, /\.dashboard-surface \.obsidian-glass/);
  assert.match(css, /backdrop-filter:\s*none/);
  assert.match(css, /html:has\(\.dashboard-surface\)/);
  assert.doesNotMatch(nav, /backdrop-blur/);
  assert.match(atmosphere, /if \(isDashboard\)/);
  assert.match(atmosphere, /h-\[240px\]/);
});
