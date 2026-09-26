import { buildCalendlyEmbedUrl, parseMarketingLead } from '@/lib/marketing/lead';
import { appendMarketingLead } from '@/lib/server/google-sheet-lead';
import { rateLimitedJsonResponse } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS } from '@/lib/server/rate-limit';
import { readClientIp } from '@/lib/server/request-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const ip = readClientIp(request) ?? 'unknown';
  const limited = await rateLimitedJsonResponse(`marketing-lead:${ip}`, RATE_LIMITS.marketingLead);
  if (limited) {
    return limited;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ code: 'INVALID_JSON' }, 400);
  }

  const parsed = parseMarketingLead(body);
  if (parsed.honeypotTripped) {
    return json({ ok: true, calendlyUrl: null }, 200);
  }

  if (!parsed.lead) {
    return json({ code: 'VALIDATION', errors: parsed.errors }, 400);
  }

  try {
    await appendMarketingLead(parsed.lead);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SHEETS_WRITE_FAILED';
    if (code === 'SHEETS_NOT_CONFIGURED') {
      return json({
        code: 'SHEETS_NOT_CONFIGURED',
        message: 'Booking is not connected yet. The request was not saved.',
      }, 503);
    }

    console.error('marketing lead sheet append failed');
    return json({
      code: 'SHEETS_WRITE_FAILED',
      message: 'We could not save this request. Try again in a moment.',
    }, 502);
  }

  const eventUrl = process.env.NEXT_PUBLIC_CALENDLY_EVENT_URL ?? '';
  const calendlyUrl = eventUrl.length > 0
    ? buildCalendlyEmbedUrl(eventUrl, parsed.lead)
    : null;

  return json({ ok: true, calendlyUrl }, 200);
}
