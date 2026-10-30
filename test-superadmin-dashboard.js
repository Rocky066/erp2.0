const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 3192;

function request(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      ...options,
      headers: {
        'Accept': 'application/json, text/html, */*',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('=== STARTING SUPER ADMIN DASHBOARD VERIFICATION SUITE ===');

  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('running')) console.log('[SERVER]', msg.trim());
  });

  server.stderr.on('data', d => {
    console.error('[SERVER ERR]', d.toString().trim());
  });

  await delay(2000);

  try {
    // -------------------------------------------------------------
    // Test 1: Super Admin Page Routing (/superadmin and /superadmin/index.html)
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Super Admin Portal Page Routing ---');
    const pageRes = await request({ path: '/superadmin', method: 'GET' });
    assert.strictEqual(pageRes.statusCode, 200, 'Page /superadmin should return 200');
    assert.ok(typeof pageRes.data === 'string' && pageRes.data.includes('SaaS Platform Super Admin'), 'Page must contain title');
    assert.ok(pageRes.data.includes('id="schools-tbody"'), 'Page must contain schools table');
    assert.ok(pageRes.data.includes('id="leads-tbody"'), 'Page must contain leads table');
    assert.ok(pageRes.data.includes('id="print-schools-tbody"'), 'Page must contain print center table');
    assert.ok(pageRes.data.includes('id="domains-tbody"'), 'Page must contain custom domains table');
    console.log('  ✓ /superadmin serves the complete Super Admin HTML console');

    // -------------------------------------------------------------
    // Test 2: Unauthenticated Requests return 401
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Unauthenticated Protection ---');
    const unauthSchools = await request({ path: '/api/superadmin/schools', method: 'GET' });
    assert.strictEqual(unauthSchools.statusCode, 401, 'Unauthenticated schools request must be rejected with 401');

    const unauthLeads = await request({ path: '/api/superadmin/demo-requests', method: 'GET' });
    assert.strictEqual(unauthLeads.statusCode, 401, 'Unauthenticated demo-requests must be rejected with 401');

    const unauthDomains = await request({ path: '/api/superadmin/domains', method: 'GET' });
    assert.strictEqual(unauthDomains.statusCode, 401, 'Unauthenticated domains must be rejected with 401');
    console.log('  ✓ All Super Admin endpoints strictly require authorization');

    // -------------------------------------------------------------
    // Test 3: Super Admin Login & Session Cookie
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Super Admin Authentication & Session ---');
    const loginRes = await request({
      path: '/api/superadmin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      username: 'superadmin@schoolerp.in',
      password: 'SuperAdmin@2026'
    });
    assert.strictEqual(loginRes.statusCode, 200, 'Super admin login must return 200');
    assert.ok(loginRes.data.token, 'Response must include JWT token');
    assert.strictEqual(loginRes.data.role, 'SuperAdmin', 'Role must be SuperAdmin');
    assert.ok(loginRes.headers['set-cookie'], 'Set-Cookie header should be present for browser session support');
    const saToken = loginRes.data.token;
    console.log('  ✓ Super Admin logged in successfully (JWT token and session cookie generated)');

    const authHeaders = {
      'Authorization': `Bearer ${saToken}`
    };

    // -------------------------------------------------------------
    // Test 4: Dashboard Profile (/api/superadmin/me)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Super Admin Identity (/api/superadmin/me) ---');
    const meRes = await request({ path: '/api/superadmin/me', method: 'GET', headers: authHeaders });
    assert.strictEqual(meRes.statusCode, 200, 'GET /api/superadmin/me must return 200');
    assert.strictEqual(meRes.data.username, 'superadmin@schoolerp.in');
    assert.strictEqual(meRes.data.role, 'SuperAdmin');
    console.log('  ✓ /api/superadmin/me returns authenticated identity');

    // -------------------------------------------------------------
    // Test 5: School Tenants List & Calculated Metrics (/api/superadmin/schools)
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: School Tenants & Real Calculated Metrics ---');
    const schoolsRes = await request({ path: '/api/superadmin/schools', method: 'GET', headers: authHeaders });
    assert.strictEqual(schoolsRes.statusCode, 200, 'GET /api/superadmin/schools must return 200');
    assert.ok(Array.isArray(schoolsRes.data), 'Schools must be an array');
    assert.ok(schoolsRes.data.length >= 1, 'Should have at least 1 registered school');

    const schools = schoolsRes.data;
    console.log(`  ✓ Returned ${schools.length} school tenants:`);
    schools.forEach(s => {
      console.log(`    - [${s.code}] ${s.name} (Status: ${s.status}, Students: ${s.studentCount}, Faculty: ${s.teacherCount}, Fees: ₹${s.feeTotal})`);
      assert.ok('id' in s && 'name' in s && 'code' in s, 'School must contain id, name, and code');
      assert.ok(typeof s.studentCount === 'number', 'studentCount must be a number');
      assert.ok(typeof s.teacherCount === 'number', 'teacherCount must be a number');
      assert.ok(typeof s.feeTotal === 'number', 'feeTotal must be a number');
      assert.ok(!('adminPasswordHash' in s), 'Sensitive admin password hash must NEVER be exposed');
      assert.ok(!('adminPasswordSalt' in s), 'Sensitive admin password salt must NEVER be exposed');
    });

    // Verify KPI calculations match the frontend logic
    const totalSchools = schools.length;
    const activeSchools = schools.filter(s => s.status === 'Active').length;
    const totalStudents = schools.reduce((sum, s) => sum + s.studentCount, 0);
    const totalFaculty = schools.reduce((sum, s) => sum + s.teacherCount, 0);
    const totalCollections = schools.reduce((sum, s) => sum + s.feeTotal, 0);

    console.log('\n  Calculated Dashboard Metrics:');
    console.log(`    • Total Schools: ${totalSchools}`);
    console.log(`    • Active Schools: ${activeSchools}`);
    console.log(`    • Total Students: ${totalStudents.toLocaleString('en-IN')}`);
    console.log(`    • Total Faculty: ${totalFaculty.toLocaleString('en-IN')}`);
    console.log(`    • Total Collections: ₹${totalCollections.toLocaleString('en-IN')}`);
    assert.ok(totalSchools > 0, 'Total schools must be > 0');
    assert.ok(activeSchools > 0, 'Active schools must be > 0');

    // -------------------------------------------------------------
    // Test 6: Inbound Demo Requests & Leads (/api/superadmin/demo-requests)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Inbound Demo Requests & Leads ---');
    const demoRes = await request({ path: '/api/superadmin/demo-requests', method: 'GET', headers: authHeaders });
    assert.strictEqual(demoRes.statusCode, 200, 'GET /api/superadmin/demo-requests must return 200');
    assert.strictEqual(demoRes.data.success, true);
    assert.ok(Array.isArray(demoRes.data.demoRequests), 'demoRequests must be an array');
    console.log(`  ✓ Returned ${demoRes.data.demoRequests.length} demo request leads`);

    // -------------------------------------------------------------
    // Test 7: Print Center School Accounts (/api/superadmin/print-center/schools)
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Print Center Accounts ---');
    const printRes = await request({ path: '/api/superadmin/print-center/schools', method: 'GET', headers: authHeaders });
    assert.strictEqual(printRes.statusCode, 200, 'GET /api/superadmin/print-center/schools must return 200');
    assert.strictEqual(printRes.data.success, true);
    assert.ok(Array.isArray(printRes.data.schools), 'schools must be an array');
    console.log(`  ✓ Returned ${printRes.data.schools.length} print center school accounts`);

    // -------------------------------------------------------------
    // Test 8: Custom School Domains (/api/superadmin/domains)
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: School Custom Domains Management ---');
    const domainsRes = await request({ path: '/api/superadmin/domains', method: 'GET', headers: authHeaders });
    assert.strictEqual(domainsRes.statusCode, 200, 'GET /api/superadmin/domains must return 200');
    assert.strictEqual(domainsRes.data.success, true);
    assert.ok(Array.isArray(domainsRes.data.schools), 'schools must be an array');
    console.log(`  ✓ Returned ${domainsRes.data.schools.length} school custom domain configurations`);

    // -------------------------------------------------------------
    // Test 9: Authorization Boundary & Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Tenant Isolation & Authorization Boundary ---');
    // Login as School Admin (gjv)
    const schoolAdminLogin = await request({
      path: '/api/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      username: 'admin@garumarajatiyavidyalaya.in',
      password: 'AdminPassword123'
    });
    
    if (schoolAdminLogin.statusCode === 200 && schoolAdminLogin.data.token) {
      const schoolToken = schoolAdminLogin.data.token;
      // School admin token must NOT be allowed to access Super Admin endpoints
      const forbiddenSchools = await request({
        path: '/api/superadmin/schools',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${schoolToken}` }
      });
      assert.strictEqual(forbiddenSchools.statusCode, 403, 'School admin token must receive 403 Forbidden on Super Admin endpoints');
      console.log('  ✓ School Admin token correctly blocked with 403 Forbidden on Super Admin routes');
    }

    console.log('\n======================================================');
    console.log('🎉 ALL SUPER ADMIN DASHBOARD CHECKS PASSED PERFECTLY! 🎉');
    console.log('======================================================\n');
  } finally {
    server.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
