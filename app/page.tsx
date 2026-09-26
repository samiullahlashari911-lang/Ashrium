import type { Metadata, Viewport } from 'next';
import type { JSX } from 'react';

import { MarketingHome } from '@/components/marketing/landing-page';

export const metadata: Metadata = {
  title: 'Ashrium — Virtual fitting room for Shopify',
  description:
    'Ashrium is the Shopify virtual fitting room: two guided photos, a faceless avatar, a size in the cart when the check passes, and photos wiped within 15 minutes. 15% fewer returns, guaranteed.',
};

export const viewport: Viewport = {
  themeColor: '#F2F2F2',
};

export default function LandingPage(): JSX.Element {
  return <MarketingHome />;
}
