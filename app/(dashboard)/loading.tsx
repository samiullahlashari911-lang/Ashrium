export default function DashboardLoading(): React.JSX.Element {
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-5xl flex-col gap-4 p-6">
      <div className="h-8 w-48 animate-pulse rounded-full bg-white/10" />
      <div className="h-4 w-72 animate-pulse rounded-full bg-white/10" />
      <div className="mt-4 h-64 animate-pulse rounded-3xl bg-white/5" />
    </div>
  );
}
