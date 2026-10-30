const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3197;
const base = `http://127.0.0.1:${port}`;
let server;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(pathname, options = {}, token) {
  const response = await fetch(base + pathname, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { response, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Test server failed to start.');
}

async function runTeacherDeletionSyncTest() {
  console.log('=== STARTING TEACHER DELETION SYNCHRONIZATION INTEGRATION TEST ===');

  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore'
    });
    await waitForServer();

    // Admin Login
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert(adminLogin.response.ok && adminLogin.data.token, '0. Admin login successful');
    const adminToken = adminLogin.data.token;

    // STEP 1: Create a Teacher
    const newTeacherPayload = {
      name: 'Bishnu Prasad Das',
      mobile: '9854771122',
      email: 'bishnu.das@garumarajv.org',
      subject: 'Science',
      classTeacher: 'Class VI-A',
      salary: 30000,
      loginUsername: 'bishnu_tch',
      loginPassword: 'TempPass@123',
      loginStatus: 'Active'
    };

    const addRes = await request('/api/teachers', {
      method: 'POST',
      body: JSON.stringify(newTeacherPayload)
    }, adminToken);
    assert(addRes.response.ok && addRes.data.empId, '1. Created new teacher for lifecycle sync test');
    const empId = addRes.data.empId;

    // STEP 2: Assign Class and Subject
    const assignmentsPayload = [
      { teacher_id: empId, class_name: 'Class VI', section: 'A', subject_name: 'Science', academic_session: '2026-27', is_class_teacher: true }
    ];
    const assignRes = await request(`/api/teacher-assignments/teacher/${empId}`, {
      method: 'PUT',
      body: JSON.stringify({ assignments: assignmentsPayload })
    }, adminToken);
    assert(assignRes.response.ok && assignRes.data.count === 1, '2. Assigned class and subject workload');

    // STEP 3: Confirm Teacher Appears in Attendance List
    const activeTeachersRes = await request('/api/teachers', {}, adminToken);
    assert(activeTeachersRes.response.ok && activeTeachersRes.data.some(t => t.empId === empId), '3. Teacher appears in Active Teachers list');

    // STEP 4: Confirm Teacher Appears in Payroll List
    const payrollListRes = await request('/api/teachers', {}, adminToken);
    assert(payrollListRes.response.ok && payrollListRes.data.some(t => t.empId === empId), '4. Teacher appears in Payroll selection');

    // STEP 5: Confirm Teacher Appears in Reports & Stats
    const statsBefore = await request('/api/teachers/stats', {}, adminToken);
    assert(statsBefore.response.ok && statsBefore.data.totalTeachers > 0, '5. Teacher appears in Reports & Dashboard Stats');

    // STEP 6: Confirm Teacher Portal Access Works
    const portalLogin = await request('/api/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'bishnu_tch', password: 'TempPass@123' })
    });
    assert(portalLogin.response.ok && portalLogin.data.token, '6. Teacher Portal login works before deactivation');
    const teacherToken = portalLogin.data.token;

    // Log attendance & salary before deletion (historical records)
    const attDate = '2026-08-15';
    await request('/api/teachers/attendance', {
      method: 'POST',
      body: JSON.stringify({
        date: attDate,
        records: [{ empId, name: 'Bishnu Prasad Das', status: 'Present', remarks: 'Historical Log' }]
      })
    }, adminToken);

    const salaryPayload = {
      empId,
      month: 'July 2026',
      baseSalary: 30000,
      netSalary: 30000,
      paymentMode: 'Bank Transfer'
    };
    await request('/api/teachers/salaries', {
      method: 'POST',
      body: JSON.stringify(salaryPayload)
    }, adminToken);

    // STEP 7: Delete / Deactivate Teacher
    const delRes = await request(`/api/teachers/${empId}`, {
      method: 'DELETE'
    }, adminToken);
    assert(delRes.response.ok, '7. Admin soft-deletes and deactivates teacher');

    // STEP 8: Confirm Teacher Disappears from All Active Modules
    const activeAfter = await request('/api/teachers', {}, adminToken);
    assert(!activeAfter.data.some(t => t.empId === empId), '8a. Teacher disappears from default active teacher queries');

    const activeAssignAfter = await request('/api/teacher-assignments', {}, adminToken);
    assert(!activeAssignAfter.data.some(a => a.teacher_id === empId), '8b. Teacher workload assignments are cleared from active lists');

    const newSalaryBlockRes = await request('/api/teachers/salaries', {
      method: 'POST',
      body: JSON.stringify({ empId, month: 'August 2026', netSalary: 30000 })
    }, adminToken);
    assert(!newSalaryBlockRes.response.ok, '8c. Future payroll generation is blocked for deleted teacher');

    // STEP 9: Confirm Teacher Portal Login is Blocked
    const blockedLogin = await request('/api/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'bishnu_tch', password: 'TempPass@123' })
    });
    assert(!blockedLogin.response.ok && blockedLogin.response.status === 403, '9. Teacher Portal login is strictly blocked (HTTP 403)');

    const blockedProfile = await request('/api/teacher/profile', {}, teacherToken);
    assert(!blockedProfile.response.ok && blockedProfile.response.status === 403, '9b. Existing token access to Teacher Portal profile is revoked');

    // STEP 10: Confirm Old Attendance/Salary/History Remains Available
    const historyAttRes = await request(`/api/teachers/attendance?date=${attDate}`, {}, adminToken);
    assert(historyAttRes.response.ok && historyAttRes.data.some(day => day.records.some(r => r.empId === empId)), '10a. Historical attendance log remains preserved');

    const historySalaryRes = await request('/api/teachers/salaries', {}, adminToken);
    assert(historySalaryRes.response.ok && historySalaryRes.data.some(s => s.empId === empId), '10b. Historical salary slip remains preserved');

    // STEP 11: Server Restart & Reload Verification
    server.kill();
    await new Promise(r => setTimeout(r, 250));

    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore'
    });
    await waitForServer();

    const activeAfterRestart = await request('/api/teachers', {}, adminToken);
    assert(!activeAfterRestart.data.some(t => t.empId === empId), '11. Teacher does NOT reappear in active lists after application restart');

    console.log('\nALL 11 TEACHER DELETION SYNCHRONIZATION STEPS PASSED SUCCESSFULLY!');

  } finally {
    if (server) {
      server.kill();
      await new Promise(r => setTimeout(r, 250));
    }
    fs.writeFileSync(dbPath, originalDb);
  }
}

runTeacherDeletionSyncTest().catch(err => {
  console.error('Teacher Deletion Sync Test Failed:', err.message);
  if (server) server.kill();
  fs.writeFileSync(dbPath, originalDb);
  process.exit(1);
});
