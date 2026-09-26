import type { JSX } from 'react';

/**
 * A tailor's dress form in a product-page column. Faceless neck cap,
 * cool gray torso, flat coat. Decorative.
 */
export function ProductStage(): JSX.Element {
  return (
    <figure className="mx-auto w-full max-w-[380px]" aria-hidden="true">
      <div className="overflow-hidden rounded-2xl border border-obsidian-hairline bg-obsidian-card">
        <div className="flex items-center justify-between border-b border-obsidian-hairline px-5 py-4">
          <p className="text-sm text-obsidian-ink">Wool coat</p>
          <p className="text-sm text-obsidian-muted">Try on</p>
        </div>
        <svg viewBox="0 0 320 400" className="h-auto w-full bg-[#10101c]" fill="none">
          <ellipse cx="160" cy="356" rx="34" ry="6" fill="#2A2A48" />
          <rect x="158" y="300" width="4" height="56" fill="#8B93A7" />
          <path d="M112 168 L96 300 H224 L208 168 Z" fill="#241C38" />
          <path d="M112 176 L64 248 L84 260 L124 190 Z" fill="#312848" />
          <path d="M208 176 L256 248 L236 260 L196 190 Z" fill="#312848" />
          <path d="M100 168 C128 142 192 142 220 168 L204 186 L160 172 L116 186 Z" fill="#3A3154" />
          <path d="M146 162 L160 184 L174 162" stroke="#6A32C9" strokeWidth="2" />
          <rect x="150" y="118" width="20" height="32" rx="7" fill="#C5CAD3" />
          <ellipse cx="160" cy="114" rx="11" ry="7" fill="#D7DCE4" />
        </svg>
        <div className="grid grid-cols-2 border-t border-obsidian-hairline">
          <div className="px-5 py-4">
            <p className="text-sm text-obsidian-subtle">In the cart</p>
            <p className="mt-1 text-base font-medium tabular-nums text-obsidian-ink">Size M</p>
          </div>
          <div className="border-l border-obsidian-hairline px-5 py-4">
            <p className="text-sm text-obsidian-subtle">If a check fails</p>
            <p className="mt-1 text-base font-medium text-obsidian-ink">Approximate fit</p>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-obsidian-subtle">
        Product page, with Try on open. Heatmap stays off until the shopper turns it on.
      </figcaption>
    </figure>
  );
}
