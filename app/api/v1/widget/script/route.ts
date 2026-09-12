import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';

interface WidgetScriptConfig {
  iframeUrl: string;
}

function minifyJavaScript(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}();,:<>=+\-*/])\s*/g, '$1')
    .trim();
}

function buildWidgetScript(config: WidgetScriptConfig): string {
  const source = `
(function(){
  if (window.__ASHRIUM_VFR_WIDGET__) { return; }
  window.__ASHRIUM_VFR_WIDGET__ = true;

  var IFRAME_URL = ${JSON.stringify(config.iframeUrl)};
  var host = document.createElement('div');
  host.id = 'ashrium-vfr-widget-root';
  host.style.all = 'initial';
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: 'closed' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '.vfr-launcher {',
    '  position: fixed;',
    '  right: 20px;',
    '  bottom: 20px;',
    '  z-index: 2147483646;',
    '  border: none;',
    '  border-radius: 9999px;',
    '  padding: 14px 20px;',
    '  font: 600 14px/1.2 Inter, system-ui, sans-serif;',
    '  color: #fff;',
    '  background: linear-gradient(135deg, #6A32C9, #B52286);',
    '  box-shadow: 0 10px 30px rgba(106,50,201,.45);',
    '  cursor: pointer;',
    '}',
    '.vfr-modal {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 2147483647;',
    '  display: none;',
    '  align-items: center;',
    '  justify-content: center;',
    '  background: rgba(11, 11, 30, 0.72);',
    '}',
    '.vfr-modal.open { display: flex; }',
    '.vfr-panel {',
    '  position: relative;',
    '  width: min(96vw, 960px);',
    '  height: min(92vh, 780px);',
    '  border-radius: 16px;',
    '  overflow: hidden;',
    '  box-shadow: 0 20px 50px rgba(8, 6, 28, 0.55);',
    '  background: #0B0B1E;',
    '}',
    '.vfr-close {',
    '  position: absolute;',
    '  top: 10px;',
    '  right: 10px;',
    '  z-index: 2;',
    '  border: none;',
    '  border-radius: 9999px;',
    '  width: 36px;',
    '  height: 36px;',
    '  font-size: 20px;',
    '  line-height: 1;',
    '  color: #e2e8f0;',
    '  background: rgba(11, 11, 30, 0.8);',
    '  cursor: pointer;',
    '}',
    '.vfr-frame {',
    '  width: 100%;',
    '  height: 100%;',
    '  border: 0;',
    '  background: #0B0B1E;',
    '}'
  ].join('');

  var launcher = document.createElement('button');
  launcher.className = 'vfr-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Try On Virtual Fitting';

  var modal = document.createElement('div');
  modal.className = 'vfr-modal';

  var panel = document.createElement('div');
  panel.className = 'vfr-panel';

  var closeButton = document.createElement('button');
  closeButton.className = 'vfr-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close virtual fitting room');
  closeButton.textContent = '\\u00d7';

  var iframe = document.createElement('iframe');
  iframe.className = 'vfr-frame';
  iframe.title = 'Ashrium Virtual Fitting Room';
  iframe.src = IFRAME_URL;
  iframe.allow = 'camera; fullscreen';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';

  panel.appendChild(closeButton);
  panel.appendChild(iframe);
  modal.appendChild(panel);

  shadow.appendChild(style);
  shadow.appendChild(launcher);
  shadow.appendChild(modal);

  function openModal() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  launcher.addEventListener('click', openModal);
  closeButton.addEventListener('click', closeModal);
  modal.addEventListener('click', function(event) {
    if (event.target === modal) { closeModal(); }
  });

  window.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') { closeModal(); }
  });

  console.info('[Ashrium VFR] Widget initialized');
})();
`;

  return minifyJavaScript(source);
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get('token')?.trim();

  if (!token) {
    const errorScript = minifyJavaScript(
      'console.error("[Ashrium VFR] Missing widget token.");',
    );

    return new Response(errorScript, {
      status: 400,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const claims = verifyWidgetEmbedToken(token);
  if (!claims) {
    const errorScript = minifyJavaScript(
      'console.error("[Ashrium VFR] Invalid or expired widget token.");',
    );

    return new Response(errorScript, {
      status: 401,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const iframeUrl = `${requestUrl.origin}/widget/vfr?${new URLSearchParams({
    token,
    v: 'launcher-1',
  }).toString()}`;
  const script = buildWidgetScript({ iframeUrl });

  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
