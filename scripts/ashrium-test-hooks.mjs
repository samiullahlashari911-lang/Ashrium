import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveAlias(specifier) {
  const relative = specifier.slice(2);
  const base = path.join(ROOT, relative);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, 'index.ts'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  return pathToFileURL(base).href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return {
      shortCircuit: true,
      url: resolveAlias(specifier),
    };
  }

  if (specifier.startsWith('next/') && !specifier.endsWith('.js') && !specifier.includes('?')) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      return nextResolve(specifier, context);
    }
  }

  return nextResolve(specifier, context);
}
