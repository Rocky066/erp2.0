const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const root = __dirname;
const port = 3198;

function request(reqPath, options = {}, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, `http://localhost:${port}`);
    const headers = {
      ...(options.headers || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, {
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
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json,
          text: data
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function startServer(serverPort) {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(serverPort) },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    srv.stdout.on('data', d => stdout += d.toString());
    srv.stderr.on('data', d => stdout += d.toString());

    let retries = 35;
    const interval = setInterval(async () => {
      try {
        const check = await new Promise((res, rej) => {
          const r = http.get(`http://localhost:${serverPort}/api/saas/config`, resp => {
            res(resp.statusCode);
          });
          r.on('error', rej);
        });
        if (check === 200) {
          clearInterval(interval);
          resolve(srv);
        }
      } catch (e) {
        if (--retries <= 0) {
          clearInterval(interval);
          srv.kill();
          reject(new Error('Server failed to start on port ' + serverPort + ': ' + stdout));
        }
      }
    }, 250);
  });
}

async function runVerificationSuite() {
  console.log('================================================================');
  console.log('   RUNNING COMPREHENSIVE 10-SCENARIO TENANT ROUTING & SECURITY SUITE');
  console.log('================================================================');

  let server = await startServer(port);
  console.log(`\n✓ Node.js server booted cleanly on port ${port}`);

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Opening "/" while logged out
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Opening "/" while logged out ---');
    const rootRes = await request('/');
    assert.strictEqual(rootRes.statusCode, 200, 'Root path returns HTTP 200');
    assert(rootRes.text.includes('EduPulse Cloud') || rootRes.text.includes('School ERP SaaS') || rootRes.text.includes('SaaS'), 'Serves SaaS marketing website');
    assert(!rootRes.text.includes('Garumara Jatiya Vidyalaya Admin Portal'), 'Does NOT load Garumara Admin Portal');
    assert(!rootRes.text.includes('Student Management Dashboard'), 'Does NOT load school dashboard');
    console.log('✔ PASS: Root "/" loads SaaS marketing website without school dashboard or default school branding.');

    // -------------------------------------------------------------
    // SCENARIO 2: Opening "/admin" while logged out
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Opening "/admin" while logged out ---');
    // On root domain (localhost):
    const adminRootRes = await request('/admin');
    assert([302, 301].includes(adminRootRes.statusCode), 'Root /admin returns HTTP 302 redirect');
    assert.strictEqual(adminRootRes.headers['location'], '/login?target=/admin', 'Redirects to /login?target=/admin gateway');
    
    // On configured school subdomain (e.g. gjv.localhost):
    const adminSubdomainRes = await request('/admin', {
      headers: { 'Host': `gjv.localhost:${port}` }
    });
    assert.strictEqual(adminSubdomainRes.statusCode, 200, 'gjv.localhost/admin serves admin portal page');
    assert(adminSubdomainRes.text.includes('admin') || adminSubdomainRes.text.includes('Admin'), 'Serves school admin portal');

    // School admin login page on school subdomain:
    const adminLoginRes = await request('/admin/login', {
      headers: { 'Host': `gjv.localhost:${port}` }
    });
    assert.strictEqual(adminLoginRes.statusCode, 200, 'gjv.localhost/admin/login serves login page');
    console.log('✔ PASS: Root /admin redirects to login gateway; school subdomain /admin serves that school portal.');

    // -------------------------------------------------------------
    // SCENARIO 3: Opening "/super-admin" while logged out
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Opening "/super-admin" while logged out ---');
    const saPageRes = await request('/super-admin');
    assert.strictEqual(saPageRes.statusCode, 200, '/super-admin serves Super Admin portal');
    assert(saPageRes.text.includes('Super Admin'), 'Contains Super Admin console markup');

    // Authenticate as Super Admin
    const saLogin = await request('/api/superadmin/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'superadmin@schoolerp.in', password: 'SuperAdmin@2026' })
    });
    assert.strictEqual(saLogin.statusCode, 200, 'Super Admin login succeeds');
    assert(saLogin.data.token, 'Returns Super Admin JWT token');
    const saToken = saLogin.data.token;

    // Verify Super Admin can access platform management
    const saSchools = await request('/api/superadmin/schools', {}, saToken);
    assert.strictEqual(saSchools.statusCode, 200, 'Super Admin can access schools list');
    assert(Array.isArray(saSchools.data), 'Returns schools list');
    console.log('✔ PASS: Super Admin console opens; authentication and management APIs succeed.');

    // -------------------------------------------------------------
    // SCENARIO 4: Logging in as School Admin
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Logging in as School Admin ---');
    // On root domain without school context: must fail
    const rootAdminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert.strictEqual(rootAdminLogin.statusCode, 400, 'Login on root domain without tenant context rejected with 400');
    assert(rootAdminLogin.data.error.includes('tenant context required'), 'Error mentions tenant context requirement');

    // On correct school host (gjv.localhost):
    const gjvAdminLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Host': `gjv.localhost:${port}` },
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert.strictEqual(gjvAdminLogin.statusCode, 200, 'Login succeeds on assigned school host');
    assert.strictEqual(gjvAdminLogin.data.school_code, 'gjv', 'Token is scoped to gjv');
    const gjvToken = gjvAdminLogin.data.token;
    console.log('✔ PASS: School Admin login succeeds ONLY on assigned school host/context; root rejects.');

    // -------------------------------------------------------------
    // SCENARIO 5: Accessing the correct school subdomain
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Accessing the correct school subdomain ---');
    const gjvWebRes = await request('/', {
      headers: { 'Host': `gjv.localhost:${port}` }
    });
    assert.strictEqual(gjvWebRes.statusCode, 200, 'gjv.localhost/ returns HTTP 200');
    assert(gjvWebRes.text.includes('Garumara Jatiya Vidyalaya'), 'Contains Garumara school name');

    // Verify /api/website-info on gjv subdomain
    const gjvInfoRes = await request('/api/website-info', {
      headers: { 'Host': `gjv.localhost:${port}` }
    });
    assert.strictEqual(gjvInfoRes.statusCode, 200, 'Website info returns HTTP 200');
    assert.strictEqual(gjvInfoRes.data.schoolCode, 'gjv', 'Website info belongs to gjv');
    console.log('✔ PASS: School subdomain loads dedicated school website with that school\'s branding and info.');

    // -------------------------------------------------------------
    // SCENARIO 6: Accessing another school\'s records (Cross-school prevention)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Accessing another school\'s records (Cross-school block) ---');
    // Onboard a second school (St. Xavier's Academy, code: sxv)
    const createSchoolRes = await request('/api/superadmin/schools', {
      method: 'POST',
      body: JSON.stringify({
        name: "St. Xavier Academy",
        code: "sxv",
        subdomain: "sxv",
        plan: "growth",
        status: "Active",
        adminUsername: "admin@stxavier.edu",
        adminPassword: "XavierAdmin@2026",
        phone: "9876543210",
        officialEmail: "admin@stxavier.edu"
      })
    }, saToken);
    assert([200, 201].includes(createSchoolRes.statusCode), 'Second school onboarded');
    const schoolBId = createSchoolRes.data.school.id;

    // Login as School B Admin
    const sxvLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Host': `sxv.localhost:${port}` },
      body: JSON.stringify({ username: "admin@stxavier.edu", password: "XavierAdmin@2026" })
    });
    assert.strictEqual(sxvLogin.statusCode, 200, 'School B Admin login succeeds');
    const sxvToken = sxvLogin.data.token;

    // Attempt Cross-School Token Injection:
    // Send School A's (GJV) token to School B's host
    const crossTokenRes = await request('/api/students', {
      headers: { 'Host': `sxv.localhost:${port}` }
    }, gjvToken);
    assert.strictEqual(crossTokenRes.statusCode, 403, 'Cross-school token injection returns HTTP 403 Forbidden');
    assert(crossTokenRes.data.error.includes('Cross-school token usage is forbidden'), 'Error states cross-school forbidden');

    // Send School B's token to School A's host
    const crossTokenRes2 = await request('/api/students', {
      headers: { 'Host': `gjv.localhost:${port}` }
    }, sxvToken);
    assert.strictEqual(crossTokenRes2.statusCode, 403, 'Cross-school token injection returns HTTP 403 Forbidden');

    // Create a student in School B
    const studentBRes = await request('/api/students', {
      method: 'POST',
      headers: { 'Host': `sxv.localhost:${port}` },
      body: JSON.stringify({
        name: 'Rohan Sharma',
        dob: '2015-05-10',
        gender: 'Male',
        className: 'Class 5',
        section: 'A',
        rollNo: '1',
        fatherName: 'Vikram Sharma',
        mobile: '9876500001',
        admissionFee: 1500,
        monthlyFee: 800,
        studentAadhaar: '123456789012',
        fatherAadhaar: '987654321098'
      })
    }, sxvToken);
    assert.strictEqual(studentBRes.statusCode, 201, 'Student created in School B');
    const studentBAdmNo = studentBRes.data.admissionNo;

    // GJV Admin queries students on GJV host: Rohan Sharma MUST NOT be visible!
    const gjvStudentsRes = await request('/api/students', {
      headers: { 'Host': `gjv.localhost:${port}` }
    }, gjvToken);
    assert.strictEqual(gjvStudentsRes.statusCode, 200);
    assert(!gjvStudentsRes.data.some(s => s.admissionNo === studentBAdmNo), 'School B student is isolated and NOT visible in School A');

    // GJV Admin tries to PUT /api/students/:id on School B's student
    const tamperRes = await request(`/api/students/${studentBAdmNo}`, {
      method: 'PUT',
      headers: { 'Host': `gjv.localhost:${port}` },
      body: JSON.stringify({ name: 'Hacked Name' })
    }, gjvToken);
    assert.strictEqual(tamperRes.statusCode, 404, 'Cannot edit another school\'s student; returns 404');
    console.log('✔ PASS: Cross-school token injection rejected (403); student data strictly isolated; tampering blocked (404).');

    // -------------------------------------------------------------
    // SCENARIO 7: Calling protected APIs without authentication
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Calling protected APIs without authentication ---');
    const protectedRoutes = [
      '/api/students',
      '/api/fees',
      '/api/teachers',
      '/api/settings',
      '/api/subjects'
    ];
    for (const r of protectedRoutes) {
      const unauth = await request(r, {
        headers: { 'Host': `gjv.localhost:${port}` }
      });
      assert.strictEqual(unauth.statusCode, 401, `Unauthenticated request to ${r} returns HTTP 401`);
    }
    console.log('✔ PASS: All protected ERP API endpoints strictly return HTTP 401 Unauthorized.');

    // -------------------------------------------------------------
    // SCENARIO 8: Opening an unknown or unconfigured school subdomain
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Opening an unknown or unconfigured school subdomain ---');
    const unknownRes = await request('/', {
      headers: { 'Host': `xyz-unknown.localhost:${port}` }
    });
    assert.strictEqual(unknownRes.statusCode, 404, 'Unknown subdomain returns HTTP 404');
    assert(unknownRes.text.includes('School Not Found') || unknownRes.text.includes('Unregistered'), 'Displays School Not Found page');
    assert(!unknownRes.text.includes('Garumara Jatiya Vidyalaya'), 'Does NOT fall back to Garumara');

    const unknownAdminRes = await request('/admin', {
      headers: { 'Host': `unknown-school.localhost:${port}` }
    });
    assert.strictEqual(unknownAdminRes.statusCode, 404, 'Unknown subdomain /admin returns HTTP 404');
    console.log('✔ PASS: Unknown subdomains return HTTP 404 School Not Found and never fall back to Garumara.');

    // -------------------------------------------------------------
    // SCENARIO 9: Refreshing pages and restarting the Node.js server
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Refreshing pages and restarting the Node.js server ---');
    // Kill the running server
    server.kill();
    await new Promise(r => setTimeout(r, 600));

    // Restart server on same port
    server = await startServer(port);
    console.log(`✓ Server successfully rebooted on port ${port}`);

    // Verify existing tokens remain valid across reboot
    const rebootCheckA = await request('/api/auth/me', {
      headers: { 'Host': `gjv.localhost:${port}` }
    }, gjvToken);
    assert.strictEqual(rebootCheckA.statusCode, 200, 'Valid token remains authenticated after server reboot');
    assert.strictEqual(rebootCheckA.data.school.code, 'gjv', 'Maintains correct school context after restart');

    const rebootCheckB = await request('/api/auth/me', {
      headers: { 'Host': `sxv.localhost:${port}` }
    }, sxvToken);
    assert.strictEqual(rebootCheckB.statusCode, 200, 'School B token remains authenticated after reboot');
    assert.strictEqual(rebootCheckB.data.school.code, 'sxv', 'Maintains School B context');

    // Deep routes test
    const deepRouteRes = await request('/admin/index.html', {
      headers: { 'Host': `gjv.localhost:${port}` }
    });
    assert.strictEqual(deepRouteRes.statusCode, 200, 'Deep route /admin/index.html loads cleanly');
    console.log('✔ PASS: Server restart succeeds; sessions and state persist cleanly without regressions.');

    // -------------------------------------------------------------
    // SCENARIO 10: Confirming Garumara is not loaded as default school
    // -------------------------------------------------------------
    console.log('\n--- Scenario 10: Confirming Garumara is not loaded as default school ---');
    // Root domain without cookies or headers:
    const cleanRoot = await request('/');
    assert.strictEqual(cleanRoot.statusCode, 200);
    assert(!cleanRoot.text.includes('Garumara Jatiya Vidyalaya'), 'Root domain does not mention Garumara');

    // Root domain /api/website-info:
    const rootInfo = await request('/api/website-info');
    assert.strictEqual(rootInfo.statusCode, 404, 'Root /api/website-info returns 404 when no tenant context exists');

    // Root domain /admin:
    const cleanAdmin = await request('/admin');
    assert.strictEqual(cleanAdmin.statusCode, 302, 'Root /admin redirects to login gateway');
    assert(cleanAdmin.headers['location'].includes('/login'), 'Redirect target is /login');

    // Random subdomain:
    const randomSubdomain = await request('/api/website-info', {
      headers: { 'Host': `nonexistent-school-12345.localhost:${port}` }
    });
    assert.strictEqual(randomSubdomain.statusCode, 404, 'Non-existent subdomain returns 404');
    console.log('✔ PASS: Zero default fallback to Garumara on root domain, unknown subdomains, or unassigned requests.');

    // Clean up test school
    const dbPath = path.join(root, 'db.json');
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    db.schools = (db.schools || []).filter(s => s.id !== schoolBId && s.code !== 'sxv');
    db.students = (db.students || []).filter(s => s.school_id !== schoolBId);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    console.log('✓ Cleaned up ephemeral test school record.');

    console.log('\n================================================================');
    console.log('🎉 ALL 10 VERIFICATION SCENARIOS PASSED WITH 100% SUCCESS!');
    console.log('================================================================');
  } finally {
    if (server) {
      server.kill();
    }
  }
}

runVerificationSuite().catch(err => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
