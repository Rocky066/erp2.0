const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3101;
const base = `http://127.0.0.1:${port}`;
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
  const data = await response.json();
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

async function run() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'admin@garumarajatiyavidyalaya.in',
      password: 'Admin@123'
    })
  });
  assert(login.response.ok && login.data.token, 'admin authentication');
  const token = login.data.token;

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const teacher = db.teachers.find(item => item.status !== 'Inactive') || db.teachers[0];
  const student = db.students.find(item => item.className === 'Class I') || db.students[0];
  assert(teacher && student, 'test fixtures exist');

  const filteredSubjectPayload = {
    name: 'Filtered Sync Subject',
    code: `FILTER-${Date.now()}`,
    className: 'X',
    section: 'Section A',
    examType: 'Half-Yearly',
    session: '2026-27',
    maxMarks: 70,
    passMarks: 25,
    teacherId: 'Unassigned'
  };
  const filteredSubject = await request('/api/subjects', {
    method: 'POST',
    body: JSON.stringify(filteredSubjectPayload)
  }, token);
  assert(
    filteredSubject.response.status === 201 &&
    filteredSubject.data.className === 'Class X' &&
    filteredSubject.data.section === 'A',
    'subject create normalizes class and section fields'
  );
  const filteredLookup = await request(
    '/api/subjects?className=Class%20X&section=A&examType=Half%20Yearly%20Exam&session=2026-27',
    {},
    token
  );
  assert(
    filteredLookup.response.ok &&
    filteredLookup.data.some(item => item.id === filteredSubject.data.id),
    'score-sheet subject API matches Class X, Section A, and Half Yearly aliases'
  );
  const allScopeLookup = await request(
    '/api/subjects?className=X&section=Section%20A&examType=Half-Yearly&session=2026-27',
    {},
    token
  );
  assert(
    allScopeLookup.data.some(item => item.className === 'All Classes' && item.examType === 'All Exams'),
    'All Classes and All Exams subjects remain available in filtered lookup'
  );

  const createPayload = {
    name: 'Audit Subject',
    code: `AUD-${Date.now()}`,
    className: student.className,
    section: student.section || 'A',
    examType: 'Unit Test',
    session: '2026-27',
    maxMarks: 80,
    passMarks: 24,
    teacherId: teacher.empId
  };
  const created = await request('/api/subjects', {
    method: 'POST',
    body: JSON.stringify(createPayload)
  }, token);
  assert(created.response.status === 201, 'create subject API');
  const subjectId = created.data.id;

  const afterCreate = await request(`/api/subjects/${encodeURIComponent(subjectId)}`, {}, token);
  assert(afterCreate.response.ok && afterCreate.data.maxMarks === 80, 'read subject API');

  const duplicate = await request('/api/subjects', {
    method: 'POST',
    body: JSON.stringify(createPayload)
  }, token);
  assert(duplicate.response.status === 409, 'duplicate subject validation');

  let persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert(persisted.teacherAssignments.some(item => item.subjectId === subjectId), 'teacher workload synchronization on create');
  assert(persisted.teachers.find(item => item.empId === teacher.empId).assignedSubjects.includes('Audit Subject'), 'teacher portal subject synchronization on create');

  const marks = [{
    studentId: student.admissionNo,
    admissionNo: student.admissionNo,
    name: student.name,
    marksObtained: 60,
    maxMarks: 100
  }];
  const exam = await request('/api/exams', {
    method: 'POST',
    body: JSON.stringify({
      examName: 'Unit Test',
      className: student.className,
      section: student.section || 'A',
      subject: 'Audit Subject',
      session: '2026-27',
      marks
    })
  }, token);
  assert(exam.response.ok && exam.data.marks[0].maxMarks === 80, 'marks entry uses subject maximum marks');

  const updated = await request(`/api/subjects/${encodeURIComponent(subjectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...createPayload, name: 'Audit Subject Renamed', maxMarks: 90, passMarks: 30 })
  }, token);
  assert(updated.response.ok && updated.data.name === 'Audit Subject Renamed', 'update subject API');

  persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert(persisted.exams.some(item => item.subject === 'Audit Subject Renamed'), 'exam/report-card synchronization on rename');
  assert(persisted.examResults.some(item => item.subject === 'Audit Subject Renamed'), 'result generation synchronization on rename');
  assert(persisted.teacherAssignments.some(item => item.subjectId === subjectId && item.subject_name === 'Audit Subject Renamed'), 'teacher workload synchronization on rename');
  assert(persisted.teachers.find(item => item.empId === teacher.empId).assignedSubjects.includes('Audit Subject Renamed'), 'teacher portal synchronization on rename');

  const deleted = await request(`/api/subjects/${encodeURIComponent(subjectId)}`, { method: 'DELETE' }, token);
  assert(deleted.response.ok && deleted.data.success, 'delete subject API');

  persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert(!persisted.subjects.some(item => item.id === subjectId), 'subject database delete');
  assert(!persisted.teacherAssignments.some(item => item.subjectId === subjectId), 'linked teacher workload cleanup');
  assert(persisted.exams.some(item => item.subject === 'Audit Subject Renamed'), 'historical report-card data preserved after delete');

  const missing = await request(`/api/subjects/${encodeURIComponent(subjectId)}`, {}, token);
  assert(missing.response.status === 404, 'deleted subject returns 404');
}

run()
  .then(() => console.log('SUBJECT AUDIT TESTS PASSED'))
  .catch(error => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
    fs.writeFileSync(dbPath, originalDb);
  });
