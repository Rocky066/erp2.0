const fs = require('fs');
const path = require('path');
const root = __dirname;
const source = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}
const start = source.indexOf('function teacherDirectoryIcon(');
const end = source.indexOf('// Bind search and filters', start);
const block = source.slice(start, end);
assert(start >= 0 && end > start, 'Teacher Directory icon renderer is present');
assert(block.includes('<svg aria-hidden="true" focusable="false"') && block.includes('viewBox="0 0 24 24"'), 'action icons use browser-native inline SVG');
for (const name of ['view', 'login', 'permissions', 'salary', 'edit', 'card', 'delete']) {
  assert(block.includes(`teacherDirectoryIcon('${name}')`) || block.includes(`${name}: '<`), `${name} action has a professional SVG icon`);
}
const actions = {
  'view-profile': 'window.openTeacherProfileModal',
  'manage-login': 'window.openTeacherLoginModal',
  'manage-permissions': 'window.openTeacherPermissionsModal',
  'salary-details': 'window.openTeacherSalaryModal',
  'edit-teacher': 'window.editTeacherModal',
  'id-card': 'window.generateTeacherIdCard',
  'delete-teacher': 'window.openDeleteTeacherModal'
};
for (const [action, handler] of Object.entries(actions)) {
  assert(block.includes(`data-action="${action}"`) && block.includes(`onclick="${handler}`), `${action} keeps its existing handler`);
}
assert(!/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(block), 'Teacher Directory renderer contains no emoji action icons');
assert(!/[\u00F0\u00C3\uFFFD]|\u00E2[\u20AC\u0153\u009D]|\u00EF\u00BF\u00BD/.test(block), 'Teacher Directory renderer contains no mojibake');
assert(block.includes('aria-label="View Teacher Profile"') && block.includes('aria-label="Delete Teacher Record"'), 'action buttons retain accessible labels and tooltips');
const frontendFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(html|css|js)$/i.test(entry.name)) frontendFiles.push(full);
  }
}
collect(path.join(root, 'public'));
const decoder = new TextDecoder('utf-8', { fatal: true });
for (const file of frontendFiles) {
  const bytes = fs.readFileSync(file);
  assert(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), `${path.relative(root, file)} has no UTF-8 BOM`);
  decoder.decode(bytes);
}
for (const file of frontendFiles.filter(file => file.endsWith('.html'))) {
  assert(/<meta\s+charset=["']?utf-8/i.test(fs.readFileSync(file, 'utf8')), `${path.relative(root, file)} declares UTF-8`);
}
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(server.includes("'.html': 'text/html; charset=utf-8'") && server.includes("'.js': 'text/javascript; charset=utf-8'") && server.includes("'.css': 'text/css; charset=utf-8'"), 'deployed frontend responses explicitly declare UTF-8');
console.log('TEACHER DIRECTORY ICON AND UTF-8 AUDIT PASSED');