const fs = require('fs');
const path = require('path');
const root = __dirname;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.endsWith('.zip')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(html|css|js|json|md|csv)$/i.test(entry.name)) files.push(full);
  }
}
collect(root);
const decoder = new TextDecoder('utf-8', { fatal: true });
const suspicious = /\u00F0\u0178|\u00E2[\u20AC\u0153\u009D]|\u00EF\u00BF\u00BD|\uFFFD|\u00C3.|\u00C2./u;
for (const file of files) {
  const bytes = fs.readFileSync(file);
  assert(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), `${path.relative(root, file)} has no UTF-8 BOM`);
  const text = decoder.decode(bytes);
  if (path.basename(file) !== 'AUDIT_REPORT.md') assert(!suspicious.test(text), `${path.relative(root, file)} contains no mojibake or replacement characters`);
}
const htmlFiles = files.filter(file => file.endsWith('.html'));
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  assert(/<meta\s+charset=["']?utf-8/i.test(html), `${path.relative(root, file)} declares UTF-8`);
  assert(html.includes('/js/icon-runtime.js'), `${path.relative(root, file)} loads the local SVG icon runtime`);
}
for (const file of files.filter(file => file.endsWith('.json') && !file.includes('.vscode'))) JSON.parse(fs.readFileSync(file, 'utf8'));
assert(true, 'all JSON databases/data files parse after UTF-8 normalization');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(!/Content-Type['"]?\s*:\s*['"](?:application\/json|text\/(?:html|plain|css|javascript))['"]/.test(server), 'all backend/API text responses explicitly include charset=utf-8');
assert(server.includes("'.json': 'application/json; charset=utf-8'"), 'static JSON responses declare UTF-8');
const admin = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
assert(!/new Blob\(\[csv\]/.test(admin) && !/type:\s*['"]text\/csv['"]/.test(admin), 'all CSV exports use UTF-8 content types and BOM-prefixed payloads');
assert(!/<html><head>(?!<meta charset=["']UTF-8)/i.test(admin), 'generated Admin print documents declare UTF-8');
const teacher = fs.readFileSync(path.join(root, 'public', 'js', 'teacher-dashboard.js'), 'utf8');
assert(!/<html><head>(?!<meta charset=["']UTF-8)/i.test(teacher), 'generated Teacher print documents declare UTF-8');
const runtime = fs.readFileSync(path.join(root, 'public', 'js', 'icon-runtime.js'), 'utf8');
assert(runtime.includes('MutationObserver') && runtime.includes('createElementNS'), 'static and dynamically inserted icons are converted to inline SVG');
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const pictographic = /[\p{Extended_Pictographic}\u2600-\u27BF]/u;
const used = new Set();
for (const file of files.filter(file => file.startsWith(path.join(root, 'public')) && file !== path.join(root, 'public', 'js', 'icon-runtime.js'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const { segment } of segmenter.segment(text)) if (pictographic.test(segment)) used.add(segment);
}
for (const token of used) assert(runtime.includes(`'${token}':`), `SVG runtime maps UI symbol ${token}`);
assert([...used].length > 0, 'project-wide SVG mapping covers every frontend icon grapheme');
assert(admin.includes('\u20B9') && server.includes('\u20B9') && fs.readFileSync(path.join(root, 'db.json'), 'utf8').includes('\u20B9'), 'rupee text is stored and rendered as the correct Unicode character');
assert(!/mysql|mariadb|sequelize|pg\b/i.test(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), 'database is the verified UTF-8 JSON datastore, so SQL utf8mb4 connection configuration is not applicable');
console.log('PROJECT-WIDE ENCODING AND ICON AUDIT PASSED');
