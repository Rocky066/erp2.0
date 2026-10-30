const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

const root = __dirname;
const port = 3198;

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

async function runBirthdayVerification() {
  console.log('=== STARTING DYNAMIC BIRTHDAYS & EVENTS VERIFICATION TEST ===');
  let server;
  let createdTeacherEmpId = null;
  let createdStudentAdmissionNo = null;

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
    assert(loginRes.response.ok && loginRes.data.token, '1. Admin login failed');
    const adminToken = loginRes.data.token;
    console.log('PASS: 1. Admin Login authenticated');

    // 2. EMPTY STATE BIRTHDAY VERIFICATION
    const overviewEmptyRes = await request('/api/dashboard/overview', {}, adminToken);
    assert(overviewEmptyRes.response.ok, '2. Dashboard overview request failed');
    const birthdayListEmpty = overviewEmptyRes.data.lists?.birthdayList || [];
    assert(birthdayListEmpty.length === 0, '2b. Birthday list must be empty when no active people match');
    assert(!JSON.stringify(overviewEmptyRes.data).includes('Anirban Sen'), '2c. Deleted demo Dr. Anirban Sen must NOT exist');
    assert(!JSON.stringify(overviewEmptyRes.data).includes('Pooja Baruah'), '2d. Deleted demo Pooja Baruah must NOT exist');
    console.log('PASS: 2. Empty state birthday list is 0, demo names completely absent');

    // 3. ADD REAL TEACHER WITH BIRTHDAY IN CURRENT MONTH
    const now = new Date();
    const curMonthStr = String(now.getMonth() + 1).padStart(2, '0');
    const teacherDob = `1992-${curMonthStr}-15`;

    const addTeacherRes = await request('/api/teachers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Real Active Teacher',
        dob: teacherDob,
        mobile: '9876543210',
        email: 'real.teacher@garumarajv.in',
        subject: 'Mathematics',
        status: 'Active'
      })
    }, adminToken);
    assert(addTeacherRes.response.ok && addTeacherRes.data.empId, '3. Add teacher failed');
    createdTeacherEmpId = addTeacherRes.data.empId;
    console.log('PASS: 3. Added real active teacher with birthday in current month:', createdTeacherEmpId);

    // 4. VERIFY TEACHER APPEARS IN BIRTHDAY FEED
    const overviewTeacherRes = await request('/api/dashboard/overview', {}, adminToken);
    const birthdayListTeacher = overviewTeacherRes.data.lists?.birthdayList || [];
    assert(birthdayListTeacher.some(b => b.name === 'Real Active Teacher' && b.dob === teacherDob), '4. Real teacher must appear in birthday feed');
    console.log('PASS: 4. Real teacher automatically appears in Birthday & Events list');

    // 5. ADD REAL STUDENT WITH BIRTHDAY IN CURRENT MONTH
    const studentDob = `2016-${curMonthStr}-20`;
    const addStudentRes = await request('/api/students', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Real Active Student',
        dob: studentDob,
        gender: 'Female',
        className: 'Class I',
        section: 'A',
        rollNo: 1,
        fatherName: 'Real Father',
        mobile: '9876543211',
        studentAadhaar: '999988887777',
        fatherAadhaar: '888877776666',
        admissionFee: 2000,
        monthlyFee: 500
      })
    }, adminToken);
    assert(addStudentRes.response.ok && (addStudentRes.data.admissionNo || addStudentRes.data.student?.admissionNo), '5. Add student failed');
    createdStudentAdmissionNo = addStudentRes.data.admissionNo || addStudentRes.data.student.admissionNo;
    console.log('PASS: 5. Added real active student with birthday in current month:', createdStudentAdmissionNo);

    // 6. VERIFY BOTH TEACHER AND STUDENT APPEAR IN BIRTHDAY FEED
    const overviewBothRes = await request('/api/dashboard/overview', {}, adminToken);
    const birthdayListBoth = overviewBothRes.data.lists?.birthdayList || [];
    assert(birthdayListBoth.some(b => b.name === 'Real Active Student' && b.dob === studentDob), '6. Real student must appear in birthday feed');
    assert(birthdayListBoth.some(b => b.name === 'Real Active Teacher' && b.dob === teacherDob), '6b. Real teacher must remain in birthday feed');
    console.log('PASS: 6. Both real teacher and real student dynamically populate Birthday & Events feed');

    // 7. DEACTIVATE/DELETE TEACHER & STUDENT AND VERIFY AUTOMATIC REMOVAL
    await request(`/api/teachers/${createdTeacherEmpId}`, { method: 'DELETE' }, adminToken);
    await request(`/api/students/${createdStudentAdmissionNo}`, { method: 'DELETE' }, adminToken);

    const overviewFinalRes = await request('/api/dashboard/overview', {}, adminToken);
    const birthdayListFinal = overviewFinalRes.data.lists?.birthdayList || [];
    assert(birthdayListFinal.length === 0, '7. Soft-deleted teacher and student must automatically disappear from birthday list');
    console.log('PASS: 7. Deleted people immediately disappear from Birthday & Events list');

  } catch (err) {
    console.error('\nVerification Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    // Cleanup any temporary records created during test
    if (createdTeacherEmpId || createdStudentAdmissionNo) {
      const fs = require('fs');
      const dbFile = `${root}/db.json`;
      if (fs.existsSync(dbFile)) {
        const dbData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        if (createdTeacherEmpId) dbData.teachers = (dbData.teachers || []).filter(t => t.empId !== createdTeacherEmpId);
        if (createdStudentAdmissionNo) dbData.students = (dbData.students || []).filter(s => s.admissionNo !== createdStudentAdmissionNo);
        fs.writeFileSync(dbFile, JSON.stringify(dbData, null, 2), 'utf8');
        console.log('🧹 Temporary test records cleaned up from database.');
      }
    }
    if (server) server.kill('SIGTERM');
  }
}

runBirthdayVerification();
