/**
 * True for a same-origin path such as `/settings`. Browsers and the WHATWG URL
 * parser read `/\evil.com` as `//evil.com`, so backslashes and control
 * characters are rejected along with `//`.
 */
export function isSafeAppPath(value: string): boolean {
  return (
    value.startsWith('/')
    && !value.startsWith('//')
    && !/[\\\u0000-\u001f\u007f]/.test(value)
  );
}
