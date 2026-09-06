import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';
import { WidgetPreviewClient } from '@/app/widget/vfr/widget-preview-client';

interface WidgetVfrPageProps {
  searchParams: Promise<{
    token?: string;
  }>;
}

export default async function WidgetVfrPage({ searchParams }: WidgetVfrPageProps) {
  const params = await searchParams;
  const token = params.token?.trim();
  const claims = token ? verifyWidgetEmbedToken(token) : null;

  if (!claims || !token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-obsidian-canvas p-6 text-sm text-red-300">
        Invalid or expired widget token.
      </main>
    );
  }

  return <WidgetPreviewClient tenantId={claims.tenantId} embedToken={token} />;
}
