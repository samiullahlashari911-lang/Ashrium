/**
 * Illinois BIPA geofence (AGENTS.md §6).
 *
 * Ship flag: leave `ILLINOIS_BIPA_GEOFENCE_ENABLED` false until counsel
 * signs off. The helper below is a timezone/locale heuristic — it is not
 * legal advice, not a determination of Illinois residency, and not a
 * substitute for IP geolocation. `America/Chicago` covers many non-Illinois
 * states; do not treat a true result as “this shopper is in Illinois.”
 */

export const ILLINOIS_BIPA_GEOFENCE_ENABLED = false;

export interface LocaleHeuristicInput {
  timeZone?: string;
  language?: string;
}

function readDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

function readDefaultLanguage(): string {
  if (typeof navigator === 'undefined') {
    return '';
  }

  return navigator.language ?? '';
}

/**
 * Over-inclusive on purpose. Central Time is not Illinois, and the Unicode
 * region override `u-rg-usil` is rarely set. Callers must still gate on
 * `ILLINOIS_BIPA_GEOFENCE_ENABLED`.
 */
export function isLikelyIllinoisLocale(input: LocaleHeuristicInput = {}): boolean {
  const language = (input.language ?? readDefaultLanguage()).toLowerCase();
  if (/(?:^|-)u-rg-usil(?:-|$)/.test(language)) {
    return true;
  }

  const timeZone = input.timeZone ?? readDefaultTimeZone();
  return timeZone === 'America/Chicago';
}

export function shouldBlockIllinoisCapture(input: LocaleHeuristicInput = {}): boolean {
  return ILLINOIS_BIPA_GEOFENCE_ENABLED && isLikelyIllinoisLocale(input);
}
