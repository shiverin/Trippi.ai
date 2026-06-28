/**
 * Generates PNG icons for PWA from the master trippi.ai icon.
 * Run: node scripts/generate-icons.mjs
 * Called automatically via the "prebuild" npm script.
 */
import { mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');
const brandIconBuffer = readFileSync(join(__dirname, '..', 'public', 'brand', 'trippi-icon.png'));

mkdirSync(iconsDir, { recursive: true });

const sizes = [
  { name: 'favicon-32.png', size: 32 },
  { name: 'apple-touch-icon-180x180.png', size: 180 },
  { name: 'icon-192x192.png', size: 192 },
  { name: 'icon-512x512.png', size: 512 },
];

for (const { name, size } of sizes) {
  await sharp(brandIconBuffer)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(iconsDir, name));
  console.log(`  \u2713 ${name} (${size}x${size})`);
}

console.log('PWA icons generated.');
