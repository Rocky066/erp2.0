const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3199;
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

async function runFullTeacherManagementSuite() {
  console.log('=== STARTING END-TO-END TEACHER MANAGEMENT SYSTEM INTEGRATION TEST ===');

  try {
    // Start test server
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore'
    });
    await waitForServer();

    // 1. Admin Login
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert(adminLogin.response.ok && adminLogin.data.token, '1. Admin Login successful');
    const adminToken = adminLogin.data.token;

    // 2. Add Teacher
    const newTeacherPayload = {
      name: 'Rupam Goswami',
      gender: 'Male',
      dob: '1992-05-15',
      mobile: '9864998877',
      email: 'rupam.goswami@garumarajv.org',
      aadhaar: '123456789012',
      qualification: 'M.Sc. Mathematics, B.Ed.',
      experience: '6 Years',
      subject: 'Mathematics',
      classTeacher: 'Class IX-A',
      joiningDate: '2026-04-01',
      salary: 32000,
      address: 'Nagaon, Assam',
      emergencyContact: '9864001122',
      bankDetails: { bankName: 'SBI', accountNo: '30012345678', ifsc: 'SBIN0001234' },
      loginUsername: 'rupam_tch',
      loginPassword: 'TempPass@123',
      loginStatus: 'Active'
    };

    const addRes = await request('/api/teachers', {
      method: 'POST',
      body: JSON.stringify(newTeacherPayload)
    }, adminToken);

    if (!addRes.response.ok) console.error('Add Teacher Error:', addRes.response.status, addRes.data);
    assert(addRes.response.ok && addRes.data.empId, '2. Add Teacher creates teacher record with auto empId');
    const empId = addRes.data.empId;

    // 3. Teacher Directory Retrieval
    const directoryRes = await request('/api/teachers', {}, adminToken);
    assert(directoryRes.response.ok && directoryRes.data.some(t => t.empId === empId), '3. Teacher appears in Directory');

    // 4. Edit Teacher
    const editPayload = {
      name: 'Rupam Goswami (Senior)',
      subject: 'Higher Mathematics',
      salary: 35000,
      qualification: 'M.Sc. Math, B.Ed, M.Phil',
      mobile: '9864998877',
      email: 'rupam.goswami@garumarajv.org',
      status: 'Active'
    };
    const editRes = await request(`/api/teachers/${empId}`, {
      method: 'PUT',
      body: JSON.stringify(editPayload)
    }, adminToken);
    assert(editRes.response.ok, '4. Edit Teacher updates profile successfully');

    // Verify edit persistence
    const viewRes = await request(`/api/teachers/${empId}`, {}, adminToken);
    assert(viewRes.response.ok && viewRes.data.name === 'Rupam Goswami (Senior)' && viewRes.data.salary === 35000, '4b. Edited changes persist upon verification');

    // 5. Workload Assignment (Class/Section/Subject)
    const assignmentsPayload = [
      { teacher_id: empId, class_name: 'Class IX', section: 'A', subject_name: 'Mathematics', academic_session: '2026-27', is_class_teacher: true },
      { teacher_id: empId, class_name: 'Class X', section: 'A', subject_name: 'Mathematics', academic_session: '2026-27', is_class_teacher: false }
    ];
    const assignRes = await request(`/api/teacher-assignments/teacher/${empId}`, {
      method: 'PUT',
      body: JSON.stringify({ assignments: assignmentsPayload })
    }, adminToken);
    assert(assignRes.response.ok && assignRes.data.count === 2, '5. Assign Class & Subject workload succeeds');

    // 6. Teacher Login
    const teacherLogin = await request('/api/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'rupam_tch', password: 'TempPass@123' })
    });
    assert(teacherLogin.response.ok && teacherLogin.data.token, '6. Teacher Login succeeds with temporary credentials');
    const teacherToken = teacherLogin.data.token;

    // Verify Teacher Profile API
    const teacherProfile = await request('/api/teacher/profile', {}, teacherToken);
    assert(teacherProfile.response.ok && teacherProfile.data.empId === empId, '6b. Teacher Profile returns authenticated teacher data');

    // 7. Teacher Attendance Marking by Admin
    const attDate = '2026-08-20';
    const attSaveRes = await request('/api/teachers/attendance', {
      method: 'POST',
      body: JSON.stringify({
        date: attDate,
        records: [{ empId, name: 'Rupam Goswami (Senior)', status: 'Present', remarks: 'On Time' }]
      })
    }, adminToken);
    assert(attSaveRes.response.ok, '7. Teacher Attendance marked by Admin');

    // 8. Teacher Leave Application & Admin Approval
    const leaveAppRes = await request('/api/teachers/leaves', {
      method: 'POST',
      body: JSON.stringify({
        leave_type: 'Casual Leave',
        from_date: '2026-08-25',
        to_date: '2026-08-26',
        reason: 'Attending University Seminar'
      })
    }, teacherToken);
    assert(leaveAppRes.response.ok && leaveAppRes.data.leave.leave_request_id, '8. Teacher submits Leave Request via Teacher Portal');
    const leaveRequestId = leaveAppRes.data.leave.leave_request_id;

    // Admin Approve Leave Request
    const approveRes = await request(`/api/teacher-leaves/${leaveRequestId}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ admin_remarks: 'Approved by Principal' })
    }, adminToken);
    assert(approveRes.response.ok && approveRes.data.leave.status === 'Approved', '8b. Admin approves Leave Request with remarks');

    // Verify Teacher sees Approved Leave
    const myLeavesRes = await request('/api/teachers/leaves', {}, teacherToken);
    assert(myLeavesRes.response.ok && myLeavesRes.data.some(l => l.leave_request_id === leaveRequestId && l.status === 'Approved'), '8c. Teacher sees updated Approved status in Leave history');

    // 9. Teacher Exam Marks Entry
    // Retrieve or set a student in Class IX-A
    const studentsRes = await request('/api/students', {}, adminToken);
    let validStudent = studentsRes.data.find(s => s.className === 'Class IX' && s.section === 'A');
    if (!validStudent && studentsRes.data.length) {
      validStudent = studentsRes.data[0];
      await request(`/api/students/${validStudent.admissionNo}`, {
        method: 'PUT',
        body: JSON.stringify({ ...validStudent, className: 'Class IX', section: 'A', academicSession: '2026-27' })
      }, adminToken);
    }
    const validStudentId = validStudent ? validStudent.admissionNo : 'GJV-2026-0001';

    const examMarksPayload = {
      examName: 'Unit Test',
      subject: 'Mathematics',
      subject_id: 'sub_math',
      className: 'Class IX',
      class_id: 'Class IX',
      section: 'A',
      section_id: 'A',
      academic_session: '2026-27',
      session: '2026-27',
      status: 'Submitted',
      marks: [
        {
          studentId: validStudentId,
          admissionNo: validStudentId,
          marksObtained: 45,
          score: 45,
          maxMarks: 50,
          passMarks: 17,
          attendanceStatus: 'Present',
          isAbsent: false,
          grade: 'A',
          resultStatus: 'PASS',
          remarks: 'Good progress'
        }
      ]
    };
    const examSaveRes = await request('/api/exams', {
      method: 'POST',
      body: JSON.stringify(examMarksPayload)
    }, teacherToken);
    if (!examSaveRes.response.ok) console.error('Exam Save Error:', examSaveRes.data);
    assert(examSaveRes.response.ok, '9. Teacher enters and submits Exam Marks sheet');

    // 10. Admin Sees Marks
    const adminMarksRes = await request(`/api/exam-results?examName=Unit+Test&className=Class+IX&session=2026-27`, {}, adminToken);
    assert(adminMarksRes.response.ok && adminMarksRes.data.length > 0, '10. Admin sees teacher-submitted exam marks');

    // 11. Salary Disbursement
    const salaryPayload = {
      empId,
      month: 'August 2026',
      baseSalary: 35000,
      bonus: 2000,
      deduction: 1500,
      netSalary: 35500,
      paymentMode: 'Bank Transfer',
      referenceNo: 'TXN99887766'
    };
    const salaryRes = await request('/api/teachers/salaries', {
      method: 'POST',
      body: JSON.stringify(salaryPayload)
    }, adminToken);
    assert(salaryRes.response.ok && salaryRes.data.slipNo, '11. Admin disburses monthly salary and generates Salary Slip');

    // 12. Salary Slip Retrieval
    const mySalariesRes = await request('/api/teachers/salaries', {}, teacherToken);
    assert(mySalariesRes.response.ok && mySalariesRes.data.some(s => s.empId === empId && s.netSalary === 35500), '12. Teacher views disbursed Salary Slip in portal');

    // 13. Password Change
    const pwdRes = await request('/api/teacher/reset-password', {
      method: 'POST',
      body: JSON.stringify({ empId, oldPassword: 'TempPass@123', newPassword: 'NewSecurePass@2026' })
    }, teacherToken);
    assert(pwdRes.response.ok, '13. Teacher changes password successfully');

    // 14. Relogin with New Password
    const reloginRes = await request('/api/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'rupam_tch', password: 'NewSecurePass@2026' })
    });
    assert(reloginRes.response.ok && reloginRes.data.token, '14. Teacher re-authenticates with new password');

    // 15. Academic Session Isolation Test
    const assignedSessionRes = await request('/api/teacher/students?className=Class+IX&section=A&academic_session=2026-27', {}, reloginRes.data.token);
    assert(assignedSessionRes.response.ok && Array.isArray(assignedSessionRes.data.students), '15a. Assigned session 2026-27 roster is accessible');

    const unassignedSessionRes = await request('/api/teacher/students?className=Class+IX&section=A&academic_session=2027-28', {}, reloginRes.data.token);
    assert(unassignedSessionRes.response.status === 403, '15b. Unassigned session 2027-28 access is denied (Academic Session isolation enforced)');

    console.log('\nALL 15 END-TO-END TEACHER MANAGEMENT SYSTEM TESTS PASSED SUCCESSFULLY!');

  } finally {
    if (server) {
      server.kill();
      await new Promise(r => setTimeout(r, 250));
    }
    fs.writeFileSync(dbPath, originalDb);
  }
}

runFullTeacherManagementSuite().catch(err => {
  console.error('Test Suite Failed:', err.message);
  if (server) server.kill();
  fs.writeFileSync(dbPath, originalDb);
  process.exit(1);
});
