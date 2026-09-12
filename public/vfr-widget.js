(function () {
  'use strict';

  if (window.__ASHRIUM_VFR_WIDGET__) return;

  var script = document.currentScript;
  if (!script) return;

  var scriptUrl = new URL(script.src, window.location.href);
  var widgetOrigin = scriptUrl.origin;
  var sku = script.getAttribute('data-sku') || '';
  var handle = script.getAttribute('data-handle') || '';
  var allowGallery = script.getAttribute('data-allow-gallery') === 'true';
  var launcher = script.getAttribute('data-launcher') === 'true';
  var token = script.getAttribute('data-embed-token') || '';
  var insertBefore = script;

  window.__ASHRIUM_VFR_WIDGET__ = true;

  function postJson(path, body) {
    return fetch(widgetOrigin + path, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body || {}),
    }).then(function (response) {
      return response.ok ? response.json() : null;
    });
  }

  function buildFrameUrl(embedToken) {
    var frameUrl = new URL('/widget/embed', widgetOrigin);
    frameUrl.searchParams.set('token', embedToken);
    frameUrl.searchParams.set('parent_origin', window.location.origin);
    if (sku) frameUrl.searchParams.set('sku', sku);
    if (handle) frameUrl.searchParams.set('handle', handle);
    if (allowGallery) frameUrl.searchParams.set('allow_gallery', '1');
    frameUrl.searchParams.set('v', 'launcher-1');
    return frameUrl.toString();
  }

  function createFrame(embedToken) {
    var frame = document.createElement('iframe');
    frame.className = 'vfr-frame';
    frame.title = 'Ashrium Virtual Fitting Room';
    frame.allow = 'camera; fullscreen';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = buildFrameUrl(embedToken);
    return frame;
  }

  function attachHostApi(frame) {
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
      document.dispatchEvent(
        new CustomEvent('ashrium:vfr:' + message.type.toLowerCase(), { detail: message.payload }),
      );
    });

    window.AshriumVfrWidget = {
      setGarment: function (nextSku, variantId) {
        sku = nextSku || sku;
        send('VFR_SET_GARMENT', { sku: nextSku, variantId: variantId });
      },
      setUserParams: function (params) {
        send('VFR_SET_USER_PARAMS', params);
      },
    };
  }

  function mountInlineIframe(embedToken) {
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
    var frame = createFrame(embedToken);
    var shell = document.createElement('div');
    shell.className = 'vfr-shell';
    shell.appendChild(frame);
    shadow.appendChild(style);
    shadow.appendChild(shell);
    insertBefore.parentNode.insertBefore(root, insertBefore.nextSibling);
    attachHostApi(frame);
  }

  function openOverlay(embedToken) {
    if (document.getElementById('ashrium-vfr-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'ashrium-vfr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:stretch;justify-content:center;',
      'background:rgba(8,6,28,.72);padding:env(safe-area-inset-top,12px) 12px 12px;',
    ].join('');
    var panel = document.createElement('div');
    panel.style.cssText =
      'position:relative;width:min(520px,100%);height:100%;max-height:100dvh;border-radius:20px;overflow:hidden;background:#0B0B1E;box-shadow:0 24px 80px rgba(0,0,0,.45)';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close Try On');
    close.style.cssText =
      'position:absolute;top:12px;right:12px;z-index:2;border:0;border-radius:999px;padding:8px 12px;background:#1B1538;color:#F4F1FF;font:600 12px/1 system-ui,sans-serif;cursor:pointer';
    close.addEventListener('click', function () {
      overlay.remove();
    });
    var frame = createFrame(embedToken);
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#0B0B1E';
    panel.appendChild(close);
    panel.appendChild(frame);
    overlay.appendChild(panel);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    attachHostApi(frame);
  }

  function mintToken() {
    if (token) return Promise.resolve(token);
    return postJson('/api/v1/widget/token', {}).then(function (payload) {
      if (!payload || typeof payload.token !== 'string') {
        throw new Error('Widget authorization failed.');
      }
      token = payload.token;
      return token;
    });
  }

  if (!launcher) {
    if (!token) {
      console.error('[Ashrium VFR] data-embed-token is required.');
      return;
    }
    mountInlineIframe(token);
    return;
  }

  var buttonHost = document.createElement('div');
  buttonHost.id = 'ashrium-vfr-try-on';
  buttonHost.style.cssText = 'display:none;width:100%;margin:0 0 12px';
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Try On';
  button.style.cssText = [
    'display:block;width:100%;box-sizing:border-box;border:0;border-radius:999px;padding:14px 18px;',
    'background:linear-gradient(90deg,#6D5CFF,#C026D3);color:#fff;font:650 15px/1.1 system-ui,sans-serif;',
    'letter-spacing:.02em;cursor:pointer',
  ].join('');
  button.addEventListener('click', function () {
    button.disabled = true;
    mintToken()
      .then(openOverlay)
      .catch(function () {
        button.disabled = false;
        console.error('[Ashrium VFR] Unable to open Try On.');
      })
      .then(function () {
        button.disabled = false;
      });
  });
  buttonHost.appendChild(button);
  insertBefore.parentNode.insertBefore(buttonHost, insertBefore);

    if (token) {
      buttonHost.style.display = 'block';
      return;
    }

    postJson('/api/v1/widget/available', { handle: handle, sku: sku })
    .then(function (payload) {
      if (payload && payload.available) {
        buttonHost.style.display = 'block';
      }
    })
    .catch(function () {
      // Hide the launcher when availability cannot be confirmed.
    });
})();
