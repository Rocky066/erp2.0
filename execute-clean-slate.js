const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbPath)) {
  console.error('CRITICAL: db.json not found!');
  process.exit(1);
}

// 1. CREATE SAFETY BACKUP
const backupTimestamp = Date.now();
const backupFileName = `db_backup_clean_slate_${backupTimestamp}.json`;
const backupPath = path.join(__dirname, backupFileName);
const fixedBackupPath = path.join(__dirname, 'db_backup_pre_clean_slate.json');

const rawDb = fs.readFileSync(dbPath, 'utf8');
fs.writeFileSync(backupPath, rawDb, 'utf8');
fs.writeFileSync(fixedBackupPath, rawDb, 'utf8');
console.log(`✅ Backup created successfully at:\n  - ${backupFileName}\n  - db_backup_pre_clean_slate.json`);

const db = JSON.parse(rawDb);

// 2. RECORD AUDIT BEFORE PURGE
const beforeAudit = {
  students: (db.students || []).length,
  teachers: (db.teachers || []).length,
  attendance: (db.attendance || []).length,
  studentAttendance: (db.studentAttendance || []).length,
  fees: (db.fees || []).length,
  legacyFeeDues: (db.legacyFeeDues || []).length,
  feeAuditLogs: (db.feeAuditLogs || []).length,
  admissionApplications: (db.admissionApplications || []).length,
  exams: (db.exams || []).length,
  examResults: (db.examResults || []).length,
  teacherAssignments: (db.teacherAssignments || []).length,
  teacherAttendance: (db.teacherAttendance || []).length,
  teacherSalaries: (db.teacherSalaries || []).length,
  teacherLeaves: (db.teacherLeaves || []).length,
  teacherAuditLogs: (db.teacherAuditLogs || []).length,
  teacherLogin: (db.teacherLogin || []).length,
  teacherLoginSessions: (db.teacherLoginSessions || []).length,
  teacherActivityLogs: (db.teacherActivityLogs || []).length,
  notifications: (db.notifications || []).length,
  whatsappMessageLogs: (db.whatsappMessageLogs || []).length
};

const totalDemoRecordsRemoved = Object.values(beforeAudit).reduce((sum, c) => sum + c, 0);

console.log('\n--- OPERATIONAL DEMO DATA AUDIT BEFORE PURGE ---');
console.table(beforeAudit);
console.log(`Total demo operational records to purge: ${totalDemoRecordsRemoved}`);

// 3. EXECUTE SAFE PURGE OF DEMO OPERATIONAL COLLECTIONS
db.students = [];
db.attendance = [];
db.studentAttendance = [];
db.fees = [];
db.legacyFeeDues = [];
db.feeAuditLogs = [];
db.admissionApplications = [];
db.exams = [];
db.examResults = [];

db.teachers = [];
db.teacherLogin = [];
db.teacherAssignments = [];
db.teacherAttendance = [];
db.teacherSalaries = [];
db.teacherLeaves = [];
db.teacherAuditLogs = [];
db.teacherLoginSessions = [];
db.teacherActivityLogs = [];

db.notifications = [];
db.whatsappMessageLogs = [];

// 4. WRITE UPDATED DB
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('\n✅ db.json updated with 100% clean operational state.');

// 5. POST-PURGE VERIFICATION
const afterAudit = {
  students: db.students.length,
  teachers: db.teachers.length,
  attendance: db.attendance.length,
  studentAttendance: db.studentAttendance.length,
  fees: db.fees.length,
  legacyFeeDues: db.legacyFeeDues.length,
  feeAuditLogs: db.feeAuditLogs.length,
  admissionApplications: db.admissionApplications.length,
  exams: db.exams.length,
  examResults: db.examResults.length,
  teacherAssignments: db.teacherAssignments.length,
  teacherAttendance: db.teacherAttendance.length,
  teacherSalaries: db.teacherSalaries.length,
  teacherLeaves: db.teacherLeaves.length,
  teacherAuditLogs: db.teacherAuditLogs.length,
  teacherLogin: db.teacherLogin.length,
  teacherLoginSessions: db.teacherLoginSessions.length,
  teacherActivityLogs: db.teacherActivityLogs.length,
  notifications: db.notifications.length,
  whatsappMessageLogs: db.whatsappMessageLogs.length
};

console.log('\n--- OPERATIONAL DATA AUDIT AFTER PURGE ---');
console.table(afterAudit);

// Verify Configuration Preserved
const configPreserved = {
  schoolProfile: !!db.settings,
  principalLeadership: (db.leadership || []).length,
  academicSessions: (db.academicSessions || []).length,
  subjects: (db.subjects || []).length,
  feeStructures: Object.keys(db.feeStructures || {}).length,
  feeStructuresBySession: Object.keys(db.feeStructuresBySession || {}).length,
  teacherPermissions: Object.keys(db.teacherPermissions || {}).length,
  notices: (db.notices || []).length,
  gallery: (db.gallery || []).length
};

console.log('\n--- SYSTEM CONFIGURATION PRESERVED ---');
console.table(configPreserved);

// Assertion Checks
let allClean = true;
for (const [key, count] of Object.entries(afterAudit)) {
  if (count !== 0) {
    console.error(`❌ FAILURE: ${key} still contains ${count} records!`);
    allClean = false;
  }
}

if (!allClean) {
  console.error('\n❌ Purge verification failed!');
  process.exit(1);
} else {
  console.log('\n🎉 CLEAN SLATE VERIFICATION PASSED: All operational collections are strictly 0.');
}
