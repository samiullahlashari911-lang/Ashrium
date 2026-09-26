import type { JSX } from 'react';

/**
 * Fitting-room chrome over the product photograph.
 * Faceless, non-skin-toned mannequin. Size and Approximate fit stay distinct.
 */
export function ProductStage(): JSX.Element {
  return (
    <figure className="mkt-stage">
      <div className="mkt-stage-bar">
        <span>Try on</span>
        <span>Product page</span>
      </div>
      <div className="mkt-stage-view" aria-hidden="true">
        <div className="mkt-stage-neck" />
        <div className="mkt-stage-garment" />
      </div>
      <div className="mkt-stage-outcomes">
        <p>
          Gate passes
          <strong>Size M</strong>
          Written to cart
        </p>
        <p>
          Gate fails
          <span className="mkt-stage-line">Approximate fit</span>
        </p>
      </div>
      <figcaption className="sr-only">
        Fitting room on a product page: a faceless mannequin, Size M when the check passes, and Approximate fit when it does not.
      </figcaption>
    </figure>
  );
}
