import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const specPath = join('..', '..', 'owl-design-spec.html');
const html = readFileSync(specPath, 'utf-8');

// Extract the manifest script
const manifestMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
if (!manifestMatch) {
  console.error('Manifest not found');
  process.exit(1);
}

const manifest = JSON.parse(manifestMatch[1]);

// Font UUIDs from the manifest
const fontMap = {
  'cbf13e3b-8e19-4384-9e93-27e62a7d48e7': 'alfa-slab-one-latin.woff2',
  '3d28f071-2bcb-4db0-86a0-2360e19f902c': 'space-mono-400-latin.woff2',
  '0019e70c-3ff2-415b-8d63-53cd2cefa6b5': 'space-mono-700-latin.woff2',
};

// We only need the latin subset
const neededUuids = [
  'cbf13e3b-8e19-4384-9e93-27e62a7d48e7', // Alfa Slab One
  '3d28f071-2bcb-4db0-86a0-2360e19f902c', // Space Mono 400
  '0019e70c-3ff2-415b-8d63-53cd2cefa6b5', // Space Mono 700
];

for (const uuid of neededUuids) {
  const entry = manifest[uuid];
  if (!entry) {
    console.error(`UUID ${uuid} not found in manifest`);
    continue;
  }
  
  const data = entry.data;
  const binaryStr = Buffer.from(data, 'base64');
  const outputPath = join('public', 'fonts', fontMap[uuid]);
  writeFileSync(outputPath, binaryStr);
  console.log(`Extracted: ${fontMap[uuid]} (${binaryStr.length} bytes)`);
}

console.log('Fonts extracted successfully');