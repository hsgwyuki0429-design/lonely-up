// Copies browser bundles from node_modules into public/vendor so the game
// runs without a bundler and without CDN dependencies.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vendorDir = path.join(root, 'public', 'vendor');
mkdirSync(vendorDir, { recursive: true });

const files = [
  ['node_modules/three/build/three.module.js', 'three.module.js'],
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js'],
];

for (const [src, dest] of files) {
  const from = path.join(root, src);
  if (!existsSync(from)) {
    console.error(`[copy-vendor] missing ${src} — run npm install first`);
    process.exit(1);
  }
  copyFileSync(from, path.join(vendorDir, dest));
  console.log(`[copy-vendor] ${src} -> public/vendor/${dest}`);
}
