import { createSign } from 'node:crypto';

import type { MarketingLead } from '@/lib/marketing/lead';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEET_RANGE = 'Sheet1!A:D';

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

interface SheetConfig {
  account: ServiceAccount;
  spreadsheetId: string;
}

interface TokenCache {
  expiresAt: number;
  token: string;
}

let tokenCache: TokenCache | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readServiceAccount(raw: string): ServiceAccount | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (typeof clientEmail !== 'string' || !clientEmail.includes('@')) {
    return null;
  }
  if (typeof privateKey !== 'string' || !privateKey.includes('BEGIN')) {
    return null;
  }

  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

export function readSheetConfig(): SheetConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID?.trim() ?? '';
  const rawAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
  if (!/^[a-zA-Z0-9-_]+$/.test(spreadsheetId) || rawAccount.trim().length === 0) {
    return null;
  }

  const account = readServiceAccount(rawAccount);
  if (!account) {
    return null;
  }

  return { account, spreadsheetId };
}

function signServiceJwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: account.clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(account.privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function fetchAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const assertion = signServiceJwt(account);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error('SHEETS_AUTH_FAILED');
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.access_token !== 'string') {
    throw new Error('SHEETS_AUTH_FAILED');
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  tokenCache = {
    token: payload.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return payload.access_token;
}

export async function appendMarketingLead(lead: MarketingLead): Promise<void> {
  const config = readSheetConfig();
  if (!config) {
    throw new Error('SHEETS_NOT_CONFIGURED');
  }

  const token = await fetchAccessToken(config.account);
  const range = encodeURIComponent(SHEET_RANGE);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [[
        new Date().toISOString(),
        lead.companyName,
        lead.shopifyStoreUrl,
        lead.annualRecurringRevenueUsd,
      ]],
    }),
  });

  if (!response.ok) {
    throw new Error('SHEETS_WRITE_FAILED');
  }
}
