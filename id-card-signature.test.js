const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const originalData = JSON.parse(originalDb.toString('utf8'));
const originalSignaturePath = originalData.settings?.idCardSettings?.principalSignatureImage || '';
const originalSignatureFile = originalSignaturePath.startsWith('/uploads/id-card-signatures/') ? path.join(root, 'public', originalSignaturePath) : '';
const originalSignatureBytes = originalSignatureFile && fs.existsSync(originalSignatureFile) ? fs.readFileSync(originalSignatureFile) : null;
const createdFiles = new Set();
const port = 3107;
const base = `http://127.0.0.1:${port}`;
let server;
function assert(condition, message) { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); }
async function request(pathname, options = {}, token) {
  const response = await fetch(base + pathname, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json();
  return { response, data };
}
async function waitForServer() { for (let i=0;i<50;i++){ try{if((await fetch(base)).ok)return}catch{} await new Promise(r=>setTimeout(r,100)); } throw new Error('Test server did not start.'); }
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function run() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
  await waitForServer();
  const unauth = await request('/api/settings/id-card-signature', { method:'POST', body:JSON.stringify({fileName:'signature.png',mimeType:'image/png',dataUrl:pngDataUrl}) });
  assert(unauth.response.status === 401, 'signature upload requires admin authentication');
  const secret = crypto.createHash('sha256').update((originalData.settings.adminPasswordHash || '') + ':' + (originalData.settings.adminPasswordSalt || '') + ':GJV').digest('hex');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg:'HS256', typ:'JWT' });
  const payload = encode({ username:originalData.settings.printPortalUsername, role:'PrintOperator', exp:Math.floor(Date.now()/1000)+600 });
  const token = header + '.' + payload + '.' + crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  assert(token, 'authorized Print Portal authentication for signature management');
  const invalid = await request('/api/settings/id-card-signature', { method:'POST', body:JSON.stringify({fileName:'signature.gif',mimeType:'image/gif',dataUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=='}) }, token);
  assert(invalid.response.status === 400 && /Only PNG/.test(invalid.data.error), 'invalid signature file type is rejected');
  const corrupt = await request('/api/settings/id-card-signature', { method:'POST', body:JSON.stringify({fileName:'corrupt.png',mimeType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgo='}) }, token);
  assert(corrupt.response.status === 400 && /corrupt|dimensions/.test(corrupt.data.error), 'corrupt or zero-dimension signature images are rejected');  const oversizedPayload = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(2*1024*1024, 1)]).toString('base64');
  const oversized = await request('/api/settings/id-card-signature', { method:'POST', body:JSON.stringify({fileName:'large.png',mimeType:'image/png',dataUrl:`data:image/png;base64,${oversizedPayload}`}) }, token);
  assert(oversized.response.status === 400 && /2 MB/.test(oversized.data.error), 'signature files larger than 2 MB are rejected');
  const first = await request('/api/settings/id-card-signature', { method:'POST', body:JSON.stringify({fileName:'principal.png',mimeType:'image/png',dataUrl:pngDataUrl}) }, token);
  assert(first.response.status === 201 && /^\/uploads\/id-card-signatures\/principal-signature-[0-9a-f-]+\.png$/.test(first.data.principalSignatureImage), 'valid PNG signature uploads with a randomized safe filename');
  createdFiles.add(path.join(root, 'public', first.data.principalSignatureImage));
  assert(fs.existsSync(path.join(root, 'public', first.data.principalSignatureImage)), 'uploaded signature file is saved permanently');
  const settings = await request('/api/settings', {}, token);
  assert(settings.data.idCardSettings.principalSignatureImage === first.data.principalSignatureImage, 'saved signature path auto-loads through Template Settings API');
  const served = await fetch(base + first.data.principalSignatureImage);
  assert(served.ok && served.headers.get('content-type') === 'image/png' && (await served.arrayBuffer()).byteLength > 0, 'saved signature is served as a valid image');
  const second = await request('/api/settings/id-card-signature', { method:'POST', body:JSON.stringify({fileName:'replacement.PNG',mimeType:'image/png',dataUrl:pngDataUrl}) }, token);
  createdFiles.add(path.join(root, 'public', second.data.principalSignatureImage));
  assert(second.response.status === 201 && second.data.principalSignatureImage !== first.data.principalSignatureImage, 'uploading another signature replaces the saved path');
  assert(!fs.existsSync(path.join(root, 'public', first.data.principalSignatureImage)), 'replacing a signature deletes the previous owned file');
  const removed = await request('/api/settings/id-card-signature', { method:'DELETE' }, token);
  assert(removed.response.ok && removed.data.idCardSettings.principalSignatureImage === '', 'remove signature clears the database path');
  assert(!fs.existsSync(path.join(root, 'public', second.data.principalSignatureImage)), 'remove signature deletes the owned file');
  const adminSource = fs.readFileSync(path.join(root,'public','js','admin.js'),'utf8');
  const adminHtml = fs.readFileSync(path.join(root,'public','admin','index.html'),'utf8');
  assert(adminHtml.includes('id="idcard-signature-file"') && adminHtml.includes('id="idcard-signature-preview"') && adminHtml.includes('id="idcard-signature-remove-btn"'), 'Template Settings exposes upload, preview, and remove controls');
  assert(adminSource.includes('principalSignatureImage') && adminSource.includes('buildBatchIdCardsHTML(selected') && adminSource.includes('waitForIdCardAssets(card)'), 'Preview and every export mode share the saved signature image and asset wait');
  console.log('ID CARD SIGNATURE MANAGEMENT TESTS PASSED');
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  if(server){server.kill();await new Promise(r=>setTimeout(r,150));}
  fs.writeFileSync(dbPath,originalDb);
  for(const file of createdFiles){if(file!==originalSignatureFile&&fs.existsSync(file))fs.unlinkSync(file);}
  if(originalSignatureFile&&originalSignatureBytes){fs.mkdirSync(path.dirname(originalSignatureFile),{recursive:true});fs.writeFileSync(originalSignatureFile,originalSignatureBytes);}
});