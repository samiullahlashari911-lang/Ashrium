/**
 * Cloth colour from a colourway name ("Men's Crewneck T-Shirt / White").
 *
 * Catalogs often share one product photo across colourways (the owner's
 * "White" tee's photo is a grey tee), so a plain colour word in the variant
 * name wins over the photo's colour. Unknown names return null and the
 * product photo's colour is used.
 */
const COLOUR_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\boff[-\s]?white|cream|ivory|beige|apricot\b/i, '#e9dfcc'],
  [/\bwhite\b/i, '#f2f1ee'],
  [/\bblack\b/i, '#1d1d1f'],
  [/\b(dark|charcoal)\s*gr[ae]y\b/i, '#4a4a4d'],
  [/\blight\s*gr[ae]y\b/i, '#c4c4c2'],
  [/\bgr[ae]y\b/i, '#8d8d8f'],
  [/\bnavy(\s*blue)?\b/i, '#1f2a44'],
  [/\b(air\s*force|sky|light)\s*blue\b/i, '#8fb3d9'],
  [/\bblue\b/i, '#2f5fa7'],
  [/\b(army|olive)(\s*green)?\b/i, '#55603a'],
  [/\bmatcha|sage|mint\b/i, '#a9c29a'],
  [/\bgreen\b/i, '#2f7a45'],
  [/\bwine(\s*red)?|burgundy|maroon\b/i, '#6b1f2e'],
  [/\bred\b/i, '#c0272d'],
  [/\b(dusty\s*)?pink\b/i, '#e3a9b4'],
  [/\bpurple|violet|lavender\b/i, '#7a5aa6'],
  [/\borange\b/i, '#e0762f'],
  [/\byellow|mustard\b/i, '#e3b93c'],
  [/\bkhaki|tan|camel\b/i, '#b39a6f'],
  [/\bbrown|coffee|mocha|chocolate\b/i, '#6b4a33'],
];

export function colourwayHex(garmentName: string): string | null {
  const slash = garmentName.lastIndexOf(' / ');
  if (slash < 0) {
    return null;
  }
  const colourway = garmentName.slice(slash + 3);
  for (const [pattern, hex] of COLOUR_WORDS) {
    if (pattern.test(colourway)) {
      return hex;
    }
  }
  return null;
}
