export interface MarketingLead {
  companyName: string;
  shopifyStoreUrl: string;
  annualRecurringRevenueUsd: number;
}

export type LeadField = 'companyName' | 'shopifyStoreUrl' | 'annualRecurringRevenueUsd';

export interface LeadFieldErrors {
  companyName?: string;
  shopifyStoreUrl?: string;
  annualRecurringRevenueUsd?: string;
}

export interface ParsedMarketingLead {
  errors: LeadFieldErrors;
  honeypotTripped: boolean;
  lead: MarketingLead | null;
}

const COMPANY_MAX = 120;
const URL_MAX = 300;
const REVENUE_MAX = 1_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCompanyName(value: unknown): { error?: string; name?: string } {
  if (typeof value !== 'string') {
    return { error: 'Enter your company name.' };
  }

  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return { error: 'Enter your company name.' };
  }

  if (name.length > COMPANY_MAX) {
    return { error: 'Use a company name under 120 characters.' };
  }

  return { name };
}

function parseStoreUrl(value: unknown): { error?: string; url?: string } {
  if (typeof value !== 'string') {
    return { error: 'Enter a store link that starts with http:// or https://.' };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > URL_MAX) {
    return { error: 'Enter a store link that starts with http:// or https://.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'Enter a store link that starts with http:// or https://.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Enter a store link that starts with http:// or https://.' };
  }

  if (!parsed.hostname.includes('.')) {
    return { error: 'Enter the full store link, including the domain.' };
  }

  return { url: parsed.toString() };
}

function parseRevenue(value: unknown): { error?: string; amount?: number } {
  let numeric: number | null = null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    numeric = value;
  } else if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[$,\s]/g, '');
    if (/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      numeric = Number(cleaned);
    }
  }

  if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) {
    return { error: 'Enter annual recurring revenue greater than zero.' };
  }

  if (numeric > REVENUE_MAX) {
    return { error: 'Enter a revenue figure under 1,000,000,000,000.' };
  }

  return { amount: Math.round(numeric * 100) / 100 };
}

export function parseMarketingLead(body: unknown): ParsedMarketingLead {
  if (!isRecord(body)) {
    return {
      errors: {
        companyName: 'Enter your company name.',
        shopifyStoreUrl: 'Enter a store link that starts with http:// or https://.',
        annualRecurringRevenueUsd: 'Enter annual recurring revenue greater than zero.',
      },
      honeypotTripped: false,
      lead: null,
    };
  }

  const honeypot = body.website;
  const honeypotTripped = typeof honeypot === 'string' && honeypot.trim().length > 0;
  const company = parseCompanyName(body.companyName);
  const store = parseStoreUrl(body.shopifyStoreUrl);
  const revenue = parseRevenue(body.annualRecurringRevenueUsd);
  const errors: LeadFieldErrors = {};

  if (company.error) {
    errors.companyName = company.error;
  }
  if (store.error) {
    errors.shopifyStoreUrl = store.error;
  }
  if (revenue.error) {
    errors.annualRecurringRevenueUsd = revenue.error;
  }

  if (honeypotTripped || company.name === undefined || store.url === undefined || revenue.amount === undefined) {
    return { errors, honeypotTripped, lead: null };
  }

  return {
    errors,
    honeypotTripped: false,
    lead: {
      companyName: company.name,
      shopifyStoreUrl: store.url,
      annualRecurringRevenueUsd: revenue.amount,
    },
  };
}

export function buildCalendlyEmbedUrl(eventUrl: string, lead: MarketingLead): string | null {
  let url: URL;
  try {
    url = new URL(eventUrl.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'calendly.com') {
    return null;
  }

  url.searchParams.set('name', lead.companyName);
  url.searchParams.set('a1', lead.shopifyStoreUrl);
  url.searchParams.set('a2', String(lead.annualRecurringRevenueUsd));
  url.searchParams.set('hide_event_type_details', '1');
  url.searchParams.set('hide_gdpr_banner', '1');
  url.searchParams.set('embed_type', 'Inline');
  return url.toString();
}
