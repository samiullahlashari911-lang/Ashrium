/** Length beats complexity rules. 72 is the bcrypt input limit Supabase uses. */
export const MERCHANT_PASSWORD_MIN = 12;
export const MERCHANT_PASSWORD_MAX = 72;

/** Plain-language reason a new merchant password is refused, or null if fine. */
export function merchantPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MERCHANT_PASSWORD_MIN) {
    return `Use at least ${MERCHANT_PASSWORD_MIN} characters. A short phrase is easiest to remember.`;
  }
  if (new TextEncoder().encode(password).length > MERCHANT_PASSWORD_MAX) {
    return `Use at most ${MERCHANT_PASSWORD_MAX} characters.`;
  }
  if (password.trim().length === 0) {
    return 'Your password cannot be only spaces.';
  }
  if (password !== confirm) {
    return 'The two passwords do not match.';
  }
  return null;
}
