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
      'border-radius:20px;background:#F4F1EC;box-shadow:0 12px 36px rgba(29,27,34,.12)}',
      '.vfr-frame{display:block;width:100%;height:clamp(640px,85vw,820px);border:0;background:#F4F1EC}',
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
    overlay.setAttribute('aria-label', 'Ashrium virtual fitting room');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:stretch;justify-content:center;',
      'background:rgba(29,27,34,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
      'padding:env(safe-area-inset-top,10px) 10px 10px;opacity:0;transition:opacity .25s ease',
    ].join('');
    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative;width:min(1040px,100%);height:100%;max-height:100dvh;border-radius:24px;overflow:hidden;',
      'background:#F4F1EC;box-shadow:0 24px 80px rgba(29,27,34,.28);transform:translateY(16px);',
      'transition:transform .35s cubic-bezier(.22,1,.36,1)',
    ].join('');
    var close = document.createElement('button');
    close.type = 'button';
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    close.setAttribute('aria-label', 'Close Try On');
    close.style.cssText = [
      'position:absolute;top:14px;right:14px;z-index:2;display:flex;align-items:center;justify-content:center;',
      'width:36px;height:36px;border:1px solid #E6E1D9;border-radius:999px;background:#fff;color:#1D1B22;cursor:pointer;',
      'box-shadow:0 4px 12px rgba(29,27,34,.08)',
    ].join('');
    function dismiss() {
      overlay.style.opacity = '0';
      setTimeout(function () { overlay.remove(); }, 220);
    }
    close.addEventListener('click', dismiss);
    var frame = createFrame(embedToken);
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#F4F1EC';
    panel.appendChild(close);
    panel.appendChild(frame);
    overlay.appendChild(panel);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) dismiss();
    });
    document.addEventListener('ashrium:vfr:vfr_add_to_cart', function onAdded() {
      document.removeEventListener('ashrium:vfr:vfr_add_to_cart', onAdded);
      setTimeout(dismiss, 650);
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
      panel.style.transform = 'none';
    });
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
  button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="flex:none"><path d="M12 6a2 2 0 1 0-2-2M12 6v2m0 0L3.5 14.2A1.5 1.5 0 0 0 4.4 17h15.2a1.5 1.5 0 0 0 .9-2.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Try it on in 3D</span>';
  button.style.cssText = [
    'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;border:0;',
    'border-radius:14px;padding:14px 18px;background:#6A4CF5;color:#fff;font:600 15px/1.1 system-ui,sans-serif;',
    'letter-spacing:.01em;cursor:pointer;box-shadow:0 8px 24px rgba(106,76,245,.28);transition:background .16s ease',
  ].join('');
  button.addEventListener('mouseenter', function () { button.style.background = '#5536E0'; });
  button.addEventListener('mouseleave', function () { button.style.background = '#6A4CF5'; });
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
