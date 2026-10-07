import Link from 'next/link';
import type { ReactNode } from 'react';

export interface EmptyStateAction {
  href: string;
  label: string;
}

export interface EmptyStateProps {
  action?: EmptyStateAction;
  children?: ReactNode;
  description: string;
  title: string;
}

export function EmptyState({
  action,
  children,
  description,
  title,
}: EmptyStateProps): React.JSX.Element {
  return (
    <section className="ash-card flex flex-col items-start gap-3 border-dashed p-6">
      <h2 className="text-lg font-semibold text-ash-ink">{title}</h2>
      <p className="max-w-xl text-sm text-ash-muted">{description}</p>
      {children}
      {action ? (
        <Link href={action.href} className="ash-cta mt-1 no-underline">
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
