import type { CaptureView } from '@/types/hmr';

export function SilhouetteOverlay({ view }: { view: CaptureView }): React.JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 200 320"
      aria-hidden="true"
    >
      {view === 'front' ? (
        <path
          d="M100 28c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18zm-22 44h44c8 18 22 28 28 52 4 16 6 38 4 58l-18 6-6-48c-2-10-10-16-20-16h-8c-10 0-18 6-20 16l-6 48-18-6c-2-20 0-42 4-58 6-24 20-34 28-52zm-30 118 18 92h20l8-54h8l8 54h20l18-92"
          fill="none"
          stroke="rgba(241,245,249,0.72)"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M108 28c8 0 15 7 15 16s-7 16-15 16-15-7-15-16 7-16 15-16zm-14 36c4 12 10 20 16 24h54c2-6-2-10-8-10h-42c-2-8-4-18-2-28 0-4 2-6 4-8zm-18 118 16 96h18l8-54h8l8 54h18l16-96c-6 22-10 48-12 70-10 4-22 6-32 4 2-24 4-52 2-78-8-2-18-8-24-14z"
          fill="none"
          stroke="rgba(241,245,249,0.72)"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
