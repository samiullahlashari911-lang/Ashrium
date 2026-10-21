/** Max (dilate) or min (erode) of a binary mask over a square window, separably. */
export function squareFilter(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean): Uint8Array {
  const pass = (source: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(source.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const at = (line: number, i: number): number => (horizontal ? line * width + i : i * width + line);
    for (let line = 0; line < lines; line += 1) {
      // Running count of set pixels in the window [i - radius, i + radius].
      let count = 0;
      for (let i = -radius; i < length + radius; i += 1) {
        const entering = i + radius;
        if (entering < length && source[at(line, entering)]) {
          count += 1;
        }
        const leaving = i - radius - 1;
        if (leaving >= 0 && source[at(line, leaving)]) {
          count -= 1;
        }
        if (i < 0 || i >= length) {
          continue;
        }
        const span = Math.min(length - 1, i + radius) - Math.max(0, i - radius) + 1;
        out[at(line, i)] = dilate ? (count > 0 ? 1 : 0) : (count === span ? 1 : 0);
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** Box blur, separable, edge-clamped (three passes approach a Gaussian). */
export function boxBlur(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  const temp = new Float32Array(values.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += values[y * width + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x += 1) {
      temp[y * width + x] = sum / window;
      sum += values[y * width + Math.min(width - 1, x + radius + 1)] - values[y * width + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += temp[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}
