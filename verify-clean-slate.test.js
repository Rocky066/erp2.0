const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

const root = __dirname;
const port = 3197;

function request(reqPath, options = {}, token = null) {
  return new Promise((resolve, reject) => {
    const headers = options.headers || {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.body) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        res.ok = res.statusCode >= 200 && res.statusCode < 300;
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ response: res, data: json, raw: data });
        } catch (e) {
          resolve({ response: res, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function waitForServer(retries = 30) {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await request('/api/auth/me');
        if (res.response) return resolve(true);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    reject(new Error('Server failed to start on port ' + port));
  });
}

async function runCleanStateVerification() {
  console.log('=== STARTING LIVE API CLEAN STATE VERIFICATION ===');
  let server;
  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'inherit', 'inherit']
    });
    await waitForServer();

    // 1. ADMIN AUTHENTICATION
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    if (!loginRes.response.ok) console.log('LOGIN FAIL:', loginRes.response.statusCode, loginRes.data, loginRes.raw);
    assert(loginRes.response.ok && loginRes.data.token, '1. Admin Login failed');
    const adminToken = loginRes.data.token;
    console.log('PASS: 1. Admin Login authenticated successfully');

    // 2. STUDENTS CHECK
    const studentsRes = await request('/api/students', {}, adminToken);
    assert(studentsRes.response.ok && Array.isArray(studentsRes.data) && studentsRes.data.length === 0, '2. Students count must be 0');
    console.log('PASS: 2. Students count = 0');

    // 3. TEACHERS CHECK
    const teachersRes = await request('/api/teachers', {}, adminToken);
    if (!teachersRes.response.ok || !Array.isArray(teachersRes.data) || teachersRes.data.length !== 0) console.log('TEACHERS CHECK FAIL:', teachersRes.response.statusCode, teachersRes.data);
    assert(teachersRes.response.ok && Array.isArray(teachersRes.data) && teachersRes.data.length === 0, '3. Teachers count must be 0');
    console.log('PASS: 3. Teachers count = 0');

    // 4. TEACHER STATS CHECK
    const teacherStatsRes = await request('/api/teachers/stats', {}, adminToken);
    assert(teacherStatsRes.response.ok && teacherStatsRes.data.activeTeachers === 0, '4. Active teacher stats must be 0');
    console.log('PASS: 4. Active teacher stats = 0');

    // 5. FEES CHECK
    const feesRes = await request('/api/fees', {}, adminToken);
    assert(feesRes.response.ok && Array.isArray(feesRes.data) && feesRes.data.length === 0, '5. Fees collection transactions must be 0');
    console.log('PASS: 5. Fee collection records = 0');

    // 6. FEE DASHBOARD STATS CHECK
    const feeStatsRes = await request('/api/fees/dashboard-stats', {}, adminToken);
    if (!feeStatsRes.response.ok || Number(feeStatsRes.data.totalCollected || 0) !== 0) console.log('FEE STATS FAIL:', feeStatsRes.response.statusCode, feeStatsRes.data);
    assert(feeStatsRes.response.ok && Number(feeStatsRes.data.totalCollected || 0) === 0, '6. Fee collection amount must be ₹0');
    console.log('PASS: 6. Fee collection total = ₹0');

    // 7. FEE DUE LIST CHECK
    const feeDuesRes = await request('/api/fees/due-list', {}, adminToken);
    const duesList = Array.isArray(feeDuesRes.data) ? feeDuesRes.data : (feeDuesRes.data.dues || []);
    assert(feeDuesRes.response.ok && duesList.length === 0, '7. Fee due/overdue list must be 0');
    console.log('PASS: 7. Fee due/overdue records = 0');

    // 8. ONLINE ADMISSION APPLICATIONS CHECK
    const onlineAdmRes = await request('/api/admission-applications', {}, adminToken);
    const applications = Array.isArray(onlineAdmRes.data) ? onlineAdmRes.data : (onlineAdmRes.data.applications || []);
    assert(onlineAdmRes.response.ok && applications.length === 0, '8. Online admission applications must be 0');
    console.log('PASS: 8. Online admission applications = 0');

    // 9. TEACHER SALARIES / PAYROLL CHECK
    const salaryRes = await request('/api/teachers/salaries', {}, adminToken);
    assert(salaryRes.response.ok && Array.isArray(salaryRes.data) && salaryRes.data.length === 0, '9. Payroll transactions must be 0');
    console.log('PASS: 9. Payroll salary transactions = 0');

    // 10. TEACHER LEAVES CHECK
    const leavesRes = await request('/api/teachers/leaves', {}, adminToken);
    assert(leavesRes.response.ok && Array.isArray(leavesRes.data) && leavesRes.data.length === 0, '10. Teacher leave requests must be 0');
    console.log('PASS: 10. Teacher leave requests = 0');

    // 11. EXAM RESULTS CHECK
    const examResultsRes = await request('/api/exam-results', {}, adminToken);
    assert(examResultsRes.response.ok && Array.isArray(examResultsRes.data) && examResultsRes.data.length === 0, '11. Exam results must be 0');
    console.log('PASS: 11. Exam results = 0');

    // 12. CONFIGURATION PRESERVED CHECK
    const settingsRes = await request('/api/settings', {}, adminToken);
    assert(settingsRes.response.ok && settingsRes.data.adminUsername === 'admin@garumarajatiyavidyalaya.in', '12. School configuration must be preserved');
    console.log('PASS: 12. School configuration & master settings preserved intact');

    console.log('\n🎉 ALL 12 CLEAN STATE VERIFICATION ASSERTIONS PASSED 100%!');

  } catch (err) {
    console.error('\nVerification Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    if (server) server.kill('SIGTERM');
  }
}

runCleanStateVerification();
