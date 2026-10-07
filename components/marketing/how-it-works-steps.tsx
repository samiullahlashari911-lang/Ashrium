import type { JSX, ReactNode } from 'react';

interface Step {
  title: string;
  detail: string;
  visual: ReactNode;
}

/**
 * Visual sequence for the shopper path — each step carries a small UI detail,
 * not a text cell in a uniform card grid.
 */
export function HowItWorksSteps(): JSX.Element {
  const steps: readonly Step[] = [
    {
      title: 'Guided capture',
      detail: 'Front and side after age and consent. Camera stays closed until both pass.',
      visual: <CaptureDetail />,
    },
    {
      title: 'Head crop on device',
      detail: 'The head is removed on the phone. Face pixels never leave the device.',
      visual: <CropDetail />,
    },
    {
      title: 'Avatar and drape',
      detail: 'A real body is fit from the photos. The garment is draped on it.',
      visual: <AvatarDetail />,
    },
    {
      title: 'Size or Approximate',
      detail: 'Hard size reaches the cart when every check passes. Otherwise Approximate fit.',
      visual: <OutcomeDetail />,
    },
  ];

  return (
    <ol className="mt-14 flex flex-col gap-0 lg:mt-16">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className={[
            'grid items-center gap-8 border-t border-white/[0.08] py-10 sm:py-12',
            'lg:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] lg:gap-16',
            index % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : '',
          ].join(' ')}
        >
          <div className="min-w-0">
            <p className="text-sm tabular-nums text-obsidian-subtle">{String(index + 1).padStart(2, '0')}</p>
            <h3 className="mt-3 text-2xl font-medium tracking-[-0.02em] text-obsidian-ink sm:text-[1.75rem]">
              {step.title}
            </h3>
            <p className="mt-3 max-w-md text-pretty text-[16px] leading-7 text-obsidian-muted">
              {step.detail}
            </p>
          </div>
          <div className="justify-self-stretch lg:justify-self-end">{step.visual}</div>
        </li>
      ))}
    </ol>
  );
}

function Frame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#10101C] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
      {children}
    </div>
  );
}

function CaptureDetail(): JSX.Element {
  return (
    <Frame>
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.08] bg-[#16162B]">
        <div className="absolute inset-4 rounded-lg border border-dashed border-white/20" />
        <div className="absolute inset-x-8 top-10 bottom-14 mx-auto max-w-[7rem]">
          <div className="mx-auto h-3 w-8 rounded-t bg-white/15" />
          <div className="mx-auto mt-1 h-24 w-full rounded-md bg-white/[0.08]" />
          <div className="mx-auto mt-1 flex justify-center gap-3">
            <div className="h-10 w-5 rounded-b bg-white/[0.08]" />
            <div className="h-10 w-5 rounded-b bg-white/[0.08]" />
          </div>
        </div>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          Aligned
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-obsidian-subtle">Front · Side</p>
    </Frame>
  );
}

function CropDetail(): JSX.Element {
  return (
    <Frame>
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.08] bg-[#16162B]">
        {/* Head zone removed */}
        <div className="absolute inset-x-6 top-4 h-14 rounded-lg border border-dashed border-rose-400/40 bg-rose-400/5">
          <span className="absolute inset-0 flex items-center justify-center text-[10px] tracking-wide text-rose-300/80">
            Cropped
          </span>
        </div>
        <div className="absolute inset-x-10 top-[5.5rem] bottom-8">
          <div className="mx-auto h-2.5 w-10 rounded bg-[#8B90A3]/60" />
          <div className="mx-auto mt-1 h-28 w-full rounded-md bg-[#7E8498]/50" />
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-obsidian-subtle">On-device · before upload</p>
    </Frame>
  );
}

function AvatarDetail(): JSX.Element {
  return (
    <Frame>
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.08] bg-[#12121F]">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(72,48,120,0.4), transparent 70%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-6 top-10 flex flex-col items-center">
          <div className="h-3 w-7 rounded-t bg-[#8B90A3]" />
          <div className="h-2 w-16 rounded-sm bg-[#7E8498]" />
          <div
            className="mt-0.5 h-24 w-[6.5rem] rounded-b-xl"
            style={{
              background: 'linear-gradient(165deg, #7A4BB8, #3D1F62)',
            }}
          />
          <div className="mt-0.5 flex gap-4">
            <div className="h-12 w-6 rounded-b bg-[#6E7488]" />
            <div className="h-12 w-6 rounded-b bg-[#6E7488]" />
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-obsidian-subtle">Faceless · cool gray</p>
    </Frame>
  );
}

function OutcomeDetail(): JSX.Element {
  return (
    <Frame>
      <div className="space-y-3">
        <div className="rounded-xl border border-white/[0.1] bg-[#16162B] px-3 py-3">
          <p className="text-[11px] text-obsidian-subtle">Confident</p>
          <div className="mt-2 inline-flex rounded-full bg-gradient-to-r from-[#6A32C9] to-[#B52286] px-3 py-1 text-[13px] font-semibold tabular-nums text-white">
            Size M
          </div>
          <p className="mt-2 text-[12px] text-obsidian-muted">→ Cart</p>
        </div>
        <div className="rounded-xl border border-dashed border-white/20 bg-transparent px-3 py-3">
          <p className="text-[11px] text-obsidian-subtle">Otherwise</p>
          <p className="mt-2 text-[13px] font-medium text-obsidian-muted">Approximate fit</p>
          <p className="mt-1 text-[12px] text-obsidian-subtle">No hard size claim</p>
        </div>
      </div>
    </Frame>
  );
}
