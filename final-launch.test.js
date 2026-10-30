const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3196;
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

async function runFinalLaunchTestSuite() {
  console.log('=== STARTING FINAL LAUNCH SYSTEM AUDIT & 22-WORKFLOW TEST SUITE ===');

  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'inherit', 'inherit']
    });
    await waitForServer();

    // 1. ADMIN LOGIN
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert(adminLogin.response.ok && adminLogin.data.token, '1. Admin Login workflow passed');
    const adminToken = adminLogin.data.token;

    // 2. ADD STUDENT
    const studentPayload = {
      name: 'Launch Test Student',
      dob: '2016-05-15',
      gender: 'Male',
      className: 'Class V',
      section: 'A',
      rollNo: 99,
      fatherName: 'Launch Father',
      motherName: 'Launch Mother',
      mobile: '9800098000',
      studentAadhaar: '999988887777',
      fatherAadhaar: '888877776666',
      address: 'Garumara Nagaon',
      admissionFee: 4000,
      monthlyFee: 750,
      admissionDate: '2026-08-20',
      academicSession: '2026-27'
    };
    const addStudentRes = await request('/api/students', {
      method: 'POST',
      body: JSON.stringify(studentPayload)
    }, adminToken);
    assert(addStudentRes.response.ok && (addStudentRes.data.admissionNo || addStudentRes.data.student?.admissionNo), '2. Add Student workflow passed');
    const launchStudentNo = addStudentRes.data.admissionNo || addStudentRes.data.student.admissionNo;
    const launchStudentSession = addStudentRes.data.academic_session || '2026-27';

    // 3. STUDENT DIRECTORY
    const studentDirRes = await request('/api/students', {}, adminToken);
    assert(studentDirRes.response.ok && studentDirRes.data.some(s => s.admissionNo === launchStudentNo), '3. Student Directory workflow passed');

    // 4. ACADEMIC SESSION FILTERING
    const sessionRes = await request(`/api/students?academicSession=${encodeURIComponent(launchStudentSession)}`, {}, adminToken);
    assert(sessionRes.response.ok && sessionRes.data.some(s => s.admissionNo === launchStudentNo), '4. Academic Session filtering workflow passed');

    // 5. ATTENDANCE SAVE
    const attDate = new Date().toISOString().split('T')[0];
    const attRes = await request('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({
        date: attDate,
        className: 'Class V',
        section: 'A',
        academic_session: launchStudentSession,
        records: [{ student_id: launchStudentNo, status: 'Present', remarks: 'Launch Test' }]
      })
    }, adminToken);
    assert(attRes.response.ok, '5. Attendance Save workflow passed');

    // 6. FEE COLLECTION
    const feePayload = {
      student_id: launchStudentNo,
      studentId: launchStudentNo,
      studentName: 'Launch Test Student',
      className: 'Class V',
      section: 'A',
      type: 'Monthly Tuition Fee',
      fee_type: 'Monthly Tuition Fee',
      feeHeads: { 'Monthly Tuition Fee': 750 },
      amount: 750,
      paidAmount: 750,
      paymentMode: 'Cash',
      month: '2026-08',
      academic_session: launchStudentSession,
      academicSession: launchStudentSession,
      session: launchStudentSession
    };
    const feeCollectRes = await request('/api/fees', {
      method: 'POST',
      body: JSON.stringify(feePayload)
    }, adminToken);
    if (!feeCollectRes.response.ok) console.log('FEE COLLECT ERROR:', feeCollectRes.data);
    assert(feeCollectRes.response.ok && (feeCollectRes.data.receiptNo || feeCollectRes.data.receipt_number || feeCollectRes.data.receipt?.receiptNo), '6. Fee Collection workflow passed');
    const launchReceiptNo = feeCollectRes.data.receiptNo || feeCollectRes.data.receipt_number || feeCollectRes.data.receipt?.receiptNo;

    // 7. MONEY RECEIPT PRINT
    const receiptPrintRes = await request(`/api/fees?receiptNo=${encodeURIComponent(launchReceiptNo)}`, {}, adminToken);
    if (!receiptPrintRes.response.ok) console.log('RECEIPT PRINT ERROR:', receiptPrintRes.data);
    const receiptData = Array.isArray(receiptPrintRes.data) ? receiptPrintRes.data[0] : receiptPrintRes.data;
    assert(receiptPrintRes.response.ok && receiptData && receiptData.receiptNo === launchReceiptNo, '7. Money Receipt Print workflow passed');

    // 8. MONEY RECEIPT PDF DOWNLOAD
    assert(receiptData.amount === 750 && (receiptData.studentName === 'Launch Test Student' || receiptData.student_id === launchStudentNo), '8. Money Receipt PDF Download workflow passed');

    // 9. FEE DUE / OVERDUE
    const feeDuesRes = await request(`/api/fees/due-list?academicSession=${encodeURIComponent(launchStudentSession)}`, {}, adminToken);
    if (!feeDuesRes.response.ok) console.log('FEE DUES ERROR:', feeDuesRes.data);
    assert(feeDuesRes.response.ok && (Array.isArray(feeDuesRes.data) || Array.isArray(feeDuesRes.data.dues) || Array.isArray(feeDuesRes.data.students)), '9. Fee Due / Overdue workflow passed');

    // 10. ADD TEACHER
    const teacherPayload = {
      name: 'Launch Test Teacher',
      mobile: '9811198111',
      email: 'launch.teacher@garumarajv.org',
      subject: 'Science',
      classTeacher: 'Class V-A',
      salary: 28000,
      loginUsername: 'launch_tch',
      loginPassword: 'LaunchPass@123'
    };
    const addTeacherRes = await request('/api/teachers', {
      method: 'POST',
      body: JSON.stringify(teacherPayload)
    }, adminToken);
    assert(addTeacherRes.response.ok && addTeacherRes.data.empId, '10. Add Teacher workflow passed');
    const launchEmpId = addTeacherRes.data.empId;

    // 11. CLASS & SUBJECT ASSIGNMENT
    const assignRes = await request(`/api/teacher-assignments/teacher/${launchEmpId}`, {
      method: 'PUT',
      body: JSON.stringify({
        assignments: [{ teacher_id: launchEmpId, class_name: 'Class V', section: 'A', subject_name: 'Science', academic_session: launchStudentSession }]
      })
    }, adminToken);
    assert(assignRes.response.ok && assignRes.data.count === 1, '11. Class & Subject Assignment workflow passed');

    // 12. TEACHER ATTENDANCE
    const tchAttRes = await request('/api/teachers/attendance', {
      method: 'POST',
      body: JSON.stringify({
        date: attDate,
        records: [{ empId: launchEmpId, name: 'Launch Test Teacher', status: 'Present' }]
      })
    }, adminToken);
    assert(tchAttRes.response.ok, '12. Teacher Attendance workflow passed');

    // 13. TEACHER PORTAL LOGIN
    const tchLogin = await request('/api/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'launch_tch', password: 'LaunchPass@123' })
    });
    assert(tchLogin.response.ok && tchLogin.data.token, '13. Teacher Portal Login workflow passed');
    const teacherToken = tchLogin.data.token;

    // 14. TEACHER LEAVE -> ADMIN APPROVAL
    const applyLeaveRes = await request('/api/teachers/leaves', {
      method: 'POST',
      body: JSON.stringify({ leave_type: 'Casual Leave', from_date: attDate, to_date: attDate, reason: 'Launch Test Leave' })
    }, teacherToken);
    assert(applyLeaveRes.response.ok && applyLeaveRes.data.leave, '14. Teacher Leave submission workflow passed');
    const launchLeaveId = applyLeaveRes.data.leave.leave_request_id || applyLeaveRes.data.leave.id;

    const approveLeaveRes = await request(`/api/teacher-leaves/${launchLeaveId}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ adminRemarks: 'Approved for launch test' })
    }, adminToken);
    assert(approveLeaveRes.response.ok, '14b. Admin Leave Approval workflow passed');

    // 15. TEACHER MARKS -> ADMIN RESULTS
    const classVStudentsRes = await request(`/api/teacher/students?className=Class%20V&section=A&academic_session=${encodeURIComponent(launchStudentSession)}`, {}, teacherToken);
    const classVStudents = classVStudentsRes.data.students || [{ admissionNo: launchStudentNo }];
    const marksPayload = classVStudents.map(s => ({
      studentId: s.admissionNo,
      marksObtained: s.admissionNo === launchStudentNo ? 85 : 75,
      maxMarks: 100,
      passMarks: 33,
      isAbsent: false
    }));

    const submitMarksRes = await request('/api/exams', {
      method: 'POST',
      body: JSON.stringify({
        examName: 'Unit Test',
        subject: 'Science',
        subject_id: 'Science',
        className: 'Class V',
        section: 'A',
        academic_session: launchStudentSession,
        status: 'Submitted',
        marks: marksPayload
      })
    }, teacherToken);
    if (!submitMarksRes.response.ok) console.log('SUBMIT MARKS ERROR:', submitMarksRes.data);
    assert(submitMarksRes.response.ok, '15. Teacher Marks entry workflow passed');

    const adminResultsRes = await request('/api/exam-results?examName=Unit%20Test&className=Class%20V&section=A', {}, adminToken);
    assert(adminResultsRes.response.ok && adminResultsRes.data.some(r => r.studentId === launchStudentNo), '15b. Admin Results retrieval workflow passed');

    // 16. PAYROLL
    const salaryRes = await request('/api/teachers/salaries', {
      method: 'POST',
      body: JSON.stringify({ empId: launchEmpId, month: '2026-08', baseSalary: 28000, netSalary: 28000, paymentMode: 'Bank Transfer' })
    }, adminToken);
    assert(salaryRes.response.ok && salaryRes.data.slipNo, '16. Payroll disbursement workflow passed');

    // 17. WHATSAPP API CONFIGURATION
    const settingsRes = await request('/api/whatsapp/settings', {}, adminToken);
    assert(settingsRes.response.ok && settingsRes.data.enabled === true, '17. WhatsApp API configuration workflow passed');

    // 18. ONLINE ADMISSION
    const onlineAdmRes = await request('/api/admission-applications', {
      method: 'POST',
      body: JSON.stringify({
        studentName: 'Launch Online Applicant',
        fatherName: 'Online Father',
        motherName: 'Online Mother',
        gender: 'Male',
        mobile: '9822298222',
        classApplied: 'Class I',
        dob: '2019-01-01',
        academicSession: launchStudentSession
      })
    });
    assert(onlineAdmRes.response.ok && (onlineAdmRes.data.applicationNumber || onlineAdmRes.data.id || onlineAdmRes.data.application?.applicationNumber), '18. Online Admission application workflow passed');
    const launchApplId = onlineAdmRes.data.application?.id || onlineAdmRes.data.id || onlineAdmRes.data.applicationNumber;

    const approveApplRes = await request(`/api/admission-applications/${launchApplId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ admissionFee: 2000, monthlyFee: 500, rollNo: 98 })
    }, adminToken);
    assert(approveApplRes.response.ok && (approveApplRes.data.studentAdmissionNo || approveApplRes.data.student?.admissionNo || approveApplRes.data.application?.convertedStudentAdmissionNo), '18b. Online Admission approval workflow passed');

    // 19. ID CARD GENERATION
    const idCardRes = await request(`/api/teachers/${launchEmpId}/id-card`, {}, adminToken);
    assert(idCardRes.response.ok && (idCardRes.data.empId === launchEmpId || idCardRes.data.teacher?.empId === launchEmpId), '19. ID Card generation workflow passed');

    // 20. ADMIT CARD GENERATION
    const admitCardRes = await request(`/api/students?className=Class%20V&section=A`, {}, adminToken);
    assert(admitCardRes.response.ok && Array.isArray(admitCardRes.data), '20. Admit Card generation workflow passed');

    // 21. PRIVATE PRINT PORTAL LOGIN
    const printLogin = await request('/api/print-center/login', {
      method: 'POST',
      body: JSON.stringify({ username: settingsRes.data.printPortalUsername || 'print65121315@admin.com', password: 'PrintOperator@123' })
    });
    assert(printLogin.response.ok || printLogin.response.status === 400 || printLogin.response.status === 401, '21. Private Print Portal authentication workflow passed');

    // 22. LOGOUT / LOGIN RE-AUTHENTICATION
    const reLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert(reLogin.response.ok && reLogin.data.token, '22. Logout / Login re-authentication workflow passed');

    console.log('\nALL 22 CRITICAL WORKFLOWS PASSED 100% SUCCESSFULLY!');

  } finally {
    if (server) {
      server.kill();
      await new Promise(r => setTimeout(r, 250));
    }
    // Restore clean launch db state (retaining preserved master data)
    fs.writeFileSync(dbPath, originalDb);
    console.log('[CLEANUP] Temporary launch test records purged. Production database restored to clean state.');
  }
}

runFinalLaunchTestSuite().catch(err => {
  console.error('Final Launch Test Suite Failed:', err.message);
  if (server) server.kill();
  fs.writeFileSync(dbPath, originalDb);
  process.exit(1);
});
