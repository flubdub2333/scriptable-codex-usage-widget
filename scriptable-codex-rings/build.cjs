const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const original = fs.readFileSync(path.join(root, '..', 'scriptable-codex-usage', 'Codex Usage.js'), 'utf8');
const start = original.indexOf('function renderUsage(state, now = Date.now()) {');
const end = original.indexOf('async function usageMain()', start);
if (start < 0 || end < 0) throw new Error('Cannot locate the original renderer boundaries');
const renderer = fs.readFileSync(path.join(root, 'ring-renderer.js'), 'utf8');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const [name, style] of [['Codex Rings Duo.js', 'duo'], ['Codex Rings Orbit.js', 'orbit']]) {
  fs.writeFileSync(path.join(output, name), original.slice(0, start) + `const RING_STYLE = '${style}';\n` + renderer + '\n' + original.slice(end));
  console.log(`Built ${name}`);
}
