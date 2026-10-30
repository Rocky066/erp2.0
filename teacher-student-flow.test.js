const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3102;
const base = `http://127.0.0.1:${port}`;
const password = 'RosterTest@123';
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

function fixtureStudent(id, name, className, section, status = 'Active', session = '2026-27') {
  return {
    admissionNo: id,
    name,
    rollNo: id.slice(-2),
    fatherName: `${name} Father`,
    gender: 'Male',
    mobile: '9000000000',
    className,
    section,
    status,
    academicSession: session
  };
}

async function run() {
  const db = JSON.parse(originalDb.toString('utf8'));
  const teacher = db.teachers[0];
  const otherTeacher = db.teachers[1];
  assert(teacher && otherTeacher, 'teacher fixtures exist');

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

  db.students = [
    fixtureStudent('FLOW-001', 'Class Five A', 'Class V', 'A'),
    fixtureStudent('FLOW-002', 'Class Four B', 'Class IV', 'Section B'),
    fixtureStudent('FLOW-003', 'Class Eight A', 'Class VIII', 'A'),
    fixtureStudent('FLOW-004', 'LKG A', 'LKG', 'A'),
    fixtureStudent('FLOW-005', 'LKG B', 'LKG', 'B'),
    fixtureStudent('FLOW-006', 'Inactive LKG', 'LKG', 'A', 'Inactive'),
    fixtureStudent('FLOW-007', 'Past Session LKG', 'LKG', 'A', 'Active', '2025-26'),
    fixtureStudent('FLOW-008', 'Unassigned Class', 'Class X', 'A')
  ];
  db.teacherAssignments = [
    { id: 'FLOW-A1', teacher_id: teacher.empId, class_name: 'Class V', section: 'Section A', subject_name: 'Mathematics', academic_session: '2026-27' },
    { id: 'FLOW-A2', teacher_id: teacher.empId, class_name: 'Class IV', section: 'B', subject_name: 'English', academic_session: '2026-27' },
    { id: 'FLOW-A3', teacher_id: teacher.empId, class_name: 'Class VIII', section: 'A', subject_name: 'Science', academic_session: '2026-27' },
    { id: 'FLOW-A4', teacher_id: teacher.empId, class_name: 'LKG||Sections', section: 'All Sections', subject_name: 'Assamese', academic_session: '2026-27' },
    { id: 'FLOW-A5', teacher_id: teacher.empId, class_name: 'Class V', section: 'A', subject_name: 'English', academic_session: '2026-27' },
    { id: 'FLOW-OTHER', teacher_id: otherTeacher.empId, class_name: 'Class X', section: 'A', subject_name: 'Mathematics', academic_session: '2026-27' }
  ];
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();

  const login = await request('/api/teacher/login', {
    method: 'POST',
    body: JSON.stringify({ username: teacher.empId, password })
  });
  assert(login.response.ok && login.data.token, 'teacher login token');
  const token = login.data.token;

  const profile = await request('/api/teacher/profile', {}, token);
  assert(profile.response.ok && profile.data.empId === teacher.empId, 'teacher identity from token');
  assert(profile.data.classContexts.length === 4, 'multiple subject rows collapse to four unique class/section contexts');
  assert(profile.data.classContexts.some(item => item.class_name === 'LKG' && item.section === 'All Sections'), 'malformed LKG class and all-sections assignment normalize correctly');
  assert(!JSON.stringify(profile.data.classContexts).includes('||'), 'invalid separators are removed');

  async function roster(className, section) {
    const query = new URLSearchParams({ className, section, academic_session: '2026-27' });
    return request(`/api/teacher/students?${query}`, {}, token);
  }

  const classV = await roster('Class V', 'A');
  assert(classV.response.ok && classV.data.students.map(item => item.admissionNo).join(',') === 'FLOW-001', 'Class V Section A roster is exact');

  const classIV = await roster('Class IV', 'Section B');
  assert(classIV.response.ok && classIV.data.students.map(item => item.admissionNo).join(',') === 'FLOW-002', 'Section B and B normalize to the same section');

  const classVIII = await roster('Class VIII', 'A');
  assert(classVIII.response.ok && classVIII.data.students.map(item => item.admissionNo).join(',') === 'FLOW-003', 'teacher can switch to another assigned class');

  const lkg = await roster('LKG', 'All Sections');
  assert(lkg.response.ok && lkg.data.students.map(item => item.admissionNo).join(',') === 'FLOW-004,FLOW-005', 'All Sections loads every active current-session section');
  assert(!lkg.data.students.some(item => ['FLOW-006', 'FLOW-007'].includes(item.admissionNo)), 'inactive and past-session students are excluded');

  const unassigned = await roster('Class X', 'A');
  assert(unassigned.response.status === 403, 'unassigned class students are denied');

  const attendanceDate = '2026-07-28';
  const attendance = await request('/api/attendance', {
    method: 'POST',
    body: JSON.stringify({
      date: attendanceDate,
      className: 'LKG',
      section: 'All Sections',
      records: lkg.data.students.map(student => ({
        studentId: student.admissionNo,
        status: 'Present',
        remark: ''
      }))
    })
  }, token);
  assert(
    attendance.response.ok &&
    attendance.data.upserted === lkg.data.students.length &&
    attendance.data.attendance.reduce((total, group) => total + group.records.length, 0) === lkg.data.students.length,
    'attendance saves the same assigned students shown in the roster'
  );

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'admin@garumarajatiyavidyalaya.in',
      password: 'Admin@123'
    })
  });
  assert(adminLogin.response.ok && adminLogin.data.token, 'admin authentication for attendance review');
  const adminToken = adminLogin.data.token;
  const initialDashboard = await request(
    `/api/dashboard/overview?academic_session=2026%2F27&date_from=${attendanceDate}&date_to=${attendanceDate}`,
    {},
    adminToken
  );
  assert(
    initialDashboard.response.ok &&
    initialDashboard.data.metrics.attendanceRecorded === true &&
    initialDashboard.data.metrics.presentToday === 2 &&
    initialDashboard.data.metrics.absentToday === 0 &&
    initialDashboard.data.metrics.lateToday === 0 &&
    initialDashboard.data.metrics.totalAttendanceRecords === 2 &&
    initialDashboard.data.metrics.studentAttendanceToday === 100,
    'dashboard calculates saved teacher attendance from central rows'
  );
  const adminSectionA = await request(
    `/api/attendance?date=${attendanceDate}&className=LKG&section=A`,
    {},
    adminToken
  );
  assert(
    adminSectionA.response.ok &&
    adminSectionA.data[0].records.some(record => record.student_id === 'FLOW-004') &&
    adminSectionA.data[0].submittedBy,
    'admin immediately sees teacher-submitted Section A attendance and marker'
  );
  const adminSectionB = await request(
    `/api/attendance?date=${attendanceDate}&className=LKG&section=Section%20B`,
    {},
    adminToken
  );
  assert(
    adminSectionB.response.ok &&
    adminSectionB.data[0].records.some(record => record.student_id === 'FLOW-005'),
    'admin resolves All Sections teacher submission into the stored student section'
  );

  const attendanceUpdate = await request('/api/attendance', {
    method: 'POST',
    body: JSON.stringify({
      date: attendanceDate,
      className: 'LKG',
      section: 'All Sections',
      academic_session: '2026-27',
      records: [{ student_id: 'FLOW-004', status: 'Absent', remarks: 'Updated once' }]
    })
  }, token);
  assert(
    attendanceUpdate.response.ok && attendanceUpdate.data.upserted === 1,
    'teacher attendance update uses upsert'
  );

  const adminEdit = await request('/api/attendance', {
    method: 'POST',
    body: JSON.stringify({
      date: attendanceDate,
      className: 'LKG',
      section: 'B',
      academic_session: '2026-27',
      records: [{ student_id: 'FLOW-005', status: 'Half Day', remarks: 'Reviewed by admin' }]
    })
  }, adminToken);
  assert(adminEdit.response.ok && adminEdit.data.upserted === 1, 'admin can review and edit teacher-submitted attendance');

  const updatedDashboard = await request(
    `/api/dashboard/overview?academic_session=2026-27&date_from=${attendanceDate}&date_to=${attendanceDate}`,
    {},
    adminToken
  );
  assert(
    updatedDashboard.response.ok &&
    updatedDashboard.data.metrics.presentToday === 0 &&
    updatedDashboard.data.metrics.absentToday === 1 &&
    updatedDashboard.data.metrics.halfDayToday === 1 &&
    updatedDashboard.data.metrics.totalAttendanceRecords === 2 &&
    updatedDashboard.data.metrics.studentAttendanceToday === 25,
    'dashboard recalculates after teacher and admin attendance upserts'
  );

  const emptyDashboard = await request(
    '/api/dashboard/overview?academic_session=2026-27&date_from=2099-01-01&date_to=2099-01-01',
    {},
    adminToken
  );
  assert(
    emptyDashboard.response.ok &&
    emptyDashboard.data.metrics.attendanceRecorded === false &&
    emptyDashboard.data.metrics.studentAttendanceToday === null &&
    emptyDashboard.data.metrics.totalAttendanceRecords === 0,
    'dashboard distinguishes no attendance from a real zero percent'
  );

  const injectedStudent = await request('/api/attendance', {
    method: 'POST',
    body: JSON.stringify({
      date: attendanceDate,
      className: 'LKG',
      section: 'All Sections',
      records: [{ studentId: 'FLOW-008', status: 'Present', remark: '' }]
    })
  }, token);
  assert(injectedStudent.response.status === 403, 'attendance rejects an unassigned student');

  const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const savedRows = persisted.studentAttendance.filter(item =>
    item.attendance_date === attendanceDate &&
    item.class_id === 'LKG' &&
    ['FLOW-004', 'FLOW-005'].includes(item.student_id)
  );
  assert(savedRows.length === 2, 'attendance database persistence');
  assert(savedRows.find(item => item.student_id === 'FLOW-004').status === 'Absent', 'student/date upsert updates without creating a duplicate');
  assert(
    savedRows.find(item => item.student_id === 'FLOW-005').status === 'Half Day' &&
    savedRows.find(item => item.student_id === 'FLOW-005').marked_by === 'admin@garumarajatiyavidyalaya.in',
    'admin edit updates status and marked-by audit field'
  );
  assert(savedRows.every(item =>
    item.academic_session === '2026-27' &&
    item.marked_by
  ), 'central attendance rows contain teacher, session, and audit fields');
  assert(savedRows.find(item => item.student_id === 'FLOW-004').teacher_id === teacher.empId, 'teacher marker ID remains on teacher upsert');
}

run()
  .then(() => console.log('TEACHER STUDENT FLOW TESTS PASSED'))
  .catch(error => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
    fs.writeFileSync(dbPath, originalDb);
  });
