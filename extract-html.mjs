import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const htmlPath = join('..', '..', 'owl-launcher.html');
const html = readFileSync(htmlPath, 'utf-8');

// Extract the <style> content
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  console.error('Style not found');
  process.exit(1);
}
const css = styleMatch[1];

// Extract the <script> content (the last one, which is the main renderer logic)
const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g);
if (!scriptMatches || scriptMatches.length === 0) {
  console.error('Script not found');
  process.exit(1);
}
// The last script is the main renderer logic
const lastScript = scriptMatches[scriptMatches.length - 1];
const jsMatch = lastScript.match(/<script>([\s\S]*?)<\/script>/);
const js = jsMatch ? jsMatch[1] : '';

// Extract HTML body (from <body> to </body>)
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) {
  console.error('Body not found');
  process.exit(1);
}
let bodyHtml = bodyMatch[1];

// Remove the script tags from body
bodyHtml = bodyHtml.replace(/<script>[\s\S]*?<\/script>/g, '');

// Write files
writeFileSync(join('src', 'styles.css'), css);
writeFileSync(join('src', 'renderer.js'), js);
writeFileSync(join('src', 'index.html'), `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Xyven — Launcher</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${bodyHtml}
<script src="renderer.js" defer></script>
</body>
</html>`);

console.log('Files extracted successfully');