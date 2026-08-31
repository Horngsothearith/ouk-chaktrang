// Concatenates the modular src/ files and styles.css into one self-contained
// HTML file, suitable for publishing as a Claude Artifact (no external
// <script src>/<link> references allowed there).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const jsFiles = ['src/engine.js', 'src/ai.js', 'src/pieces.js', 'src/review.js', 'src/ui.js'];
const js = jsFiles.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const bodyMatch = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('could not find <body> in index.html');
let body = bodyMatch[1];

// index.html's inline caller script (the one with no src=, that calls
// OukUI.createApp) must run AFTER the bundled library script below - pull it
// out separately rather than leaving it in document order, where it would
// otherwise still precede the bundle and fail with "OukUI is not defined".
const inlineScriptMatch = body.match(/<script>([\s\S]*?)<\/script>/);
if (!inlineScriptMatch) throw new Error('could not find the inline caller <script> in index.html');
const inlineScript = inlineScriptMatch[1];

// Strip the modular <link>/<script src> tags and the inline script from the
// markup; both are replaced by the inlined <style>/<script> blocks below.
body = body.replace(/<link rel="stylesheet"[^>]*>\s*/g, '');
body = body.replace(/<script src="[^"]*"><\/script>\s*/g, '');
body = body.replace(/<script>[\s\S]*?<\/script>\s*/g, '');

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ouk Chaktrang</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
${inlineScript}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'artifact', 'ouk-chaktrong.html'), out);
console.log('Wrote artifact/ouk-chaktrong.html (' + out.length + ' bytes)');
