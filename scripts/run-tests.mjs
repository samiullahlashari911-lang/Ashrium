import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(fullPath)));
      continue;
    }

    if (entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = await collectTestFiles(testsDir);
if (files.length === 0) {
  console.error('No tests found under tests/.');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--import',
    pathToFileURL(path.join(root, 'scripts', 'ashrium-test-loader.mjs')).href,
    '--test',
    ...files,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 1);
});
