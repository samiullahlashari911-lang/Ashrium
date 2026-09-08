(function () {
  'use strict';

  if (window.__ASHRIUM_VFR_WIDGET__) return;

  var script = document.currentScript;
  if (!script) return;

  var token = script.getAttribute('data-embed-token');
  if (!token) {
    console.error('[Ashrium VFR] data-embed-token is required.');
    return;
  }

  var scriptUrl = new URL(script.src, window.location.href);
  var widgetOrigin = scriptUrl.origin;
  var sku = script.getAttribute('data-sku') || '';
  var allowGallery = script.getAttribute('data-allow-gallery') === 'true';
  var root = document.getElementById('vfr-widget-root');

  if (root) return;

  root = document.createElement('div');
  root.id = 'vfr-widget-root';
  root.style.all = 'initial';

  var shadow = root.attachShadow({ mode: 'closed' });
  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '.vfr-shell{box-sizing:border-box;display:block;width:100%;min-height:420px;overflow:auto;',
    'border-radius:16px;background:#0B0B1E;box-shadow:0 12px 36px rgba(8,6,28,.45)}',
    '.vfr-frame{display:block;width:100%;height:clamp(640px,85vw,820px);border:0;background:#0B0B1E}',
  ].join('');

  var frame = document.createElement('iframe');
  var frameUrl = new URL('/widget/embed', widgetOrigin);
  frameUrl.searchParams.set('token', token);
  frameUrl.searchParams.set('parent_origin', window.location.origin);
  if (sku) frameUrl.searchParams.set('sku', sku);
  if (allowGallery) frameUrl.searchParams.set('allow_gallery', '1');

  frame.className = 'vfr-frame';
  frame.title = 'Ashrium Virtual Fitting Room';
  frame.loading = 'lazy';
  frame.allow = 'camera; fullscreen';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  // Do not set sandbox. allow-scripts + allow-same-origin already voids it
  // (Chrome warns it can escape), and without allow-forms Chrome blocks
  // every form submit to '' — including consent Next. Isolation stays:
  // iframe document + embed token + origin allowlist; no merchant creds.
  frame.src = frameUrl.toString();

  var shell = document.createElement('div');
  shell.className = 'vfr-shell';
  shell.appendChild(frame);
  shadow.appendChild(style);
  shadow.appendChild(shell);

  script.parentNode.insertBefore(root, script.nextSibling);
  window.__ASHRIUM_VFR_WIDGET__ = true;

  function send(type, payload) {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { source: 'ashrium-vfr', type: type, payload: payload },
      widgetOrigin,
    );
  }

  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== widgetOrigin) return;

    var message = event.data;
    if (!message || message.source !== 'ashrium-vfr' || typeof message.type !== 'string') return;

    if (message.type === 'VFR_RESIZE_VIEWPORT' && message.payload) {
      var height = Number(message.payload.height);
      if (Number.isFinite(height) && height >= 420 && height <= 900) {
        frame.style.height = height + 'px';
      }
    }

    root.dispatchEvent(
      new CustomEvent('ashrium:vfr:' + message.type.toLowerCase(), { detail: message.payload }),
    );
  });

  window.AshriumVfrWidget = {
    setGarment: function (nextSku, variantId) {
      send('VFR_SET_GARMENT', { sku: nextSku, variantId: variantId });
    },
    setUserParams: function (params) {
      send('VFR_SET_USER_PARAMS', params);
    },
  };
})();
