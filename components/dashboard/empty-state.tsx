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
    <section className="obsidian-glass flex flex-col items-start gap-3 border-dashed p-6">
      <h2 className="text-lg font-semibold text-obsidian-ink">{title}</h2>
      <p className="max-w-xl text-sm text-obsidian-muted">{description}</p>
      {children}
      {action ? (
        <Link href={action.href} className="obsidian-cta mt-1 no-underline">
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
