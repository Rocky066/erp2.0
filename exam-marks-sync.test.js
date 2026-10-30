const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3103;
const base = `http://127.0.0.1:${port}`;
const password = 'MarksSync@123';
let server;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

async function request(pathname, options = {}, token) {
  const response = await fetch(base + pathname, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { response, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

async function run() {
  const db = JSON.parse(originalDb.toString('utf8'));
  const teacher = db.teachers[0];
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  db.teacherLogin = (db.teacherLogin || []).filter(account => account.teacher_id !== teacher.empId);
  db.teacherLogin.push({
    teacher_id: teacher.empId,
    teacher_emp_id: teacher.empId,
    username: teacher.empId.toLowerCase(),
    password_hash: passwordHash,
    password_salt: salt,
    login_status: 'Active',
    status: 'Active',
    failed_attempts: 0,
    force_password_change: false
  });
  db.students = [{ admissionNo: 'MARKS-001', name: 'Marks Test Student', rollNo: '1', className: 'Class X', section: 'A', status: 'Active', academicSession: '2026-27' },
    { admissionNo: 'MARKS-ABSENT', name: 'Absent Test Student', rollNo: '2', className: 'Class X', section: 'A', status: 'Active', academicSession: '2026-27' }];
  db.subjects = [{
    id: 'SBJ-MARKS-SYNC',
    name: 'Mathematics',
    code: 'MATH-SYNC',
    className: 'Class X',
    section: 'All Sections',
    examType: 'Half Yearly Exam',
    session: '2026-27',
    maxMarks: 100,
    passMarks: 33,
    teacherId: teacher.empId
  }];
  db.teacherAssignments = [{
    id: 'MARKS-ASSIGN',
    teacher_id: teacher.empId,
    class_name: 'X',
    section: 'All Sections',
    subject_name: 'Mathematics',
    academic_session: '2026-27'
  }];
  db.exams = [];
  db.examResults = [];
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();

  const teacherLogin = await request('/api/teacher/login', {
    method: 'POST',
    body: JSON.stringify({ username: teacher.empId, password })
  });
  assert(teacherLogin.response.ok && teacherLogin.data.token, 'teacher login');
  const teacherToken = teacherLogin.data.token;

  const payload = score => ({
    exam_id: 'half-yearly',
    examName: 'Half-Yearly',
    subject_id: 'SBJ-MARKS-SYNC',
    subject: 'Mathematics',
    class_id: 'X',
    className: 'X',
    section_id: 'All Sections',
    section: 'All Sections',
    academic_session: '2026/27',
    status: 'Submitted',
    teacherId: teacher.empId,
    marks: [{
      studentId: 'MARKS-001',
      name: 'Marks Test Student',
      rollNo: '1',
      marksObtained: score,
      maxMarks: 100,
      passMarks: 33,
      attendanceStatus: 'Present',
      isAbsent: false,
      resultStatus: score >= 33 ? 'PASS' : 'FAIL',
      remarks: 'Teacher entry'
    }, {
      studentId: 'MARKS-ABSENT', name: 'Absent Test Student', rollNo: '2', marksObtained: null,
      maxMarks: 100, passMarks: 33, attendanceStatus: 'Absent', isAbsent: true,
      grade: 'ABSENT', resultStatus: 'ABSENT', remarks: 'Medical leave'
    }]
  });

  const first = await request('/api/exams', { method: 'POST', body: JSON.stringify(payload(71)) }, teacherToken);
  assert(first.response.ok && first.data.message === 'Exam marks submitted successfully.', 'teacher submission reports real success');
  const second = await request('/api/exams', { method: 'POST', body: JSON.stringify(payload(84)) }, teacherToken);
  assert(second.response.ok, 'teacher can update the same result');

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
  });
  assert(adminLogin.response.ok && adminLogin.data.token, 'admin login');
  const adminToken = adminLogin.data.token;

  const filters = new URLSearchParams({
    examName: 'Half Yearly Exam',
    className: 'Class X',
    section: 'A',
    subjectId: 'SBJ-MARKS-SYNC',
    session: '2026-27'
  });
  const flat = await request(`/api/exam-results?${filters}`, {}, adminToken);
  assert(flat.response.ok && flat.data.length === 2, 'central result upsert prevents duplicates for the complete roster');
  const result = flat.data.find(row => row.student_id === 'MARKS-001');
  const absentResult = flat.data.find(row => row.student_id === 'MARKS-ABSENT');
  assert(result.marks_obtained === 84, 'latest teacher marks are visible to Admin');
  assert(result.student_id === 'MARKS-001' && result.subject_id === 'SBJ-MARKS-SYNC', 'stable student and subject IDs persist');
  assert(result.class_id === 'Class X' && result.section_id === 'A', 'All Sections submission persists each student’s real section');
  assert(result.exam_id === 'half-yearly' && result.academic_session === '2026-27', 'exam and session identity persist');
  assert(result.teacher_id === teacher.empId && result.entered_by_role === 'teacher' && result.entered_by_id === teacher.empId, 'teacher source audit fields persist');
  assert(result.maximum_marks === 100 && result.pass_marks === 33 && result.attendance_status === 'Present' && result.remarks === 'Teacher entry', 'marks, thresholds, attendance, and remarks persist');
  assert(absentResult.marks_obtained === null && absentResult.attendance_status === 'Absent' && absentResult.grade === 'ABSENT' && absentResult.result_status === 'ABSENT' && absentResult.remarks === 'Medical leave', 'absent result persists null marks and ABSENT metadata');
  assert(result.created_at && result.updated_at && result.created_at !== result.updated_at, 'upsert preserves created time and updates modified time');

  const grouped = await request(`/api/exams?name=${encodeURIComponent('Half Yearly Exam')}&className=Class%20X&section=A&subject=Mathematics&session=2026-27`, {}, adminToken);
  assert(grouped.response.ok && grouped.data.length === 1, 'Admin Score Sheet reads the central result source');
  assert(grouped.data[0].marks.find(row => row.studentId === 'MARKS-001').marksObtained === 84, 'Admin Score Sheet contains updated teacher mark');
  assert(grouped.data[0].marks.find(row => row.studentId === 'MARKS-ABSENT').marksObtained === null && grouped.data[0].marks.find(row => row.studentId === 'MARKS-ABSENT').attendanceStatus === 'Absent', 'Admin Score Sheet contains the synchronized absent result');

  const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8')).examResults;
  assert(persisted.length === 2 && persisted.find(row => row.student_id === 'MARKS-001').marks_obtained === 84 && persisted.find(row => row.student_id === 'MARKS-ABSENT').marks_obtained === null, 'central database results persist across requests');

  const adminEditPayload = payload(84);
  adminEditPayload.teacherId = 'spoofed-teacher';
  adminEditPayload.marks[1] = { ...adminEditPayload.marks[1], marksObtained: 55, score: 55, attendanceStatus: 'Present', isAbsent: false, grade: 'C', resultStatus: 'PASS', remarks: 'Updated by Admin' };
  const adminEdit = await request('/api/exams', { method: 'POST', body: JSON.stringify(adminEditPayload) }, adminToken);
  assert(adminEdit.response.ok, 'Admin can update the same central result');
  const teacherReload = await request(`/api/exam-results?${filters}`, {}, teacherToken);
  const teacherVisibleEdit = teacherReload.data.find(row => row.student_id === 'MARKS-ABSENT');
  assert(teacherVisibleEdit.marks_obtained === 55 && teacherVisibleEdit.attendance_status === 'Present' && teacherVisibleEdit.remarks === 'Updated by Admin', 'Teacher reload sees the Admin update from the shared source');

  const teacherHtml = fs.readFileSync(path.join(root, 'public', 'teacher', 'index.html'), 'utf8');
  const teacherJs = fs.readFileSync(path.join(root, 'public', 'js', 'teacher-dashboard.js'), 'utf8');
  assert(teacherHtml.includes('data-marks') === false && teacherHtml.includes('>Absent</th>') && teacherHtml.includes('>Remarks</th>'), 'Teacher marks table exposes Absent, Result, and Remarks columns');
  assert(teacherJs.includes("attendanceStatus: absent ? 'Absent' : 'Present'") && teacherJs.includes('marksObtained = absent ? null') && teacherJs.includes('/api/exam-results?'), 'Teacher UI saves null absent marks and reloads the central result source');
  assert(teacherJs.includes('isExamMarksSaving') && teacherJs.includes('Failed to save exam marks:'), 'Teacher UI prevents duplicate clicks and surfaces real save errors');

  const denied = await request('/api/exams', {
    method: 'POST',
    body: JSON.stringify({ ...payload(90), className: 'Class IX', class_id: 'Class IX' })
  }, teacherToken);
  assert(denied.response.status === 400 || denied.response.status === 403, 'unassigned class marks are rejected');
}

run()
  .then(() => console.log('EXAM MARKS SYNCHRONIZATION TESTS PASSED'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
    fs.writeFileSync(dbPath, originalDb);
  });
