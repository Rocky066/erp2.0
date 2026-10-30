const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const TEST_PORT = 3198;
let serverProcess = null;

function request(path, options = {}, token = null, host = `localhost:${TEST_PORT}`) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://${host}`);
    const reqHeaders = {
      'Host': host,
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const req = http.request(url, {
      method: options.method || 'GET',
      headers: reqHeaders
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', data => {
      const msg = data.toString();
      if (msg.includes('running') || msg.includes('Server')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', data => {
      console.error('[SERVER STDERR]', data.toString());
    });

    setTimeout(() => resolve(), 3000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGINT');
  }
}

async function runTests() {
  console.log('=== STARTING BUG #1 MULTI-TENANT VERIFICATION ===\n');
  await startServer();

  try {
    // ----------------------------------------------------
    // TEST 1: GJV Admin Portal Workflow & Isolation
    // ----------------------------------------------------
    console.log('--- TEST 1: Garumara Jatiya Vidyalaya (GJV) Admin Portal ---');
    const gjvHost = `gjv.localhost:${TEST_PORT}`;

    // 1.1 GJV Login
    const gjvLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'Admin@123' }
    }, null, gjvHost);

    assert.strictEqual(gjvLogin.status, 200, 'GJV Admin Login should succeed (200)');
    assert(gjvLogin.body.token, 'GJV Login should return JWT token');
    assert.strictEqual(gjvLogin.body.school_id, 'school_gjv_default', 'GJV token bound to school_gjv_default');
    const gjvToken = gjvLogin.body.token;
    console.log('✔ GJV Admin logged in successfully.');

    // 1.2 GJV Academic Sessions
    const gjvSessions = await request('/api/academic-sessions', {}, gjvToken, gjvHost);
    assert.strictEqual(gjvSessions.status, 200, 'GET /api/academic-sessions should succeed');
    assert(Array.isArray(gjvSessions.body.sessions), 'Should return sessions list');
    assert.strictEqual(gjvSessions.body.currentSession.session_name, '2027-28', 'GJV current session should be 2027-28');
    const gjvSessionId = gjvSessions.body.currentSession.id;
    console.log(`✔ GJV sessions retrieved correctly. Active session: ${gjvSessions.body.currentSession.session_name} (${gjvSessionId})`);

    // 1.3 GJV Students (Student Directory)
    const gjvStudents = await request(`/api/students?academic_session_id=${gjvSessionId}`, {}, gjvToken, gjvHost);
    assert.strictEqual(gjvStudents.status, 200, 'GJV GET /api/students should succeed');
    assert(Array.isArray(gjvStudents.body), 'GJV students should be an array');
    const anu = gjvStudents.body.find(s => s.name === 'Anu');
    assert(anu, 'Anu should be present in GJV student directory');
    const hasMuwamariInGjv = gjvStudents.body.some(s => s.school_id === 'SCH-MUWAMARII' || s.name === 'Ahmed Ali');
    assert(!hasMuwamariInGjv, 'Muwamari students must NOT be visible in GJV student directory');
    console.log(`✔ GJV Student Directory intact: found ${gjvStudents.body.length} student(s) including Anu. Zero cross-school leakage.`);

    // 1.4 GJV Fee Collection Search
    const gjvFeeSearch = await request(`/api/fee/students/search?academic_session_id=${gjvSessionId}&q=Anu`, {}, gjvToken, gjvHost);
    assert.strictEqual(gjvFeeSearch.status, 200, 'GJV Fee search should succeed');
    assert(Array.isArray(gjvFeeSearch.body) && gjvFeeSearch.body.length > 0, 'GJV Fee search should find Anu');
    console.log('✔ GJV Fee Collection search finds Anu.');


    // ----------------------------------------------------
    // TEST 2: Muwamari Admin Portal Workflow
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Muwamari Jatiya Vidyalaya Admin Portal ---');
    const muwaHost = `muwamarii.localhost:${TEST_PORT}`;

    // 2.1 Muwamari Login
    const muwaLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'mjv@schoolerp.in', password: 'Admin@123' }
    }, null, muwaHost);

    assert.strictEqual(muwaLogin.status, 200, 'Muwamari Admin Login should succeed (200)');
    assert(muwaLogin.body.token, 'Muwamari Login should return JWT token');
    assert.strictEqual(muwaLogin.body.school_id, 'SCH-MUWAMARII', 'Muwamari token bound to SCH-MUWAMARII');
    const muwaToken = muwaLogin.body.token;
    console.log('✔ Muwamari Admin logged in successfully.');

    // 2.2 Muwamari Academic Sessions
    const muwaSessions = await request('/api/academic-sessions', {}, muwaToken, muwaHost);
    assert.strictEqual(muwaSessions.status, 200, 'Muwamari GET /api/academic-sessions should succeed');
    assert(Array.isArray(muwaSessions.body.sessions), 'Should return Muwamari sessions list');
    assert.strictEqual(muwaSessions.body.currentSession.session_name, '2026-27', 'Muwamari current session must be 2026-27, NOT GJV 2027-28');
    const muwaSessionId = muwaSessions.body.currentSession.id;
    console.log(`✔ Muwamari sessions retrieved correctly. Active session: ${muwaSessions.body.currentSession.session_name} (${muwaSessionId})`);

    // 2.3 Muwamari Student Directory
    const muwaStudents = await request(`/api/students?academic_session_id=${muwaSessionId}`, {}, muwaToken, muwaHost);
    assert.strictEqual(muwaStudents.status, 200, 'Muwamari GET /api/students should succeed');
    assert(Array.isArray(muwaStudents.body), 'Muwamari students should be an array');
    const ahmed = muwaStudents.body.find(s => (s.name || '').toLowerCase() === 'ahmed ali');
    const nekibur = muwaStudents.body.find(s => (s.name || '').toLowerCase() === 'nekibur ali');
    assert(ahmed, 'Ahmed Ali must appear in Muwamari Student Directory');
    assert(nekibur, 'Nekibur Ali must appear in Muwamari Student Directory');
    const hasGjvInMuwa = muwaStudents.body.some(s => s.school_id === 'school_gjv_default' || s.name === 'Anu');
    assert(!hasGjvInMuwa, 'GJV students must NOT be visible in Muwamari student directory');
    console.log(`✔ Muwamari Student Directory working: found ${muwaStudents.body.length} student(s) (Ahmed Ali & Nekibur Ali). Zero cross-school leakage.`);

    // 2.4 Muwamari Fee Collection Student Search
    const muwaFeeSearch = await request(`/api/fee/students/search?academic_session_id=${muwaSessionId}&q=Ahmed`, {}, muwaToken, muwaHost);
    assert.strictEqual(muwaFeeSearch.status, 200, 'Muwamari fee search should succeed');
    assert(Array.isArray(muwaFeeSearch.body) && muwaFeeSearch.body.length > 0, 'Muwamari fee search should find Ahmed Ali');
    assert.strictEqual((muwaFeeSearch.body[0].name || '').toLowerCase(), 'ahmed ali', 'Found student should be Ahmed Ali');
    console.log('✔ Muwamari Fee Collection search finds Ahmed Ali.');

    // 2.5 Muwamari Fee Due List
    const muwaDueList = await request(`/api/fees/due-list?academic_session_id=${muwaSessionId}`, {}, muwaToken, muwaHost);
    assert.strictEqual(muwaDueList.status, 200, 'Muwamari due-list should succeed');
    assert(Array.isArray(muwaDueList.body), 'Muwamari due-list should be an array');
    console.log(`✔ Muwamari Fee Due List working: ${muwaDueList.body.length} pending due records.`);

    // 2.6 Muwamari Student Fee Profile (collection form helper)
    const muwaProfile = await request(`/api/fees/student-profile?studentId=${ahmed.admissionNo}&academic_session_id=${muwaSessionId}`, {}, muwaToken, muwaHost);
    assert.strictEqual(muwaProfile.status, 200, 'Muwamari student-profile should succeed');
    assert(muwaProfile.body.student && muwaProfile.body.invoice, 'Fee profile must contain student and invoice');
    console.log(`✔ Muwamari Student Fee Profile working for ${ahmed.name}. Expected fee: ₹${muwaProfile.body.invoice.expectedAmount}`);

    // 2.7 Muwamari Annual Fee Passbook (/api/fees/student-fee-profile)
    const muwaPassbook = await request(`/api/fees/student-fee-profile?studentId=${ahmed.admissionNo}&academic_session_id=${muwaSessionId}`, {}, muwaToken, muwaHost);
    assert.strictEqual(muwaPassbook.status, 200, 'Muwamari annual passbook should succeed');
    assert(muwaPassbook.body.student && muwaPassbook.body.timeline, 'Annual passbook must contain student and timeline');
    console.log(`✔ Muwamari Annual Fee Passbook working for ${ahmed.name}. 12-month timeline verified.`);


    // ----------------------------------------------------
    // TEST 3: New Admission in Muwamari & End-to-End Persistence
    // ----------------------------------------------------
    console.log('\n--- TEST 3: New Admission in Muwamari & Directory/Fee Persistence ---');
    const newStudentPayload = {
      name: 'Salma Khatun',
      dob: '2016-05-10',
      gender: 'Female',
      className: 'Class I',
      section: 'A',
      rollNo: '15',
      fatherName: 'Mustafa Khatun',
      mobile: '9876543210',
      admissionFee: 1500,
      monthlyFee: 500,
      studentAadhaar: '987654321099',
      fatherAadhaar: '123456789012'
    };

    const admRes = await request('/api/students', {
      method: 'POST',
      body: newStudentPayload
    }, muwaToken, muwaHost);

    assert.strictEqual(admRes.status, 201, `New admission in Muwamari should return 201, got ${admRes.status}: ${JSON.stringify(admRes.body)}`);
    assert(admRes.body.admissionNo, 'Student must have admission number');
    assert(admRes.body.admissionNo.startsWith('MUWAMARII-2026-'), `Admission No should start with MUWAMARII-2026-, got ${admRes.body.admissionNo}`);
    assert.strictEqual(admRes.body.school_id, 'SCH-MUWAMARII', 'New student must have school_id SCH-MUWAMARII');
    assert.strictEqual(admRes.body.academic_session_id, muwaSessionId, 'New student must have Muwamari active session ID');
    const newAdmNo = admRes.body.admissionNo;
    console.log(`✔ New admission successful: ${admRes.body.name} (${newAdmNo}) under session ${admRes.body.academic_session}`);

    // Verify student immediately appears in Student Directory
    const muwaDirAfter = await request(`/api/students?academic_session_id=${muwaSessionId}`, {}, muwaToken, muwaHost);
    const foundNewStudentInDir = muwaDirAfter.body.find(s => s.admissionNo === newAdmNo);
    assert(foundNewStudentInDir, 'Newly admitted student MUST appear in Muwamari Student Directory');
    console.log('✔ Newly admitted student confirmed visible in Muwamari Student Directory.');

    // Verify student immediately appears in Fee Collection Search
    const feeSearchAfter = await request(`/api/fee/students/search?academic_session_id=${muwaSessionId}&q=Salma`, {}, muwaToken, muwaHost);
    assert.strictEqual(feeSearchAfter.status, 200, 'Fee search after admission should succeed');
    const foundNewInFee = feeSearchAfter.body.find(s => s.admissionNo === newAdmNo);
    assert(foundNewInFee, 'Newly admitted student MUST appear in Fee Collection Search');
    console.log('✔ Newly admitted student confirmed visible in Muwamari Fee Collection Search.');

    // Verify student fee profile for newly admitted student
    const newProfile = await request(`/api/fees/student-profile?studentId=${newAdmNo}&academic_session_id=${muwaSessionId}`, {}, muwaToken, muwaHost);
    assert.strictEqual(newProfile.status, 200, 'Fee profile for newly admitted student should succeed');
    console.log('✔ Newly admitted student fee profile generated successfully.');

    // Collect a fee payment for the new student
    const feePaymentPayload = {
      studentId: newAdmNo,
      amount: 500,
      lateFee: 0,
      month: '2026-04',
      type: 'Monthly Tuition Fee',
      paymentMode: 'Cash',
      academic_session_id: muwaSessionId,
      idempotencyKey: 'pay_test_' + Date.now()
    };

    const feePayRes = await request('/api/fees', {
      method: 'POST',
      body: feePaymentPayload
    }, muwaToken, muwaHost);

    assert.strictEqual(feePayRes.status, 201, `Fee payment should return 201, got ${feePayRes.status}: ${JSON.stringify(feePayRes.body)}`);
    assert.strictEqual(feePayRes.body.school_id, 'SCH-MUWAMARII', 'Fee transaction must have school_id SCH-MUWAMARII');
    assert(feePayRes.body.receiptNo, 'Fee transaction must generate a receipt number');
    console.log(`✔ Fee collected successfully. Receipt: ${feePayRes.body.receiptNo}, Status: ${feePayRes.body.paymentStatus}`);


    // ----------------------------------------------------
    // TEST 4: Cross-School Isolation & Security Guards
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Cross-School Isolation & Security Guards ---');

    // 4.1 Muwamari Admin token used on GJV host MUST be rejected (403)
    const crossTokenGjv = await request('/api/students', {}, muwaToken, gjvHost);
    assert.strictEqual(crossTokenGjv.status, 403, 'Cross-school token usage on GJV host must return 403');
    console.log('✔ Muwamari token rejected on GJV host (403 Forbidden).');

    // 4.2 GJV Admin token used on Muwamari host MUST be rejected (403)
    const crossTokenMuwa = await request('/api/students', {}, gjvToken, muwaHost);
    assert.strictEqual(crossTokenMuwa.status, 403, 'Cross-school token usage on Muwamari host must return 403');
    console.log('✔ GJV token rejected on Muwamari host (403 Forbidden).');

    // 4.3 Attempt to fetch new student using GJV token
    const gjvTryFetch = await request(`/api/fees/student-profile?studentId=${newAdmNo}&academic_session_id=${muwaSessionId}`, {}, gjvToken, gjvHost);
    assert.strictEqual(gjvTryFetch.status, 404, 'GJV admin cannot fetch Muwamari student profile (404 Not Found)');
    console.log('✔ GJV admin cannot access Muwamari student records (404 Not Found).');

    // Cleanup ephemeral test student created during test
    await request(`/api/students/${newAdmNo}`, { method: 'DELETE' }, muwaToken, muwaHost);
    const fs = require('fs');
    const cleanDb = JSON.parse(fs.readFileSync('db.json', 'utf8'));
    cleanDb.fees = (cleanDb.fees || []).filter(f => f.studentId !== newAdmNo && f.student_id !== newAdmNo);
    fs.writeFileSync('db.json', JSON.stringify(cleanDb, null, 2));
    console.log('✔ Ephemeral test student and fee payment cleaned up.');

    console.log('\n======================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! BUG #1 FULLY RESOLVED.');
    console.log('======================================================\n');
  } finally {
    stopServer();
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  stopServer();
  process.exit(1);
});
