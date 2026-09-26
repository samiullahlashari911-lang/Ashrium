import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCalendlyEmbedUrl, parseMarketingLead } from '@/lib/marketing/lead';

const validBody = {
  companyName: 'Northwind Apparel',
  shopifyStoreUrl: 'https://northwind.myshopify.com/products/coat',
  annualRecurringRevenueUsd: '1,200,000',
  website: '',
};

test('marketing lead accepts a company, store URL, and revenue', () => {
  const parsed = parseMarketingLead(validBody);
  assert.equal(parsed.honeypotTripped, false);
  assert.deepEqual(parsed.errors, {});
  assert.ok(parsed.lead);
  assert.equal(parsed.lead.companyName, 'Northwind Apparel');
  assert.equal(parsed.lead.shopifyStoreUrl, 'https://northwind.myshopify.com/products/coat');
  assert.equal(parsed.lead.annualRecurringRevenueUsd, 1200000);
});

test('marketing lead rejects missing fields, bad URLs, and non-positive revenue', () => {
  const parsed = parseMarketingLead({
    companyName: ' ',
    shopifyStoreUrl: 'javascript:alert(1)',
    annualRecurringRevenueUsd: '0',
    website: '',
  });

  assert.equal(parsed.lead, null);
  assert.equal(parsed.errors.companyName, 'Enter your company name.');
  assert.match(parsed.errors.shopifyStoreUrl ?? '', /http/);
  assert.match(parsed.errors.annualRecurringRevenueUsd ?? '', /greater than zero/);
});

test('marketing lead accepts http store links and dollar-formatted revenue', () => {
  const parsed = parseMarketingLead({
    companyName: '  Atelier  Nine ',
    shopifyStoreUrl: 'http://shop.example.com',
    annualRecurringRevenueUsd: '$250000.50',
    website: '',
  });

  assert.ok(parsed.lead);
  assert.equal(parsed.lead.companyName, 'Atelier Nine');
  assert.equal(parsed.lead.shopifyStoreUrl, 'http://shop.example.com/');
  assert.equal(parsed.lead.annualRecurringRevenueUsd, 250000.5);
});

test('marketing lead treats a filled honeypot as a trip and skips the lead', () => {
  const parsed = parseMarketingLead({
    ...validBody,
    website: 'https://spam.example',
  });

  assert.equal(parsed.honeypotTripped, true);
  assert.equal(parsed.lead, null);
});

test('calendly embed URL stays on calendly.com and carries the three answers', () => {
  const lead = parseMarketingLead(validBody).lead;
  assert.ok(lead);

  const embed = buildCalendlyEmbedUrl('https://calendly.com/ashrium/intro', lead);
  assert.ok(embed);
  const url = new URL(embed);
  assert.equal(url.hostname, 'calendly.com');
  assert.equal(url.searchParams.get('name'), 'Northwind Apparel');
  assert.equal(url.searchParams.get('a1'), 'https://northwind.myshopify.com/products/coat');
  assert.equal(url.searchParams.get('a2'), '1200000');
  assert.equal(buildCalendlyEmbedUrl('https://evil.example/calendly', lead), null);
  assert.equal(buildCalendlyEmbedUrl('http://calendly.com/ashrium/intro', lead), null);
});
