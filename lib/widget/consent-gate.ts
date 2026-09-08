export interface ConsentContinueState {
  ageAttested: boolean;
  privacyConsent: boolean;
}

export interface ConsentContinueGuidance {
  id: 'consent-next-guidance';
  ready: boolean;
  message: string;
}

export const CONSENT_GUIDANCE_ID = 'consent-next-guidance' as const;

export function isConsentContinueEnabled(state: ConsentContinueState): boolean {
  return state.ageAttested && state.privacyConsent;
}

export function consentContinueGuidance(state: ConsentContinueState): ConsentContinueGuidance {
  if (!state.ageAttested && !state.privacyConsent) {
    return {
      id: CONSENT_GUIDANCE_ID,
      ready: false,
      message: 'Check both boxes above — age 16+ and privacy consent — to enable Next.',
    };
  }

  if (!state.ageAttested) {
    return {
      id: CONSENT_GUIDANCE_ID,
      ready: false,
      message: 'Confirm you are 16 or older to enable Next. The camera stays off until then.',
    };
  }

  if (!state.privacyConsent) {
    return {
      id: CONSENT_GUIDANCE_ID,
      ready: false,
      message: 'Confirm the privacy notice to enable Next. The camera stays off until then.',
    };
  }

  return {
    id: CONSENT_GUIDANCE_ID,
    ready: true,
    message: 'Age and privacy confirmed. Next continues to height — the camera stays off.',
  };
}
