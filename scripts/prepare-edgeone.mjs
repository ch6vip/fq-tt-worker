import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'dist-edgeone');
const edgeDir = join(outDir, 'edge-functions');
const entry = join(edgeDir, 'index.js');
const catchAll = join(edgeDir, '[[default]].js');
const limitBytes = 5 * 1024 * 1024;

await mkdir(dirname(catchAll), { recursive: true });
await copyFile(entry, catchAll);
await writeFile(join(outDir, '.gitkeep'), '');

const { size } = await stat(entry);
const mib = (size / 1024 / 1024).toFixed(2);
if (size > limitBytes) {
  throw new Error(`EdgeOne function bundle is ${mib} MiB, over the 5 MiB Edge Functions limit`);
}

console.log(`EdgeOne bundle ready: dist-edgeone/edge-functions/index.js (${mib} MiB)`);
console.log('Copied catch-all route: dist-edgeone/edge-functions/[[default]].js');
