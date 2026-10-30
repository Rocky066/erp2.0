const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const originalDb = fs.readFileSync(dbPath);
const port = 3104;
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
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { response, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Fee test server did not start.');
}

async function run() {
  const db = JSON.parse(originalDb.toString('utf8'));
  db.students = [{
    id: 'INTERNAL-FEE-1',
    admissionNo: 'FEE-001',
    studentId: 'STUDENT-ALIAS-001',
    name: 'Fee Test Student',
    className: 'Class I',
    section: 'Section A',
    rollNo: '1',
    mobile: '9000000001',
    status: 'Active',
    academicSession: '2026/27'
  }];
  db.feeStructures = {
    'Class I': {
      admissionFee: 4000,
      tuitionFee: 1000,
      examFee: 300,
      annualFee: 800,
      developmentFee: 400,
      libraryFee: 200,
      computerFee: 250,
      transportFee: 600
    }
  };
  db.fees = [];
  db.feeAuditLogs = [];
  db.settings.feePermissions = { allowDelete: true };
  db.feeStructuresBySession = { '2026-27': JSON.parse(JSON.stringify(db.feeStructures)) };
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin@garumarajatiyavidyalaya.in', password: 'Admin@123' })
  });
  assert(login.response.ok && login.data.token, 'admin login for fee collection');
  const token = login.data.token;

  const profile = await request('/api/fees/student-profile?studentId=student-alias-001&session=2026-27&month=2026-07&type=Monthly%20Tuition%20Fee', {}, token);
  assert(profile.response.ok && profile.data.student.student_id === 'FEE-001', 'student profile resolves Student ID alias to admission number');
  assert(profile.data.student.class_id === 'Class I' && profile.data.student.section_id === 'A', 'student class and section normalize');
  assert(profile.data.invoice.expectedAmount === 1000 && profile.data.invoice.remainingBalance === 1000, 'central fee structure loads the monthly fee');

  const categories = [
    ['Admission Fee', 4000],
    ['Examination Fee', 300],
    ['Transport Fee', 600]
  ];
  for (const [type, expected] of categories) {
    const category = await request(`/api/fees/student-profile?studentId=FEE-001&session=2026-27&month=2026-07&type=${encodeURIComponent(type)}`, {}, token);
    assert(category.response.ok && category.data.invoice.expectedAmount === expected, `${type} loads from the central structure`);
  }

  const partialPayload = {
    studentId: 'FEE-001',
    session: '2026/27',
    month: '2026-07',
    type: 'Monthly Tuition Fee',
    amount: 400,
    lateFee: 50,
    discountAmount: 100,
    scholarshipAmount: 100,
    paymentMode: 'UPI',
    referenceNo: 'UPI-FEE-001-A',
    remarks: 'Partial payment',
    idempotencyKey: crypto.randomUUID()
  };
  const partial = await request('/api/fees', { method: 'POST', body: JSON.stringify(partialPayload) }, token);
  assert(partial.response.status === 201, 'partial payment saves successfully');
  assert(partial.data.dueBalance === 400 && partial.data.paymentStatus === 'Partially Paid', 'discount, scholarship, fine, and remaining balance calculate correctly');
  assert(partial.data.totalReceived === 450 && partial.data.receiptNo.startsWith('REC-'), 'receipt number and received amount are generated');

  const afterPartial = await request('/api/fees/student-profile?studentId=FEE-001&session=2026-27&month=2026-07&type=Monthly%20Tuition%20Fee', {}, token);
  assert(afterPartial.data.invoice.paidAmount === 400 && afterPartial.data.invoice.remainingBalance === 400, 'student ledger profile reflects partial payment');

  const duplicate = await request('/api/fees', { method: 'POST', body: JSON.stringify(partialPayload) }, token);
  assert(duplicate.response.status === 409, 'idempotency key prevents a duplicate payment');

  const full = await request('/api/fees', {
    method: 'POST',
    body: JSON.stringify({
      ...partialPayload,
      amount: 400,
      lateFee: 0,
      referenceNo: 'UPI-FEE-001-B',
      remarks: 'Full balance payment',
      idempotencyKey: crypto.randomUUID()
    })
  }, token);
  assert(full.response.status === 201 && full.data.dueBalance === 0 && full.data.paymentStatus === 'Paid', 'full remaining balance completes the invoice');
  assert(full.data.receiptNo !== partial.data.receiptNo, 'automatic receipt numbers are unique');

  const ledger = await request('/api/fees?studentId=FEE-001&session=2026%2F27', {}, token);
  assert(ledger.response.ok && ledger.data.length === 2, 'student ledger and payment history use persisted records');

  const edit = await request('/api/fees', {
    method: 'PUT',
    body: JSON.stringify({ id: full.data.id, amount: 300, remarks: 'Corrected by accounts' })
  }, token);
  assert(edit.response.ok && edit.data.dueBalance === 100 && edit.data.paymentStatus === 'Partially Paid', 'payment edit recalculates the invoice balance');

  const afterEdit = await request('/api/fees/student-profile?studentId=FEE-001&session=2026-27&month=2026-07&type=Monthly%20Tuition%20Fee', {}, token);
  assert(afterEdit.data.invoice.remainingBalance === 100, 'student fee profile refreshes after edit');

  const dashboard = await request('/api/fees/dashboard-stats', {}, token);
  assert(dashboard.response.ok && dashboard.data.totalTransactions === 2 && dashboard.data.totalCollected === 750, 'fee dashboard updates from database transactions including fine');

  const deleted = await request(`/api/fees?id=${encodeURIComponent(partial.data.id)}&receiptNo=${encodeURIComponent(partial.data.receiptNo)}`, { method: 'DELETE' }, token);
  assert(deleted.response.ok, 'permission-enabled payment deletion succeeds');
  const afterDelete = await request('/api/fees/student-profile?studentId=FEE-001&session=2026-27&month=2026-07&type=Monthly%20Tuition%20Fee', {}, token);
  assert(afterDelete.data.ledger.length === 1 && afterDelete.data.invoice.remainingBalance === 500, 'delete refreshes ledger and due amount');

  const audit = await request('/api/fees/audit-log', {}, token);
  assert(audit.response.ok && audit.data.some(row => row.action === 'EDIT_FEE') && audit.data.some(row => row.action === 'REFUND_DELETE_FEE'), 'edit and delete operations create audit records');

  const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert(persisted.fees.length === 1 && persisted.fees[0].amount === 300, 'fee database CRUD persists correctly');

  persisted.settings = persisted.settings || {};
  persisted.settings.feePermissions = { ...(persisted.settings.feePermissions || {}), allowDelete: false };
  fs.writeFileSync(dbPath, JSON.stringify(persisted, null, 2));
  const forbiddenDelete = await request(
    `/api/fees?id=${encodeURIComponent(full.data.id)}&receiptNo=${encodeURIComponent(full.data.receiptNo)}`,
    { method: 'DELETE' },
    token
  );
  assert(forbiddenDelete.response.status === 403, 'payment deletion obeys the configured permission rule');
}

run()
  .then(() => console.log('FEE COLLECTION FLOW TESTS PASSED'))
  .catch(error => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
    fs.writeFileSync(dbPath, originalDb);
  });
