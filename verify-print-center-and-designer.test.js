const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3205;
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

async function runTests() {
  console.log('=== STARTING PRINT CENTER MANAGEMENT & ID CARD DESIGNER TEST SUITE ===');

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
      if (msg.includes('running at')) console.log(`Server started on port ${TEST_PORT}`);
    });

    await new Promise(r => setTimeout(r, 2200));

    // -------------------------------------------------------------
    // TEST 1: Super Admin Login & Print Center Schools Overview
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing Super Admin Print Center Overview ---');
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

    const pcSchools = await request({
      path: '/api/superadmin/print-center/schools',
      method: 'GET',
      headers: saHeaders
    });
    assert(pcSchools.status === 200 && Array.isArray(pcSchools.body.schools), 'Retrieved Print Center schools overview');
    assert(pcSchools.body.schools.length >= 1, `Found ${pcSchools.body.schools.length} schools in Print Center`);
    const defaultSchool = pcSchools.body.schools.find(s => s.id === 'school_gjv_default');
    assert(defaultSchool && defaultSchool.printCenter?.username, 'Default school GJV has configured operator account');


    // -------------------------------------------------------------
    // TEST 2: Create / Configure Operator Account for School B
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing Operator Account Creation & Hashing Security ---');
    let schoolB = pcSchools.body.schools.find(s => s.id !== 'school_gjv_default');
    if (!schoolB) {
      const newSchoolRes = await request({
        path: '/api/superadmin/schools',
        method: 'POST',
        headers: saHeaders
      }, {
        name: 'DPS Siliguri Campus',
        schoolCode: 'dps-slg',
        subdomain: 'dps-slg',
        adminEmail: 'admin@dpssiliguri.edu.in',
        adminPassword: 'Password@123',
        status: 'Active'
      });
      assert(newSchoolRes.status === 201, 'Created School B instance');
      schoolB = newSchoolRes.body.school;
    }

    const testOperatorUser = `print_op_${Date.now()}`;
    const testOperatorPass = 'PrintMaster@2026Secure!';
    const createAccRes = await request({
      path: '/api/superadmin/print-center/accounts',
      method: 'POST',
      headers: saHeaders
    }, {
      school_id: schoolB.id,
      username: testOperatorUser,
      password: testOperatorPass,
      contact_person: 'Subrata Roy',
      contact_phone: '+91 9832011223'
    });
    assert(createAccRes.status === 200 && createAccRes.body.account, `Created Print Center account for ${schoolB.name}`);
    assert(!createAccRes.body.account.password && !createAccRes.body.account.password_hash, 'Account response never leaks password or hash');

    // DB inspection
    const currentDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const savedAcc = (currentDb.printCenterAccounts || []).find(a => a.school_id === schoolB.id);
    assert(savedAcc && savedAcc.password_salt && savedAcc.password_hash, 'Account securely stored with PBKDF2 salt & hash in DB');
    assert(!savedAcc.password, 'Account does NOT store plaintext password anywhere');

    // -------------------------------------------------------------
    // TEST 3: Print Operator Login & Tenant Context
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing Operator Login & Multi-tenant Token Scope ---');
    const opLoginRes = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: testOperatorUser,
      password: testOperatorPass
    });
    assert(opLoginRes.status === 200 && opLoginRes.body.token, 'Print Operator logged in successfully');
    assert(opLoginRes.body.role === 'PrintOperator', 'Operator role is PrintOperator');
    assert(opLoginRes.body.school_id === schoolB.id, `Session token strictly bound to School B (${schoolB.id})`);

    const opToken = opLoginRes.body.token;
    const opHeaders = { 'Authorization': `Bearer ${opToken}` };

    const sessionRes = await request({
      path: '/api/print-center/session',
      method: 'GET',
      headers: opHeaders
    });
    assert(sessionRes.status === 200 && sessionRes.body.username === testOperatorUser, 'Operator session verified');

    // -------------------------------------------------------------
    // TEST 4: Security Role Guard Boundaries
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing Route Guard Boundaries ---');
    const feeAttempt = await request({
      path: '/api/fees',
      method: 'GET',
      headers: opHeaders
    });
    assert(feeAttempt.status === 403, 'Print Operator cannot access /api/fees (403 Forbidden)');

    const teacherAttempt = await request({
      path: '/api/teachers',
      method: 'GET',
      headers: opHeaders
    });
    assert(teacherAttempt.status === 403, 'Print Operator cannot access /api/teachers (403 Forbidden)');

    const saAttempt = await request({
      path: '/api/superadmin/schools',
      method: 'GET',
      headers: opHeaders
    });
    assert(saAttempt.status === 401 || saAttempt.status === 403, 'Print Operator cannot access /api/superadmin/*');

    // -------------------------------------------------------------
    // TEST 5: Password Reset Workflows & Session Invalidation
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Password Reset & Immediate Session Invalidation ---');
    const newPass = 'UpdatedPrintPass@2026!';
    const directReset = await request({
      path: `/api/superadmin/print-center/${schoolB.id}/reset-password`,
      method: 'POST',
      headers: saHeaders
    }, {
      new_password: newPass
    });
    assert(directReset.status === 200, 'Super Admin performed direct password reset');

    // Stale session must be rejected (token_version incremented)
    const staleSession = await request({
      path: '/api/print-center/session',
      method: 'GET',
      headers: opHeaders
    });
    assert(staleSession.status === 401 || staleSession.status === 403, 'Old operator session was immediately invalidated');

    // Login with new password
    const newLogin = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: testOperatorUser,
      password: newPass
    });
    assert(newLogin.status === 200, 'New password authenticated successfully');

    // Setup Link Workflow
    const linkRes = await request({
      path: `/api/superadmin/print-center/${schoolB.id}/generate-reset-link`,
      method: 'POST',
      headers: saHeaders
    });
    assert(linkRes.status === 200 && linkRes.body.token && linkRes.body.resetUrl, 'Generated 24h reset setup link');

    const publicResetRes = await request({
      path: '/api/print-center/reset-password',
      method: 'POST'
    }, {
      token: linkRes.body.token,
      new_password: 'FinalPrintPass@2026#'
    });
    assert(publicResetRes.status === 200, 'Completed public token-based password reset');

    // -------------------------------------------------------------
    // TEST 6: Account Deactivation / Suspension
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing Account Suspension & Access Denial ---');
    const suspendRes = await request({
      path: `/api/superadmin/print-center/${schoolB.id}/status`,
      method: 'PUT',
      headers: saHeaders
    }, {
      status: 'Disabled',
      access_enabled: false
    });
    assert(suspendRes.status === 200, 'Disabled Print Center account');

    const disabledLogin = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: testOperatorUser,
      password: 'FinalPrintPass@2026#'
    });
    assert(disabledLogin.status === 403, 'Disabled Print Center account is blocked from login (403 Forbidden)');

    // Re-enable
    await request({
      path: `/api/superadmin/print-center/${schoolB.id}/status`,
      method: 'PUT',
      headers: saHeaders
    }, {
      status: 'Active',
      access_enabled: true
    });

    const activeLogin = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: testOperatorUser,
      password: 'FinalPrintPass@2026#'
    });
    assert(activeLogin.status === 200, 'Re-enabled account logs in');
    const activeOpToken = activeLogin.body.token;
    const activeOpHeaders = { 'Authorization': `Bearer ${activeOpToken}` };

    // -------------------------------------------------------------
    // TEST 7: ID Card Design Editor & Strict Multi-Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- 7. Testing ID Card Design Customization & School Isolation ---');
    const bDesignRes = await request({
      path: '/api/print-center/id-card-design',
      method: 'GET',
      headers: activeOpHeaders
    });
    assert(bDesignRes.status === 200 && bDesignRes.body.design, 'School B loaded its ID card design');

    // Customize School B Design (Landscape, emerald colors, custom fields)
    const customBDesign = {
      ...bDesignRes.body.design,
      cardSize: {
        preset: 'CR80_LANDSCAPE',
        widthMm: 85.60,
        heightMm: 53.98,
        orientation: 'landscape',
        safeMarginMm: 3.5
      },
      branding: {
        ...bDesignRes.body.design.branding,
        schoolName: 'Delhi Public School Siliguri',
        schoolNameFontSize: 34,
        schoolNameFontWeight: '800',
        schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD',
        cardHeadingFontSize: 14,
        cardHeadingColor: '#fbbf24',
        headerBgColor: '#064e3b',
        headerBgColorEnd: '#022c22',
        cardBgColor: '#f8fafc',
        accentColor: '#10b981',
        textColor: '#064e3b',
        fontFamily: 'Montserrat, sans-serif'
      },
      studentFields: {
        ...bDesignRes.body.design.studentFields,
        photoWidth: 180,
        photoHeight: 220,
        nameFontSize: 30,
        nameColor: '#022c22',
        fields: {
          ...bDesignRes.body.design.studentFields.fields,
          bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' },
          emergencyContact: { enabled: true, label: 'Parent Phone', icon: 'EMG' }
        }
      }
    };

    const saveBRes = await request({
      path: '/api/print-center/id-card-design',
      method: 'PUT',
      headers: activeOpHeaders
    }, { design: customBDesign });
    assert(saveBRes.status === 200, 'School B saved custom landscape design');

    // Save Preset for School B
    const presetRes = await request({
      path: '/api/print-center/id-card-design/presets',
      method: 'POST',
      headers: activeOpHeaders
    }, {
      name: 'Emerald Landscape Standard',
      design: customBDesign
    });
    assert((presetRes.status === 200 || presetRes.status === 201) && presetRes.body.presets.length >= 1, 'School B saved design preset');

    // GJV operator check: GJV design MUST NOT be affected!
    await request({
      path: '/api/superadmin/print-center/school_gjv_default/reset-password',
      method: 'POST',
      headers: saHeaders
    }, {
      new_password: 'GjvPrintPass@2026!'
    });

    const gjvLogin = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: 'print65121315@admin.com',
      password: 'GjvPrintPass@2026!'
    });
    assert(gjvLogin.status === 200, 'GJV Print Operator logged in');
    const gjvToken = gjvLogin.body.token;
    const gjvHeaders = { 'Authorization': `Bearer ${gjvToken}` };

    const gjvDesignRes = await request({
      path: '/api/print-center/id-card-design',
      method: 'GET',
      headers: gjvHeaders
    });
    assert(gjvDesignRes.status === 200, 'GJV loaded its ID card design');
    assert(gjvDesignRes.body.design.branding.schoolName !== 'Delhi Public School Siliguri', 'GJV branding remains isolated and untouched');
    assert(gjvDesignRes.body.design.cardSize.orientation === 'portrait', 'GJV portrait orientation is preserved');

    // Check student data isolation
    assert(Array.isArray(bDesignRes.body.sampleStudents), 'School B authorized students returned');
    assert(Array.isArray(gjvDesignRes.body.sampleStudents), 'GJV authorized students returned');
    const gjvNos = gjvDesignRes.body.sampleStudents.map(s => s.admissionNo);
    const bNos = bDesignRes.body.sampleStudents.map(s => s.admissionNo);
    const overlap = gjvNos.filter(n => bNos.includes(n));
    assert(overlap.length === 0, 'Zero student overlap between schools (Strict tenant student isolation verified)');

    // -------------------------------------------------------------
    // TEST 8: Design Reset with Confirmation
    // -------------------------------------------------------------
    console.log('\n--- 8. Testing ID Card Design Reset ---');
    const resetRes = await request({
      path: '/api/print-center/id-card-design/reset',
      method: 'POST',
      headers: activeOpHeaders
    });
    assert(resetRes.status === 200 && resetRes.body.design, 'School B reset ID card design to default');
    assert(resetRes.body.design.cardSize.orientation === 'portrait', 'Design restored to portrait default');

    // -------------------------------------------------------------
    // TEST 9: Audit Trail Logging
    // -------------------------------------------------------------
    console.log('\n--- 9. Testing Audit Trail Logging ---');
    const auditRes = await request({
      path: '/api/superadmin/print-center/audit-logs',
      method: 'GET',
      headers: saHeaders
    });
    assert(auditRes.status === 200 && Array.isArray(auditRes.body.logs), 'Retrieved audit logs');
    assert(auditRes.body.logs.length >= 4, `Recorded ${auditRes.body.logs.length} audit trail events`);
    const actions = auditRes.body.logs.map(l => l.action);
    assert(actions.includes('STATUS_CHANGED') || actions.includes('ACCOUNT_UPDATED') || actions.includes('ACCOUNT_CREATED') || actions.includes('DESIGN_SAVED'), 'Audit log includes status change, design save, or account update');

    console.log('\n🎉 ALL 9 PRINT CENTER & DESIGNER TEST SUITES PASSED 100%!');
  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));
    }
    fs.writeFileSync(DB_PATH, dbBackup, 'utf8');
    console.log('🧹 Cleaned up test server and restored db.json.');
  }
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
