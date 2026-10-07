-- On-device face on the shopper's avatar (owner-approved, counsel review
-- pending). Default OFF. When on, the widget keeps the head crop in browser
-- memory only and draws it on the avatar locally; servers still receive only
-- headless photos. Nothing here stores a face.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS on_device_face_enabled boolean NOT NULL DEFAULT false;
