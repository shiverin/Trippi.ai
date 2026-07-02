import { copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const indexPath = join(distDir, 'index.html');

const seoEntryPoints = ['ai-trip-planner', 'group-trip-planner', 'travel-itinerary-generator', 'trippi-travel'];

for (const entryPoint of seoEntryPoints) {
  const targetDir = join(distDir, entryPoint);
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(indexPath, join(targetDir, 'index.html'));
  console.log(`  ✓ ${entryPoint}/index.html`);
}
