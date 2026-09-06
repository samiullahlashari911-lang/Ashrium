export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function readClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const candidate =
    forwarded?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || null;

  if (!candidate || candidate.length > 45) {
    return null;
  }

  return candidate;
}
