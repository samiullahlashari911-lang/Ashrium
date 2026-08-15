import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Merchant Analytics | Ashrium',
  description: 'Standalone VFR return-rate and CAD pipeline analytics for local merchant review.',
};

export default function MerchantLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return children;
}
