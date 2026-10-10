// Operator: re-grade a tenant's catalog from the size charts already saved, so every
// graded size gets its sewn 3D garment (`{SIZE}.garment.json`) for the shopper drape.
// No Shopify call: name, category and the published chart come from
// the database. Run from the repo root with credentials in .env.local:
//
//   node --experimental-strip-types --import ./scripts/ashrium-test-loader.mjs \
//     scripts/regrade-garments.ts --tenant <tenant-uuid> [--match "Men's"] [--dry-run]
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2];
  }
}

const { createServiceClient } = await import('@/lib/supabase/service');
const { runPatternPrediction } = await import('@/lib/ml/gpu');
const { writeRestLengthMesh, writeSewnGarmentMesh } = await import('@/lib/catalog/rest-length-store');
const { readGarmentCategory } = await import('@/types/garment');

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? '' : null;
}

const tenantId = flag('tenant');
if (!tenantId) {
  throw new Error('Pass --tenant <tenant-uuid>.');
}
const match = (flag('match') ?? '').toLowerCase();
const dryRun = process.argv.includes('--dry-run');
const supabase = createServiceClient();

const { data: profiles, error } = await supabase
  .from('garment_cad_profiles')
  .select('id, name, category, mode, print_qa_passed')
  .eq('tenant_id', tenantId);
if (error || !profiles) {
  throw new Error(error?.message ?? 'No garment profiles.');
}

// Colourways of one product share one pattern: grade once per product name.
const graded = new Map<string, Awaited<ReturnType<typeof runPatternPrediction>>>();
let written = 0;
for (const profile of profiles) {
  const productName = profile.name.split(' / ')[0];
  const category = readGarmentCategory(profile.category);
  if (!category || (match && !profile.name.toLowerCase().includes(match))) {
    continue;
  }
  const { data: variants } = await supabase
    .from('garment_size_variants')
    .select('id, size_code, chest_cm, waist_cm, hip_cm, length_cm')
    .eq('tenant_id', tenantId)
    .eq('garment_id', profile.id);
  const sizes = (variants ?? []).filter((variant) => (variant.length_cm ?? 0) > 0
    && (category === 'pant' ? (variant.waist_cm ?? 0) > 0 || (variant.hip_cm ?? 0) > 0 : (variant.chest_cm ?? 0) > 0));
  if (sizes.length === 0 || sizes.length !== (variants ?? []).length) {
    console.log(`skip  ${profile.name}: chart incomplete`);
    continue;
  }

  // Same order for every colourway, so each product grades once.
  sizes.sort((left, right) => left.size_code.localeCompare(right.size_code));
  const sizeVariants = sizes.map((variant) => ({
    sizeCode: variant.size_code,
    chestCm: variant.chest_cm ?? 0,
    waistCm: variant.waist_cm ?? 0,
    hipCm: variant.hip_cm ?? 0,
    lengthCm: variant.length_cm ?? 0,
  }));
  const key = `${productName}\u0000${JSON.stringify(sizeVariants)}\u0000${category}`;
  if (dryRun) {
    console.log(`would grade ${profile.name} (${sizes.map((size) => size.size_code).join(' ')})`);
    continue;
  }
  let result = graded.get(key);
  if (!result) {
    result = await runPatternPrediction({
      category,
      productText: productName,
      sizeVariants,
    });
    graded.set(key, result);
  }
  if (result.status !== 'ok') {
    // No 3D for this product now: drop any garment an older grade left behind.
    await supabase
      .from('garment_size_variants')
      .update({ rest_length_path: null })
      .eq('tenant_id', tenantId)
      .eq('garment_id', profile.id);
    await supabase
      .from('garment_cad_profiles')
      .update({ approximate_fit: true })
      .eq('tenant_id', tenantId)
      .eq('id', profile.id);
    console.log(`fail  ${profile.name}: ${result.status} ${result.unsupportedReason ?? ''}`);
    continue;
  }

  for (const mesh of result.meshes) {
    const variant = sizes.find((size) => size.size_code === mesh.sizeCode);
    const sewn = result.garments.get(mesh.sizeCode);
    if (!variant || !sewn) {
      continue;
    }
    const path = await writeRestLengthMesh(tenantId, profile.id, mesh);
    await writeSewnGarmentMesh(path, sewn);
    const { error: updateError } = await supabase
      .from('garment_size_variants')
      .update({ rest_length_path: path })
      .eq('tenant_id', tenantId)
      .eq('id', variant.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
    written += 1;
  }
  // Graded and sewn: Approximate only for what ingest would still flag (Mode C, failed print QA).
  await supabase
    .from('garment_cad_profiles')
    .update({ approximate_fit: profile.mode === 'C' || !profile.print_qa_passed })
    .eq('tenant_id', tenantId)
    .eq('id', profile.id);
  console.log(`ok    ${profile.name}: ${result.meshes.map((mesh) => mesh.sizeCode).join(' ')}`);
}
console.log(`${written} sizes written`);
