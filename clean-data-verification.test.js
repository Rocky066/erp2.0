const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runCleanDataVerificationTests() {
  console.log('--- RUNNING CLEAN DATA VERIFICATION TESTS ---');

  const dbPath = path.join(__dirname, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  const deletedStudentIds = [
    'GJV-2026-0003',
    'GJV-2026-0004',
    'GJV-2026-0005',
    'GJV-2026-0006',
    'GJV-2026-0007',
    'GJV-2026-0010',
    'GJV-2026-0014'
  ];

  // Test 1: Verify student count and deleted students absence
  console.log('Test 1: Verifying student records...');
  assert.strictEqual(db.students.length, 12, `Expected 12 preserved students, found ${db.students.length}`);
  deletedStudentIds.forEach(id => {
    const found = db.students.find(s => (s.admissionNo || s.admission_number || s.studentId || s.id) === id);
    assert(!found, `Deleted test student ${id} must not exist in db.students`);
  });
  console.log('✓ Test 1 Passed: 12 real students preserved, 0 test students remaining');

  // Test 2: Verify fees records integrity
  console.log('Test 2: Verifying fee records...');
  assert.strictEqual(db.fees.length, 17, `Expected 17 preserved fees, found ${db.fees.length}`);
  db.fees.forEach(f => {
    const sid = f.studentId || f.student_id || f.admissionNo || f.admission_number;
    assert(!deletedStudentIds.includes(sid), `Fee record ${f.id || f.receiptNo} contains deleted student ID ${sid}`);
  });
  console.log('✓ Test 2 Passed: 17 real fee records preserved');

  // Test 3: Verify exam results integrity
  console.log('Test 3: Verifying exam result records...');
  assert.strictEqual(db.examResults.length, 21, `Expected 21 preserved exam results, found ${db.examResults.length}`);
  db.examResults.forEach(r => {
    const sid = r.studentId || r.student_id || r.admissionNo || r.admission_number;
    assert(!deletedStudentIds.includes(sid), `Exam result ${r.id} contains deleted student ID ${sid}`);
  });
  console.log('✓ Test 3 Passed: 21 real exam result records preserved');

  // Test 4: Verify student attendance integrity
  console.log('Test 4: Verifying student attendance records...');
  assert.strictEqual(db.studentAttendance.length, 25, `Expected 25 preserved student attendance entries, found ${db.studentAttendance.length}`);
  db.studentAttendance.forEach(a => {
    const sid = a.studentId || a.student_id || a.admissionNo || a.admission_number;
    assert(!deletedStudentIds.includes(sid), `Attendance entry ${a.id} contains deleted student ID ${sid}`);
  });
  console.log('✓ Test 4 Passed: 25 real attendance records preserved');

  // Test 5: Verify teachers count
  console.log('Test 5: Verifying teacher records...');
  assert.strictEqual(db.teachers.length, 5, `Expected 5 preserved teachers, found ${db.teachers.length}`);
  const deletedTeacher = db.teachers.find(t => t.id === 'tch_2');
  assert(!deletedTeacher, 'Deleted teacher tch_2 must not exist in db.teachers');
  console.log('✓ Test 5 Passed: 5 real teachers preserved');

  // Test 6: Verify WhatsApp logs
  console.log('Test 6: Verifying WhatsApp logs...');
  assert.strictEqual(db.whatsappMessageLogs.length, 0, 'WhatsApp message logs should be cleared of test pings');
  console.log('✓ Test 6 Passed: Test WhatsApp logs cleared');

  // Test 7: Verify dummy signature files deleted
  console.log('Test 7: Verifying dummy test signature files...');
  const file1 = path.join(__dirname, 'public', 'uploads', 'admit-card-signatures', 'principal-signature-5978bba8-3a91-4e6e-87cb-c0e87d53d27e.png');
  const file2 = path.join(__dirname, 'public', 'uploads', 'admit-card-signatures', 'principal-signature-eba56792-6bf6-4abe-8f6a-20168ff0d3ab.png');
  assert(!fs.existsSync(file1), 'Dummy signature file 1 should be removed');
  assert(!fs.existsSync(file2), 'Dummy signature file 2 should be removed');
  console.log('✓ Test 7 Passed: Dummy test signature files removed');

  console.log('\nALL CLEAN DATA VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runCleanDataVerificationTests();
