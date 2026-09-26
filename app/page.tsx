import type { Metadata, Viewport } from 'next';
import type { JSX } from 'react';

import { MarketingHome } from '@/components/marketing/landing-page';
import { ThemeShell } from '@/components/theme/atmosphere-backdrop';

export const metadata: Metadata = {
  title: 'Ashrium — Virtual fitting room for Shopify',
  description:
    'Fewer returns, guaranteed. Ashrium is the Shopify virtual fitting room: a real avatar from two guided photos, a size in the cart when confidence is high, and photos wiped within 15 minutes.',
};

export const viewport: Viewport = {
  themeColor: '#0B0B1E',
};

export default function LandingPage(): JSX.Element {
  return (
    <ThemeShell atmosphere={false}>
      <MarketingHome />
    </ThemeShell>
  );
}
