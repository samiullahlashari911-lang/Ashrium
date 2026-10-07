import { readFileSync } from 'node:fs';

const text = readFileSync('.env.local', 'utf8');
let token = '';
for (const line of text.split(/\r?\n/)) {
  if (!line.startsWith('HF_TOKEN=')) continue;
  token = line.slice('HF_TOKEN='.length).trim();
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1);
  }
}
console.log(
  JSON.stringify({
    present: token.length > 0,
    length: token.length,
    hf_prefix: token.startsWith('hf_'),
  }),
);
