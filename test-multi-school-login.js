const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TEST_PORT = 3208;
const DB_PATH = path.join(__dirname, 'db.json');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`✔ PASS: ${message}`);
}

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const mergedHeaders = { ...defaultHeaders, ...(options.headers || {}) };
    let payload = null;
    if (postData) {
      payload = typeof postData === 'string' ? postData : JSON.stringify(postData);
      mergedHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const reqOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      ...options,
      headers: mergedHeaders
    };
    const req = http.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runMultiSchoolLoginTests() {
  console.log('=== MULTI-SCHOOL PRINT CENTER LOGIN VERIFICATION SUITE ===\n');

  const dbBackup = fs.readFileSync(DB_PATH, 'utf8');
  let serverProcess = null;

  try {
    console.log(`Starting server on port ${TEST_PORT}...`);
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', d => {
      const msg = d.toString();
      if (msg.includes('running at')) console.log(`Server running at port ${TEST_PORT}`);
    });

    await new Promise(r => setTimeout(r, 2000));

    // Setup accounts in DB for testing
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const gjvSchool = db.schools.find(s => s.id === 'school_gjv_default');
    const muwSchool = db.schools.find(s => s.id === 'SCH-MUWAMARII');
    const dpsSchool = db.schools.find(s => s.id === 'SCH-DPS');

    assert(gjvSchool && muwSchool && dpsSchool, 'Three test schools exist in database');

    // 1. Super Admin Login & Setup passwords
    console.log('\n--- 1. Authenticating Super Admin & Setting Passwords ---');
    const saLogin = await request({
      path: '/api/superadmin/login',
      method: 'POST'
    }, {
      username: 'superadmin@schoolerp.in',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026'
    });
    assert(saLogin.status === 200 && saLogin.body.token, 'Super Admin logged in successfully');
    const saToken = saLogin.body.token;
    const saHeaders = { 'Authorization': `Bearer ${saToken}` };

    // Reset passwords via Super Admin API to known values
    const GJV_PASSWORD = 'GjvPrintPassword@2026!';
    const MUW_PASSWORD = 'MuwPrintPassword@2026!';
    const DPS_PASSWORD = 'DpsPrintPassword@2026!';

    await request({
      path: `/api/superadmin/print-center/${gjvSchool.id}/reset-password`,
      method: 'POST',
      headers: saHeaders
    }, { new_password: GJV_PASSWORD });

    await request({
      path: `/api/superadmin/print-center/${muwSchool.id}/reset-password`,
      method: 'POST',
      headers: saHeaders
    }, { new_password: MUW_PASSWORD });

    await request({
      path: `/api/superadmin/print-center/${dpsSchool.id}/reset-password`,
      method: 'POST',
      headers: saHeaders
    }, { new_password: DPS_PASSWORD });

    console.log('✔ PASS: Reset passwords configured for GJV, Muwamari, and DPS');

    // Re-read accounts
    const dbUpdated = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const gjvAcc = dbUpdated.printCenterAccounts.find(a => a.school_id === gjvSchool.id);
    const muwAcc = dbUpdated.printCenterAccounts.find(a => a.school_id === muwSchool.id);
    const dpsAcc = dbUpdated.printCenterAccounts.find(a => a.school_id === dpsSchool.id);

    // -------------------------------------------------------------
    // TEST 1: Garumara Print Center login still works
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Garumara Print Center login still works ---');
    const gjvLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'gjv.localhost:3208' }
    }, {
      username: gjvAcc.username,
      password: GJV_PASSWORD
    });
    assert(gjvLogin.status === 200, `Garumara login returned status 200 (got ${gjvLogin.status})`);
    assert(gjvLogin.body.token, 'Garumara login returned JWT token');
    assert(gjvLogin.body.school_id === gjvSchool.id, 'Garumara token bound to Garumara school ID');
    assert(gjvLogin.body.role === 'PrintOperator', 'Garumara role is PrintOperator');
    assert(gjvLogin.headers['set-cookie']?.some(c => c.includes('gjv_print_session')), 'Garumara login set HTTP-only cookie');

    // -------------------------------------------------------------
    // TEST 2: Second school (Muwamari) active Print Center account can log in
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Second school (Muwamari) active Print Center account can log in ---');
    const muwLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'muwamarii.localhost:3208' }
    }, {
      username: muwAcc.username,
      password: MUW_PASSWORD
    });
    assert(muwLogin.status === 200, `Muwamari login returned status 200 (got ${muwLogin.status})`);
    assert(muwLogin.body.token, 'Muwamari login returned JWT token');
    assert(muwLogin.body.school_id === muwSchool.id, 'Muwamari token bound to Muwamari school ID');
    assert(muwLogin.body.school_name === muwSchool.name, `Muwamari school name matches (${muwLogin.body.school_name})`);

    // Also test login by school-scoped alias (e.g. 'print')
    const muwAliasLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'muwamarii.localhost:3208' }
    }, {
      username: 'print',
      password: MUW_PASSWORD
    });
    assert(muwAliasLogin.status === 200, 'Muwamari logged in via school-scoped alias username "print"');
    assert(muwAliasLogin.body.school_id === muwSchool.id, 'Muwamari alias token bound to Muwamari');

    // Also test third school (DPS)
    console.log('\n--- Third school (DPS) active Print Center account can log in ---');
    const dpsLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'dps.localhost:3208' }
    }, {
      username: dpsAcc.username,
      password: DPS_PASSWORD
    });
    assert(dpsLogin.status === 200, `DPS login returned status 200 (got ${dpsLogin.status})`);
    assert(dpsLogin.body.school_id === dpsSchool.id, 'DPS token bound to DPS school ID');

    // -------------------------------------------------------------
    // TEST 3: Each account opens the correct school's Print Center
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Each account opens the correct school\'s Print Center ---');
    const gjvSession = await request({
      path: '/api/print-center/session',
      method: 'GET',
      headers: {
        'Host': 'gjv.localhost:3208',
        'Authorization': `Bearer ${gjvLogin.body.token}`
      }
    });
    assert(gjvSession.status === 200, 'Garumara session endpoint returned 200');
    assert(gjvSession.body.school_id === gjvSchool.id, 'Garumara session contains Garumara school_id');
    assert(gjvSession.body.school_name === gjvSchool.name, 'Garumara session contains Garumara school_name');

    const muwSession = await request({
      path: '/api/print-center/session',
      method: 'GET',
      headers: {
        'Host': 'muwamarii.localhost:3208',
        'Authorization': `Bearer ${muwLogin.body.token}`
      }
    });
    assert(muwSession.status === 200, 'Muwamari session endpoint returned 200');
    assert(muwSession.body.school_id === muwSchool.id, 'Muwamari session contains Muwamari school_id');
    assert(muwSession.body.school_name === muwSchool.name, 'Muwamari session contains Muwamari school_name');

    // -------------------------------------------------------------
    // TEST 4: Invalid passwords are rejected
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Invalid passwords are rejected ---');
    const invalidPassLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'muwamarii.localhost:3208' }
    }, {
      username: muwAcc.username,
      password: 'TotallyWrongPassword999!'
    });
    assert(invalidPassLogin.status === 401, `Invalid password rejected with 401 (got ${invalidPassLogin.status})`);
    assert(!invalidPassLogin.body.token, 'No token returned for invalid password');

    const nonExistentUser = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: 'nonexistent.user@random.com',
      password: 'SomePassword@123'
    });
    assert(nonExistentUser.status === 401, `Non-existent user rejected with 401 (got ${nonExistentUser.status})`);

    // -------------------------------------------------------------
    // TEST 5: Disabled or unauthorized accounts cannot log in
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Disabled or unauthorized accounts cannot log in ---');
    // Disable Muwamari Print Center account
    await request({
      path: `/api/superadmin/print-center/${muwSchool.id}/status`,
      method: 'PUT',
      headers: saHeaders
    }, {
      status: 'Disabled',
      access_enabled: false
    });

    const disabledLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'muwamarii.localhost:3208' }
    }, {
      username: muwAcc.username,
      password: MUW_PASSWORD
    });
    assert(disabledLogin.status === 403, `Disabled account rejected with 403 (got ${disabledLogin.status})`);
    assert(disabledLogin.body.error.includes('disabled'), 'Disabled error message returned');

    // Re-enable
    await request({
      path: `/api/superadmin/print-center/${muwSchool.id}/status`,
      method: 'PUT',
      headers: saHeaders
    }, {
      status: 'Active',
      access_enabled: true
    });

    // Re-authenticate to get active token after re-enable
    const muwReLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'muwamarii.localhost:3208' }
    }, {
      username: muwAcc.username,
      password: MUW_PASSWORD
    });
    assert(muwReLogin.status === 200, 'Re-enabled Muwamari account logged in');
    const muwActiveToken = muwReLogin.body.token;

    // Cross-school login prevention: try logging into Garumara host using Muwamari account
    const crossSchoolLogin = await request({
      path: '/api/print-center/login',
      method: 'POST',
      headers: { 'Host': 'gjv.localhost:3208' }
    }, {
      username: muwAcc.username,
      password: MUW_PASSWORD
    });
    assert(crossSchoolLogin.status === 403, `Cross-school subdomain login rejected with 403 (got ${crossSchoolLogin.status})`);

    // -------------------------------------------------------------
    // TEST 6: One school cannot access another school's students, ID cards, or design settings
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Cross-school isolation (students, ID cards, design settings) ---');
    // 6a: Muwamari operator querying students on Muwamari host
    const muwStudents = await request({
      path: '/api/students',
      method: 'GET',
      headers: {
        'Host': 'muwamarii.localhost:3208',
        'Authorization': `Bearer ${muwActiveToken}`
      }
    });
    assert(muwStudents.status === 200, 'Muwamari operator can read students');
    assert(Array.isArray(muwStudents.body), 'Muwamari students is array');
    const muwStudentIds = muwStudents.body.map(s => s.admissionNo || s.id);

    // 6b: Garumara operator querying students on Garumara host
    const gjvStudents = await request({
      path: '/api/students',
      method: 'GET',
      headers: {
        'Host': 'gjv.localhost:3208',
        'Authorization': `Bearer ${gjvLogin.body.token}`
      }
    });
    assert(gjvStudents.status === 200, 'Garumara operator can read students');
    const gjvStudentIds = gjvStudents.body.map(s => s.admissionNo || s.id);

    // Strict intersection test: zero overlap
    const overlap = muwStudentIds.filter(id => gjvStudentIds.includes(id));
    assert(overlap.length === 0, `Zero student overlap between schools (overlap count: ${overlap.length})`);

    // 6c: Muwamari operator trying to send token to Garumara host -> 403 Cross-school token usage is forbidden
    const crossTokenAttempt = await request({
      path: '/api/students',
      method: 'GET',
      headers: {
        'Host': 'gjv.localhost:3208',
        'Authorization': `Bearer ${muwActiveToken}`
      }
    });
    assert(crossTokenAttempt.status === 403, `Cross-school token usage blocked with 403 (got ${crossTokenAttempt.status})`);
    assert(crossTokenAttempt.body.error.includes('Cross-school token usage is forbidden'), 'Error message confirms cross-school rejection');

    // 6d: ID Card design isolation
    const muwDesign = await request({
      path: '/api/print-center/id-card-design',
      method: 'GET',
      headers: {
        'Host': 'muwamarii.localhost:3208',
        'Authorization': `Bearer ${muwActiveToken}`
      }
    });
    assert(muwDesign.status === 200, 'Muwamari loaded its ID card design');
    assert(muwDesign.body.design.branding.schoolName.includes('Muwamari'), `Muwamari design contains its own school name (got ${muwDesign.body.design.branding.schoolName})`);

    const gjvDesign = await request({
      path: '/api/print-center/id-card-design',
      method: 'GET',
      headers: {
        'Host': 'gjv.localhost:3208',
        'Authorization': `Bearer ${gjvLogin.body.token}`
      }
    });
    assert(gjvDesign.status === 200, 'Garumara loaded its ID card design');
    assert(gjvDesign.body.design.branding.schoolName.includes('Garumara'), `Garumara design contains its own school name (got ${gjvDesign.body.design.branding.schoolName})`);

    // -------------------------------------------------------------
    // TEST 7: Logout and session revocation
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Logout and session revocation ---');
    // Logout via POST /api/print-center/logout
    const logoutRes = await request({
      path: '/api/print-center/logout',
      method: 'POST',
      headers: {
        'Host': 'muwamarii.localhost:3208',
        'Authorization': `Bearer ${muwActiveToken}`
      }
    });
    assert(logoutRes.status === 200, 'Logout succeeded with 200');
    assert(logoutRes.headers['set-cookie']?.some(c => c.includes('gjv_print_session=;')), 'Logout cleared cookie header');

    // Super Admin password reset revokes all existing sessions
    await request({
      path: `/api/superadmin/print-center/${muwSchool.id}/reset-password`,
      method: 'POST',
      headers: saHeaders
    }, { new_password: 'BrandNewMuwPassword@2026!' });

    const revokedAttempt = await request({
      path: '/api/print-center/session',
      method: 'GET',
      headers: {
        'Host': 'muwamarii.localhost:3208',
        'Authorization': `Bearer ${muwActiveToken}`
      }
    });
    assert(revokedAttempt.status === 401 || revokedAttempt.status === 403, `Old session revoked after password reset (status ${revokedAttempt.status})`);

    // -------------------------------------------------------------
    // TEST 8: Existing Super Admin and School Admin access remains unchanged
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Existing Super Admin and School Admin access remains unchanged ---');
    // Super admin can still access schools overview
    const saCheck = await request({
      path: '/api/superadmin/schools',
      method: 'GET',
      headers: saHeaders
    });
    assert(saCheck.status === 200 && Array.isArray(saCheck.body), 'Super Admin can list schools');

    // Set known admin password for GJV school admin
    const GJV_ADMIN_PASS = 'GjvAdmin@2026!';
    await request({
      path: `/api/superadmin/schools/${gjvSchool.id}/reset-admin-password`,
      method: 'POST',
      headers: saHeaders
    }, { newPassword: GJV_ADMIN_PASS });

    // School admin can login to Garumara Admin portal
    const adminLogin = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Host': 'gjv.localhost:3208' }
    }, {
      username: 'admin',
      password: GJV_ADMIN_PASS
    });
    assert(adminLogin.status === 200 && adminLogin.body.token, 'Garumara School Admin logged in successfully');
    assert(adminLogin.body.role === 'Admin', 'School Admin role is Admin');

    // Verify Print Center operator cannot access School Admin routes
    const forbiddenForPrint = await request({
      path: '/api/teachers',
      method: 'GET',
      headers: {
        'Host': 'gjv.localhost:3208',
        'Authorization': `Bearer ${gjvLogin.body.token}`
      }
    });
    assert(forbiddenForPrint.status === 403, 'Print Center user cannot access School Admin routes (/api/teachers)');

    console.log('\n🎉 ALL 8 MULTI-SCHOOL PRINT CENTER VERIFICATION TESTS PASSED 100%!');

  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
    fs.writeFileSync(DB_PATH, dbBackup, 'utf8');
    console.log('🧹 Cleaned up test server and restored db.json.');
  }
}

runMultiSchoolLoginTests().catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
