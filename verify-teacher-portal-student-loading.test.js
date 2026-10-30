const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');

const root = __dirname;
const port = 3199;

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

async function runTeacherPortalLoadingTest() {
  console.log('=== STARTING TEACHER PORTAL STUDENT LOADING INTEGRATION TEST ===');
  let server;
  let adminToken = null;
  let teacherToken = null;
  let createdStudentA = null;
  let createdStudentB = null;
  let createdTeacherEmpId = null;
  let createdAssignmentId = null;

  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'inherit', 'inherit']
    });
    await waitForServer();

    // 1. ADMIN AUTHENTICATION
    const adminLoginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
    });
    assert(adminLoginRes.response.ok && adminLoginRes.data.token, '1. Admin login failed');
    adminToken = adminLoginRes.data.token;
    console.log('PASS: 1. Admin login authenticated');

    // 2. SETUP ACTIVE STUDENTS IN CLASS V-A (SESSION 2026-27)
    const addStudentARes = await request('/api/students', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Portal Test Student A',
        dob: '2016-04-10',
        gender: 'Male',
        className: 'Class V',
        section: 'A',
        rollNo: 101,
        fatherName: 'Father A',
        mobile: '9800000001',
        studentAadhaar: '111122223333',
        fatherAadhaar: '444455556666',
        admissionFee: 2000,
        monthlyFee: 500
      })
    }, adminToken);
    assert(addStudentARes.response.ok, '2a. Create Student A failed');
    createdStudentA = addStudentARes.data.admissionNo || addStudentARes.data.student.admissionNo;

    const addStudentBRes = await request('/api/students', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Portal Test Student B',
        dob: '2016-05-12',
        gender: 'Female',
        className: 'Class V',
        section: 'A',
        rollNo: 102,
        fatherName: 'Father B',
        mobile: '9800000002',
        studentAadhaar: '222233334444',
        fatherAadhaar: '555566667777',
        admissionFee: 2000,
        monthlyFee: 500
      })
    }, adminToken);
    assert(addStudentBRes.response.ok, '2b. Create Student B failed');
    createdStudentB = addStudentBRes.data.admissionNo || addStudentBRes.data.student.admissionNo;
    console.log(`PASS: 2. Created active students: ${createdStudentA}, ${createdStudentB}`);

    // 3. SETUP TEACHER & CLASS WORKLOAD ASSIGNMENT
    const sessRes = await request('/api/settings', {}, adminToken);
    const activeSession = sessRes.data.session || '2027-28';
    console.log('Active academic session:', activeSession);

    const addTeacherRes = await request('/api/teachers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Portal Test Teacher',
        dob: '1990-01-01',
        mobile: '9876500001',
        email: 'portal.teacher@garumarajv.in',
        subject: 'Mathematics',
        classTeacher: 'Class V-A',
        status: 'Active',
        loginUsername: 'portal_teacher_test',
        loginPassword: 'TeacherPassword123'
      })
    }, adminToken);
    assert(addTeacherRes.response.ok && addTeacherRes.data.empId, '3a. Add teacher failed');
    createdTeacherEmpId = addTeacherRes.data.empId;

    const assignRes = await request('/api/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify({
        teacher_id: createdTeacherEmpId,
        class_name: 'Class V',
        section: 'A',
        subject_name: 'Mathematics',
        academic_session: activeSession,
        is_class_teacher: true
      })
    }, adminToken);
    assert(assignRes.response.ok, '3b. Assign class/subject to teacher failed');
    createdAssignmentId = assignRes.data.id;
    console.log(`PASS: 3. Created teacher ${createdTeacherEmpId} assigned to Class V-A Mathematics (${activeSession})`);

    // 4. TEACHER LOGIN
    const teacherLoginRes = await request('/api/teachers/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'portal_teacher_test', password: 'TeacherPassword123' })
    });
    assert(teacherLoginRes.response.ok && teacherLoginRes.data.token, '4. Teacher login failed: ' + JSON.stringify(teacherLoginRes.data));
    teacherToken = teacherLoginRes.data.token;
    console.log('PASS: 4. Teacher logged in successfully via Teacher Portal');

    // 5. CLASS STUDENTS ROSTER VERIFICATION
    const rosterRes = await request(`/api/teacher/students?className=Class%20V&section=A&academic_session=${activeSession}`, {}, teacherToken);
    assert(rosterRes.response.ok, '5a. Fetch teacher roster failed: ' + JSON.stringify(rosterRes.data));
    const rosterStudents = rosterRes.data.students || [];
    assert(rosterStudents.length >= 2, '5b. Roster must contain active assigned students');
    assert(rosterStudents.some(s => s.admissionNo === createdStudentA), '5c. Roster must contain Student A');
    assert(rosterStudents.some(s => s.admissionNo === createdStudentB), '5d. Roster must contain Student B');
    console.log(`PASS: 5. Class Students Roster loaded ${rosterStudents.length} assigned students for Class V-A`);

    // 6. MARK ATTENDANCE VERIFICATION
    const attDate = '2026-09-01';
    const markAttRes = await request('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({
        date: attDate,
        className: 'Class V',
        section: 'A',
        academic_session: activeSession,
        records: [
          { student_id: createdStudentA, status: 'Present', remarks: 'On time' },
          { student_id: createdStudentB, status: 'Absent', remarks: 'Sick leave' }
        ]
      })
    }, teacherToken);
    assert(markAttRes.response.ok, '6a. Save attendance failed: ' + JSON.stringify(markAttRes.data));
    console.log('PASS: 6. Marked attendance saved successfully (Student A: Present, Student B: Absent)');

    // 7. VERIFY SAVED ATTENDANCE RETRIEVAL
    const getAttRes = await request(`/api/attendance?date=${attDate}&className=Class%20V&section=A&academic_session=${activeSession}`, {}, teacherToken);
    assert(getAttRes.response.ok && Array.isArray(getAttRes.data) && getAttRes.data.length, '7a. Retrieve attendance failed: ' + JSON.stringify(getAttRes.data));
    const flatRecords = getAttRes.data.flatMap(group => group.records || []);
    const recA = flatRecords.find(r => (r.student_id || r.studentId || r.admissionNo) === createdStudentA);
    const recB = flatRecords.find(r => (r.student_id || r.studentId || r.admissionNo) === createdStudentB);
    assert(recA && recA.status === 'Present', '7b. Student A attendance must be Present');
    assert(recB && recB.status === 'Absent', '7c. Student B attendance must be Absent');
    console.log('PASS: 7. Retrieved saved attendance verified for Class V-A');

    // 8. ENTER MARKS VERIFICATION
    const saveMarksRes = await request('/api/exams', {
      method: 'POST',
      body: JSON.stringify({
        examName: 'Half Yearly Exam',
        subject: 'Mathematics',
        subject_id: 'SBJ-3',
        className: 'Class V',
        section: 'A',
        academic_session: activeSession,
        status: 'Submitted',
        marks: [
          { studentId: createdStudentA, admissionNo: createdStudentA, name: 'Portal Test Student A', rollNo: 101, marksObtained: 85, score: 85, maxMarks: 100, passMarks: 30, attendanceStatus: 'Present', isAbsent: false, grade: 'A', resultStatus: 'PASS' },
          { studentId: createdStudentB, admissionNo: createdStudentB, name: 'Portal Test Student B', rollNo: 102, marksObtained: null, score: null, maxMarks: 100, passMarks: 30, attendanceStatus: 'Absent', isAbsent: true, grade: 'ABSENT', resultStatus: 'ABSENT' }
        ]
      })
    }, teacherToken);
    assert(saveMarksRes.response.ok, '8a. Save exam marks failed: ' + JSON.stringify(saveMarksRes.data));
    console.log('PASS: 8. Saved exam marks in Teacher Portal (Student A: 85 PASS, Student B: ABSENT)');

    // 9. VERIFY MARKS IN ADMIN PORTAL
    const adminMarksRes = await request(`/api/exam-results?examName=Half%20Yearly%20Exam&className=Class%20V&section=A&academic_session=${activeSession}`, {}, adminToken);
    assert(adminMarksRes.response.ok && Array.isArray(adminMarksRes.data), '9a. Admin fetch exam results failed');
    const adminRecA = adminMarksRes.data.find(r => (r.student_id || r.studentId || r.admissionNo) === createdStudentA);
    const adminRecB = adminMarksRes.data.find(r => (r.student_id || r.studentId || r.admissionNo) === createdStudentB);
    assert(adminRecA && Number(adminRecA.marks_obtained || adminRecA.score) === 85, '9b. Admin portal must reflect Student A score 85');
    assert(adminRecB && (adminRecB.isAbsent === true || adminRecB.result_status === 'ABSENT'), '9c. Admin portal must reflect Student B ABSENT');
    console.log('PASS: 9. Verified exam marks in Admin Portal correctly synchronized');

    // 10. REFRESH & PERSISTENCE VERIFICATION IN TEACHER PORTAL
    const teacherReFetchRes = await request(`/api/exam-results?examName=Half%20Yearly%20Exam&className=Class%20V&section=A&academic_session=${activeSession}`, {}, teacherToken);
    assert(teacherReFetchRes.response.ok && Array.isArray(teacherReFetchRes.data), '10a. Teacher refetch exam results failed');
    const tchRecA = teacherReFetchRes.data.find(r => (r.student_id || r.studentId || r.admissionNo) === createdStudentA);
    assert(tchRecA && Number(tchRecA.marks_obtained || tchRecA.score) === 85, '10b. Refetched teacher marks must remain persisted');
    console.log('PASS: 10. Refreshed Teacher Portal verified marks data remains completely intact');

  } catch (err) {
    console.error('\nVerification Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    // Clean up test data
    if (createdStudentA || createdStudentB || createdTeacherEmpId) {
      const dbFile = `${root}/db.json`;
      if (fs.existsSync(dbFile)) {
        const dbData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        if (createdStudentA) dbData.students = (dbData.students || []).filter(s => s.admissionNo !== createdStudentA);
        if (createdStudentB) dbData.students = (dbData.students || []).filter(s => s.admissionNo !== createdStudentB);
        if (createdTeacherEmpId) {
          dbData.teachers = (dbData.teachers || []).filter(t => t.empId !== createdTeacherEmpId);
          dbData.teacherAssignments = (dbData.teacherAssignments || []).filter(a => a.teacher_id !== createdTeacherEmpId);
        }
        if (createdStudentA || createdStudentB) {
          dbData.studentAttendance = (dbData.studentAttendance || []).filter(a => a.student_id !== createdStudentA && a.student_id !== createdStudentB);
          dbData.attendance = (dbData.attendance || []).filter(sheet => {
            if (sheet.records) sheet.records = sheet.records.filter(r => r.student_id !== createdStudentA && r.student_id !== createdStudentB);
            return sheet.records && sheet.records.length > 0;
          });
          dbData.examResults = (dbData.examResults || []).filter(r => r.student_id !== createdStudentA && r.student_id !== createdStudentB);
          dbData.exams = (dbData.exams || []).filter(sheet => {
            if (sheet.marks) sheet.marks = sheet.marks.filter(m => m.studentId !== createdStudentA && m.studentId !== createdStudentB);
            return sheet.marks && sheet.marks.length > 0;
          });
        }
        fs.writeFileSync(dbFile, JSON.stringify(dbData, null, 2), 'utf8');
        console.log('🧹 Temporary test records cleaned up from database.');
      }
    }
    if (server) server.kill('SIGTERM');
  }
}

runTeacherPortalLoadingTest();
