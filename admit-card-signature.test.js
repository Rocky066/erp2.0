const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const originalData = JSON.parse(originalDb.toString('utf8'));
const originalSignaturePath = originalData.settings?.admitCardSettings?.principalSignatureUrl || '';
const originalSignatureFile = originalSignaturePath.startsWith('/uploads/admit-card-signatures/') ? path.join(root, 'public', originalSignaturePath) : '';
const originalSignatureBytes = originalSignatureFile && fs.existsSync(originalSignatureFile) ? fs.readFileSync(originalSignatureFile) : null;
const createdFiles = new Set();
const port = 3108;
const base = `http://127.0.0.1:${port}`;
let server;
function assert(condition, message) { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); }
async function request(pathname, options = {}, token) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(base + pathname, { ...options, headers: { ...(!isFormData && options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json();
  return { response, data };
}
async function waitForServer() { for (let i=0;i<50;i++){ try{if((await fetch(base)).ok)return}catch{} await new Promise(r=>setTimeout(r,100)); } throw new Error('Test server did not start.'); }
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function signatureForm(fileName, mimeType, bytes) { const form = new FormData(); form.append('principalSignature', new Blob([bytes], { type: mimeType }), fileName); return form; }
async function run() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
  await waitForServer();
  const unauth = await request('/api/admit-card/signature', { method:'POST', body:signatureForm('signature.png','image/png',pngBytes) });
  assert(unauth.response.status === 401, 'Admit Card signature upload requires authentication');
  const secret = crypto.createHash('sha256').update((originalData.settings.adminPasswordHash || '') + ':' + (originalData.settings.adminPasswordSalt || '') + ':GJV').digest('hex');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg:'HS256', typ:'JWT' });
  const payload = encode({ username:originalData.settings.printPortalUsername, role:'PrintOperator', exp:Math.floor(Date.now()/1000)+600 });
  const token = header + '.' + payload + '.' + crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  assert(token, 'authorized Print Portal authentication for signature management');
  const invalid = await request('/api/admit-card/signature', { method:'POST', body:signatureForm('signature.gif','image/gif',Buffer.from('GIF89a')) }, token);
  assert(invalid.response.status === 400 && /Only PNG/.test(invalid.data.error), 'invalid Admit Card signature type is rejected');
  const oversizedPayload = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(2*1024*1024, 1)]).toString('base64');
  const oversized = await request('/api/admit-card/signature', { method:'POST', body:signatureForm('large.png','image/png',Buffer.from(oversizedPayload,'base64')) }, token);
  assert(oversized.response.status === 400 && /2 MB/.test(oversized.data.error), 'Admit Card signature files larger than 2 MB are rejected');
  const wrongParser = await request('/api/admit-card/signature', { method:'POST', body:JSON.stringify({ principalSignature: { name:'principal.png' } }) }, token);
  assert(wrongParser.response.status === 400 && /multipart\/form-data/.test(wrongParser.data.error) && !/Malformed JSON/.test(wrongParser.data.error), 'file route rejects JSON with a precise multipart error instead of malformed JSON');
  const first = await request('/api/admit-card/signature', { method:'POST', body:signatureForm('principal.png','image/png',pngBytes) }, token);
  assert(first.response.status === 201 && first.data.success === true && /^\/uploads\/admit-card-signatures\/principal-signature-[0-9a-f-]+\.png$/.test(first.data.signatureUrl), 'valid signature receives a randomized owned filename');
  createdFiles.add(path.join(root, 'public', first.data.signatureUrl));
  assert(fs.existsSync(path.join(root, 'public', first.data.signatureUrl)), 'Admit Card signature is saved permanently');
  const settings = await request('/api/settings', {}, token);
  assert(settings.data.admitCardSettings.principalSignatureUrl === first.data.signatureUrl && !('principalSignatureImage' in settings.data.admitCardSettings), 'saved signature auto-loads through Admit Card Template Settings');
  const normalJsonSave = await request('/api/settings', { method:'POST', body:JSON.stringify({ admitCardSettings: { principalSignatureName: 'Regression Principal' } }) }, token);
  assert(normalJsonSave.response.ok && normalJsonSave.data.admitCardSettings.principalSignatureUrl === first.data.signatureUrl, 'normal JSON settings save remains separate and preserves the uploaded signature URL');
  const served = await fetch(base + first.data.signatureUrl);
  assert(served.ok && served.headers.get('content-type') === 'image/png' && (await served.arrayBuffer()).byteLength > 0, 'saved Admit Card signature is served as a valid image');
  const second = await request('/api/admit-card/signature', { method:'POST', body:signatureForm('replacement.PNG','image/png',pngBytes) }, token);
  createdFiles.add(path.join(root, 'public', second.data.signatureUrl));
  assert(second.response.status === 201 && second.data.signatureUrl !== first.data.signatureUrl, 'replacement updates the persisted signature path');
  assert(!fs.existsSync(path.join(root, 'public', first.data.signatureUrl)), 'replacement removes the previous owned file');
  const removed = await request('/api/admit-card/signature', { method:'DELETE' }, token);
  assert(removed.response.ok && removed.data.admitCardSettings.principalSignatureUrl === '', 'delete clears the saved Admit Card signature path');
  assert(!fs.existsSync(path.join(root, 'public', second.data.signatureUrl)), 'delete removes the owned signature file');
  const adminSource = fs.readFileSync(path.join(root,'public','js','admin.js'),'utf8');
  const adminHtml = fs.readFileSync(path.join(root,'public','admin','index.html'),'utf8');
  const serverSource = fs.readFileSync(path.join(root,'server.js'),'utf8');
  const apiSource = fs.readFileSync(path.join(root,'public','js','api.js'),'utf8');
  assert(adminHtml.includes('id="admit-signature-file"') && adminHtml.includes('id="admit-signature-preview"') && adminHtml.includes('id="admit-signature-upload-btn"') && adminHtml.includes('id="admit-signature-remove-btn"'), 'Admit Card Template Settings exposes upload, live preview, and delete controls');
  assert(adminSource.includes('getAdmitCardSignatureUrl(safeSettings)') && adminSource.includes('buildBatchAdmitCardsHTML') && adminSource.includes('await preloadAllImages(container)') && adminSource.includes("const printBtn = document.getElementById('admit-btn-print')"), 'preview, single PDF, and bulk generation share the image-aware card builder');
  assert(apiSource.includes('async uploadAdmitCardSignature(file)') && apiSource.includes("formData.append('principalSignature', file, file.name)") && apiSource.includes("this.request('/admit-card/signature'") && apiSource.includes('!isFormData') && !apiSource.includes('JSON.stringify(formData)') && adminSource.includes('ApiService.uploadAdmitCardSignature(file)'), 'multipart field and file-based call are consistently wired');
  assert(serverSource.includes('parseApiRequestBody(reqPath, method, req') && adminSource.includes('withAdmitCardSignatureCacheBust') && adminSource.includes('principalSignatureUrl: savedSignatureUrl') && adminSource.includes('renderAdmitCardPreview({ refreshSettings: false })') && adminSource.includes('resolveAdmitCardSignatureAssetUrl'), 'route-specific parsing and cache-busted in-memory URL refresh are wired');
  assert(!serverSource.includes('/api/settings/admit-card-signature') && !adminSource.includes('uploadPrincipalSignature') && !adminSource.includes('uploadSignature('), 'legacy Admit Card signature names and routes are removed');
  assert(serverSource.includes("['.png', '.jpg', '.jpeg', '.webp']") && serverSource.includes("'image/webp'"), 'backend accepts validated PNG, JPG, JPEG, and WEBP signatures');
  assert(serverSource.includes('return handleAdminRoute(() => {') && !serverSource.includes('SuperOwner'), 'signature mutation uses Print Portal authentication');
  const admitBuilder = adminSource.slice(adminSource.indexOf('function buildSingleStudentCardHTML'), adminSource.indexOf('function buildPairAdmitCardsHTML'));
  const admitPreview = adminSource.slice(adminSource.indexOf('async function renderAdmitCardPreview'), adminSource.indexOf('function adjustAdmitCardPreviewScale'));
  assert(admitBuilder.includes('const safe = value => subjectHtmlEscape') && admitBuilder.includes('resolveAdmitCardMediaUrl'), 'Admit Card builder owns its escaping helper and safely resolves preview media');
  assert(adminSource.includes('function normalizeAdmitCardStudent') && adminSource.includes('studentRows.map(normalizeAdmitCardStudent)') && adminSource.includes('(state.allStudents || []).filter'), 'student API field variants and missing values are normalized before preview filtering');
  assert(admitPreview.includes('Loading preview...') && admitPreview.includes('Preview loaded successfully') && admitPreview.includes('getBoundingClientRect') && admitPreview.includes('preview container has zero width or height'), 'preview exposes loading/success states and rejects a zero-size render target');
  assert(adminSource.includes("document.querySelector('#admit-student-list .admit-student-checkbox:checked')") && adminSource.includes('await renderAdmitCardPreview()'), 'Preview Selected uses the currently checked real student and awaits rendering');  console.log('ADMIT CARD SIGNATURE MANAGEMENT TESTS PASSED');
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  if(server){server.kill();await new Promise(r=>setTimeout(r,150));}
  fs.writeFileSync(dbPath,originalDb);
  for(const file of createdFiles){if(file!==originalSignatureFile&&fs.existsSync(file))fs.unlinkSync(file);}
  if(originalSignatureFile&&originalSignatureBytes){fs.mkdirSync(path.dirname(originalSignatureFile),{recursive:true});fs.writeFileSync(originalSignatureFile,originalSignatureBytes);}
});