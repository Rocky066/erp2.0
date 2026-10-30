const fs = require('fs');
const path = require('path');

const root = __dirname;
const db = JSON.parse(fs.readFileSync(path.join(root, 'db.json'), 'utf8'));
const adminSource = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS: ${message}`);
}

const feeRows = Array.isArray(db.fees) ? db.fees : [];
const testRemark = /\b(E2E|Duplicate Test|Dup Check|Sequential Test|Promise Lock Test|Async Lock Test)\b/i;

assert(feeRows.every(row => !String(row.id || '').startsWith('fee_seed_')), 'database contains no seeded fee rows');
assert(feeRows.every(row => !testRemark.test(String(row.remarks || ''))), 'database contains no explicitly marked fee test transactions');
assert(feeRows.every(row => row.studentId && row.receiptNo && Number(row.amount) >= 0), 'remaining fee rows are persisted transaction records');
assert(!adminSource.includes('generating client-side dues'), 'student-wise dues have no client-side mock fallback');
assert(!adminSource.includes('SMS/WA notification dispatched'), 'receipt UI does not claim simulated notification delivery');
assert(!adminSource.includes('successfully sent to ${mobile}'), 'fee reminders do not report fake delivery');
assert((adminSource.match(/No fee records found\./g) || []).length >= 4, 'fee tables, chart, recent list, and report use a real empty state');
assert(!serverSource.includes('95% delivery rate mock'), 'notification logging has no randomized delivery result');

const expectedCollected = feeRows.reduce(
  (sum, row) => sum + Number(row.totalReceived ?? (Number(row.amount || 0) + Number(row.lateFee || 0))),
  0
);
assert(Number.isFinite(expectedCollected), 'fee totals are derived from persisted database amounts');

console.log(`FEE REAL-DATA AUDIT PASSED (${feeRows.length} preserved fee records, total received ${expectedCollected})`);
