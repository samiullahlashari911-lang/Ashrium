'use client';

import posthog from 'posthog-js';
import { useEffect, type JSX } from 'react';

// Product analytics for the marketing page and merchant dashboard only.
// Never mount this under /widget: the shopper widget handles biometric
// capture on merchant storefronts and must not load third-party trackers.
// Session replay is off; autocapture never records input values.

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let initialized = false;

function ensurePostHog(): boolean {
  if (initialized) return true;
  if (!POSTHOG_KEY || typeof window === 'undefined') return false;
  if (window.location.pathname.startsWith('/widget')) return false;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: 'history_change',
    capture_pageleave: true,
    disable_session_recording: true,
    person_profiles: 'identified_only',
    mask_all_text: false,
    mask_all_element_attributes: false,
  });
  initialized = true;
  return true;
}

type PostHogAnalyticsProps = {
  /** Merchant tenant id. Sent as the distinct id; never an email or name. */
  tenantId?: string;
};

export function PostHogAnalytics({ tenantId }: PostHogAnalyticsProps): JSX.Element | null {
  useEffect(() => {
    if (!ensurePostHog()) return;
    if (tenantId) {
      posthog.identify(tenantId);
      posthog.group('tenant', tenantId);
    }
  }, [tenantId]);

  return null;
}

/** Explicit funnel event. Never pass biometric, contact, or form-field values. */
export function trackEvent(name: string, properties?: Record<string, string | number | boolean>): void {
  if (!ensurePostHog()) return;
  posthog.capture(name, properties);
}
