import type { ConfidenceGateResult } from '@/types/garment';

export interface ApproximateContext {
  /** The recommended size's drape has landed or is known not to come. */
  drapeSettled: boolean;
  /** The recommended size meets the body's girths plus ease (false: the largest size, named anyway). */
  sizeFits: boolean;
}

/** Plain-language reasons the AND-gate did not pass (AGENTS.md §7). */
export function approximateReasons(gate: ConfidenceGateResult, context: ApproximateContext): string[] {
  const reasons: string[] = [];
  if (!context.sizeFits) {
    reasons.push('Your measurements are larger than this size chart');
  } else if (!gate.drapePassed) {
    reasons.push(context.drapeSettled ? 'This size could not be shown on you' : 'Still fitting the garment to you');
  }
  if (!gate.capturePassed) {
    reasons.push('A photo check did not fully pass: retake for an exact size');
  }
  if (!gate.ingestPassed) {
    reasons.push('This product’s size details are incomplete');
  }
  if (!gate.residualPassed) {
    reasons.push('Loose clothing may hide your shape: retake in a fitted T-shirt for an exact size');
  }
  if (!gate.printPassed) {
    reasons.push('Product image could not be verified');
  }
  return reasons;
}
