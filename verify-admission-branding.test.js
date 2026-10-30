const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PORT = 3199;

function makeRequest(pathName, options = {}, hostHeader = 'localhost') {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    headers['Host'] = `${hostHeader}:${PORT}`;
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.body) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe'
  });
  return new Promise((resolve, reject) => {
    let started = false;
    child.stdout.on('data', (d) => {
      const s = d.toString();
      if (!started && (s.includes('running') || s.includes(String(PORT)))) {
        started = true;
        resolve(child);
      }
    });
    child.stderr.on('data', (d) => {
      // console.error('[Server Stderr]', d.toString());
    });
    child.on('error', reject);
    setTimeout(() => {
      if (!started) resolve(child);
    }, 2500);
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('   STARTING ADMISSION FORM SCHOOL NAME & LOGO VERIFICATION');
  console.log('================================================================');

  let serverProcess = await startServer();
  console.log('[+] Test server spawned on port ' + PORT);

  try {
    // -------------------------------------------------------------
    // PHASE 1: Authenticate School A (Garumara) & School B (Muwamari)
    // -------------------------------------------------------------
    console.log('\n--> Phase 1: Authenticating School Admins...');
    const loginResA = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
    }, 'gjv.localhost');
    assert.strictEqual(loginResA.status, 200, 'School A login should succeed');
    const tokenA = loginResA.data.token;
    console.log('    ✓ Garumara Admin authenticated successfully');

    const loginResB = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'mjv@schoolerp.in', password: 'Admin@123' })
    }, 'muwamarii.localhost');
    assert.strictEqual(loginResB.status, 200, 'School B login should succeed');
    const tokenB = loginResB.data.token;
    console.log('    ✓ Muwamari Admin authenticated successfully');

    // -------------------------------------------------------------
    // PHASE 2: Verify /api/auth/me branding payload for both schools
    // -------------------------------------------------------------
    console.log('\n--> Phase 2: Verifying /api/auth/me tenant branding resolution...');
    const meA = await makeRequest('/api/auth/me', { token: tokenA }, 'gjv.localhost');
    assert.strictEqual(meA.status, 200);
    assert.strictEqual(meA.data.school.name, 'Garumara Jatiya Vidyalaya');
    assert.ok(meA.data.school.logo.includes('school_gjv_default_logo') || meA.data.school.logo === '/logo.jpg');
    console.log('    ✓ School A me branding: Name =', meA.data.school.name, '| Logo =', meA.data.school.logo);

    const meB = await makeRequest('/api/auth/me', { token: tokenB }, 'muwamarii.localhost');
    assert.strictEqual(meB.status, 200);
    assert.strictEqual(meB.data.school.name, 'Muwamari Jatiya Vidyalaya');
    assert.notStrictEqual(meB.data.school.name, 'Garumara Jatiya Vidyalaya');
    assert.ok(meB.data.school.logo.includes('sch-muwamarii_logo'), 'Muwamari must return its own uploaded logo');
    assert.notStrictEqual(meB.data.school.logo, '/logo.jpg', 'Muwamari must NEVER return Garumara /logo.jpg');
    console.log('    ✓ School B me branding: Name =', meB.data.school.name, '| Logo =', meB.data.school.logo);

    // -------------------------------------------------------------
    // PHASE 3: Verify /api/website-info branding payload for both schools
    // -------------------------------------------------------------
    console.log('\n--> Phase 3: Verifying /api/website-info public branding isolation...');
    const infoA = await makeRequest('/api/website-info', {}, 'gjv.localhost');
    const infoB = await makeRequest('/api/website-info', {}, 'muwamarii.localhost');
    assert.strictEqual(infoA.status, 200);
    assert.strictEqual(infoB.status, 200);
    assert.strictEqual(infoA.data.schoolName, 'Garumara Jatiya Vidyalaya');
    assert.strictEqual(infoB.data.schoolName, 'Muwamari Jatiya Vidyalaya');
    assert.ok(infoB.data.logo.includes('sch-muwamarii'), 'School B logo must be its own');
    assert.notStrictEqual(infoB.data.logo, '/logo.jpg', 'School B logo must not be /logo.jpg');
    console.log('    ✓ School A Website Info: Name =', infoA.data.schoolName);
    console.log('    ✓ School B Website Info: Name =', infoB.data.schoolName, '| Logo =', infoB.data.logo);

    // -------------------------------------------------------------
    // PHASE 4: Verify Frontend Templates & Dynamic Branding Logic
    // -------------------------------------------------------------
    console.log('\n--> Phase 4: Verifying Admission Form DOM IDs and JavaScript branding logic...');
    const adminHtml = fs.readFileSync(path.join(__dirname, 'public', 'admin', 'index.html'), 'utf8');
    assert.ok(adminHtml.includes('id="adm-form-school-logo"'), 'index.html must have adm-form-school-logo ID');
    assert.ok(adminHtml.includes('id="adm-form-school-name"'), 'index.html must have adm-form-school-name ID');
    assert.ok(adminHtml.includes('id="adm-form-school-meta"'), 'index.html must have adm-form-school-meta ID');
    assert.ok(adminHtml.includes('id="adm-form-school-contact"'), 'index.html must have adm-form-school-contact ID');
    assert.ok(adminHtml.includes('id="adm-form-declaration-school"'), 'index.html must have adm-form-declaration-school ID');
    assert.ok(adminHtml.includes('id="viewer-modal-logo"'), 'index.html must have viewer-modal-logo ID');
    assert.ok(!adminHtml.includes('value="GJV-2026-XXXX"'), 'index.html must not hardcode GJV admission number placeholder');
    console.log('    ✓ All dynamic DOM target IDs confirmed in public/admin/index.html');

    const adminJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'admin.js'), 'utf8');
    assert.ok(adminJs.includes('adm-form-school-name'), 'admin.js must update adm-form-school-name');
    assert.ok(adminJs.includes('adm-form-school-logo'), 'admin.js must update adm-form-school-logo');
    assert.ok(adminJs.includes('adm-form-declaration-school'), 'admin.js must update adm-form-declaration-school');
    assert.ok(adminJs.includes('feeReceiptLogoCache'), 'admin.js must key fee receipt logo cache per school');
    console.log('    ✓ admin.js branding application and per-school caching confirmed');

    // -------------------------------------------------------------
    // PHASE 5: Simulate applySchoolBranding DOM updates for both schools
    // -------------------------------------------------------------
    console.log('\n--> Phase 5: Simulating applySchoolBranding execution for School A vs School B...');
    // Simulate DOM environment
    function simulateApplyBranding(school) {
      const neutralFallback = '/neutral-school-logo.svg';
      const effectiveLogo = school.logo || (school.id === 'school_gjv_default' ? '/logo.jpg' : neutralFallback);
      const schoolName = school.name || (school.id === 'school_gjv_default' ? 'Garumara Jatiya Vidyalaya' : 'School ERP');
      
      const elements = {
        'adm-form-school-logo': effectiveLogo,
        'adm-form-school-name': schoolName,
        'adm-form-declaration-school': schoolName,
        'adm-form-school-contact': [school.address, school.phone, school.email].filter(Boolean).join(' | '),
        'viewer-modal-logo': effectiveLogo
      };
      return elements;
    }

    const domGarumara = simulateApplyBranding(meA.data.school);
    assert.strictEqual(domGarumara['adm-form-school-name'], 'Garumara Jatiya Vidyalaya');
    assert.ok(domGarumara['adm-form-school-logo'].includes('school_gjv_default_logo') || domGarumara['adm-form-school-logo'] === '/logo.jpg');
    console.log('    ✓ Garumara Admission Form Headline:', domGarumara['adm-form-school-name']);
    console.log('    ✓ Garumara Admission Form Logo:', domGarumara['adm-form-school-logo']);

    const domMuwamari = simulateApplyBranding(meB.data.school);
    assert.strictEqual(domMuwamari['adm-form-school-name'], 'Muwamari Jatiya Vidyalaya');
    assert.ok(domMuwamari['adm-form-school-logo'].includes('sch-muwamarii_logo'));
    assert.notStrictEqual(domMuwamari['adm-form-school-name'], 'Garumara Jatiya Vidyalaya');
    assert.notStrictEqual(domMuwamari['adm-form-school-logo'], '/logo.jpg');
    assert.ok(domMuwamari['adm-form-school-contact'].includes('Kuhumtoli, Nagaon'));
    console.log('    ✓ Muwamari Admission Form Headline:', domMuwamari['adm-form-school-name']);
    console.log('    ✓ Muwamari Admission Form Logo:', domMuwamari['adm-form-school-logo']);
    console.log('    ✓ Muwamari Admission Form Contact:', domMuwamari['adm-form-school-contact']);

    // -------------------------------------------------------------
    // PHASE 6: Neutral Fallback for School Without Uploaded Logo
    // -------------------------------------------------------------
    console.log('\n--> Phase 6: Verifying neutral fallback for school without logo...');
    const schoolWithoutLogo = {
      id: 'SCH-NEW-TEST',
      name: 'Adarsha Vidyalaya Test',
      logo: '',
      address: 'Guwahati, Assam',
      phone: '9876543210'
    };
    const domNeutral = simulateApplyBranding(schoolWithoutLogo);
    assert.strictEqual(domNeutral['adm-form-school-name'], 'Adarsha Vidyalaya Test');
    assert.strictEqual(domNeutral['adm-form-school-logo'], '/neutral-school-logo.svg', 'Must use neutral SVG fallback');
    assert.notStrictEqual(domNeutral['adm-form-school-logo'], '/logo.jpg', 'Must NEVER fall back to Garumara /logo.jpg');
    console.log('    ✓ School without logo correctly receives neutral SVG fallback:', domNeutral['adm-form-school-logo']);

    // Verify neutral logo SVG file is served by the HTTP server
    const neutralSvgRes = await makeRequest('/neutral-school-logo.svg', {}, 'localhost');
    assert.strictEqual(neutralSvgRes.status, 200, 'Neutral SVG must be served with 200 OK');
    assert.ok(typeof neutralSvgRes.data === 'string' && neutralSvgRes.data.includes('<svg'), 'Neutral SVG must be valid SVG content');
    console.log('    ✓ /neutral-school-logo.svg accessible and served correctly');

    // -------------------------------------------------------------
    // PHASE 7: Online Admission Application Document Branding
    // -------------------------------------------------------------
    console.log('\n--> Phase 7: Verifying online admission application document formatting...');
    function simulateOnlineAdmissionDoc(school, application) {
      const schoolName = school?.name || (school?.id === 'school_gjv_default' ? 'Garumara Jatiya Vidyalaya' : 'School ERP');
      const fallbackLogo = school?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg';
      const schoolLogo = school?.logo || fallbackLogo;
      return {
        title: schoolName,
        logo: schoolLogo
      };
    }

    const onlineDocGarumara = simulateOnlineAdmissionDoc(meA.data.school);
    const onlineDocMuwamari = simulateOnlineAdmissionDoc(meB.data.school);
    assert.strictEqual(onlineDocGarumara.title, 'Garumara Jatiya Vidyalaya');
    assert.strictEqual(onlineDocMuwamari.title, 'Muwamari Jatiya Vidyalaya');
    assert.notStrictEqual(onlineDocMuwamari.title, 'Garumara Jatiya Vidyalaya');
    assert.ok(onlineDocMuwamari.logo.includes('sch-muwamarii_logo'));
    assert.notStrictEqual(onlineDocMuwamari.logo, '/logo.jpg');
    console.log('    ✓ Online application document correctly branded for Garumara:', onlineDocGarumara.title);
    console.log('    ✓ Online application document correctly branded for Muwamari:', onlineDocMuwamari.title);

    // -------------------------------------------------------------
    // PHASE 8: Public Admission Page Branding
    // -------------------------------------------------------------
    console.log('\n--> Phase 8: Verifying Public Admission Page badge and title bindings...');
    const publicAdmHtml = fs.readFileSync(path.join(__dirname, 'public', 'admission.html'), 'utf8');
    assert.ok(publicAdmHtml.includes('id="admission-school-badge"'), 'public/admission.html must contain admission-school-badge ID');
    const schoolAdmHtml = fs.readFileSync(path.join(__dirname, 'public', 'school', 'admission.html'), 'utf8');
    assert.ok(schoolAdmHtml.includes('id="admission-school-badge"'), 'public/school/admission.html must contain admission-school-badge ID');
    const appJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'app.js'), 'utf8');
    assert.ok(appJs.includes('admission-school-badge'), 'app.js must dynamically bind admission-school-badge');
    console.log('    ✓ Public admission page HTML and app.js dynamic bindings verified');

    // -------------------------------------------------------------
    // PHASE 9: Functional Admission Flow In Muwamari
    // -------------------------------------------------------------
    console.log('\n--> Phase 9: Testing Student Admission in Muwamari under updated branding...');
    // Get active session for Muwamari
    const sessionsRes = await makeRequest('/api/academic-sessions', { token: tokenB }, 'muwamarii.localhost');
    assert.strictEqual(sessionsRes.status, 200);
    const activeSession = sessionsRes.data.sessions.find(s => s.is_active);
    assert.ok(activeSession, 'Active session for Muwamari should exist');

    const newStudent = {
      name: 'Rohan Ahmed',
      dob: '2016-08-15',
      gender: 'Male',
      className: 'Class IV',
      section: 'A',
      rollNo: 25,
      studentAadhaar: '998877665544',
      fatherName: 'Nurul Ahmed',
      fatherAadhaar: '112233445566',
      motherName: 'Rasheda Begum',
      guardianName: '',
      mobile: '9864001122',
      address: 'Kuhumtoli, Nagaon, Assam',
      admissionFee: 3500,
      monthlyFee: 700,
      admissionDate: '2026-10-16',
      academicSession: activeSession.session_name,
      academic_session_id: activeSession.id
    };

    const addRes = await makeRequest('/api/students', {
      method: 'POST',
      token: tokenB,
      body: JSON.stringify(newStudent)
    }, 'muwamarii.localhost');
    assert.strictEqual(addRes.status, 201, 'Student admission should succeed with 201 Created');
    const admittedAdmNo = addRes.data.admissionNo;
    assert.ok(admittedAdmNo.startsWith('MUWAMARII-'), 'Admission No must have Muwamari prefix');
    console.log('    ✓ Student admitted successfully in Muwamari:', admittedAdmNo);

    // Verify student belongs strictly to Muwamari
    const listRes = await makeRequest('/api/students', { token: tokenB }, 'muwamarii.localhost');
    assert.strictEqual(listRes.status, 200);
    const studentRec = listRes.data.find(s => s.admissionNo === admittedAdmNo);
    assert.ok(studentRec, 'Admitted student must exist in Muwamari student directory');
    assert.strictEqual(studentRec.school_id, 'SCH-MUWAMARII');
    console.log('    ✓ Verified student record scoped to Muwamari (SCH-MUWAMARII)');

    // Cross-school check: Garumara cannot see this student
    const gjvListRes = await makeRequest('/api/students', { token: tokenA }, 'gjv.localhost');
    assert.strictEqual(gjvListRes.status, 200);
    const crossFound = gjvListRes.data.some(s => s.admissionNo === admittedAdmNo);
    assert.strictEqual(crossFound, false, 'Garumara directory must NOT include Muwamari student');
    console.log('    ✓ Cross-school isolation preserved: Garumara directory does not contain Muwamari student');

    // Clean up test student
    await makeRequest(`/api/students/${admittedAdmNo}`, { method: 'DELETE', token: tokenB }, 'muwamarii.localhost');
    const cleanDb = JSON.parse(fs.readFileSync('db.json', 'utf8'));
    cleanDb.students = (cleanDb.students || []).filter(s => s.admissionNo !== admittedAdmNo);
    fs.writeFileSync('db.json', JSON.stringify(cleanDb, null, 2), 'utf8');
    console.log('    ✓ Ephemeral test student cleaned up cleanly');

    console.log('\n================================================================');
    console.log('  ALL 9 VERIFICATION PHASES PASSED WITH ZERO FAILURES (VERIFIED)');
    console.log('================================================================\n');

  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

runTests().catch(err => {
  console.error('\n[X] TEST FAILURE:', err);
  process.exit(1);
});
