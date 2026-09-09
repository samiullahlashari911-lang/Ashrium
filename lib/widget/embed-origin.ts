/**
 * Widget iframe parent checks. Storefront embeds must match the merchant
 * allowlist. The merchant dashboard sandbox is first-party (same host as
 * the App Router) and must work on HTTPS without adding the app origin
 * to tenants.allowed_domains.
 */

/** Bump when `public/vfr-widget.js` changes so hosts skip a stale cache. */
export const VFR_WIDGET_SCRIPT_VERSION = 'no-sandbox-capture-ux-1';

export const VFR_WIDGET_SCRIPT_SRC = `/vfr-widget.js?v=${VFR_WIDGET_SCRIPT_VERSION}`;
export function isWidgetEmbedParentAuthorized(input: {
  appOrigin: string | null;
  isDevelopment: boolean;
  parentOrigin: string;
  referrerOrigin: string | null;
  trustedOrigins: readonly string[];
}): boolean {
  if (input.isDevelopment) {
    return true;
  }

  const firstPartySandbox = input.appOrigin !== null
    && input.parentOrigin === input.appOrigin
    && input.referrerOrigin !== null
    && input.referrerOrigin === input.parentOrigin;

  if (firstPartySandbox) {
    return true;
  }

  return (
    input.trustedOrigins.includes(input.parentOrigin)
    && input.referrerOrigin !== null
    && input.trustedOrigins.includes(input.referrerOrigin)
  );
}
