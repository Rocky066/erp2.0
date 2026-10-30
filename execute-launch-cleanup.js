const fs = require('fs');
const path = require('path');

const root = __dirname;
const dbPath = path.join(root, 'db.json');
const backupPath = path.join(root, `db_backup_pre_launch_${Date.now()}.json`);

console.log('=== SCHOOL MANAGEMENT SYSTEM - LAUNCH DATA CLEANUP ===');

// 1. Create safety backup
const rawDb = fs.readFileSync(dbPath, 'utf8');
fs.writeFileSync(backupPath, rawDb);
console.log(`[SAFETY BACKUP] Saved full pre-cleanup database backup to:\n  ${backupPath}`);

const db = JSON.parse(rawDb);

// 2. Perform test & demo data cleanup while preserving master configuration and real student data
const initialStats = {
  teachers: (db.teachers || []).length,
  teacherLogin: (db.teacherLogin || []).length,
  teacherAssignments: (db.teacherAssignments || []).length,
  teacherAttendance: (db.teacherAttendance || []).length,
  teacherSalaries: (db.teacherSalaries || []).length,
  teacherLeaves: (db.teacherLeaves || []).length,
  teacherAuditLogs: (db.teacherAuditLogs || []).length,
  teacherActivityLogs: (db.teacherActivityLogs || []).length,
  teacherLoginSessions: (db.teacherLoginSessions || []).length,
  notifications: (db.notifications || []).length,
  feeAuditLogs: (db.feeAuditLogs || []).length,
  whatsappMessageLogs: (db.whatsappMessageLogs || []).length
};

// Purge test teacher records & temporary test logs
db.teachers = [];
db.teacherLogin = [];
db.teacherAssignments = [];
db.teacherAttendance = [];
db.teacherSalaries = [];
db.teacherLeaves = [];
db.teacherAuditLogs = [];
db.teacherActivityLogs = [];
db.teacherLoginSessions = [];
db.teacherPermissions = {};
db.notifications = [];
db.feeAuditLogs = [];
db.whatsappMessageLogs = [];

// Clean test exams & exam results while retaining student fee & attendance history
db.exams = [];
db.examResults = [];

// 3. Write cleaned database to db.json
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

console.log('\n--- CLEANUP SUMMARY ---');
console.log(`- Teachers purged: ${initialStats.teachers} test records`);
console.log(`- Teacher Logins purged: ${initialStats.teacherLogin} accounts`);
console.log(`- Teacher Assignments purged: ${initialStats.teacherAssignments} workload rows`);
console.log(`- Teacher Attendance purged: ${initialStats.teacherAttendance} records`);
console.log(`- Teacher Salaries purged: ${initialStats.teacherSalaries} transactions`);
console.log(`- Teacher Leaves purged: ${initialStats.teacherLeaves} applications`);
console.log(`- Teacher Audit & Activity Logs purged: ${initialStats.teacherAuditLogs + initialStats.teacherActivityLogs + initialStats.teacherLoginSessions} logs`);
console.log(`- Notifications purged: ${initialStats.notifications} logs`);
console.log(`- Test Exams & Results purged: ${initialStats.feeAuditLogs} logs`);

console.log('\n--- PRESERVED MASTER CONFIGURATION ---');
console.log(`- School Name: ${db.settings?.websiteContent?.schoolName}`);
console.log(`- School Logo / Tagline: ${db.settings?.websiteContent?.tagline}`);
console.log(`- Principal Name: ${db.settings?.websiteContent?.principalName}`);
console.log(`- Admin Account: ${db.settings?.adminUsername}`);
console.log(`- Academic Sessions: ${(db.academicSessions || []).map(s => s.session_name).join(', ')}`);
console.log(`- Subjects Master: ${(db.subjects || []).length} subjects configured`);
console.log(`- Real Students Preserved: ${(db.students || []).length} students`);
console.log(`- Real Fee Receipts Preserved: ${(db.fees || []).length} receipts`);
console.log(`- Public Notices Preserved: ${(db.notices || []).length} notices`);

console.log('\n✅ Data cleanup executed successfully!');
