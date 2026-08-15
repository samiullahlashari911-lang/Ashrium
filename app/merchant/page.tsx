import { CadPipelineTable } from '@/components/dashboard/CadPipelineTable';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { MetricCardGrid } from '@/components/dashboard/MetricCardGrid';
import { ReturnRateTrendChart } from '@/components/dashboard/ReturnRateTrendChart';

export const dynamic = 'force-static';

export default function MerchantAnalyticsPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-obsidian-canvas px-8 py-6 text-obsidian-ink">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <DashboardHeader />
        <MetricCardGrid />
        <section className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.45fr)_minmax(560px,1fr)]">
          <ReturnRateTrendChart />
          <CadPipelineTable />
        </section>
      </div>
    </main>
  );
}
