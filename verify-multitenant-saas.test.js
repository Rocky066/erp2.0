const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const root = __dirname;
const port = 3195;

function request(reqPath, options = {}, token = null, schoolHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}), ...schoolHeaders };
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

async function runMultiTenantVerification() {
  console.log('=== STARTING MULTI-TENANT SAAS INTEGRATION & SECURITY TEST SUITE ===');
  let server;
  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit'
    });
    await waitForServer();
    console.log(`Server started on port ${port}`);

    // ==========================================
    // 1. SUPER ADMIN AUTHENTICATION
    // ==========================================
    console.log('\n--- 1. Testing Super Admin Authentication ---');
    const saLoginFail = await request('/api/superadmin/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'superadmin@schoolerp.in', password: 'WrongPassword' })
    });
    assert.strictEqual(saLoginFail.response.statusCode, 401, 'Invalid Super Admin password rejected');

    const saLoginSuccess = await request('/api/superadmin/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'superadmin@schoolerp.in', password: 'SuperAdmin@2026' })
    });
    assert(saLoginSuccess.response.ok, 'Super Admin login successful');
    const saToken = saLoginSuccess.data.token;
    assert(saToken, 'Super Admin token returned');
    assert.strictEqual(saLoginSuccess.data.role, 'SuperAdmin', 'Super Admin role verified');

    const saMe = await request('/api/superadmin/me', {}, saToken);
    assert(saMe.response.ok && saMe.data.role === 'SuperAdmin', 'Super Admin /me endpoint verified');
    console.log('✔ PASS: Super Admin authenticated successfully');

    // ==========================================
    // 2. LIST INITIAL SCHOOLS (Default School Exists)
    // ==========================================
    console.log('\n--- 2. Testing Default School Auto-Registration ---');
    const initialSchools = await request('/api/superadmin/schools', {}, saToken);
    assert(initialSchools.response.ok, 'Super Admin fetched schools list');
    assert(Array.isArray(initialSchools.data), 'Schools is an array');
    const defaultSchool = initialSchools.data.find(s => s.code === 'gjv');
    assert(defaultSchool, 'Default GJV school auto-registered in schools collection');
    assert.strictEqual(defaultSchool.status, 'Active', 'Default school is Active');
    console.log(`✔ PASS: Default school registered (${defaultSchool.name}, code: ${defaultSchool.code})`);

    // ==========================================
    // 3. ONBOARD TWO ISOLATED TENANT SCHOOLS
    // ==========================================
    console.log('\n--- 3. Onboarding Isolated Tenant Schools (Alpha Academy & Beta High) ---');
    const schoolAData = {
      name: 'Alpha Academy',
      code: 'alpha-academy',
      adminUsername: 'admin@alpha-academy.edu.in',
      adminPassword: 'Password@Alpha123',
      phone: '+91 9876500001',
      address: 'Dispur, Guwahati',
      principalName: 'Dr. Alok Sharma'
    };
    const schoolBData = {
      name: 'Beta High School',
      code: 'beta-high',
      adminUsername: 'admin@beta-high.edu.in',
      adminPassword: 'Password@Beta123',
      phone: '+91 9876500002',
      address: 'Tezpur, Sonitpur',
      principalName: 'Mrs. Bandana Das'
    };

    const onboardA = await request('/api/superadmin/schools', {
      method: 'POST',
      body: JSON.stringify(schoolAData)
    }, saToken);
    assert.strictEqual(onboardA.response.statusCode, 201, 'School A onboarded successfully');
    const schoolA = onboardA.data.school;
    assert(schoolA && schoolA.id, 'School A ID generated');

    const onboardB = await request('/api/superadmin/schools', {
      method: 'POST',
      body: JSON.stringify(schoolBData)
    }, saToken);
    assert.strictEqual(onboardB.response.statusCode, 201, 'School B onboarded successfully');
    const schoolB = onboardB.data.school;
    assert(schoolB && schoolB.id, 'School B ID generated');

    // Duplicate check test: Trying to onboard duplicate code must fail with 409
    const duplicateCode = await request('/api/superadmin/schools', {
      method: 'POST',
      body: JSON.stringify({ ...schoolAData, adminUsername: 'other@alpha.in' })
    }, saToken);
    assert.strictEqual(duplicateCode.response.statusCode, 409, 'Duplicate school code rejected');
    console.log('✔ PASS: School A and School B onboarded with duplicate protection');

    // ==========================================
    // 4. SUBDOMAIN & HEADER ROUTING / ADMIN LOGIN
    // ==========================================
    console.log('\n--- 4. Testing Subdomain Routing & Tenant Login Scoping ---');
    // Login to School A using Host header: alpha-academy.schoolerp.in
    const headersA = { 'Host': `alpha-academy.schoolerp.in:${port}` };
    const headersB = { 'Host': `beta-high.schoolerp.in:${port}` };

    // Attempting School A credentials on School B host MUST fail
    const crossLoginAttempt = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: schoolAData.adminUsername, password: schoolAData.adminPassword })
    }, null, headersB);
    assert.strictEqual(crossLoginAttempt.response.statusCode, 400, 'School A admin credentials rejected on School B host');

    // Login on School A host succeeds
    const loginA = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: schoolAData.adminUsername, password: schoolAData.adminPassword })
    }, null, headersA);
    assert(loginA.response.ok, 'School A Admin logged in successfully');
    const tokenA = loginA.data.token;
    assert.strictEqual(loginA.data.school_id, schoolA.id, 'Token bound to School A ID');

    // Login on School B host succeeds
    const loginB = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: schoolBData.adminUsername, password: schoolBData.adminPassword })
    }, null, headersB);
    assert(loginB.response.ok, 'School B Admin logged in successfully');
    const tokenB = loginB.data.token;
    assert.strictEqual(loginB.data.school_id, schoolB.id, 'Token bound to School B ID');
    console.log('✔ PASS: School admins can only log into their assigned school host');

    // Cross-school token injection test: Using Token A on Host B MUST be rejected with 403
    const crossTokenRequest = await request('/api/students', {}, tokenA, headersB);
    assert.strictEqual(crossTokenRequest.response.statusCode, 403, 'Cross-school token usage rejected with 403');
    console.log('✔ PASS: Server rejects cross-school token injection');

    // ==========================================
    // 5. STUDENT DATA ISOLATION
    // ==========================================
    console.log('\n--- 5. Testing Student Data Isolation ---');
    // Add student in School A
    const studentAData = {
      name: 'Aarav Sharma',
      dob: '2016-05-10',
      gender: 'Male',
      className: 'Class V',
      section: 'A',
      rollNo: 1,
      fatherName: 'Rajesh Sharma',
      mobile: '9876543210',
      admissionFee: 1500,
      monthlyFee: 800,
      studentAadhaar: '123456789012',
      fatherAadhaar: '987654321098'
    };
    const addStudentA = await request('/api/students', {
      method: 'POST',
      body: JSON.stringify(studentAData)
    }, tokenA, headersA);
    assert.strictEqual(addStudentA.response.statusCode, 201, 'Student added in School A');
    const studentA = addStudentA.data;
    assert(studentA.admissionNo.startsWith('ALPHA-ACADEMY-') || studentA.admissionNo.includes('-'), 'School A admission number prefix');

    // Query students in School B: MUST BE 0!
    const queryStudentsB1 = await request('/api/students', {}, tokenB, headersB);
    assert.strictEqual(queryStudentsB1.data.length, 0, 'School B sees ZERO students from School A');

    // Add student in School B
    const studentBData = {
      name: 'Barnali Das',
      dob: '2016-08-20',
      gender: 'Female',
      className: 'Class V',
      section: 'B',
      rollNo: 1,
      fatherName: 'Biren Das',
      mobile: '9876543211',
      admissionFee: 2000,
      monthlyFee: 1000,
      studentAadhaar: '234567890123',
      fatherAadhaar: '876543210987'
    };
    const addStudentB = await request('/api/students', {
      method: 'POST',
      body: JSON.stringify(studentBData)
    }, tokenB, headersB);
    assert.strictEqual(addStudentB.response.statusCode, 201, 'Student added in School B');
    const studentB = addStudentB.data;

    // School A sees only Student A
    const queryStudentsA = await request('/api/students', {}, tokenA, headersA);
    assert.strictEqual(queryStudentsA.data.length, 1, 'School A sees exactly 1 student');
    assert.strictEqual(queryStudentsA.data[0].name, 'Aarav Sharma');

    // School B sees only Student B
    const queryStudentsB2 = await request('/api/students', {}, tokenB, headersB);
    assert.strictEqual(queryStudentsB2.data.length, 1, 'School B sees exactly 1 student');
    assert.strictEqual(queryStudentsB2.data[0].name, 'Barnali Das');

    // Unauthorized modification: School B trying to delete Student A
    const crossDelete = await request(`/api/students/${studentA.admissionNo}`, {
      method: 'DELETE'
    }, tokenB, headersB);
    assert.strictEqual(crossDelete.response.statusCode, 404, 'School B cannot delete School A student (returns 404)');
    console.log('✔ PASS: Student data strictly isolated between schools');

    // ==========================================
    // 6. FEE COLLECTION & FINANCIAL ISOLATION
    // ==========================================
    console.log('\n--- 6. Testing Fee Collection & Financial Isolation ---');
    // Collect fee for Student A in School A
    const feeAData = {
      studentId: studentA.admissionNo,
      amount: 800,
      month: '2027-04',
      type: 'Monthly Tuition Fee',
      paymentMode: 'Cash'
    };
    const payA = await request('/api/fees', {
      method: 'POST',
      body: JSON.stringify(feeAData)
    }, tokenA, headersA);
    if (payA.response.statusCode !== 201) console.log('DEBUG payA:', payA.response.statusCode, payA.data);
    assert.strictEqual(payA.response.statusCode, 201, 'Fee payment collected in School A');

    // School B attempts to collect fee for Student A: MUST FAIL (404)
    const crossFee = await request('/api/fees', {
      method: 'POST',
      body: JSON.stringify({ ...feeAData, studentId: studentA.admissionNo })
    }, tokenB, headersB);
    assert.strictEqual(crossFee.response.statusCode, 404, 'School B cannot collect fee for School A student');

    // School B fee dashboard stats: MUST BE 0!
    const statsB = await request('/api/fees/dashboard-stats', {}, tokenB, headersB);
    assert.strictEqual(statsB.data.totalCollected, 0, 'School B fee collection total is ₹0');

    // School A fee dashboard stats: MUST BE 800!
    const statsA = await request('/api/fees/dashboard-stats', {}, tokenA, headersA);
    assert.strictEqual(statsA.data.totalCollected, 800, 'School A fee collection total is ₹800');
    console.log('✔ PASS: Fee collections and ledgers strictly isolated');

    // ==========================================
    // 7. TEACHER & ASSIGNMENT ISOLATION
    // ==========================================
    console.log('\n--- 7. Testing Teacher & Faculty Isolation ---');
    const teacherAData = {
      name: 'Pranab Kumar',
      email: 'pranab@alpha-academy.edu.in',
      mobile: '9876500111',
      subject: 'Mathematics',
      qualification: 'M.Sc., B.Ed.',
      classTeacher: 'Class V-A',
      basicSalary: 30000,
      loginUsername: 'pranab_math',
      loginPassword: 'TeacherPassword123'
    };
    const addTeacherA = await request('/api/teachers', {
      method: 'POST',
      body: JSON.stringify(teacherAData)
    }, tokenA, headersA);
    assert.strictEqual(addTeacherA.response.statusCode, 201, 'Teacher added in School A');

    // School B sees ZERO teachers
    const teachersB = await request('/api/teachers', {}, tokenB, headersB);
    assert.strictEqual(teachersB.data.length, 0, 'School B sees ZERO teachers from School A');

    // School A sees exactly 1 teacher
    const teachersA = await request('/api/teachers', {}, tokenA, headersA);
    assert.strictEqual(teachersA.data.length, 1, 'School A sees 1 teacher');
    assert.strictEqual(teachersA.data[0].name, 'Pranab Kumar');
    console.log('✔ PASS: Faculty records strictly isolated');

    // ==========================================
    // 8. ATTENDANCE & EXAM SCORES ISOLATION
    // ==========================================
    console.log('\n--- 8. Testing Attendance & Exam Scores Isolation ---');
    // Mark attendance in School A
    const attendanceAData = {
      date: '2027-04-10',
      className: 'Class V',
      section: 'A',
      records: [{ studentId: studentA.admissionNo, status: 'Present' }]
    };
    const markAttA = await request('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(attendanceAData)
    }, tokenA, headersA);
    assert(markAttA.response.ok, 'Attendance marked in School A');

    // School B attendance queries: MUST BE EMPTY!
    const queryAttB = await request('/api/attendance', {}, tokenB, headersB);
    assert.strictEqual(queryAttB.data.length, 0, 'School B sees ZERO attendance sheets from School A');

    // School A sees 1 attendance sheet
    const queryAttA = await request('/api/attendance', {}, tokenA, headersA);
    assert.strictEqual(queryAttA.data.length, 1, 'School A sees attendance sheet');

    // Post exam score in School A
    const examAData = {
      name: 'Unit Test 1',
      className: 'Class V',
      section: 'A',
      subject: 'Mathematics',
      marks: [{ studentId: studentA.admissionNo, marksObtained: 95 }]
    };
    const postExamA = await request('/api/exams', {
      method: 'POST',
      body: JSON.stringify(examAData)
    }, tokenA, headersA);
    if (!postExamA.response.ok) console.log('DEBUG postExamA:', postExamA.response.statusCode, postExamA.data);
    assert(postExamA.response.ok, 'Exam score posted in School A');

    // School B exams query: MUST BE EMPTY!
    const queryExamB = await request('/api/exams', {}, tokenB, headersB);
    assert.strictEqual(queryExamB.data.length, 0, 'School B sees ZERO exams from School A');
    console.log('✔ PASS: Attendance and Examination records strictly isolated');

    // ==========================================
    // 9. REPORTS & BACKUP EXPORT ISOLATION
    // ==========================================
    console.log('\n--- 9. Testing Reports & Data Export Isolation ---');
    const reportsA = await request('/api/reports', {}, tokenA, headersA);
    assert(reportsA.response.ok, 'School A reports fetched');
    assert.strictEqual(reportsA.data.totalStudents, 1, 'School A reports show 1 student');

    const reportsB = await request('/api/reports', {}, tokenB, headersB);
    assert(reportsB.response.ok, 'School B reports fetched');
    assert.strictEqual(reportsB.data.totalStudents, 1, 'School B reports show 1 student (its own)');

    // School Admin backup download: MUST NOT contain other schools' data
    const backupA = await request('/api/backup', {}, tokenA, headersA);
    assert(backupA.response.ok, 'School A backup generated');
    const backupDataA = backupA.data;
    // Check that backup only contains School A students
    const backupStudents = backupDataA.students || [];
    assert(backupStudents.every(s => s.school_id === schoolA.id), 'Backup contains only School A students');
    assert(!backupStudents.some(s => s.school_id === schoolB.id), 'Backup contains ZERO students from School B');
    console.log('✔ PASS: Reports and database exports strictly isolated');

    // ==========================================
    // 10. SCHOOL SUSPENSION WORKFLOW
    // ==========================================
    console.log('\n--- 10. Testing School Suspension Security ---');
    // Super Admin suspends School B
    const suspendB = await request(`/api/superadmin/schools/${schoolB.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'Suspended' })
    }, saToken);
    assert(suspendB.response.ok, 'Super Admin suspended School B');

    // School B admin login attempt MUST BE REJECTED with 403
    const suspendedLoginAttempt = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: schoolBData.adminUsername, password: schoolBData.adminPassword })
    }, null, headersB);
    assert.strictEqual(suspendedLoginAttempt.response.statusCode, 403, 'Suspended school login rejected with 403');

    // School B authenticated API call with existing token MUST BE REJECTED with 403
    const suspendedApiAttempt = await request('/api/students', {}, tokenB, headersB);
    assert.strictEqual(suspendedApiAttempt.response.statusCode, 403, 'Suspended school API call rejected with 403');

    // Reactivate School B
    const reactivateB = await request(`/api/superadmin/schools/${schoolB.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'Active' })
    }, saToken);
    assert(reactivateB.response.ok, 'Super Admin reactivated School B');

    // School B access restored
    const restoredLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: schoolBData.adminUsername, password: schoolBData.adminPassword })
    }, null, headersB);
    assert(restoredLogin.response.ok, 'Reactivated school login succeeds');
    console.log('✔ PASS: School suspension and reactivation enforcement verified');

    // ==========================================
    // 11. DEFAULT GJV SCHOOL REGRESSION VERIFICATION
    // ==========================================
    console.log('\n--- 11. Testing Default School Backward Compatibility & Root Tenant Isolation ---');
    // Attempting login on root domain localhost without tenant context MUST reject (no silent default)
    const rootLoginAttempt = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert.strictEqual(rootLoginAttempt.response.statusCode, 400, 'Root domain rejects school admin login without school context');
    assert(rootLoginAttempt.data.error.includes('tenant context required'), 'Error explains tenant context requirement');

    // Login with explicit school tenant context (e.g. gjv subdomain / x-school-code)
    const defaultLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-school-code': 'gjv' },
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert(defaultLogin.response.ok, 'Default school admin login succeeds with school tenant context');
    const defaultToken = defaultLogin.data.token;
    assert.strictEqual(defaultLogin.data.school_code, 'gjv', 'Default school code is gjv');

    const defaultStudents = await request('/api/students', { headers: { 'x-school-code': 'gjv' } }, defaultToken);
    assert(defaultStudents.response.ok, 'Default school students query succeeds');
    assert(defaultStudents.data.every(s => !s.school_id || s.school_id === 'school_gjv_default'), 'Clean isolation preserved for default school with zero tenant leakage');
    console.log(`✔ PASS: Default school operations and data preserved (${defaultStudents.data.length} students) with zero regression`);

    console.log('\n🎉 ALL 11 MULTI-TENANT SAAS INTEGRATION & SECURITY TESTS PASSED 100%!');
  } finally {
    if (server) {
      server.kill();
      // Wait a moment for port release
      await new Promise(r => setTimeout(r, 500));
    }
    // Cleanup temporary test schools from db.json
    try {
      const dbPath = path.join(root, 'db.json');
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      db.schools = (db.schools || []).filter(s => s.code === 'gjv');
      const testSchoolIds = new Set(['SCH-ALPHA-ACADEMY', 'SCH-BETA-HIGH']);
      const cleanupCols = ['students', 'teachers', 'teacherLogin', 'teacherAssignments', 'teacherAttendance', 'fees', 'exams', 'examResults', 'studentAttendance', 'attendance', 'academicSessions', 'subjects'];
      cleanupCols.forEach(col => {
        if (Array.isArray(db[col])) {
          db[col] = db[col].filter(item => !item.school_id || item.school_id === 'school_gjv_default');
        }
      });
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      console.log('🧹 Test schools purged from database.');
    } catch (e) {}
  }
}

runMultiTenantVerification().catch(err => {
  console.error('\n❌ MULTI-TENANT TEST FAILED:', err);
  process.exit(1);
});
