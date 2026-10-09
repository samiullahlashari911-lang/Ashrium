/**
 * Shopper-facing privacy and consent copy. Keep this the single source so the
 * capture checkbox, privacy page, and landing footer stay aligned.
 */
export const PRIVACY_PAGE_PATH = '/privacy';

export const CONSENT_CHECKBOX_LABEL =
  'I agree Ashrium may process two photos of my body (the head is cropped on this device before upload) and the height, sex, and optional weight I enter, to build a temporary 3D avatar.';

export const CONSENT_SUMMARY =
  'Face pixels never leave this device. Headless WebP photos are uploaded only to run this fitting, then deleted as soon as inference finishes or fails, and in any case within 15 minutes. A derived body vector is kept for at most 15 minutes, then wiped.';

export const AGE_ATTESTATION_LABEL = 'I confirm I am 16 years of age or older.';

/** One-line bullets on the short consent screen; the full text sits behind "Full details". */
export const CONSENT_BULLETS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Two photos, no face',
    body: 'A front and a side photo. Your head is cropped on this device before anything is sent.',
  },
  {
    title: 'Gone in 15 minutes',
    body: 'Photos are deleted the moment your avatar is built, and never kept longer than 15 minutes.',
  },
  {
    title: 'Never sold, never trained on',
    body: 'Your photos are not sold and are never used to train models.',
  },
  {
    title: 'Fitted T-shirt and trousers',
    body: 'A fitted short-sleeve T-shirt and fitted trousers or leggings: the outline is you, and the clothes you try replace them cleanly.',
  },
];

/**
 * Every storefront fitting shows the shopper as they are: face, hair, skin and
 * own clothes, painted on the avatar from their photos in this browser. The
 * full photos are never uploaded; servers get only the headless pair.
 */
export const FACE_ON_DEVICE_BULLET = {
  title: 'Your look stays on your phone',
  body: 'Your avatar shows your face, hair and clothes, painted from your photos on this phone only. The full photos are never uploaded and are gone when you close Try On.',
} as const;

/**
 * Flip to true only in the release where `gpu/body/mhr_fit.py` actually
 * conditions the starting body shape on sex. Until then the explainer must
 * not claim it.
 */
export const SEX_SHAPE_PRIOR_LIVE = false;

export const SEX_WHY_COPY = SEX_SHAPE_PRIOR_LIVE
  ? 'We start your 3D body from a closer average shape and show you the matching capture outline. Your measurements still come from your photos.'
  : 'It picks the capture outline that matches your body, so lining up for your photos is easier. Your measurements come from your photos.';

/** Same rule as sex: only claim weight improves the fit once the GPU uses it. */
export const WEIGHT_PRIOR_LIVE = false;

export const WEIGHT_WHY_COPY = WEIGHT_PRIOR_LIVE
  ? 'We use it to cross-check your body volume so the avatar is closer to you.'
  : 'It is kept only with this fitting and deleted with it.';

export const UNDER_16_REFUSAL =
  'Ashrium fittings are not available if you are under 16. We do not collect photos, height, sex, or weight from children (COPPA).';

/** Shown on the camera screen itself, where the shopper is dressing for the photo. */
export const CAPTURE_CLOTHING_TIP =
  'Wear a fitted short-sleeve T-shirt and fitted trousers or leggings. Loose tops, jackets or hoodies make your avatar bigger than you are.';

/** Shown on the camera screen so the promise is in front of the shopper when it matters. */
export const CAPTURE_PRIVACY_NOTE =
  'Your photos are never saved. Your head is removed on this phone, and the photos are deleted as soon as your avatar is built, within 15 minutes at most.';

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
    title: 'Your look on your avatar',
    body: 'Your avatar shows you as you are: your face, hair, skin and the clothes you wore, painted from your front and side photos on your device only. The full photos stay in your browser memory, are never uploaded to Ashrium or the store, and are wiped when you close Try On. Ashrium servers receive only the two photos with the head removed, to measure your body, and send back body shape and geometry, never images. Where the garment you try replaces what you wore, any uncovered skin is filled with a colour taken from your own photo, also on your device.',
  },
  {
    title: 'Size recommendations',
    body: 'A specific size is written into the cart only when capture gates pass (including the side wrist gate and a successful on-device head crop), garment ingest quality is high enough, and a cached or completed cloth solve supports the claim. Otherwise you see an approximate fit with no hard size.',
  },
];
