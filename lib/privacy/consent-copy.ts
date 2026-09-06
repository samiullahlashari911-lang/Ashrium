/**
 * Shopper-facing privacy and consent copy. Keep this the single source so the
 * capture checkbox, privacy page, and landing footer stay aligned.
 */
export const PRIVACY_PAGE_PATH = '/privacy';

export const CONSENT_CHECKBOX_LABEL =
  'I agree that Ashrium may process two photos of my body (the head is cropped on this device before upload), plus the height, sex, and optional weight I enter, to build a temporary 3D avatar for this fitting.';

export const CONSENT_SUMMARY =
  'Face pixels never leave this device. Headless WebP photos are uploaded only to run this fitting, then deleted as soon as inference finishes or fails, and in any case within 15 minutes. A derived body vector is kept for at most 15 minutes, then wiped.';

export const AGE_ATTESTATION_LABEL = 'I confirm I am 16 years of age or older.';

export const UNDER_16_REFUSAL =
  'Ashrium fittings are not available if you are under 16. We do not collect photos, height, sex, or weight from children (COPPA).';

export const FITTED_CLOTHING_COPY =
  'Wear fitted clothing — not bulky coats, hoodies, or outerwear. The camera silhouette must not become the body, or the size result will stay approximate.';

export const ILLINOIS_BIPA_REFUSAL =
  'Ashrium fittings are not offered in Illinois while we complete a BIPA review. This check is a timezone/locale heuristic, not legal advice.';

export const PRIVACY_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'What a fitting collects',
    body: 'A storefront fitting asks you to confirm you are 16 or older, then collects height, sex, and optional weight, and two guided photos (front A-pose and side profile with wrists at or above the shoulders). Wear fitted clothing so the outline is your body, not a coat. Those photos are encoded in the browser as WebP. The head is cropped on-device from pose landmarks before upload, so face pixels never leave the device. Ashrium does not ask for your name, email, or payment details in the widget.',
  },
  {
    title: 'How long it is kept',
    body: 'Biometric photos live in a private bucket with a 15-minute ceiling and are deleted immediately when inference succeeds or fails. The derived parametric body vector is stored on the fit job with the same 15-minute TTL and is cleared by a scheduled sweep. Cached drape vectors follow the same window.',
  },
  {
    title: 'What we never do',
    body: 'Ashrium does not sell biometric data, does not use fitting photos to train models, and does not keep a durable shopper identity. We refuse the under-16 / COPPA path: if you are under 16, the camera never starts. The storefront widget receives only a short-lived embed token. Merchant Shopify credentials never enter the iframe.',
  },
  {
    title: 'Size recommendations',
    body: 'A specific size is written into the cart only when capture gates pass (including the side wrist gate and a successful on-device head crop), garment ingest quality is high enough, and a cached or completed cloth solve supports the claim. Otherwise you see an approximate fit with no hard size.',
  },
];
