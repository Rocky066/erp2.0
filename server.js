const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dnsPromises = require('dns').promises;
const tls = require('tls');
const WhatsApp = require('./services/whatsappStore');
const MultiTenant = require('./services/multiTenant');
const Supabase = require('./services/supabase');
const {
  DEFAULT_SCHOOL_ID,
  DEFAULT_SCHOOL_CODE,
  SUPER_ADMIN_USERNAME,
  DEFAULT_SAAS_CONFIG,
  isSchoolTenantRequest,
  getTenantId,
  matchTenant,
  resolveRequestSchool,
  ensureMultiTenantSchema,
  ensureSchoolLeadership,
  generateAdmissionNo,
  createScopedBackup,
  isValidEmail,
  isValidPhone,
  isValidUrl,
  isValidSchoolCode,
  saveBrandingImage
} = MultiTenant;
function whatsappTemplateComponents(templateKey,values){return WhatsApp.buildTemplateComponents(templateKey,values)}
function queueWhatsAppAutomation(type,student,values,deduplicationKey){
  setImmediate(async()=>{try{const db=readDbRaw(),cfg=WhatsApp.config(db,getJwtSecret()),map={
    admission:{switch:'admissionConfirmation',template:'admission_confirmation'},
    fee:{switch:'feePaymentConfirmation',template:'fee_payment_confirmation'},
    absent:{switch:'absentAlert',template:'student_absent_alert'},
    due:{switch:'feeDueReminder',template:'fee_due_reminder'},
    overdue:{switch:'overdueReminder',template:'fee_overdue_reminder'}
  }[type];if(!map||!cfg.enabled||!cfg.automation[map.switch]||!cfg.templates[map.template])return;
  await WhatsApp.send(db,{mobileNumber:student.mobile,studentId:student.admissionNo||student.id,studentName:student.name,parentName:student.fatherName||'',messageType:type,templateKey:map.template,templateName:cfg.templates[map.template],languageCode:cfg.templateLanguages[map.template],components:whatsappTemplateComponents(map.template,values),deduplicationKey},getJwtSecret(),writeDbRaw,readDbRaw)}
  catch(error){console.error('WhatsApp automation failed safely:',String(error.message||error).slice(0,300))}})
}


const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.join(__dirname, 'db.json');
const BACKUPS_DIR = path.join(__dirname, 'backups');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const BRANDING_UPLOADS_DIR = path.join(UPLOADS_DIR, 'branding');
const ID_CARD_SIGNATURES_DIR = path.join(UPLOADS_DIR, 'id-card-signatures');
const ADMIT_CARD_SIGNATURES_DIR = path.join(UPLOADS_DIR, 'admit-card-signatures');
const MAX_ID_CARD_SIGNATURE_BYTES = 2 * 1024 * 1024;

// Prefer a deployment secret. The database-derived fallback is stable across
// server restarts, so valid logins are not randomly invalidated.
let JWT_SECRET = process.env.JWT_SECRET || '';

function getJwtSecret() {
  if (!JWT_SECRET) {
    const db = readDbRaw();
    const seed = `${db.settings.adminPasswordHash || ''}:${db.settings.adminPasswordSalt || ''}:GJV`;
    JWT_SECRET = crypto.createHash('sha256').update(seed).digest('hex');
  }
  return JWT_SECRET;
}

function safeTeacherRecord(teacher) {
  if (!teacher || typeof teacher !== 'object') return teacher;
  const safe = { ...teacher };
  delete safe.loginPassword;
  return safe;
}

function safeTeacherLoginRecord(loginAccount) {
  if (!loginAccount || typeof loginAccount !== 'object') return loginAccount;
  const safe = { ...loginAccount };
  delete safe.password_hash;
  delete safe.password_salt;
  delete safe.password_reset_token;
  delete safe.token_expiry;
  return safe;
}
// Ensure database and backup/upload directories exist
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ID_CARD_SIGNATURES_DIR)) fs.mkdirSync(ID_CARD_SIGNATURES_DIR, { recursive: true });
if (!fs.existsSync(ADMIT_CARD_SIGNATURES_DIR)) fs.mkdirSync(ADMIT_CARD_SIGNATURES_DIR, { recursive: true });
if (!fs.existsSync(BRANDING_UPLOADS_DIR)) fs.mkdirSync(BRANDING_UPLOADS_DIR, { recursive: true });

// Date formatting helpers for timezone-independent local matching
function getLocalDateStr(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalMonthStr(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function canonicalTeacherLeave(record, teachers) {
  const teacher = (teachers || []).find(t => String(t.id || '') === String(record.teacher_id || '') || String(t.empId || '') === String(record.employee_code || record.empId || ''));
  return {
    leave_request_id: record.leave_request_id || record.id,
    teacher_id: record.teacher_id || (teacher && teacher.id) || '',
    employee_code: record.employee_code || record.empId || (teacher && teacher.empId) || '',
    teacher_name: record.teacher_name || record.teacherName || (teacher && teacher.name) || 'Teacher',
    leave_type: record.leave_type || record.leaveType || '',
    from_date: record.from_date || record.fromDate || '',
    to_date: record.to_date || record.toDate || '',
    number_of_days: Number(record.number_of_days ?? record.days ?? 1),
    reason: record.reason || '',
    document_url: record.document_url || record.documentUrl || '',
    status: record.status || 'Pending',
    submitted_at: record.submitted_at || record.appliedOn || new Date().toISOString(),
    approved_by: record.approved_by || null,
    approved_at: record.approved_at || null,
    rejected_by: record.rejected_by || null,
    rejected_at: record.rejected_at || null,
    admin_remarks: record.admin_remarks || record.adminRemarks || '',
    rejection_reason: record.rejection_reason || '',
    updated_at: record.updated_at || record.processedOn || record.submitted_at || record.appliedOn || new Date().toISOString()
  };
}
function normalizeTeacherLeaveRecords(db) {
  db.teacherLeaves = (db.teacherLeaves || []).map(record => canonicalTeacherLeave(record, db.teachers || []));
  return db.teacherLeaves;
}
function updateTeacherLeaveBalance(teacher, leave, direction) {
  const days = Math.max(0, Number(leave.number_of_days || 0));
  const type = leave.leave_type || 'Other';
  teacher.leave_usage = teacher.leave_usage && typeof teacher.leave_usage === 'object' ? teacher.leave_usage : {};
  teacher.leave_usage[type] = Math.max(0, Number(teacher.leave_usage[type] || 0) + direction * days);
  if (teacher.leave_balance && Number.isFinite(Number(teacher.leave_balance[type]))) {
    teacher.leave_balance[type] = Math.max(0, Number(teacher.leave_balance[type]) - direction * days);
  }
}
function normalizeClassName(value) {
  let text = String(value || '')
    .replace(/\|\|.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/\s*[-–—]\s*(?:section\s*)?[A-Za-z]+\s*$/i, '').trim();
  if (!text) return '';
  if (/^lkg$/i.test(text)) return 'LKG';
  if (/^ukg$/i.test(text)) return 'UKG';
  const classMatch = text.match(/^(?:class\s*)?(.+)$/i);
  const suffix = String(classMatch?.[1] || '').trim().toUpperCase();
  return suffix ? `Class ${suffix}` : '';
}

function normalizeSectionName(value) {
  const text = String(value || '')
    .replace(/\|\|/g, ' ')
    .replace(/^sections?\s*/i, '')
    .replace(/^sec(?:tion)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || /^all(?:\s+sections?)?$/i.test(text)) return 'All Sections';
  return text.toUpperCase();
}

function normalizeSubjectClassName(value) {
  const text = String(value || '').replace(/\|\|.*$/g, '').trim();
  if (/^all(?:\s+classes?)?$/i.test(text)) return 'All Classes';
  return normalizeClassName(text);
}

function normalizeExamTypeKey(value) {
  const text = String(value || '')
    .replace(/[-–—_]+/g, ' ')
    .replace(/\bexams?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!text || text === 'all') return 'all';
  if (text === 'half yearly' || text === 'halfyearly') return 'half yearly';
  if (text === 'unit test' || text === 'unittest') return 'unit test';
  if (text === 'annual') return 'annual';
  return text;
}

function normalizeAttendanceDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : normalized;
}

function canonicalAcademicSessionName(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[\/\u2013\u2014]/g, '-').trim();
}

function academicSessionDates(name) {
  const range = canonicalAcademicSessionName(name).match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (range) {
    const startYear = Number(range[1]);
    const endYear = range[2].length === 2 ? Number(String(startYear).slice(0, 2) + range[2]) : Number(range[2]);
    return { start_date: startYear + '-04-01', end_date: endYear + '-03-31' };
  }
  const year = canonicalAcademicSessionName(name).match(/^(\d{4})$/);
  return year ? { start_date: year[1] + '-01-01', end_date: year[1] + '-12-31' } : { start_date: '', end_date: '' };
}

function collectExistingAcademicSessionNames(db) {
  const names = new Set();
  const sessionKeys = new Set(['session','academicSession','academic_session']);
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.forEach(item => visit(item));
    if (!value || typeof value !== 'object') {
      if (sessionKeys.has(key)) { const name = canonicalAcademicSessionName(value); if (name) names.add(name); }
      return;
    }
    Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(db);
  return [...names];
}

function ensureAcademicSessions(db, schoolId = DEFAULT_SCHOOL_ID) {
  if (!Array.isArray(db.academicSessions)) db.academicSessions = [];
  const targetSchoolId = schoolId || DEFAULT_SCHOOL_ID;
  const now = new Date().toISOString();

  // If GJV (default school), ensure existing migration / legacy sessions are populated
  if (targetSchoolId === DEFAULT_SCHOOL_ID) {
    const preferred = canonicalAcademicSessionName(db.settings?.academicSession || db.settings?.admitCardSettings?.session || '');
    for (const name of collectExistingAcademicSessionNames(db)) {
      if (!db.academicSessions.some(row => matchTenant(row, DEFAULT_SCHOOL_ID) && canonicalAcademicSessionName(row.session_name) === name)) {
        const dates = academicSessionDates(name);
        db.academicSessions.push({ id: crypto.randomUUID(), school_id: DEFAULT_SCHOOL_ID, session_name: name, ...dates, is_active: false, status: 'Archived', created_at: now, updated_at: now, migrated_at: now });
      }
    }
  }

  let schoolSessions = db.academicSessions.filter(row => matchTenant(row, targetSchoolId));

  if (!schoolSessions.length) {
    const d = new Date();
    const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const name = startYear + '-' + String(startYear + 1).slice(-2);
    const dates = academicSessionDates(name);
    const newSession = {
      id: crypto.randomUUID(),
      school_id: targetSchoolId,
      session_name: name,
      ...dates,
      is_active: true,
      status: 'Active',
      created_at: now,
      updated_at: now
    };
    db.academicSessions.push(newSession);
    schoolSessions = [newSession];
  }

  let active = schoolSessions.find(row => row.is_active || row.status === 'Active');
  if (!active) {
    active = schoolSessions.slice().sort((a,b) => String(b.start_date).localeCompare(String(a.start_date)))[0];
    if (active) {
      active.is_active = true;
      active.status = 'Active';
    }
  }

  if (active) {
    schoolSessions.forEach(row => {
      row.is_active = row.id === active.id;
      if (row.is_active) row.status = 'Active';
      else if (row.status === 'Active') row.status = 'Closed';
    });
    if (targetSchoolId === DEFAULT_SCHOOL_ID) {
      db.settings = db.settings || {};
      db.settings.academicSession = active.session_name;
      db.settings.academicSessionId = active.id;
    } else {
      const sch = (db.schools || []).find(s => s.id === targetSchoolId);
      if (sch) {
        sch.settings = sch.settings || {};
        sch.settings.academicSession = active.session_name;
        sch.settings.academicSessionId = active.id;
      }
    }
  }

  return schoolSessions;
}

function currentAcademicSession(db, schoolId) {
  const targetSchoolId = schoolId || DEFAULT_SCHOOL_ID;
  const schoolSession = (db.academicSessions || []).find(row => matchTenant(row, targetSchoolId) && (row.is_active || row.status === 'Active'));
  if (schoolSession) return String(schoolSession.session_name).trim();
  const sessions = ensureAcademicSessions(db, targetSchoolId);
  return String(sessions.find(row => row.is_active)?.session_name || sessions[0]?.session_name || '').trim();
}

function normalizeAcademicSession(value, db, schoolId) {
  return canonicalAcademicSessionName(value || currentAcademicSession(db, schoolId));
}

function linkAcademicSessionReferences(db) {
  const sessions = db.academicSessions || [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const itemSchoolId = value.school_id || DEFAULT_SCHOOL_ID;
    const name = canonicalAcademicSessionName(value.academic_session || value.academicSession || value.session);
    if (name) {
      const match = sessions.find(s => matchTenant(s, itemSchoolId) && canonicalAcademicSessionName(s.session_name) === name);
      if (match) value.academic_session_id = match.id;
    }
    Object.values(value).forEach(visit);
  };
  Object.entries(db).forEach(([key,value]) => { if (key !== 'academicSessions') visit(value); });
}

function academicSessionReferenceCount(db, session) {
  const target = canonicalAcademicSessionName(session.session_name), id = String(session.id), ignored = new Set(['academicSessions','settings']);
  let count = 0;
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.forEach(item => visit(item));
    if (!value || typeof value !== 'object') return;
    if (session.school_id && value.school_id && !matchTenant(value, session.school_id)) return;
    if ((value.academic_session_id && String(value.academic_session_id) === id) || ['academic_session','academicSession','session'].some(k => value[k] && canonicalAcademicSessionName(value[k]) === target)) count++;
    Object.entries(value).forEach(([childKey, child]) => { if (!ignored.has(childKey)) visit(child, childKey); });
  };
  Object.entries(db).forEach(([key,value]) => { if (!ignored.has(key)) visit(value,key); });
  return count;
}

function normalizeSubjectKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function examResultIdentity(row, db) {
  return [
    String(row.student_id || row.studentId || row.admission_number || row.admissionNo || '').trim().toLowerCase(),
    String(row.subject_id || row.subjectId || normalizeSubjectKey(row.subject_name || row.subject)).trim().toLowerCase(),
    normalizeExamTypeKey(row.exam_id || row.examId || row.exam_term || row.examName || row.name),
    normalizeClassName(row.class_id || row.className || row.class_name).toLowerCase(),
    normalizeSectionName(row.section_id || row.section || row.section_name).toLowerCase(),
    normalizeAcademicSession(row.academic_session || row.academicSession || row.session, db).toLowerCase()
  ].join('|');
}

function ensureCentralExamResults(db) {
  if (!Array.isArray(db.examResults)) db.examResults = [];
  db.examResults = db.examResults.map(row => {
    const subject = (db.subjects || []).find(item =>
      String(item.id) === String(row.subject_id || row.subjectId || '') ||
      normalizeSubjectKey(item.name) === normalizeSubjectKey(row.subject_name || row.subject)
    );
    const studentId = row.student_id || row.studentId || row.admission_number || row.admissionNo;
    const student = (db.students || []).find(item =>
      (item.admissionNo || item.studentId || item.id) === studentId
    );
    const storedSection = normalizeSectionName(row.section_id || row.section || row.section_name);
    const resolvedSection = storedSection === 'All Sections' && student
      ? normalizeSectionName(student.section || student.section_name)
      : storedSection;
    const session = normalizeAcademicSession(row.academic_session || row.academicSession || row.session, db);
    const createdAt = row.created_at || row.createdAt || row.updated_at || row.updatedAt || new Date().toISOString();
    const updatedAt = row.updated_at || row.updatedAt || createdAt;
    const rowIsAbsent = row.attendance_status === 'Absent' || row.isAbsent === true || row.result_status === 'ABSENT' || row.resultStatus === 'ABSENT';
    return {
      ...row,
      school_id: row.school_id || DEFAULT_SCHOOL_ID,
      student_id: studentId,
      studentId,
      admission_number: row.admission_number || row.admissionNo || studentId,
      admissionNo: row.admissionNo || row.admission_number || studentId,
      student_name: row.student_name || row.studentName || row.name || '',
      studentName: row.studentName || row.student_name || row.name || '',
      teacher_id: row.teacher_id || row.teacherId || null,
      subject_id: subject?.id || row.subject_id || row.subjectId || normalizeSubjectKey(row.subject_name || row.subject),
      subjectId: subject?.id || row.subject_id || row.subjectId || normalizeSubjectKey(row.subject_name || row.subject),
      subject_name: subject?.name || row.subject_name || row.subject,
      subject: subject?.name || row.subject || row.subject_name,
      exam_id: row.exam_id || row.examId || normalizeExamTypeKey(row.exam_term || row.examName || row.name),
      exam_term: row.exam_term || row.examName || row.name,
      examName: row.examName || row.exam_term || row.name,
      class_id: normalizeClassName(row.class_id || row.className || row.class_name),
      className: normalizeClassName(row.class_id || row.className || row.class_name),
      section_id: resolvedSection,
      section: resolvedSection,
      academic_session: session,
      academicSession: session,
      session,
      marks_obtained: rowIsAbsent ? null : Number(row.marks_obtained ?? row.marksObtained ?? row.score),
      marksObtained: rowIsAbsent ? null : Number(row.marks_obtained ?? row.marksObtained ?? row.score),
      maximum_marks: Number(row.maximum_marks ?? row.maxMarks ?? row.maxScore ?? subject?.maxMarks ?? 100),
      maxMarks: Number(row.maximum_marks ?? row.maxMarks ?? row.maxScore ?? subject?.maxMarks ?? 100),
      pass_marks: Number(row.pass_marks ?? row.passMarks ?? subject?.passMarks ?? 33),
      passMarks: Number(row.pass_marks ?? row.passMarks ?? subject?.passMarks ?? 33),
      attendance_status: rowIsAbsent ? 'Absent' : 'Present',
      isAbsent: rowIsAbsent,
      grade: rowIsAbsent ? 'ABSENT' : row.grade,
      result_status: rowIsAbsent ? 'ABSENT' : (row.result_status || row.resultStatus),
      resultStatus: rowIsAbsent ? 'ABSENT' : (row.resultStatus || row.result_status),
      remarks: row.remarks || row.remark || '',
      entered_by_role: row.entered_by_role || (row.teacher_id || row.teacherId ? 'teacher' : 'admin'),
      entered_by_id: row.entered_by_id || row.teacher_id || row.teacherId || row.submittedBy || 'admin',
      entered_by: row.entered_by || row.submittedBy || row.entered_by_id || 'admin',
      created_at: createdAt,
      updated_at: updatedAt,
      updatedAt
    };
  });
  const seen = new Map();
  db.examResults.forEach((row, index) => seen.set(examResultIdentity(row, db), index));

  (db.exams || []).forEach(sheet => {
    (sheet.marks || []).forEach(mark => {
      const studentId = mark.student_id || mark.studentId || mark.admissionNo;
      if (!studentId) return;
      const subject = (db.subjects || []).find(item =>
        normalizeSubjectKey(item.name) === normalizeSubjectKey(sheet.subject)
      );
      const student = (db.students || []).find(item =>
        (item.admissionNo || item.studentId || item.id) === studentId
      );
      const sheetSection = normalizeSectionName(sheet.section || 'A');
      const seed = {
        ...mark,
        student_id: studentId,
        subject_id: subject?.id || mark.subject_id || normalizeSubjectKey(sheet.subject),
        exam_id: sheet.exam_id || normalizeExamTypeKey(sheet.examName || sheet.name),
        class_id: normalizeClassName(sheet.className),
        section_id: sheetSection === 'All Sections' && student
          ? normalizeSectionName(student.section || student.section_name)
          : sheetSection,
        academic_session: normalizeAcademicSession(sheet.session, db)
      };
      const key = examResultIdentity(seed, db);
      if (seen.has(key)) return;
      const now = sheet.submittedAt || new Date().toISOString();
      db.examResults.push({
        id: `EXM-RES-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`,
        school_id: sheet.school_id || DEFAULT_SCHOOL_ID,
        student_id: studentId,
        studentId,
        admission_number: studentId,
        admissionNo: studentId,
        student_name: mark.name || mark.studentName || '',
        studentName: mark.name || mark.studentName || '',
        roll_number: mark.rollNo || '',
        rollNo: mark.rollNo || '',
        teacher_id: sheet.teacherId || null,
        subject_id: seed.subject_id,
        subjectId: seed.subject_id,
        subject_name: sheet.subject,
        subject: sheet.subject,
        exam_id: seed.exam_id,
        examId: seed.exam_id,
        exam_term: sheet.examName || sheet.name,
        examName: sheet.examName || sheet.name,
        class_id: seed.class_id,
        className: seed.class_id,
        section_id: seed.section_id,
        section: seed.section_id,
        academic_session: seed.academic_session,
        academicSession: seed.academic_session,
        session: seed.academic_session,
        marks_obtained: mark.isAbsent || mark.attendanceStatus === 'Absent' ? null : Number(mark.marksObtained ?? mark.score),
        marksObtained: mark.isAbsent || mark.attendanceStatus === 'Absent' ? null : Number(mark.marksObtained ?? mark.score),
        maximum_marks: Number(mark.maxMarks ?? mark.maxScore ?? subject?.maxMarks ?? 100),
        maxMarks: Number(mark.maxMarks ?? mark.maxScore ?? subject?.maxMarks ?? 100),
        pass_marks: Number(mark.passMarks ?? subject?.passMarks ?? 33),
        passMarks: Number(mark.passMarks ?? subject?.passMarks ?? 33),
        attendance_status: mark.isAbsent || mark.attendanceStatus === 'Absent' ? 'Absent' : 'Present',
        isAbsent: Boolean(mark.isAbsent || mark.attendanceStatus === 'Absent'),
        grade: mark.isAbsent || mark.attendanceStatus === 'Absent' ? 'ABSENT' : mark.grade,
        result_status: mark.isAbsent || mark.attendanceStatus === 'Absent' ? 'ABSENT' : mark.resultStatus,
        remarks: mark.remarks || mark.remark || '',
        remark: mark.remarks || mark.remark || '',
        status: sheet.status || 'Submitted',
        entered_by_role: sheet.entered_by_role || 'admin',
        entered_by_id: sheet.entered_by_id || sheet.teacherId || 'admin',
        entered_by: sheet.submittedBy || sheet.teacherId || 'Admin',
        submittedBy: sheet.submittedBy || sheet.teacherId || 'Admin',
        created_at: now,
        updated_at: now,
        updatedAt: now
      });
      seen.set(key, db.examResults.length - 1);
    });
  });
  return db.examResults;
}

function groupedExamsFromCentral(db) {
  const groups = new Map();
  ensureCentralExamResults(db).forEach(row => {
    const schoolId = row.school_id || DEFAULT_SCHOOL_ID;
    const key = [
      schoolId,
      row.exam_id || normalizeExamTypeKey(row.examName),
      normalizeClassName(row.class_id || row.className),
      normalizeSectionName(row.section_id || row.section),
      row.subject_id || normalizeSubjectKey(row.subject),
      normalizeAcademicSession(row.academic_session || row.session, db)
    ].join('|').toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        id: `EXM-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 14)}`,
        school_id: schoolId,
        exam_id: row.exam_id || row.examId,
        name: row.exam_term || row.examName,
        examName: row.exam_term || row.examName,
        date: row.exam_date || String(row.updated_at || row.updatedAt || '').slice(0, 10),
        className: normalizeClassName(row.class_id || row.className),
        section: normalizeSectionName(row.section_id || row.section),
        subject_id: row.subject_id || row.subjectId,
        subject: row.subject_name || row.subject,
        session: normalizeAcademicSession(row.academic_session || row.session, db),
        status: row.status || 'Submitted',
        teacherId: row.teacher_id || null,
        entered_by_role: row.entered_by_role,
        entered_by_id: row.entered_by_id,
        submittedBy: row.entered_by || row.submittedBy,
        submittedAt: row.updated_at || row.updatedAt,
        marks: []
      });
    }
    const group = groups.get(key);
    group.marks.push({
      student_id: row.student_id,
      studentId: row.student_id || row.studentId,
      admissionNo: row.admission_number || row.admissionNo,
      name: row.student_name || row.studentName,
      rollNo: row.roll_number || row.rollNo,
      marksObtained: row.attendance_status === 'Absent' || row.isAbsent ? null : Number(row.marks_obtained ?? row.marksObtained ?? row.score),
      score: row.attendance_status === 'Absent' || row.isAbsent ? null : Number(row.marks_obtained ?? row.marksObtained ?? row.score),
      maxMarks: Number(row.maximum_marks ?? row.maxMarks ?? row.maxScore ?? 100),
      maxScore: Number(row.maximum_marks ?? row.maxMarks ?? row.maxScore ?? 100),
      passMarks: Number(row.pass_marks ?? row.passMarks ?? 33),
      grade: row.grade,
      resultStatus: row.result_status || row.resultStatus,
      attendanceStatus: row.attendance_status,
      isAbsent: row.attendance_status === 'Absent' || Boolean(row.isAbsent),
      remark: row.remarks || row.remark || ''
    });
  });
  return [...groups.values()];
}

const FEE_CATEGORY_FIELDS = {
  'Monthly Tuition Fee': 'tuitionFee',
  'Admission Fee': 'admissionFee',
  'Examination Fee': 'examFee',
  'Annual Fee': 'annualFee',
  'Development Fee': 'developmentFee',
  'Library Fee': 'libraryFee',
  'Computer Fee': 'computerFee',
  'Transport Fee': 'transportFee'
};

function normalizeFeeStudentId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeFeeType(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = Object.keys(FEE_CATEGORY_FIELDS).find(type => type.toLowerCase() === text.toLowerCase());
  return match || (text.toLowerCase() === 'other custom fee' ? 'Other Custom Fee' : text);
}

function feeStructuresForSession(db, session, schoolId = DEFAULT_SCHOOL_ID) {
  const targetSchoolId = schoolId || DEFAULT_SCHOOL_ID;
  const name = normalizeAcademicSession(session, db, targetSchoolId);
  db.feeStructuresBySession = db.feeStructuresBySession || {};
  if (!Object.keys(db.feeStructuresBySession).length && db.feeStructures && Object.keys(db.feeStructures).length) {
    db.feeStructuresBySession[currentAcademicSession(db, DEFAULT_SCHOOL_ID)] = JSON.parse(JSON.stringify(db.feeStructures));
  }
  if (targetSchoolId !== DEFAULT_SCHOOL_ID) {
    const school = (db.schools || []).find(s => s.id === targetSchoolId);
    if (school?.feeStructuresBySession?.[name]) return school.feeStructuresBySession[name];
    if (school?.feeStructures) return school.feeStructures;
  }
  return db.feeStructuresBySession[name] || db.feeStructures || {};
}

function studentFeeStructure(db, student, session) {
  const className = normalizeClassName(student?.className || student?.class_name);
  const schoolId = student?.school_id || DEFAULT_SCHOOL_ID;
  const configured = feeStructuresForSession(db, session || studentAcademicSession(student, db), schoolId)?.[className] || {};
  return {
    admissionFee: Number(student?.admissionFee ?? configured.admissionFee ?? 0),
    tuitionFee: Number(student?.monthlyFee ?? configured.tuitionFee ?? 0),
    examFee: Number(configured.examFee ?? 0),
    annualFee: Number(configured.annualFee ?? 0),
    developmentFee: Number(configured.developmentFee ?? 0),
    libraryFee: Number(configured.libraryFee ?? 0),
    computerFee: Number(configured.computerFee ?? 0),
    transportFee: Number(student?.transportFee ?? configured.transportFee ?? 0)
  };
}

function feeInvoiceIdentity(fee, db) {
  const type = normalizeFeeType(fee.fee_type || fee.type);
  const billingMonth = String(fee.billing_month || fee.month || '').trim();
  const period = ['Monthly Tuition Fee', 'Transport Fee', 'Other Custom Fee'].includes(type)
    ? billingMonth
    : 'SESSION';
  return [
    normalizeFeeStudentId(fee.student_id || fee.studentId || fee.admission_number),
    normalizeAcademicSession(fee.academic_session || fee.session, db).toLowerCase(),
    period,
    type.toLowerCase()
  ].join('|');
}

function calculateFeeInvoice(db, student, options = {}) {
  const studentId = student.admissionNo || student.studentId || student.id;
  const session = normalizeAcademicSession(options.session, db);
  const month = String(options.month || '').trim();
  const type = normalizeFeeType(options.type);
  const structure = studentFeeStructure(db, student, session);
  const identity = feeInvoiceIdentity({ studentId, session, month, type }, db);
  const schoolId = student?.school_id || options.school_id || options.schoolId;
  const payments = (db.fees || []).filter(fee =>
    (!schoolId || matchTenant(fee, schoolId)) &&
    fee.id !== options.excludeFeeId && fee.status !== 'Refunded' && !fee.deleted_at && feeInvoiceIdentity(fee, db) === identity
  );
  const configuredAmount = type === 'Other Custom Fee'
    ? Number(options.customFeeAmount ?? payments[0]?.grossAmount ?? payments[0]?.expectedAmount ?? 0)
    : Number(structure[FEE_CATEGORY_FIELDS[type]] || 0);
  const studentDiscount = type === 'Monthly Tuition Fee'
    ? Number(student.feeDiscountAmount || student.discountAmount || 0)
    : 0;
  const studentScholarship = type === 'Monthly Tuition Fee'
    ? Number(student.scholarshipAmount || 0)
    : 0;
  const recordedDiscount = payments.reduce((max, fee) => Math.max(max, Number(fee.discountAmount || 0)), 0);
  const recordedScholarship = payments.reduce((max, fee) => Math.max(max, Number(fee.scholarshipAmount || 0)), 0);
  const discountAmount = Math.max(recordedDiscount, Number(options.discountAmount ?? studentDiscount));
  const scholarshipAmount = Math.max(recordedScholarship, Number(options.scholarshipAmount ?? studentScholarship));
  const netFee = Math.max(0, configuredAmount - discountAmount - scholarshipAmount);
  const paidAmount = payments.reduce((sum, fee) => sum + Number(fee.appliedAmount ?? fee.amount ?? fee.paidAmount ?? 0), 0);
  const finePaid = payments.reduce((sum, fee) => sum + Number(fee.lateFee || 0), 0);
  return {
    identity,
    studentId,
    session,
    month,
    type,
    structure,
    expectedAmount: configuredAmount,
    discountAmount,
    scholarshipAmount,
    netFee,
    paidAmount,
    finePaid,
    remainingBalance: Math.max(0, netFee - paidAmount),
    paymentStatus: paidAmount <= 0 ? 'Unpaid' : (paidAmount >= netFee ? 'Paid' : 'Partially Paid'),
    payments
  };
}

function feeBillingMonthsThrough(session, throughMonth) {
  const match = String(session || '').match(/^(\d{4})[-/](\d{2}|\d{4})$/);
  if (!match || !/^\d{4}-\d{2}$/.test(String(throughMonth || ''))) return [String(throughMonth || '')].filter(Boolean);
  const startYear = Number(match[1]);
  const start = new Date(Date.UTC(startYear, 3, 1));
  const [throughYear, throughMonthNumber] = String(throughMonth).split('-').map(Number);
  const end = new Date(Date.UTC(throughYear, throughMonthNumber - 1, 1));
  if (end < start) return [String(throughMonth)];
  const months = [];
  for (const cursor = new Date(start); cursor <= end && months.length < 12; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function feeAcademicSessionMonths(session) {
  const match = String(session || '').match(/^(\d{4})[-/](\d{2}|\d{4})$/);
  if (!match) return [];
  const startYear = Number(match[1]);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(startYear, 3 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
function totalStudentOutstandingThrough(db, student, session, month) {
  const recurringCategories = ['Monthly Tuition Fee', 'Transport Fee'];
  const oneTimeCategories = Object.keys(FEE_CATEGORY_FIELDS).filter(category => !recurringCategories.includes(category));
  const recurring = feeBillingMonthsThrough(session, month).reduce((sum, billingMonth) =>
    sum + recurringCategories.reduce((categorySum, category) =>
      categorySum + calculateFeeInvoice(db, student, { session, month: billingMonth, type: category }).remainingBalance, 0), 0);
  const oneTime = oneTimeCategories.reduce((sum, category) =>
    sum + calculateFeeInvoice(db, student, { session, month, type: category }).remainingBalance, 0);
  return recurring + oneTime;
}
function feeDueDateForMonth(month, feeRules = {}) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const dueDay = Math.max(1, Math.min(28, Number(feeRules.dueDay || feeRules.monthlyDueDay || 10)));
  const graceDays = Math.max(0, Math.min(31, Number(feeRules.graceDays || 0)));
  return new Date(Number(match[1]), Number(match[2]) - 1, dueDay + graceDays, 23, 59, 59, 999);
}

function feeOverdueDays(month, now, feeRules = {}) {
  const dueDate = feeDueDateForMonth(month, feeRules);
  if (!dueDate || now <= dueDate) return 0;
  return Math.max(1, Math.floor((now.getTime() - dueDate.getTime()) / 86400000));
}
function formatFeeReminderMonth(month){const match=String(month||'').match(/^(\d{4})-(\d{2})$/);if(!match)return'';return new Date(Number(match[1]),Number(match[2])-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'})}
function formatFeeReminderDate(date){return date instanceof Date&&!Number.isNaN(date.getTime())?date.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}):''}
function feeReminderPayload(db,student,{sessionId,requestedMonth,reminderType}){
  const sessionRecord=(db.academicSessions||[]).find(row=>String(row.id)===String(sessionId||''));
  if(!sessionRecord)throw Error('Academic Session is required.');
  if(String(student.academic_session_id||'')!==String(sessionRecord.id))throw Error('Student '+(student.admissionNo||student.id)+' does not belong to the selected Academic Session.');
  const now=new Date(),rules=db.settings?.feeRules||{},requested=String(requestedMonth||'').match(/\d{4}-\d{2}/)?.[0]||'',months=requested?[requested]:feeBillingMonthsThrough(sessionRecord.session_name,getLocalMonthStr(now));
  const regularCandidates=months.map(month=>({month,invoice:calculateFeeInvoice(db,student,{session:sessionRecord.session_name,month,type:'Monthly Tuition Fee'}),dueDate:feeDueDateForMonth(month,rules)})).filter(item=>item.invoice.remainingBalance>0);
  const legacyCandidates=(db.legacyFeeDues||[]).filter(due=>!due.deleted_at&&normalizeFeeStudentId(due.student_id)===normalizeFeeStudentId(student.admissionNo||student.studentId||student.id)&&normalizeAcademicSession(due.academic_session,db)===sessionRecord.session_name&&(!requested||due.due_month===requested)).map(due=>{const snapshot=legacyDueSnapshot(db,due,now);return{month:snapshot.due_month,invoice:{remainingBalance:snapshot.total_outstanding},dueDate:feeDueDateForMonth(snapshot.due_month,rules)}}).filter(item=>item.invoice.remainingBalance>0);
  const candidates=[...regularCandidates,...legacyCandidates];
  const eligible=reminderType==='overdue'?candidates.filter(item=>item.dueDate&&now>item.dueDate):candidates;
  const selected=eligible.sort((a,b)=>a.month.localeCompare(b.month))[0];
  if(!selected)throw Error('No '+(reminderType==='overdue'?'overdue':'pending')+' monthly fee was found for '+(student.name||student.admissionNo)+' in '+sessionRecord.session_name+'.');
  const classSection=[normalizeClassName(student.className||student.class_name),normalizeSectionName(student.section||student.section_name)].filter(Boolean).join(' - ');
  const values=[formatFeeReminderMonth(selected.month),String(student.name||student.studentName||'').trim(),classSection,String(Number(selected.invoice.remainingBalance)),formatFeeReminderDate(selected.dueDate)];
  const templateKey=reminderType==='overdue'?'fee_overdue_reminder':'fee_due_reminder';
  return{templateKey,values,components:WhatsApp.buildTemplateComponents(templateKey,values),month:selected.month,amount:selected.invoice.remainingBalance,dueDate:formatFeeReminderDate(selected.dueDate),academicSession:sessionRecord.session_name,academic_session_id:sessionRecord.id};
}
async function sendFeeWhatsAppAfterPayment(student,feeRecord){
  const db=readDbRaw(),cfg=WhatsApp.config(db,getJwtSecret()),sessionId=String(feeRecord.academic_session_id||'').trim();
  if(!cfg.enabled)return{status:'Skipped',message:'WhatsApp API is disabled.'};
  if(!sessionId)return{status:'Failed',error:'Academic Session is missing from the saved fee payment.'};
  let payload,reminderType;
  try{payload=feeReminderPayload(db,student,{sessionId,requestedMonth:'',reminderType:'overdue'});reminderType='overdue'}
  catch(overdueError){
    try{payload=feeReminderPayload(db,student,{sessionId,requestedMonth:'',reminderType:'due'});reminderType='due'}
    catch(dueError){return{status:'Skipped',message:'Payment saved; no pending fee remains for WhatsApp reminder.'}}
  }
  const automationKey=reminderType==='overdue'?'overdueReminder':'feeDueReminder',templateKey=payload.templateKey;
  if(!cfg.automation[automationKey])return{status:'Skipped',message:`Payment saved; ${reminderType} WhatsApp automation is disabled.`};
  if(!cfg.templates[templateKey])return{status:'Failed',error:`Payment saved, but ${templateKey} is not configured.`};
  try{
    const result=await WhatsApp.send(db,{mobileNumber:student.mobile,studentId:student.admissionNo||student.id,studentName:student.name,parentName:student.fatherName||'',messageType:reminderType,templateKey,templateName:cfg.templates[templateKey],languageCode:cfg.templateLanguages[templateKey],components:payload.components,academicSession:payload.academicSession,academic_session_id:payload.academic_session_id,deduplicationKey:`payment-followup:${feeRecord.receiptNo}:${templateKey}:${payload.month}`},getJwtSecret(),writeDbRaw,readDbRaw);
    return{status:result.duplicate?'Already Sent':'Sent',templateName:cfg.templates[templateKey],languageCode:cfg.templateLanguages[templateKey],metaMessageId:result.metaMessageId||result.log?.metaMessageId||'',billingMonth:payload.month,pendingAmount:payload.amount,dueDate:payload.dueDate};
  }catch(error){return{status:'Failed',templateName:cfg.templates[templateKey],languageCode:cfg.templateLanguages[templateKey],error:String(error.message||error).slice(0,500),metaCode:error.metaCode||null,metaSubcode:error.metaSubcode||null}}
}
function legacyDueIdentity(due, db) {
  return [normalizeFeeStudentId(due.student_id || due.studentId || due.admission_number || due.admissionNo), normalizeAcademicSession(due.academic_session || due.session, db).toLowerCase(), String(due.due_month || due.month || '').trim().toLowerCase(), normalizeFeeType(due.fee_category || due.type).toLowerCase()].join('|');
}
function legacyDueSnapshot(db, due, now = new Date()) {
  const payments = (db.fees || []).filter(payment => payment.status !== 'Refunded' && !payment.deleted_at && payment.legacy_due_id === due.id);
  const paidAmount = Math.max(0, Number(due.opening_paid_amount || 0)) + payments.reduce((sum, payment) => sum + Number(payment.appliedAmount ?? payment.amount ?? 0), 0);
  const feeAmount = Math.max(0, Number(due.fee_amount || 0)), discount = Math.max(0, Number(due.discount_amount || 0)), lateFine = Math.max(0, Number(due.late_fine || 0));
  const finePaid = payments.reduce((sum, payment) => sum + Number(payment.lateFee || 0), 0), outstandingFine = Math.max(0, lateFine - finePaid);
  const pendingAmount = Math.max(0, feeAmount - discount - paidAmount), dueDate = feeDueDateForMonth(due.due_month, db.settings?.feeRules || {});
  const overdueDays = pendingAmount > 0 && dueDate && now > dueDate ? Math.max(1, Math.floor((now.getTime() - dueDate.getTime()) / 86400000)) : 0;
  return { ...due, fee_amount: feeAmount, late_fine: lateFine, discount_amount: discount, paid_amount: paidAmount, pending_amount: pendingAmount, fine_paid: finePaid, outstanding_fine: outstandingFine, total_overdue: overdueDays > 0 ? pendingAmount + outstandingFine : 0, total_outstanding: pendingAmount + outstandingFine, overdue_days: overdueDays, payment_status: pendingAmount <= 0 && outstandingFine <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : (overdueDays > 0 ? 'Overdue' : 'Pending')), payments };
}
function findFeeStudent(db, value) {
  const id = normalizeFeeStudentId(value); return (db.students || []).find(student => [student.id, student.studentId, student.student_id, student.admissionNo, student.admission_number].some(candidate => normalizeFeeStudentId(candidate) === id));
}
function validateLegacyDueInput(db, input, existingId = '') {
  const student = findFeeStudent(db, input.studentId || input.student_id || input.admissionNo || input.admission_number), errors = [];
  if (!student) errors.push('Student was not found.');
  const session = normalizeAcademicSession(input.academicSession || input.academic_session || input.session, db); if (!/^\d{4}-\d{2}$/.test(session)) errors.push('Academic session must use YYYY-YY format.');
  const dueMonth = String(input.dueMonth || input.due_month || input.month || '').trim(); if (!/^\d{4}-\d{2}$/.test(dueMonth)) errors.push('Due month must use YYYY-MM format.');
  const feeCategory = normalizeFeeType(input.feeCategory || input.fee_category || input.type); if (!feeCategory) errors.push('Fee category is required.');
  const feeAmount = Number(input.feeAmount ?? input.fee_amount), lateFine = Number(input.lateFine ?? input.late_fine ?? 0), discount = Number(input.discount ?? input.discount_amount ?? 0), paidAmount = Number(input.paidAmount ?? input.paid_amount ?? 0);
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) errors.push('Fee amount must be greater than zero.'); if (![lateFine, discount, paidAmount].every(value => Number.isFinite(value) && value >= 0)) errors.push('Fine, discount, and paid amount must be non-negative numbers.'); if (discount > feeAmount) errors.push('Discount cannot exceed fee amount.'); if (paidAmount > feeAmount - discount) errors.push('Paid amount cannot exceed the discounted fee amount.');
  const normalized = { student_id: student?.admissionNo || student?.studentId || student?.id || '', admission_number: student?.admissionNo || student?.studentId || student?.id || '', academic_session: session, due_month: dueMonth, fee_category: feeCategory, fee_amount: feeAmount, late_fine: lateFine, discount_amount: discount, opening_paid_amount: paidAmount, remarks: String(input.remarks || '').trim() };
  if (!errors.length) { const duplicate = (db.legacyFeeDues || []).find(due => due.id !== existingId && !due.deleted_at && legacyDueIdentity(due, db) === legacyDueIdentity(normalized, db)); if (duplicate) errors.push('Duplicate legacy due already exists (' + duplicate.id + ').'); }
  return { errors, normalized, student };
}

function feeProfileForStudent(db, student, options = {}) {
  const session = normalizeAcademicSession(options.session, db);
  const month = String(options.month || getLocalMonthStr(new Date())).trim();
  const type = normalizeFeeType(options.type || 'Monthly Tuition Fee');
  const invoice = calculateFeeInvoice(db, student, { ...options, session, month, type });
  const ledger = (db.fees || [])
    .filter(fee =>
      !fee.deleted_at &&
      normalizeFeeStudentId(fee.student_id || fee.studentId || fee.admission_number) ===
      normalizeFeeStudentId(student.admissionNo || student.studentId || student.id)
    )
    .sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')));
  const totalPaid = ledger.reduce((sum, fee) => sum + Number(fee.amount || 0) + Number(fee.lateFee || 0), 0);
  const previousDues = totalStudentOutstandingThrough(db, student, session, month);
  const lateFineRule = Number(db.settings?.feeRules?.lateFinePerMonth || 0);
  const suggestedFine = month < getLocalMonthStr(new Date()) && invoice.remainingBalance > 0
    ? Math.max(0, lateFineRule)
    : 0;
  return {
    student: {
      ...student,
      student_id: student.admissionNo || student.studentId || student.id,
      class_id: normalizeClassName(student.className || student.class_name),
      section_id: normalizeSectionName(student.section || student.section_name),
      academic_session: studentAcademicSession(student, db)
    },
    session,
    month,
    structure: invoice.structure,
    invoice,
    previousDues,
    suggestedFine,
    totalPaid,
    advanceCredit: ledger.filter(fee => fee.status !== 'Refunded').reduce((sum, fee) => sum + Number(fee.advanceAmount || 0), 0),
    ledger
  };
}

function normalizeTeacherAssignments(db, teacherId, targetSession) {
  const session = targetSession || currentAcademicSession(db);
  const teacher = (db.teachers || []).find(t => t.empId === teacherId || t.id === teacherId || t.loginUsername === teacherId);
  const validIds = new Set([teacherId]);
  if (teacher) {
    if (teacher.id) validIds.add(teacher.id);
    if (teacher.empId) validIds.add(teacher.empId);
  }

  const explicitAssignments = (db.teacherAssignments || [])
    .filter(assignment => assignment && (validIds.has(assignment.teacher_id) || validIds.has(assignment.teacherId)))
    .map(assignment => ({
      ...assignment,
      teacher_id: teacher?.empId || teacherId,
      class_name: normalizeClassName(assignment.class_name || assignment.className),
      section: normalizeSectionName(assignment.section),
      academic_session: String(assignment.academic_session || assignment.academicSession || session).trim()
    }));

  if (teacher && teacher.classTeacher && teacher.classTeacher !== 'None') {
    const rawClass = teacher.classTeacher;
    const className = normalizeClassName(rawClass.replace(/-[A-Za-z]+$/, '').trim());
    const sectionMatch = rawClass.match(/-([A-Za-z]+)$/)?.[1] || 'A';
    const section = normalizeSectionName(sectionMatch);
    if (className && section) {
      const exists = explicitAssignments.some(a => a.class_name === className && (a.section === 'All Sections' || a.section === section));
      if (!exists) {
        explicitAssignments.push({
          id: 'ASN-AUTO-' + (teacher.empId || teacher.id),
          teacher_id: teacher.empId || teacher.id,
          teacher_name: teacher.name,
          class_name: className,
          section: section,
          subject_name: teacher.subject || 'General',
          academic_session: session,
          is_class_teacher: true
        });
      }
    }
  }

  const seen = new Set();
  return explicitAssignments.filter(assignment => {
    if (!assignment.class_name || !assignment.section) return false;
    if (targetSession && normalizeAcademicSession(assignment.academic_session, db) !== normalizeAcademicSession(targetSession, db)) return false;
    const key = `${assignment.class_name.toLowerCase()}|${assignment.section.toLowerCase()}|${(assignment.subject_name || '').toLowerCase()}|${normalizeAcademicSession(assignment.academic_session, db)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function teacherClassContexts(db, teacherId) {
  const seen = new Set();
  return normalizeTeacherAssignments(db, teacherId)
    .map(assignment => ({
      class_name: assignment.class_name,
      section: assignment.section,
      academic_session: assignment.academic_session,
      academic_session_id: assignment.academic_session_id || (db.academicSessions || []).find(row => row.session_name === assignment.academic_session)?.id || ''
    }))
    .filter(context => {
      const key = `${context.class_name.toLowerCase()}|${context.section.toLowerCase()}|${normalizeAcademicSession(context.academic_session, db)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isStudentActive(student) {
  const status = String(student?.status || student?.student_status || 'Active').trim().toLowerCase();
  return !['inactive', 'deleted', 'withdrawn', 'left'].includes(status);
}

function studentAcademicSession(student, db) {
  const sessionId = String(student?.academic_session_id || '').trim();
  if (sessionId) { const row = (db.academicSessions || []).find(item => String(item.id) === sessionId); if (row) return String(row.session_name).trim(); }
  return String(student?.academicSession || student?.academic_session || student?.session || currentAcademicSession(db, student?.school_id)).trim();
}

function studentMatchesContext(student, context, db) {
  const classMatches = normalizeClassName(student?.className || student?.class_name) === context.class_name;
  const studentSection = normalizeSectionName(student?.section || student?.section_name);
  const sectionMatches = context.section === 'All Sections' || studentSection === context.section;
  const sessionMatches = normalizeAcademicSession(studentAcademicSession(student, db), db) === normalizeAcademicSession(context.academic_session, db);
  return classMatches && sectionMatches && isStudentActive(student) && sessionMatches;
}

function ensureCentralStudentAttendance(db) {
  if (!Array.isArray(db.studentAttendance)) db.studentAttendance = [];
  const existingKeys = new Set(db.studentAttendance.map(row =>
    `${row.student_id}|${normalizeAttendanceDate(row.attendance_date)}|${row.academic_session || currentAcademicSession(db)}`
  ));

  (db.attendance || []).forEach(sheet => {
    const attendanceDate = normalizeAttendanceDate(sheet.date || sheet.attendance_date);
    if (!attendanceDate) return;
    (sheet.records || []).forEach(record => {
      const studentId = record.student_id || record.studentId || record.admissionNo;
      if (!studentId) return;
      const student = (db.students || []).find(item =>
        (item.admissionNo || item.studentId || item.id) === studentId
      );
      const academicSession = String(
        record.academic_session ||
        sheet.academic_session ||
        studentAcademicSession(student, db)
      ).trim();
      const key = `${studentId}|${attendanceDate}|${academicSession}`;
      if (existingKeys.has(key)) return;
      const createdAt = record.created_at || sheet.created_at || sheet.timestamp || new Date().toISOString();
      db.studentAttendance.push({
        id: record.id || `ATT-${studentId}-${attendanceDate}-${academicSession}`,
        school_id: sheet.school_id || DEFAULT_SCHOOL_ID,
        student_id: studentId,
        teacher_id: record.teacher_id || sheet.teacher_id || null,
        class_id: normalizeClassName(record.class_id || record.className || sheet.className || student?.className),
        section_id: normalizeSectionName(record.section_id || record.section || student?.section || sheet.section),
        attendance_date: attendanceDate,
        status: record.status || 'Present',
        remarks: record.remarks || record.remark || '',
        academic_session: academicSession,
        marked_by: record.marked_by || sheet.marked_by || sheet.submittedBy || 'Admin',
        created_at: createdAt,
        updated_at: record.updated_at || sheet.updated_at || sheet.timestamp || createdAt
      });
      existingKeys.add(key);
    });
  });
  return db.studentAttendance;
}

function groupedAttendanceFromCentral(db, rows = null) {
  const source = rows || ensureCentralStudentAttendance(db);
  const groups = new Map();
  source.forEach(row => {
    const schoolId = row.school_id || DEFAULT_SCHOOL_ID;
    const key = `${schoolId}|${row.attendance_date}|${row.class_id}|${row.section_id}|${row.academic_session_id || row.academic_session}`;
    if (!groups.has(key)) {
      groups.set(key, {
        school_id: schoolId,
        date: row.attendance_date,
        attendance_date: row.attendance_date,
        className: row.class_id,
        class_id: row.class_id,
        section: row.section_id,
        section_id: row.section_id,
        academic_session: row.academic_session,
        academic_session_id: row.academic_session_id || null,
        teacher_id: row.teacher_id || null,
        submittedBy: row.marked_by || 'Admin',
        marked_by: row.marked_by || 'Admin',
        timestamp: row.updated_at,
        records: []
      });
    }
    const group = groups.get(key);
    if (String(row.updated_at || '') >= String(group.timestamp || '')) {
      group.timestamp = row.updated_at;
      group.submittedBy = row.marked_by || group.submittedBy;
      group.marked_by = row.marked_by || group.marked_by;
      group.teacher_id = row.teacher_id || group.teacher_id;
    }
    group.records.push({
      id: row.id,
      studentId: row.student_id,
      student_id: row.student_id,
      admissionNo: row.student_id,
      status: row.status,
      remark: row.remarks || '',
      remarks: row.remarks || '',
      teacher_id: row.teacher_id,
      class_id: row.class_id,
      section_id: row.section_id,
      attendance_date: row.attendance_date,
      academic_session: row.academic_session,
      academic_session_id: row.academic_session_id || null,
      marked_by: row.marked_by,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  });
  return [...groups.values()].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(a.className).localeCompare(String(b.className)) ||
    String(a.section).localeCompare(String(b.section))
  );
}

function rebuildLegacyAttendance(db) {
  db.attendance = groupedAttendanceFromCentral(db);
}

// Thread-safe Database Lock Queue
let dbLock = Promise.resolve();
async function runInDbTransaction(fn) {
  const previous = dbLock;
  let resResolver;
  dbLock = new Promise((resolve) => {
    resResolver = resolve;
  });
  try {
    await previous;
    const result = await fn();
    return result;
  } finally {
    resResolver();
  }
}

let inMemoryDb = null;

// Read database
function readDbRaw() {
  if (inMemoryDb) {
    return inMemoryDb;
  }
  if (process.env.VERCEL && fs.existsSync('/tmp/db.json')) {
    try {
      inMemoryDb = JSON.parse(fs.readFileSync('/tmp/db.json', 'utf8'));
      return inMemoryDb;
    } catch (e) {}
  }
  if (!fs.existsSync(DB_PATH)) {
    // Seed database with default admin account, settings, and mock data
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('Admin@123', salt, 1000, 64, 'sha512').toString('hex');
    const today = new Date(), defaultStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const defaultSession = defaultStartYear + '-' + String(defaultStartYear + 1).slice(-2);
    const defaultDb = {
      settings: {
        adminUsername: 'admin@garumarajatiyavidyalaya.in',
        adminPasswordHash: hash,
        adminPasswordSalt: salt,
        notificationsEnabled: true,
        whatsappEnabled: true,
        smsEnabled: true,
        whatsappTemplate: "Dear Parent, {message} - Garumara Jatiya Vidyalaya",
        smsTemplate: "Dear Parent, {message} - GJV",
        websiteContent: {
          schoolName: "Garumara Jatiya Vidyalaya",
          tagline: "Building Character, Cultivating Excellence",
          aboutText: "Garumara Jatiya Vidyalaya is a premier educational institution established with the mission of providing holistic, high-quality, and affordable education. Situated near the serene Garumara National Park, we nurture young minds with standard curriculum combined with rich cultural values, physical education, and advanced science programs.",
          principalName: "Dr. Anirban Sen, Ph.D.",
          principalMessage: "Welcome to Garumara Jatiya Vidyalaya. As Principal, it is a privilege to lead this institution dedicated to academic achievement and character building. We believe that education is not merely acquiring knowledge, but molding young characters to face global challenges while remaining rooted in our ethical values. We work hand-in-hand with parents to unlock every child's full potential.",
          address: "Garumara, Nagaon, Assam – 782140",
          phone: "+91 8099456097",
          email: "info@garumarajv.org",
          mapEmbedUrl: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3570.648348633785!2d88.75618777595304!3d26.707746168560592!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39e46a782bcfdd49%3A0xc3c5f58bc16db18b!2sLataguri%20High%20School%20(H.S.)!5e0!3m2!1sen!2sin!4v1721240000000!5m2!1sen!2sin"
        },
        admitCardSettings: {
          session: defaultSession,
          centre: "Garumara Jatiya Vidyalaya Campus",
          instructions: "1. Candidates must bring their printed Admit Card to the exam hall.\n2. Report at least 30 minutes prior to the exam start time.\n3. Smart gadgets, mobile phones, and calculators are strictly prohibited.",
          principalSignatureName: "Anarul Hussain",
          principalSignatureUrl: "",
          principalSignatureUpdatedAt: "",
          examDates: "Unit Test: Aug 10 - Aug 15\nHalf Yearly: Oct 12 - Oct 20\nAnnual: Dec 07 - Dec 18"
        }
      },
      students: [],
      attendance: [],
      fees: [],
      exams: [],
      notices: [
        {
          id: '1',
          date: '2026-07-15',
          title: 'Admission Open for Session ' + defaultSession,
          content: 'Admissions are open for Classes Lower Kindergarten (LKG) to Class X. Online application forms are available on the Admission section. Visit the school office on working days between 10:00 AM and 2:00 PM for inquiries.',
          target: 'All',
          isUrgent: true
        },
        {
          id: '2',
          date: '2026-07-10',
          title: 'Summer Vacation Notice',
          content: 'The school will remain closed for summer vacation from May 20, 2026, to June 15, 2026. Normal classes will resume on June 16, 2026, according to the standard schedule.',
          target: 'All',
          isUrgent: false
        }
      ],
      gallery: [
        {
          id: '1',
          title: 'Annual Sports Day 2026',
          image: '/uploads/sports_day.jpg',
          date: '2026-02-14'
        },
        {
          id: '2',
          title: 'Science Exhibition',
          image: '/uploads/science_fair.jpg',
          date: '2026-03-12'
        }
      ],
      notifications: [],
      leadership: [
        {
          id: "principal",
          name: "Anarul Hussain",
          qualification: "D.El.Ed.",
          designation: "Principal, Garumara Jatiya Vidyalaya",
          message: "Welcome to Garumara Jatiya Vidyalaya. As Principal, it is a privilege to lead this institution dedicated to academic achievement and character building. We believe that education is not merely acquiring knowledge, but molding young characters to face global challenges.",
          photo: "uploads/principal.jpg"
        },
        {
          id: "vice_principal",
          name: "Muzahirul Hoque Anchari",
          qualification: "B.Ed.",
          designation: "Vice Principal",
          message: "At GJV, we aim to provide an environment where students can discover their true capabilities. I welcome all students and parents to work with us to achieve excellence in all domains of life.",
          photo: "uploads/vice_principal.jpg"
        },
        {
          id: "academic_director",
          name: "Ahiya Alam",
          qualification: "",
          designation: "Academic Director",
          message: "Our curriculum is designed to balance standard academics with creative thinking and physical education. We strive to provide the best tools and pedagogy to guide our students on their educational journey.",
          photo: "uploads/academic_director.jpg"
        }
      ]
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), 'utf8');
    return defaultDb;
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  let updated = false;
  if (!Array.isArray(db.admissionApplications)) {
    db.admissionApplications = [];
    updated = true;
  }
  db.admissionApplications.forEach(application => {
    if (application.applicationStatus === 'Pending') { application.applicationStatus = 'Pending Review'; updated = true; }
  });
  if (!db.leadership) {
    db.leadership = [
      {
        id: "principal",
        name: "Anarul Hussain",
        qualification: "D.El.Ed.",
        designation: "Principal, Garumara Jatiya Vidyalaya",
        message: "Welcome to Garumara Jatiya Vidyalaya. As Principal, it is a privilege to lead this institution dedicated to academic achievement and character building. We believe that education is not merely acquiring knowledge, but molding young characters to face global challenges.",
        photo: "uploads/principal.jpg"
      },
      {
        id: "vice_principal",
        name: "Muzahirul Hoque Anchari",
        qualification: "B.Ed.",
        designation: "Vice Principal",
        message: "At GJV, we aim to provide an environment where students can discover their true capabilities. I welcome all students and parents to work with us to achieve excellence in all domains of life.",
        photo: "uploads/vice_principal.jpg"
      },
      {
        id: "academic_director",
        name: "Ahiya Alam",
        qualification: "",
        designation: "Academic Director",
        message: "Our curriculum is designed to balance standard academics with creative thinking and physical education. We strive to provide the best tools and pedagogy to guide our students on their educational journey.",
        photo: "uploads/academic_director.jpg"
      }
    ];
    updated = true;
  }
  if (!db.settings.admitCardSettings) {
    db.settings.admitCardSettings = {
      session: currentAcademicSession(db),
      centre: "Garumara Jatiya Vidyalaya Campus",
      instructions: "1. Candidates must bring their printed Admit Card to the exam hall.\n2. Report at least 30 minutes prior to the exam start time.\n3. Smart gadgets, mobile phones, and calculators are strictly prohibited.",
      principalSignatureName: "Anarul Hussain",
      principalSignatureUrl: "",
      principalSignatureUpdatedAt: "",
      examDates: "Unit Test: Aug 10 - Aug 15\nHalf Yearly: Oct 12 - Oct 20\nAnnual: Dec 07 - Dec 18"
    };
    updated = true;
  }
  const admitSettings = db.settings.admitCardSettings;
  if (admitSettings.principalSignatureUrl === undefined) {
    admitSettings.principalSignatureUrl = admitSettings.principalSignatureImage || '';
    updated = true;
  }
  if (Object.prototype.hasOwnProperty.call(admitSettings, 'principalSignatureImage')) {
    delete admitSettings.principalSignatureImage;
    updated = true;
  }
  if (admitSettings.principalSignatureUpdatedAt === undefined) {
    admitSettings.principalSignatureUpdatedAt = '';
    updated = true;
  }
  if (!db.settings.idCardSettings) {
    db.settings.idCardSettings = {
      session: currentAcademicSession(db),
      principalSignatureName: "Anarul Hussain"
    };
    updated = true;
  }
  if (!db.teachers) {
    db.teachers = [];
    updated = true;
  }
  // Remove legacy plaintext teacher passwords after the salted login hash is
  // known to exist. This preserves authentication while preventing profile
  // APIs and database backups from disclosing reusable credentials.
  (db.teachers || []).forEach(teacher => {
    const loginAccount = (db.teacherLogin || []).find(account =>
      account.teacher_id === teacher.empId || account.teacher_emp_id === teacher.empId
    );
    if (teacher.loginPassword && loginAccount?.password_hash && loginAccount?.password_salt) {
      delete teacher.loginPassword;
      updated = true;
    }
  });
  if (!db.teacherAttendance) {
    db.teacherAttendance = [];
    updated = true;
  }
  if (!db.teacherSalaries) {
    db.teacherSalaries = [];
    updated = true;
  }
  if (!db.teacherLogin) {
    db.teacherLogin = (db.teachers || []).map(t => {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(t.loginPassword || 'Teacher@123', salt, 1000, 64, 'sha512').toString('hex');
      return {
        id: 'tl_' + (t.empId || t.id),
        teacher_id: t.empId,
        username: (t.loginUsername || t.empId).toLowerCase(),
        password_hash: hash,
        password_salt: salt,
        status: t.status || 'Active',
        login_status: t.status || 'Active',
        failed_attempts: 0,
        is_locked: false,
        last_login: null,
        password_reset_token: null,
        token_expiry: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });
    updated = true;
  }
  // Repair legacy teacher-login foreign keys created with an internal record ID.
  // All synchronization now uses the stable employee ID.
  (db.teacherLogin || []).forEach(account => {
    const teacher = (db.teachers || []).find(t =>
      t.empId === account.teacher_emp_id ||
      t.empId === account.teacher_id ||
      t.id === account.teacher_id ||
      (account.username && [
        t.empId,
        t.loginUsername,
        t.email
      ].filter(Boolean).map(v => String(v).toLowerCase()).includes(String(account.username).toLowerCase()))
    );
    if (teacher && (account.teacher_id !== teacher.empId || account.teacher_emp_id !== teacher.empId)) {
      account.teacher_id = teacher.empId;
      account.teacher_emp_id = teacher.empId;
      updated = true;
    }
  });
  if (Array.isArray(db.teacherLogin)) {
    const normalizedAccounts = [];
    (db.teachers || []).forEach(teacher => {
      const candidates = db.teacherLogin.filter(account =>
        account.teacher_id === teacher.empId || account.teacher_emp_id === teacher.empId
      );
      if (!candidates.length) return;
      const preferredUsername = String(teacher.loginUsername || teacher.empId || '').toLowerCase();
      const preferred = candidates.find(account =>
        String(account.username || '').toLowerCase() === preferredUsername
      ) || candidates[0];
      normalizedAccounts.push(preferred);
    });
    if (normalizedAccounts.length !== db.teacherLogin.length) {
      db.teacherLogin = normalizedAccounts;
      updated = true;
    }
  }

  // Remove orphaned or exact duplicate workload rows left by older assignment
  // forms while preserving every valid multi-class/multi-subject assignment.
  if (Array.isArray(db.teacherAssignments)) {
    const validTeacherIds = new Set((db.teachers || []).map(t => t.empId));
    const seenAssignments = new Set();
    const repairedAssignments = db.teacherAssignments.map(a => a ? ({
      ...a,
      class_name: normalizeClassName(a.class_name),
      section: normalizeSectionName(a.section),
      academic_session: String(a.academic_session || currentAcademicSession(db)).trim()
    }) : a).filter(a => {
      if (!a || !validTeacherIds.has(a.teacher_id)) return false;
      const key = [
        a.teacher_id,
        String(a.class_name || '').trim().toLowerCase(),
        String(a.section || '').trim().toLowerCase(),
        String(a.subject_name || '').trim().toLowerCase(),
        a.academic_session || currentAcademicSession(db)
      ].join('|');
      if (seenAssignments.has(key)) return false;
      seenAssignments.add(key);
      return true;
    });
    if (JSON.stringify(repairedAssignments) !== JSON.stringify(db.teacherAssignments)) {
      db.teacherAssignments = repairedAssignments;
      updated = true;
    }
  }

  if (!db.teacherPermissions) {
    db.teacherPermissions = {};
    (db.teachers || []).forEach(t => {
      db.teacherPermissions[t.empId] = getDefaultTeacherPermissions();
    });
    updated = true;
  }
  if (!db.teacherLoginSessions) {
    db.teacherLoginSessions = [];
    updated = true;
  }
  if (!db.teacherActivityLogs) {
    db.teacherActivityLogs = [];
    updated = true;
  }

  const attendanceBefore = JSON.stringify(db.studentAttendance || []);
  ensureCentralStudentAttendance(db);
  if (JSON.stringify(db.studentAttendance) !== attendanceBefore) {
    rebuildLegacyAttendance(db);
    updated = true;
  }

  const mtUpdated = ensureMultiTenantSchema(db);
  if (mtUpdated) updated = true;

  const pcUpdated = ensurePrintCenterSchema(db);
  if (pcUpdated) updated = true;

  if (updated) {
    writeDbRaw(db);
  }
  return db;
}

function getSchoolBuiltinTemplates(school) {
  const isDefaultSchool = !school || school?.id === DEFAULT_SCHOOL_ID;
  const schoolName = school?.name || (isDefaultSchool ? 'Garumara Jatiya Vidyalaya' : 'School Name');
  const schoolLogo = school?.logo || (isDefaultSchool ? '/logo.jpg' : '/neutral-school-logo.svg');
  const schoolAddress = school ? ([school.address, school.city, school.state].filter(Boolean).join(', ') || school.address || '') : '';
  const schoolPhone = school?.phone || '';
  const schoolWebsite = school?.websiteUrl || '';
  const principalName = school?.principalName || '';

  const baseFields = {
    fatherName: { enabled: true, label: "Father's Name", icon: 'F/N' },
    dob: { enabled: true, label: 'Date of Birth', icon: 'DOB' },
    admissionNo: { enabled: true, label: 'Admission No.', icon: 'ID' },
    classSection: { enabled: true, label: 'Class & Section', icon: 'CLS' },
    rollNo: { enabled: true, label: 'Roll Number', icon: 'NO.' },
    session: { enabled: true, label: 'Academic Session', icon: 'YR' },
    bloodGroup: { enabled: false, label: 'Blood Group', icon: 'BG' },
    emergencyContact: { enabled: false, label: 'Emergency Contact', icon: 'EMG' },
    address: { enabled: false, label: 'Address', icon: 'ADDR' }
  };

  const baseBackSide = {
    enabled: true,
    heading: 'RULES & INSTRUCTIONS',
    terms: '1. This card is valid for the academic session specified.\n2. In case of loss, report immediately to the school office.\n3. This card is non-transferable and must be presented on demand.',
    emergencyHelpline: schoolPhone,
    returnAddress: schoolAddress,
    showBarcode: false,
    showQrCode: false
  };

  return [
    {
      id: 'royal-blue',
      name: 'Royal Blue Professional',
      description: 'Royal blue & gold wave header, floating class/roll wing badges around the portrait, royal ribbon name banner, and rounded capsule data cells.',
      layoutStyle: 'royal-blue',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 31, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#fde68a',
        headerBgColor: '#0b3b75', headerBgColorEnd: '#051d3b', cardBgColor: '#ffffff',
        accentColor: '#d4a038', textColor: '#082f55', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 74, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 188, photoHeight: 238, photoBorderRadius: 28, photoBorderColor: '#d4a038', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#ffffff', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields }, fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'modern-minimal',
      name: 'Modern Minimal',
      description: 'Full-height dark-slate left profile sidebar with photo & ID pill, paired with a clean white editorial right canvas, 2-column capsule grid, and bottom QR dock.',
      layoutStyle: 'modern-minimal',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#0f172a',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11, cardHeadingColor: '#0284c7',
        headerBgColor: '#f8fafc', headerBgColorEnd: '#f1f5f9', cardBgColor: '#ffffff',
        accentColor: '#0284c7', textColor: '#0f172a', fontFamily: 'Inter, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 176, photoHeight: 218, photoBorderRadius: 20, photoBorderColor: '#38bdf8', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 25, nameFontWeight: '800', nameColor: '#ffffff', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 74, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'premium-gold',
      name: 'Premium Gold',
      description: 'Regal obsidian-navy & metallic gold header over a warm pearl-ivory print-friendly body with dual gold filigree borders, crest watermark, and gold capsule cells.',
      layoutStyle: 'premium-gold',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '700', schoolNameColor: '#fde68a',
        cardHeading: 'OFFICIAL STUDENT CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#fbbf24',
        headerBgColor: '#0a192f', headerBgColorEnd: '#040d1a', cardBgColor: '#fffdf9',
        accentColor: '#d97706', textColor: '#0a192f', fontFamily: 'Georgia, serif',
        headerStyle: 'regal', showLogo: true, logoSize: 74, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 192, photoHeight: 244, photoBorderRadius: 24, photoBorderColor: '#d97706', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 28, nameFontWeight: '700', nameColor: '#0a192f', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'crest', accentStripe: true },
      signature: { showSignature: true, label: 'Head of Institution', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'emerald-academic',
      name: 'Emerald Academic',
      description: 'Forest emerald & gold wave header, side-by-side horizontal hero profile card, and structured academic particulars table with mint-emerald capsules.',
      layoutStyle: 'emerald-academic',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 31, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#a7f3d0',
        headerBgColor: '#064e3b', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
        accentColor: '#10b981', textColor: '#064e3b', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 74, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 154, photoHeight: 194, photoBorderRadius: 18, photoBorderColor: '#10b981', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 26, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
        alignment: 'left', fields: { ...baseFields }, fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'maroon-classic',
      name: 'Maroon Classic',
      description: 'Heritage crimson-maroon & gold curved header, double-ringed portrait frame, maroon ribbon student banner, and formal convent-style bordered ledger table.',
      layoutStyle: 'maroon-classic',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '700', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#fde68a',
        headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#fdfbf7',
        accentColor: '#991b1b', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 188, photoHeight: 238, photoBorderRadius: 14, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 26, nameFontWeight: '700', nameColor: '#ffffff', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields }, fieldFontSize: 13, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'sky-wave',
      name: 'Sky Blue Wave',
      description: 'Ocean cerulean & sky cyan dual-wave S-curve header, squircle portrait frame, capsule student badge, and rounded sky-tinted data cells.',
      layoutStyle: 'sky-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 31, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 12, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0284c7', headerBgColorEnd: '#0c4a6e', cardBgColor: '#ffffff',
        accentColor: '#0ea5e9', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 74, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 196, photoHeight: 248, photoBorderRadius: 36, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 29, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'purple-innovation',
      name: 'Purple Innovation',
      description: 'Royal violet wave-cut landscape pass with overlapping lavender profile card, rounded violet capsule data cells, and horizontal verification dock.',
      layoutStyle: 'purple-innovation',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'INNOVATION ACADEMY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#f3e8ff',
        headerBgColor: '#581c87', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
        accentColor: '#9333ea', textColor: '#2e1065', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 26, photoBorderColor: '#9333ea', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#3b0764', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 72, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'orange-energy',
      name: 'Orange Energy',
      description: 'Sunset amber-orange dual-wave curve header, squircle portrait frame, warm capsule student name badge, and rounded amber-tinted data cells.',
      layoutStyle: 'orange-energy',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 31, schoolNameFontWeight: '900', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#ffedd5',
        headerBgColor: '#ea580c', headerBgColorEnd: '#9a3412', cardBgColor: '#ffffff',
        accentColor: '#f97316', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 74, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 194, photoHeight: 246, photoBorderRadius: 32, photoBorderColor: '#ea580c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 29, nameFontWeight: '900', nameColor: '#9a3412', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'executive-vertical',
      name: 'Executive Vertical',
      description: 'Executive indigo-slate curved header with top lanyard slot bezel, squircle portrait frame, capsule student badge, and rounded slate-tinted data cells.',
      layoutStyle: 'executive-vertical',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL ACADEMIC CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#e2e8f0',
        headerBgColor: '#1e293b', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#3b82f6', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 194, photoHeight: 246, photoBorderRadius: 30, photoBorderColor: '#2563eb', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 28, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' }, emergencyContact: { enabled: true, label: 'Emergency Contact', icon: 'EMG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'barcode', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'smart-digital',
      name: 'Smart Digital',
      description: 'Cyber-navy & electric cyan wave-trimmed smart pass with gold EMV chip, squircle portrait with verified pill, cyan capsule data grid, and QR authority dock.',
      layoutStyle: 'smart-digital',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SMART CAMPUS PASS', cardHeadingFontSize: 11, cardHeadingColor: '#67e8f9',
        headerBgColor: '#0f172a', headerBgColorEnd: '#0369a1', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 174, photoHeight: 216, photoBorderRadius: 24, photoBorderColor: '#06b6d4', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 25, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
        alignment: 'left', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' }, emergencyContact: { enabled: true, label: 'Emergency Contact', icon: 'EMG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 82, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Campus Authority', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'ocean-breeze',
      name: 'Ocean Breeze Wave',
      description: 'Unique classic overlap architecture with s wave header, squircle portrait frame, and capsule data layout.',
      layoutStyle: 'ocean-breeze',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0369a1', headerBgColorEnd: '#075985', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'sapphire-crest',
      name: 'Sapphire Royal Crest',
      description: 'Unique left spine architecture with inverted arch header, arch window portrait frame, and stat bar grid data layout.',
      layoutStyle: 'sapphire-crest',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fde68a',
        headerBgColor: '#1d4ed8', headerBgColorEnd: '#1e3a8a', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#1e3a8a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e3a8a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'teal-horizon',
      name: 'Teal Horizon Spine',
      description: 'Unique right ribbon architecture with reverse slash header, hexagon portrait frame, and hex node data layout.',
      layoutStyle: 'teal-horizon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
        headerBgColor: '#0f766e', headerBgColorEnd: '#115e59', cardBgColor: '#ffffff',
        accentColor: '#14b8a6', textColor: '#134e4a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'crimson-scholar',
      name: 'Crimson Scholar Pavilion',
      description: 'Unique floating header box architecture with hex bevel header, polaroid frame portrait frame, and split pill data layout.',
      layoutStyle: 'crimson-scholar',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
        headerBgColor: '#b91c1c', headerBgColorEnd: '#7f1d1d', cardBgColor: '#ffffff',
        accentColor: '#f43f5e', textColor: '#7f1d1d', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#b91c1c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#7f1d1d', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'indigo-modern',
      name: 'Indigo Modern Ticket',
      description: 'Unique double frame crest architecture with ribbon fold header, shield crest portrait frame, and minimal underline data layout.',
      layoutStyle: 'indigo-modern',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
        headerBgColor: '#4338ca', headerBgColorEnd: '#312e81', cardBgColor: '#ffffff',
        accentColor: '#6366f1', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#4338ca', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'amber-sunburst',
      name: 'Amber Sunburst Showcase',
      description: 'Unique pavilion hero architecture with gold emblem rule header, notched tech portrait frame, and minimal underline data layout.',
      layoutStyle: 'amber-sunburst',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#d97706', headerBgColorEnd: '#92400e', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#78350f', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#d97706', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#78350f', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'forest-heritage',
      name: 'Forest Heritage Ledger',
      description: 'Unique corner geometric architecture with royal arch header, arch window portrait frame, and floating tag data layout.',
      layoutStyle: 'forest-heritage',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#15803d', headerBgColorEnd: '#14532d', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#14532d', fontFamily: 'Georgia, serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#15803d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#14532d', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cobalt-executive-land',
      name: 'Cobalt Executive Sidebar',
      description: 'Unique land left sidebar architecture with dual wave header, hexagon portrait frame, and formal table data layout.',
      layoutStyle: 'cobalt-executive-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11, cardHeadingColor: '#bae6fd',
        headerBgColor: '#1e40af', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#0284c7', textColor: '#0f172a', fontFamily: 'Inter, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 18, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'rose-blossom',
      name: 'Rose Blossom Ribbon',
      description: 'Unique lanyard ticket architecture with diagonal slash header, hexagon portrait frame, and dotted leader data layout.',
      layoutStyle: 'rose-blossom',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fce7f3',
        headerBgColor: '#be123c', headerBgColorEnd: '#881337', cardBgColor: '#ffffff',
        accentColor: '#ec4899', textColor: '#881337', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#be123c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#881337', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'slate-corporate',
      name: 'Slate Corporate Lanyard',
      description: 'Unique frosted inner card architecture with scallop arch header, polaroid frame portrait frame, and striped rows data layout.',
      layoutStyle: 'slate-corporate',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#334155', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#0ea5e9', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#334155', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'turquoise-wave',
      name: 'Turquoise Hex Bevel',
      description: 'Unique magazine showcase architecture with crown peaks header, shield crest portrait frame, and top accent data layout.',
      layoutStyle: 'turquoise-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0891b2', headerBgColorEnd: '#155e75', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#164e63', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0891b2', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#164e63', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'burgundy-convent',
      name: 'Burgundy Convent Frame',
      description: 'Unique classic overlap architecture with gold emblem rule header, notched tech portrait frame, and top accent data layout.',
      layoutStyle: 'burgundy-convent',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#881337', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#4c0519', fontFamily: 'Georgia, serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#881337', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'emerald-wave',
      name: 'Emerald Frosted Card',
      description: 'Unique left spine architecture with royal arch header, reverse leaf portrait frame, and left accent data layout.',
      layoutStyle: 'emerald-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#d1fae5',
        headerBgColor: '#059669', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
        accentColor: '#10b981', textColor: '#064e3b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#059669', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'violet-zenith-land',
      name: 'Violet Zenith Smart Pass',
      description: 'Unique land smart pass architecture with chevron crest header, arch window portrait frame, and minimal underline data layout.',
      layoutStyle: 'violet-zenith-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11, cardHeadingColor: '#ede9fe',
        headerBgColor: '#6d28d9', headerBgColorEnd: '#4c1d95', cardBgColor: '#ffffff',
        accentColor: '#8b5cf6', textColor: '#2e1065', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 44, photoBorderColor: '#6d28d9', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'navy-gold-wave',
      name: 'Navy & Gold Crown Pass',
      description: 'Unique right ribbon architecture with diagonal slash header, hexagon portrait frame, and ledger box data layout.',
      layoutStyle: 'navy-gold-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#1e3a8a', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'coral-sunrise',
      name: 'Coral Sunrise Diagonal',
      description: 'Unique floating header box architecture with scallop arch header, polaroid frame portrait frame, and formal table data layout.',
      layoutStyle: 'coral-sunrise',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
        headerBgColor: '#e11d48', headerBgColorEnd: '#9f1239', cardBgColor: '#ffffff',
        accentColor: '#fb7185', textColor: '#881337', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#e11d48', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#881337', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cerulean-arch',
      name: 'Cerulean Arch Wing Pass',
      description: 'Unique double frame crest architecture with crown peaks header, shield crest portrait frame, and capsule data layout.',
      layoutStyle: 'cerulean-arch',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0284c7', headerBgColorEnd: '#0369a1', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'olive-academy',
      name: 'Olive Academy Box',
      description: 'Unique pavilion hero architecture with sawtooth trim header, notched tech portrait frame, and capsule data layout.',
      layoutStyle: 'olive-academy',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#ecfccb',
        headerBgColor: '#3f6212', headerBgColorEnd: '#1a2e05', cardBgColor: '#ffffff',
        accentColor: '#65a30d', textColor: '#1a2e05', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#3f6212', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1a2e05', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'plum-royal',
      name: 'Plum Royal Scallop',
      description: 'Unique corner geometric architecture with dual wave header, reverse leaf portrait frame, and stat bar grid data layout.',
      layoutStyle: 'plum-royal',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#f3e8ff',
        headerBgColor: '#7e22ce', headerBgColorEnd: '#581c87', cardBgColor: '#ffffff',
        accentColor: '#a855f7', textColor: '#3b0764', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#7e22ce', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#3b0764', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'teal-smart-land',
      name: 'Teal Smart Campus Pass',
      description: 'Unique land overlap card architecture with stepped cradle header, squircle portrait frame, and left accent data layout.',
      layoutStyle: 'teal-smart-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#ccfbf1',
        headerBgColor: '#0f766e', headerBgColorEnd: '#134e4a', cardBgColor: '#ffffff',
        accentColor: '#14b8a6', textColor: '#134e4a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 32, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'azure-ribbon',
      name: 'Azure Origami Fold',
      description: 'Unique lanyard ticket architecture with chevron crest header, circle ring portrait frame, and hex node data layout.',
      layoutStyle: 'azure-ribbon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
        headerBgColor: '#2563eb', headerBgColorEnd: '#1d4ed8', cardBgColor: '#ffffff',
        accentColor: '#3b82f6', textColor: '#1e3a8a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#2563eb', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e3a8a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'bronze-imperial',
      name: 'Bronze Imperial Medallion',
      description: 'Unique frosted inner card architecture with stepped cradle header, polaroid frame portrait frame, and split pill data layout.',
      layoutStyle: 'bronze-imperial',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fde68a',
        headerBgColor: '#78350f', headerBgColorEnd: '#451a03', cardBgColor: '#ffffff',
        accentColor: '#d97706', textColor: '#451a03', fontFamily: 'Georgia, serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#78350f', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'mint-fresh',
      name: 'Mint Fresh Spine Pass',
      description: 'Unique magazine showcase architecture with asymmetric sweep header, shield crest portrait frame, and minimal underline data layout.',
      layoutStyle: 'mint-fresh',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
        headerBgColor: '#0d9488', headerBgColorEnd: '#0f766e', cardBgColor: '#ffffff',
        accentColor: '#14b8a6', textColor: '#134e4a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0d9488', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'crimson-wave',
      name: 'Crimson Sawtooth Shield',
      description: 'Unique classic overlap architecture with sawtooth trim header, notched tech portrait frame, and minimal underline data layout.',
      layoutStyle: 'crimson-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fee2e2',
        headerBgColor: '#dc2626', headerBgColorEnd: '#991b1b', cardBgColor: '#ffffff',
        accentColor: '#ef4444', textColor: '#7f1d1d', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#dc2626', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#7f1d1d', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'midnight-cyan-land',
      name: 'Midnight Cyan VIP Pass',
      description: 'Unique land right vip architecture with asymmetric sweep header, leaf drop portrait frame, and hex node data layout.',
      layoutStyle: 'midnight-cyan-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#cffafe',
        headerBgColor: '#090d16', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 34, photoBorderColor: '#090d16', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'indigo-wing',
      name: 'Indigo Winged Scholar',
      description: 'Unique left spine architecture with dual wave header, reverse leaf portrait frame, and floating tag data layout.',
      layoutStyle: 'indigo-wing',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
        headerBgColor: '#3730a3', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
        accentColor: '#4f46e5', textColor: '#1e1b4b', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#3730a3', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'tangerine-wave',
      name: 'Tangerine Geometric Cut',
      description: 'Unique right ribbon architecture with chevron crest header, circle ring portrait frame, and dotted leader data layout.',
      layoutStyle: 'tangerine-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffedd5',
        headerBgColor: '#f97316', headerBgColorEnd: '#c2410c', cardBgColor: '#ffffff',
        accentColor: '#fb923c', textColor: '#7c2d12', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#f97316', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#7c2d12', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'jade-scholar',
      name: 'Jade Scholar Table',
      description: 'Unique floating header box architecture with stepped cradle header, diamond cut portrait frame, and striped rows data layout.',
      layoutStyle: 'jade-scholar',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#d1fae5',
        headerBgColor: '#047857', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
        accentColor: '#10b981', textColor: '#064e3b', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#047857', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'magenta-modern',
      name: 'Magenta Modern Pavilion',
      description: 'Unique double frame crest architecture with asymmetric sweep header, shield crest portrait frame, and top accent data layout.',
      layoutStyle: 'magenta-modern',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#fae8ff',
        headerBgColor: '#a21caf', headerBgColorEnd: '#701a75', cardBgColor: '#ffffff',
        accentColor: '#d946ef', textColor: '#4a044e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#a21caf', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'royal-gold-land',
      name: 'Royal Gold Horizon Pass',
      description: 'Unique land horizon split architecture with stadium curve header, corner brackets portrait frame, and striped rows data layout.',
      layoutStyle: 'royal-gold-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11, cardHeadingColor: '#fde68a',
        headerBgColor: '#1e3a8a', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#d97706', textColor: '#0f172a', fontFamily: 'Georgia, serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 10, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'peacock-blue',
      name: 'Peacock Blue Ticket',
      description: 'Unique pavilion hero architecture with stadium curve header, notched tech portrait frame, and top accent data layout.',
      layoutStyle: 'peacock-blue',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0369a1', headerBgColorEnd: '#164e63', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'garnet-shield',
      name: 'Garnet Shield Identity',
      description: 'Unique corner geometric architecture with s wave header, reverse leaf portrait frame, and left accent data layout.',
      layoutStyle: 'garnet-shield',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fde68a',
        headerBgColor: '#991b1b', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#991b1b', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cobalt-wave',
      name: 'Cobalt Frosted Showcase',
      description: 'Unique lanyard ticket architecture with inverted arch header, circle ring portrait frame, and ledger box data layout.',
      layoutStyle: 'cobalt-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
        headerBgColor: '#1d4ed8', headerBgColorEnd: '#1e3a8a', cardBgColor: '#ffffff',
        accentColor: '#3b82f6', textColor: '#172554', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#172554', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cypress-split',
      name: 'Cypress Split Hero',
      description: 'Unique frosted inner card architecture with reverse slash header, diamond cut portrait frame, and formal table data layout.',
      layoutStyle: 'cypress-split',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#dcfce7',
        headerBgColor: '#166534', headerBgColorEnd: '#052e16', cardBgColor: '#ffffff',
        accentColor: '#22c55e', textColor: '#052e16', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#166534', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#052e16', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'amethyst-wave-land',
      name: 'Amethyst Wave Landscape',
      description: 'Unique land left sidebar architecture with s wave header, octagon portrait frame, and capsule data layout.',
      layoutStyle: 'amethyst-wave-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11, cardHeadingColor: '#ede9fe',
        headerBgColor: '#5b21b6', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
        accentColor: '#8b5cf6', textColor: '#2e1065', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 20, photoBorderColor: '#5b21b6', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'navy-horizon',
      name: 'Navy Horizon Banner',
      description: 'Unique magazine showcase architecture with hex bevel header, octagon portrait frame, and capsule data layout.',
      layoutStyle: 'navy-horizon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0f172a', headerBgColorEnd: '#1e293b', cardBgColor: '#ffffff',
        accentColor: '#0284c7', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#0f172a', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'saffron-heritage',
      name: 'Saffron Heritage Crest',
      description: 'Unique classic overlap architecture with stadium curve header, notched tech portrait frame, and capsule data layout.',
      layoutStyle: 'saffron-heritage',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#c2410c', headerBgColorEnd: '#7c2d12', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#431407', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#c2410c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#431407', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'arctic-blue',
      name: 'Arctic Blue Scholar Box',
      description: 'Unique left spine architecture with s wave header, reverse leaf portrait frame, and stat bar grid data layout.',
      layoutStyle: 'arctic-blue',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0284c7', headerBgColorEnd: '#075985', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'mulberry-classic',
      name: 'Mulberry Classic Ledger',
      description: 'Unique right ribbon architecture with inverted arch header, circle ring portrait frame, and hex node data layout.',
      layoutStyle: 'mulberry-classic',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fae8ff',
        headerBgColor: '#701a75', headerBgColorEnd: '#4a044e', cardBgColor: '#ffffff',
        accentColor: '#d946ef', textColor: '#4a044e', fontFamily: 'Georgia, serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#701a75', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'emerald-smart-land',
      name: 'Emerald Smart Campus Pass',
      description: 'Unique land smart pass architecture with inverted arch header, diamond cut portrait frame, and floating tag data layout.',
      layoutStyle: 'emerald-smart-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11, cardHeadingColor: '#d1fae5',
        headerBgColor: '#065f46', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
        accentColor: '#10b981', textColor: '#022c22', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 16, photoBorderColor: '#065f46', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'denim-modern',
      name: 'Denim Right-Ribbon Pass',
      description: 'Unique floating header box architecture with reverse slash header, diamond cut portrait frame, and split pill data layout.',
      layoutStyle: 'denim-modern',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
        headerBgColor: '#1e40af', headerBgColorEnd: '#172554', cardBgColor: '#ffffff',
        accentColor: '#3b82f6', textColor: '#1e3a8a', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e3a8a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'ruby-executive',
      name: 'Ruby Executive Badge',
      description: 'Unique double frame crest architecture with hex bevel header, octagon portrait frame, and minimal underline data layout.',
      layoutStyle: 'ruby-executive',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
        headerBgColor: '#be123c', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
        accentColor: '#f43f5e', textColor: '#4c0519', fontFamily: 'Roboto, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#be123c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'lagoon-wave',
      name: 'Lagoon Arch Window',
      description: 'Unique pavilion hero architecture with ribbon fold header, corner brackets portrait frame, and minimal underline data layout.',
      layoutStyle: 'lagoon-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0e7490', headerBgColorEnd: '#083344', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#0e7490', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'gold-sovereign',
      name: 'Gold Sovereign Crest',
      description: 'Unique corner geometric architecture with gold emblem rule header, reverse leaf portrait frame, and floating tag data layout.',
      layoutStyle: 'gold-sovereign',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#1e293b', headerBgColorEnd: '#090d16', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#0f172a', fontFamily: 'Georgia, serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#1e293b', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'crimson-sidebar-land',
      name: 'Crimson Executive Sidebar',
      description: 'Unique land overlap card architecture with reverse slash header, circle ring portrait frame, and ledger box data layout.',
      layoutStyle: 'crimson-sidebar-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11, cardHeadingColor: '#fde68a',
        headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
        accentColor: '#d97706', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'executive', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 50, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'periwinkle-wave',
      name: 'Periwinkle Polaroid Pass',
      description: 'Unique lanyard ticket architecture with royal arch header, circle ring portrait frame, and dotted leader data layout.',
      layoutStyle: 'periwinkle-wave',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
        headerBgColor: '#4f46e5', headerBgColorEnd: '#312e81', cardBgColor: '#ffffff',
        accentColor: '#818cf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#4f46e5', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'pine-crest',
      name: 'Pine Crest Scholar',
      description: 'Unique frosted inner card architecture with diagonal slash header, diamond cut portrait frame, and striped rows data layout.',
      layoutStyle: 'pine-crest',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#14532d', headerBgColorEnd: '#052e16', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#052e16', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#14532d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#052e16', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'ochre-modern',
      name: 'Ochre Modern Split',
      description: 'Unique magazine showcase architecture with scallop arch header, octagon portrait frame, and top accent data layout.',
      layoutStyle: 'ochre-modern',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#b45309', headerBgColorEnd: '#78350f', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#451a03', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#b45309', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'glacier-wave-land',
      name: 'Glacier VIP Landscape',
      description: 'Unique land right vip architecture with hex bevel header, reverse leaf portrait frame, and split pill data layout.',
      layoutStyle: 'glacier-wave-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0369a1', headerBgColorEnd: '#0c4a6e', cardBgColor: '#ffffff',
        accentColor: '#0ea5e9', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 34, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'imperial-indigo-land',
      name: 'Imperial Indigo Smart Pass',
      description: 'Unique land horizon split architecture with ribbon fold header, notched tech portrait frame, and top accent data layout.',
      layoutStyle: 'imperial-indigo-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#312e81', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 12, photoBorderColor: '#312e81', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'aurora-teal-spine',
      name: 'Aurora Teal Vertical Spine',
      description: 'Unique classic overlap architecture with ribbon fold header, corner brackets portrait frame, and top accent data layout.',
      layoutStyle: 'aurora-teal-spine',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
        headerBgColor: '#0f766e', headerBgColorEnd: '#042f2e', cardBgColor: '#ffffff',
        accentColor: '#2dd4bf', textColor: '#042f2e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#042f2e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'imperial-maroon-pavilion',
      name: 'Imperial Maroon Pavilion',
      description: 'Unique left spine architecture with gold emblem rule header, leaf drop portrait frame, and left accent data layout.',
      layoutStyle: 'imperial-maroon-pavilion',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
        accentColor: '#fbbf24', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cyber-indigo-hexagon',
      name: 'Cyber Indigo Hex Grid',
      description: 'Unique right ribbon architecture with royal arch header, circle ring portrait frame, and ledger box data layout.',
      layoutStyle: 'cyber-indigo-hexagon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#312e81', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#312e81', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'emerald-ivy-frame',
      name: 'Emerald Ivy Double Frame',
      description: 'Unique floating header box architecture with diagonal slash header, diamond cut portrait frame, and formal table data layout.',
      layoutStyle: 'emerald-ivy-frame',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#065f46', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
        accentColor: '#fbbf24', textColor: '#022c22', fontFamily: 'Georgia, serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#065f46', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'sunset-amber-ticket',
      name: 'Sunset Amber Ticket Pass',
      description: 'Unique double frame crest architecture with scallop arch header, octagon portrait frame, and capsule data layout.',
      layoutStyle: 'sunset-amber-ticket',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffedd5',
        headerBgColor: '#c2410c', headerBgColorEnd: '#7c2d12', cardBgColor: '#ffffff',
        accentColor: '#fb923c', textColor: '#431407', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#c2410c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#431407', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'nordic-slate-minimal',
      name: 'Nordic Slate Minimal Box',
      description: 'Unique pavilion hero architecture with crown peaks header, corner brackets portrait frame, and capsule data layout.',
      layoutStyle: 'nordic-slate-minimal',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#1e293b', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Inter, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#1e293b', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'royal-amethyst-ribbon',
      name: 'Royal Amethyst Right Ribbon',
      description: 'Unique corner geometric architecture with sawtooth trim header, leaf drop portrait frame, and stat bar grid data layout.',
      layoutStyle: 'royal-amethyst-ribbon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fae8ff',
        headerBgColor: '#581c87', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
        accentColor: '#e879f9', textColor: '#2e1065', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#581c87', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'pacific-cobalt-showcase',
      name: 'Pacific Cobalt Showcase',
      description: 'Unique lanyard ticket architecture with dual wave header, squircle portrait frame, and hex node data layout.',
      layoutStyle: 'pacific-cobalt-showcase',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#1d4ed8', headerBgColorEnd: '#172554', cardBgColor: '#ffffff',
        accentColor: '#22d3ee', textColor: '#172554', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#172554', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'crimson-gold-horizon-land',
      name: 'Crimson Gold Horizon Land',
      description: 'Unique land left sidebar architecture with gold emblem rule header, shield crest portrait frame, and stat bar grid data layout.',
      layoutStyle: 'crimson-gold-horizon-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11, cardHeadingColor: '#fef08a',
        headerBgColor: '#991b1b', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 26, photoBorderColor: '#991b1b', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'botanical-sage-arch',
      name: 'Botanical Sage Arch Window',
      description: 'Unique frosted inner card architecture with chevron crest header, diamond cut portrait frame, and split pill data layout.',
      layoutStyle: 'botanical-sage-arch',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#ecfccb',
        headerBgColor: '#3f6212', headerBgColorEnd: '#1a2e05', cardBgColor: '#ffffff',
        accentColor: '#a3e635', textColor: '#1a2e05', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#3f6212', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1a2e05', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'oxford-navy-striped',
      name: 'Oxford Navy Striped Ledger',
      description: 'Unique magazine showcase architecture with stepped cradle header, octagon portrait frame, and minimal underline data layout.',
      layoutStyle: 'oxford-navy-striped',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#1e3a8a', headerBgColorEnd: '#090d16', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#0f172a', fontFamily: 'Georgia, serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'flamingo-rose-frosted',
      name: 'Flamingo Rose Frosted Pass',
      description: 'Unique classic overlap architecture with crown peaks header, corner brackets portrait frame, and minimal underline data layout.',
      layoutStyle: 'flamingo-rose-frosted',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fce7f3',
        headerBgColor: '#be185d', headerBgColorEnd: '#500724', cardBgColor: '#ffffff',
        accentColor: '#f472b6', textColor: '#500724', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#be185d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#500724', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'titanium-cyan-corner',
      name: 'Titanium Cyan Corner Cut',
      description: 'Unique left spine architecture with sawtooth trim header, leaf drop portrait frame, and floating tag data layout.',
      layoutStyle: 'titanium-cyan-corner',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0f172a', headerBgColorEnd: '#1e293b', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#0f172a', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'copper-leaf-academy',
      name: 'Copper Leaf Academy Card',
      description: 'Unique right ribbon architecture with dual wave header, squircle portrait frame, and dotted leader data layout.',
      layoutStyle: 'copper-leaf-academy',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#9a3412', headerBgColorEnd: '#431407', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#431407', fontFamily: 'Georgia, serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#9a3412', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#431407', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'sapphire-vip-land',
      name: 'Sapphire Right-VIP Landscape',
      description: 'Unique land smart pass architecture with royal arch header, polaroid frame portrait frame, and dotted leader data layout.',
      layoutStyle: 'sapphire-vip-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#1e40af', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 14, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'velvet-plum-polaroid',
      name: 'Velvet Plum Polaroid Crest',
      description: 'Unique floating header box architecture with chevron crest header, arch window portrait frame, and striped rows data layout.',
      layoutStyle: 'velvet-plum-polaroid',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#f3e8ff',
        headerBgColor: '#6b21a8', headerBgColorEnd: '#3b0764', cardBgColor: '#ffffff',
        accentColor: '#c084fc', textColor: '#3b0764', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#6b21a8', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#3b0764', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'aquamarine-crown-pass',
      name: 'Aquamarine Crown Peak Pass',
      description: 'Unique double frame crest architecture with stepped cradle header, octagon portrait frame, and top accent data layout.',
      layoutStyle: 'aquamarine-crown-pass',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
        headerBgColor: '#0e7490', headerBgColorEnd: '#164e63', cardBgColor: '#ffffff',
        accentColor: '#2dd4bf', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#0e7490', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'charcoal-gold-pavilion',
      name: 'Charcoal Gold Pavilion',
      description: 'Unique pavilion hero architecture with asymmetric sweep header, corner brackets portrait frame, and top accent data layout.',
      layoutStyle: 'charcoal-gold-pavilion',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#18181b', headerBgColorEnd: '#09090b', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#09090b', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#18181b', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#09090b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cerulean-dotted-editorial',
      name: 'Cerulean Dotted Editorial',
      description: 'Unique corner geometric architecture with stadium curve header, leaf drop portrait frame, and left accent data layout.',
      layoutStyle: 'cerulean-dotted-editorial',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0284c7', headerBgColorEnd: '#0c4a6e', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0c4a6e', fontFamily: 'Inter, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'forest-mint-horizon-land',
      name: 'Forest Mint Horizon Land',
      description: 'Unique land overlap card architecture with diagonal slash header, hexagon portrait frame, and formal table data layout.',
      layoutStyle: 'forest-mint-horizon-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11, cardHeadingColor: '#d1fae5',
        headerBgColor: '#047857', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
        accentColor: '#34d399', textColor: '#022c22', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 18, photoBorderColor: '#047857', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'burgundy-gold-spine',
      name: 'Burgundy Gold Spine Pass',
      description: 'Unique lanyard ticket architecture with s wave header, squircle portrait frame, and ledger box data layout.',
      layoutStyle: 'burgundy-gold-spine',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#881337', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
        accentColor: '#fbbf24', textColor: '#4c0519', fontFamily: 'Georgia, serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#881337', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'electric-cobalt-notched',
      name: 'Electric Cobalt Notched Tech',
      description: 'Unique frosted inner card architecture with inverted arch header, arch window portrait frame, and formal table data layout.',
      layoutStyle: 'electric-cobalt-notched',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
        headerBgColor: '#2563eb', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
        accentColor: '#60a5fa', textColor: '#1e1b4b', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#2563eb', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'terracotta-warm-ticket',
      name: 'Terracotta Warm Ticket',
      description: 'Unique magazine showcase architecture with reverse slash header, hexagon portrait frame, and capsule data layout.',
      layoutStyle: 'terracotta-warm-ticket',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffedd5',
        headerBgColor: '#b45309', headerBgColorEnd: '#451a03', cardBgColor: '#ffffff',
        accentColor: '#fb923c', textColor: '#451a03', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#b45309', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'jade-lotus-scallop',
      name: 'Jade Lotus Scallop Card',
      description: 'Unique classic overlap architecture with asymmetric sweep header, corner brackets portrait frame, and capsule data layout.',
      layoutStyle: 'jade-lotus-scallop',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#d1fae5',
        headerBgColor: '#059669', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
        accentColor: '#6ee7b7', textColor: '#064e3b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#059669', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'obsidian-emerald-land',
      name: 'Obsidian Emerald VIP Land',
      description: 'Unique land right vip architecture with scallop arch header, arch window portrait frame, and minimal underline data layout.',
      layoutStyle: 'obsidian-emerald-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11, cardHeadingColor: '#d1fae5',
        headerBgColor: '#090d16', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
        accentColor: '#10b981', textColor: '#022c22', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 44, photoBorderColor: '#090d16', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'indigo-origami-ribbon',
      name: 'Indigo Origami Right Ribbon',
      description: 'Unique left spine architecture with stadium curve header, leaf drop portrait frame, and stat bar grid data layout.',
      layoutStyle: 'indigo-origami-ribbon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
        headerBgColor: '#3730a3', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
        accentColor: '#818cf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#3730a3', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'ruby-diamond-frame',
      name: 'Ruby Diamond Double Frame',
      description: 'Unique right ribbon architecture with s wave header, squircle portrait frame, and hex node data layout.',
      layoutStyle: 'ruby-diamond-frame',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
        headerBgColor: '#be123c', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
        accentColor: '#fda4af', textColor: '#4c0519', fontFamily: 'Georgia, serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#be123c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'sky-horizon-floating-box',
      name: 'Sky Horizon Floating Box',
      description: 'Unique floating header box architecture with inverted arch header, arch window portrait frame, and split pill data layout.',
      layoutStyle: 'sky-horizon-floating-box',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#0369a1', headerBgColorEnd: '#082f49', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#082f49', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#082f49', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'amethyst-gold-showcase',
      name: 'Amethyst Gold Showcase',
      description: 'Unique double frame crest architecture with reverse slash header, hexagon portrait frame, and minimal underline data layout.',
      layoutStyle: 'amethyst-gold-showcase',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#4c1d95', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#2e1065', fontFamily: 'Georgia, serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#4c1d95', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'teal-executive-sidebar-land',
      name: 'Teal Executive Sidebar Land',
      description: 'Unique land horizon split architecture with crown peaks header, squircle portrait frame, and left accent data layout.',
      layoutStyle: 'teal-executive-sidebar-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11, cardHeadingColor: '#ccfbf1',
        headerBgColor: '#0d9488', headerBgColorEnd: '#134e4a', cardBgColor: '#ffffff',
        accentColor: '#2dd4bf', textColor: '#134e4a', fontFamily: 'Inter, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 32, photoBorderColor: '#0d9488', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cobalt-sawtooth-corner',
      name: 'Cobalt Sawtooth Corner Cut',
      description: 'Unique pavilion hero architecture with hex bevel header, polaroid frame portrait frame, and minimal underline data layout.',
      layoutStyle: 'cobalt-sawtooth-corner',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#1d4ed8', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'olive-gold-spine',
      name: 'Olive Gold Vertical Spine',
      description: 'Unique corner geometric architecture with ribbon fold header, leaf drop portrait frame, and floating tag data layout.',
      layoutStyle: 'olive-gold-spine',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#365314', headerBgColorEnd: '#1a2e05', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#1a2e05', fontFamily: 'Georgia, serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#365314', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1a2e05', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'coral-frosted-inner',
      name: 'Coral Frosted Inner Card',
      description: 'Unique lanyard ticket architecture with gold emblem rule header, squircle portrait frame, and dotted leader data layout.',
      layoutStyle: 'coral-frosted-inner',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
        headerBgColor: '#e11d48', headerBgColorEnd: '#881337', cardBgColor: '#ffffff',
        accentColor: '#fda4af', textColor: '#881337', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#e11d48', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#881337', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'navy-bevel-split-pill',
      name: 'Navy Bevel Split-Pill Card',
      description: 'Unique frosted inner card architecture with royal arch header, arch window portrait frame, and striped rows data layout.',
      layoutStyle: 'navy-bevel-split-pill',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
        headerBgColor: '#1e3a8a', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
        accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'magenta-smart-pass-land',
      name: 'Magenta Smart Campus Land',
      description: 'Unique land left sidebar architecture with sawtooth trim header, leaf drop portrait frame, and hex node data layout.',
      layoutStyle: 'magenta-smart-pass-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11, cardHeadingColor: '#fae8ff',
        headerBgColor: '#86198f', headerBgColorEnd: '#4a044e', cardBgColor: '#ffffff',
        accentColor: '#e879f9', textColor: '#4a044e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 34, photoBorderColor: '#86198f', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'emerald-pavilion-crest',
      name: 'Emerald Pavilion Crest',
      description: 'Unique magazine showcase architecture with diagonal slash header, hexagon portrait frame, and top accent data layout.',
      layoutStyle: 'emerald-pavilion-crest',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#047857', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
        accentColor: '#fbbf24', textColor: '#064e3b', fontFamily: 'Georgia, serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#047857', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'amber-right-ribbon',
      name: 'Amber Right-Ribbon Scholar',
      description: 'Unique classic overlap architecture with hex bevel header, polaroid frame portrait frame, and top accent data layout.',
      layoutStyle: 'amber-right-ribbon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#d97706', headerBgColorEnd: '#78350f', cardBgColor: '#ffffff',
        accentColor: '#fbbf24', textColor: '#451a03', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#d97706', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'arctic-lanyard-ticket',
      name: 'Arctic Lanyard Ticket Pass',
      description: 'Unique left spine architecture with ribbon fold header, shield crest portrait frame, and left accent data layout.',
      layoutStyle: 'arctic-lanyard-ticket',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0284c7', headerBgColorEnd: '#075985', cardBgColor: '#ffffff',
        accentColor: '#22d3ee', textColor: '#083344', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'maroon-showcase-plaque',
      name: 'Maroon Showcase Plaque',
      description: 'Unique right ribbon architecture with gold emblem rule header, squircle portrait frame, and ledger box data layout.',
      layoutStyle: 'maroon-showcase-plaque',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'indigo-overlap-land',
      name: 'Indigo Overlap Landscape',
      description: 'Unique land smart pass architecture with dual wave header, corner brackets portrait frame, and striped rows data layout.',
      layoutStyle: 'indigo-overlap-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11, cardHeadingColor: '#e0e7ff',
        headerBgColor: '#4338ca', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
        accentColor: '#818cf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 10, photoBorderColor: '#4338ca', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'teal-double-frame',
      name: 'Teal Ornamental Frame',
      description: 'Unique floating header box architecture with royal arch header, arch window portrait frame, and formal table data layout.',
      layoutStyle: 'teal-double-frame',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#0f766e', headerBgColorEnd: '#042f2e', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#042f2e', fontFamily: 'Georgia, serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#042f2e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'violet-corner-polygon',
      name: 'Violet Corner Polygon Pass',
      description: 'Unique double frame crest architecture with diagonal slash header, hexagon portrait frame, and capsule data layout.',
      layoutStyle: 'violet-corner-polygon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#f3e8ff',
        headerBgColor: '#6d28d9', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
        accentColor: '#c084fc', textColor: '#2e1065', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#6d28d9', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'sapphire-floating-box',
      name: 'Sapphire Floating Header Box',
      description: 'Unique pavilion hero architecture with scallop arch header, polaroid frame portrait frame, and capsule data layout.',
      layoutStyle: 'sapphire-floating-box',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
        headerBgColor: '#1e40af', headerBgColorEnd: '#172554', cardBgColor: '#ffffff',
        accentColor: '#60a5fa', textColor: '#172554', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#172554', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'crimson-spine-academy',
      name: 'Crimson Spine Academy Card',
      description: 'Unique corner geometric architecture with crown peaks header, shield crest portrait frame, and stat bar grid data layout.',
      layoutStyle: 'crimson-spine-academy',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
        headerBgColor: '#b91c1c', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
        accentColor: '#fbbf24', textColor: '#450a0a', fontFamily: 'Georgia, serif',
        headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#b91c1c', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'bronze-vip-land',
      name: 'Bronze Right-VIP Landscape',
      description: 'Unique land overlap card architecture with chevron crest header, octagon portrait frame, and capsule data layout.',
      layoutStyle: 'bronze-vip-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11, cardHeadingColor: '#fef3c7',
        headerBgColor: '#78350f', headerBgColorEnd: '#451a03', cardBgColor: '#ffffff',
        accentColor: '#f59e0b', textColor: '#451a03', fontFamily: 'Georgia, serif',
        headerStyle: 'minimal', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 20, photoBorderColor: '#78350f', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'cyan-frosted-shield',
      name: 'Cyan Frosted Shield Pass',
      description: 'Unique lanyard ticket architecture with sawtooth trim header, notched tech portrait frame, and hex node data layout.',
      layoutStyle: 'cyan-frosted-shield',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
        headerBgColor: '#0891b2', headerBgColorEnd: '#083344', cardBgColor: '#ffffff',
        accentColor: '#22d3ee', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#0891b2', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'forest-pavilion-scholar',
      name: 'Forest Pavilion Scholar',
      description: 'Unique frosted inner card architecture with dual wave header, arch window portrait frame, and split pill data layout.',
      layoutStyle: 'forest-pavilion-scholar',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#dcfce7',
        headerBgColor: '#166534', headerBgColorEnd: '#052e16', cardBgColor: '#ffffff',
        accentColor: '#4ade80', textColor: '#052e16', fontFamily: 'Montserrat, sans-serif',
        headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#166534', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#052e16', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'plum-ticket-credential',
      name: 'Plum Ticket Credential',
      description: 'Unique magazine showcase architecture with chevron crest header, hexagon portrait frame, and minimal underline data layout.',
      layoutStyle: 'plum-ticket-credential',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fce7f3',
        headerBgColor: '#701a75', headerBgColorEnd: '#4a044e', cardBgColor: '#ffffff',
        accentColor: '#f472b6', textColor: '#4a044e', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#701a75', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'slate-gold-right-ribbon',
      name: 'Slate Gold Right Ribbon',
      description: 'Unique classic overlap architecture with scallop arch header, polaroid frame portrait frame, and minimal underline data layout.',
      layoutStyle: 'slate-gold-right-ribbon',
      cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
        headerBgColor: '#334155', headerBgColorEnd: '#090d16', cardBgColor: '#ffffff',
        accentColor: '#eab308', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
        headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#334155', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
      signature: { showSignature: true, label: 'Principal Signature', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    },
    {
      id: 'ocean-horizon-split-land',
      name: 'Ocean Horizon Split Land',
      description: 'Unique land right vip architecture with stepped cradle header, diamond cut portrait frame, and floating tag data layout.',
      layoutStyle: 'ocean-horizon-split-land',
      cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
      branding: {
        schoolName, schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
        cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#cffafe',
        headerBgColor: '#0369a1', headerBgColorEnd: '#082f49', cardBgColor: '#ffffff',
        accentColor: '#06b6d4', textColor: '#082f49', fontFamily: 'Outfit, sans-serif',
        headerStyle: 'pinstripe', showLogo: true, logoSize: 58, logoPosition: 'left',
        logoX: 0, logoY: 0, schoolAddress, schoolPhone, schoolWebsite
      },
      studentFields: {
        photoWidth: 172, photoHeight: 214, photoBorderRadius: 16, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
        photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#082f49', nameX: 0, nameY: 0,
        alignment: 'center', fields: { ...baseFields, bloodGroup: { enabled: true, label: 'Blood Group', icon: 'BG' } }, fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
      },
      decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
      signature: { showSignature: true, label: 'Authorized Signatory', principalName, principalSignatureImage: '', signatureX: 0, signatureY: 0, alignment: 'right' },
      backSide: { ...baseBackSide }
    }
  ];
}

function getDefaultIdCardDesign(school) {
  const templates = getSchoolBuiltinTemplates(school);
  const preferredId = school?.defaultTemplateId || 'royal-blue';
  const found = templates.find(t => t.id === preferredId);
  const base = found ? JSON.parse(JSON.stringify(found)) : JSON.parse(JSON.stringify(templates[0]));
  return {
    version: 2,
    templateId: base.id,
    layoutStyle: base.layoutStyle,
    cardSize: base.cardSize,
    branding: base.branding,
    studentFields: base.studentFields,
    decorations: base.decorations,
    signature: base.signature,
    backSide: base.backSide,
    updatedAt: new Date().toISOString()
  };
}

function ensurePrintCenterSchema(db) {
  let updated = false;
  if (!Array.isArray(db.printCenterAccounts)) {
    db.printCenterAccounts = [];
    updated = true;
  }
  if (!Array.isArray(db.printCenterAuditLogs)) {
    db.printCenterAuditLogs = [];
    updated = true;
  }

  (db.schools || []).forEach(school => {
    let acc = db.printCenterAccounts.find(a => a.school_id === school.id);
    if (!acc) {
      const isDefault = school.id === DEFAULT_SCHOOL_ID;
      const cleanUsername = isDefault && db.settings?.printPortalUsername
        ? String(db.settings.printPortalUsername).trim().toLowerCase()
        : `print.${school.code || school.id.toLowerCase()}@schoolerp.in`;
      
      let salt = isDefault && db.settings?.printPortalPasswordSalt ? db.settings.printPortalPasswordSalt : crypto.randomBytes(16).toString('hex');
      let hash = isDefault && db.settings?.printPortalPasswordHash ? db.settings.printPortalPasswordHash : crypto.pbkdf2Sync('PrintOperator@123', salt, 120000, 64, 'sha512').toString('hex');

      acc = {
        id: 'pca_' + school.id,
        school_id: school.id,
        school_name: school.name,
        school_code: school.code,
        username: cleanUsername,
        password_hash: hash,
        password_salt: salt,
        status: 'Active',
        access_enabled: true,
        token_version: 1,
        last_login: null,
        reset_token: null,
        reset_token_expiry: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      db.printCenterAccounts.push(acc);
      updated = true;
    } else {
      if (acc.school_name !== school.name) {
        acc.school_name = school.name;
        updated = true;
      }
      if (acc.school_code !== school.code) {
        acc.school_code = school.code;
        updated = true;
      }
      if (acc.token_version === undefined) {
        acc.token_version = 1;
        updated = true;
      }
      if (acc.access_enabled === undefined) {
        acc.access_enabled = true;
        updated = true;
      }
      if (!acc.status) {
        acc.status = 'Active';
        updated = true;
      }
    }

    if (!school.idCardDesign) {
      school.idCardDesign = getDefaultIdCardDesign(school);
      updated = true;
    }
  });

  return updated;
}

// ==============================================================
// VERCEL / PRODUCTION DEPLOYMENT DNS TARGET CONSTANTS & UTILITIES
// ==============================================================
const VERCEL_A_RECORD_IP = String(process.env.VERCEL_IP || process.env.CUSTOM_DOMAIN_A_IP || process.env.SERVER_IP || '76.76.21.21').trim();
const VERCEL_CNAME_TARGET = String(process.env.VERCEL_CNAME || process.env.CUSTOM_DOMAIN_CNAME || 'cname.vercel-dns.com').trim().toLowerCase();
const VERCEL_DNS_TTL = 600;

function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  let clean = input.trim().toLowerCase();
  clean = clean.replace(/^[a-z]+:\/\//i, '');
  clean = clean.replace(/\/.*$/, '');
  clean = clean.replace(/[?#].*$/, '');
  clean = clean.replace(/:\d+$/, '');
  clean = clean.replace(/^\.+|\.+$/g, '');
  return clean;
}

function analyzeDomainStructure(domain) {
  const clean = normalizeDomain(domain);
  const parts = clean.split('.');
  const multiPartTlds = new Set(['edu.in', 'gov.in', 'co.in', 'ac.in', 'org.in', 'net.in', 'co.uk', 'org.uk', 'com.au', 'net.au', 'org.au']);
  const lastTwo = parts.slice(-2).join('.');
  const isMultiPart = multiPartTlds.has(lastTwo);
  const domainPartCount = isMultiPart ? 3 : 2;
  const isApex = parts.length <= domainPartCount;
  
  let host = '@';
  let isWww = false;
  let subdomainPrefix = '';
  
  if (isApex) {
    host = '@';
  } else {
    const subParts = parts.slice(0, -domainPartCount);
    subdomainPrefix = subParts.join('.');
    host = subdomainPrefix;
    if (subdomainPrefix === 'www') isWww = true;
  }
  
  return {
    domain: clean,
    isApex,
    isWww,
    subdomainPrefix,
    host,
    apexDomain: isApex ? clean : parts.slice(-domainPartCount).join('.')
  };
}

function buildDnsRecordsForDomain(domain, verificationToken = '') {
  const info = analyzeDomainStructure(domain);
  const records = [];

  if (info.isApex) {
    // 1. Root / Apex record: A record pointing to Vercel Anycast IP
    records.push({
      id: 'rec_a_apex',
      step: 1,
      type: 'A',
      name: '@',
      host: '@',
      hostname: info.domain,
      value: VERCEL_A_RECORD_IP,
      data: VERCEL_A_RECORD_IP,
      target: VERCEL_A_RECORD_IP,
      ttl: VERCEL_DNS_TTL,
      purpose: 'Apex / Root Domain Routing (Required)',
      is_primary: true,
      note: '"@" points your apex/root domain (' + info.domain + ') to the active Vercel deployment IP (' + VERCEL_A_RECORD_IP + ').'
    });
    // 2. www record: CNAME pointing to Vercel CNAME target
    records.push({
      id: 'rec_cname_www',
      step: 2,
      type: 'CNAME',
      name: 'www',
      host: 'www',
      hostname: 'www.' + info.domain,
      value: VERCEL_CNAME_TARGET,
      data: VERCEL_CNAME_TARGET,
      target: VERCEL_CNAME_TARGET,
      ttl: VERCEL_DNS_TTL,
      purpose: 'WWW Subdomain Routing (Recommended)',
      is_primary: false,
      note: 'Allows visitors who type "www.' + info.domain + '" to reach your school portal seamlessly.'
    });
  } else if (info.isWww) {
    // www.example.com
    records.push({
      id: 'rec_cname_www',
      step: 1,
      type: 'CNAME',
      name: 'www',
      host: 'www',
      hostname: info.domain,
      value: VERCEL_CNAME_TARGET,
      data: VERCEL_CNAME_TARGET,
      target: VERCEL_CNAME_TARGET,
      ttl: VERCEL_DNS_TTL,
      purpose: 'WWW Subdomain Routing (Required)',
      is_primary: true,
      note: 'Points www.' + info.apexDomain + ' to the active Vercel deployment target (' + VERCEL_CNAME_TARGET + ').'
    });
    records.push({
      id: 'rec_a_apex_fallback',
      step: 2,
      type: 'A',
      name: '@',
      host: '@',
      hostname: info.apexDomain,
      value: VERCEL_A_RECORD_IP,
      data: VERCEL_A_RECORD_IP,
      target: VERCEL_A_RECORD_IP,
      ttl: VERCEL_DNS_TTL,
      purpose: 'Root Apex Routing (Recommended)',
      is_primary: false,
      note: '"@" points your root domain (' + info.apexDomain + ') to Vercel so visitors omitting "www" are routed properly.'
    });
  } else {
    // Custom subdomain, e.g. portal.myschool.edu
    records.push({
      id: 'rec_cname_sub',
      step: 1,
      type: 'CNAME',
      name: info.host,
      host: info.host,
      hostname: info.domain,
      value: VERCEL_CNAME_TARGET,
      data: VERCEL_CNAME_TARGET,
      target: VERCEL_CNAME_TARGET,
      ttl: VERCEL_DNS_TTL,
      purpose: 'Subdomain Routing (Required)',
      is_primary: true,
      note: 'Points "' + info.host + '.' + info.apexDomain + '" directly to the Vercel deployment target (' + VERCEL_CNAME_TARGET + ').'
    });
  }

  // 3. Optional Ownership Verification TXT record (if token is generated)
  if (verificationToken) {
    records.push({
      id: 'rec_txt_verify',
      step: records.length + 1,
      type: 'TXT',
      name: '_schoolerp-verify',
      host: '_schoolerp-verify',
      hostname: `_schoolerp-verify.${info.domain}`,
      value: verificationToken,
      data: verificationToken,
      target: verificationToken,
      ttl: VERCEL_DNS_TTL,
      purpose: 'Domain Ownership Verification (Optional)',
      is_primary: false,
      note: 'Proves domain ownership without changing web traffic. Add as TXT record in your registrar if required.'
    });
  }

  return { info, records };
}

// ==============================================================
// CUSTOM DOMAIN SCHEMA & SSL UTILITIES
// ==============================================================
function ensureCustomDomainSchema(db) {
  let updated = false;
  if (!Array.isArray(db.schoolDomains)) {
    db.schoolDomains = [];
    updated = true;
  }
  if (!Array.isArray(db.domainAuditLogs)) {
    db.domainAuditLogs = [];
    updated = true;
  }
  return updated;
}

function checkDomainSsl(hostname) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanHost = String(hostname || '').split(':')[0].trim();
    if (!cleanHost) return resolve({ active: false, error: 'Invalid hostname' });
    const socket = tls.connect(443, cleanHost, { servername: cleanHost, timeout: 6000 }, () => {
      if (settled) return;
      settled = true;
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      socket.end();
      resolve({
        active: !!authorized,
        issuer: cert?.issuer?.O || cert?.issuer?.CN || 'Unknown',
        valid_to: cert?.valid_to || null,
        error: authorized ? null : 'Certificate is not trusted or self-signed'
      });
    });
    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ active: false, error: err.message });
    });
    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ active: false, error: 'Connection timed out' });
    });
  });
}

const ALL_TEACHER_PERMISSIONS = [
  'view_own_profile',
  'edit_own_profile',
  'view_assigned_classes',
  'view_assigned_subjects',
  'mark_student_attendance',
  'edit_student_attendance',
  'enter_exam_marks',
  'edit_exam_marks',
  'view_timetable',
  'apply_for_leave',
  'view_own_attendance',
  'view_own_salary_slip',
  'download_salary_slip',
  'view_notices',
  'upload_homework',
  'view_student_list',
  'print_student_reports'
];

function getDefaultTeacherPermissions() {
  const perm = {};
  ALL_TEACHER_PERMISSIONS.forEach(k => perm[k] = true);
  return perm;
}

const PERMISSION_PRESETS = {
  'Class Teacher': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: true, edit_student_attendance: true, enter_exam_marks: true, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: true, view_student_list: true, print_student_reports: true
  },
  'Subject Teacher': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: false, edit_student_attendance: false, enter_exam_marks: true, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: true, view_student_list: true, print_student_reports: false
  },
  'Exam In-charge': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: false, edit_student_attendance: false, enter_exam_marks: true, edit_exam_marks: true,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: false, view_student_list: true, print_student_reports: true
  },
  'Attendance In-charge': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: true, edit_student_attendance: true, enter_exam_marks: false, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: false, view_student_list: true, print_student_reports: false
  },
  'Office Teacher': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: false,
    mark_student_attendance: false, edit_student_attendance: false, enter_exam_marks: false, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: false, view_student_list: true, print_student_reports: true
  }
};

function writeDbRaw(data) {
  linkAcademicSessionReferences(data);
  inMemoryDb = data;
  if (Supabase && Supabase.isConfigured()) {
    Supabase.queueSyncToSupabase(data);
  }
  if (process.env.VERCEL) {
    try {
      fs.writeFileSync('/tmp/db.json', JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('Vercel serverless environment; database updated in memory:', e.message);
    }
    return;
  }
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    if (err.code === 'EROFS' || err.code === 'EPERM') {
      console.warn('Filesystem is read-only; database updated in memory only:', err.message);
    } else {
      throw err;
    }
  }
}

// JWT helper functions
function base64url(str, encoding = 'utf8') {
  return Buffer.from(str, encoding).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function signJWT(payload, expiresInSeconds = 7200) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };
  
  const hBase64 = base64url(JSON.stringify(header));
  const pBase64 = base64url(JSON.stringify(fullPayload));
  const signatureInput = `${hBase64}.${pBase64}`;
  
  const signature = crypto.createHmac('sha256', getJwtSecret()).update(signatureInput).digest('base64url');
  return `${signatureInput}.${signature}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hBase64, pBase64, signature] = parts;
    const signatureInput = `${hBase64}.${pBase64}`;
    const expectedSignature = crypto.createHmac('sha256', getJwtSecret()).update(signatureInput).digest('base64url');
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(base64urlDecode(pBase64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Middleware-like Authenticator (supports Bearer Authorization header & secure session cookies)
function authenticate(req, res, callback) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').map(c => c.trim());
    const cookieToken = cookies.find(c => c.startsWith('saas_superadmin_token=') || c.startsWith('gjv_admin_token=') || c.startsWith('token='));
    if (cookieToken) {
      token = decodeURIComponent(cookieToken.split('=')[1] || '').trim();
    }
  }

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid token format.' }));
    return false;
  }
  const user = verifyJWT(token);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unauthorized: Session expired or invalid token.' }));
    return false;
  }
  req.user = user;
  callback();
  return true;
}

// Body parser helper
function parseJsonBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      req.rawBody = body;
      req.body = body ? JSON.parse(body) : {};
      callback(null);
    } catch (e) {
      callback(e);
    }
  });
}

const MAX_SIGNATURE_MULTIPART_BYTES = MAX_ID_CARD_SIGNATURE_BYTES + (64 * 1024);

function parseMultipartPrincipalSignature(req, callback) {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return callback(new Error('Multipart boundary is missing.'));
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const chunks = [];
  let received = 0;
  let tooLarge = false;
  req.on('data', chunk => {
    received += chunk.length;
    if (received > MAX_SIGNATURE_MULTIPART_BYTES) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) return callback(new Error('Signature image must not exceed 2 MB.'));
    try {
      const body = Buffer.concat(chunks).toString('latin1');
      const parts = body.split(boundary);
      let file = null;
      for (const rawPart of parts) {
        const part = rawPart.replace(/^\r\n/, '').replace(/\r\n$/, '');
        if (!part || part === '--') continue;
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd < 0) continue;
        const headers = part.slice(0, headerEnd);
        const disposition = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
        if (!disposition || disposition[1] !== 'principalSignature' || !disposition[2]) continue;
        const mimeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
        let binary = part.slice(headerEnd + 4);
        if (binary.endsWith('\r\n')) binary = binary.slice(0, -2);
        file = {
          fieldName: disposition[1],
          fileName: path.basename(disposition[2]),
          mimeType: String(mimeMatch?.[1] || '').trim().toLowerCase(),
          bytes: Buffer.from(binary, 'latin1')
        };
        break;
      }
      if (!file) return callback(new Error('The multipart field "principalSignature" is required.'));
      if (file.bytes.length > MAX_ID_CARD_SIGNATURE_BYTES) return callback(new Error('Signature image must not exceed 2 MB.'));
      req.file = file;
      req.body = {};
      callback(null);
    } catch (error) {
      callback(error);
    }
  });
  req.on('error', callback);
}

function parseApiRequestBody(reqPath, method, req, callback) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const isAdmitSignatureUpload = reqPath === '/api/admit-card/signature' && method === 'POST';
  if (isAdmitSignatureUpload) {
    if (!contentType.startsWith('multipart/form-data')) return callback(new Error('Admit Card signature upload must use multipart/form-data.'));
    return parseMultipartPrincipalSignature(req, callback);
  }
  if (contentType.startsWith('multipart/form-data')) return callback(new Error('Multipart data is not accepted by this API route.'));
  return parseJsonBody(req, callback);
}

function validateAdmitCardSignatureUpload(file) {
  if (!file || file.fieldName !== 'principalSignature') throw new Error('Please select a Principal signature image to upload.');
  const extension = path.extname(file.fileName || '').toLowerCase();
  const declaredType = String(file.mimeType || '').toLowerCase();
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedExtensions.includes(extension) || !allowedTypes.includes(declaredType)) throw new Error('Only PNG, JPG, JPEG, or WEBP signature files are allowed.');
  const bytes = file.bytes;
  if (!bytes?.length) throw new Error('The signature image is empty.');
  if (bytes.length > MAX_ID_CARD_SIGNATURE_BYTES) throw new Error('Signature image must not exceed 2 MB.');
  const isPng = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const isWebp = bytes.length >= 30 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((declaredType === 'image/png' && !isPng) || (declaredType === 'image/jpeg' && !isJpeg) || (declaredType === 'image/webp' && !isWebp)) throw new Error('The uploaded file content does not match its image type.');
  let width = 0;
  let height = 0;
  if (isPng && bytes.subarray(12, 16).toString('ascii') === 'IHDR') {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (isJpeg) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (offset + 4 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + segmentLength;
    }
  } else if (isWebp) {
    const chunkType = bytes.subarray(12, 16).toString('ascii');
    if (chunkType === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (chunkType === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
      height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    } else if (chunkType === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  }
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000 || width * height > 25000000) throw new Error('The signature image is corrupt or has invalid dimensions.');
  return { bytes, extension: declaredType === 'image/png' ? '.png' : declaredType === 'image/webp' ? '.webp' : '.jpg', width, height };
}
function decodeIdCardSignatureUpload(data) {
  const fileName = path.basename(String(data?.fileName || ''));
  const declaredType = String(data?.mimeType || '').toLowerCase();
  const dataUrl = String(data?.dataUrl || '');
  const extension = path.extname(fileName).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('Only PNG, JPG, or JPEG signature files are allowed.');
  if (!['image/png', 'image/jpeg'].includes(declaredType)) throw new Error('Only PNG, JPG, or JPEG signature files are allowed.');
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match || match[1].toLowerCase() !== declaredType) throw new Error('The signature image payload is invalid.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('The signature image is empty.');
  if (bytes.length > MAX_ID_CARD_SIGNATURE_BYTES) throw new Error('Signature image must not exceed 2 MB.');
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if ((declaredType === 'image/png' && !isPng) || (declaredType === 'image/jpeg' && !isJpeg)) throw new Error('The uploaded file content does not match its image type.');
  let width = 0;
  let height = 0;
  if (isPng && bytes.length >= 24 && bytes.subarray(12, 16).toString('ascii') === 'IHDR') {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (isJpeg) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (offset + 4 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + segmentLength;
    }
  }
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000 || width * height > 25000000) throw new Error('The signature image is corrupt or has invalid dimensions.');
  return { bytes, extension: declaredType === 'image/png' ? '.png' : '.jpg', width, height };
}

function removeOwnedIdCardSignature(publicPath) {
  const value = String(publicPath || '');
  if (!value.startsWith('/uploads/id-card-signatures/')) return;
  const fileName = path.basename(value);
  const filePath = path.join(ID_CARD_SIGNATURES_DIR, fileName);
  if (!filePath.startsWith(ID_CARD_SIGNATURES_DIR + path.sep)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
function removeOwnedAdmitCardSignature(publicPath) {
  const value = String(publicPath || '');
  if (!value.startsWith('/uploads/admit-card-signatures/')) return;
  const fileName = path.basename(value);
  const filePath = path.join(ADMIT_CARD_SIGNATURES_DIR, fileName);
  if (!filePath.startsWith(ADMIT_CARD_SIGNATURES_DIR + path.sep)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
// Notification audit entry. Delivery status must come from a configured provider,
// never from random/demo behavior.
function addNotificationLog(db, student, channel, type, messageContent) {
  const id = 'NTF-' + crypto.randomUUID();
  const logItem = {
    id,
    studentId: student.admissionNo || 'SYSTEM',
    studentName: student.name || 'Admin',
    recipientMobile: student.mobile || 'N/A',
    channel,
    type,
    message: messageContent,
    timestamp: new Date().toISOString(),
    status: 'Queued'
  };
  
  if (!db.notifications) db.notifications = [];
  db.notifications.unshift(logItem); // Add to beginning
  return logItem;
}

// Send notifications if enabled
function triggerNotifications(db, student, type, variables) {
  if (!db.settings.notificationsEnabled || db.settings.notificationGatewayConfigured !== true) return [];
  
  // Format variables
  let messageText = "";
  if (type === 'Admission') {
    messageText = `Admission Confirmed. Name: ${student.name}, Adm No: ${student.admissionNo}, Class: ${student.className}-${student.section}.`;
  } else if (type === 'IDCard') {
    messageText = `ID Card generated for ${student.name} (Roll No: ${student.rollNo}, Class: ${student.className}).`;
  } else if (type === 'FeeSuccess') {
    messageText = `Fee Payment Success. Rec No: ${variables.receiptNo}, Amt Paid: Rs.${variables.amount}, Month: ${variables.month}.`;
  } else if (type === 'FeeDue') {
    messageText = `Fee Due Reminder. Monthly fee of Rs.${student.monthlyFee} is due for ${variables.month} by 10th of next month. Please pay to avoid late fees.`;
  } else if (type === 'FeeOverdue') {
    messageText = `Overdue Alert! Monthly fee of Rs.${student.monthlyFee} for ${variables.month} is overdue. Please settle immediately.`;
  }
  
  const queued = [];
  if (db.settings.whatsappEnabled) {
    const formattedMsg = db.settings.whatsappTemplate.replace('{message}', messageText);
    queued.push(addNotificationLog(db, student, 'WhatsApp', type, formattedMsg));
  }
  if (db.settings.smsEnabled) {
    const formattedMsg = db.settings.smsTemplate.replace('{message}', messageText);
    queued.push(addNotificationLog(db, student, 'SMS', type, formattedMsg));
  }
  return queued;
}

// MIME Type Helper
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Static File Server Logic
function serveStaticFile(req, res, reqPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(reqPath);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Invalid URL encoding.');
  }

  // Alias /super-admin to /superadmin
  if (decodedPath === '/super-admin' || decodedPath === '/super-admin/') {
    decodedPath = '/superadmin/index.html';
  } else if (decodedPath.startsWith('/super-admin/')) {
    decodedPath = '/superadmin' + decodedPath.slice('/super-admin'.length);
  }

  const db = readDbRaw();
  const tenantCheck = isSchoolTenantRequest(req, db);

  let filePath;

  // 1. Superadmin Portal Routing
  if (decodedPath === '/superadmin' || decodedPath === '/superadmin/' || decodedPath === '/superadmin/index.html' || decodedPath === '/superadmin/login' || decodedPath === '/superadmin/login.html' || decodedPath.startsWith('/superadmin/')) {
    if (tenantCheck.isSchool) {
      const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();
      const proto = String(req.headers['x-forwarded-proto'] || 'http');
      res.writeHead(302, { Location: `${proto}://${baseDomain}${decodedPath}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (decodedPath === '/superadmin' || decodedPath === '/superadmin/' || decodedPath === '/superadmin/index.html') {
      filePath = path.join(__dirname, 'public', 'superadmin', 'index.html');
    } else if (decodedPath === '/superadmin/login' || decodedPath === '/superadmin/login.html') {
      filePath = path.join(__dirname, 'public', 'superadmin', 'login.html');
    } else {
      filePath = path.join(__dirname, 'public', decodedPath);
    }
  }
  // 2. Print Center Routing
  else if (decodedPath === '/print-center' || decodedPath === '/print-center/login' || decodedPath === '/admin-65121315super') {
    filePath = path.join(__dirname, 'public', 'print-center', 'login.html');
  } else if (decodedPath === '/print-center/reset-password' || decodedPath === '/print-center/reset-password.html' || decodedPath === '/print-center/setup-password') {
    filePath = path.join(__dirname, 'public', 'print-center', 'reset-password.html');
  } else if (decodedPath === '/print-center/portal' || decodedPath === '/print-center/index.html') {
    const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('gjv_print_session='));
    const printUser = cookie ? verifyJWT(decodeURIComponent(cookie.substring('gjv_print_session='.length))) : null;
    if (!printUser || printUser.role !== 'PrintOperator') {
      res.writeHead(302, { Location: '/print-center/login', 'Cache-Control': 'no-store' });
      return res.end();
    }
    const acc = (db.printCenterAccounts || []).find(a => a.school_id === printUser.school_id || a.username === printUser.username);
    if (acc) {
      if (acc.status !== 'Active' || acc.access_enabled === false || (printUser.token_version && acc.token_version && printUser.token_version !== acc.token_version)) {
        res.writeHead(302, { Location: '/print-center/login', 'Cache-Control': 'no-store', 'Set-Cookie': 'gjv_print_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        return res.end();
      }
    }
    if (tenantCheck.isSchool && tenantCheck.school && printUser.school_id && tenantCheck.school.id !== printUser.school_id) {
      const userSchool = (db.schools || []).find(s => s.id === printUser.school_id);
      if (userSchool) {
        const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim().toLowerCase();
        const proto = String(req.headers['x-forwarded-proto'] || 'http');
        const targetSub = userSchool.subdomain || userSchool.code;
        const port = reqHost.includes(':') ? `:${reqHost.split(':')[1]}` : '';
        let targetHost = reqHost;
        if (reqHost.endsWith('.localhost')) {
          targetHost = `${targetSub}.localhost${port}`;
        } else {
          const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();
          if (reqHost.endsWith('.' + baseDomain)) {
            targetHost = `${targetSub}.${baseDomain}${port}`;
          }
        }
        if (targetHost !== reqHost) {
          res.writeHead(302, { Location: `${proto}://${targetHost}/print-center/portal`, 'Cache-Control': 'no-store' });
          return res.end();
        }
      }
      res.writeHead(302, { Location: '/print-center/login', 'Cache-Control': 'no-store' });
      return res.end();
    }
    filePath = path.join(__dirname, 'public', 'print-center', 'index.html');
  }
  // 3. UNKNOWN OR UNCONFIGURED SCHOOL SUBDOMAIN
  else if (tenantCheck.isUnknownSubdomain) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    const notFoundPage = path.join(__dirname, 'public', 'saas', 'school-not-found.html');
    if (fs.existsSync(notFoundPage)) {
      let html = fs.readFileSync(notFoundPage, 'utf8');
      html = html.replace(/{{SUBDOMAIN}}/g, String(tenantCheck.subdomain || 'unknown'));
      return res.end(html);
    }
    return res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>404 - School Not Found</h1><p>The subdomain <strong>${tenantCheck.subdomain}</strong> is not configured.</p><p><a href="/login">Find School Portal</a> | <a href="/">SaaS Home</a></p></body></html>`);
  }
  // 4. ROOT SAAS DOMAIN (No School Subdomain)
  else if (!tenantCheck.isSchool) {
    // If user accesses /admin on the root domain, never open an arbitrary school or bypass login
    if (decodedPath === '/admin' || decodedPath === '/admin/' || decodedPath === '/admin/index.html' || decodedPath === '/admin/login' || decodedPath === '/admin/login.html' || decodedPath === '/admin-login') {
      res.writeHead(302, { Location: '/login?target=/admin', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (decodedPath === '/teacher' || decodedPath === '/teacher/' || decodedPath === '/teacher/index.html' || decodedPath === '/teacher/login' || decodedPath === '/teacher/login.html' || decodedPath === '/teacher-login' || decodedPath === '/teacher-login.html' || decodedPath === '/teacher/dashboard' || decodedPath === '/teacher-dashboard') {
      res.writeHead(302, { Location: '/login?target=/teacher', 'Cache-Control': 'no-store' });
      return res.end();
    }

    // MAIN DOMAIN — SaaS Business Marketing Website
    if (decodedPath === '/' || decodedPath === '/index.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'index.html');
    } else if (decodedPath === '/about' || decodedPath === '/about.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'about.html');
    } else if (decodedPath === '/pricing' || decodedPath === '/pricing.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'pricing.html');
    } else if (decodedPath === '/contact' || decodedPath === '/contact.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'contact.html');
    } else if (decodedPath === '/privacy' || decodedPath === '/privacy.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'privacy.html');
    } else if (decodedPath === '/terms' || decodedPath === '/terms.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'terms.html');
    } else if (decodedPath === '/login' || decodedPath === '/login.html') {
      filePath = path.join(__dirname, 'public', 'saas', 'login.html');
    } else {
      // Check in public/saas first, then fallback to public/ (for css, js, uploads, logos)
      const saasCandidate = path.join(__dirname, 'public', 'saas', decodedPath.startsWith('/') ? decodedPath.slice(1) : decodedPath);
      if (fs.existsSync(saasCandidate) && fs.statSync(saasCandidate).isFile()) {
        filePath = saasCandidate;
      } else {
        filePath = path.join(__dirname, 'public', decodedPath);
      }
    }
  }
  // 5. VALID SCHOOL SUBDOMAIN (tenantCheck.isSchool === true)
  else {
    // School Admin Portal & Login
    if (decodedPath === '/admin-login' || decodedPath === '/admin/login' || decodedPath === '/admin/login.html' || decodedPath === '/login' || decodedPath === '/login.html') {
      filePath = path.join(__dirname, 'public', 'admin', 'login.html');
    } else if (decodedPath === '/teacher-login' || decodedPath === '/teacher-login.html' || decodedPath === '/teacher/login' || decodedPath === '/teacher/login.html') {
      filePath = path.join(__dirname, 'public', 'teacher', 'login.html');
    } else if (decodedPath === '/teacher/dashboard' || decodedPath === '/teacher-dashboard' || decodedPath === '/teacher' || decodedPath === '/teacher/' || decodedPath === '/teacher/index.html') {
      filePath = path.join(__dirname, 'public', 'teacher', 'index.html');
    } else if (decodedPath.startsWith('/admin') && !path.extname(decodedPath)) {
      filePath = path.join(__dirname, 'public', 'admin', 'index.html');
    } else {
      // School Dedicated Public Website Pages
      const schoolPageMap = {
        '/': 'index.html',
        '/index.html': 'index.html',
        '/about': 'about.html',
        '/about.html': 'about.html',
        '/admission': 'admission.html',
        '/admission.html': 'admission.html',
        '/classes': 'classes.html',
        '/classes.html': 'classes.html',
        '/contact': 'contact.html',
        '/contact.html': 'contact.html',
        '/gallery': 'gallery.html',
        '/gallery.html': 'gallery.html',
        '/message': 'message.html',
        '/message.html': 'message.html',
        '/notices': 'notices.html',
        '/notices.html': 'notices.html'
      };

      if (schoolPageMap[decodedPath]) {
        filePath = path.join(__dirname, 'public', 'school', schoolPageMap[decodedPath]);
      } else {
        const schoolCandidate = path.join(__dirname, 'public', 'school', decodedPath.startsWith('/') ? decodedPath.slice(1) : decodedPath);
        if (fs.existsSync(schoolCandidate) && fs.statSync(schoolCandidate).isFile()) {
          filePath = schoolCandidate;
        } else {
          filePath = path.join(__dirname, 'public', decodedPath);
        }
      }
    }
  }

  // Prevent directory traversal
  const publicDir = path.join(__dirname, 'public');
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Access Denied');
  }

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Try adding .html extension
      const fallbackHtmlPath = filePath + '.html';
      fs.stat(fallbackHtmlPath, (err2, stats2) => {
        if (!err2 && stats2.isFile()) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(fallbackHtmlPath).pipe(res);
        } else {
          // Serve Custom 404 Page or redirect to index
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1><p>The requested file could not be found.</p><a href="/">Go to Home</a>');
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Request handler (usable by standalone HTTP server and Vercel Serverless Function)
function appHandler(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parsedUrl = {
    pathname: requestUrl.pathname,
    query: Object.fromEntries(requestUrl.searchParams.entries())
  };
  const reqPath = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // API ROUTING
  if (reqPath.startsWith('/api/')) {
    parseApiRequestBody(reqPath, method, req, (err) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: err.message || 'Malformed request payload.' }));
      }

      runInDbTransaction(async () => {
        const db = readDbRaw();
        let activeSchool = resolveRequestSchool(req, db);

        const handleAdminRoute = (action) => {
          return new Promise((resolve) => {
            const authenticated = authenticate(req, res, () => {
              if (!req.user) {
                res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unauthorized. Please log in.' }));
                resolve();
                return;
              }
              if (!activeSchool && req.user.role === 'PrintOperator') {
                if (req.user.school_id) {
                  activeSchool = (db.schools || []).find(s => s.id === req.user.school_id) || null;
                } else if (req.user.username) {
                  const matchedAcc = (db.printCenterAccounts || []).find(a => a.username === req.user.username);
                  if (matchedAcc) activeSchool = (db.schools || []).find(s => s.id === matchedAcc.school_id) || null;
                }
                if (!activeSchool) {
                  activeSchool = (db.schools || []).find(s => s.id === DEFAULT_SCHOOL_ID) || null;
                }
              } else if (!activeSchool && req.user.school_id && req.user.role !== 'SuperAdmin') {
                activeSchool = (db.schools || []).find(s => s.id === req.user.school_id) || null;
              }
              if (req.user.role !== 'SuperAdmin') {
                if (!activeSchool) {
                  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'School tenant context required. Please access via your assigned school subdomain (e.g. schoolcode.yourdomain.in).' }));
                  resolve();
                  return;
                }
                if (activeSchool.status === 'Suspended') {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'School is suspended.' }));
                  resolve();
                  return;
                }
                if (req.user.school_id && req.user.school_id !== activeSchool.id) {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'Cross-school token usage is forbidden.' }));
                  resolve();
                  return;
                }
                if (req.user.role === 'PrintOperator') {
                  const account = (db.printCenterAccounts || []).find(a => a.school_id === (activeSchool?.id || req.user.school_id) || a.username === req.user.username);
                  if (account) {
                    if (account.status !== 'Active' || account.access_enabled === false) {
                      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                      res.end(JSON.stringify({ error: 'Print Center access is disabled or suspended for this school.' }));
                      resolve();
                      return;
                    }
                    if (req.user.token_version && account.token_version && req.user.token_version !== account.token_version) {
                      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                      res.end(JSON.stringify({ error: 'Session has been revoked. Please sign in again.' }));
                      resolve();
                      return;
                    }
                  }
                }
              }
              const printReadRoutes = new Set(['/api/auth/me', '/api/students', '/api/exams', '/api/settings']);
              printReadRoutes.add('/api/print-center/id-card-design');
              printReadRoutes.add('/api/print-center/session');
              printReadRoutes.add('/api/print-center/id-card-templates');

              const printWriteRoutes = new Set(['/api/settings', '/api/settings/id-card-signature', '/api/admit-card/signature']);
              printWriteRoutes.add('/api/print-center/id-card-design');
              printWriteRoutes.add('/api/print-center/id-card-design/reset');
              printWriteRoutes.add('/api/print-center/id-card-design/presets');
              printWriteRoutes.add('/api/print-center/id-card-design/default-template');

              const isPrintPresetSubroute = reqPath.startsWith('/api/print-center/id-card-design/presets');
              const printAllowed = req.user.role === 'PrintOperator' && (
                (method === 'GET' && (printReadRoutes.has(reqPath) || isPrintPresetSubroute)) ||
                (['POST', 'PUT', 'DELETE'].includes(method) && (printWriteRoutes.has(reqPath) || isPrintPresetSubroute))
              );
              if (req.user.role !== 'Admin' && req.user.role !== 'SuperAdmin' && !printAllowed) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Access Denied: this operation is outside Print Portal permissions.' }));
                resolve();
                return;
              }
              try {
                const result = action(db, activeSchool);
                resolve(result);
              } catch (err) {
                console.error('[ADMIN ROUTE ERROR]', err);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Internal server error: ' + err.message }));
                resolve();
              }
            });
            if (!authenticated) resolve();
          });
        };

        const handleTeacherRoute = (action) => {
          return new Promise((resolve) => {
            const authenticated = authenticate(req, res, () => {
              if (!req.user) {
                res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unauthorized. Please log in.' }));
                resolve();
                return;
              }
              if (req.user.role !== 'Teacher' && req.user.role !== 'SuperAdmin') {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Access Denied: Teacher account required.' }));
                resolve();
                return;
              }
              if (!activeSchool && req.user.school_id && req.user.role !== 'SuperAdmin') {
                activeSchool = (db.schools || []).find(s => s.id === req.user.school_id) || null;
              }
              if (req.user.role !== 'SuperAdmin') {
                if (!activeSchool) {
                  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'School tenant context required. Please access via your assigned school subdomain.' }));
                  resolve();
                  return;
                }
                if (activeSchool.status === 'Suspended') {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'School is suspended.' }));
                  resolve();
                  return;
                }
                if (req.user.school_id && req.user.school_id !== activeSchool.id) {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'Cross-school token usage is forbidden.' }));
                  resolve();
                  return;
                }
              }
              const teacherRecord = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === req.user.empId || (t.loginUsername && t.loginUsername.toLowerCase() === (req.user.username || '').toLowerCase())));
              if (teacherRecord) {
                const st = (teacherRecord.status || 'Active').toLowerCase();
                if (st === 'deleted' || st === 'inactive' || st === 'archived' || st === 'resigned') {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'Teacher account is deactivated or deleted.' }));
                  resolve();
                  return;
                }
              }
              try {
                const result = action(db, activeSchool);
                resolve(result);
              } catch (err) {
                console.error('[TEACHER ROUTE ERROR]', err);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Internal server error: ' + err.message }));
                resolve();
              }
            });
            if (!authenticated) resolve();
          });
        };

        const handleAnyAuthRoute = (action) => {
          return new Promise((resolve) => {
            const authenticated = authenticate(req, res, () => {
              if (!req.user) {
                res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Unauthorized. Please log in.' }));
                resolve();
                return;
              }
              if (!activeSchool && req.user.school_id && req.user.role !== 'SuperAdmin') {
                activeSchool = (db.schools || []).find(s => s.id === req.user.school_id) || null;
              }
              if (req.user.role !== 'SuperAdmin') {
                if (!activeSchool) {
                  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'School tenant context required. Please access via your assigned school subdomain.' }));
                  resolve();
                  return;
                }
                if (activeSchool.status === 'Suspended') {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'School is suspended.' }));
                  resolve();
                  return;
                }
                if (req.user.school_id && req.user.school_id !== activeSchool.id) {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'Cross-school token usage is forbidden.' }));
                  resolve();
                  return;
                }
                if (req.user.role === 'PrintOperator') {
                  const account = (db.printCenterAccounts || []).find(a => a.school_id === (activeSchool?.id || req.user.school_id) || a.username === req.user.username);
                  if (account) {
                    if (account.status !== 'Active' || account.access_enabled === false) {
                      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                      res.end(JSON.stringify({ error: 'Print Center access is disabled or suspended for this school.' }));
                      resolve();
                      return;
                    }
                    if (req.user.token_version && account.token_version && req.user.token_version !== account.token_version) {
                      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                      res.end(JSON.stringify({ error: 'Session has been revoked. Please sign in again.' }));
                      resolve();
                      return;
                    }
                  }
                }
              }
              try {
                const result = action(db, activeSchool);
                resolve(result);
              } catch (err) {
                console.error('[ANY AUTH ROUTE ERROR]', err);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Internal server error: ' + err.message }));
                resolve();
              }
            });
            if (!authenticated) resolve();
          });
        };

        // ==========================================
        // 0. SUPER ADMIN PLATFORM ENDPOINTS
        // ==========================================
        // POST /api/superadmin/login
        if (reqPath === '/api/superadmin/login' && method === 'POST') {
          const { username, password } = req.body || {};
          const cleanUser = String(username || '').trim().toLowerCase();
          const sa = db.superAdmin || {};
          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Username and password are required.' }));
          }
          const validUser = cleanUser === String(sa.username || SUPER_ADMIN_USERNAME).toLowerCase();
          let validPass = false;
          if (sa.passwordHash && sa.passwordSalt) {
            const calculated = crypto.pbkdf2Sync(password, sa.passwordSalt, 1000, 64, 'sha512').toString('hex');
            validPass = calculated === sa.passwordHash;
          }
          if (!validUser || !validPass) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Invalid Super Admin credentials.' }));
          }
          const token = signJWT({ username: sa.username || SUPER_ADMIN_USERNAME, role: 'SuperAdmin' }, 86400);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': `saas_superadmin_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=86400`
          });
          return res.end(JSON.stringify({
            success: true,
            token,
            username: sa.username || SUPER_ADMIN_USERNAME,
            role: 'SuperAdmin'
          }));
        }

        // GET /api/superadmin/me
        if (reqPath === '/api/superadmin/me' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ username: req.user.username, role: req.user.role }));
          });
        }

        // GET /api/superadmin/check-subdomain (Validate code/subdomain uniqueness)
        if (reqPath === '/api/superadmin/check-subdomain' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const qCode = String(parsedUrl.query?.code || parsedUrl.query?.subdomain || '').trim().toLowerCase();
            const excludeId = String(parsedUrl.query?.excludeId || '').trim();
            if (!qCode) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Code or subdomain parameter is required.' }));
            }
            const clean = qCode.replace(/[^a-z0-9-]/g, '');
            const isFormatValid = isValidSchoolCode(clean);
            const taken = (db.schools || []).some(s =>
              s.id !== excludeId &&
              (String(s.code || '').toLowerCase() === clean || String(s.subdomain || '').toLowerCase() === clean)
            );
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              code: clean,
              subdomain: clean,
              valid: isFormatValid,
              available: isFormatValid && !taken,
              taken
            }));
          });
        }

        // GET /api/superadmin/schools (List all schools with metrics)
        if (reqPath === '/api/superadmin/schools' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const list = (db.schools || []).map(s => {
              const safe = { ...s };
              delete safe.adminPasswordHash;
              delete safe.adminPasswordSalt;
              const schoolStudents = (db.students || []).filter(item => matchTenant(item, s.id) && !item.deleted_at);
              const schoolTeachers = (db.teachers || []).filter(item => matchTenant(item, s.id) && !item.deleted_at);
              const schoolFees = (db.fees || []).filter(item => matchTenant(item, s.id) && !item.deleted_at && item.status !== 'Refunded')
                .reduce((sum, f) => sum + Number(f.amount || f.paidAmount || 0), 0);
              safe.studentCount = schoolStudents.length;
              safe.teacherCount = schoolTeachers.length;
              safe.feeTotal = schoolFees;
              return safe;
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // GET /api/superadmin/schools/:id (Get single school profile)
        if (reqPath.startsWith('/api/superadmin/schools/') && method === 'GET' && !reqPath.endsWith('/reset-admin-password') && !reqPath.endsWith('/check-subdomain')) {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const safe = { ...school };
            delete safe.adminPasswordHash;
            delete safe.adminPasswordSalt;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(safe));
          });
        }

        // POST /api/superadmin/schools (Complete School Onboarding)
        if (reqPath === '/api/superadmin/schools' && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const body = req.body || {};
            const {
              // 1. Identity
              name, code, logo, type, affiliation, establishedYear,
              // 2. Contact
              principalName, officialEmail, phone, alternatePhone, address, city, district, state, pincode, country,
              // 3. Website & Branding
              websiteTitle, websiteUrl, subdomain, aboutSchool, schoolDescription, contactDetails, contactEmail, websiteLogo, favicon, socialLinks, domain,
              // 4. Admin Account
              adminName, adminUsername, adminEmail, adminPhone, adminPassword,
              // 5. SaaS Settings
              plan, trialStartDate, trialEndDate, subscriptionStatus, status
            } = body;

            // Required validations
            if (!name || !String(name).trim()) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School Name is required.' }));
            }
            const rawCode = String(code || '').trim().toLowerCase();
            const cleanCode = rawCode.replace(/[^a-z0-9-]/g, '');
            if (!cleanCode || !isValidSchoolCode(cleanCode)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School Code must be 2-40 characters containing only lowercase letters, numbers, and hyphens.' }));
            }

            const cleanSubdomain = subdomain ? String(subdomain).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : cleanCode;
            if (!isValidSchoolCode(cleanSubdomain)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School Subdomain must be 2-40 characters containing only lowercase letters, numbers, and hyphens.' }));
            }

            // Uniqueness check for code and subdomain
            if ((db.schools || []).some(s => String(s.code || '').toLowerCase() === cleanCode || String(s.subdomain || '').toLowerCase() === cleanCode)) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `School code or subdomain "${cleanCode}" is already taken.` }));
            }
            if (cleanSubdomain !== cleanCode && (db.schools || []).some(s => String(s.code || '').toLowerCase() === cleanSubdomain || String(s.subdomain || '').toLowerCase() === cleanSubdomain)) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `School subdomain "${cleanSubdomain}" is already taken.` }));
            }

            const targetAdminEmail = String(adminUsername || adminEmail || '').trim();
            if (!targetAdminEmail || !isValidEmail(targetAdminEmail)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A valid Admin Email address is required.' }));
            }
            if (!adminPassword || String(adminPassword).length < 6) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Initial Admin Password must be at least 6 characters.' }));
            }

            // Optional validations
            if (officialEmail && !isValidEmail(officialEmail)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Official Email format is invalid.' }));
            }
            if (contactEmail && !isValidEmail(contactEmail)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Contact Email format is invalid.' }));
            }
            if (phone && !isValidPhone(phone)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Contact Phone Number format is invalid.' }));
            }
            if (alternatePhone && !isValidPhone(alternatePhone)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Alternate Phone Number format is invalid.' }));
            }
            if (websiteUrl && !isValidUrl(websiteUrl)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Website URL must be a valid web link starting with http:// or https://' }));
            }

            const schoolId = `SCH-${cleanCode.toUpperCase()}`;

            // Process image uploads safely
            let savedLogo = '/logo.jpg';
            let savedWebsiteLogo = '/logo.jpg';
            let savedFavicon = '/favicon.ico';
            try {
              if (logo) savedLogo = saveBrandingImage(logo, schoolId, 'logo', BRANDING_UPLOADS_DIR) || savedLogo;
              if (websiteLogo) savedWebsiteLogo = saveBrandingImage(websiteLogo, schoolId, 'weblogo', BRANDING_UPLOADS_DIR) || savedLogo;
              else savedWebsiteLogo = savedLogo;
              if (favicon) savedFavicon = saveBrandingImage(favicon, schoolId, 'favicon', BRANDING_UPLOADS_DIR) || savedFavicon;
            } catch (imgErr) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: imgErr.message }));
            }

            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(adminPassword, salt, 1000, 64, 'sha512').toString('hex');

            const now = new Date();
            const nowIso = now.toISOString();
            const todayStr = nowIso.split('T')[0];
            const trialEndStr = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const newSchool = {
              id: schoolId,
              name: String(name).trim(),
              code: cleanCode,
              subdomain: cleanSubdomain,
              logo: savedLogo,
              type: type ? String(type).trim() : 'Co-Educational',
              affiliation: affiliation ? String(affiliation).trim() : 'State Board',
              establishedYear: establishedYear ? String(establishedYear).trim() : String(now.getFullYear()),

              // Contact
              principalName: principalName ? String(principalName).trim() : '',
              officialEmail: officialEmail ? String(officialEmail).trim() : targetAdminEmail,
              phone: phone ? String(phone).trim() : '',
              alternatePhone: alternatePhone ? String(alternatePhone).trim() : '',
              address: address ? String(address).trim() : '',
              city: city ? String(city).trim() : '',
              district: district ? String(district).trim() : '',
              state: state ? String(state).trim() : 'Assam',
              pincode: pincode ? String(pincode).trim() : '',
              country: country ? String(country).trim() : 'India',

              // Website & Branding
              websiteTitle: websiteTitle ? String(websiteTitle).trim() : `${String(name).trim()} — Official Website`,
              websiteUrl: websiteUrl ? String(websiteUrl).trim() : '',
              aboutSchool: aboutSchool ? String(aboutSchool).trim() : `${String(name).trim()} is dedicated to fostering academic excellence, holistic growth, and responsible citizenship.`,
              schoolDescription: schoolDescription ? String(schoolDescription).trim() : 'Building Character, Cultivating Excellence',
              contactDetails: contactDetails ? String(contactDetails).trim() : '',
              contactEmail: contactEmail ? String(contactEmail).trim() : (officialEmail || targetAdminEmail),
              websiteLogo: savedWebsiteLogo,
              favicon: savedFavicon,
              socialLinks: typeof socialLinks === 'object' && socialLinks !== null ? socialLinks : {},
              domain: null,

              // Admin account
              adminName: adminName ? String(adminName).trim() : 'School Administrator',
              adminUsername: targetAdminEmail,
              adminPhone: adminPhone ? String(adminPhone).trim() : (phone || ''),
              adminPasswordHash: hash,
              adminPasswordSalt: salt,

              // SaaS Settings
              plan: plan ? String(plan).trim() : 'Free Trial (30 Days)',
              trialStartDate: trialStartDate ? String(trialStartDate).trim() : todayStr,
              trialEndDate: trialEndDate ? String(trialEndDate).trim() : trialEndStr,
              subscriptionStatus: subscriptionStatus ? String(subscriptionStatus).trim() : 'Trial',
              status: status === 'Suspended' ? 'Suspended' : 'Active',
              createdAt: nowIso,
              updatedAt: nowIso
            };

            // Pre-seed school websiteContent for public website and School Admin content editor
            newSchool.websiteContent = {
              schoolName: newSchool.name,
              tagline: newSchool.schoolDescription,
              aboutText: newSchool.aboutSchool,
              principalName: newSchool.principalName,
              principalMessage: `Welcome to ${newSchool.name}. As Principal, it is a privilege to lead our educational community. We believe in nurturing critical thinking, ethical values, and holistic development for every learner.`,
              address: [newSchool.address, newSchool.city, newSchool.state, newSchool.pincode].filter(Boolean).join(', ') || newSchool.address || '',
              phone: newSchool.phone,
              email: newSchool.officialEmail || newSchool.contactEmail || newSchool.adminUsername,
              mapEmbedUrl: '',
              logo: newSchool.logo,
              favicon: newSchool.favicon,
              socialLinks: newSchool.socialLinks
            };

            if (!Array.isArray(db.schools)) db.schools = [];
            db.schools.push(newSchool);

            // Register custom domain in pending verification state if provided
            if (domain) {
              const cleanOnboardDomain = normalizeDomain(domain);
              const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
              if (cleanOnboardDomain && domainRegex.test(cleanOnboardDomain)) {
                ensureCustomDomainSchema(db);
                const verificationToken = 'schoolerp-verify=' + crypto.randomBytes(16).toString('hex');
                const txtRecordName = `_schoolerp-verify.${cleanOnboardDomain}`;
                const dnsData = buildDnsRecordsForDomain(cleanOnboardDomain, verificationToken);
                db.schoolDomains.push({
                  id: 'dom_' + schoolId,
                  school_id: schoolId,
                  school_name: newSchool.name,
                  domain: cleanOnboardDomain,
                  verification_status: 'Pending',
                  dns_status: 'Pending DNS',
                  activation_status: 'Inactive',
                  routing_status: 'Routing Inactive',
                  ssl_status: 'Pending',
                  verification_token: verificationToken,
                  txt_record_name: txtRecordName,
                  txt_record_value: verificationToken,
                  cname_target: VERCEL_CNAME_TARGET,
                  a_record_ip: VERCEL_A_RECORD_IP,
                  ttl: VERCEL_DNS_TTL,
                  dns_records: dnsData.records,
                  last_verified_at: null,
                  created_at: nowIso,
                  updated_at: nowIso,
                  pending_domain: cleanOnboardDomain
                });
              }
            }

            // Auto-provision academic session for new tenant school
            const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
            const sessionName = startYear + '-' + String(startYear + 1).slice(-2);
            const sessionDates = academicSessionDates(sessionName);
            if (!Array.isArray(db.academicSessions)) db.academicSessions = [];
            db.academicSessions.push({
              id: crypto.randomUUID(),
              school_id: schoolId,
              session_name: sessionName,
              ...sessionDates,
              is_active: true,
              status: 'Active',
              created_at: nowIso,
              updated_at: nowIso
            });

            // Auto-provision core subjects for new tenant school
            const coreSubjects = [
              { name: 'Assamese', code: 'ASSAM-101' },
              { name: 'English', code: 'ENG-101' },
              { name: 'Mathematics', code: 'MATH-101' },
              { name: 'Science', code: 'SCI-101' },
              { name: 'Social Science', code: 'SOC-101' },
              { name: 'Computer', code: 'COMP-101' },
              { name: 'Environmental Science', code: 'EVS-101' }
            ];
            if (!Array.isArray(db.subjects)) db.subjects = [];
            coreSubjects.forEach((sub, idx) => {
              db.subjects.push({
                id: `SBJ-${cleanCode.toUpperCase()}-${idx + 1}`,
                school_id: schoolId,
                name: sub.name,
                code: sub.code,
                className: 'All Classes',
                section: 'All Sections',
                examType: 'All Exams',
                session: sessionName,
                maxMarks: 100,
                passMarks: 33,
                teacherId: 'Unassigned',
                teacherName: 'Unassigned',
                createdAt: nowIso,
                updatedAt: nowIso
              });
            });

            ensureSchoolLeadership(db, newSchool);
            ensurePrintCenterSchema(db);

            writeDbRaw(db);
            const safeSchool = { ...newSchool };
            delete safeSchool.adminPasswordHash;
            delete safeSchool.adminPasswordSalt;
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, school: safeSchool }));
          });
        }

        // PUT /api/superadmin/schools/:id (Update Complete School Profile)
        if (reqPath.startsWith('/api/superadmin/schools/') && method === 'PUT') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const updates = req.body || {};

            // Validations if fields are being updated
            if (updates.name !== undefined) {
              const nameTrimmed = String(updates.name).trim();
              if (!nameTrimmed) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'School Name cannot be empty.' }));
              }
              school.name = nameTrimmed;
            }

            if (updates.code !== undefined && updates.code !== school.code) {
              const cleanCode = String(updates.code).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
              if (!cleanCode || !isValidSchoolCode(cleanCode)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Invalid school code format.' }));
              }
              if ((db.schools || []).some(s => s.id !== school.id && (s.code === cleanCode || s.subdomain === cleanCode))) {
                res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `School code "${cleanCode}" is already taken.` }));
              }
              school.code = cleanCode;
            }

            if (updates.subdomain !== undefined && updates.subdomain !== school.subdomain) {
              const cleanSub = String(updates.subdomain).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
              if (!cleanSub || !isValidSchoolCode(cleanSub)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Invalid school subdomain format.' }));
              }
              if ((db.schools || []).some(s => s.id !== school.id && (s.code === cleanSub || s.subdomain === cleanSub))) {
                res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `Subdomain "${cleanSub}" is already taken.` }));
              }
              school.subdomain = cleanSub;
            }

            if (updates.adminUsername !== undefined || updates.adminEmail !== undefined) {
              const emailTrimmed = String(updates.adminUsername !== undefined ? updates.adminUsername : updates.adminEmail).trim();
              if (!isValidEmail(emailTrimmed)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Admin Email format is invalid.' }));
              }
              school.adminUsername = emailTrimmed;
            }

            if (updates.officialEmail !== undefined) {
              if (updates.officialEmail && !isValidEmail(updates.officialEmail)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Official Email format is invalid.' }));
              }
              school.officialEmail = updates.officialEmail ? String(updates.officialEmail).trim() : '';
            }

            if (updates.contactEmail !== undefined) {
              if (updates.contactEmail && !isValidEmail(updates.contactEmail)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Contact Email format is invalid.' }));
              }
              school.contactEmail = updates.contactEmail ? String(updates.contactEmail).trim() : '';
            }

            if (updates.phone !== undefined) {
              if (updates.phone && !isValidPhone(updates.phone)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Phone Number format is invalid.' }));
              }
              school.phone = String(updates.phone).trim();
            }

            if (updates.alternatePhone !== undefined) {
              if (updates.alternatePhone && !isValidPhone(updates.alternatePhone)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Alternate Phone Number format is invalid.' }));
              }
              school.alternatePhone = String(updates.alternatePhone).trim();
            }

            if (updates.adminPhone !== undefined) {
              school.adminPhone = String(updates.adminPhone).trim();
            }

            if (updates.websiteUrl !== undefined) {
              if (updates.websiteUrl && !isValidUrl(updates.websiteUrl)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Website URL must start with http:// or https://' }));
              }
              school.websiteUrl = updates.websiteUrl ? String(updates.websiteUrl).trim() : '';
            }

            // Image updates
            try {
              if (updates.logo && updates.logo.startsWith('data:image/')) {
                school.logo = saveBrandingImage(updates.logo, school.id, 'logo', BRANDING_UPLOADS_DIR);
              }
              if (updates.websiteLogo && updates.websiteLogo.startsWith('data:image/')) {
                school.websiteLogo = saveBrandingImage(updates.websiteLogo, school.id, 'weblogo', BRANDING_UPLOADS_DIR);
              }
              if (updates.favicon && updates.favicon.startsWith('data:image/')) {
                school.favicon = saveBrandingImage(updates.favicon, school.id, 'favicon', BRANDING_UPLOADS_DIR);
              }
            } catch (imgErr) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: imgErr.message }));
            }

            // Other fields
            if (updates.type !== undefined) school.type = String(updates.type).trim();
            if (updates.affiliation !== undefined) school.affiliation = String(updates.affiliation).trim();
            if (updates.establishedYear !== undefined) school.establishedYear = String(updates.establishedYear).trim();
            if (updates.principalName !== undefined) school.principalName = String(updates.principalName).trim();
            if (updates.address !== undefined) school.address = String(updates.address).trim();
            if (updates.city !== undefined) school.city = String(updates.city).trim();
            if (updates.district !== undefined) school.district = String(updates.district).trim();
            if (updates.state !== undefined) school.state = String(updates.state).trim();
            if (updates.pincode !== undefined) school.pincode = String(updates.pincode).trim();
            if (updates.country !== undefined) school.country = String(updates.country).trim();
            if (updates.websiteTitle !== undefined) school.websiteTitle = String(updates.websiteTitle).trim();
            if (updates.aboutSchool !== undefined) school.aboutSchool = String(updates.aboutSchool).trim();
            if (updates.schoolDescription !== undefined) school.schoolDescription = String(updates.schoolDescription).trim();
            if (updates.contactDetails !== undefined) school.contactDetails = String(updates.contactDetails).trim();
            if (updates.socialLinks && typeof updates.socialLinks === 'object') school.socialLinks = updates.socialLinks;
            if (updates.domain !== undefined) {
              const normDom = normalizeDomain(updates.domain);
              if (!normDom) {
                school.domain = null;
                const domRec = (db.schoolDomains || []).find(d => d.school_id === school.id);
                if (domRec) {
                  domRec.activation_status = 'Disconnected';
                  domRec.routing_status = 'Routing Inactive';
                  domRec.verification_status = 'Disconnected';
                  domRec.dns_status = 'Pending DNS';
                  domRec.updated_at = new Date().toISOString();
                }
              } else if (!school.domain || school.domain.toLowerCase() !== normDom) {
                ensureCustomDomainSchema(db);
                school.domain = null;
                const verificationToken = 'schoolerp-verify=' + crypto.randomBytes(16).toString('hex');
                const txtRecordName = `_schoolerp-verify.${normDom}`;
                const dnsData = buildDnsRecordsForDomain(normDom, verificationToken);
                let domRec = (db.schoolDomains || []).find(d => d.school_id === school.id);
                const nowIso = new Date().toISOString();
                if (domRec) {
                  domRec.domain = normDom;
                  domRec.verification_status = 'Pending';
                  domRec.dns_status = 'Pending DNS';
                  domRec.activation_status = 'Inactive';
                  domRec.routing_status = 'Routing Inactive';
                  domRec.ssl_status = 'Pending';
                  domRec.verification_token = verificationToken;
                  domRec.txt_record_name = txtRecordName;
                  domRec.txt_record_value = verificationToken;
                  domRec.cname_target = VERCEL_CNAME_TARGET;
                  domRec.a_record_ip = VERCEL_A_RECORD_IP;
                  domRec.ttl = VERCEL_DNS_TTL;
                  domRec.dns_records = dnsData.records;
                  domRec.updated_at = nowIso;
                  domRec.pending_domain = normDom;
                } else {
                  db.schoolDomains.push({
                    id: 'dom_' + school.id,
                    school_id: school.id,
                    school_name: school.name,
                    domain: normDom,
                    verification_status: 'Pending',
                    dns_status: 'Pending DNS',
                    activation_status: 'Inactive',
                    routing_status: 'Routing Inactive',
                    ssl_status: 'Pending',
                    verification_token: verificationToken,
                    txt_record_name: txtRecordName,
                    txt_record_value: verificationToken,
                    cname_target: VERCEL_CNAME_TARGET,
                    a_record_ip: VERCEL_A_RECORD_IP,
                    ttl: VERCEL_DNS_TTL,
                    dns_records: dnsData.records,
                    last_verified_at: null,
                    created_at: nowIso,
                    updated_at: nowIso,
                    pending_domain: normDom
                  });
                }
              }
            }
            if (updates.adminName !== undefined) school.adminName = String(updates.adminName).trim();

            if (updates.plan !== undefined) school.plan = String(updates.plan).trim();
            if (updates.trialStartDate !== undefined) school.trialStartDate = String(updates.trialStartDate).trim();
            if (updates.trialEndDate !== undefined) school.trialEndDate = String(updates.trialEndDate).trim();
            if (updates.subscriptionStatus !== undefined) school.subscriptionStatus = String(updates.subscriptionStatus).trim();
            if (updates.status && ['Active', 'Suspended'].includes(updates.status)) {
              school.status = updates.status;
            }

            // Sync websiteContent
            school.websiteContent = {
              ...(school.websiteContent || {}),
              schoolName: school.name,
              tagline: school.schoolDescription || school.websiteTitle || '',
              aboutText: school.aboutSchool || school.websiteContent?.aboutText || '',
              principalName: school.principalName || '',
              address: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || school.address || '',
              phone: school.phone || '',
              email: school.officialEmail || school.contactEmail || school.adminUsername || '',
              logo: school.logo,
              favicon: school.favicon,
              socialLinks: school.socialLinks || {}
            };

            school.updatedAt = new Date().toISOString();
            writeDbRaw(db);

            const safeSchool = { ...school };
            delete safeSchool.adminPasswordHash;
            delete safeSchool.adminPasswordSalt;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, school: safeSchool }));
          });
        }

        // POST /api/superadmin/schools/:id/reset-admin-password
        if (reqPath.startsWith('/api/superadmin/schools/') && reqPath.endsWith('/reset-admin-password') && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const { newPassword } = req.body || {};
            if (!newPassword || String(newPassword).length < 6) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'New password must be at least 6 characters.' }));
            }
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
            school.adminPasswordSalt = salt;
            school.adminPasswordHash = hash;
            school.updatedAt = new Date().toISOString();
            if (school.id === DEFAULT_SCHOOL_ID && db.settings) {
              db.settings.adminPasswordSalt = salt;
              db.settings.adminPasswordHash = hash;
            }
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Admin password reset successfully.' }));
          });
        }

        // ==============================================================
        // SUPER ADMIN — PRINT CENTER MANAGEMENT ENDPOINTS
        // ==============================================================

        // GET /api/superadmin/print-center/schools
        if (reqPath === '/api/superadmin/print-center/schools' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const schoolsWithPrint = (db.schools || []).map(s => {
              const acc = (db.printCenterAccounts || []).find(a => a.school_id === s.id);
              const studentCount = (db.students || []).filter(st => matchTenant(st, s.id) && st.status !== 'Inactive' && st.status !== 'Deleted').length;
              return {
                id: s.id,
                name: s.name,
                code: s.code,
                subdomain: s.subdomain,
                logo: s.logo || (s.id === DEFAULT_SCHOOL_ID ? '/logo.jpg' : '/neutral-school-logo.svg'),
                status: s.status,
                printCenter: {
                  configured: !!acc,
                  account_id: acc?.id || null,
                  username: acc?.username || null,
                  status: acc?.status || 'Not Configured',
                  access_enabled: acc ? acc.access_enabled !== false : false,
                  last_login: acc?.last_login || null,
                  token_version: acc?.token_version || 1,
                  created_at: acc?.created_at || null,
                  updated_at: acc?.updated_at || null
                },
                studentCount
              };
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, schools: schoolsWithPrint }));
          });
        }

        // POST /api/superadmin/print-center/accounts (Create or update Print Center credentials)
        if (reqPath === '/api/superadmin/print-center/accounts' && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const { schoolId, school_id, username, password, status, access_enabled } = req.body || {};
            const targetSchoolId = schoolId || school_id;
            if (!targetSchoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }
            const school = (db.schools || []).find(s => s.id === targetSchoolId || s.code === targetSchoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const cleanUsername = String(username || '').trim().toLowerCase();
            if (!cleanUsername) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Username is required.' }));
            }
            const existingWithUser = (db.printCenterAccounts || []).find(a => a.school_id !== school.id && String(a.username || '').toLowerCase() === cleanUsername);
            if (existingWithUser) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Username '${cleanUsername}' is already assigned to another school.` }));
            }

            let acc = (db.printCenterAccounts || []).find(a => a.school_id === school.id);
            const isNew = !acc;
            if (isNew && (!password || String(password).length < 6)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Password is required and must be at least 6 characters.' }));
            }

            let salt = acc?.password_salt;
            let hash = acc?.password_hash;
            let tokenVersion = acc?.token_version || 1;

            if (password) {
              if (String(password).length < 6) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Password must be at least 6 characters.' }));
              }
              salt = crypto.randomBytes(16).toString('hex');
              hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
              tokenVersion++; // Revoke previous sessions on password change
            }

            const now = new Date().toISOString();
            if (isNew) {
              acc = {
                id: 'pca_' + school.id,
                school_id: school.id,
                school_name: school.name,
                school_code: school.code,
                username: cleanUsername,
                password_hash: hash,
                password_salt: salt,
                status: status || 'Active',
                access_enabled: access_enabled !== false,
                token_version: tokenVersion,
                last_login: null,
                reset_token: null,
                reset_token_expiry: null,
                created_at: now,
                updated_at: now
              };
              db.printCenterAccounts.push(acc);
            } else {
              acc.username = cleanUsername;
              if (password) {
                acc.password_hash = hash;
                acc.password_salt = salt;
                acc.token_version = tokenVersion;
              }
              if (status) {
                if (status !== 'Active') acc.token_version = (acc.token_version || 1) + 1;
                acc.status = status;
              }
              if (access_enabled !== undefined) {
                if (!access_enabled) acc.token_version = (acc.token_version || 1) + 1;
                acc.access_enabled = !!access_enabled;
              }
              acc.updated_at = now;
            }

            if (school.id === DEFAULT_SCHOOL_ID) {
              db.settings.printPortalUsername = cleanUsername;
              if (password) {
                db.settings.printPortalPasswordSalt = salt;
                db.settings.printPortalPasswordHash = hash;
                db.settings.printPortalCredentialsUpdatedAt = now;
              }
            }

            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: school.id,
              school_name: school.name,
              action: isNew ? 'ACCOUNT_CREATED' : 'ACCOUNT_UPDATED',
              performed_by: req.user.username || 'superadmin@schoolerp.in',
              role: 'SuperAdmin',
              details: `${isNew ? 'Created' : 'Updated'} Print Center account '${cleanUsername}' for ${school.name}. Status: ${acc.status}`,
              timestamp: now
            });

            writeDbRaw(db);

            res.writeHead(isNew ? 201 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: isNew ? 'Print Center account created successfully.' : 'Print Center account updated successfully.',
              account: {
                id: acc.id,
                school_id: acc.school_id,
                school_name: acc.school_name,
                username: acc.username,
                status: acc.status,
                access_enabled: acc.access_enabled,
                last_login: acc.last_login,
                updated_at: acc.updated_at
              }
            }));
          });
        }

        // PUT /api/superadmin/print-center/:schoolId/status (Update account status or access toggle)
        if (reqPath.startsWith('/api/superadmin/print-center/') && reqPath.endsWith('/status') && method === 'PUT') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const acc = (db.printCenterAccounts || []).find(a => a.school_id === school.id);
            if (!acc) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Center account not found for this school.' }));
            }
            const { status, access_enabled } = req.body || {};
            const prevStatus = acc.status;
            const prevAccess = acc.access_enabled;

            if (status !== undefined) {
              if (!['Active', 'Disabled', 'Suspended'].includes(status)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Status must be Active, Disabled, or Suspended.' }));
              }
              acc.status = status;
            }
            if (access_enabled !== undefined) {
              acc.access_enabled = !!access_enabled;
            }

            // If account disabled or suspended, revoke all existing sessions
            if (acc.status !== 'Active' || acc.access_enabled === false) {
              acc.token_version = (acc.token_version || 1) + 1;
            }
            acc.updated_at = new Date().toISOString();

            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: school.id,
              school_name: school.name,
              action: 'STATUS_CHANGED',
              performed_by: req.user.username || 'superadmin@schoolerp.in',
              role: 'SuperAdmin',
              details: `Changed Print Center access for ${school.name}: Status (${prevStatus} -> ${acc.status}), Access (${prevAccess} -> ${acc.access_enabled}). Sessions revoked if deactivated.`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: `Print Center status updated for ${school.name}.`,
              account: {
                id: acc.id,
                school_id: acc.school_id,
                status: acc.status,
                access_enabled: acc.access_enabled,
                token_version: acc.token_version
              }
            }));
          });
        }

        // POST /api/superadmin/print-center/:schoolId/reset-password (Direct secure password reset)
        if (reqPath.startsWith('/api/superadmin/print-center/') && reqPath.endsWith('/reset-password') && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const acc = (db.printCenterAccounts || []).find(a => a.school_id === school.id);
            if (!acc) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Center account not found for this school.' }));
            }
            const newPassword = req.body?.newPassword || req.body?.new_password;
            if (!newPassword || String(newPassword).length < 6) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'New password must be at least 6 characters.' }));
            }
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(String(newPassword), salt, 120000, 64, 'sha512').toString('hex');
            acc.password_salt = salt;
            acc.password_hash = hash;
            acc.token_version = (acc.token_version || 1) + 1; // Revoke all existing sessions
            acc.updated_at = new Date().toISOString();

            if (school.id === DEFAULT_SCHOOL_ID) {
              db.settings.printPortalPasswordSalt = salt;
              db.settings.printPortalPasswordHash = hash;
              db.settings.printPortalCredentialsUpdatedAt = acc.updated_at;
            }

            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: school.id,
              school_name: school.name,
              action: 'PASSWORD_RESET',
              performed_by: req.user.username || 'superadmin@schoolerp.in',
              role: 'SuperAdmin',
              details: `Direct password reset performed for ${school.name} Print Center account. Previous sessions revoked.`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: `Print Center password for ${school.name} has been reset. All previous sessions have been revoked.`
            }));
          });
        }

        // POST /api/superadmin/print-center/:schoolId/generate-reset-link (Secure temporary setup link)
        if (reqPath.startsWith('/api/superadmin/print-center/') && reqPath.endsWith('/generate-reset-link') && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const acc = (db.printCenterAccounts || []).find(a => a.school_id === school.id);
            if (!acc) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Center account not found for this school.' }));
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            acc.reset_token = resetToken;
            acc.reset_token_expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours expiry
            acc.updated_at = new Date().toISOString();

            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: school.id,
              school_name: school.name,
              action: 'PASSWORD_RESET_LINK_GENERATED',
              performed_by: req.user.username || 'superadmin@schoolerp.in',
              role: 'SuperAdmin',
              details: `Generated secure temporary password reset link for ${school.name} Print Center account. Valid for 24 hours.`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            const resetUrl = `/print-center/reset-password.html?token=${resetToken}`;
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: 'Secure password reset link generated successfully.',
              resetToken,
              token: resetToken,
              resetUrl,
              expiresAt: acc.reset_token_expiry
            }));
          });
        }

        // POST /api/superadmin/print-center/:schoolId/revoke-sessions (Revoke existing sessions)
        if (reqPath.startsWith('/api/superadmin/print-center/') && reqPath.endsWith('/revoke-sessions') && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const schoolId = reqPath.split('/')[4];
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const acc = (db.printCenterAccounts || []).find(a => a.school_id === school.id);
            if (!acc) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Center account not found for this school.' }));
            }

            acc.token_version = (acc.token_version || 1) + 1;
            acc.updated_at = new Date().toISOString();

            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: school.id,
              school_name: school.name,
              action: 'SESSIONS_REVOKED',
              performed_by: req.user.username || 'superadmin@schoolerp.in',
              role: 'SuperAdmin',
              details: `Revoked all active Print Center sessions for ${school.name}. Token version bumped to ${acc.token_version}.`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: `All active sessions for ${school.name} Print Center have been revoked.`,
              token_version: acc.token_version
            }));
          });
        }

        // GET /api/superadmin/print-center/audit-logs
        if (reqPath === '/api/superadmin/print-center/audit-logs' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensurePrintCenterSchema(db);
            const qSchoolId = String(parsedUrl.query?.schoolId || '').trim();
            let logs = db.printCenterAuditLogs || [];
            if (qSchoolId) {
              logs = logs.filter(l => l.school_id === qSchoolId);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              logs: logs.slice(0, 100)
            }));
          });
        }

        // GET /api/saas/config (Public - SaaS Platform Settings)
        if (reqPath === '/api/saas/config' && method === 'GET') {
          const config = db.saasConfig || DEFAULT_SAAS_CONFIG;
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: true, config }));
        }

        // POST /api/saas/demo-request (Public - Lead Capture Form)
        if (reqPath === '/api/saas/demo-request' && method === 'POST') {
          const body = req.body || {};
          const name = String(body.name || '').trim();
          const email = String(body.email || '').trim();
          const phone = String(body.phone || '').trim();
          const schoolName = String(body.schoolName || '').trim();

          if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: 'Your name is required.' }));
          }
          if (!isValidEmail(email)) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: 'A valid email address is required.' }));
          }
          if (!phone || !isValidPhone(phone)) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: 'A valid contact phone number is required.' }));
          }
          if (!schoolName) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: 'School/Institution name is required.' }));
          }

          if (!Array.isArray(db.saasDemoRequests)) {
            db.saasDemoRequests = [];
          }

          const demoRequest = {
            id: 'demo_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
            name,
            email,
            phone,
            schoolName,
            studentCount: body.studentCount || '250 - 500',
            subdomain: String(body.subdomain || '').trim().toLowerCase(),
            message: String(body.message || '').trim(),
            source: body.source || 'saas_website',
            status: 'New',
            createdAt: new Date().toISOString()
          };

          db.saasDemoRequests.unshift(demoRequest);
          writeDbRaw(db);

          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            success: true,
            message: 'Thank you! Your demo request has been received. Our team will contact you shortly.',
            requestId: demoRequest.id
          }));
        }

        // GET /api/superadmin/demo-requests (Super Admin Only)
        if (reqPath === '/api/superadmin/demo-requests' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              demoRequests: db.saasDemoRequests || []
            }));
          });
        }

        // PUT /api/superadmin/demo-requests/:id (Super Admin Only - Update Lead Status)
        if (reqPath.startsWith('/api/superadmin/demo-requests/') && method === 'PUT') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const requestId = reqPath.split('/')[4];
            if (!Array.isArray(db.saasDemoRequests)) db.saasDemoRequests = [];
            const reqItem = db.saasDemoRequests.find(r => r.id === requestId);
            if (!reqItem) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Demo request not found.' }));
            }
            const body = req.body || {};
            if (body.status) reqItem.status = body.status;
            if (body.notes !== undefined) reqItem.notes = body.notes;
            reqItem.updatedAt = new Date().toISOString();
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, demoRequest: reqItem }));
          });
        }

        // PUT /api/superadmin/saas-config (Super Admin Only - Update SaaS Pricing and Contact Info)
        if (reqPath === '/api/superadmin/saas-config' && method === 'PUT') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            const body = req.body || {};
            db.saasConfig = {
              ...(db.saasConfig || DEFAULT_SAAS_CONFIG),
              ...body,
              updatedAt: new Date().toISOString()
            };
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, config: db.saasConfig }));
          });
        }

        // ==============================================================
        // SUPER ADMIN — CUSTOM DOMAIN MANAGEMENT ENDPOINTS
        // ==============================================================

        // GET /api/superadmin/domains — List all schools with custom domain status
        if (reqPath === '/api/superadmin/domains' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();

            const schools = (db.schools || []).map(s => {
              const domainRecord = (db.schoolDomains || []).find(d => d.school_id === s.id) || null;
              const hasActiveCustomDomain = !!(s.domain && domainRecord?.activation_status === 'Active');
              
              let connectionStatus = 'Not Connected';
              if (hasActiveCustomDomain) {
                connectionStatus = 'Connected';
              } else if (domainRecord?.verification_status === 'Pending') {
                connectionStatus = 'Pending Verification';
              } else if (domainRecord?.verification_status === 'Verified' && domainRecord?.activation_status !== 'Active') {
                connectionStatus = 'Ready to Activate';
              } else if (domainRecord?.activation_status === 'Disconnected') {
                connectionStatus = 'Disconnected';
              }

              const dnsStatus = domainRecord?.verification_status === 'Verified'
                ? 'DNS Verified'
                : (domainRecord?.domain ? 'Pending DNS' : 'Not Configured');

              const routingStatus = hasActiveCustomDomain ? 'Routing Active' : 'Routing Inactive';

              let sslStatus = 'Not Configured';
              if (domainRecord?.ssl_status === 'Active' || domainRecord?.ssl_status === 'Valid') {
                sslStatus = 'SSL Active';
              } else if (domainRecord?.ssl_status === 'Failed') {
                sslStatus = 'SSL Failed';
              } else if (domainRecord?.domain) {
                sslStatus = 'SSL Pending';
              }

              const dnsData = domainRecord?.domain ? buildDnsRecordsForDomain(domainRecord.domain, domainRecord.verification_token) : null;

              return {
                school_id: s.id,
                school_name: s.name,
                school_code: s.code,
                subdomain: s.subdomain || s.code,
                logo: s.logo || (s.id === DEFAULT_SCHOOL_ID ? '/logo.jpg' : '/neutral-school-logo.svg'),
                status: s.status,
                default_subdomain_url: `${s.subdomain || s.code}.${baseDomain}`,
                custom_domain: s.domain || domainRecord?.domain || null,
                is_connected: hasActiveCustomDomain,
                connection_status: connectionStatus,
                verification_status: domainRecord?.verification_status || 'Not Configured',
                dns_status: dnsStatus,
                activation_status: domainRecord?.activation_status || 'Inactive',
                routing_status: routingStatus,
                ssl_status: sslStatus,
                last_verified_at: domainRecord?.last_verified_at || null,
                updated_at: domainRecord?.updated_at || null,
                dns_records: dnsData ? dnsData.records : [],
                domain_record: domainRecord ? {
                  id: domainRecord.id,
                  domain: domainRecord.domain,
                  verification_status: domainRecord.verification_status,
                  dns_status: dnsStatus,
                  activation_status: domainRecord.activation_status,
                  routing_status: routingStatus,
                  ssl_status: sslStatus,
                  txt_record_name: domainRecord.txt_record_name,
                  txt_record_value: domainRecord.txt_record_value,
                  cname_target: VERCEL_CNAME_TARGET,
                  a_record_ip: VERCEL_A_RECORD_IP,
                  ttl: VERCEL_DNS_TTL,
                  dns_records: dnsData ? dnsData.records : [],
                  last_verified_at: domainRecord.last_verified_at
                } : null
              };
            });

            const summary = {
              totalSchools: schools.length,
              connectedDomains: schools.filter(s => s.is_connected).length,
              pendingVerification: schools.filter(s => s.verification_status === 'Pending').length,
              disconnectedDomains: schools.filter(s => s.connection_status === 'Disconnected').length
            };

            const deploymentTarget = {
              a_record_ip: VERCEL_A_RECORD_IP,
              cname_target: VERCEL_CNAME_TARGET,
              ttl: VERCEL_DNS_TTL,
              provider: 'Vercel / Production Edge Network'
            };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, schools, summary, baseDomain, deployment_target: deploymentTarget }));
          });
        }

        // POST /api/superadmin/domains (or /api/superadmin/domains/:schoolId) — Register or update custom domain
        const isDomainConfigRoute = (reqPath === '/api/superadmin/domains' || 
          reqPath === '/api/superadmin/domains/' ||
          (reqPath.startsWith('/api/superadmin/domains/') && 
           !reqPath.includes('/verify') && 
           !reqPath.includes('/activate') && 
           !reqPath.includes('/disconnect') && 
           !reqPath.includes('/instructions') && 
           !reqPath.includes('/check-ssl') && 
           !reqPath.includes('/audit-logs')));

        if (isDomainConfigRoute && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const pathParts = reqPath.split('/').filter(Boolean);
            const pathSchoolId = (pathParts[2] === 'domains' && pathParts[3] && !['verify', 'activate', 'disconnect', 'instructions', 'check-ssl', 'audit-logs'].includes(pathParts[3])) ? pathParts[3] : null;
            const schoolId = pathSchoolId || req.body?.schoolId || req.body?.school_id;
            const { domain } = req.body || {};
            if (!schoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }
            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            if (!domain || typeof domain !== 'string') {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Custom domain hostname is required.' }));
            }

            const cleanDomain = normalizeDomain(domain);
            const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
            if (!cleanDomain || !domainRegex.test(cleanDomain)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Invalid domain format. Enter a valid hostname such as www.example-school.in or portal.school.edu.' }));
            }

            const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();
            if (cleanDomain === baseDomain || cleanDomain.endsWith('.' + baseDomain) || cleanDomain === 'localhost' || cleanDomain.endsWith('.localhost') || /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanDomain)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Cannot use platform host, localhost, or IP addresses as a custom domain.' }));
            }

            // Check if domain is already assigned to another school
            const conflictSchool = (db.schools || []).find(s => s.id !== school.id && s.domain && s.domain.toLowerCase() === cleanDomain);
            if (conflictSchool) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Domain "${cleanDomain}" is already connected to school "${conflictSchool.name}".` }));
            }
            const conflictDomainRecord = (db.schoolDomains || []).find(d => d.school_id !== school.id && d.domain && d.domain.toLowerCase() === cleanDomain && d.activation_status !== 'Disconnected');
            if (conflictDomainRecord) {
              const other = (db.schools || []).find(s => s.id === conflictDomainRecord.school_id);
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Domain "${cleanDomain}" is already reserved by school "${other?.name || conflictDomainRecord.school_id}".` }));
            }

            const nowIso = new Date().toISOString();
            const verificationToken = 'schoolerp-verify=' + crypto.randomBytes(16).toString('hex');
            const txtRecordName = `_schoolerp-verify.${cleanDomain}`;
            const dnsData = buildDnsRecordsForDomain(cleanDomain, verificationToken);

            let domainRecord = (db.schoolDomains || []).find(d => d.school_id === school.id);
            const isChange = !!(school.domain && school.domain.toLowerCase() !== cleanDomain);
            const oldDomain = school.domain || (domainRecord && domainRecord.domain);

            if (domainRecord) {
              domainRecord.domain = cleanDomain;
              domainRecord.verification_status = 'Pending';
              domainRecord.dns_status = 'Pending DNS';
              domainRecord.activation_status = 'Inactive';
              domainRecord.routing_status = 'Routing Inactive';
              domainRecord.ssl_status = 'Pending';
              domainRecord.verification_token = verificationToken;
              domainRecord.txt_record_name = txtRecordName;
              domainRecord.txt_record_value = verificationToken;
              domainRecord.cname_target = VERCEL_CNAME_TARGET;
              domainRecord.a_record_ip = VERCEL_A_RECORD_IP;
              domainRecord.ttl = VERCEL_DNS_TTL;
              domainRecord.dns_records = dnsData.records;
              domainRecord.last_verified_at = null;
              domainRecord.updated_at = nowIso;
              domainRecord.pending_domain = cleanDomain;
            } else {
              domainRecord = {
                id: 'dom_' + school.id,
                school_id: school.id,
                school_name: school.name,
                domain: cleanDomain,
                verification_status: 'Pending',
                dns_status: 'Pending DNS',
                activation_status: 'Inactive',
                routing_status: 'Routing Inactive',
                ssl_status: 'Pending',
                verification_token: verificationToken,
                txt_record_name: txtRecordName,
                txt_record_value: verificationToken,
                cname_target: VERCEL_CNAME_TARGET,
                a_record_ip: VERCEL_A_RECORD_IP,
                ttl: VERCEL_DNS_TTL,
                dns_records: dnsData.records,
                last_verified_at: null,
                created_at: nowIso,
                updated_at: nowIso,
                pending_domain: cleanDomain
              };
              if (!Array.isArray(db.schoolDomains)) db.schoolDomains = [];
              db.schoolDomains.push(domainRecord);
            }

            // If changing an already active domain, revoke active routing until re-verified
            if (school.domain && school.domain.toLowerCase() !== cleanDomain) {
              school.domain = null;
              school.updatedAt = nowIso;
            }

            if (!Array.isArray(db.domainAuditLogs)) db.domainAuditLogs = [];
            db.domainAuditLogs.unshift({
              id: 'dal_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
              school_id: school.id,
              school_name: school.name,
              action: isChange ? 'DOMAIN_CHANGED' : 'DOMAIN_ADDED',
              old_domain: isChange ? oldDomain : null,
              new_domain: cleanDomain,
              performed_by: req.user?.username || 'SuperAdmin',
              timestamp: nowIso,
              details: isChange
                ? `Custom domain changed from "${oldDomain}" to "${cleanDomain}". DNS configuration required for target "${VERCEL_A_RECORD_IP} / ${VERCEL_CNAME_TARGET}".`
                : `Custom domain "${cleanDomain}" configured. Please add the DNS records to point to "${VERCEL_A_RECORD_IP} / ${VERCEL_CNAME_TARGET}".`
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: `Custom domain "${cleanDomain}" saved. Add the required DNS records below in your domain registrar (GoDaddy, Hostinger, Cloudflare) and click "Verify DNS".`,
              domain: domainRecord.domain,
              dns_status: domainRecord.dns_status || 'Pending DNS',
              routing_status: 'Routing Inactive',
              verification_status: domainRecord.verification_status,
              activation_status: domainRecord.activation_status,
              domain_record: {
                id: domainRecord.id,
                school_id: school.id,
                domain: domainRecord.domain,
                verification_status: domainRecord.verification_status,
                activation_status: domainRecord.activation_status,
                dns_status: domainRecord.dns_status || 'Pending DNS',
                routing_status: 'Routing Inactive',
                ssl_status: domainRecord.ssl_status,
                txt_record_name: domainRecord.txt_record_name,
                txt_record_value: domainRecord.txt_record_value,
                cname_target: domainRecord.cname_target,
                a_record_ip: domainRecord.a_record_ip,
                ttl: domainRecord.ttl
              },
              dns_records: dnsData.records,
              domain_info: dnsData.info,
              deployment_target: {
                a_record_ip: VERCEL_A_RECORD_IP,
                cname_target: VERCEL_CNAME_TARGET,
                ttl: VERCEL_DNS_TTL
              }
            }));
          });
        }

        // POST /api/superadmin/domains/:schoolId/verify (or /api/superadmin/domains/verify) — Real Public DNS Verification
        const isVerifyRoute = (reqPath === '/api/superadmin/domains/verify' || 
          (reqPath.startsWith('/api/superadmin/domains/') && reqPath.endsWith('/verify')));

        if (isVerifyRoute && method === 'POST') {
          return handleAnyAuthRoute(async () => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const pathParts = reqPath.split('/').filter(Boolean);
            const pathSchoolId = (pathParts[2] === 'domains' && pathParts[3] && pathParts[3] !== 'verify') ? pathParts[3] : null;
            const schoolId = pathSchoolId || req.body?.schoolId || req.body?.school_id;

            if (!schoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }

            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const domainRecord = (db.schoolDomains || []).find(d => d.school_id === school.id);
            if (!domainRecord || !domainRecord.domain) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'No custom domain record configured for this school. Please add a domain first.' }));
            }

            const nowIso = new Date().toISOString();
            const info = analyzeDomainStructure(domainRecord.domain);

            // REAL PUBLIC DNS VERIFICATION:
            // Check resolved public records against configured Vercel deployment targets
            let verified = false;
            let aRecordMatched = false;
            let cnameMatched = false;
            let txtMatched = false;
            let resolvedIps = [];
            let resolvedCnames = [];
            let resolvedTxts = [];
            let lookupError = null;

            // 1. Check A records
            try {
              const ips = await dnsPromises.resolve4(info.domain);
              resolvedIps = Array.isArray(ips) ? ips : [];
              if (resolvedIps.includes(VERCEL_A_RECORD_IP)) {
                aRecordMatched = true;
              }
            } catch (err) {
              if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
                lookupError = err.message;
              }
            }

            // 2. Check CNAME records
            try {
              const cnames = await dnsPromises.resolveCname(info.domain);
              resolvedCnames = Array.isArray(cnames) ? cnames : [];
              if (resolvedCnames.some(c => {
                const cleanC = String(c).toLowerCase().replace(/\.$/, '');
                return cleanC === VERCEL_CNAME_TARGET || cleanC.includes('vercel');
              })) {
                cnameMatched = true;
              }
            } catch (err) {}

            // 3. Check TXT token if configured
            if (domainRecord.verification_token) {
              try {
                let txtRecords = [];
                try {
                  txtRecords = await dnsPromises.resolveTxt(`_schoolerp-verify.${info.domain}`);
                } catch (e1) {
                  try {
                    txtRecords = await dnsPromises.resolveTxt(info.domain);
                  } catch (e2) {}
                }
                if (txtRecords && txtRecords.length > 0) {
                  txtMatched = txtRecords.some(chunks => {
                    const fullRecord = Array.isArray(chunks) ? chunks.join('') : String(chunks);
                    return fullRecord.includes(domainRecord.verification_token);
                  });
                }
              } catch (e3) {}
            }

            // Optional test simulation for automated test suites in NODE_ENV === 'test'
            if (process.env.NODE_ENV === 'test' && (req.headers['x-test-mock-dns'] === 'match' || String(domainRecord.domain).includes('verified-test'))) {
              if (info.isApex) {
                resolvedIps = [VERCEL_A_RECORD_IP];
                aRecordMatched = true;
              } else {
                resolvedCnames = [VERCEL_CNAME_TARGET];
                cnameMatched = true;
              }
            }

            // Evaluation:
            // For apex domain: verified if A record points to Vercel IP (76.76.21.21) OR CNAME points to Vercel OR TXT verified
            // For subdomain/www: verified if CNAME points to Vercel CNAME OR A record points to Vercel IP OR TXT verified
            if (info.isApex) {
              verified = aRecordMatched || cnameMatched || txtMatched;
            } else {
              verified = cnameMatched || aRecordMatched || txtMatched;
            }

            domainRecord.last_verified_at = nowIso;
            domainRecord.updated_at = nowIso;

            if (verified) {
              domainRecord.verification_status = 'Verified';
              domainRecord.dns_status = 'DNS Verified';
              if (!Array.isArray(db.domainAuditLogs)) db.domainAuditLogs = [];
              db.domainAuditLogs.unshift({
                id: 'dal_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                school_id: school.id,
                school_name: school.name,
                action: 'DNS_VERIFIED',
                old_domain: null,
                new_domain: domainRecord.domain,
                performed_by: req.user?.username || 'SuperAdmin',
                timestamp: nowIso,
                details: `Public DNS verification succeeded for "${domainRecord.domain}". Resolved target matches deployment (IP: ${resolvedIps.join(', ') || 'N/A'}, CNAME: ${resolvedCnames.join(', ') || 'N/A'}).`
              });
            } else {
              domainRecord.verification_status = 'Pending';
              domainRecord.dns_status = 'Pending DNS';
              if (!Array.isArray(db.domainAuditLogs)) db.domainAuditLogs = [];
              db.domainAuditLogs.unshift({
                id: 'dal_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                school_id: school.id,
                school_name: school.name,
                action: 'DNS_VERIFY_PENDING',
                old_domain: null,
                new_domain: domainRecord.domain,
                performed_by: req.user?.username || 'SuperAdmin',
                timestamp: nowIso,
                details: `Public DNS check pending for "${domainRecord.domain}". Current DNS: [A: ${resolvedIps.join(', ') || 'none'}, CNAME: ${resolvedCnames.join(', ') || 'none'}]. Expected target: ${info.isApex ? VERCEL_A_RECORD_IP : VERCEL_CNAME_TARGET}.`
              });
            }

            writeDbRaw(db);

            let resultMessage = '';
            if (verified) {
              resultMessage = `✓ DNS Verified! "${domainRecord.domain}" is correctly pointing to the deployment target (${aRecordMatched ? VERCEL_A_RECORD_IP : VERCEL_CNAME_TARGET}). You can now activate domain routing.`;
            } else if (resolvedIps.length === 0 && resolvedCnames.length === 0) {
              resultMessage = `⏳ No DNS records detected yet for "${domainRecord.domain}". DNS changes typically take 5–30 minutes (up to 24–48 hours) to propagate globally. Please verify that you saved the records in your DNS provider and click "Retry Verification" shortly.`;
            } else {
              const currentFound = resolvedIps.concat(resolvedCnames).join(', ');
              const expectedStr = info.isApex ? `A record -> ${VERCEL_A_RECORD_IP}` : `CNAME record -> ${VERCEL_CNAME_TARGET}`;
              resultMessage = `⚠️ DNS record mismatch. "${domainRecord.domain}" currently resolves to [${currentFound}], but expected: ${expectedStr}. Please update the DNS settings in your domain registrar (GoDaddy, Hostinger, Cloudflare) and click "Retry Verification".`;
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              verified,
              dns_status: domainRecord.dns_status,
              verification_status: domainRecord.verification_status,
              activation_status: domainRecord.activation_status,
              routing_status: domainRecord.activation_status === 'Active' ? 'Routing Active' : 'Routing Inactive',
              ssl_status: domainRecord.ssl_status || 'Pending',
              last_verified_at: domainRecord.last_verified_at,
              message: resultMessage,
              diagnostics: {
                domain: domainRecord.domain,
                is_apex: info.isApex,
                resolved_ips: resolvedIps,
                resolved_cnames: resolvedCnames,
                expected_a_ip: VERCEL_A_RECORD_IP,
                expected_cname: VERCEL_CNAME_TARGET,
                a_record_matched: aRecordMatched,
                cname_matched: cnameMatched,
                txt_matched: txtMatched
              }
            }));
          });
        }

        // POST /api/superadmin/domains/:schoolId/activate (or /api/superadmin/domains/activate) — Activate domain routing after verification
        const isActivateRoute = (reqPath === '/api/superadmin/domains/activate' || 
          (reqPath.startsWith('/api/superadmin/domains/') && reqPath.endsWith('/activate')));

        if (isActivateRoute && method === 'POST') {
          return handleAnyAuthRoute(async () => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const pathParts = reqPath.split('/').filter(Boolean);
            const pathSchoolId = (pathParts[2] === 'domains' && pathParts[3] && pathParts[3] !== 'activate') ? pathParts[3] : null;
            const schoolId = pathSchoolId || req.body?.schoolId || req.body?.school_id;

            if (!schoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }

            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const domainRecord = (db.schoolDomains || []).find(d => d.school_id === school.id);
            if (!domainRecord || !domainRecord.domain) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'No custom domain record found for this school.' }));
            }

            if (domainRecord.verification_status !== 'Verified') {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Domain DNS records must be verified before activation. Please click "Verify DNS" first.' }));
            }

            // Check if conflict with any other school's active domain
            const conflict = (db.schools || []).find(s => s.id !== school.id && s.domain && s.domain.toLowerCase() === domainRecord.domain.toLowerCase());
            if (conflict) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Domain "${domainRecord.domain}" is currently active on school "${conflict.name}".` }));
            }

            const nowIso = new Date().toISOString();
            const oldDomain = school.domain;
            school.domain = domainRecord.domain;
            school.updatedAt = nowIso;

            domainRecord.activation_status = 'Active';
            domainRecord.routing_status = 'Routing Active';
            domainRecord.dns_status = 'DNS Verified';
            domainRecord.ssl_status = 'Pending';
            domainRecord.updated_at = nowIso;

            if (!Array.isArray(db.domainAuditLogs)) db.domainAuditLogs = [];
            db.domainAuditLogs.unshift({
              id: 'dal_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
              school_id: school.id,
              school_name: school.name,
              action: 'DOMAIN_ACTIVATED',
              old_domain: oldDomain || null,
              new_domain: domainRecord.domain,
              performed_by: req.user?.username || 'SuperAdmin',
              timestamp: nowIso,
              details: `Custom domain "${domainRecord.domain}" activated for school "${school.name}". Incoming visitor traffic will route to this school tenant.`
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: `Custom domain "${domainRecord.domain}" is now ACTIVE. Web requests for ${domainRecord.domain} will route directly to ${school.name}.`,
              domain: domainRecord.domain,
              activation_status: 'Active',
              routing_status: 'Routing Active',
              dns_status: 'DNS Verified',
              ssl_status: domainRecord.ssl_status
            }));
          });
        }

        // POST /api/superadmin/domains/:schoolId/disconnect (or /api/superadmin/domains/disconnect) — Disconnect custom domain safely
        const isDisconnectRoute = (reqPath === '/api/superadmin/domains/disconnect' || 
          (reqPath.startsWith('/api/superadmin/domains/') && reqPath.endsWith('/disconnect')));

        if (isDisconnectRoute && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const pathParts = reqPath.split('/').filter(Boolean);
            const pathSchoolId = (pathParts[2] === 'domains' && pathParts[3] && pathParts[3] !== 'disconnect') ? pathParts[3] : null;
            const schoolId = pathSchoolId || req.body?.schoolId || req.body?.school_id;

            if (!schoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }

            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }

            const domainRecord = (db.schoolDomains || []).find(d => d.school_id === school.id);
            const nowIso = new Date().toISOString();
            const disconnectedDomain = school.domain || (domainRecord && domainRecord.domain) || 'Unknown';

            school.domain = null;
            school.updatedAt = nowIso;

            if (domainRecord) {
              domainRecord.activation_status = 'Disconnected';
              domainRecord.routing_status = 'Routing Inactive';
              domainRecord.verification_status = 'Disconnected';
              domainRecord.dns_status = 'Pending DNS';
              domainRecord.ssl_status = 'Not Configured';
              domainRecord.updated_at = nowIso;
            }

            if (!Array.isArray(db.domainAuditLogs)) db.domainAuditLogs = [];
            db.domainAuditLogs.unshift({
              id: 'dal_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
              school_id: school.id,
              school_name: school.name,
              action: 'DOMAIN_DISCONNECTED',
              old_domain: disconnectedDomain,
              new_domain: null,
              performed_by: req.user?.username || 'SuperAdmin',
              timestamp: nowIso,
              details: `Custom domain "${disconnectedDomain}" disconnected from school "${school.name}". School remains fully operational on its default subdomain. Zero student or school records deleted.`
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              message: `Custom domain "${disconnectedDomain}" disconnected successfully. The school remains fully operational on its default subdomain.`,
              domain: null,
              activation_status: 'Disconnected',
              connection_status: 'Disconnected',
              verification_status: 'Disconnected',
              routing_status: 'Routing Inactive',
              dns_status: 'Pending DNS'
            }));
          });
        }

        // GET /api/superadmin/domains/:schoolId/instructions (or /api/superadmin/domains/instructions) — DNS setup instructions
        const isInstructionsRoute = (reqPath === '/api/superadmin/domains/instructions' || 
          (reqPath.startsWith('/api/superadmin/domains/') && reqPath.endsWith('/instructions')));

        if (isInstructionsRoute && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const pathParts = reqPath.split('/').filter(Boolean);
            const pathSchoolId = (pathParts[2] === 'domains' && pathParts[3] && pathParts[3] !== 'instructions') ? pathParts[3] : null;
            const schoolId = pathSchoolId || String(parsedUrl.query?.schoolId || parsedUrl.query?.school_id || '').trim();

            if (!schoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }

            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const domainRecord = (db.schoolDomains || []).find(d => d.school_id === school.id);
            if (!domainRecord || !domainRecord.domain) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'No custom domain configured for this school. Add a domain first.' }));
            }

            const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();
            const dnsData = buildDnsRecordsForDomain(domainRecord.domain, domainRecord.verification_token);
            const info = dnsData.info;

            const instructions = {
              school_id: school.id,
              school_name: school.name,
              domain: domainRecord.domain,
              domain_info: info,
              verification_status: domainRecord.verification_status,
              dns_status: domainRecord.verification_status === 'Verified' ? 'DNS Verified' : 'Pending DNS',
              activation_status: domainRecord.activation_status,
              routing_status: domainRecord.activation_status === 'Active' ? 'Routing Active' : 'Routing Inactive',
              ssl_status: domainRecord.ssl_status || 'Pending',
              deployment_target: {
                a_record_ip: VERCEL_A_RECORD_IP,
                cname_target: VERCEL_CNAME_TARGET,
                ttl: VERCEL_DNS_TTL,
                provider: 'Vercel / Production Edge Network'
              },
              dns_records: dnsData.records,
              provider_guides: {
                godaddy: [
                  '1. Sign in to your GoDaddy Domain Portfolio (dcc.godaddy.com).',
                  '2. Select your domain (' + info.apexDomain + ') and click "DNS" or "Manage DNS".',
                  '3. Under DNS Records, click "Add New Record".',
                  info.isApex
                    ? '4. For Apex Domain: Select Type: "A", Name: "@", Value: "' + VERCEL_A_RECORD_IP + '", TTL: "600 seconds" (or 1/2 Hour). Click Save.'
                    : '4. For Subdomain: Select Type: "CNAME", Name: "' + info.host + '", Value: "' + VERCEL_CNAME_TARGET + '", TTL: "600 seconds". Click Save.',
                  '5. Note: In GoDaddy, "@" represents your root/apex domain. Save changes and allow 5–30 minutes for DNS propagation.',
                  '6. Return here and click "Verify DNS Records Now". Once verified, click "Activate Domain Routing".'
                ],
                hostinger: [
                  '1. Log in to Hostinger hPanel (hpanel.hostinger.com).',
                  '2. Go to Domains → Select (' + info.apexDomain + ') → DNS / Nameservers → DNS Zone Manager.',
                  info.isApex
                    ? '3. Under "Manage DNS records", add an A record: Type: "A", Name: "@", Points to: "' + VERCEL_A_RECORD_IP + '", TTL: 600. Click Add Record.'
                    : '3. Under "Manage DNS records", add a CNAME record: Type: "CNAME", Name: "' + info.host + '", Target: "' + VERCEL_CNAME_TARGET + '", TTL: 600. Click Add Record.',
                  '4. Note: Hostinger uses "@" for the root domain. TTL 600 seconds ensures rapid propagation.',
                  '5. Return here and click "Verify DNS Records Now". Once verified, click "Activate Domain Routing".',
                  '6. Under Hostinger → Websites → Security → SSL, confirm Free SSL is active.'
                ],
                cloudflare: [
                  '1. Log in to your Cloudflare Dashboard and select your domain (' + info.apexDomain + ').',
                  '2. Go to the "DNS" tab → "Records". Click "Add record".',
                  info.isApex
                    ? '3. Type: "A", Name: "@", IPv4 address: "' + VERCEL_A_RECORD_IP + '", TTL: Auto. Proxy status: Set to "DNS Only" (grey cloud) during initial setup.'
                    : '3. Type: "CNAME", Name: "' + info.host + '", Target: "' + VERCEL_CNAME_TARGET + '", TTL: Auto. Proxy status: Set to "DNS Only" (grey cloud) during initial setup.',
                  '4. Click Save. Cloudflare changes propagate in 2–5 minutes.'
                ],
                general: [
                  '1. Log in to your domain registrar (Namecheap, Google Domains / Squarespace, BigRock, etc.).',
                  '2. Open DNS Management / Advanced DNS settings for ' + info.apexDomain + '.',
                  info.isApex
                    ? '3. Add an A record: Host / Name: "@" (or leave blank if root), Points to / Value: "' + VERCEL_A_RECORD_IP + '", TTL: 600.'
                    : '3. Add a CNAME record: Host / Name: "' + info.host + '", Points to / Value: "' + VERCEL_CNAME_TARGET + '", TTL: 600.',
                  '4. Save changes and return to Super Admin Console to click "Verify DNS Records Now".'
                ]
              }
            };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              ...instructions,
              instructions
            }));
          });
        }

        // POST /api/superadmin/domains/:schoolId/check-ssl (or /api/superadmin/domains/check-ssl) — Live TLS handshake check
        const isCheckSslRoute = (reqPath === '/api/superadmin/domains/check-ssl' || 
          (reqPath.startsWith('/api/superadmin/domains/') && reqPath.endsWith('/check-ssl')));

        if (isCheckSslRoute && method === 'POST') {
          return handleAnyAuthRoute(async () => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const pathParts = reqPath.split('/').filter(Boolean);
            const pathSchoolId = (pathParts[2] === 'domains' && pathParts[3] && pathParts[3] !== 'check-ssl') ? pathParts[3] : null;
            const schoolId = pathSchoolId || req.body?.schoolId || req.body?.school_id;

            if (!schoolId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School ID is required.' }));
            }

            const school = (db.schools || []).find(s => s.id === schoolId || s.code === schoolId);
            if (!school) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School not found.' }));
            }
            const domainRecord = (db.schoolDomains || []).find(d => d.school_id === school.id);
            if (!domainRecord || !domainRecord.domain) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'No custom domain configured for this school.' }));
            }

            const targetHostname = domainRecord.domain;
            const sslResult = await checkDomainSsl(targetHostname);

            const nowIso = new Date().toISOString();
            if (sslResult.active) {
              domainRecord.ssl_status = 'Active';
            } else {
              domainRecord.ssl_status = 'Pending';
            }
            domainRecord.updated_at = nowIso;
            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              ssl_status: domainRecord.ssl_status,
              ssl_active: sslResult.active,
              issuer: sslResult.issuer || null,
              valid_to: sslResult.valid_to || null,
              error: sslResult.error || null,
              message: sslResult.active
                ? `✓ HTTPS/TLS certificate active on ${targetHostname}. Issued by: ${sslResult.issuer || 'Trusted CA'}. Valid until: ${sslResult.valid_to || 'N/A'}.`
                : `⚠️ SSL pending or not yet active on ${targetHostname} (${sslResult.error || 'Port 443 handshake failed'}). Vercel automatically provisions free SSL certificates within minutes once public DNS is verified and traffic routes.`
            }));
          });
        }

        // GET /api/superadmin/domains/audit-logs — Domain change history audit trail
        if (reqPath === '/api/superadmin/domains/audit-logs' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            if (req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Super Admin privileges required.' }));
            }
            ensureCustomDomainSchema(db);
            const qSchoolId = String(parsedUrl.query?.schoolId || '').trim();
            let logs = db.domainAuditLogs || [];
            if (qSchoolId) {
              logs = logs.filter(l => l.school_id === qSchoolId);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              logs: logs.slice(0, 100)
            }));
          });
        }

        // 1. PUBLIC ENDPOINTS
        // GET /api/notices (Public)
        if (reqPath === '/api/notices' && method === 'GET') {
          let targetSchool = activeSchool;
          if (!targetSchool) {
            const authHeader = req.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const u = verifyJWT(authHeader.substring(7));
              if (u && u.school_id) {
                targetSchool = (db.schools || []).find(s => s.id === u.school_id) || null;
              }
            }
          }
          if (!targetSchool) {
            targetSchool = resolveRequestSchool(req, db, { allowDefaultFallback: false });
          }
          if (!targetSchool) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify([]));
          }
          const session = parsedUrl.query.session || parsedUrl.query.academic_session;
          const selected = normalizeAcademicSession(session, db);
          let notices = (db.notices || []).filter(n => matchTenant(n, targetSchool.id));
          notices = notices.filter(notice => { const stored = notice.academic_session || notice.academicSession || notice.session; return session ? normalizeAcademicSession(stored, db) === selected : (!stored || normalizeAcademicSession(stored, db) === currentAcademicSession(db)); });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(notices));
        }

        // GET /api/gallery (Public)
        if (reqPath === '/api/gallery' && method === 'GET') {
          let targetSchool = activeSchool;
          if (!targetSchool) {
            const authHeader = req.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const u = verifyJWT(authHeader.substring(7));
              if (u && u.school_id) {
                targetSchool = (db.schools || []).find(s => s.id === u.school_id) || null;
              }
            }
          }
          if (!targetSchool) {
            targetSchool = resolveRequestSchool(req, db, { allowDefaultFallback: false });
          }
          if (!targetSchool) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify([]));
          }
          let items = (db.gallery || []).filter(g => matchTenant(g, targetSchool.id));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(items));
        }

        // GET /api/website-info (Public info for school website)
        if (reqPath === '/api/website-info' && method === 'GET') {
          let targetSchool = activeSchool;
          if (!targetSchool) {
            const authHeader = req.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const u = verifyJWT(authHeader.substring(7));
              if (u && u.school_id) {
                targetSchool = (db.schools || []).find(s => s.id === u.school_id) || null;
              }
            }
          }
          if (!targetSchool) {
            targetSchool = resolveRequestSchool(req, db, { allowDefaultFallback: false });
          }
          if (!targetSchool) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'School tenant context not found. Please access via your school subdomain.' }));
          }
          let content = targetSchool.websiteContent;
          if (!content || !Object.keys(content).length) {
            content = {
              schoolName: targetSchool.name,
              tagline: targetSchool.schoolDescription || targetSchool.websiteTitle || '',
              aboutText: targetSchool.aboutSchool || '',
              principalName: targetSchool.principalName || '',
              principalMessage: `Welcome to ${targetSchool.name}. As Principal, it is a privilege to lead our educational community. We believe in nurturing critical thinking, ethical values, and holistic development for every learner.`,
              address: [targetSchool.address, targetSchool.city, targetSchool.state, targetSchool.pincode].filter(Boolean).join(', ') || targetSchool.address || '',
              phone: targetSchool.phone || '',
              email: targetSchool.officialEmail || targetSchool.contactEmail || targetSchool.adminUsername || '',
              mapEmbedUrl: '',
              logo: targetSchool.logo || (targetSchool.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg'),
              favicon: targetSchool.favicon || '/favicon.ico',
              socialLinks: targetSchool.socialLinks || {}
            };
          }
          const neutralLogo = targetSchool.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg';
          const payload = {
            ...content,
            schoolId: targetSchool.id,
            schoolName: content.schoolName || targetSchool.name,
            schoolCode: targetSchool.code,
            logo: targetSchool.logo || content.logo || neutralLogo,
            websiteLogo: targetSchool.websiteLogo || targetSchool.logo || content.websiteLogo || neutralLogo,
            favicon: targetSchool.favicon || content.favicon || '/favicon.ico',
            establishedYear: targetSchool.establishedYear || content.establishedYear || '2023',
            type: targetSchool.type || content.type || 'Co-Educational',
            affiliation: targetSchool.affiliation || content.affiliation || '',
            socialLinks: targetSchool.socialLinks || content.socialLinks || {}
          };
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(payload));
        }

        // GET /api/academic-sessions (public read for admission and authenticated portals)
        if (reqPath === '/api/academic-sessions' && method === 'GET') {
          let targetSchool = activeSchool;
          if (!targetSchool) {
            const authHeader = req.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const u = verifyJWT(authHeader.substring(7));
              if (u && u.school_id) {
                targetSchool = (db.schools || []).find(s => s.id === u.school_id) || null;
              }
            }
          }
          if (!targetSchool) {
            targetSchool = resolveRequestSchool(req, db, { allowDefaultFallback: false });
          }
          if (!targetSchool) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ sessions: [], currentSession: null }));
          }
          const schoolSessions = ensureAcademicSessions(db, targetSchool.id)
            .slice()
            .sort((a,b) => String(b.start_date).localeCompare(String(a.start_date)));
          const currentSession = schoolSessions.find(row => row.is_active) || schoolSessions[0] || null;
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ sessions: schoolSessions, currentSession }));
        }

        // POST /api/admission-applications (Public online admission)
        if (reqPath === '/api/admission-applications' && method === 'POST') {
          if (!activeSchool) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'School tenant context required for online admission applications. Please access via the school subdomain.' }));
          }
          const input = req.body || {};
          const value = (...keys) => {
            const key = keys.find(k => input[k] !== undefined && input[k] !== null);
            return key ? String(input[key]).trim() : '';
          };
          const studentName = value('studentName', 'student_name');
          const dateOfBirth = value('dateOfBirth', 'date_of_birth', 'dob');
          const gender = value('gender');
          const classApplied = value('classApplied', 'class_applied', 'className');
          const fatherName = value('fatherName', 'father_name');
          const mobileNumber = value('mobileNumber', 'mobile_number', 'phone', 'mobile').replace(/\D/g, '');
          const academicSession = normalizeAcademicSession(value('academicSession', 'academic_session', 'session'), db, activeSchool.id);
          const missing = [];
          if (!studentName) missing.push('studentName');
          if (!dateOfBirth) missing.push('dateOfBirth');
          if (!gender) missing.push('gender');
          if (!classApplied) missing.push('classApplied');
          if (!fatherName) missing.push('fatherName');
          if (!academicSession) missing.push('academicSession');
          if (!/^\d{10}$/.test(mobileNumber)) missing.push('mobileNumber (10 digits)');
          if (missing.length) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Missing or invalid fields: ' + missing.join(', ') }));
          }
          const normalized = v => String(v || '').trim().toLowerCase();
          const duplicate = (db.admissionApplications || []).find(a => matchTenant(a, activeSchool.id) && !a.deletedAt &&
            normalized(a.studentName) === normalized(studentName) && a.dateOfBirth === dateOfBirth &&
            String(a.mobileNumber || '').replace(/\D/g, '') === mobileNumber &&
            normalized(a.academicSession).replace('/', '-') === normalized(academicSession));
          if (duplicate) {
            res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'An application already exists for this student.', applicationNumber: duplicate.applicationNumber }));
          }
          const photo = value('studentPhoto', 'student_photo', 'photo');
          if (photo && photo.length > 3 * 1024 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Student photo is too large. Maximum file size is 2 MB.' }));
          }
          const documents = Array.isArray(input.uploadedDocuments) ? input.uploadedDocuments : [];
          if (JSON.stringify(documents).length > 8 * 1024 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Uploaded documents are too large.' }));
          }
          const now = new Date();
          const year = now.getFullYear();
          const schoolPrefix = String(activeSchool.code || 'APP').toUpperCase();
          let sequence = (db.admissionApplications || []).filter(a => matchTenant(a, activeSchool.id)).length + 1;
          let applicationNumber;
          do { applicationNumber = `${schoolPrefix}-APP-${year}-${String(sequence++).padStart(5, '0')}`; }
          while ((db.admissionApplications || []).some(a => matchTenant(a, activeSchool.id) && a.applicationNumber === applicationNumber));
          const application = {
            id: crypto.randomUUID(), school_id: activeSchool.id, applicationNumber, studentName, dateOfBirth, gender, classApplied,
            fatherName, motherName: value('motherName', 'mother_name'), mobileNumber,
            alternateMobile: value('alternateMobile', 'alternate_mobile').replace(/\D/g, ''),
            email: value('email').toLowerCase(), address: value('address'),
            studentAadhaar: value('studentAadhaar', 'student_aadhaar').replace(/\D/g, ''),
            fatherAadhaar: value('fatherAadhaar', 'father_aadhaar').replace(/\D/g, ''),
            previousSchool: value('previousSchool', 'previous_school'), academicSession,
            applicationDate: now.toISOString().slice(0, 10), applicationStatus: 'New',
            uploadedDocuments: documents, studentPhoto: photo, message: value('message', 'remarks'),
            statusHistory: [{ status: 'New', at: now.toISOString(), by: 'Public Applicant' }],
            createdAt: now.toISOString(), updatedAt: now.toISOString()
          };
          db.admissionApplications = db.admissionApplications || [];
          db.admissionApplications.push(application);
          writeDbRaw(db);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: true, message: 'Admission application submitted successfully.', applicationNumber, application }));
        }

        // POST /api/auth/login (Admin)
        if (reqPath === '/api/auth/login' && method === 'POST') {
          const { username, password } = req.body || {};
          const cleanUsername = (username || '').trim().toLowerCase();

          let loginSchool = activeSchool;
          if (!loginSchool) {
            const targetCode = String(req.body?.schoolCode || req.body?.school || parsedUrl.query?.school || parsedUrl.query?.school_code || req.headers['x-school-code'] || req.headers['x-school-id'] || '').trim().toLowerCase();
            if (targetCode) {
              loginSchool = (db.schools || []).find(s => s.id === targetCode || String(s.code || '').toLowerCase() === targetCode || String(s.subdomain || '').toLowerCase() === targetCode);
            }
          }

          if (!loginSchool) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'School tenant context required. Please access via your assigned school subdomain (e.g. schoolcode.yourdomain.in).' }));
          }

          if (loginSchool.status === 'Suspended') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'This school account is currently suspended. Please contact platform administration.' }));
          }

          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Username and password are required.' }));
          }

          let schoolAdminUser = (loginSchool.adminUsername || '').trim().toLowerCase();
          let salt = loginSchool.adminPasswordSalt;
          let hash = loginSchool.adminPasswordHash;

          if (loginSchool.id === DEFAULT_SCHOOL_ID) {
            schoolAdminUser = schoolAdminUser || (db.settings?.adminUsername || '').trim().toLowerCase();
            salt = salt || db.settings?.adminPasswordSalt;
            hash = hash || db.settings?.adminPasswordHash;
          }

          const validUsernames = new Set([
            schoolAdminUser,
            (loginSchool.adminUsername || '').trim().toLowerCase(),
            (loginSchool.adminEmail || '').trim().toLowerCase(),
            (loginSchool.officialEmail || '').trim().toLowerCase(),
            (loginSchool.email || '').trim().toLowerCase(),
            'admin'
          ].filter(Boolean));

          if (validUsernames.has(cleanUsername) && salt && hash) {
            const calculatedHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
            if (calculatedHash === hash) {
              const token = signJWT({
                username: loginSchool.adminUsername || cleanUsername,
                role: 'Admin',
                school_id: loginSchool.id,
                school_code: loginSchool.code
              });
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({
                token,
                username: loginSchool.adminUsername || cleanUsername,
                role: 'Admin',
                school_id: loginSchool.id,
                school_code: loginSchool.code,
                school_name: loginSchool.name
              }));
            }
          }

          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'Invalid username or password.' }));
        }

        // POST /api/print-center/login (independent Print Portal authentication)
        if (reqPath === '/api/print-center/login' && method === 'POST') {
          const { username, password } = req.body || {};
          const cleanUsername = String(username || '').trim().toLowerCase();
          if (!cleanUsername || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Print Portal username and password are required.' }));
          }

          ensurePrintCenterSchema(db);

          // 1. Resolve target school context (from request host, header, query, or body)
          let loginSchool = activeSchool;
          if (!loginSchool) {
            const explicitSchool = String(req.body?.schoolCode || req.body?.school || req.body?.schoolId || req.body?.school_id || parsedUrl.query?.school || parsedUrl.query?.school_code || req.headers['x-school-code'] || req.headers['x-school-id'] || '').trim().toLowerCase();
            if (explicitSchool) {
              loginSchool = (db.schools || []).find(s => s.id === explicitSchool || String(s.code || '').toLowerCase() === explicitSchool || String(s.subdomain || '').toLowerCase() === explicitSchool);
            }
          }

          // 2. Resolve account by exact username, alias, or school-scoped mapping
          let account = (db.printCenterAccounts || []).find(a => String(a.username || '').toLowerCase() === cleanUsername);

          // If on a specific school or school provided, match school-scoped operator aliases
          if (!account && loginSchool) {
            const schoolAcc = (db.printCenterAccounts || []).find(a => a.school_id === loginSchool.id);
            if (schoolAcc) {
              const accUser = String(schoolAcc.username || '').toLowerCase();
              const userPrefix = accUser.includes('@') ? accUser.split('@')[0] : accUser;
              const validSchoolAliases = new Set([
                accUser,
                userPrefix,
                String(loginSchool.code || '').toLowerCase(),
                String(loginSchool.subdomain || '').toLowerCase(),
                String(loginSchool.adminUsername || '').toLowerCase(),
                String(loginSchool.officialEmail || '').toLowerCase(),
                String(loginSchool.email || '').toLowerCase(),
                'print',
                'operator',
                'printoperator'
              ].filter(Boolean));

              if (validSchoolAliases.has(cleanUsername)) {
                account = schoolAcc;
              }
            }
          }

          // If no specific school context, match cleanUsername against username prefix across accounts
          if (!account) {
            account = (db.printCenterAccounts || []).find(a => {
              const u = String(a.username || '').toLowerCase();
              const prefix = u.includes('@') ? u.split('@')[0] : u;
              return prefix === cleanUsername || (cleanUsername.startsWith('print.') && u.startsWith(cleanUsername));
            });
          }

          // Fallback backward-compatibility check for default Garumara settings username
          if (!account && db.settings?.printPortalUsername && cleanUsername === String(db.settings.printPortalUsername).toLowerCase()) {
            account = (db.printCenterAccounts || []).find(a => a.school_id === DEFAULT_SCHOOL_ID);
          }

          // If still no account, reject immediately with 401 (NO fallback to Garumara!)
          if (!account) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Invalid Print Portal credentials.' }));
          }

          // 3. Multi-School Tenant Isolation on Login: prevent logging into another school's subdomain
          if (activeSchool && account.school_id !== activeSchool.id) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'This account belongs to another school. Please sign in through your school\'s designated portal.' }));
          }

          // 4. Validate Account Status
          if (account.status === 'Disabled' || account.access_enabled === false) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Print Center access is disabled for this school. Please contact Super Admin.' }));
          }
          if (account.status === 'Suspended') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Print Center access has been suspended for this school. Please contact Super Admin.' }));
          }

          // 5. Validate Associated School
          const school = (db.schools || []).find(s => s.id === account.school_id);
          if (!school) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Associated school not found for this account.' }));
          }
          if (school.status === 'Suspended') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'School is suspended. Print Center access is unavailable.' }));
          }

          // 6. Validate Password using PBKDF2
          const salt = account.password_salt || (account.school_id === DEFAULT_SCHOOL_ID ? db.settings?.printPortalPasswordSalt : '');
          const hash = account.password_hash || (account.school_id === DEFAULT_SCHOOL_ID ? db.settings?.printPortalPasswordHash : '');
          if (!salt || !hash) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Invalid Print Portal credentials.' }));
          }

          const calculatedHash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
          const validPassword = calculatedHash.length === hash.length && crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash));
          if (!validPassword) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Invalid Print Portal credentials.' }));
          }

          account.last_login = new Date().toISOString();
          writeDbRaw(db);

          const tokenVersion = account.token_version || 1;
          const token = signJWT({
            username: account.username,
            role: 'PrintOperator',
            school_id: school.id,
            school_code: school.code,
            token_version: tokenVersion
          }, 7200);

          // Calculate destination portal URL for multi-tenant deployment
          const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim().toLowerCase();
          const proto = String(req.headers['x-forwarded-proto'] || 'http');
          const targetSub = school.subdomain || school.code;

          let portalUrl = '/print-center/portal';
          if (reqHost.endsWith('.localhost')) {
            const port = reqHost.includes(':') ? `:${reqHost.split(':')[1]}` : '';
            portalUrl = `${proto}://${targetSub}.localhost${port}/print-center/portal`;
          } else if (reqHost.includes('.')) {
            const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();
            if (reqHost === baseDomain || reqHost.endsWith('.' + baseDomain)) {
              const port = reqHost.includes(':') ? `:${reqHost.split(':')[1]}` : '';
              portalUrl = `${proto}://${targetSub}.${baseDomain}${port}/print-center/portal`;
            }
          }

          const secureCookie = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ? '; Secure' : '';
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Set-Cookie': 'gjv_print_session=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200' + secureCookie
          });
          return res.end(JSON.stringify({
            token,
            username: account.username,
            role: 'PrintOperator',
            school_id: school.id,
            school_code: school.code,
            school_name: school.name,
            portalUrl,
            expiresIn: 7200
          }));
        }

        if (reqPath === '/api/print-center/logout' && method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': 'gjv_print_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
          return res.end(JSON.stringify({ success: true }));
        }

        // GET /api/print-center/session (validates both browser session cookie and Print JWT)
        if (reqPath === '/api/print-center/session' && method === 'GET') {
          const cookieValue = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('gjv_print_session='));
          const rawCookieToken = cookieValue ? decodeURIComponent(cookieValue.substring('gjv_print_session='.length)) : null;
          const cookieUser = rawCookieToken ? verifyJWT(rawCookieToken) : null;
          const authorization = String(req.headers.authorization || '');
          const rawBearerToken = authorization.startsWith('Bearer ') ? authorization.substring(7) : null;
          const bearerUser = rawBearerToken ? verifyJWT(rawBearerToken) : null;
          const user = cookieUser || bearerUser;
          const activeToken = rawBearerToken || rawCookieToken;
          if (!user || user.role !== 'PrintOperator' || (cookieUser && bearerUser && cookieUser.username !== bearerUser.username)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ error: 'Print Portal session is missing or expired.' }));
          }

          const account = (db.printCenterAccounts || []).find(a => a.school_id === user.school_id || a.username === user.username);
          if (account) {
            if (account.status !== 'Active' || account.access_enabled === false) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
              return res.end(JSON.stringify({ error: 'Print Center access is disabled or suspended for this school.' }));
            }
            if (user.token_version && account.token_version && user.token_version !== account.token_version) {
              res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
              return res.end(JSON.stringify({ error: 'Session has been revoked. Please sign in again.' }));
            }
          }

          const school = (db.schools || []).find(s => s.id === (account?.school_id || user.school_id));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({
            success: true,
            token: activeToken,
            username: user.username,
            role: user.role,
            school_id: school?.id || user.school_id,
            school_code: school?.code || user.school_code,
            school_name: school?.name || (school?.id === DEFAULT_SCHOOL_ID ? 'Garumara Jatiya Vidyalaya' : (school?.name || 'School ERP'))
          }));
        }

        // POST /api/print-center/reset-password (Secure Password Reset from Setup Link)
        if (reqPath === '/api/print-center/reset-password' && method === 'POST') {
          ensurePrintCenterSchema(db);
          const token = req.body?.token;
          const newPassword = req.body?.newPassword || req.body?.new_password;
          if (!token || !newPassword) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Reset token and new password are required.' }));
          }
          if (String(newPassword).length < 6) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'New password must be at least 6 characters.' }));
          }

          const account = (db.printCenterAccounts || []).find(a => a.reset_token && a.reset_token === token);
          if (!account) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Invalid or expired password reset link.' }));
          }

          if (account.reset_token_expiry && new Date(account.reset_token_expiry) < new Date()) {
            account.reset_token = null;
            account.reset_token_expiry = null;
            writeDbRaw(db);
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'This password reset link has expired. Please request a new one.' }));
          }

          const salt = crypto.randomBytes(16).toString('hex');
          const hash = crypto.pbkdf2Sync(String(newPassword), salt, 120000, 64, 'sha512').toString('hex');
          account.password_salt = salt;
          account.password_hash = hash;
          account.reset_token = null;
          account.reset_token_expiry = null;
          account.token_version = (account.token_version || 1) + 1; // Revoke all previous sessions
          account.updated_at = new Date().toISOString();

          if (account.school_id === DEFAULT_SCHOOL_ID) {
            db.settings.printPortalPasswordSalt = salt;
            db.settings.printPortalPasswordHash = hash;
            db.settings.printPortalCredentialsUpdatedAt = account.updated_at;
          }

          db.printCenterAuditLogs.unshift({
            id: 'pal_' + crypto.randomUUID(),
            school_id: account.school_id,
            school_name: account.school_name,
            action: 'PASSWORD_RESET',
            performed_by: account.username,
            role: 'PrintOperator',
            details: `Password reset via secure temporary setup link for ${account.school_name} Print Center account. Previous sessions revoked.`,
            timestamp: new Date().toISOString()
          });

          writeDbRaw(db);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: true, message: 'Password has been set successfully. You can now log in.' }));
        }

        // POST /api/teacher/login
        if (reqPath === '/api/teacher/login' && method === 'POST') {
          const { username, password } = req.body || {};
          const cleanUser = (username || '').trim().toLowerCase();

          console.log(`[TEACHER LOGIN] Attempt for user: "${username}"`);

          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Teacher ID / Username and password are required.' }));
          }

          if (!activeSchool) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'School not found.' }));
          }

          if (activeSchool.status === 'Suspended') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'This school account is currently suspended. Please contact platform administration.' }));
          }

          if (!db.teacherLogin) db.teacherLogin = [];
          if (!db.teachers) db.teachers = [];
          if (!db.teacherPermissions) db.teacherPermissions = {};
          if (!db.teacherActivityLogs) db.teacherActivityLogs = [];
          if (!db.teacherLoginSessions) db.teacherLoginSessions = [];

          let loginAcc = db.teacherLogin.find(l => matchTenant(l, activeSchool.id) && ((l.username || '').toLowerCase() === cleanUser || (l.teacher_id || '').toLowerCase() === cleanUser));
          let teacher = db.teachers.find(t => matchTenant(t, activeSchool.id) && ((t.empId || '').toLowerCase() === cleanUser || (t.loginUsername || '').toLowerCase() === cleanUser || (t.email || '').toLowerCase() === cleanUser || t.mobile === cleanUser));

          if (!loginAcc && teacher) {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(teacher.loginPassword || 'Teacher@123', salt, 1000, 64, 'sha512').toString('hex');
            loginAcc = {
              id: 'tl_' + teacher.empId,
              school_id: activeSchool.id,
              teacher_id: teacher.empId,
              username: (teacher.loginUsername || teacher.empId).toLowerCase(),
              password_hash: hash,
              password_salt: salt,
              status: teacher.status || 'Active',
              login_status: teacher.status || 'Active',
              failed_attempts: 0,
              is_locked: false,
              last_login: null,
              password_reset_token: null,
              token_expiry: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            db.teacherLogin.push(loginAcc);
            writeDbRaw(db);
          }

          if (!loginAcc || !teacher) {
            console.log('[TEACHER LOGIN] ❌ Failed: Account not found');
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Invalid Teacher ID/Username or Password.' }));
          }

          // Check Lockout Status
          if (loginAcc.is_locked) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Account is locked due to multiple failed login attempts. Please contact administration to unlock your account.' }));
          }

          // Check Account Status
          const curStatus = (loginAcc.login_status || loginAcc.status || teacher.status || 'Active');
          if (curStatus !== 'Active') {
            let msg = `Account is ${curStatus.toLowerCase()}. Please contact administration.`;
            if (curStatus === 'Suspended') msg = 'Account is Suspended by Administration. Login access is disabled.';
            else if (curStatus === 'Blocked') msg = 'Account is Blocked due to security reasons. Please contact Administration.';
            else if (curStatus === 'Resigned') msg = 'Account is disabled (Faculty Resigned).';
            else if (curStatus === 'Inactive') msg = 'Account is Inactive. Please contact school administration to activate.';

            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: msg }));
          }

          let isValid = false;
          if (loginAcc.password_salt && loginAcc.password_hash) {
            const testHash = crypto.pbkdf2Sync(password, loginAcc.password_salt, 1000, 64, 'sha512').toString('hex');
            isValid = (testHash === loginAcc.password_hash);
          } else if (teacher.loginPassword) {
            isValid = (password === teacher.loginPassword);
          }

          if (!isValid) {
            loginAcc.failed_attempts = (loginAcc.failed_attempts || 0) + 1;
            if (loginAcc.failed_attempts >= 5) {
              loginAcc.is_locked = true;
              loginAcc.login_status = 'Blocked';
            }

            db.teacherActivityLogs.push({
              id: 'log_' + Date.now(),
              teacher_id: teacher.empId,
              empId: teacher.empId,
              action: 'FAILED_LOGIN',
              description: `Failed login attempt ${loginAcc.failed_attempts}/5 for username "${cleanUser}"`,
              ip: req.socket ? req.socket.remoteAddress : '127.0.0.1',
              userAgent: req.headers['user-agent'] || 'Unknown',
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            console.log(`[TEACHER LOGIN] ❌ Failed: Password mismatch (Attempt ${loginAcc.failed_attempts}/5)`);
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              error: loginAcc.is_locked ?
                'Account locked due to 5 consecutive failed login attempts. Please contact administration.' :
                `Invalid Teacher ID/Username or Password. (Attempt ${loginAcc.failed_attempts}/5)`
            }));
          }

          // Successful Login
          const nowStr = new Date().toISOString();
          loginAcc.failed_attempts = 0;
          loginAcc.is_locked = false;
          loginAcc.last_login = nowStr;
          loginAcc.updated_at = nowStr;
          teacher.lastLogin = nowStr;

          const token = signJWT({
            empId: teacher.empId,
            username: loginAcc.username,
            role: 'Teacher',
            school_id: activeSchool.id,
            school_code: activeSchool.code
          }, 86400);

          // Track active session
          db.teacherLoginSessions.push({
            id: token,
            school_id: activeSchool.id,
            empId: teacher.empId,
            loggedInAt: nowStr
          });

          // Log Activity
          db.teacherActivityLogs.push({
            id: 'log_' + Date.now(),
            school_id: activeSchool.id,
            teacher_id: teacher.empId,
            empId: teacher.empId,
            action: 'LOGIN_SUCCESS',
            description: `Teacher ${teacher.name} (${teacher.empId}) logged in successfully`,
            ip: req.socket ? req.socket.remoteAddress : '127.0.0.1',
            userAgent: req.headers['user-agent'] || 'Unknown',
            timestamp: nowStr
          });

          writeDbRaw(db);

          const permissions = db.teacherPermissions[teacher.empId] || getDefaultTeacherPermissions();

          console.log(`[TEACHER LOGIN] ✅ Success: Teacher ${teacher.name} logged in`);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            token,
            school_id: activeSchool.id,
            school_code: activeSchool.code,
            school: {
              id: activeSchool.id,
              name: activeSchool.name,
              code: activeSchool.code,
              logo: activeSchool.logo || '/logo.jpg',
              favicon: activeSchool.favicon || '/favicon.ico'
            },
            teacher: {
              empId: teacher.empId,
              name: teacher.name,
              designation: teacher.designation,
              subject: teacher.subject,
              classTeacher: teacher.classTeacher,
              email: teacher.email,
              mobile: teacher.mobile,
              photo: teacher.photo,
              status: teacher.status,
              forcePasswordChange: loginAcc ? (loginAcc.force_password_change !== false) : true,
              lastLogin: nowStr
            },
            permissions
          }));
        }

        // POST /api/teacher/logout
        if (reqPath === '/api/teacher/logout' && method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: true, message: 'Logged out successfully.' }));
        }

        // POST /api/teacher/forgot-password
        if (reqPath === '/api/teacher/forgot-password' && method === 'POST') {
          const { username } = req.body || {};
          const cleanUser = (username || '').trim().toLowerCase();
          const teacher = (db.teachers || []).find(t => (t.empId || '').toLowerCase() === cleanUser || (t.loginUsername || '').toLowerCase() === cleanUser || (t.email || '').toLowerCase() === cleanUser);

          if (!teacher) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Teacher ID / Username not found.' }));
          }

          const resetToken = String(Math.floor(100000 + Math.random() * 900000));
          const loginAcc = (db.teacherLogin || []).find(l => l.teacher_id === teacher.empId);
          if (loginAcc) {
            loginAcc.password_reset_token = resetToken;
            loginAcc.token_expiry = Date.now() + 3600000;
            writeDbRaw(db);
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            success: true,
            message: `Password reset request logged for ${teacher.name}. Reset code: ${resetToken}. Please contact administrator.`
          }));
        }

        // POST /api/teacher/reset-password
        if (reqPath === '/api/teacher/reset-password' && method === 'POST') {
          const { empId, oldPassword, newPassword } = req.body || {};
          if (!newPassword || newPassword.length < 4) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'New password must be at least 4 characters long.' }));
          }

          const targetEmpId = empId || (req.user ? req.user.empId : null);
          const teacher = (db.teachers || []).find(t => t.empId === targetEmpId);
          const loginAcc = (db.teacherLogin || []).find(l => l.teacher_id === targetEmpId);

          if (!loginAcc || !teacher) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'Teacher account not found.' }));
          }

          if (oldPassword) {
            const testHash = crypto.pbkdf2Sync(oldPassword, loginAcc.password_salt, 1000, 64, 'sha512').toString('hex');
            if (testHash !== loginAcc.password_hash && oldPassword !== teacher.loginPassword) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Current password is incorrect.' }));
            }
          }

          const salt = crypto.randomBytes(16).toString('hex');
          const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');

          loginAcc.password_hash = hash;
          loginAcc.password_salt = salt;
          loginAcc.force_password_change = false;
          loginAcc.updated_at = new Date().toISOString();
          delete teacher.loginPassword;
          writeDbRaw(db);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ success: true, message: 'Password updated successfully.' }));
        }

        // 2. AUTHENTICATED ENDPOINTS (Dashboard & Administration)

        // POST /api/teacher/refresh (rotates a valid Teacher JWT)
        if (reqPath === '/api/teacher/refresh' && method === 'POST') {
          return handleAnyAuthRoute(() => {
            if (!req.user || (req.user.role !== 'Teacher' && req.user.role !== 'SuperAdmin')) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher authentication is required.' }));
            }
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && t.empId === req.user.empId);
            const login = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && l.teacher_id === req.user.empId);
            if (!teacher || !login || (login.login_status || login.status || teacher.status) !== 'Active') {
              res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher session is no longer active.' }));
            }
            const token = signJWT({
              empId: teacher.empId,
              username: login.username,
              role: 'Teacher',
              school_id: activeSchool.id,
              school_code: activeSchool.code
            }, 86400);
            db.teacherLoginSessions = (db.teacherLoginSessions || []).filter(session => session.empId !== teacher.empId);
            db.teacherLoginSessions.push({ id: token, school_id: activeSchool.id, empId: teacher.empId, loggedInAt: new Date().toISOString(), refreshed: true });
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, token, expiresIn: 86400, school_id: activeSchool.id, school_code: activeSchool.code }));
          });
        }
        // GET /api/teacher/profile
        if (reqPath === '/api/teacher/profile' && method === 'GET') {
          return handleTeacherRoute((db, activeSchool) => {
            const empId = req.user ? req.user.empId : null;
            if (!empId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Missing teacher ID in token.' }));
            }
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === empId || t.loginUsername === req.user.username));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher profile not found.' }));
            }
            const assignments = normalizeTeacherAssignments(db, teacher.empId);
            const classContexts = teacherClassContexts(db, teacher.empId);
            const permissions = (db.teacherPermissions || {})[teacher.empId] || getDefaultTeacherPermissions();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ...safeTeacherRecord(teacher),
              assignments,
              classContexts,
              academicSession: currentAcademicSession(db, activeSchool.id),
              permissions,
              school: activeSchool ? {
                id: activeSchool.id,
                name: activeSchool.name,
                code: activeSchool.code,
                logo: activeSchool.logo || '/logo.jpg',
                favicon: activeSchool.favicon || '/favicon.ico'
              } : null
            }));
          });
        }

        // GET /api/dashboard/overview
        if (reqPath === '/api/dashboard/overview' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const now = new Date();
            const todayStr = getLocalDateStr(now);
            const currentMonthStr = getLocalMonthStr(now);
            const requestedSession = normalizeAcademicSession(parsedUrl.query?.academic_session || parsedUrl.query?.academicSession || parsedUrl.query?.session, db, activeSchool.id);

            const students = (db.students || []).filter(student => matchTenant(student, activeSchool.id) && studentAcademicSession(student, db) === requestedSession);
            const fees = (db.fees || []).filter(fee => matchTenant(fee, activeSchool.id) && fee.status !== 'Refunded' && !fee.deleted_at && normalizeAcademicSession(fee.academic_session || fee.session, db, activeSchool.id) === requestedSession);
            const attendance = ensureCentralStudentAttendance(db).filter(row => matchTenant(row, activeSchool.id));
            const notices = (db.notices || []).filter(n => matchTenant(n, activeSchool.id));
            const exams = (db.exams || []).filter(exam => matchTenant(exam, activeSchool.id) && normalizeAcademicSession(exam.academic_session || exam.session, db, activeSchool.id) === requestedSession);
            const auditLogs = (db.feeAuditLogs || []).filter(l => matchTenant(l, activeSchool.id));

            const activeStudents = students.filter(isStudentActive);
            const totalStudents = activeStudents.length;

            // Admissions count
            const newAdmissionsToday = students.filter(s => s.admissionDate === todayStr).length;
            const newAdmissionsMonth = students.filter(s => (s.admissionDate || '').slice(0, 7) === currentMonthStr).length;

            // Class distribution & sections
            const classDist = {};
            const classSet = new Set();
            const sectionSet = new Set();
            activeStudents.forEach(s => {
              const cls = String(s.className || '').trim();
              const sec = String(s.section || '').trim();
              if (!cls) return;
              classDist[cls] = (classDist[cls] || 0) + 1;
              classSet.add(cls);
              if (sec) sectionSet.add(`${cls}-${sec}`);
            });

            // Fee collection stats
            let feesToday = 0;
            let feesMonth = 0;
            let feesYear = 0;
            const feeByMonth = {};

            fees.forEach(f => {
              const amt = Number(f.totalReceived ?? (Number(f.amount || 0) + Number(f.lateFee || 0)));
              const fDate = getLocalDateStr(f.date);
              const fMonth = getLocalMonthStr(f.date) || f.month;
              if (fDate === todayStr) feesToday += amt;
              if (fMonth === currentMonthStr || f.month === currentMonthStr) feesMonth += amt;
              feesYear += amt;

              const monthLabel = f.month || fMonth || 'Other';
              feeByMonth[monthLabel] = (feeByMonth[monthLabel] || 0) + amt;
            });

            // Pending fee dues
            let totalPendingFees = 0;
            let totalDueStudents = 0;

            activeStudents.forEach(s => {
              const studentDue = feeProfileForStudent(db, s, {
                session: requestedSession,
                month: currentMonthStr,
                type: 'Monthly Tuition Fee'
              }).previousDues;
              if (studentDue > 0) {
                totalPendingFees += studentDue;
                totalDueStudents++;
              }
            });

            const dateFrom = normalizeAttendanceDate(parsedUrl.query?.date_from || parsedUrl.query?.dateFrom || todayStr);
            const dateTo = normalizeAttendanceDate(parsedUrl.query?.date_to || parsedUrl.query?.dateTo || todayStr);
            const activeStudentIds = new Set(activeStudents.map(student =>
              student.admissionNo || student.studentId || student.id
            ));
            const attendanceRules = db.settings?.attendanceRules || {};
            const halfDayWeight = Number.isFinite(Number(attendanceRules.halfDayWeight))
              ? Math.max(0, Math.min(1, Number(attendanceRules.halfDayWeight)))
              : 0.5;
            const leaveRule = String(attendanceRules.leave || 'exclude').trim().toLowerCase();
            const attendanceRows = attendance.filter(row => {
              const rowDate = normalizeAttendanceDate(row.attendance_date || row.date);
              const rowSession = normalizeAcademicSession(row.academic_session || row.academicSession, db);
              return rowDate && rowDate >= dateFrom && rowDate <= dateTo &&
                rowSession === requestedSession &&
                activeStudentIds.has(row.student_id || row.studentId || row.admission_number || row.admissionNo);
            });
            const attendanceStats = {
              present: 0, absent: 0, late: 0, halfDay: 0, leave: 0,
              holiday: 0, totalRecords: 0, presentEquivalent: 0
            };
            attendanceRows.forEach(row => {
              const status = String(row.status || '').replace(/\s+/g, ' ').trim().toLowerCase();
              if (status === 'present') {
                attendanceStats.present++;
                attendanceStats.presentEquivalent++;
                attendanceStats.totalRecords++;
              } else if (status === 'late') {
                attendanceStats.late++;
                attendanceStats.presentEquivalent++;
                attendanceStats.totalRecords++;
              } else if (status === 'half day' || status === 'halfday') {
                attendanceStats.halfDay++;
                attendanceStats.presentEquivalent += halfDayWeight;
                attendanceStats.totalRecords++;
              } else if (status === 'absent') {
                attendanceStats.absent++;
                attendanceStats.totalRecords++;
              } else if (status === 'leave') {
                attendanceStats.leave++;
                if (leaveRule === 'present') {
                  attendanceStats.presentEquivalent++;
                  attendanceStats.totalRecords++;
                } else if (leaveRule === 'absent') {
                  attendanceStats.totalRecords++;
                }
              } else if (status === 'holiday') {
                attendanceStats.holiday++;
              }
            });
            const attendanceRecorded = attendanceStats.totalRecords > 0;
            const studentAttendanceRate = attendanceRecorded
              ? Number(((attendanceStats.presentEquivalent / attendanceStats.totalRecords) * 100).toFixed(1))
              : null;

            // Birthday Reminders (Active Students & Teachers born in current month)
            const curMonthNum = String(now.getMonth() + 1).padStart(2, '0');
            const studentBirthdays = students
              .filter(s => {
                if (s.status === 'Inactive' || s.status === 'Deleted' || s.deletedAt) return false;
                if (!s.dob) return false;
                const dobMonth = String(s.dob).slice(5, 7);
                return dobMonth === curMonthNum;
              })
              .map(s => ({
                name: s.name,
                role: `Student (${s.className || ''}${s.section ? '-' + s.section : ''})`.trim(),
                dob: s.dob
              }));

            const teacherBirthdays = (db.teachers || [])
              .filter(t => {
                if (!matchTenant(t, activeSchool.id)) return false;
                const st = String(t.status || 'Active').toLowerCase();
                if (st === 'deleted' || st === 'inactive' || st === 'archived' || t.deletedAt) return false;
                if (!t.dob) return false;
                const dobMonth = String(t.dob).slice(5, 7);
                return dobMonth === curMonthNum;
              })
              .map(t => ({
                name: t.name,
                role: `Teacher (${t.subject || 'Staff'})`.trim(),
                dob: t.dob
              }));

            const birthdayList = [...studentBirthdays, ...teacherBirthdays]
              .sort((a, b) => {
                const dayA = parseInt(String(a.dob).slice(8, 10), 10) || 0;
                const dayB = parseInt(String(b.dob).slice(8, 10), 10) || 0;
                return dayA - dayB;
              });

            // Recent Lists
            const recentAdmissions = [...students]
              .reverse()
              .slice(0, 5)
              .map(s => ({
                admissionNo: s.admissionNo,
                name: s.name,
                className: s.className,
                section: s.section,
                date: s.admissionDate || todayStr
              }));

            const recentFeeCollections = [...fees]
              .reverse()
              .slice(0, 5)
              .map(f => ({
                receiptNo: f.receiptNo,
                studentId: f.studentId,
                studentName: f.studentName || f.studentId,
                amount: f.amount,
                paymentMode: f.paymentMode,
                type: f.type,
                date: f.date
              }));

            const recentNoticesList = [...notices]
              .reverse()
              .slice(0, 4);

            // Merged Activity Log Stream
            const activityStream = [];
            
            recentAdmissions.forEach(a => {
              activityStream.push({
                type: 'ADMISSION',
                title: `New Student Onboarded: ${a.name} (${a.admissionNo})`,
                subtitle: `Class: ${a.className}-${a.section}`,
                time: a.date
              });
            });

            recentFeeCollections.forEach(f => {
              activityStream.push({
                type: 'FEE',
                title: `Fee Collected: ₹${f.amount} (${f.receiptNo})`,
                subtitle: `Student: ${f.studentName} via ${f.paymentMode}`,
                time: f.date
              });
            });

            auditLogs.slice(-3).forEach(l => {
              activityStream.push({
                type: 'AUDIT',
                title: `Admin Action: ${l.action}`,
                subtitle: `Receipt: ${l.receiptNo} by ${l.adminUser}`,
                time: l.timestamp
              });
            });

            activityStream.sort((a, b) => new Date(b.time) - new Date(a.time));

            const overview = {
              metrics: {
                totalStudents,
                newAdmissionsToday,
                newAdmissionsMonth,
                totalTeachers: (db.teachers || []).filter(t => (t.status || 'Active') === 'Active').length,
                totalStaff: (db.teachers || []).filter(t => (t.status || 'Active') === 'Active').length,
                totalClasses: classSet.size,
                totalSections: sectionSet.size,
                studentAttendanceToday: studentAttendanceRate,
                attendanceRecorded,
                presentToday: attendanceStats.present,
                absentToday: attendanceStats.absent,
                lateToday: attendanceStats.late,
                halfDayToday: attendanceStats.halfDay,
                leaveToday: attendanceStats.leave,
                holidayToday: attendanceStats.holiday,
                totalAttendanceRecords: attendanceStats.totalRecords,
                attendanceAcademicSession: requestedSession,
                attendanceDateFrom: dateFrom,
                attendanceDateTo: dateTo,
                teacherAttendanceToday: (() => { const rows = (db.teacherAttendance || []).filter(row => normalizeAttendanceDate(row.date || row.attendance_date) === todayStr); if (!rows.length) return null; const present = rows.filter(row => ['present', 'late'].includes(String(row.status || '').toLowerCase())).length; return Number(((present / rows.length) * 100).toFixed(1)); })(),
                feesCollectedToday: feesToday,
                feesCollectedMonth: feesMonth,
                feesCollectedYear: feesYear,
                totalPendingFees,
                totalDueStudents
              },
              analytics: {
                monthlyFeeCollection: feeByMonth,
                classDistribution: classDist,
                attendanceStats: {
                  ...attendanceStats,
                  percentage: studentAttendanceRate,
                  recorded: attendanceRecorded,
                  academicSession: requestedSession,
                  dateFrom,
                  dateTo,
                  halfDayWeight,
                  leaveRule
                },
                feeVsDue: {
                  collected: feesMonth,
                  due: totalPendingFees
                }
              },
              lists: {
                upcomingExams: (exams || []).slice(0, 3),
                recentAdmissions,
                recentFeeCollections,
                recentNotices: recentNoticesList,
                birthdayList,
                recentActivityLogs: activityStream.slice(0, 8)
              },
              alerts: {
                feeDueAlert: totalDueStudents > 0 ? `⚠️ ${totalDueStudents} students have outstanding fee dues (Total ₹${totalPendingFees}).` : 'All student fees are fully cleared.',
                upcomingExamAlert: exams.length ? `Upcoming exam: ${exams[0].examName || exams[0].name || exams[0].examType || 'Scheduled examination'}.` : 'No exams scheduled for this academic session.',
                backupStatus: `Database is available. ${fs.readdirSync(BACKUPS_DIR).filter(name => name.endsWith('.json')).length} local backup file(s) found.`,
                notificationsCount: notices.length,
                academicSession: requestedSession
              }
            };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(overview));
          });
        }

        // GET /api/auth/me
        if (reqPath === '/api/auth/me' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              username: req.user.username,
              role: req.user.role,
              school: activeSchool ? {
                id: activeSchool.id,
                name: activeSchool.name,
                code: activeSchool.code,
                logo: activeSchool.logo || (activeSchool.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg'),
                favicon: activeSchool.favicon || '/favicon.ico',
                address: activeSchool.address || '',
                phone: activeSchool.phone || '',
                email: activeSchool.officialEmail || activeSchool.email || '',
                establishedYear: activeSchool.establishedYear || '',
                affiliation: activeSchool.affiliation || '',
                type: activeSchool.type || ''
              } : null
            }));
          });
        }

        // GET /api/leadership (Public & Scoped)
        if (reqPath === '/api/leadership' && method === 'GET') {
          let targetSchool = activeSchool;
          if (!targetSchool) {
            const authHeader = req.headers['authorization'];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              const u = verifyJWT(authHeader.substring(7));
              if (u && u.school_id) {
                targetSchool = (db.schools || []).find(s => s.id === u.school_id) || null;
              }
            }
          }
          if (!targetSchool) {
            targetSchool = resolveRequestSchool(req, db, { allowDefaultFallback: false });
          }
          if (!targetSchool) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify([]));
          }
          ensureSchoolLeadership(db, targetSchool);
          const leaders = (db.leadership || []).filter(l => matchTenant(l, targetSchool.id));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(leaders));
        }

        // PUT /api/leadership/:id (Protected Admin Route)
        if (reqPath.startsWith('/api/leadership/') && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.substring(16);
            if (!id) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Leader ID is required.' }));
            }
            if (req.user.role !== 'SuperAdmin' && req.user.school_id && activeSchool && activeSchool.id !== req.user.school_id) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Unauthorized cross-school leader update.' }));
            }
            if (!db.leadership) db.leadership = [];
            let index = db.leadership.findIndex(l => matchTenant(l, activeSchool.id) && l.id === id);
            if (index === -1) {
              const newLeader = {
                id,
                school_id: activeSchool.id,
                name: String(req.body.name || '').trim(),
                qualification: String(req.body.qualification || '').trim(),
                designation: String(req.body.designation || '').trim(),
                message: String(req.body.message || '').trim(),
                photo: req.body.photo || ''
              };
              db.leadership.push(newLeader);
              index = db.leadership.length - 1;
            } else {
              db.leadership[index] = {
                ...db.leadership[index],
                ...req.body,
                id,
                school_id: activeSchool.id
              };
            }
            // Keep activeSchool principalName & principalMessage in sync
            if (id === 'principal') {
              if (req.body.name) {
                activeSchool.principalName = String(req.body.name).trim();
                if (activeSchool.websiteContent) {
                  activeSchool.websiteContent.principalName = activeSchool.principalName;
                }
              }
              if (req.body.message && activeSchool.websiteContent) {
                activeSchool.websiteContent.principalMessage = String(req.body.message).trim();
              }
            }
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(db.leadership[index]));
          });
        }

        // GET /api/teacher/students (Teacher-scoped roster for assigned classes)
        if (reqPath === '/api/teacher/students' && method === 'GET') {
          return handleTeacherRoute(() => {
            const teacherId = req.user?.empId || req.user?.id;
            const contexts = teacherClassContexts(db, teacherId);
            const requestedClass = normalizeClassName(parsedUrl.query?.className || parsedUrl.query?.class_name);
            const requestedSection = normalizeSectionName(parsedUrl.query?.section || parsedUrl.query?.section_name);
            const requestedSessionId = String(parsedUrl.query?.academic_session_id || '').trim();
            const requestedSessionRecord = requestedSessionId ? (db.academicSessions || []).find(row=>String(row.id)===requestedSessionId) : null;
            if (requestedSessionId && !requestedSessionRecord) { res.writeHead(400, { 'Content-Type':'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error:'Academic Session is invalid.' })); }
            const requestedSession = String(
              requestedSessionRecord?.session_name || parsedUrl.query?.academic_session ||
              parsedUrl.query?.academicSession ||
              currentAcademicSession(db)
            ).trim();

            if (!contexts.length) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({
                assignments: [],
                students: [],
                academic_session: currentAcademicSession(db)
              }));
            }

            let selectedContext = contexts.find(context =>
              (context.class_name === requestedClass || !requestedClass) &&
              (context.section === 'All Sections' || context.section === requestedSection || !requestedSection) &&
              normalizeAcademicSession(context.academic_session, db) === normalizeAcademicSession(requestedSession, db)
            );
            if (!selectedContext && (!requestedClass || !requestedSection)) {
              selectedContext = contexts[0];
            }
            if (!selectedContext) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'The selected class and section are not assigned to this teacher.' }));
            }

            const students = (db.students || [])
              .filter(student => studentMatchesContext(student, selectedContext, db))
              .map(student => ({
                ...student,
                className: normalizeClassName(student.className || student.class_name),
                section: normalizeSectionName(student.section || student.section_name),
                academicSession: studentAcademicSession(student, db),
                academic_session_id: student.academic_session_id || requestedSessionRecord?.id || '',
                status: student.status || student.student_status || 'Active'
              }))
              .sort((a, b) =>
                String(a.section).localeCompare(String(b.section), undefined, { numeric: true }) ||
                String(a.rollNo || '').localeCompare(String(b.rollNo || ''), undefined, { numeric: true }) ||
                String(a.name || '').localeCompare(String(b.name || ''))
              );

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              assignments: contexts,
              selected_assignment: selectedContext,
              academic_session: requestedSession,
              students
            }));
          });
        }

        // GET /api/admission-applications (Admin)
        if (reqPath === '/api/admission-applications' && method === 'GET') {
          return handleAdminRoute(() => {
            const q = parsedUrl.query || {};
            const clean = v => String(v || '').trim().toLowerCase();
            let applications = (db.admissionApplications || []).filter(a => !a.deletedAt);
            if (q.status && q.status !== 'All') applications = applications.filter(a => clean(a.applicationStatus) === clean(q.status));
            if (q.session) applications = applications.filter(a => clean(a.academicSession).replace('/', '-') === clean(q.session).replace('/', '-'));
            if (q.classApplied) applications = applications.filter(a => clean(a.classApplied) === clean(q.classApplied));
            if (q.date) applications = applications.filter(a => a.applicationDate === q.date);
            if (q.search) applications = applications.filter(a => [a.applicationNumber, a.studentName, a.mobileNumber].some(v => clean(v).includes(clean(q.search))));
            applications.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
            const all = (db.admissionApplications || []).filter(a => !a.deletedAt);
            const summary = { total: all.length, new: 0, pendingReview: 0, approved: 0, rejected: 0, waitingList: 0 };
            all.forEach(a => {
              const key = clean(a.applicationStatus).replace(/\s+/g, '');
              if (key === 'new') summary.new++;
              else if (key === 'pendingreview' || key === 'pending') summary.pendingReview++;
              else if (key === 'approved') summary.approved++;
              else if (key === 'rejected') summary.rejected++;
              else if (key === 'waitinglist') summary.waitingList++;
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ applications, summary }));
          });
        }

        const admissionMatch = reqPath.match(/^\/api\/admission-applications\/([^/]+)$/);
        const admissionActionMatch = reqPath.match(/^\/api\/admission-applications\/([^/]+)\/(approve|reject|convert)$/);
        if (admissionActionMatch && method === 'POST') {
          return handleAdminRoute(() => {
            const [, applicationId, action] = admissionActionMatch;
            const application = (db.admissionApplications || []).find(a => (a.id === decodeURIComponent(applicationId) || a.applicationNumber === decodeURIComponent(applicationId)) && !a.deletedAt);
            if (!application) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Admission application not found.' }));
            }
            const now = new Date().toISOString();
            const addHistory = (status, remarks = '') => {
              application.statusHistory = Array.isArray(application.statusHistory) ? application.statusHistory : [];
              application.statusHistory.push({ status, remarks, at: now, by: req.user.username || 'Admin' });
              application.updatedAt = now;
            };
            if (action === 'reject') {
              const reason = String((req.body || {}).remarks || '').trim();
              if (!reason) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'A rejection reason is required.' }));
              }
              application.applicationStatus = 'Rejected';
              application.adminRemarks = reason;
              addHistory('Rejected', reason);
              writeDbRaw(db);
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, application }));
            }
            if (application.convertedStudentAdmissionNo) {
              const existing = (db.students || []).find(st => st.admissionNo === application.convertedStudentAdmissionNo);
              writeDbRaw(db);
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, application, student: existing, alreadyConverted: true }));
            }
            const duplicateStudent = (db.students || []).find(st =>
              String(st.applicationId || '') === application.id ||
              (String(st.name || '').trim().toLowerCase() === String(application.studentName).trim().toLowerCase() &&
               st.dob === application.dateOfBirth && String(st.mobile || '').replace(/\D/g, '') === application.mobileNumber));
            if (duplicateStudent) {
              application.convertedStudentAdmissionNo = duplicateStudent.admissionNo;
              application.applicationStatus = action === 'approve' ? 'Approved' : 'Converted';
              addHistory(action === 'approve' ? 'Approved and Converted' : 'Converted', 'Linked to existing student record.');
              writeDbRaw(db);
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, application, student: duplicateStudent, alreadyConverted: true }));
            }
            const year = new Date().getFullYear();
            let seq = (db.students || []).length + 1;
            let admissionNo;
            do { admissionNo = `GJV-${year}-${String(seq++).padStart(4, '0')}`; }
            while ((db.students || []).some(st => st.admissionNo === admissionNo));
            const classStudents = (db.students || []).filter(st => st.className === application.classApplied && st.status !== 'Deleted');
            const student = {
              admissionNo, applicationId: application.id, name: application.studentName,
              dob: application.dateOfBirth, gender: application.gender, className: application.classApplied,
              section: String((req.body || {}).section || 'A'), rollNo: classStudents.length + 1,
              fatherName: application.fatherName, motherName: application.motherName || '', guardianName: application.fatherName,
              mobile: application.mobileNumber, alternateMobile: application.alternateMobile || '', email: application.email || '',
              address: application.address || '', studentAadhaar: application.studentAadhaar || '', fatherAadhaar: application.fatherAadhaar || '',
              previousSchool: application.previousSchool || '', session: application.academicSession,
              admissionFee: Number((req.body || {}).admissionFee || 0), monthlyFee: Number((req.body || {}).monthlyFee || 0),
              admissionDate: new Date().toISOString().slice(0, 10), photo: application.studentPhoto || '', status: 'Active'
            };
            db.students.push(student);
            application.convertedStudentAdmissionNo = admissionNo;
            application.applicationStatus = action === 'approve' ? 'Approved' : 'Converted';
            application.approvedAt = now;
            application.approvedBy = req.user.username || 'Admin';
            addHistory(action === 'approve' ? 'Approved and Converted' : 'Converted');
            writeDbRaw(db);
            triggerNotifications(db, student, 'Admission');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Application converted to student admission.', application, student }));
          });
        }

        if (admissionMatch && method === 'PUT') {
          return handleAdminRoute(() => {
            const application = (db.admissionApplications || []).find(a => a.id === decodeURIComponent(admissionMatch[1]) && !a.deletedAt);
            if (!application) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Admission application not found.' }));
            }
            const input = req.body || {};
            const editable = ['studentName','dateOfBirth','gender','classApplied','academicSession','fatherName','motherName','mobileNumber','alternateMobile','email','address','studentAadhaar','fatherAadhaar','previousSchool','message'];
            editable.forEach(key => { if (input[key] !== undefined) application[key] = String(input[key]).trim(); });
            if (!application.studentName || !application.classApplied || !application.fatherName || !/^\d{10}$/.test(String(application.mobileNumber || '').replace(/\D/g, ''))) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student name, class, father name and a valid 10-digit mobile number are required.' }));
            }
            const allowedStatuses = ['New', 'Pending Review', 'Approved', 'Rejected', 'Waiting List'];
            if (input.applicationStatus !== undefined) {
              if (!allowedStatuses.includes(input.applicationStatus)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Invalid application status.' }));
              }
              if (application.convertedStudentAdmissionNo && input.applicationStatus !== 'Approved') {
                res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'An approved, converted application must retain Approved status.' }));
              }
              if (application.applicationStatus !== input.applicationStatus) {
                application.statusHistory = Array.isArray(application.statusHistory) ? application.statusHistory : [];
                application.statusHistory.push({ status: input.applicationStatus, remarks: String(input.adminRemarks || ''), at: new Date().toISOString(), by: req.user.username || 'Admin' });
                application.applicationStatus = input.applicationStatus;
              }
            }
            application.adminRemarks = String(input.adminRemarks !== undefined ? input.adminRemarks : application.adminRemarks || '').trim();
            application.updatedAt = new Date().toISOString();
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, application }));
          });
        }

        if (admissionMatch && method === 'DELETE') {
          return handleAdminRoute(() => {
            const application = (db.admissionApplications || []).find(a => a.id === decodeURIComponent(admissionMatch[1]) && !a.deletedAt);
            if (!application) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Admission application not found.' }));
            }
            if (application.convertedStudentAdmissionNo) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Converted applications must be preserved for audit history.' }));
            }
            application.deletedAt = new Date().toISOString();
            application.updatedAt = application.deletedAt;
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true }));
          });
        }

        // GET /api/students (Allows both Admin & Teacher authentication, with optional className and section filter)
        if (reqPath === '/api/students' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const className = parsedUrl.query ? parsedUrl.query.className : null;
            const section = parsedUrl.query ? parsedUrl.query.section : null;
            const sessionId = parsedUrl.query ? parsedUrl.query.academic_session_id : null;
            const sessionRecord = sessionId ? (db.academicSessions || []).find(item => matchTenant(item, activeSchool.id) && String(item.id) === String(sessionId)) : null;
            if (sessionId && !sessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session ID is invalid.' })); }
            const session = sessionRecord?.session_name || (parsedUrl.query ? (parsedUrl.query.session || parsedUrl.query.academic_session) : null);

            let list = (db.students || []).filter(s => matchTenant(s, activeSchool.id) && s.status !== 'Inactive' && s.status !== 'Deleted');
            if (className && className.trim()) {
              const cleanCls = className.trim().toLowerCase();
              list = list.filter(s => (s.className || '').trim().toLowerCase() === cleanCls);
            }
            if (section && section.trim()) {
              const cleanSec = section.trim().toLowerCase();
              list = list.filter(s => (s.section || '').trim().toLowerCase() === cleanSec);
            }
            if (sessionRecord) list = list.filter(student => String(student.academic_session_id || '') === String(sessionRecord.id));
            else if (session) list = list.filter(student => studentAcademicSession(student, db) === normalizeAcademicSession(session, db, activeSchool.id));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/students (New Admission)
        if (reqPath === '/api/students' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const student = req.body;
            // Validate required fields
            const required = ['name', 'dob', 'gender', 'className', 'section', 'rollNo', 'fatherName', 'mobile', 'admissionFee', 'monthlyFee', 'studentAadhaar', 'fatherAadhaar'];
            for (let field of required) {
              if (student[field] === undefined || student[field] === '') {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `Field '${field}' is required.` }));
              }
            }

            // Aadhaar formatting checks
            if (!/^\d{12}$/.test(student.studentAadhaar)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student Aadhaar must be exactly 12 numeric digits.' }));
            }
            if (!/^\d{12}$/.test(student.fatherAadhaar)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: "Father's Aadhaar must be exactly 12 numeric digits." }));
            }

            // Generate Admission Number (Auto format: <SCHOOL_CODE>-YYYY-XXXX)
            const year = new Date().getFullYear();
            const admissionNo = generateAdmissionNo(db, activeSchool, year);

            const activeSession = (db.academicSessions || []).find(item => matchTenant(item, activeSchool.id) && item.is_active) || (db.academicSessions || []).find(item => matchTenant(item, activeSchool.id)) || ensureAcademicSessions(db, activeSchool.id).find(item => item.is_active);
            if (!activeSession) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'No active Academic Session is configured.' })); }
            const newStudent = {
              ...student,
              school_id: activeSchool.id,
              academic_session_id: activeSession.id,
              academic_session: activeSession.session_name,
              academicSession: activeSession.session_name,
              admissionNo,
              rollNo: Number(student.rollNo),
              admissionFee: Number(student.admissionFee),
              monthlyFee: Number(student.monthlyFee),
              admissionDate: student.admissionDate || new Date().toISOString().split('T')[0]
            };

            if (!Array.isArray(db.students)) db.students = [];
            db.students.push(newStudent);
            writeDbRaw(db);
            queueWhatsAppAutomation('admission',newStudent,[newStudent.name,newStudent.admissionNo,newStudent.className+'-'+newStudent.section,newStudent.academicSession],'admission:'+newStudent.admissionNo);

            // Trigger Admission Confirm notification
            triggerNotifications(db, newStudent, 'Admission');
            // Trigger ID Card generated notification
            triggerNotifications(db, newStudent, 'IDCard');

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newStudent));
          });
        }

        // PUT /api/students/:id (Update Student)
        if (reqPath.startsWith('/api/students/') && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            const admNo = reqPath.substring(14);
            const index = db.students.findIndex(s => s.admissionNo === admNo && matchTenant(s, activeSchool.id));
            if (index === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student not found.' }));
            }
            
            const updateBody = req.body;
            if (updateBody.studentAadhaar !== undefined && !/^\d{12}$/.test(updateBody.studentAadhaar)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student Aadhaar must be exactly 12 numeric digits.' }));
            }
            if (updateBody.fatherAadhaar !== undefined && !/^\d{12}$/.test(updateBody.fatherAadhaar)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: "Father's Aadhaar must be exactly 12 numeric digits." }));
            }

            db.students[index] = {
              ...db.students[index],
              ...updateBody,
              school_id: activeSchool.id,
              admissionNo: admNo // protect primary key
            };
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(db.students[index]));
          });
        }

        // DELETE /api/students/:id (Delete Student)
        if (reqPath.startsWith('/api/students/') && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            const admNo = reqPath.substring(14);
            const index = db.students.findIndex(s => s.admissionNo === admNo && matchTenant(s, activeSchool.id));
            if (index === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student not found.' }));
            }
            db.students.splice(index, 1);
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true }));
          });
        }

        // ================= TEACHER MANAGEMENT ENDPOINTS =================
        // GET /api/teachers/stats
        if (reqPath === '/api/teachers/stats' && method === 'GET') {
          return handleAdminRoute(() => {
            const teachers = (db.teachers || []).filter(t => {
              const st = (t.status || 'Active').toLowerCase();
              return st !== 'deleted' && st !== 'inactive' && st !== 'archived';
            });
            const attendance = db.teacherAttendance || [];
            const leaves = db.teacherLeaves || [];
            const salaries = db.teacherSalaries || [];
            const today = getLocalDateStr(new Date());
            const curMonth = getLocalMonthStr(new Date());

            const totalTeachers = teachers.length;
            const activeTeachers = teachers.filter(t => (t.status || 'Active') === 'Active').length;
            
            const todayRec = attendance.find(a => a.date === today);
            let presentToday = 0;
            let absentToday = 0;
            if (todayRec && todayRec.records) {
              presentToday = todayRec.records.filter(r => r.status === 'Present' || r.status === 'Half Day' || r.status === 'Late').length;
              absentToday = todayRec.records.filter(r => r.status === 'Absent').length;
            } else {
              presentToday = activeTeachers;
              absentToday = 0;
            }

            const onLeave = teachers.filter(t => t.status === 'On Leave').length;
            const pendingLeaveRequests = leaves.filter(l => l.status === 'Pending').length;
            
            const monthlySalaries = salaries.filter(s => s.month === curMonth);
            const monthlySalaryExpense = monthlySalaries.reduce((sum, s) => sum + Number(s.netSalary || 0), 0) || (activeTeachers * 25000);
            const newThisMonth = teachers.filter(t => (t.joiningDate || '').slice(0, 7) === curMonth).length;

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              totalTeachers,
              activeTeachers,
              presentToday,
              absentToday,
              onLeave,
              pendingLeaveRequests,
              monthlySalaryExpense,
              newThisMonth
            }));
          });
        }

        // GET /api/teachers
        if (reqPath === '/api/teachers' && method === 'GET') {
          return handleAdminRoute(() => {
            const subject = parsedUrl.query ? parsedUrl.query.subject : null;
            const classTeacher = parsedUrl.query ? parsedUrl.query.classTeacher : null;
            const status = parsedUrl.query ? parsedUrl.query.status : null;
            const employmentType = parsedUrl.query ? parsedUrl.query.employmentType : null;
            let list = (db.teachers || []).filter(t => matchTenant(t, activeSchool.id));

            if (!status) {
              list = list.filter(t => {
                const st = (t.status || 'Active').toLowerCase();
                return st !== 'deleted' && st !== 'inactive' && st !== 'archived';
              });
            } else if (status.toLowerCase() !== 'all' && status.toLowerCase() !== 'all_with_deleted') {
              list = list.filter(t => (t.status || 'Active').toLowerCase() === status.toLowerCase());
            }

            if (subject) list = list.filter(t => (t.subject || '').toLowerCase() === subject.toLowerCase());
            if (classTeacher) list = list.filter(t => (t.classTeacher || '').toLowerCase() === classTeacher.toLowerCase());
            if (employmentType) list = list.filter(t => (t.employmentType || '').toLowerCase() === employmentType.toLowerCase());

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list.map(safeTeacherRecord)));
          });
        }

        // POST /api/teachers (Register Teacher & Create Login Account Atomically)
        if (reqPath === '/api/teachers' && method === 'POST') {
          return handleAdminRoute(() => {
            const data = req.body || {};
            if (!data.name || !data.mobile) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher Full Name and Mobile number are required.' }));
            }

            if (!db.teachers) db.teachers = [];
            if (!db.teacherLogin) db.teacherLogin = [];

            // 1. Duplicate Mobile Check (scoped to active school)
            const existingMobile = db.teachers.find(t => matchTenant(t, activeSchool.id) && t.mobile === data.mobile);
            if (existingMobile) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Mobile number ${data.mobile} is already registered for teacher ${existingMobile.name} (${existingMobile.empId}).` }));
            }

            // 2. Duplicate Email Check (scoped to active school)
            if (data.email && data.email.trim()) {
              const cleanEmail = data.email.trim().toLowerCase();
              const existingEmail = db.teachers.find(t => matchTenant(t, activeSchool.id) && (t.email || '').toLowerCase() === cleanEmail);
              if (existingEmail) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `Email address ${data.email} is already registered for teacher ${existingEmail.name} (${existingEmail.empId}).` }));
              }
            }

            // 3. Generate Teacher ID safely
            let maxSeq = 0;
            (db.teachers || []).filter(t => matchTenant(t, activeSchool.id)).forEach(t => {
              const match = (t.empId || '').match(/\d+$/);
              if (match) {
                const num = parseInt(match[0], 10);
                if (num > maxSeq) maxSeq = num;
              }
            });
            const yearStr = new Date().getFullYear();
            const seqStr = String(maxSeq + 1).padStart(4, '0');
            const prefix = (activeSchool?.code || 'TCH').toUpperCase();
            const empId = data.empId || `TCH-${yearStr}-${seqStr}`;

            // Check Teacher ID uniqueness
            if (db.teachers.some(t => matchTenant(t, activeSchool.id) && t.empId === empId)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Teacher ID ${empId} already exists.` }));
            }

            // 4. Username handling & uniqueness
            let loginUser = (data.loginUsername || '').trim().toLowerCase();
            if (!loginUser) {
              loginUser = `${empId.toLowerCase()}@${activeSchool.code || 'garumara'}`;
            }

            const existingUser = db.teacherLogin.find(l => matchTenant(l, activeSchool.id) && (l.username || '').toLowerCase() === loginUser);
            if (existingUser) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Username "${loginUser}" is already taken by another teacher account.` }));
            }

            // 5. Temporary Password handling
            let rawPassword = (data.loginPassword || '').trim();
            if (!rawPassword) {
              rawPassword = `GjvTch#${Math.floor(1000 + Math.random() * 9000)}`;
            } else if (rawPassword.length < 8 || !/[A-Za-z]/.test(rawPassword) || !/[0-9]/.test(rawPassword)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Password must be at least 8 characters long and contain both letters and numbers.' }));
            }

            // 6. Password Hashing (SHA-512 with PBKDF2)
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(rawPassword, salt, 1000, 64, 'sha512').toString('hex');

            const loginStatus = data.loginStatus || data.status || 'Active';
            const forceChange = data.forcePasswordChange !== false;

            // 7. Atomic Database Insertion
            const newTeacher = {
              id: 'tch_' + Date.now(),
              school_id: activeSchool.id,
              empId,
              name: data.name,
              fatherHusband: data.fatherHusband || data.fatherName || 'N/A',
              photo: data.photo || '',
              gender: data.gender || 'Male',
              dob: data.dob || '',
              mobile: data.mobile,
              altMobile: data.altMobile || '',
              email: data.email || '',
              aadhaar: data.aadhaar || '',
              pan: data.pan || '',
              qualification: data.qualification || '',
              experience: data.experience || '',
              designation: data.designation || (data.subject ? `${data.subject} Teacher` : 'Senior Teacher'),
              employmentType: data.employmentType || 'Permanent',
              subject: data.subject || 'General',
              assignedSubjects: data.assignedSubjects || (data.subject ? [data.subject] : ['General']),
              classTeacher: data.classTeacher || 'None',
              assignedClass: data.assignedClass || data.classTeacher || 'None',
              assignedSection: data.assignedSection || 'A',
              assignedClasses: data.assignedClasses || (data.classTeacher ? [data.classTeacher] : []),
              joiningDate: data.joiningDate || getLocalDateStr(new Date()),
              salary: Number(data.salary || data.basicSalary || 25000),
              status: loginStatus,
              address: data.address || '',
              bloodGroup: data.bloodGroup || 'O+',
              emergencyContact: data.emergencyContact || '',
              bankDetails: data.bankDetails || { bankName: data.bankName || '', accountNo: data.accountNo || '', ifsc: data.ifsc || '' },
              signature: data.signature || '',
              documents: data.documents || [],
              loginUsername: loginUser,
              lastLogin: null,
              createdAt: new Date().toISOString()
            };

            const newLoginAccount = {
              id: 'tl_' + empId,
              school_id: activeSchool.id,
              teacher_id: empId,
              teacher_emp_id: empId,
              username: loginUser,
              password_hash: hash,
              password_salt: salt,
              login_status: loginStatus,
              status: loginStatus,
              force_password_change: forceChange,
              last_login: null,
              password_reset_token: null,
              token_expiry: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            db.teachers.push(newTeacher);
            db.teacherLogin.push(newLoginAccount);

            // Audit Log
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              empId,
              action: 'REGISTER_TEACHER_WITH_LOGIN',
              description: `Registered teacher ${newTeacher.name} (${empId}) and created login account ${loginUser}`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              empId,
              name: newTeacher.name,
              teacher: safeTeacherRecord(newTeacher),
              loginAccount: {
                empId,
                name: newTeacher.name,
                username: loginUser,
                tempPassword: rawPassword,
                loginStatus,
                forcePasswordChange: forceChange,
                sendChannel: data.sendChannel || 'Email & SMS',
                loginUrl: '/teacher-login'
              }
            }));
          });
        }

        // GET /api/teachers/:id
        if (reqPath.startsWith('/api/teachers/') && method === 'GET' && !reqPath.endsWith('/permissions') && !reqPath.endsWith('/payroll') && !reqPath.endsWith('/login') && !reqPath.endsWith('/id-card') && !reqPath.endsWith('/attendance') && !reqPath.endsWith('/salaries') && !reqPath.endsWith('/leaves') && !reqPath.endsWith('/audit-logs')) {
          return handleAdminRoute(() => {
            const id = reqPath.substring(14);
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));

            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            const loginAcc = (db.teacherLogin || []).find(l => l.teacher_id === teacher.empId || l.teacher_id === teacher.id);
            const permissions = (db.teacherPermissions || {})[teacher.empId] || getDefaultTeacherPermissions();
            const attendance = (db.teacherAttendance || []).filter(a => a.empId === teacher.empId);
            const leaves = normalizeTeacherLeaveRecords(db).filter(l => l.teacher_id === teacher.id);
            const salaries = (db.teacherSalaries || []).filter(s => s.empId === teacher.empId);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ...safeTeacherRecord(teacher),
              loginAccount: safeTeacherLoginRecord(loginAcc) || null,
              permissions,
              attendanceHistory: attendance,
              leaveHistory: leaves,
              salaryHistory: salaries
            }));
          });
        }

        // GET /api/teachers/:id/login
        if (reqPath.startsWith('/api/teachers/') && reqPath.endsWith('/login') && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.split('/')[3];
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }
            const loginAcc = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === teacher.empId || l.teacher_id === id));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              empId: teacher.empId,
              name: teacher.name,
              loginAccount: safeTeacherLoginRecord(loginAcc) || null
            }));
          });
        }

        // PATCH /api/teachers/:id/login
        if (reqPath.startsWith('/api/teachers/') && reqPath.endsWith('/login') && method === 'PATCH') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.split('/')[3];
            const data = req.body || {};
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }
            const empId = teacher.empId;

            let loginAcc = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === empId || l.teacher_id === id));
            if (!loginAcc) {
              const salt = crypto.randomBytes(16).toString('hex');
              const hash = crypto.pbkdf2Sync(data.password || 'Teacher@123', salt, 1000, 64, 'sha512').toString('hex');
              loginAcc = {
                id: 'tl_' + empId,
                school_id: activeSchool.id,
                teacher_id: empId,
                username: (data.username || (teacher ? teacher.loginUsername : empId) || empId).toLowerCase(),
                password_hash: hash,
                password_salt: salt,
                login_status: data.status || 'Active',
                status: data.status || 'Active',
                failed_attempts: 0,
                is_locked: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              if (!db.teacherLogin) db.teacherLogin = [];
              db.teacherLogin.push(loginAcc);
            }

            if (data.status) {
              loginAcc.login_status = data.status;
              loginAcc.status = data.status;
              if (teacher) teacher.status = data.status;
            }
            if (data.username) {
              loginAcc.username = data.username.toLowerCase();
              if (teacher) teacher.loginUsername = data.username.toLowerCase();
            }
            if (data.password) {
              const salt = crypto.randomBytes(16).toString('hex');
              const hash = crypto.pbkdf2Sync(data.password, salt, 1000, 64, 'sha512').toString('hex');
              loginAcc.password_hash = hash;
              loginAcc.password_salt = salt;
              loginAcc.force_password_change = true;
            }

            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, empId, loginAccount: safeTeacherLoginRecord(loginAcc) }));
          });
        }

        // GET /api/teachers/:id/permissions
        if (reqPath.startsWith('/api/teachers/') && reqPath.endsWith('/permissions') && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.split('/')[3];
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }
            const empId = teacher.empId;

            const permissions = (db.teacherPermissions || {})[empId] || getDefaultTeacherPermissions();

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ empId, permissions }));
          });
        }

        // PUT /api/teachers/:id/permissions
        if (reqPath.startsWith('/api/teachers/') && reqPath.endsWith('/permissions') && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.split('/')[3];
            const { permissions, preset } = req.body || {};
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }
            const empId = teacher.empId;

            if (!db.teacherPermissions) db.teacherPermissions = {};

            let newPerms = {};
            if (preset && PERMISSION_PRESETS[preset]) {
              newPerms = { ...PERMISSION_PRESETS[preset] };
            } else if (permissions) {
              newPerms = { ...getDefaultTeacherPermissions(), ...permissions };
            } else {
              newPerms = getDefaultTeacherPermissions();
            }

            db.teacherPermissions[empId] = newPerms;
            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, empId, permissions: newPerms }));
          });
        }

        // GET /api/teachers/:id/payroll
        if (reqPath.startsWith('/api/teachers/') && reqPath.endsWith('/payroll') && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.split('/')[3];
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            const basicSalary = Number(teacher.salary || 25000);
            const hra = Math.round(basicSalary * 0.10);
            const da = Math.round(basicSalary * 0.05);
            const ta = 1500;
            const grossSalary = basicSalary + hra + da + ta;

            const pf = Math.round(basicSalary * 0.12);
            const profTax = 200;
            const totalDeductions = pf + profTax;
            const netSalary = grossSalary - totalDeductions;

            const paymentHistory = (db.teacherSalaries || []).filter(s => matchTenant(s, activeSchool.id) && s.empId === teacher.empId);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              empId: teacher.empId,
              name: teacher.name,
              designation: teacher.designation,
              bankDetails: teacher.bankDetails || {},
              payroll: {
                basicSalary,
                hra,
                da,
                ta,
                grossSalary,
                pf,
                profTax,
                totalDeductions,
                netSalary
              },
              paymentHistory
            }));
          });
        }

        // GET /api/teachers/:id/id-card
        if (reqPath.startsWith('/api/teachers/') && reqPath.endsWith('/id-card') && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.split('/')[3];
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              empId: teacher.empId,
              name: teacher.name,
              designation: teacher.designation || 'Teacher',
              subject: teacher.subject || 'General',
              classTeacher: teacher.classTeacher || 'None',
              mobile: teacher.mobile,
              bloodGroup: teacher.bloodGroup || 'O+',
              photo: teacher.photo || ''
            }));
          });
        }

        // PUT /api/teachers/:id
        if (reqPath.startsWith('/api/teachers/') && method === 'PUT' && !reqPath.endsWith('/permissions') && !reqPath.endsWith('/login')) {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.substring(14);
            const data = req.body || {};
            if (!db.teachers) db.teachers = [];

            const idx = db.teachers.findIndex(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (idx === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            const { loginPassword: ignoredLoginPassword, ...safeTeacherUpdates } = data;
            db.teachers[idx] = {
              ...db.teachers[idx],
              ...safeTeacherUpdates,
              school_id: activeSchool.id
            };

            const updatedStatus = (db.teachers[idx].status || 'Active').toLowerCase();
            if (updatedStatus === 'deleted' || updatedStatus === 'inactive' || updatedStatus === 'archived' || updatedStatus === 'resigned') {
              const teacherEmpId = db.teachers[idx].empId;
              db.teachers[idx].classTeacher = 'None';
              db.teachers[idx].assignedClass = 'None';

              // Disable portal login
              const loginAcc = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === id || l.teacher_id === teacherEmpId || (l.username && l.username.toLowerCase() === (db.teachers[idx].loginUsername || '').toLowerCase())));
              if (loginAcc) {
                loginAcc.login_status = 'Disabled';
                loginAcc.status = 'Disabled';
                loginAcc.updated_at = new Date().toISOString();
              }

              // Remove active assignments
              if (db.teacherAssignments) {
                db.teacherAssignments = db.teacherAssignments.filter(a => !(matchTenant(a, activeSchool.id) && (a.teacher_id === id || a.teacher_id === teacherEmpId)));
              }
            }

            // Audit Log
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              empId: db.teachers[idx].empId,
              action: 'UPDATE_TEACHER',
              description: `Updated profile details for ${db.teachers[idx].name}`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(safeTeacherRecord(db.teachers[idx])));
          });
        }

        // DELETE /api/teachers/:id (Soft Delete Teacher)
        if (reqPath.startsWith('/api/teachers/') && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.substring(14);
            if (!db.teachers) db.teachers = [];
            
            const target = db.teachers.find(t => matchTenant(t, activeSchool.id) && (t.id === id || t.empId === id));
            if (!target) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            // Soft delete
            target.status = 'Deleted';
            target.deletedAt = new Date().toISOString();
            target.classTeacher = 'None';
            target.assignedClass = 'None';

            const loginAcc = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === id || l.teacher_id === target.empId || (l.username && l.username.toLowerCase() === (target.loginUsername || '').toLowerCase())));
            if (loginAcc) {
              loginAcc.login_status = 'Disabled';
              loginAcc.status = 'Disabled';
              loginAcc.updated_at = new Date().toISOString();
            }

            // Remove active assignments so teacher doesn't linger in active lists/workload
            if (db.teacherAssignments) {
              db.teacherAssignments = db.teacherAssignments.filter(a => !(matchTenant(a, activeSchool.id) && (a.teacher_id === id || a.teacher_id === target.empId)));
            }

            // Audit Log
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              empId: target.empId,
              action: 'SOFT_DELETE_TEACHER',
              description: `Soft deleted teacher record and disabled login for ${target.name} (${target.empId})`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: `Teacher ${target.name} (${target.empId}) deactivated & deleted successfully.` }));
          });
        }

        // POST /api/admin/teachers/create-login
        if (reqPath === '/api/admin/teachers/create-login' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const { empId, username, password, status } = req.body || {};
            if (!empId || !password) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'empId and password are required.' }));
            }

            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === empId || t.id === empId));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher record not found.' }));
            }

            if (!db.teacherLogin) db.teacherLogin = [];
            let loginAcc = db.teacherLogin.find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === empId || l.teacher_id === teacher.id));

            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

            const loginUser = (username || teacher.loginUsername || empId).toLowerCase();

            if (loginAcc) {
              loginAcc.username = loginUser;
              loginAcc.password_hash = hash;
              loginAcc.password_salt = salt;
              loginAcc.status = status || teacher.status || 'Active';
              loginAcc.updated_at = new Date().toISOString();
            } else {
              loginAcc = {
                id: 'tl_' + empId,
                school_id: activeSchool.id,
                teacher_id: empId,
                username: loginUser,
                password_hash: hash,
                password_salt: salt,
                status: status || teacher.status || 'Active',
                last_login: null,
                password_reset_token: null,
                token_expiry: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              db.teacherLogin.push(loginAcc);
            }

            teacher.loginUsername = loginUser;
            if (status) teacher.status = status;
            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, teacher_id: empId, username: loginUser, status: loginAcc.status }));
          });
        }

        // PATCH & PUT /api/admin/teachers/login-status
        if ((reqPath === '/api/admin/teachers/login-status' || reqPath.startsWith('/api/admin/teachers/login-status')) && (method === 'PATCH' || method === 'PUT')) {
          return handleAdminRoute((db, activeSchool) => {
            const { empId, status } = req.body || {};
            if (!empId || !status) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'empId and status are required.' }));
            }

            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === empId || t.id === empId));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }
            const loginAcc = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === empId || l.teacher_id === teacher.id));

            if (teacher) teacher.status = status;
            if (loginAcc) {
              loginAcc.status = status;
              loginAcc.updated_at = new Date().toISOString();
            }

            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, empId, status }));
          });
        }

        // GET /api/admin/teachers/permissions
        if (reqPath === '/api/admin/teachers/permissions' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const empId = parsedUrl.query ? parsedUrl.query.empId : null;
            if (!empId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'empId is required.' }));
            }

            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === empId || t.id === empId));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            if (!db.teacherPermissions) db.teacherPermissions = {};
            const permissions = db.teacherPermissions[empId] || getDefaultTeacherPermissions();

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ empId, permissions }));
          });
        }

        // POST /api/admin/teachers/permissions
        if (reqPath === '/api/admin/teachers/permissions' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const { empId, permissions, preset } = req.body || {};
            if (!empId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'empId is required.' }));
            }

            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === empId || t.id === empId));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            if (!db.teacherPermissions) db.teacherPermissions = {};

            let newPerms = {};
            if (preset && PERMISSION_PRESETS[preset]) {
              newPerms = { ...PERMISSION_PRESETS[preset] };
            } else if (permissions) {
              newPerms = { ...getDefaultTeacherPermissions(), ...permissions };
            } else {
              newPerms = getDefaultTeacherPermissions();
            }

            db.teacherPermissions[empId] = newPerms;

            // Audit Log
            if (!db.teacherActivityLogs) db.teacherActivityLogs = [];
            db.teacherActivityLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              teacher_id: empId,
              empId,
              action: 'UPDATE_PERMISSIONS',
              description: `Admin updated permissions for teacher ${empId}${preset ? ' (Preset: ' + preset + ')' : ''}`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, empId, permissions: newPerms }));
          });
        }

        // POST /api/admin/teachers/login-control
        if (reqPath === '/api/admin/teachers/login-control' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const { empId, action, status, password, forcePasswordChange } = req.body || {};
            if (!empId || !action) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'empId and action are required.' }));
            }

            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === empId || t.id === empId));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            const loginAcc = (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === empId || l.teacher_id === teacher.id));

            if (!db.teacherActivityLogs) db.teacherActivityLogs = [];
            if (!db.teacherLoginSessions) db.teacherLoginSessions = [];

            const nowStr = new Date().toISOString();
            let msg = '';

            if (action === 'update_status') {
              const newStatus = status || 'Active';
              teacher.status = newStatus;
              if (loginAcc) {
                loginAcc.login_status = newStatus;
                loginAcc.status = newStatus;
                if (newStatus === 'Active') {
                  loginAcc.is_locked = false;
                  loginAcc.failed_attempts = 0;
                }
              }
              msg = `Account status updated to ${newStatus}`;
            } else if (action === 'unlock') {
              if (loginAcc) {
                loginAcc.is_locked = false;
                loginAcc.failed_attempts = 0;
                loginAcc.login_status = 'Active';
                loginAcc.status = 'Active';
              }
              teacher.status = 'Active';
              msg = `Account unlocked successfully. Failed attempts counter reset to 0.`;
            } else if (action === 'force_password_change') {
              if (loginAcc) {
                loginAcc.force_password_change = forcePasswordChange !== false;
              }
              msg = `Force password change set to ${forcePasswordChange !== false}`;
            } else if (action === 'logout_all_devices') {
              db.teacherLoginSessions = db.teacherLoginSessions.filter(s => s.empId !== empId);
              msg = `Logged out teacher ${teacher.name} (${empId}) from all devices. Active sessions revoked.`;
            } else if (action === 'reset_password') {
              const newPass = password || `GjvTch#${Math.floor(1000 + Math.random() * 9000)}`;
              const salt = crypto.randomBytes(16).toString('hex');
              const hash = crypto.pbkdf2Sync(newPass, salt, 1000, 64, 'sha512').toString('hex');

              if (loginAcc) {
                loginAcc.password_hash = hash;
                loginAcc.password_salt = salt;
                loginAcc.force_password_change = true;
                loginAcc.is_locked = false;
                loginAcc.failed_attempts = 0;
              }
              msg = `Password reset successfully. New temporary password: ${newPass}`;
            } else if (action === 'remove_login_access') {
              db.teacherLogin = (db.teacherLogin || []).filter(l => !(matchTenant(l, activeSchool.id) && l.teacher_id === empId));
              db.teacherPermissions[empId] = undefined;
              msg = `Login access removed for teacher ${teacher.name} (${empId}).`;
            }

            // Log Audit
            db.teacherActivityLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              teacher_id: empId,
              empId,
              action: 'ADMIN_LOGIN_CONTROL',
              description: `Admin executed action "${action}" for teacher ${teacher.name} (${empId}): ${msg}`,
              timestamp: nowStr
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, empId, action, message: msg }));
          });
        }

        // GET /api/admin/teachers/activity-logs
        if (reqPath === '/api/admin/teachers/activity-logs' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const empId = parsedUrl.query ? parsedUrl.query.empId : null;
            let logs = (db.teacherActivityLogs || []).filter(l => matchTenant(l, activeSchool.id));

            if (empId) {
              logs = logs.filter(l => l.empId === empId || l.teacher_id === empId);
            }

            // Sort descending by timestamp
            logs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(logs));
          });
        }

        // GET /api/teachers/attendance
        if (reqPath === '/api/teachers/attendance' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const date = parsedUrl.query ? parsedUrl.query.date : null;
            const month = parsedUrl.query ? parsedUrl.query.month : null;
            let list = (db.teacherAttendance || []).filter(r => matchTenant(r, activeSchool.id));

            if (date) list = list.filter(r => r.date === date);
            if (month) list = list.filter(r => (r.date || '').slice(0, 7) === month);
            if (req.user && req.user.role === 'Teacher') {
              list = list.map(day => ({
                ...day,
                records: (day.records || []).filter(r => r.empId === req.user.empId)
              }));
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/teachers/attendance
        if (reqPath === '/api/teachers/attendance' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const { date, records } = req.body;
            if (!date || !records) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'date and records are required.' }));
            }

            db.teacherAttendance = (db.teacherAttendance || []).filter(r => !(matchTenant(r, activeSchool.id) && r.date === date));
            const newRecord = { date, records, school_id: activeSchool.id, updatedAt: new Date().toISOString() };
            db.teacherAttendance.push(newRecord);

            // Audit Log
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              empId: 'ALL',
              action: 'MARK_ATTENDANCE',
              description: `Marked daily teacher attendance for ${date}`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newRecord));
          });
        }

        // GET /api/teachers/leaves
        if (reqPath === '/api/teachers/leaves' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            let list = normalizeTeacherLeaveRecords(db).filter(l => matchTenant(l, activeSchool.id));
            const status = parsedUrl.query ? parsedUrl.query.status : null;
            if (req.user && req.user.role === 'Teacher') {
              const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && t.empId === req.user.empId);
              if (!teacher) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Authenticated teacher record not found.' }));
              }
              list = list.filter(l => l.teacher_id === teacher.id);
            } else {
              const teacherId = parsedUrl.query ? parsedUrl.query.teacher_id : null;
              if (teacherId) list = list.filter(l => l.teacher_id === teacherId);
            }
            if (status) list = list.filter(l => l.status === status);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/teachers/leaves
        if (reqPath === '/api/teachers/leaves' && method === 'POST') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const data = { ...(req.body || {}) };
            const teacher = req.user && req.user.role === 'Teacher'
              ? (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && t.empId === req.user.empId)
              : (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && String(t.id) === String(data.teacher_id || ''));
            if (!teacher) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A valid teacher_id is required for this leave request.' }));
            }
            const leaveType = data.leave_type || data.leaveType;
            const fromDate = data.from_date || data.fromDate;
            const toDate = data.to_date || data.toDate;
            const from = new Date(fromDate);
            const to = new Date(toDate);
            if (!leaveType || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Valid leave_type, from_date and to_date are required.' }));
            }
            normalizeTeacherLeaveRecords(db);
            const now = new Date().toISOString();
            const requestId = 'leave_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
            const leave = {
              id: requestId,
              school_id: activeSchool.id,
              leave_request_id: requestId, teacher_id: teacher.id, employee_code: teacher.empId || '',
              teacher_name: teacher.name || 'Teacher', leave_type: leaveType,
              from_date: getLocalDateStr(from), to_date: getLocalDateStr(to),
              number_of_days: Math.floor((to - from) / 86400000) + 1,
              reason: String(data.reason || '').trim(), document_url: data.document_url || '',
              status: 'Pending', submitted_at: now, approved_by: null, approved_at: null,
              rejected_by: null, rejected_at: null, admin_remarks: '', rejection_reason: '', updated_at: now
            };
            db.teacherLeaves.push(leave);
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({ id: 'log_' + Date.now(), school_id: activeSchool.id, teacher_id: teacher.id, employee_code: teacher.empId || '', action: 'SUBMIT_LEAVE', description: 'Submitted ' + leaveType + ' leave request from ' + leave.from_date + ' to ' + leave.to_date, timestamp: now });
            writeDbRaw(db);
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, leave }));
          });
        }

        // PATCH /api/teacher-leaves/:leaveRequestId/approve|reject
        const leaveDecisionMatch = reqPath.match(/^\/api\/teacher-leaves\/([^/]+)\/(approve|reject)$/);
        if (leaveDecisionMatch && method === 'PATCH') {
          return handleAdminRoute((db, activeSchool) => {
            const requestId = decodeURIComponent(leaveDecisionMatch[1]);
            const action = leaveDecisionMatch[2];
            const leave = normalizeTeacherLeaveRecords(db).find(l => l.leave_request_id === requestId && matchTenant(l, activeSchool.id));
            if (!leave) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Leave request ' + requestId + ' was not found.' }));
            }
            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && String(t.id) === String(leave.teacher_id));
            if (!teacher) {
              console.error('[TEACHER LEAVE LINK ERROR]', { leave_request_id: requestId, teacher_id: leave.teacher_id });
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Leave request ' + requestId + ' references missing teacher ID ' + (leave.teacher_id || '(empty)') + '.' }));
            }
            if (action === 'approve' && ['Deleted', 'Inactive'].includes(teacher.status)) {
              console.error('[TEACHER LEAVE INACTIVE]', { leave_request_id: requestId, teacher_id: teacher.id, status: teacher.status });
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher ' + teacher.id + ' is ' + teacher.status + '; this leave cannot be approved.' }));
            }
            const status = action === 'approve' ? 'Approved' : 'Rejected';
            const previousStatus = leave.status;
            const now = new Date().toISOString();
            const actor = req.user.email || req.user.username || req.user.id || 'admin';
            const remarks = String((req.body && (req.body.admin_remarks || req.body.reason)) || '').trim();
            if (previousStatus !== status) {
              if (previousStatus === 'Approved') updateTeacherLeaveBalance(teacher, leave, -1);
              if (status === 'Approved') updateTeacherLeaveBalance(teacher, leave, 1);
            }
            leave.status = status; leave.admin_remarks = remarks; leave.updated_at = now;
            if (status === 'Approved') {
              leave.approved_by = actor; leave.approved_at = now;
              leave.rejected_by = null; leave.rejected_at = null; leave.rejection_reason = '';
            } else {
              leave.rejected_by = actor; leave.rejected_at = now; leave.rejection_reason = remarks;
              leave.approved_by = null; leave.approved_at = null;
            }
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({ id: 'log_' + Date.now(), school_id: activeSchool.id, teacher_id: teacher.id, employee_code: teacher.empId || '', leave_request_id: requestId, action: status === 'Approved' ? 'APPROVE_LEAVE' : 'REJECT_LEAVE', description: status + ' leave request ' + requestId + ' for ' + teacher.name, performed_by: actor, timestamp: now });
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Leave request ' + status.toLowerCase() + ' successfully.', leave }));
          });
        }
        // GET /api/teachers/salaries
        if (reqPath === '/api/teachers/salaries' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const empId = req.user && req.user.role === 'Teacher'
              ? req.user.empId
              : (parsedUrl.query ? parsedUrl.query.empId : null);
            const month = parsedUrl.query ? parsedUrl.query.month : null;
            let list = (db.teacherSalaries || []).filter(s => matchTenant(s, activeSchool.id));

            if (empId) list = list.filter(s => s.empId === empId);
            if (month) list = list.filter(s => s.month === month);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/teachers/salaries
        if (reqPath === '/api/teachers/salaries' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const salary = req.body;
            if (!salary.empId || !salary.month || !salary.netSalary) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'empId, month, and netSalary are required.' }));
            }

            const teacher = (db.teachers || []).find(t => matchTenant(t, activeSchool.id) && (t.empId === salary.empId || t.id === salary.empId));
            if (!teacher) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Teacher not found.' }));
            }

            const teacherStatus = (teacher.status || 'Active').toLowerCase();
            if (teacherStatus === 'deleted' || teacherStatus === 'inactive' || teacherStatus === 'archived') {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Cannot disburse payroll for deactivated/deleted teacher ${teacher.name} (${salary.empId}).` }));
            }

            if (!db.teacherSalaries) db.teacherSalaries = [];
            const yearStr = new Date().getFullYear();
            const seqStr = String(db.teacherSalaries.length + 1).padStart(4, '0');
            const slipNo = salary.slipNo || `SLIP-${yearStr}-${seqStr}`;

            const baseSalary = Number(salary.baseSalary || salary.basicSalary || teacher.salary || 25000);
            const allowances = Number(salary.allowances || 0);
            const bonus = Number(salary.bonus || 0);
            const incentive = Number(salary.incentive || 0);
            const overtime = Number(salary.overtime || 0);
            const deductions = Number(salary.deductions || salary.deduction || 0);
            const advance = Number(salary.advance || 0);
            const loanDeduction = Number(salary.loanDeduction || 0);
            const leaveDeduction = Number(salary.leaveDeduction || 0);

            const calculatedNet = baseSalary + allowances + bonus + incentive + overtime - deductions - advance - loanDeduction - leaveDeduction;
            const finalNetSalary = Number(salary.netSalary || calculatedNet);

            const newSalary = {
              id: 'sal_' + Date.now(),
              school_id: activeSchool.id,
              slipNo,
              empId: teacher.empId,
              teacherName: teacher.name,
              designation: teacher.designation || (teacher.subject + ' Teacher'),
              month: salary.month,
              academic_session: normalizeAcademicSession(salary.academic_session || salary.session, db),
              baseSalary,
              allowances,
              bonus,
              incentive,
              overtime,
              deductions,
              advance,
              loanDeduction,
              leaveDeduction,
              netSalary: finalNetSalary,
              paidStatus: salary.paidStatus || 'Paid',
              paymentMode: salary.paymentMode || 'Bank Transfer',
              referenceNo: salary.referenceNo || 'N/A',
              remarks: salary.remarks || salary.notes || 'Monthly Salary Disbursed',
              paidDate: salary.paymentDate || getLocalDateStr(new Date())
            };

            db.teacherSalaries.push(newSalary);

            // Audit Log
            if (!db.teacherAuditLogs) db.teacherAuditLogs = [];
            db.teacherAuditLogs.push({
              id: 'log_' + Date.now(),
              school_id: activeSchool.id,
              empId: teacher.empId,
              action: 'DISBURSE_SALARY',
              description: `Generated & Paid salary for ${teacher.name} (${salary.month}): ₹${finalNetSalary}`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newSalary));
          });
        }

        // GET /api/teachers/audit-logs
        if (reqPath === '/api/teachers/audit-logs' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const list = (db.teacherAuditLogs || []).filter(l => matchTenant(l, activeSchool.id));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/teachers/login (Teacher Portal Login)
        if (reqPath === '/api/teachers/login' && method === 'POST') {
          if (!activeSchool) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'School tenant context required. Please access via your assigned school subdomain.' }));
          }
          if (activeSchool.status === 'Suspended') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'This school account is currently suspended.' }));
          }
          const { email, username, password } = req.body || {};
          const target = String(email || username || '').trim().toLowerCase();
          const teacher = (db.teachers || []).find(t =>
            matchTenant(t, activeSchool.id) &&
            [t.email, t.empId, t.loginUsername].filter(Boolean)
              .some(value => String(value).toLowerCase() === target)
          );
          const loginAcc = teacher
            ? (db.teacherLogin || []).find(l => matchTenant(l, activeSchool.id) && (l.teacher_id === teacher.empId || l.teacher_emp_id === teacher.empId))
            : null;
          let passwordValid = false;
          if (teacher && loginAcc && password && loginAcc.password_hash && loginAcc.password_salt) {
            const testHash = crypto.pbkdf2Sync(password, loginAcc.password_salt, 1000, 64, 'sha512').toString('hex');
            passwordValid = testHash === loginAcc.password_hash;
          } else if (teacher && teacher.loginPassword && password) {
            passwordValid = password === teacher.loginPassword;
          }

          if (teacher && passwordValid && (teacher.status || 'Active') === 'Active') {
            const token = signJWT({ empId: teacher.empId, role: 'Teacher', name: teacher.name, username: target, school_id: activeSchool.id, school_code: activeSchool.code });
            const permissions = (db.teacherPermissions || {})[teacher.empId] || getDefaultTeacherPermissions();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ token, teacher: safeTeacherRecord(teacher), permissions, school: { id: activeSchool.id, name: activeSchool.name, code: activeSchool.code } }));
          }
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'Invalid Teacher Credentials.' }));
        }

        // GET /api/attendance (Allows both Admin & Teacher authentication)
        if (reqPath === '/api/attendance' && method === 'GET') {
          return handleAnyAuthRoute(() => {
            const date = normalizeAttendanceDate(parsedUrl.query.date);
            const className = parsedUrl.query.className;
            const section = parsedUrl.query.section;
            const academicSessionId = String(parsedUrl.query.academic_session_id || '').trim();
            const requestedSessionName = String(parsedUrl.query.academic_session || parsedUrl.query.academicSession || '').trim();
            const sessionRecord = academicSessionId ? (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === academicSessionId) : (requestedSessionName ? (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && normalizeAcademicSession(row.session_name,db) === normalizeAcademicSession(requestedSessionName,db)) : null);
            if ((academicSessionId || parsedUrl.query.academic_session || parsedUrl.query.academicSession) && !sessionRecord) { res.writeHead(400, { 'Content-Type':'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error:'Academic Session is invalid.' })); }
            const academicSession = sessionRecord?.session_name || '';

            let rows = ensureCentralStudentAttendance(db).filter(row => matchTenant(row, activeSchool.id));
            if (req.user?.role === 'Teacher') {
              const contexts = teacherClassContexts(db, req.user.empId);
              if (className) {
                const requestedClass = normalizeClassName(className);
                const requestedSection = normalizeSectionName(section);
                const requestedSession = String(academicSession || currentAcademicSession(db));
                const assigned = contexts.some(context =>
                  context.class_name === requestedClass &&
                  context.section === requestedSection &&
                  context.academic_session === requestedSession
                );
                if (!assigned) {
                  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                  return res.end(JSON.stringify({ error: 'You cannot view attendance for an unassigned class or section.' }));
                }
              } else {
                rows = rows.filter(row => contexts.some(context =>
                  context.class_name === normalizeClassName(row.class_id) &&
                  (context.section === 'All Sections' || context.section === normalizeSectionName(row.section_id)) &&
                  context.academic_session === String(row.academic_session)
                ));
              }
            }
            if (date) rows = rows.filter(row => row.attendance_date === date);
            if (className) {
              const normalizedClass = normalizeClassName(className);
              rows = rows.filter(row => normalizeClassName(row.class_id) === normalizedClass);
            }
            if (section && !/^all(?:\s+sections?)?$/i.test(String(section).trim())) {
              const normalizedSection = normalizeSectionName(section);
              rows = rows.filter(row => normalizeSectionName(row.section_id) === normalizedSection);
            }
            if (sessionRecord) rows = rows.filter(row => String(row.academic_session_id || '') === String(sessionRecord.id) || (!row.academic_session_id && String(row.academic_session) === String(sessionRecord.session_name)));

            const records = groupedAttendanceFromCentral(db, rows);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(records));
          });
        }

        // POST /api/attendance (Mark Attendance - Allows both Admin & Teacher)
        if (reqPath === '/api/attendance' && method === 'POST') {
          return handleAnyAuthRoute(() => {
            const { date, className, section, records } = req.body || {};
            if (!date || !className || !section || !records) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'date, className, section and records are required.' }));
            }
            if (!Array.isArray(records) || !records.length) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'At least one student attendance record is required.' }));
            }

            const attendanceDate = normalizeAttendanceDate(date);
            const normalizedClass = normalizeClassName(className);
            const normalizedSection = normalizeSectionName(section);
            const academicSessionId = String(req.body?.academic_session_id || req.body?.academicSessionId || '').trim();
            let requestedSessionName = String(req.body?.academic_session || req.body?.academicSession || '').trim();
            if (!requestedSessionName && !academicSessionId && Array.isArray(records) && records.length) {
              const firstStudentId = records[0].student_id || records[0].studentId || records[0].admissionNo;
              const firstStudent = (db.students || []).find(item => matchTenant(item, activeSchool.id) && (item.admissionNo || item.studentId || item.id) === firstStudentId);
              if (firstStudent) requestedSessionName = studentAcademicSession(firstStudent, db);
            }
            const sessionRecord = academicSessionId
              ? (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === academicSessionId)
              : (requestedSessionName
                  ? (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && normalizeAcademicSession(row.session_name, db) === normalizeAcademicSession(requestedSessionName, db))
                  : ((db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && row.is_active) || (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id))));
            if (!sessionRecord) { res.writeHead(400, { 'Content-Type':'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error:'A valid Academic Session is required.' })); }
            const academicSession = sessionRecord.session_name;
            if (!attendanceDate || !normalizedClass || !normalizedSection) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A valid attendance date, class, and section are required.' }));
            }

            if (req.user?.role === 'Teacher') {
              const context = teacherClassContexts(db, req.user.empId).find(item =>
                item.class_name === normalizedClass &&
                (item.section === 'All Sections' || item.section === normalizedSection) &&
                normalizeAcademicSession(item.academic_session, db) === normalizeAcademicSession(academicSession, db)
              );
              if (!context) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'You cannot mark attendance for an unassigned class or section.' }));
              }

              const allowedStudentIds = new Set(
                (db.students || [])
                  .filter(student => matchTenant(student, activeSchool.id) && studentMatchesContext(student, context, db))
                  .map(student => student.admissionNo || student.studentId || student.id)
              );
              const hasUnassignedStudent = records.some(record =>
                !allowedStudentIds.has(record.student_id || record.studentId || record.admissionNo)
              );
              if (hasUnassignedStudent) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Attendance contains a student outside the selected teacher assignment.' }));
              }
            }

            const allowedStatuses = new Map([
              ['present', 'Present'],
              ['absent', 'Absent'],
              ['late', 'Late'],
              ['leave', 'Leave'],
              ['half day', 'Half Day'],
              ['halfday', 'Half Day'],
              ['holiday', 'Holiday']
            ]);
            const invalidStudent = records.find(record => {
              const studentId = record.student_id || record.studentId || record.admissionNo;
              const student = (db.students || []).find(item => matchTenant(item, activeSchool.id) && (item.admissionNo || item.studentId || item.id) === studentId);
              if (!student) { console.log('DEBUG ATTENDANCE: STUDENT NOT FOUND', studentId); return true; }
              const studentSession = studentAcademicSession(student, db);
              const stClass = normalizeClassName(student.className || student.class_name);
              const stSec = normalizeSectionName(student.section || student.section_name);
              if (studentSession !== academicSession) return true;
              if (stClass !== normalizedClass) return true;
              if (normalizedSection !== 'All Sections' && stSec !== normalizedSection) return true;
              return false;
            });
            if (invalidStudent) { res.writeHead(400, { 'Content-Type':'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error:'Attendance contains a student outside the selected Academic Session, class, or section.' })); }
            const invalidStatus = records.find(record =>
              !allowedStatuses.has(String(record.status || '').replace(/\s+/g, ' ').trim().toLowerCase())
            );
            if (invalidStatus) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Invalid attendance status "${invalidStatus.status}".` }));
            }

            const now = new Date().toISOString();
            const teacherId = req.user?.role === 'Teacher' ? req.user.empId : null;
            const markedBy = req.user
              ? (req.user.name || req.user.username || req.user.empId)
              : 'Admin';
            const centralRows = ensureCentralStudentAttendance(db);
            const savedRows = [];

            records.forEach(record => {
              const studentId = record.student_id || record.studentId || record.admissionNo;
              const student = (db.students || []).find(item =>
                matchTenant(item, activeSchool.id) && (item.admissionNo || item.studentId || item.id) === studentId
              );
              const actualClass = normalizeClassName(student?.className || student?.class_name || normalizedClass);
              const actualSection = normalizeSectionName(student?.section || student?.section_name || normalizedSection);
              const existingIndex = centralRows.findIndex(row =>
                matchTenant(row, activeSchool.id) &&
                row.student_id === studentId &&
                normalizeAttendanceDate(row.attendance_date) === attendanceDate &&
                (String(row.academic_session_id || '') === String(sessionRecord.id) || normalizeAcademicSession(row.academic_session, db) === normalizeAcademicSession(academicSession, db))
              );
              const existing = existingIndex === -1 ? null : centralRows[existingIndex];
              const attendanceRow = {
                id: existing?.id || `ATT-${studentId}-${attendanceDate}-${academicSession}`,
                school_id: activeSchool.id,
                student_id: studentId,
                teacher_id: teacherId,
                class_id: actualClass,
                section_id: actualSection,
                attendance_date: attendanceDate,
                status: allowedStatuses.get(String(record.status || '').replace(/\s+/g, ' ').trim().toLowerCase()),
                remarks: record.remarks || record.remark || '',
                academic_session: academicSession,
                academic_session_id: sessionRecord.id,
                marked_by: markedBy,
                created_at: existing?.created_at || now,
                updated_at: now
              };
              if (existingIndex === -1) centralRows.push(attendanceRow);
              else centralRows[existingIndex] = attendanceRow;
              savedRows.push(attendanceRow);
            });

            rebuildLegacyAttendance(db);
            writeDbRaw(db);
            savedRows.filter(row=>row.status==='Absent').forEach(row=>{const student=(db.students||[]).find(item=>(item.admissionNo||item.id)===row.student_id);if(student)queueWhatsAppAutomation('absent',student,[student.name,row.attendance_date,row.class_id+'-'+row.section_id],'absent:'+row.student_id+':'+row.attendance_date)});

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              upserted: savedRows.length,
              attendance: groupedAttendanceFromCentral(db, savedRows)
            }));
          });
        }

        // GET /api/fee-structures
        if (reqPath === '/api/fee-structures' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const session = normalizeAcademicSession(parsedUrl.query.session || parsedUrl.query.academic_session, db, activeSchool?.id);
            const structures = feeStructuresForSession(db, session, activeSchool?.id);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(structures));
          });
        }

        // POST /api/fee-structures (Save Fee Structures by Class)
        if (reqPath === '/api/fee-structures' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const data = req.body || {};
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A class-wise fee structure object is required.' }));
            }
            const validated = {};
            for (const [className, values] of Object.entries(data)) {
              const normalizedClass = normalizeClassName(className);
              if (!normalizedClass || !values || typeof values !== 'object' || Array.isArray(values)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `Invalid fee structure for class ${className}.` }));
              }
              validated[normalizedClass] = {};
              for (const field of Object.values(FEE_CATEGORY_FIELDS)) {
                const amount = Number(values[field] ?? 0);
                if (!Number.isFinite(amount) || amount < 0) {
                  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                  return res.end(JSON.stringify({ error: `${field} for ${normalizedClass} must be a non-negative number.` }));
                }
                validated[normalizedClass][field] = amount;
              }
            }
            const session = normalizeAcademicSession(parsedUrl.query.session || parsedUrl.query.academic_session, db, activeSchool?.id);
            delete validated.session; delete validated.academic_session;
            if (activeSchool?.id && activeSchool.id !== DEFAULT_SCHOOL_ID) {
              const school = (db.schools || []).find(s => s.id === activeSchool.id);
              if (school) {
                school.feeStructuresBySession = school.feeStructuresBySession || {};
                school.feeStructuresBySession[session] = { ...(school.feeStructuresBySession[session] || {}), ...validated };
              }
            } else {
              db.feeStructuresBySession = db.feeStructuresBySession || {};
              db.feeStructuresBySession[session] = { ...(db.feeStructuresBySession[session] || {}), ...validated };
            }
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(feeStructuresForSession(db, session, activeSchool?.id)));
          });
        }

        // Fee Collection student search is always scoped server-side to one academic session.
        if ((reqPath === '/api/fee/students/search' || reqPath === '/api/fees/students/search') && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const sessionId = String(parsedUrl.query.academic_session_id || '').trim();
            if (!sessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            const sessionRecord = (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === sessionId);
            if (!sessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Selected Academic Session is invalid.' })); }
            const query = String(parsedUrl.query.q || parsedUrl.query.search || '').trim().toLowerCase();
            const targetClassRaw = String(parsedUrl.query.className || parsedUrl.query.class || '').trim();
            const targetSectionRaw = String(parsedUrl.query.section || '').trim();
            const targetClass = targetClassRaw ? normalizeClassName(targetClassRaw) : '';
            const targetSection = targetSectionRaw ? normalizeSectionName(targetSectionRaw) : '';
            let students = (db.students || []).filter(student => matchTenant(student, activeSchool.id) && isStudentActive(student) && String(student.academic_session_id || '') === sessionId);
            if (targetClass) students = students.filter(student => normalizeClassName(student.className || student.class_name) === targetClass);
            if (targetSection) students = students.filter(student => normalizeSectionName(student.section || student.section_name) === targetSection);
            if (query) students = students.filter(student => [student.name, student.studentName, student.admissionNo, student.admission_number, student.studentId, student.student_id, student.id, student.mobile, student.mobileNumber].some(value => String(value || '').toLowerCase().includes(query)));
            const result = students.map(student => ({ ...student, academic_session_id: sessionId, academic_session: sessionRecord.session_name, session: sessionRecord.session_name }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(result));
          });
        }

        // GET /api/fees/dashboard-stats
        if (reqPath === '/api/fees/dashboard-stats' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const schoolSessions = (db.academicSessions || []).filter(row => matchTenant(row, activeSchool.id));
            const activeSession = schoolSessions.find(row => row.is_active) || schoolSessions[0] || (db.academicSessions || []).find(row => row.is_active) || (db.academicSessions || [])[0];
            const dashboardSessionId = String(parsedUrl.query.academic_session_id || (parsedUrl.query.academicSession ? (schoolSessions.find(s => s.session_name === parsedUrl.query.academicSession) || (db.academicSessions || []).find(s => s.session_name === parsedUrl.query.academicSession))?.id : '') || activeSession?.id || '').trim();
            const dashboardSessionRecord = (db.academicSessions || []).find(row => String(row.id) === dashboardSessionId);
            if (!dashboardSessionId || !dashboardSessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            const dashboardSession = dashboardSessionRecord.session_name;
            const feesList = (db.fees || []).filter(fee => matchTenant(fee, activeSchool.id) && fee.status !== 'Refunded' && !fee.deleted_at && normalizeAcademicSession(fee.academic_session || fee.session, db) === dashboardSession);
            const activeStudents = (db.students || []).filter(s => matchTenant(s, activeSchool.id) && s.status !== 'Inactive' && studentAcademicSession(s, db) === dashboardSession);

            const now = new Date();
            const todayStr = getLocalDateStr(now);
            const currentMonthStr = getLocalMonthStr(now);

            let totalCollected = 0;
            let todayCollection = 0;
            let monthlyCollection = 0;
            const modeBreakdown = { Cash: 0, UPI: 0, Card: 0, Bank: 0, Cheque: 0 };
            const headBreakdown = {};

            feesList.forEach(f => {
              const amt = Number(f.totalReceived ?? (Number(f.amount || 0) + Number(f.lateFee || 0)));
              totalCollected += amt;

              const fDateStr = getLocalDateStr(f.date);
              const fMonthStr = getLocalMonthStr(f.date) || f.month;

              if (fDateStr === todayStr) todayCollection += amt;
              if (fMonthStr === currentMonthStr || f.month === currentMonthStr) monthlyCollection += amt;

              const mode = f.paymentMode || 'Cash';
              modeBreakdown[mode] = (modeBreakdown[mode] || 0) + amt;

              const head = f.type || 'Monthly Fee';
              headBreakdown[head] = (headBreakdown[head] || 0) + amt;
            });

            // Calculate total expected vs dues
            let totalDue = 0;
            const pendingStudentIds = new Set();

            activeStudents.forEach(s => {
              const studentDue = feeProfileForStudent(db, s, {
                session: dashboardSession,
                month: currentMonthStr,
                type: 'Monthly Tuition Fee'
              }).previousDues;

              if (studentDue > 0) {
                totalDue += studentDue;
                pendingStudentIds.add(normalizeFeeStudentId(s.admissionNo || s.studentId || s.id));
              }
            });

            let totalOverdue = 0;
            const dashboardRules = db.settings?.feeRules || {};
            const dashboardFine = dashboardRules.lateFineEnabled === true ? Math.max(0, Number(dashboardRules.lateFinePerMonth || 0)) : 0;
            activeStudents.filter(student => studentAcademicSession(student, db) === dashboardSession).forEach(student => {
              feeBillingMonthsThrough(dashboardSession, currentMonthStr).forEach(month => {
                const invoice = calculateFeeInvoice(db, student, { session: dashboardSession, month, type: 'Monthly Tuition Fee' });
                if (invoice.remainingBalance > 0 && feeOverdueDays(month, now, dashboardRules) > 0) totalOverdue += invoice.remainingBalance + Math.max(0, dashboardFine - Number(invoice.finePaid || 0));
              });
            });
            (db.legacyFeeDues || []).filter(due => matchTenant(due, activeSchool.id) && !due.deleted_at && normalizeAcademicSession(due.academic_session, db) === dashboardSession).map(due => legacyDueSnapshot(db, due)).filter(due => due.pending_amount > 0).forEach(due => { totalDue += due.total_outstanding; totalOverdue += due.total_overdue; pendingStudentIds.add(normalizeFeeStudentId(due.student_id)); });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              totalCollected,
              todayCollection,
              monthlyCollection,
              totalDue,
              totalOverdue,
              pendingCount: pendingStudentIds.size,
              legacyDueOutstanding: (db.legacyFeeDues || []).filter(due => matchTenant(due, activeSchool.id) && !due.deleted_at && normalizeAcademicSession(due.academic_session, db) === dashboardSession).map(due => legacyDueSnapshot(db, due)).reduce((sum, due) => sum + due.total_outstanding, 0),
              totalActiveStudents: activeStudents.length,
              totalTransactions: feesList.length,
              modeBreakdown,
              headBreakdown,
              academicSession: dashboardSession
            }));
          });
        }

        // GET /api/fees/due-list
        if (reqPath === '/api/fees/due-list' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const targetClass = parsedUrl.query.className;
            const targetSection = parsedUrl.query.section;
            const targetMonth = parsedUrl.query.month;
            const schoolSessions = (db.academicSessions || []).filter(row => matchTenant(row, activeSchool.id));
            const activeSession = schoolSessions.find(row => row.is_active) || schoolSessions[0] || (db.academicSessions || []).find(row => row.is_active) || (db.academicSessions || [])[0];
            const sessionId = String(parsedUrl.query.academic_session_id || (parsedUrl.query.academicSession ? (schoolSessions.find(s => s.session_name === parsedUrl.query.academicSession) || (db.academicSessions || []).find(s => s.session_name === parsedUrl.query.academicSession))?.id : '') || activeSession?.id || '').trim();
            const sessionRecord = (db.academicSessions || []).find(row => String(row.id) === sessionId);
            if (!sessionId || !sessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }

            const feesList = (db.fees || []).filter(fee => matchTenant(fee, activeSchool.id));
            let students = (db.students || []).filter(s => matchTenant(s, activeSchool.id) && s.status !== 'Inactive' && String(s.academic_session_id || '') === sessionId);

            if (targetClass) students = students.filter(s => s.className === targetClass);
            if (targetSection) students = students.filter(s => s.section === targetSection);

            const dueList = [];
            const dueMonth = targetMonth || getLocalMonthStr(new Date());
            const session = sessionRecord.session_name;

            students.forEach(s => {
              const invoice = calculateFeeInvoice(db, s, {
                session,
                month: dueMonth,
                type: 'Monthly Tuition Fee'
              });

              if (invoice.remainingBalance <= 0) return;
              const studentPayments = feesList.filter(fee => fee.status !== 'Refunded' && !fee.deleted_at && normalizeFeeStudentId(fee.studentId || fee.student_id) === normalizeFeeStudentId(s.admissionNo) && normalizeAcademicSession(fee.academic_session || fee.session, db) === session);
              const lastPayment = [...studentPayments].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
              dueList.push({
                studentId: s.admissionNo,
                name: s.name,
                className: s.className,
                section: s.section,
                rollNo: s.rollNo,
                mobile: s.mobile,
                monthlyFee: invoice.expectedAmount,
                admissionFee: studentFeeStructure(db, s, session).admissionFee,
                paidAmount: invoice.paidAmount,
                dueAmount: invoice.remainingBalance,
                discountAmount: invoice.discountAmount,
                scholarshipAmount: invoice.scholarshipAmount,
                fine: invoice.finePaid,
                totalOutstanding: invoice.remainingBalance,
                lastPaymentDate: lastPayment?.date || null,
                status: invoice.paidAmount > 0 ? 'Partially Paid' : (dueMonth < getLocalMonthStr(new Date()) ? 'Overdue' : 'Due')
              });
            });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(dueList));
          });
        }

        // GET /api/fees/student-wise-dues
        if (reqPath === '/api/fees/student-wise-dues' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const targetClass = parsedUrl.query.className;
            const targetSection = parsedUrl.query.section;
            const targetMonth = String(parsedUrl.query.month || '').trim();
            const targetSessionId = String(parsedUrl.query.academic_session_id || '').trim();
            const targetSessionRecord = (db.academicSessions || []).find(row => String(row.id) === targetSessionId);
            if (!targetSessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            if (!targetSessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Selected Academic Session is invalid.' })); }
            const targetSession = targetSessionRecord.session_name;
            const targetCategory = normalizeFeeType(parsedUrl.query.category || 'Monthly Tuition Fee');
            const requestedStatus = String(parsedUrl.query.status || '').trim().toLowerCase();
            const feeRules = db.settings?.feeRules || {};
            const now = new Date();
            const currentMonth = getLocalMonthStr(now);
            const invoiceMonths = targetMonth ? [targetMonth] : feeBillingMonthsThrough(targetSession, currentMonth);
            const fineEnabled = feeRules.lateFineEnabled === true;
            const finePerOverdueMonth = fineEnabled ? Math.max(0, Number(feeRules.lateFinePerMonth || 0)) : 0;
            const activeFees = (db.fees || []).filter(fee => matchTenant(fee, activeSchool.id) && fee.status !== 'Refunded' && !fee.deleted_at);
            let students = (db.students || []).filter(student => matchTenant(student, activeSchool.id) && isStudentActive(student));

            if (targetClass) students = students.filter(student => normalizeClassName(student.className || student.class_name) === normalizeClassName(targetClass));
            if (targetSection) students = students.filter(student => normalizeSectionName(student.section || student.section_name) === normalizeSectionName(targetSection));
            students = students.filter(student => String(student.academic_session_id || '') === targetSessionId);

            const result = [];
            students.forEach(student => {
              const studentId = student.admissionNo || student.admission_number || student.studentId || student.id;
              const studentPayments = activeFees.filter(fee =>
                normalizeFeeStudentId(fee.student_id || fee.studentId || fee.admission_number) === normalizeFeeStudentId(studentId) &&
                normalizeAcademicSession(fee.academic_session || fee.session, db) === targetSession
              );
              const lastPayment = [...studentPayments].sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')))[0];
              const invoiceDetails = invoiceMonths.map(month => {
                const invoice = calculateFeeInvoice(db, student, { session: targetSession, month, type: targetCategory });
                const overdueDays = invoice.remainingBalance > 0 ? feeOverdueDays(month, now, feeRules) : 0;
                const calculatedFine = overdueDays > 0 ? finePerOverdueMonth : 0;
                const outstandingFine = Math.max(0, calculatedFine - Number(invoice.finePaid || 0));
                return { month, invoice, overdueDays, outstandingFine };
              }).filter(detail => detail.invoice.expectedAmount > 0);

              if (!invoiceDetails.length) return;
              const pendingDetails = invoiceDetails.filter(detail => detail.invoice.remainingBalance > 0);
              const overdueDetails = pendingDetails.filter(detail => detail.overdueDays > 0);
              const totalFee = invoiceDetails.reduce((sum, detail) => sum + detail.invoice.expectedAmount, 0);
              const paidAmount = invoiceDetails.reduce((sum, detail) => sum + detail.invoice.paidAmount, 0);
              const pendingAmount = pendingDetails.reduce((sum, detail) => sum + detail.invoice.remainingBalance, 0);
              const overduePrincipal = overdueDetails.reduce((sum, detail) => sum + detail.invoice.remainingBalance, 0);
              const lateFine = overdueDetails.reduce((sum, detail) => sum + detail.outstandingFine, 0);
              const totalOverdue = overduePrincipal + lateFine;
              const totalOutstanding = pendingAmount + lateFine;
              const isPartiallyPaid = paidAmount > 0 && pendingAmount > 0;
              const dueStatus = pendingAmount <= 0 ? 'Paid' : (overdueDetails.length ? 'Overdue' : (isPartiallyPaid ? 'Partially Paid' : 'Pending'));
              const statusMatches = !requestedStatus ||
                (requestedStatus === 'overdue' && overdueDetails.length > 0) ||
                (['partial', 'partially paid'].includes(requestedStatus) && isPartiallyPaid) ||
                (requestedStatus === 'pending' && pendingAmount > 0 && overdueDetails.length === 0 && !isPartiallyPaid) ||
                (['paid', 'cleared'].includes(requestedStatus) && pendingAmount <= 0);
              if (!statusMatches || (!requestedStatus && pendingAmount <= 0)) return;

              const dueMonths = pendingDetails.map(detail => detail.month);
              result.push({
                studentId,
                admissionNo: studentId,
                name: student.name || student.studentName || 'Unnamed Student',
                className: normalizeClassName(student.className || student.class_name),
                section: normalizeSectionName(student.section || student.section_name),
                fatherName: student.fatherName || student.father_name || 'N/A',
                mobile: student.mobile || student.mobileNumber || 'N/A',
                academicSession: targetSession,
                dueMonth: dueMonths.join(', ') || invoiceMonths.join(', '),
                dueMonths,
                nextDueMonth: pendingDetails[0]?.month || '',
                nextDueAmount: pendingDetails[0]?.invoice.remainingBalance || 0,
                pendingMonths: pendingDetails.length,
                overdueMonths: overdueDetails.length,
                overdueDays: overdueDetails.reduce((maximum, detail) => Math.max(maximum, detail.overdueDays), 0),
                feeCategory: targetCategory,
                totalFee,
                paidAmount,
                pendingAmount,
                lateFine,
                totalOverdue,
                totalOutstanding,
                dueThisMonthAmount: pendingDetails.filter(detail => detail.month === currentMonth).reduce((sum, detail) => sum + detail.invoice.remainingBalance + detail.outstandingFine, 0),
                discountAmount: invoiceDetails.reduce((sum, detail) => sum + detail.invoice.discountAmount, 0),
                scholarshipAmount: invoiceDetails.reduce((sum, detail) => sum + detail.invoice.scholarshipAmount, 0),
                lastPaymentDate: lastPayment ? String(lastPayment.date || lastPayment.created_at).slice(0, 10) : 'N/A',
                isPartiallyPaid,
                dueStatus
              });
            });

            (db.legacyFeeDues || []).filter(due => !due.deleted_at && normalizeAcademicSession(due.academic_session, db) === targetSession && (!targetMonth || due.due_month === targetMonth) && (!parsedUrl.query.category || normalizeFeeType(due.fee_category) === targetCategory)).forEach(due => {
              const snapshot = legacyDueSnapshot(db, due, now), student = findFeeStudent(db, due.student_id); if (!student) return;
              if (targetClass && normalizeClassName(student.className) !== normalizeClassName(targetClass)) return; if (targetSection && normalizeSectionName(student.section) !== normalizeSectionName(targetSection)) return;
              const statusMatches = !requestedStatus || snapshot.payment_status.toLowerCase() === requestedStatus || (requestedStatus === 'partial' && snapshot.payment_status === 'Partial'); if (!statusMatches || (!requestedStatus && snapshot.pending_amount <= 0)) return;
              result.push({ studentId: snapshot.student_id, admissionNo: snapshot.student_id, name: student.name, className: normalizeClassName(student.className), section: normalizeSectionName(student.section), fatherName: student.fatherName || 'N/A', mobile: student.mobile || 'N/A', academicSession: snapshot.academic_session, dueMonth: snapshot.due_month, dueMonths: [snapshot.due_month], nextDueMonth: snapshot.due_month, nextDueAmount: snapshot.pending_amount, pendingMonths: snapshot.pending_amount > 0 ? 1 : 0, overdueMonths: snapshot.overdue_days > 0 ? 1 : 0, overdueDays: snapshot.overdue_days, feeCategory: snapshot.fee_category, totalFee: snapshot.fee_amount, paidAmount: snapshot.paid_amount, pendingAmount: snapshot.pending_amount, lateFine: snapshot.late_fine, totalOverdue: snapshot.total_overdue, totalOutstanding: snapshot.total_outstanding, dueThisMonthAmount: snapshot.due_month === currentMonth ? snapshot.total_outstanding : 0, discountAmount: snapshot.discount_amount, scholarshipAmount: 0, lastPaymentDate: snapshot.payments.length ? String(snapshot.payments.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0].date).slice(0,10) : 'N/A', isPartiallyPaid: snapshot.payment_status === 'Partial', dueStatus: snapshot.payment_status, legacyDueId: snapshot.id, source: 'Legacy Opening Balance' });
            });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(result));
          });
        }
        // POST /api/fees/reminders (provider-backed, session-scoped due reminders)
        if (reqPath === '/api/fees/reminders' && method === 'POST') {
          return handleAdminRoute(async () => {
            const requestedIds=[...new Set((req.body?.studentIds||[]).map(normalizeFeeStudentId).filter(Boolean))];
            if(!requestedIds.length){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Select at least one student for a fee reminder.'}))}
            const sessionId=String(req.body?.academic_session_id||'').trim();if(!sessionId){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Academic Session is required.'}))}
            const reminderType=req.body?.reminderType==='overdue'?'overdue':'due',reminderSwitch=reminderType==='overdue'?'overdueReminder':'feeDueReminder',templateKey=reminderType==='overdue'?'fee_overdue_reminder':'fee_due_reminder',whatsapp=WhatsApp.config(db,getJwtSecret());
            if(!whatsapp.enabled||!whatsapp.automation[reminderSwitch]||!whatsapp.templates[templateKey]){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Enable the selected WhatsApp reminder automation and configure its Meta-approved template first.'}))}
            const students=(db.students||[]).filter(student=>isStudentActive(student)&&String(student.academic_session_id||'')===sessionId&&requestedIds.some(id=>[student.id,student.studentId,student.student_id,student.admissionNo,student.admission_number].some(value=>normalizeFeeStudentId(value)===id)));
            if(students.length!==requestedIds.length){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'One or more selected students are invalid or do not belong to the selected Academic Session.'}))}
            const sent=[],duplicates=[],failed=[];for(const student of students){try{const payload=feeReminderPayload(db,student,{sessionId,requestedMonth:req.body?.month,reminderType});const fresh=readDbRaw(),out=await WhatsApp.send(fresh,{mobileNumber:student.mobile,studentId:student.admissionNo||student.id,studentName:student.name,parentName:student.fatherName||'',messageType:reminderType,templateKey,templateName:whatsapp.templates[templateKey],languageCode:whatsapp.templateLanguages[templateKey],components:payload.components,academicSession:payload.academicSession,academic_session_id:payload.academic_session_id,deduplicationKey:reminderType+':'+(student.admissionNo||student.id)+':'+payload.month+':'+sessionId},getJwtSecret(),writeDbRaw,readDbRaw);const result={studentId:student.admissionNo||student.id,metaMessageId:out.metaMessageId||out.log?.metaMessageId||'',duplicate:!!out.duplicate};if(out.duplicate)duplicates.push(result);else if(out.success)sent.push(result)}catch(error){failed.push({studentId:student.admissionNo||student.id,error:String(error.message||error).slice(0,500)})}}
            const status=failed.length?207:200;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({success:failed.length===0,sent:sent.length,duplicates:duplicates.length,failed:failed.length,studentCount:students.length,results:[...sent,...duplicates],errors:failed,...(failed.length?{error:failed.map(item=>item.studentId+': '+item.error).join(' | ')}:{})}))
          });
        }
        // Legacy fee opening balances: CRUD, validated bulk import, and reports
        if (reqPath === '/api/fees/legacy-dues' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            let rows = (db.legacyFeeDues || []).filter(due => matchTenant(due, activeSchool.id) && !due.deleted_at).map(due => {
              const student = findFeeStudent(db, due.student_id); return { ...legacyDueSnapshot(db, due), studentName: student?.name || 'Unknown Student', className: normalizeClassName(student?.className), section: normalizeSectionName(student?.section), parentName: student?.fatherName || 'N/A', mobile: student?.mobile || 'N/A' };
            });
            const q = parsedUrl.query || {}; if (q.studentId) rows = rows.filter(row => normalizeFeeStudentId(row.student_id) === normalizeFeeStudentId(q.studentId)); if (q.session) rows = rows.filter(row => normalizeAcademicSession(row.academic_session, db, activeSchool.id) === normalizeAcademicSession(q.session, db, activeSchool.id)); if (q.month) rows = rows.filter(row => row.due_month === q.month); if (q.category) rows = rows.filter(row => normalizeFeeType(row.fee_category) === normalizeFeeType(q.category)); if (q.className) rows = rows.filter(row => row.className === normalizeClassName(q.className)); if (q.status) rows = rows.filter(row => row.payment_status.toLowerCase() === String(q.status).toLowerCase());
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(rows.sort((a,b) => String(a.due_month).localeCompare(String(a.due_month)))));
          });
        }
        if (reqPath === '/api/fees/legacy-dues' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Only Admin can add legacy dues.' })); }
            if (!db.legacyFeeDues) db.legacyFeeDues = []; const check = validateLegacyDueInput(db, req.body || {}); if (check.errors.length) { res.writeHead(check.errors.some(e => e.startsWith('Duplicate')) ? 409 : 400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: check.errors.join(' '), errors: check.errors })); }
            const now = new Date().toISOString(); const due = { id: 'legacy_due_' + crypto.randomUUID(), school_id: activeSchool.id, ...check.normalized, source: 'Manual', created_by: req.user?.username || 'Admin', created_at: now, updated_at: now }; db.legacyFeeDues.push(due); writeDbRaw(db); res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(legacyDueSnapshot(db, due)));
          });
        }
        if (reqPath === '/api/fees/legacy-dues/import' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Only Admin can import legacy dues.' })); }
            const records = req.body?.records; if (!Array.isArray(records) || !records.length) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'At least one spreadsheet record is required.' })); } if (records.length > 5000) { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'A maximum of 5,000 rows can be imported at once.' })); }
            if (!db.legacyFeeDues) db.legacyFeeDues = []; const imported = [], skipped = [], errors = []; records.forEach((record, index) => { const check = validateLegacyDueInput(db, record); if (check.errors.length) { const detail = { row: index + 2, admissionNo: record.admissionNo || record.studentId || '', errors: check.errors }; (check.errors.some(e => e.startsWith('Duplicate')) ? skipped : errors).push(detail); return; } const now = new Date().toISOString(); const due = { id: 'legacy_due_' + crypto.randomUUID(), school_id: activeSchool.id, ...check.normalized, source: 'Excel Import', import_batch_id: req.body.batchId || null, created_by: req.user?.username || 'Admin', created_at: now, updated_at: now }; db.legacyFeeDues.push(due); imported.push(legacyDueSnapshot(db, due)); }); if (imported.length) writeDbRaw(db); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ success: true, totalRows: records.length, importedCount: imported.length, skippedCount: skipped.length, errorCount: errors.length, imported, skipped, errors }));
          });
        }
        if (reqPath === '/api/fees/legacy-dues' && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Only Admin can update legacy dues.' })); } const index = (db.legacyFeeDues || []).findIndex(due => matchTenant(due, activeSchool.id) && due.id === req.body?.id && !due.deleted_at); if (index < 0) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Legacy due was not found.' })); } const current = db.legacyFeeDues[index], check = validateLegacyDueInput(db, { ...current, ...req.body }, current.id); if (check.errors.length) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: check.errors.join(' '), errors: check.errors })); } const paidThroughReceipts = legacyDueSnapshot(db, current).paid_amount - Number(current.opening_paid_amount || 0); if (check.normalized.fee_amount - check.normalized.discount_amount < check.normalized.opening_paid_amount + paidThroughReceipts) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Updated due cannot be lower than payments already allocated to it.' })); } db.legacyFeeDues[index] = { ...current, ...check.normalized, updated_at: new Date().toISOString() }; writeDbRaw(db); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(legacyDueSnapshot(db, db.legacyFeeDues[index])));
          });
        }
        if (reqPath === '/api/fees/legacy-dues' && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Only Admin can delete legacy dues.' })); } const due = (db.legacyFeeDues || []).find(item => matchTenant(item, activeSchool.id) && item.id === parsedUrl.query.id && !item.deleted_at); if (!due) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Legacy due was not found.' })); } if (legacyDueSnapshot(db, due).payments.length) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Legacy dues with receipt payments cannot be deleted.' })); } due.deleted_at = new Date().toISOString(); due.deleted_by = req.user?.username || 'Admin'; writeDbRaw(db); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ success: true }));
          });
        }

        // GET /api/fees/audit-log
        if (reqPath === '/api/fees/audit-log' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const logs = (db.feeAuditLogs || []).filter(l => matchTenant(l, activeSchool.id));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(logs));
          });
        }

        // GET /api/fees/student-fee-profile (annual passbook)
        if (reqPath === '/api/fees/student-fee-profile' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const requestedId = parsedUrl.query.studentId || parsedUrl.query.student_id || parsedUrl.query.admissionNo;
            if (!requestedId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student ID or admission number is required.' }));
            }
            const student = (db.students || []).find(item =>
              matchTenant(item, activeSchool.id) &&
              [item.id, item.studentId, item.student_id, item.admissionNo, item.admission_number]
                .some(value => normalizeFeeStudentId(value) === normalizeFeeStudentId(requestedId))
            );
            if (!student) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Student "${requestedId}" was not found.` }));
            }
            const sessionId = String(parsedUrl.query.academic_session_id || '').trim();
            const sessionRecord = (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === sessionId);
            if (!sessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            if (!sessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Selected Academic Session is invalid.' })); }
            if (String(student.academic_session_id || '') !== sessionId) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Student was not found in the selected Academic Session.' })); }
            const session = sessionRecord.session_name;
            const months = feeAcademicSessionMonths(session);
            if (months.length !== 12) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Academic session "${session}" is invalid.` }));
            }
            const feeRules = db.settings?.feeRules || {};
            const now = new Date();
            const currentMonth = getLocalMonthStr(now);
            const fineEnabled = feeRules.lateFineEnabled === true;
            const finePerMonth = fineEnabled ? Math.max(0, Number(feeRules.lateFinePerMonth || 0)) : 0;
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const timeline = months.map(month => {
              const invoice = calculateFeeInvoice(db, student, { session, month, type: 'Monthly Tuition Fee' });
              const dueDate = feeDueDateForMonth(month, feeRules);
              const overdueDays = invoice.remainingBalance > 0 ? feeOverdueDays(month, now, feeRules) : 0;
              const lateFine = overdueDays > 0 ? Math.max(0, finePerMonth - Number(invoice.finePaid || 0)) : 0;
              const payments = [...invoice.payments].sort((a, b) => String(a.date || a.created_at || '').localeCompare(String(b.date || b.created_at || '')));
              const latestPayment = payments[payments.length - 1];
              let status = 'Not Due';
              if (invoice.expectedAmount <= 0) status = 'Not Due';
              else if (invoice.remainingBalance <= 0) status = 'Paid';
              else if (invoice.paidAmount > 0) status = 'Partial';
              else if (overdueDays > 0) status = 'Overdue';
              else if (month <= currentMonth) status = 'Unpaid';
              return {
                month,
                monthName: monthNames[Number(month.slice(5, 7)) - 1],
                status,
                isOverdue: overdueDays > 0,
                overdueDays,
                dueDate: dueDate ? getLocalDateStr(dueDate) : null,
                feeAmount: invoice.expectedAmount,
                netFee: invoice.netFee,
                paidAmount: invoice.paidAmount,
                pendingAmount: invoice.remainingBalance,
                lateFine,
                discountAmount: invoice.discountAmount,
                scholarshipAmount: invoice.scholarshipAmount,
                paymentDate: latestPayment ? String(latestPayment.date || latestPayment.created_at).slice(0, 10) : null,
                receiptNo: latestPayment?.receiptNo || null,
                paymentMode: latestPayment?.paymentMode || null,
                receipts: payments.map(payment => ({
                  id: payment.id,
                  receiptNo: payment.receiptNo,
                  amount: Number(payment.amount || 0),
                  lateFee: Number(payment.lateFee || 0),
                  paymentDate: String(payment.date || payment.created_at || '').slice(0, 10),
                  paymentMode: payment.paymentMode || 'N/A'
                }))
              };
            });

            const oneTimeCategories = Object.keys(FEE_CATEGORY_FIELDS).filter(category => !['Monthly Tuition Fee', 'Transport Fee'].includes(category));
            const oneTimeInvoices = oneTimeCategories.map(category => calculateFeeInvoice(db, student, { session, month: months[0], type: category }));
            const transportInvoices = months.map(month => calculateFeeInvoice(db, student, { session, month, type: 'Transport Fee' }));
            const allInvoices = [...timeline.map(item => calculateFeeInvoice(db, student, { session, month: item.month, type: 'Monthly Tuition Fee' })), ...transportInvoices, ...oneTimeInvoices];
            const activeSessionPayments = (db.fees || []).filter(fee =>
              fee.status !== 'Refunded' && !fee.deleted_at &&
              normalizeFeeStudentId(fee.student_id || fee.studentId || fee.admission_number) === normalizeFeeStudentId(student.admissionNo || student.studentId || student.id) &&
              normalizeAcademicSession(fee.academic_session || fee.session, db) === session
            ).sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')));
            const totalAnnualFee = allInvoices.reduce((sum, invoice) => sum + invoice.expectedAmount, 0);
            const totalPaid = allInvoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
            const totalPending = allInvoices.reduce((sum, invoice) => sum + invoice.remainingBalance, 0);
            const totalLateFine = timeline.reduce((sum, item) => sum + item.lateFine, 0);
            const totalOverdue = timeline.filter(item => item.isOverdue).reduce((sum, item) => sum + item.pendingAmount + item.lateFine, 0);
            const totalDiscount = allInvoices.reduce((sum, invoice) => sum + invoice.discountAmount + invoice.scholarshipAmount, 0);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              student: {
                id: student.id || student.studentId || student.admissionNo,
                studentId: student.studentId || student.student_id || student.id || student.admissionNo,
                admissionNo: student.admissionNo || student.admission_number || student.studentId || student.id,
                name: student.name || student.studentName || 'Unnamed Student',
                photo: student.photo || student.photoUrl || student.photo_url || '',
                className: normalizeClassName(student.className || student.class_name),
                section: normalizeSectionName(student.section || student.section_name),
                academicSession: session,
                parentName: student.fatherName || student.father_name || student.parentName || 'N/A',
                mobile: student.mobile || student.mobileNumber || student.phone || 'N/A'
              },
              summary: {
                totalAnnualFee,
                totalPaid,
                totalPending,
                totalOverdue,
                lateFine: totalLateFine,
                discount: totalDiscount,
                lastPaymentDate: activeSessionPayments[0] ? String(activeSessionPayments[0].date || activeSessionPayments[0].created_at).slice(0, 10) : null,
                pendingMonths: timeline.filter(item => item.pendingAmount > 0).length,
                advanceCredit: activeSessionPayments.reduce((sum, payment) => sum + Number(payment.advanceAmount || 0), 0)
              },
              timeline,
              paymentHistory: activeSessionPayments
            }));
          });
        }
        // GET /api/fees/student-profile
        if (reqPath === '/api/fees/student-profile' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const studentId = parsedUrl.query.studentId || parsedUrl.query.student_id || parsedUrl.query.admissionNo;
            if (!studentId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student ID or admission number is required.' }));
            }
            const student = (db.students || []).find(item =>
              matchTenant(item, activeSchool.id) &&
              [item.id, item.studentId, item.student_id, item.admissionNo, item.admission_number]
                .some(value => normalizeFeeStudentId(value) === normalizeFeeStudentId(studentId))
            );
            if (!student) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Student "${studentId}" was not found.` }));
            }
            const profileSessionId = String(parsedUrl.query.academic_session_id || '').trim();
            const profileSessionRecord = (db.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === profileSessionId);
            if (!profileSessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            if (!profileSessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Selected Academic Session is invalid.' })); }
            if (String(student.academic_session_id || '') !== profileSessionId) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Student was not found in the selected Academic Session.' })); }
            const profile = feeProfileForStudent(db, student, {
              session: profileSessionRecord.session_name,
              month: parsedUrl.query.month || parsedUrl.query.billing_month,
              type: parsedUrl.query.type || parsedUrl.query.fee_type,
              customFeeAmount: parsedUrl.query.expectedAmount,
              discountAmount: parsedUrl.query.discountAmount,
              scholarshipAmount: parsedUrl.query.scholarshipAmount
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(profile));
          });
        }

        // GET /api/fees
        if (reqPath === '/api/fees' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const studentId = parsedUrl.query.studentId || parsedUrl.query.student_id || parsedUrl.query.admissionNo;
            const receiptNo = parsedUrl.query.receiptNo;
            if (receiptNo) {
              const matchedReceipt = (db.fees || []).find(f => matchTenant(f, activeSchool.id) && !f.deleted_at && f.receiptNo === receiptNo);
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify(matchedReceipt ? [matchedReceipt] : []));
            }
            const schoolSessions = (db.academicSessions || []).filter(row => matchTenant(row, activeSchool.id));
            const activeSession = schoolSessions.find(row => row.is_active) || schoolSessions[0] || (db.academicSessions || []).find(row => row.is_active) || (db.academicSessions || [])[0];
            const sessionId = String(parsedUrl.query.academic_session_id || (parsedUrl.query.academicSession ? (schoolSessions.find(s => s.session_name === parsedUrl.query.academicSession) || (db.academicSessions || []).find(s => s.session_name === parsedUrl.query.academicSession))?.id : '') || activeSession?.id || '').trim();
            const sessionRecord = (db.academicSessions || []).find(row => String(row.id) === sessionId);
            if (!sessionId || !sessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            const session = sessionRecord.session_name;
            let list = (db.fees || []).filter(fee => matchTenant(fee, activeSchool.id) && !fee.deleted_at);
            if (studentId) {
              list = list.filter(f => normalizeFeeStudentId(f.student_id || f.studentId || f.admission_number) === normalizeFeeStudentId(studentId));
              const openingBalances = (db.legacyFeeDues || []).filter(due => matchTenant(due, activeSchool.id) && !due.deleted_at && normalizeFeeStudentId(due.student_id) === normalizeFeeStudentId(studentId)).map(due => { const snapshot = legacyDueSnapshot(db, due); return { id: 'opening_' + due.id, receiptNo: 'OPENING BALANCE', student_id: due.student_id, studentId: due.student_id, studentName: findFeeStudent(db, due.student_id)?.name || due.student_id, className: normalizeClassName(findFeeStudent(db, due.student_id)?.className), type: 'Legacy: ' + due.fee_category, month: due.due_month, academic_session: due.academic_session, session: due.academic_session, paymentMode: 'Opening Balance', amount: due.opening_paid_amount || 0, lateFee: 0, dueBalance: snapshot.total_outstanding, paymentStatus: snapshot.payment_status, status: snapshot.payment_status, remarks: due.remarks || '', source: 'Legacy Opening Balance', legacy_due_id: due.id, date: due.created_at, created_at: due.created_at, read_only: true }; });
              list.push(...openingBalances);
            }
            if (session) list = list.filter(f => normalizeAcademicSession(f.academic_session || f.session, db) === normalizeAcademicSession(session, db));
            list = [...list].sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/fees/allocate-oldest (atomic oldest-first monthly allocation)
        if (reqPath === '/api/fees/allocate-oldest' && method === 'POST') {
          return handleAdminRoute(async (currentDbParam, activeSchool) => {
            const currentDb = currentDbParam || readDbRaw();
            const fee = req.body || {};
            const student = (currentDb.students || []).find(item =>
              matchTenant(item, activeSchool.id) &&
              [item.id, item.studentId, item.student_id, item.admissionNo, item.admission_number]
                .some(value => normalizeFeeStudentId(value) === normalizeFeeStudentId(fee.studentId))
            );
            if (!student || !isStudentActive(student)) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Active student was not found.' }));
            }
            const sessionId = String(fee.academic_session_id || '').trim();
            const sessionRecord = (currentDb.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === sessionId);
            if (!sessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            if (!sessionRecord || String(student.academic_session_id || '') !== sessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Student does not belong to the selected Academic Session.' })); }
            const session = sessionRecord.session_name;
            const throughMonth = String(fee.month || '').trim();
            const paymentMode = String(fee.paymentMode || '').trim();
            const referenceNo = String(fee.referenceNo || '').trim();
            const amount = Number(fee.amount);
            const lateFee = Number(fee.lateFee || 0);
            const idempotencyKey = String(fee.idempotencyKey || fee.clientRequestId || '').trim();
            if (!throughMonth || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(lateFee) || lateFee < 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Billing month and a positive payment amount are required.' }));
            }
            if (Number(fee.discountAmount || 0) > 0 || Number(fee.scholarshipAmount || 0) > 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Discount and scholarship adjustments must be applied to an individual month.' }));
            }
            if (paymentMode !== 'Cash' && (!referenceNo || referenceNo === 'N/A')) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Transaction reference is required for non-cash payments.' }));
            }
            if (!idempotencyKey) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A unique payment request key is required.' }));
            }
            const existingBatch = (currentDb.fees || []).filter(item => matchTenant(item, activeSchool.id) && item.batchIdempotencyKey === idempotencyKey);
            if (existingBatch.length) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Duplicate payment request detected. Existing receipt: ' + existingBatch[0].batchReceiptNo }));
            }
            const months = feeBillingMonthsThrough(session, throughMonth);
            const invoices = months.map(month => ({ month, invoice: calculateFeeInvoice(currentDb, student, { session, month, type: 'Monthly Tuition Fee' }) }))
              .filter(item => item.invoice.expectedAmount > 0 && item.invoice.remainingBalance > 0);
            if (!invoices.length) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'No pending monthly fee exists through the selected month.' }));
            }
            const outstanding = invoices.reduce((sum, item) => sum + item.invoice.remainingBalance, 0);
            const allowAdvance = fee.allowAdvance === true;
            if (amount > outstanding + 0.001 && !allowAdvance) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Payment exceeds the oldest pending balance of ?' + outstanding.toFixed(2) + '. Enable advance payment to retain the excess.' }));
            }
            currentDb.fees = currentDb.fees || [];
            const year = new Date().getFullYear();
            const sequences = currentDb.fees.filter(item => matchTenant(item, activeSchool.id)).map(item => String(item.receiptNo || '').match(/^REC-\d{4}-(\d+)/)).filter(Boolean).map(match => Number(match[1]));
            const baseReceipt = `REC-${year}-${String((sequences.length ? Math.max(...sequences) : 0) + 1).padStart(4, '0')}`;
            const paymentDate = fee.paymentDate ? new Date(fee.paymentDate) : new Date();
            if (Number.isNaN(paymentDate.getTime())) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Payment date is invalid.' }));
            }
            let remaining = amount;
            const allocations = [];
            invoices.forEach((item, index) => {
              if (remaining <= 0) return;
              const appliedAmount = Math.min(remaining, item.invoice.remainingBalance);
              const isLastAllocation = index === invoices.length - 1 || remaining - appliedAmount <= 0;
              const advanceAmount = isLastAllocation && allowAdvance ? Math.max(0, remaining - appliedAmount) : 0;
              const receivedAmount = appliedAmount + advanceAmount;
              const dueBalance = Math.max(0, item.invoice.remainingBalance - appliedAmount);
              const receiptNo = allocations.length === 0 ? baseReceipt : baseReceipt + '-' + String(allocations.length + 1).padStart(2, '0');
              const row = {
                id: 'fee_' + crypto.randomUUID(), school_id: activeSchool.id, student_id: student.admissionNo, studentId: student.admissionNo,
                admission_number: student.admissionNo, studentName: student.name,
                class_id: normalizeClassName(student.className), className: normalizeClassName(student.className),
                section_id: normalizeSectionName(student.section), section: normalizeSectionName(student.section),
                receiptNo, batchReceiptNo: baseReceipt, batchIdempotencyKey: idempotencyKey,
                source: 'Oldest Due Allocation', academic_session_id: sessionId, academic_session: session, session,
                fee_type: 'Monthly Tuition Fee', type: 'Monthly Tuition Fee', feeHeads: { 'Monthly Tuition Fee': receivedAmount },
                expectedAmount: item.invoice.expectedAmount, grossAmount: item.invoice.expectedAmount,
                discountAmount: item.invoice.discountAmount, scholarshipAmount: item.invoice.scholarshipAmount,
                amount: receivedAmount, lateFee: allocations.length === 0 ? lateFee : 0,
                totalReceived: receivedAmount + (allocations.length === 0 ? lateFee : 0), paidAmount: receivedAmount,
                appliedAmount, advanceAmount, cumulativePaid: item.invoice.paidAmount + appliedAmount,
                dueBalance, paymentStatus: dueBalance <= 0 ? (advanceAmount > 0 ? 'Paid with Advance' : 'Paid') : 'Partially Paid',
                billing_month: item.month, month: item.month, paymentMode, referenceNo: referenceNo || 'N/A',
                remarks: fee.remarks || 'Oldest pending monthly fee allocation', idempotencyKey: idempotencyKey + ':' + item.month,
                entered_by: req.user?.username || 'Admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), date: paymentDate.toISOString()
              };
              allocations.push(row); currentDb.fees.push(row); remaining -= receivedAmount;
            });
            if (!allocations.length) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'No payment allocation could be created.' }));
            }
            const summary = { ...allocations[0], receiptNo: baseReceipt, batchReceiptNo: baseReceipt, amount, lateFee, totalReceived: amount + lateFee, month: allocations.map(item => item.month).join(', '), feeMonths: allocations.map(item => item.month), allocations };
            triggerNotifications(currentDb, student, 'FeeSuccess', { receiptNo: baseReceipt, amount, month: summary.month });
            writeDbRaw(currentDb);
            summary.whatsapp=await sendFeeWhatsAppAfterPayment(student,summary);
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(summary));
          });
        }

        // POST /api/fees (Collect Fee Payment)
        if (reqPath === '/api/fees' && method === 'POST') {
          return handleAdminRoute(async (currentDbParam, activeSchool) => {
            const currentDb = currentDbParam || readDbRaw();
            const fee = req.body;
            const required = ['studentId', 'amount', 'month', 'type', 'paymentMode'];
            for (let field of required) {
              if (fee[field] === undefined || fee[field] === '') {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `Field '${field}' is required.` }));
              }
            }

            const student = (currentDb.students || []).find(s =>
              matchTenant(s, activeSchool.id) &&
              [s.id, s.studentId, s.student_id, s.admissionNo, s.admission_number]
                .some(value => normalizeFeeStudentId(value) === normalizeFeeStudentId(fee.studentId))
            );
            if (!student) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Student not found.' }));
            }

            if (!currentDb.fees) currentDb.fees = [];
            const idempotencyKey = String(fee.idempotencyKey || fee.clientRequestId || '').trim();
            const duplicate = (currentDb.fees || []).find(existing =>
              matchTenant(existing, activeSchool.id) && (
                (fee.receiptNo && existing.receiptNo === fee.receiptNo) ||
                (idempotencyKey && existing.idempotencyKey === idempotencyKey) ||
                (fee.paymentMode !== 'Cash' && fee.referenceNo && fee.referenceNo !== 'N/A' &&
                  normalizeFeeStudentId(existing.studentId) === normalizeFeeStudentId(student.admissionNo) &&
                  String(existing.referenceNo || '').toLowerCase() === String(fee.referenceNo).toLowerCase())
              )
            );
            if (duplicate) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Duplicate payment request detected. Existing receipt: ${duplicate.receiptNo}.` }));
            }

            const yearStr = new Date().getFullYear();
            const maxSequence = (currentDb.fees || []).filter(item => matchTenant(item, activeSchool.id)).reduce((max, item) => {
              const match = String(item.receiptNo || '').match(/^REC-\d{4}-(\d+)$/);
              return match ? Math.max(max, Number(match[1])) : max;
            }, 0);
            const seqStr = String(maxSequence + 1).padStart(4, '0');
            const receiptNo = fee.receiptNo || `REC-${yearStr}-${seqStr}`;
            const type = normalizeFeeType(fee.type);
            const schoolSessions = (currentDb.academicSessions || []).filter(row => matchTenant(row, activeSchool.id));
            const sessionId = String(fee.academic_session_id || student.academic_session_id || (schoolSessions.find(row => row.session_name === (fee.academic_session || fee.academicSession)) || (currentDb.academicSessions || []).find(row => row.session_name === (fee.academic_session || fee.academicSession)))?.id || '').trim();
            const sessionRecord = (currentDb.academicSessions || []).find(row => matchTenant(row, activeSchool.id) && String(row.id) === sessionId);
            if (!sessionId || !sessionRecord) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic Session is required.' })); }
            if (String(student.academic_session_id || '') && String(student.academic_session_id || '') !== sessionId) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Student does not belong to the selected Academic Session.' })); }
            const session = sessionRecord.session_name;
            const month = String(fee.month || fee.billing_month).trim();
            const paymentDateInput = String(fee.paymentDate || fee.date || '').trim();
            const paymentDate = paymentDateInput ? new Date(paymentDateInput) : new Date();
            if (Number.isNaN(paymentDate.getTime())) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Payment date is invalid.' }));
            }
            const paymentMode = String(fee.paymentMode || '').trim();
            const referenceNo = String(fee.referenceNo || '').trim();
            if (paymentMode !== 'Cash' && (!referenceNo || referenceNo === 'N/A')) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Transaction reference is required for ${paymentMode} payments.` }));
            }
            const amount = Number(fee.amount);
            const lateFee = Number(fee.lateFee || 0);
            const discountAmount = Number(fee.discountAmount || 0);
            const scholarshipAmount = Number(fee.scholarshipAmount || 0);
            if (!Number.isFinite(amount) || amount < 0 || (amount <= 0 && (!fee.legacyDueId || lateFee <= 0)) || !Number.isFinite(lateFee) || lateFee < 0 ||
                !Number.isFinite(discountAmount) || discountAmount < 0 ||
                !Number.isFinite(scholarshipAmount) || scholarshipAmount < 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Payment, fine, discount, and scholarship amounts must be valid non-negative numbers; payment must be greater than zero.' }));
            }
            const legacyDue = fee.legacyDueId ? (currentDb.legacyFeeDues || []).find(due => matchTenant(due, activeSchool.id) && due.id === fee.legacyDueId && !due.deleted_at) : null;
            if (fee.legacyDueId && (!legacyDue || normalizeFeeStudentId(legacyDue.student_id) !== normalizeFeeStudentId(student.admissionNo))) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'The selected legacy due was not found for this student.' }));
            }
            const legacySnapshot = legacyDue ? legacyDueSnapshot(currentDb, legacyDue) : null;
            if (legacySnapshot && lateFee > legacySnapshot.outstanding_fine + 0.001) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Fine payment exceeds the outstanding legacy fine.' })); }
            const invoice = legacySnapshot ? { expectedAmount: legacySnapshot.fee_amount, remainingBalance: legacySnapshot.pending_amount, paidAmount: legacySnapshot.paid_amount, discountAmount: legacySnapshot.discount_amount, scholarshipAmount: 0 } : calculateFeeInvoice(currentDb, student, { session, month, type, customFeeAmount: fee.expectedAmount, discountAmount, scholarshipAmount });
            if (invoice.expectedAmount <= 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `No fee amount is configured for ${type}.` }));
            }
            const allowAdvance = fee.allowAdvance === true;
            if (amount > invoice.remainingBalance + 0.001 && !allowAdvance) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Payment exceeds the remaining balance of ₹${invoice.remainingBalance.toFixed(2)}. Enable advance payment to store the excess as student credit.` }));
            }
            if (discountAmount + scholarshipAmount > invoice.expectedAmount) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Discount and scholarship adjustments cannot exceed the configured fee.' }));
            }
            const appliedAmount = Math.min(amount, invoice.remainingBalance);
            const advanceAmount = Math.max(0, amount - appliedAmount);
            const dueBalance = Math.max(0, invoice.remainingBalance - appliedAmount);
            const paymentStatus = dueBalance <= 0 ? (advanceAmount > 0 ? 'Paid with Advance' : 'Paid') : 'Partially Paid';

            const newFee = {
              id: 'fee_' + crypto.randomUUID(),
              school_id: activeSchool.id,
              student_id: student.admissionNo,
              studentId: student.admissionNo,
              admission_number: student.admissionNo,
              studentName: student.name,
              class_id: normalizeClassName(student.className),
              className: normalizeClassName(student.className),
              section_id: normalizeSectionName(student.section),
              section: normalizeSectionName(student.section),
              receiptNo,
              legacy_due_id: legacyDue?.id || null,
              source: legacyDue ? 'Legacy Due Payment' : 'Fee Collection',
              academic_session_id: sessionId,
              academic_session: session,
              session,
              fee_type: type,
              type,
              feeHeads: fee.feeHeads || { [type]: amount },
              expectedAmount: invoice.expectedAmount,
              grossAmount: invoice.expectedAmount,
              discountAmount: invoice.discountAmount,
              scholarshipAmount: invoice.scholarshipAmount,
              amount,
              lateFee,
              totalReceived: amount + lateFee,
              paidAmount: amount,
              appliedAmount,
              advanceAmount,
              cumulativePaid: invoice.paidAmount + appliedAmount,
              dueBalance,
              paymentStatus,
              billing_month: month,
              month,
              paymentMode,
              referenceNo: referenceNo || 'N/A',
              remarks: fee.remarks || '',
              idempotencyKey: idempotencyKey || null,
              entered_by: req.user?.username || 'Admin',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              date: paymentDate.toISOString()
            };

            currentDb.fees.push(newFee);
            // Persist payment and any provider-backed notification queue entries atomically in one snapshot.
            triggerNotifications(currentDb, student, 'FeeSuccess', { receiptNo, amount: newFee.amount, month: newFee.month });
            writeDbRaw(currentDb);
            newFee.whatsapp=await sendFeeWhatsAppAfterPayment(student,newFee);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newFee));
          });
        }

        // PUT /api/fees (Edit Fee Record - Admin Only)
        if (reqPath === '/api/fees' && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Only Admin can edit fee payments.' }));
            }
            const data = req.body || {};
            if (!data.id) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee ID is required for update.' }));
            }

            const idx = (db.fees || []).findIndex(f => matchTenant(f, activeSchool.id) && (f.id === data.id || f.receiptNo === data.receiptNo));
            if (idx === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee transaction not found.' }));
            }

            const oldRecord = { ...db.fees[idx] };
            if (oldRecord.status === 'Refunded') {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Refunded fee payments cannot be edited.' }));
            }
            const student = (db.students || []).find(item =>
              matchTenant(item, activeSchool.id) &&
              normalizeFeeStudentId(item.admissionNo || item.studentId || item.id) ===
              normalizeFeeStudentId(oldRecord.student_id || oldRecord.studentId)
            );
            if (!student) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'The payment is linked to a missing student and cannot be edited.' }));
            }
            const amount = Number(data.amount);
            const lateFee = data.lateFee === undefined ? Number(oldRecord.lateFee || 0) : Number(data.lateFee);
            if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(lateFee) || lateFee < 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Updated payment must be greater than zero and fine cannot be negative.' }));
            }
            const invoice = calculateFeeInvoice(db, student, {
              session: oldRecord.academic_session || oldRecord.session,
              month: oldRecord.billing_month || oldRecord.month,
              type: oldRecord.fee_type || oldRecord.type,
              customFeeAmount: oldRecord.expectedAmount || oldRecord.grossAmount,
              discountAmount: oldRecord.discountAmount,
              scholarshipAmount: oldRecord.scholarshipAmount,
              excludeFeeId: oldRecord.id
            });
            if (amount > invoice.remainingBalance + 0.001) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Updated payment exceeds the available invoice balance of ₹${invoice.remainingBalance.toFixed(2)}.` }));
            }
            db.fees[idx] = {
              ...db.fees[idx],
              ...data,
              amount,
              paidAmount: amount,
              appliedAmount: amount,
              advanceAmount: 0,
              lateFee,
              totalReceived: amount + lateFee,
              cumulativePaid: invoice.paidAmount + amount,
              dueBalance: Math.max(0, invoice.remainingBalance - amount),
              paymentStatus: invoice.remainingBalance - amount <= 0 ? 'Paid' : 'Partially Paid',
              updated_at: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };

            // Write Audit Log
            if (!db.feeAuditLogs) db.feeAuditLogs = [];
            db.feeAuditLogs.push({
              id: 'audit_' + Date.now(),
              school_id: activeSchool.id,
              action: 'EDIT_FEE',
              receiptNo: db.fees[idx].receiptNo,
              studentId: db.fees[idx].studentId,
              oldAmount: oldRecord.amount,
              newAmount: db.fees[idx].amount,
              timestamp: new Date().toISOString(),
              adminUser: 'Admin'
            });

            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(db.fees[idx]));
          });
        }

        // POST /api/fees/refunds (auditable full payment reversal)
        if (reqPath === '/api/fees/refunds' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Only Admin can refund a fee payment.' }));
            }
            const feeId = String(req.body?.feeId || req.body?.id || '').trim();
            const receiptNo = String(req.body?.receiptNo || '').trim();
            const reason = String(req.body?.reason || '').trim();
            if ((!feeId && !receiptNo) || reason.length < 3) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee ID/receipt number and a refund reason are required.' }));
            }
            const payment = (db.fees || []).find(item => matchTenant(item, activeSchool.id) && (item.id === feeId || item.receiptNo === receiptNo));
            if (!payment) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee payment was not found.' }));
            }
            if (payment.status === 'Refunded' || payment.refunded_at) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Receipt ${payment.receiptNo} has already been refunded.` }));
            }
            const now = new Date().toISOString();
            const refund = {
              id: 'refund_' + crypto.randomUUID(),
              school_id: activeSchool.id,
              fee_id: payment.id,
              receiptNo: payment.receiptNo,
              student_id: payment.student_id || payment.studentId,
              amount: Number(payment.amount || 0),
              fineAmount: Number(payment.lateFee || 0),
              totalRefunded: Number(payment.totalReceived ?? (Number(payment.amount || 0) + Number(payment.lateFee || 0))),
              reason,
              refunded_by: req.user?.username || req.user?.id || 'Admin',
              created_at: now,
              updated_at: now
            };
            if (!db.feeRefunds) db.feeRefunds = [];
            if (!db.feeAuditLogs) db.feeAuditLogs = [];
            db.feeRefunds.push(refund);
            payment.status = 'Refunded';
            payment.refund_id = refund.id;
            payment.refunded_at = now;
            payment.refundReason = reason;
            payment.updated_at = now;
            db.feeAuditLogs.push({
              id: 'audit_' + crypto.randomUUID(), school_id: activeSchool.id, action: 'REFUND_FEE', receiptNo: payment.receiptNo,
              studentId: payment.student_id || payment.studentId, amount: refund.totalRefunded,
              reason, timestamp: now, adminUser: refund.refunded_by
            });
            writeDbRaw(db);
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Fee payment refunded successfully.', refund, payment }));
          });
        }
        // DELETE /api/fees (Delete / Refund Fee Record - Admin Only)
        if (reqPath === '/api/fees' && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'Admin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Only Admin can delete fee payments.' }));
            }
            if (db.settings?.feePermissions?.allowDelete === false) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee deletion is disabled by the school fee permissions policy.' }));
            }
            const feeId = parsedUrl.query.id;
            const receiptNo = parsedUrl.query.receiptNo;
            if (!feeId && !receiptNo) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee ID or receiptNo required.' }));
            }

            const idx = (db.fees || []).findIndex(f => matchTenant(f, activeSchool.id) && (f.id === feeId || f.receiptNo === receiptNo));
            if (idx === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Fee record not found.' }));
            }

            const deletedRecord = db.fees.splice(idx, 1)[0];

            // Write Audit Log
            if (!db.feeAuditLogs) db.feeAuditLogs = [];
            db.feeAuditLogs.push({
              id: 'audit_' + Date.now(),
              school_id: activeSchool.id,
              action: 'REFUND_DELETE_FEE',
              receiptNo: deletedRecord.receiptNo,
              studentId: deletedRecord.studentId,
              amount: deletedRecord.amount,
              timestamp: new Date().toISOString(),
              adminUser: 'Admin'
            });

            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ message: 'Fee record deleted/refunded successfully.', deletedRecord }));
          });
        }

        // ================= TEACHER WORKLOAD ASSIGNMENTS ENDPOINTS =================
        // GET /api/teacher-assignments (Allows both Admin & Teacher authentication)
        if (reqPath === '/api/teacher-assignments' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const teacherId = parsedUrl.query ? parsedUrl.query.teacher_id || parsedUrl.query.empId : null;

            if (!Array.isArray(db.teacherAssignments)) {
              db.teacherAssignments = (db.teachers || []).map((t, idx) => {
                const clsStr = t.classTeacher && t.classTeacher !== 'None' ? t.classTeacher : 'Class V-A';
                const parts = clsStr.split('-');
                return {
                  id: 'ASN-' + (Date.now() + idx),
                  school_id: t.school_id || activeSchool.id,
                  teacher_id: t.empId,
                  teacher_name: t.name,
                  class_name: parts[0] || 'Class V',
                  section: parts[1] || 'A',
                  subject_name: t.subject || 'Mathematics',
                  academic_session: currentAcademicSession(db),
                  is_class_teacher: t.classTeacher !== 'None',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
              });
              writeDbRaw(db);
            }

            let list = (db.teacherAssignments || []).filter(a => matchTenant(a, activeSchool.id));
            const activeTeacherEmpIds = new Set(
              (db.teachers || [])
                .filter(t => {
                  if (!matchTenant(t, activeSchool.id)) return false;
                  const st = (t.status || 'Active').toLowerCase();
                  return st !== 'deleted' && st !== 'inactive' && st !== 'archived';
                })
                .map(t => t.empId)
            );
            list = list.filter(a => activeTeacherEmpIds.has(a.teacher_id || a.teacherId));

            if (teacherId) {
              list = list.filter(a => a.teacher_id === teacherId || a.teacherId === teacherId);
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/teacher-assignments (Create assignment with duplicate check)
        if (reqPath === '/api/teacher-assignments' && method === 'POST') {
          return handleAdminRoute(() => {
            const { teacher_id, class_name, section, subject_name, academic_session, is_class_teacher } = req.body || {};
            
            if (!teacher_id || !class_name || !section || !subject_name) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'teacher_id, class_name, section, and subject_name are required.' }));
            }

            const sess = academic_session || currentAcademicSession(db);
            const normalizedClass = normalizeClassName(class_name);
            const normalizedSection = normalizeSectionName(section);
            if (!normalizedClass || !normalizedSection) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A valid class and section are required.' }));
            }
            const teacher = (db.teachers || []).find(t => t.empId === teacher_id || t.id === teacher_id);
            const teacher_name = teacher ? teacher.name : teacher_id;

            if (!db.teacherAssignments) db.teacherAssignments = [];

            // Duplicate check: Same teacher, class, section, subject, session
            const isDuplicate = db.teacherAssignments.some(a => 
              a.teacher_id === teacher_id &&
              normalizeClassName(a.class_name) === normalizedClass &&
              normalizeSectionName(a.section) === normalizedSection &&
              a.subject_name.toLowerCase().trim() === subject_name.toLowerCase().trim() &&
              a.academic_session === sess
            );

            if (isDuplicate) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Assignment already exists for ${teacher_name} in ${class_name} Sec ${section} (${subject_name}) for session ${sess}.` }));
            }

            const newAssignment = {
              id: 'ASN-' + Date.now(),
              teacher_id,
              teacher_name,
              class_name: normalizedClass,
              section: normalizedSection,
              subject_name,
              academic_session: sess,
              is_class_teacher: !!is_class_teacher,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            db.teacherAssignments.push(newAssignment);

            // Sync teacher record primary fields for backwards compatibility
            if (teacher) {
              teacher.subject = subject_name;
              teacher.assignedSubjects = [...new Set([
                ...(teacher.assignedSubjects || []),
                subject_name
              ])];
              teacher.assignedClasses = [...new Set([
                ...(teacher.assignedClasses || []),
                `${normalizedClass}-${normalizedSection}`
              ])];
              if (is_class_teacher) {
                teacher.classTeacher = `${normalizedClass}-${normalizedSection}`;
              }
            }

            writeDbRaw(db);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newAssignment));
          });
        }

        // PUT /api/teacher-assignments/teacher/:teacherId (Bulk replace assignments for a teacher)
        if (reqPath.startsWith('/api/teacher-assignments/teacher/') && method === 'PUT') {
          return handleAdminRoute(() => {
            const teacherId = reqPath.substring('/api/teacher-assignments/teacher/'.length);
            const { assignments } = req.body || {};

            if (!Array.isArray(assignments)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'assignments array is required.' }));
            }
            const duplicateKeys = new Set();
            for (const asn of assignments) {
              if (!asn || !asn.class_name || !asn.section || !asn.subject_name) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Every assignment requires class_name, section, and subject_name.' }));
              }
              const key = [
                normalizeClassName(asn.class_name).toLowerCase(),
                normalizeSectionName(asn.section).toLowerCase(),
                String(asn.subject_name).trim().toLowerCase(),
                asn.academic_session || currentAcademicSession(db)
              ].join('|');
              if (duplicateKeys.has(key)) {
                res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Duplicate class, section, and subject assignment detected.' }));
              }
              duplicateKeys.add(key);
            }

            if (!db.teacherAssignments) db.teacherAssignments = [];

            const teacher = (db.teachers || []).find(t => t.empId === teacherId || t.id === teacherId);
            const teacher_name = teacher ? teacher.name : teacherId;

            // Filter out existing assignments for this teacher
            db.teacherAssignments = db.teacherAssignments.filter(a => a.teacher_id !== teacherId);

            let addedList = [];
            let primaryClassTeacher = 'None';
            let primarySubject = teacher ? teacher.subject : 'General';

            assignments.forEach((asn, idx) => {
              const sess = asn.academic_session || currentAcademicSession(db);
              const item = {
                id: 'ASN-' + (Date.now() + idx),
                teacher_id: teacherId,
                teacher_name,
                class_name: normalizeClassName(asn.class_name),
                section: normalizeSectionName(asn.section),
                subject_name: asn.subject_name,
                academic_session: sess,
                is_class_teacher: !!asn.is_class_teacher,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              db.teacherAssignments.push(item);
              addedList.push(item);

              if (asn.is_class_teacher) {
                primaryClassTeacher = `${normalizeClassName(asn.class_name)}-${normalizeSectionName(asn.section)}`;
              }
              if (idx === 0) {
                primarySubject = asn.subject_name;
              }
            });

            if (teacher) {
              teacher.subject = primarySubject;
              teacher.classTeacher = primaryClassTeacher;
              teacher.assignedSubjects = [...new Set(addedList.map(a => a.subject_name))];
              teacher.assignedClasses = [...new Set(addedList.map(a => `${a.class_name}-${a.section}`))];
            }

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, count: addedList.length, assignments: addedList }));
          });
        }

        // DELETE /api/teacher-assignments/:id (Delete single assignment)
        if (reqPath.startsWith('/api/teacher-assignments/') && method === 'DELETE') {
          return handleAdminRoute(() => {
            const id = reqPath.substring('/api/teacher-assignments/'.length);
            if (!db.teacherAssignments) db.teacherAssignments = [];

            const idx = db.teacherAssignments.findIndex(a => a.id === id);
            if (idx === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Assignment record not found.' }));
            }

            const deleted = db.teacherAssignments.splice(idx, 1)[0];
            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Assignment tag removed.', deleted }));
          });
        }

        // ================= SUBJECT MANAGEMENT ENDPOINTS =================
        // GET /api/subjects (Allows both Admin & Teacher authentication)
        if (reqPath === '/api/subjects' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const className = parsedUrl.query ? parsedUrl.query.className : null;
            const section = parsedUrl.query ? parsedUrl.query.section : null;
            const examType = parsedUrl.query ? parsedUrl.query.examType : null;
            const session = parsedUrl.query ? parsedUrl.query.session : null;

            let list = (db.subjects || []).filter(s => matchTenant(s, activeSchool.id));
            if (className && className !== 'All Classes') {
              const requestedClass = normalizeClassName(className);
              list = list.filter(subject =>
                normalizeSubjectClassName(subject.className) === 'All Classes' ||
                normalizeSubjectClassName(subject.className) === requestedClass
              );
            }
            if (section && section !== 'All Sections') {
              const requestedSection = normalizeSectionName(section);
              list = list.filter(subject =>
                normalizeSectionName(subject.section) === 'All Sections' ||
                normalizeSectionName(subject.section) === requestedSection
              );
            }
            if (examType && examType !== 'All Exams') {
              const requestedExam = normalizeExamTypeKey(examType);
              list = list.filter(subject =>
                normalizeExamTypeKey(subject.examType) === 'all' ||
                normalizeExamTypeKey(subject.examType) === requestedExam
              );
            }
            if (session) {
              list = list.filter(subject =>
                String(subject.session || currentAcademicSession(db, activeSchool.id)).trim() === String(session).trim()
              );
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // GET /api/subjects/:id (Read one subject for Edit)
        if (reqPath.startsWith('/api/subjects/') && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const id = decodeURIComponent(reqPath.substring('/api/subjects/'.length));
            const subject = (db.subjects || []).find(item => item.id === id && matchTenant(item, activeSchool.id));
            if (!subject) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Subject not found.' }));
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(subject));
          });
        }

        // POST /api/subjects (Create Subject)
        if (reqPath === '/api/subjects' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const { name, code, className, section, examType, session, maxMarks, passMarks, teacherId } = req.body || {};

            const cleanName = String(name || '').trim();
            const cleanCode = String(code || '').trim();
            const clsStr = normalizeSubjectClassName(className);
            const secStr = normalizeSectionName(section);
            const exmStr = String(examType || '').trim();
            const sessStr = String(session || '').trim();
            const teacherRef = String(teacherId || 'Unassigned').trim();
            const max = Number(maxMarks);
            const pass = Number(passMarks);

            if (!cleanName || !cleanCode || !clsStr || !secStr || !exmStr || !sessStr) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Subject Name, Subject Code, Class, Section, Exam Type, and Academic Session are required.' }));
            }
            if (!Number.isFinite(max) || max <= 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Maximum Marks must be greater than zero.' }));
            }
            if (!Number.isFinite(pass) || pass < 0 || pass > max) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Pass Marks must be between 0 and Maximum Marks.' }));
            }

            if (!db.subjects) db.subjects = [];
            const normalize = value => String(value || '').trim().toLowerCase();

            if (db.subjects.some(subject => matchTenant(subject, activeSchool.id) && normalize(subject.code) === normalize(cleanCode))) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Subject Code "${cleanCode}" already exists.` }));
            }
            const isDuplicateName = db.subjects.some(subject =>
              matchTenant(subject, activeSchool.id) &&
              normalize(subject.name) === normalize(cleanName) &&
              normalize(subject.className) === normalize(clsStr) &&
              normalize(subject.section) === normalize(secStr) &&
              normalize(subject.examType) === normalize(exmStr) &&
              normalize(subject.session) === normalize(sessStr)
            );
            if (isDuplicateName) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Subject "${cleanName}" already exists for the selected Class, Section, Exam Type, and Academic Session.` }));
            }

            let teacherName = 'Unassigned';
            if (teacherRef !== 'Unassigned') {
              const teacher = (db.teachers || []).find(item => matchTenant(item, activeSchool.id) && (item.empId === teacherRef || item.id === teacherRef));
              if (!teacher) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Assigned Teacher was not found.' }));
              }
              teacherName = teacher.name;
            }

            const newSubject = {
              id: 'SBJ-' + Date.now(),
              school_id: activeSchool.id,
              name: cleanName,
              code: cleanCode,
              className: clsStr,
              section: secStr,
              examType: exmStr,
              session: sessStr,
              maxMarks: max,
              passMarks: pass,
              teacherId: teacherRef,
              teacherName,
              createdAt: new Date().toISOString()
            };

            db.subjects.push(newSubject);

            // Keep teacher workload data synchronized with the subject master.
            if (teacherRef !== 'Unassigned') {
              const teacher = (db.teachers || []).find(item => matchTenant(item, activeSchool.id) && (item.empId === teacherRef || item.id === teacherRef));
              if (teacher) {
                teacher.assignedSubjects = [...new Set([...(teacher.assignedSubjects || []), cleanName])];
                if (!teacher.subject || teacher.subject === 'General') teacher.subject = cleanName;
              }
              if (clsStr !== 'All Classes' && secStr !== 'All Sections') {
                if (!Array.isArray(db.teacherAssignments)) db.teacherAssignments = [];
                db.teacherAssignments.push({
                  id: 'ASN-' + Date.now(),
                  school_id: activeSchool.id,
                  subjectId: newSubject.id,
                  teacher_id: teacherRef,
                  teacher_name: teacherName,
                  class_name: clsStr,
                  section: secStr,
                  subject_name: cleanName,
                  academic_session: sessStr,
                  is_class_teacher: false,
                  created_at: new Date().toISOString()
                });
              }
            }
            writeDbRaw(db);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newSubject));
          });
        }

        // PUT /api/subjects/:id (Edit Subject)
        if (reqPath.startsWith('/api/subjects/') && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            const id = decodeURIComponent(reqPath.substring('/api/subjects/'.length));
            const data = req.body || {};
            if (!db.subjects) db.subjects = [];

            const idx = db.subjects.findIndex(s => s.id === id && matchTenant(s, activeSchool.id));
            if (idx === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Subject not found.' }));
            }

            const oldName = db.subjects[idx].name;
            const oldTeacherRef = db.subjects[idx].teacherId || 'Unassigned';
            const newName = String(data.name ?? oldName ?? '').trim();
            const cleanCode = String(data.code ?? db.subjects[idx].code ?? '').trim();
            const clsStr = normalizeSubjectClassName(data.className ?? db.subjects[idx].className);
            const secStr = normalizeSectionName(data.section ?? db.subjects[idx].section);
            const exmStr = String(data.examType ?? db.subjects[idx].examType ?? '').trim();
            const sessStr = String(data.session ?? db.subjects[idx].session ?? '').trim();
            const teacherRef = String(data.teacherId ?? db.subjects[idx].teacherId ?? 'Unassigned').trim();
            const max = Number(data.maxMarks ?? db.subjects[idx].maxMarks);
            const pass = Number(data.passMarks ?? db.subjects[idx].passMarks);
            const normalize = value => String(value || '').trim().toLowerCase();

            if (!newName || !cleanCode || !clsStr || !secStr || !exmStr || !sessStr) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Subject Name, Subject Code, Class, Section, Exam Type, and Academic Session are required.' }));
            }
            if (!Number.isFinite(max) || max <= 0) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Maximum Marks must be greater than zero.' }));
            }
            if (!Number.isFinite(pass) || pass < 0 || pass > max) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Pass Marks must be between 0 and Maximum Marks.' }));
            }
            if (db.subjects.some(subject => matchTenant(subject, activeSchool.id) && subject.id !== id && normalize(subject.code) === normalize(cleanCode))) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Subject Code "${cleanCode}" already exists.` }));
            }
            const isDuplicateName = db.subjects.some(subject =>
              matchTenant(subject, activeSchool.id) &&
              subject.id !== id &&
              normalize(subject.name) === normalize(newName) &&
              normalize(subject.className) === normalize(clsStr) &&
              normalize(subject.section) === normalize(secStr) &&
              normalize(subject.examType) === normalize(exmStr) &&
              normalize(subject.session) === normalize(sessStr)
            );
            if (isDuplicateName) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Subject "${newName}" already exists for the selected Class, Section, Exam Type, and Academic Session.` }));
            }

            let teacherName = 'Unassigned';
            if (teacherRef !== 'Unassigned') {
              const teacher = (db.teachers || []).find(item => matchTenant(item, activeSchool.id) && (item.empId === teacherRef || item.id === teacherRef));
              if (!teacher) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'Assigned Teacher was not found.' }));
              }
              teacherName = teacher.name;
            }

            db.subjects[idx] = {
              ...db.subjects[idx],
              ...data,
              school_id: activeSchool.id,
              name: newName,
              code: cleanCode,
              className: clsStr,
              section: secStr,
              examType: exmStr,
              session: sessStr,
              maxMarks: max,
              passMarks: pass,
              teacherId: teacherRef,
              teacherName,
              updatedAt: new Date().toISOString()
            };

            // Propagate subject identity to every live and historical consumer within this school.
            if (oldName && oldName !== newName) {
              (db.teachers || []).filter(t => matchTenant(t, activeSchool.id)).forEach(t => {
                if (t.subject === oldName) t.subject = newName;
                t.assignedSubjects = (t.assignedSubjects || []).map(subjectName =>
                  normalize(subjectName) === normalize(oldName) ? newName : subjectName
                );
              });
              (db.exams || []).filter(e => matchTenant(e, activeSchool.id)).forEach(e => {
                if (normalize(e.subject) === normalize(oldName)) e.subject = newName;
              });
              (db.examResults || []).filter(result => matchTenant(result, activeSchool.id)).forEach(result => {
                if (normalize(result.subject) === normalize(oldName)) result.subject = newName;
              });
              (db.teacherAssignments || []).filter(assignment => matchTenant(assignment, activeSchool.id)).forEach(assignment => {
                if (normalize(assignment.subject_name) === normalize(oldName)) assignment.subject_name = newName;
              });
            }

            if (oldTeacherRef !== teacherRef && oldTeacherRef !== 'Unassigned') {
              const oldTeacher = (db.teachers || []).find(item => matchTenant(item, activeSchool.id) && (item.empId === oldTeacherRef || item.id === oldTeacherRef));
              if (oldTeacher) {
                const stillAssigned = db.subjects.some(subject =>
                  matchTenant(subject, activeSchool.id) &&
                  subject.id !== id &&
                  subject.teacherId === oldTeacherRef &&
                  normalize(subject.name) === normalize(oldName)
                );
                if (!stillAssigned) {
                  oldTeacher.assignedSubjects = (oldTeacher.assignedSubjects || []).filter(subjectName =>
                    normalize(subjectName) !== normalize(oldName)
                  );
                  if (normalize(oldTeacher.subject) === normalize(oldName)) {
                    oldTeacher.subject = oldTeacher.assignedSubjects[0] || 'General';
                  }
                }
              }
            }

            if (!Array.isArray(db.teacherAssignments)) db.teacherAssignments = [];
            const linkedAssignmentIdx = db.teacherAssignments.findIndex(assignment => matchTenant(assignment, activeSchool.id) && assignment.subjectId === id);
            if (teacherRef !== 'Unassigned') {
              const teacher = (db.teachers || []).find(item => matchTenant(item, activeSchool.id) && (item.empId === teacherRef || item.id === teacherRef));
              if (teacher) {
                teacher.assignedSubjects = [...new Set([...(teacher.assignedSubjects || []), newName])];
                if (!teacher.subject || teacher.subject === 'General') teacher.subject = newName;
              }

              if (clsStr !== 'All Classes' && secStr !== 'All Sections') {
                const linkedAssignment = {
                  id: linkedAssignmentIdx === -1 ? 'ASN-' + Date.now() : db.teacherAssignments[linkedAssignmentIdx].id,
                  school_id: activeSchool.id,
                  subjectId: id,
                  teacher_id: teacherRef,
                  teacher_name: teacherName,
                  class_name: clsStr,
                  section: secStr,
                  subject_name: newName,
                  academic_session: sessStr,
                  is_class_teacher: linkedAssignmentIdx === -1 ? false : Boolean(db.teacherAssignments[linkedAssignmentIdx].is_class_teacher),
                  updated_at: new Date().toISOString()
                };
                if (linkedAssignmentIdx === -1) db.teacherAssignments.push(linkedAssignment);
                else db.teacherAssignments[linkedAssignmentIdx] = { ...db.teacherAssignments[linkedAssignmentIdx], ...linkedAssignment };
              } else if (linkedAssignmentIdx !== -1) {
                db.teacherAssignments.splice(linkedAssignmentIdx, 1);
              }
            } else if (linkedAssignmentIdx !== -1) {
              db.teacherAssignments.splice(linkedAssignmentIdx, 1);
            }

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(db.subjects[idx]));
          });
        }

        // DELETE /api/subjects/:id (Delete Subject)
        if (reqPath.startsWith('/api/subjects/') && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            const id = decodeURIComponent(reqPath.substring('/api/subjects/'.length));
            if (!db.subjects) db.subjects = [];

            const idx = db.subjects.findIndex(s => s.id === id && matchTenant(s, activeSchool.id));
            if (idx === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Subject not found.' }));
            }

            const deletedSubject = db.subjects.splice(idx, 1)[0];
            if (Array.isArray(db.teacherAssignments)) {
              db.teacherAssignments = db.teacherAssignments.filter(assignment => !(assignment.subjectId === id && matchTenant(assignment, activeSchool.id)));
            }

            // Remove stale workload references only when no remaining subject
            // master record uses the deleted name in this school. Historical exam/results
            // remain untouched so report-card history is preserved.
            const normalize = value => String(value || '').trim().toLowerCase();
            const subjectNameStillExists = db.subjects.some(subject =>
              matchTenant(subject, activeSchool.id) &&
              normalize(subject.name) === normalize(deletedSubject.name)
            );
            if (!subjectNameStillExists && Array.isArray(db.teacherAssignments)) {
              db.teacherAssignments = db.teacherAssignments.filter(assignment =>
                !(matchTenant(assignment, activeSchool.id) && normalize(assignment.subject_name) === normalize(deletedSubject.name))
              );
            }
            if (!subjectNameStillExists) {
              (db.teachers || []).forEach(teacher => {
                teacher.assignedSubjects = (teacher.assignedSubjects || []).filter(subjectName =>
                  normalize(subjectName) !== normalize(deletedSubject.name)
                );
                if (normalize(teacher.subject) === normalize(deletedSubject.name)) {
                  teacher.subject = teacher.assignedSubjects[0] || 'General';
                }
              });
            }
            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: `Subject "${deletedSubject.name}" deleted successfully.` }));
          });
        }

        // GET /api/exams (Allows both Admin & Teacher authentication)
        if (reqPath === '/api/exams' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const name = parsedUrl.query ? parsedUrl.query.name || parsedUrl.query.examName : null;
            const className = parsedUrl.query ? parsedUrl.query.className : null;
            const section = parsedUrl.query ? parsedUrl.query.section : null;
            const subject = parsedUrl.query ? parsedUrl.query.subject : null;
            const sessionId = parsedUrl.query ? parsedUrl.query.academic_session_id : null;
            const sessionRecord = sessionId ? (db.academicSessions || []).find(item => String(item.id) === String(sessionId)) : null;
            const session = sessionRecord?.session_name || (parsedUrl.query ? (parsedUrl.query.session || parsedUrl.query.academic_session) : null);

            let list = groupedExamsFromCentral(db).filter(e => matchTenant(e, activeSchool.id));
            if (name) {
              list = list.filter(e => normalizeExamTypeKey(e.name || e.examName) === normalizeExamTypeKey(name));
            }
            if (className) {
              const cleanCls = normalizeClassName(className);
              list = list.filter(e => normalizeClassName(e.className) === cleanCls);
            }
            if (section) {
              list = list.filter(e => normalizeSectionName(e.section) === normalizeSectionName(section));
            }
            if (subject) {
              list = list.filter(e => normalizeSubjectKey(e.subject) === normalizeSubjectKey(subject));
            }
            if (session) {
              list = list.filter(e => normalizeAcademicSession(e.session, db) === normalizeAcademicSession(session, db));
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // GET /api/exam-results (Returns central exam_results list)
        if (reqPath === '/api/exam-results' && method === 'GET') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const studentId = parsedUrl.query ? parsedUrl.query.studentId || parsedUrl.query.admissionNo : null;
            const className = parsedUrl.query ? parsedUrl.query.className : null;
            const examName = parsedUrl.query ? parsedUrl.query.examName || parsedUrl.query.name : null;
            const section = parsedUrl.query ? parsedUrl.query.section || parsedUrl.query.section_id : null;
            const subjectId = parsedUrl.query ? parsedUrl.query.subjectId || parsedUrl.query.subject_id : null;
            const subject = parsedUrl.query ? parsedUrl.query.subject || parsedUrl.query.subjectName : null;
            const session = parsedUrl.query ? parsedUrl.query.session || parsedUrl.query.academic_session : null;

            let list = ensureCentralExamResults(db).filter(r => matchTenant(r, activeSchool.id));
            if (studentId) list = list.filter(r => (r.student_id || r.studentId || r.admissionNo) === studentId);
            if (className) {
              const cleanCls = normalizeClassName(className);
              list = list.filter(r => normalizeClassName(r.class_id || r.className) === cleanCls);
            }
            if (section) list = list.filter(r => normalizeSectionName(r.section_id || r.section) === normalizeSectionName(section));
            if (subjectId) list = list.filter(r => String(r.subject_id || r.subjectId) === String(subjectId));
            if (subject) list = list.filter(r => normalizeSubjectKey(r.subject_name || r.subject) === normalizeSubjectKey(subject));
            if (examName) list = list.filter(r => normalizeExamTypeKey(r.exam_term || r.examName) === normalizeExamTypeKey(examName));
            if (session) list = list.filter(r => normalizeAcademicSession(r.academic_session || r.session, db) === normalizeAcademicSession(session, db));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(list));
          });
        }

        // POST /api/exams (Add/Update Exam Score Sheet - Allows both Admin & Teacher)
        if (reqPath === '/api/exams' && method === 'POST') {
          return handleAnyAuthRoute((db, activeSchool) => {
            const { name, examName, exam_id, examId, date, className, class_id, section, section_id, subject, subject_name, subject_id, subjectId, session, academic_session, status, marks, teacherId } = req.body || {};
            const eName = name || examName;
            const requestedSubjectId = subject_id || subjectId;
            const requestedSubjectName = subject_name || subject;
            const requestedClass = normalizeClassName(class_id || className);
            const requestedSection = normalizeSectionName(section_id || section || 'A');
            
            if (!eName || !requestedClass || (!requestedSubjectId && !requestedSubjectName) || !marks || !Array.isArray(marks)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'examName, className, subject, and marks array are required.' }));
            }

            const normalize = value => String(value || '').trim().toLowerCase();
            let candidateSession = academic_session || session;
            if (!candidateSession && Array.isArray(marks) && marks.length) {
              const firstStudentId = marks[0].student_id || marks[0].studentId || marks[0].admissionNo;
              const firstStudent = (db.students || []).find(item => matchTenant(item, activeSchool.id) && (item.admissionNo || item.studentId || item.id) === firstStudentId);
              if (firstStudent) candidateSession = studentAcademicSession(firstStudent, db);
            }
            const requestedSession = normalizeAcademicSession(candidateSession, db, activeSchool.id);
            const subjectCandidates = (db.subjects || []).filter(item =>
              matchTenant(item, activeSchool.id) &&
              (
                (requestedSubjectId && String(item.id) === String(requestedSubjectId)) ||
                (requestedSubjectName && normalizeSubjectKey(item.name) === normalizeSubjectKey(requestedSubjectName))
              ) &&
              (normalizeSubjectClassName(item.className) === 'All Classes' || normalizeClassName(item.className) === requestedClass) &&
              (normalizeSectionName(item.section) === 'All Sections' || normalizeSectionName(item.section) === requestedSection) &&
              (normalizeExamTypeKey(item.examType) === 'all' || normalizeExamTypeKey(item.examType) === normalizeExamTypeKey(eName))
            );
            subjectCandidates.sort((a, b) => {
              const specificity = item =>
                (item.className !== 'All Classes' ? 4 : 0) +
                (item.section !== 'All Sections' ? 2 : 0) +
                (item.examType !== 'All Exams' ? 1 : 0);
              return specificity(b) - specificity(a);
            });
            const subjectConfig = subjectCandidates[0];
            if (!subjectConfig) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: `Subject "${requestedSubjectName || requestedSubjectId}" is not configured for ${requestedClass}-${requestedSection}, ${eName}, session ${requestedSession}.` }));
            }
            const canonicalSubjectId = subjectConfig.id;
            const canonicalSubjectName = subjectConfig.name;
            const canonicalExamId = String(exam_id || examId || normalizeExamTypeKey(eName));

            if (req.user?.role === 'Teacher') {
              const assignments = normalizeTeacherAssignments(db, req.user.empId);
              const assigned = assignments.some(assignment =>
                assignment.class_name === requestedClass &&
                (assignment.section === 'All Sections' || assignment.section === requestedSection) &&
                (
                  assignment.is_class_teacher ||
                  normalizeSubjectKey(assignment.subject_name) === normalizeSubjectKey(canonicalSubjectName) ||
                  normalizeSubjectKey(assignment.subject_name).includes(normalizeSubjectKey(canonicalSubjectName)) ||
                  normalizeSubjectKey(canonicalSubjectName).includes(normalizeSubjectKey(assignment.subject_name))
                ) &&
                normalizeAcademicSession(assignment.academic_session, db) === requestedSession
              );
              if (!assigned) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: 'This subject, class, section and session are not assigned to the logged-in teacher.' }));
              }
            }

            const configuredMaxMarks = Number(subjectConfig.maxMarks || 100);
            const configuredPassMarks = Number(subjectConfig.passMarks ?? 33);

            const eligibleStudentIds = (db.students || []).filter(student => matchTenant(student, activeSchool.id) && isStudentActive(student) && normalizeClassName(student.className || student.class_name) === requestedClass && (requestedSection === 'All Sections' || normalizeSectionName(student.section || student.section_name) === requestedSection) && normalizeAcademicSession(studentAcademicSession(student, db), db, activeSchool.id) === requestedSession).map(student => String(student.admissionNo || student.studentId || student.id));
            const submittedStudentIds = marks.map(item => String(item.student_id || item.studentId || item.admissionNo || ''));
            const teacherRosterMismatch = req.user?.role === 'Teacher' && (eligibleStudentIds.some(id => !submittedStudentIds.includes(id)) || submittedStudentIds.some(id => !eligibleStudentIds.includes(id)));
            if (!marks.length || new Set(submittedStudentIds).size !== submittedStudentIds.length || teacherRosterMismatch) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'The marks payload must contain exactly one record for every active student in the selected class, section, and session.' }));
            }

            // Validate marks range; absent students must persist null rather than zero.
            for (let item of marks) {
              const isAbsent = item.isAbsent === true || item.attendanceStatus === 'Absent' || item.attendance_status === 'Absent';
              const rawMarks = item.marksObtained !== undefined ? item.marksObtained : item.score;
              const ob = rawMarks === null || rawMarks === '' ? null : Number(rawMarks);
              if ((!isAbsent && (ob === null || !Number.isFinite(ob) || ob < 0 || ob > configuredMaxMarks)) || (isAbsent && rawMarks !== null && rawMarks !== '' && rawMarks !== undefined)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: isAbsent ? `Absent student ${item.name || item.studentId} must have null marks.` : `Invalid marks "${rawMarks}" for student ${item.name || item.studentId}. Marks must be between 0 and ${configuredMaxMarks}.` }));
              }
              const studentId = item.student_id || item.studentId || item.admissionNo;
              const student = (db.students || []).find(candidate =>
                matchTenant(candidate, activeSchool.id) &&
                (candidate.admissionNo || candidate.studentId || candidate.id) === studentId
              );
              if (!student || !isStudentActive(student) ||
                  normalizeClassName(student.className || student.class_name) !== requestedClass ||
                  (requestedSection !== 'All Sections' && normalizeSectionName(student.section || student.section_name) !== requestedSection) ||
                  normalizeAcademicSession(studentAcademicSession(student, db), db, activeSchool.id) !== requestedSession) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: `Student ${studentId || '(missing ID)'} is not an active student in ${requestedClass}-${requestedSection}, session ${requestedSession}.` }));
              }
            }

            if (!db.exams) db.exams = [];
            if (!db.examResults) db.examResults = [];

            const secStr = requestedSection;
            const sessStr = requestedSession;
            const cleanCls = requestedClass;

            // Normalize every mark item to guarantee BOTH score and marksObtained exist
            const normalizedMarks = marks.map(item => {
              const sid = item.studentId || item.admissionNo;
              const student = (db.students || []).find(candidate =>
                matchTenant(candidate, activeSchool.id) &&
                (candidate.admissionNo || candidate.studentId || candidate.id) === sid
              );
              const isAbsent = item.isAbsent === true || item.attendanceStatus === 'Absent' || item.attendance_status === 'Absent';
              const obt = isAbsent ? null : Number(item.marksObtained ?? item.score);
              const max = configuredMaxMarks;
              const pct = !isAbsent && max > 0 ? (obt / max) * 100 : 0;
              let grade = isAbsent ? 'ABSENT' : item.grade;
              if (!grade) {
                if (pct >= 90) grade = 'A+';
                else if (pct >= 80) grade = 'A';
                else if (pct >= 60) grade = 'B';
                else if (pct >= 40) grade = 'C';
                else grade = 'D';
              }

              return {
                ...item,
                studentId: sid,
                admissionNo: sid,
                name: item.name || '',
                rollNo: item.rollNo || '',
                marksObtained: obt,
                score: obt,
                isAbsent,
                attendanceStatus: isAbsent ? 'Absent' : 'Present',
                resultStatus: isAbsent ? 'ABSENT' : (item.resultStatus || (obt >= configuredPassMarks ? 'PASS' : 'FAIL')),
                remarks: item.remarks || item.remark || '',
                maxMarks: max,
                maxScore: max,
                passMarks: configuredPassMarks,
                grade,
                resolvedSection: secStr === 'All Sections'
                  ? normalizeSectionName(student?.section || student?.section_name)
                  : secStr
              };
            });

            // Find existing record for same exam name, class, section, subject & session
            const existingIdx = db.exams.findIndex(e => 
              matchTenant(e, activeSchool.id) &&
              (e.name === eName || e.examName === eName) && 
              normalizeClassName(e.className) === cleanCls &&
              (e.section || 'A') === secStr && 
              (e.subject_id === canonicalSubjectId || normalizeSubjectKey(e.subject) === normalizeSubjectKey(canonicalSubjectName)) &&
              (e.session || currentAcademicSession(db)) === sessStr
            );

            let examRecord;
            if (existingIdx !== -1) {
              // Update existing record
              db.exams[existingIdx] = {
                ...db.exams[existingIdx],
                school_id: activeSchool.id,
                name: eName,
                examName: eName,
                date: date || db.exams[existingIdx].date || new Date().toISOString().split('T')[0],
                className: cleanCls,
                section: secStr,
                session: sessStr,
                subject_id: canonicalSubjectId,
                subject: canonicalSubjectName,
                status: status || db.exams[existingIdx].status || 'Submitted',
                teacherId: req.user?.role === 'Teacher' ? req.user.empId : (teacherId || db.exams[existingIdx].teacherId),
                submittedBy: req.user ? (req.user.name || req.user.username || req.user.empId) : 'Teacher',
                submittedAt: new Date().toISOString(),
                marks: normalizedMarks
              };
              examRecord = db.exams[existingIdx];
            } else {
              // Create new record
              const id = 'EXM-' + Date.now();
              examRecord = { 
                id, 
                school_id: activeSchool.id,
                name: eName, 
                examName: eName, 
                date: date || new Date().toISOString().split('T')[0], 
                className: cleanCls, 
                section: secStr, 
                session: sessStr, 
                subject_id: canonicalSubjectId,
                subject: canonicalSubjectName,
                status: status || 'Submitted', 
                teacherId: req.user?.role === 'Teacher' ? req.user.empId : (teacherId || 'N/A'),
                submittedBy: req.user ? (req.user.name || req.user.username || req.user.empId) : 'Teacher',
                submittedAt: new Date().toISOString(),
                marks: normalizedMarks
              };
              db.exams.push(examRecord);
            }

            // Sync with central db.examResults flat table for instant lookup
            ensureCentralExamResults(db);
            const enteredByRole = req.user?.role === 'Teacher' ? 'teacher' : 'admin';
            const enteredById = req.user?.empId || req.user?.username || teacherId || 'admin';
            normalizedMarks.forEach(m => {
              const resultSection = m.resolvedSection || secStr;
              const identitySeed = { student_id: m.studentId, subject_id: canonicalSubjectId, exam_id: canonicalExamId, class_id: cleanCls, section_id: resultSection, academic_session: sessStr };
              const resultKey = examResultIdentity(identitySeed, db);
              const existingResIdx = db.examResults.findIndex(r => matchTenant(r, activeSchool.id) && examResultIdentity(r, db) === resultKey);
              const existing = existingResIdx >= 0 ? db.examResults[existingResIdx] : null;
              const now = new Date().toISOString();
              const resObj = {
                id: existing?.id || `EXM-RES-${crypto.createHash('sha1').update(resultKey).digest('hex').slice(0, 16)}`,
                school_id: activeSchool.id,
                student_id: m.studentId,
                studentId: m.studentId,
                admission_number: m.studentId,
                admissionNo: m.studentId,
                student_name: m.name,
                studentName: m.name,
                roll_number: m.rollNo,
                rollNo: m.rollNo,
                teacher_id: req.user?.role === 'Teacher' ? req.user.empId : (teacherId || existing?.teacher_id || null),
                subject_id: canonicalSubjectId,
                subjectId: canonicalSubjectId,
                subject_name: canonicalSubjectName,
                subject: canonicalSubjectName,
                exam_id: canonicalExamId,
                examId: canonicalExamId,
                exam_term: eName,
                examName: eName,
                class_id: cleanCls,
                className: cleanCls,
                section_id: resultSection,
                section: resultSection,
                academic_session: sessStr,
                academicSession: sessStr,
                session: sessStr,
                marks_obtained: m.marksObtained,
                marksObtained: m.marksObtained,
                score: m.score,
                maximum_marks: m.maxMarks,
                maxMarks: m.maxMarks,
                maxScore: m.maxScore,
                pass_marks: m.passMarks || configuredPassMarks,
                passMarks: m.passMarks || configuredPassMarks,
                grade: m.grade,
                result_status: m.resultStatus || (m.isAbsent ? 'ABSENT' : (m.marksObtained >= (m.passMarks || configuredPassMarks) ? 'PASS' : 'FAIL')),
                resultStatus: m.resultStatus || (m.isAbsent ? 'ABSENT' : (m.marksObtained >= (m.passMarks || 33) ? 'PASS' : 'FAIL')),
                attendance_status: m.attendanceStatus || (m.isAbsent ? 'Absent' : 'Present'),
                isAbsent: Boolean(m.isAbsent),
                remarks: m.remark || m.remarks || '',
                remark: m.remark || m.remarks || '',
                status: status || 'Submitted',
                entered_by_role: enteredByRole,
                entered_by_id: enteredById,
                entered_by: enteredById,
                submittedBy: enteredById,
                created_at: existing?.created_at || existing?.createdAt || now,
                updated_at: now,
                updatedAt: now
              };

              if (existingResIdx !== -1) {
                db.examResults[existingResIdx] = resObj;
              } else {
                db.examResults.push(resObj);
              }
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ...examRecord, message: status === 'Draft' ? 'Exam marks saved as draft.' : 'Exam marks submitted successfully.' }));
          });
        }

        // POST /api/notices (Create notice)
        if (reqPath === '/api/notices' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const notice = req.body;
            if (!notice.title || !notice.content) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Title and content are required.' }));
            }

            const newNotice = {
              id: String(Date.now()),
              school_id: activeSchool.id,
              date: new Date().toISOString().split('T')[0],
              title: notice.title,
              content: notice.content,
              target: notice.target || 'All',
              isUrgent: !!notice.isUrgent,
              academic_session: normalizeAcademicSession(notice.academic_session || notice.session, db)
            };

            if (!Array.isArray(db.notices)) db.notices = [];
            db.notices.unshift(newNotice);
            writeDbRaw(db);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newNotice));
          });
        }

        // DELETE /api/notices/:id
        if (reqPath.startsWith('/api/notices/') && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.substring(13);
            db.notices = (db.notices || []).filter(n => !(matchTenant(n, activeSchool.id) && n.id === id));
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true }));
          });
        }

        // POST /api/gallery (Upload Gallery Photo)
        if (reqPath === '/api/gallery' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const { title, image } = req.body; // base64 payload
            if (!title || !image) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'title and image are required.' }));
            }

            let imageUrl = '';
            if (image.startsWith('data:image')) {
              // Write base64 to file
              const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
              if (matches && matches.length === 3) {
                const ext = '.' + matches[1].split('/')[1];
                const base64Data = matches[2];
                const filename = 'gallery_' + Date.now() + ext;
                const uploadPath = path.join(UPLOADS_DIR, filename);
                fs.writeFileSync(uploadPath, Buffer.from(base64Data, 'base64'));
                imageUrl = '/uploads/' + filename;
              }
            } else {
              imageUrl = image; // use direct path if it's already a URL
            }

            const newPhoto = {
              id: String(Date.now()),
              school_id: activeSchool.id,
              title,
              image: imageUrl,
              date: new Date().toISOString().split('T')[0]
            };

            if (!Array.isArray(db.gallery)) db.gallery = [];
            db.gallery.unshift(newPhoto);
            writeDbRaw(db);

            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(newPhoto));
          });
        }

        // DELETE /api/gallery/:id
        if (reqPath.startsWith('/api/gallery/') && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            const id = reqPath.substring(13);
            const item = (db.gallery || []).find(g => matchTenant(g, activeSchool.id) && g.id === id);
            if (!item) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Gallery photo not found.' }));
            }
            if (item && item.image && item.image.startsWith('/uploads/')) {
              // Delete actual file
              const filePath = path.join(__dirname, 'public', item.image);
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
            }
            db.gallery = (db.gallery || []).filter(g => !(matchTenant(g, activeSchool.id) && g.id === id));
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true }));
          });
        }

        // POST /api/settings/id-card-signature (secure signature image upload)
        if (reqPath === '/api/settings/id-card-signature' && method === 'POST') {
          return handleAdminRoute(() => {
            if (req.user?.role !== 'PrintOperator') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Print Portal authentication required.' })); }
            try {
              const upload = decodeIdCardSignatureUpload(req.body);
              const fileName = `principal-signature-${crypto.randomUUID()}${upload.extension}`;
              const filePath = path.join(ID_CARD_SIGNATURES_DIR, fileName);
              const publicPath = `/uploads/id-card-signatures/${fileName}`;
              fs.writeFileSync(filePath, upload.bytes, { flag: 'wx', mode: 0o644 });
              const previousPath = db.settings.idCardSettings?.principalSignatureImage || '';
              try {
                db.settings.idCardSettings = { ...(db.settings.idCardSettings || {}), principalSignatureImage: publicPath };
                writeDbRaw(db);
              } catch (error) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                throw error;
              }
              removeOwnedIdCardSignature(previousPath);
              res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, principalSignatureImage: publicPath, idCardSettings: db.settings.idCardSettings }));
            } catch (error) {
              const validationError = /Only PNG|Please select|multipart field|boundary|image is empty|2 MB|does not match|corrupt|invalid dimensions/.test(error.message);
              console.error('ID Card signature upload failed:', error);
              res.writeHead(validationError ? 400 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: error.message || 'Unable to save the signature image.' }));
            }
          });
        }

        // DELETE /api/settings/id-card-signature
        if (reqPath === '/api/settings/id-card-signature' && method === 'DELETE') {
          return handleAdminRoute(() => {
            if (req.user?.role !== 'PrintOperator') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Print Portal authentication required.' })); }
            try {
              const previousPath = db.settings.idCardSettings?.principalSignatureImage || '';
              db.settings.idCardSettings = { ...(db.settings.idCardSettings || {}), principalSignatureImage: '' };
              writeDbRaw(db);
              removeOwnedIdCardSignature(previousPath);
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, principalSignatureImage: '', idCardSettings: db.settings.idCardSettings }));
            } catch (error) {
              console.error('ID Card signature deletion failed:', error);
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: error.message || 'Unable to remove the signature image.' }));
            }
          });
        }

        // ==============================================================
        // PRINT CENTER — ID CARD DESIGN STUDIO ENDPOINTS
        // ==============================================================

        // GET /api/print-center/id-card-templates
        if (reqPath === '/api/print-center/id-card-templates' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin' && req.user?.role !== 'Admin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Authorized Print Operator or Admin access required.' }));
            }
            if (!activeSchool) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School tenant context required.' }));
            }
            const templates = getSchoolBuiltinTemplates(activeSchool);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              templates,
              defaultTemplateId: activeSchool.defaultTemplateId || 'royal-blue'
            }));
          });
        }

        // GET /api/print-center/id-card-design
        if (reqPath === '/api/print-center/id-card-design' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin' && req.user?.role !== 'Admin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Authorized Print Operator or Admin access required.' }));
            }
            if (!activeSchool) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School tenant context required.' }));
            }

            ensurePrintCenterSchema(db);
            const design = activeSchool.idCardDesign || getDefaultIdCardDesign(activeSchool);
            const presets = activeSchool.idCardPresets || [];
            const templates = getSchoolBuiltinTemplates(activeSchool);
            const defaultTemplateId = activeSchool.defaultTemplateId || 'royal-blue';

            // Authorized students from this school for live preview dropdown
            const students = (db.students || [])
              .filter(s => matchTenant(s, activeSchool.id) && s.status !== 'Inactive' && s.status !== 'Deleted')
              .slice(0, 50)
              .map(s => ({
                id: s.id,
                name: s.name,
                admissionNo: s.admissionNo,
                className: s.className,
                section: s.section,
                rollNo: s.rollNo,
                photo: s.photo || '',
                fatherName: s.fatherName || '',
                dob: s.dob || '',
                bloodGroup: s.bloodGroup || '',
                mobile: s.mobile || ''
              }));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              success: true,
              schoolId: activeSchool.id,
              schoolName: activeSchool.name,
              schoolCode: activeSchool.code,
              logo: activeSchool.logo || (activeSchool.id === DEFAULT_SCHOOL_ID ? '/logo.jpg' : '/neutral-school-logo.svg'),
              design,
              presets,
              templates,
              defaultTemplateId,
              sampleStudents: students
            }));
          });
        }

        // PUT /api/print-center/id-card-design (Save Customized ID Card Design)
        if (reqPath === '/api/print-center/id-card-design' && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required to save design.' }));
            }
            if (!activeSchool) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School tenant context required.' }));
            }
            if (req.user.role !== 'SuperAdmin' && req.user.school_id && req.user.school_id !== activeSchool.id) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Cross-school design modification is strictly forbidden.' }));
            }

            const incoming = req.body?.design || req.body || {};
            const cleanDesign = {
              version: 2,
              templateId: String(incoming.templateId || incoming.layoutStyle || 'royal-blue'),
              layoutStyle: String(incoming.layoutStyle || incoming.templateId || 'royal-blue'),
              cardSize: {
                preset: incoming.cardSize?.preset || (incoming.cardSize?.orientation === 'landscape' ? 'CR80_LANDSCAPE' : 'CR80_PORTRAIT'),
                widthMm: Number(incoming.cardSize?.widthMm) || (incoming.cardSize?.orientation === 'landscape' ? 85.60 : 53.98),
                heightMm: Number(incoming.cardSize?.heightMm) || (incoming.cardSize?.orientation === 'landscape' ? 53.98 : 85.60),
                orientation: incoming.cardSize?.orientation === 'landscape' ? 'landscape' : 'portrait',
                safeMarginMm: Number(incoming.cardSize?.safeMarginMm) || 3
              },
              branding: {
                schoolName: String(incoming.branding?.schoolName ?? activeSchool.name),
                schoolNameFontSize: Number(incoming.branding?.schoolNameFontSize) || 30,
                schoolNameFontWeight: String(incoming.branding?.schoolNameFontWeight || '800'),
                schoolNameColor: String(incoming.branding?.schoolNameColor || '#ffffff'),
                cardHeading: String(incoming.branding?.cardHeading || 'STUDENT IDENTITY CARD'),
                cardHeadingFontSize: Number(incoming.branding?.cardHeadingFontSize) || 13,
                cardHeadingColor: String(incoming.branding?.cardHeadingColor || '#c99a35'),
                headerBgColor: String(incoming.branding?.headerBgColor || '#082f55'),
                headerBgColorEnd: String(incoming.branding?.headerBgColorEnd || '#041b31'),
                cardBgColor: String(incoming.branding?.cardBgColor || '#ffffff'),
                accentColor: String(incoming.branding?.accentColor || '#c99a35'),
                textColor: String(incoming.branding?.textColor || '#082f55'),
                fontFamily: String(incoming.branding?.fontFamily || 'Outfit, sans-serif'),
                headerStyle: String(incoming.branding?.headerStyle || 'gradient'),
                showLogo: incoming.branding?.showLogo !== false,
                logoSize: Number(incoming.branding?.logoSize) || 64,
                logoPosition: ['left', 'center', 'right'].includes(incoming.branding?.logoPosition) ? incoming.branding.logoPosition : 'center',
                logoX: Number(incoming.branding?.logoX) || 0,
                logoY: Number(incoming.branding?.logoY) || 0,
                schoolAddress: String(incoming.branding?.schoolAddress || ''),
                schoolPhone: String(incoming.branding?.schoolPhone || ''),
                schoolWebsite: String(incoming.branding?.schoolWebsite || '')
              },
              studentFields: {
                photoWidth: Number(incoming.studentFields?.photoWidth) || 196,
                photoHeight: Number(incoming.studentFields?.photoHeight) || 252,
                photoBorderRadius: Number(incoming.studentFields?.photoBorderRadius ?? 16),
                photoBorderColor: String(incoming.studentFields?.photoBorderColor || '#c99a35'),
                photoBorderWidth: Number(incoming.studentFields?.photoBorderWidth ?? 3),
                photoShadow: incoming.studentFields?.photoShadow !== false,
                photoX: Number(incoming.studentFields?.photoX) || 0,
                photoY: Number(incoming.studentFields?.photoY) || 0,
                nameFontSize: Number(incoming.studentFields?.nameFontSize) || 28,
                nameFontWeight: String(incoming.studentFields?.nameFontWeight || '800'),
                nameColor: String(incoming.studentFields?.nameColor || '#041b31'),
                nameX: Number(incoming.studentFields?.nameX) || 0,
                nameY: Number(incoming.studentFields?.nameY) || 0,
                fields: incoming.studentFields?.fields || getDefaultIdCardDesign(activeSchool).studentFields.fields,
                fieldFontSize: Number(incoming.studentFields?.fieldFontSize) || 13,
                labelFontSize: Number(incoming.studentFields?.labelFontSize) || 9,
                spacing: Number(incoming.studentFields?.spacing) || 8,
                alignment: incoming.studentFields?.alignment === 'center' ? 'center' : 'left',
                detailsX: Number(incoming.studentFields?.detailsX) || 0,
                detailsY: Number(incoming.studentFields?.detailsY) || 0
              },
              decorations: {
                showQrCode: !!incoming.decorations?.showQrCode,
                qrSize: Number(incoming.decorations?.qrSize) || 84,
                qrX: Number(incoming.decorations?.qrX) || 0,
                qrY: Number(incoming.decorations?.qrY) || 0,
                qrFormat: incoming.decorations?.qrFormat === 'barcode' ? 'barcode' : 'qr',
                watermark: String(incoming.decorations?.watermark || 'none'),
                accentStripe: incoming.decorations?.accentStripe !== false
              },
              signature: {
                showSignature: incoming.signature?.showSignature !== false,
                label: String(incoming.signature?.label || 'Principal Signature'),
                principalName: String(incoming.signature?.principalName ?? activeSchool.principalName ?? ''),
                principalSignatureImage: String(incoming.signature?.principalSignatureImage || activeSchool.idCardDesign?.signature?.principalSignatureImage || ''),
                signatureX: Number(incoming.signature?.signatureX) || 0,
                signatureY: Number(incoming.signature?.signatureY) || 0,
                alignment: ['left', 'center', 'right'].includes(incoming.signature?.alignment) ? incoming.signature.alignment : 'right'
              },
              backSide: {
                enabled: incoming.backSide?.enabled !== false,
                heading: String(incoming.backSide?.heading || 'RULES & INSTRUCTIONS'),
                terms: String(incoming.backSide?.terms || '1. This card is valid for the academic session specified.\n2. In case of loss, report immediately to the school office.\n3. This card is non-transferable and must be presented on demand.'),
                emergencyHelpline: String(incoming.backSide?.emergencyHelpline || activeSchool.phone || ''),
                returnAddress: String(incoming.backSide?.returnAddress || activeSchool.address || ''),
                showBarcode: !!incoming.backSide?.showBarcode,
                showQrCode: !!incoming.backSide?.showQrCode
              },
              updatedAt: new Date().toISOString()
            };

            activeSchool.idCardDesign = cleanDesign;
            if (activeSchool.id === DEFAULT_SCHOOL_ID) {
              db.settings.idCardDesign = cleanDesign;
            }

            ensurePrintCenterSchema(db);
            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: activeSchool.id,
              school_name: activeSchool.name,
              action: 'DESIGN_SAVED',
              performed_by: req.user.username || 'PrintOperator',
              role: req.user.role || 'PrintOperator',
              details: `Updated ID Card Design for ${activeSchool.name}. Template: ${cleanDesign.templateId}, Orientation: ${cleanDesign.cardSize.orientation}, Dimensions: ${cleanDesign.cardSize.widthMm}x${cleanDesign.cardSize.heightMm}mm`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'ID Card design saved successfully.', design: cleanDesign }));
          });
        }

        // POST /api/print-center/id-card-design/default-template (Set Preferred Default Template)
        if (reqPath === '/api/print-center/id-card-design/default-template' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required.' }));
            }
            if (!activeSchool) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School tenant context required.' }));
            }
            const templateId = String(req.body?.templateId || '').trim();
            if (!templateId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'templateId is required.' }));
            }
            activeSchool.defaultTemplateId = templateId;
            if (activeSchool.id === DEFAULT_SCHOOL_ID && db.settings) {
              db.settings.defaultIdCardTemplate = templateId;
            }
            ensurePrintCenterSchema(db);
            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: activeSchool.id,
              school_name: activeSchool.name,
              action: 'DEFAULT_TEMPLATE_CHANGED',
              performed_by: req.user.username || 'PrintOperator',
              role: req.user.role || 'PrintOperator',
              details: `Changed preferred default ID card template to "${templateId}" for ${activeSchool.name}.`,
              timestamp: new Date().toISOString()
            });
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Default template updated.', defaultTemplateId: templateId }));
          });
        }

        // POST /api/print-center/id-card-design/reset (Reset ID Card Design to Default)
        if (reqPath === '/api/print-center/id-card-design/reset' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required.' }));
            }
            if (!activeSchool) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'School tenant context required.' }));
            }
            let defaultDesign;
            const targetTplId = req.body?.templateId;
            if (targetTplId) {
              const templates = getSchoolBuiltinTemplates(activeSchool);
              const found = templates.find(t => t.id === targetTplId);
              if (found) {
                defaultDesign = { ...JSON.parse(JSON.stringify(found)), updatedAt: new Date().toISOString() };
              }
            }
            if (!defaultDesign) {
              defaultDesign = getDefaultIdCardDesign(activeSchool);
            }
            activeSchool.idCardDesign = defaultDesign;
            if (activeSchool.id === DEFAULT_SCHOOL_ID) {
              db.settings.idCardDesign = defaultDesign;
            }

            ensurePrintCenterSchema(db);
            db.printCenterAuditLogs.unshift({
              id: 'pal_' + crypto.randomUUID(),
              school_id: activeSchool.id,
              school_name: activeSchool.name,
              action: 'DESIGN_RESET',
              performed_by: req.user.username || 'PrintOperator',
              role: req.user.role || 'PrintOperator',
              details: `Reset ID Card Design to default template for ${activeSchool.name}.`,
              timestamp: new Date().toISOString()
            });

            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'ID Card design reset to default.', design: defaultDesign }));
          });
        }

        // POST /api/print-center/id-card-design/presets (Save Preset)
        if (reqPath === '/api/print-center/id-card-design/presets' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required.' }));
            }
            const { name, design } = req.body || {};
            if (!name || !design) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Preset name and design data are required.' }));
            }
            activeSchool.idCardPresets = activeSchool.idCardPresets || [];
            const newPreset = {
              id: 'pre_' + crypto.randomUUID(),
              name: String(name).trim(),
              design,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            activeSchool.idCardPresets.push(newPreset);
            writeDbRaw(db);
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, preset: newPreset, presets: activeSchool.idCardPresets }));
          });
        }

        // POST /api/print-center/id-card-design/presets/:id/duplicate
        const presetDupMatch = reqPath.match(/^\/api\/print-center\/id-card-design\/presets\/([^/]+)\/duplicate$/);
        if (presetDupMatch && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required.' }));
            }
            const presetId = presetDupMatch[1];
            activeSchool.idCardPresets = activeSchool.idCardPresets || [];
            const original = activeSchool.idCardPresets.find(p => p.id === presetId);
            if (!original) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Preset not found.' }));
            }
            const duplicated = {
              id: 'pre_' + crypto.randomUUID(),
              name: req.body?.name ? String(req.body.name).trim() : `${original.name} (Copy)`,
              design: JSON.parse(JSON.stringify(original.design)),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            activeSchool.idCardPresets.push(duplicated);
            writeDbRaw(db);
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, preset: duplicated, presets: activeSchool.idCardPresets }));
          });
        }

        // PUT /api/print-center/id-card-design/presets/:id (Rename / Update Preset)
        const presetIdMatch = reqPath.match(/^\/api\/print-center\/id-card-design\/presets\/([^/]+)$/);
        if (presetIdMatch && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required.' }));
            }
            const presetId = presetIdMatch[1];
            activeSchool.idCardPresets = activeSchool.idCardPresets || [];
            const preset = activeSchool.idCardPresets.find(p => p.id === presetId);
            if (!preset) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Preset not found.' }));
            }
            if (req.body?.name) preset.name = String(req.body.name).trim();
            if (req.body?.design) preset.design = req.body.design;
            preset.updatedAt = new Date().toISOString();
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, preset, presets: activeSchool.idCardPresets }));
          });
        }

        // DELETE /api/print-center/id-card-design/presets/:id (Delete Preset)
        if (presetIdMatch && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user?.role !== 'PrintOperator' && req.user?.role !== 'SuperAdmin') {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Operator authorization required.' }));
            }
            const presetId = presetIdMatch[1];
            activeSchool.idCardPresets = activeSchool.idCardPresets || [];
            const index = activeSchool.idCardPresets.findIndex(p => p.id === presetId);
            if (index === -1) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Preset not found.' }));
            }
            activeSchool.idCardPresets.splice(index, 1);
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Preset deleted successfully.', presets: activeSchool.idCardPresets }));
          });
        }

        // POST /api/admit-card/signature
        if (reqPath === '/api/admit-card/signature' && method === 'POST') {
          return handleAdminRoute(() => {
            if (req.user?.role !== 'PrintOperator') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Print Portal authentication required.' })); }
            try {
              const upload = validateAdmitCardSignatureUpload(req.file);
              const fileName = `principal-signature-${crypto.randomUUID()}${upload.extension}`;
              const filePath = path.join(ADMIT_CARD_SIGNATURES_DIR, fileName);
              const publicPath = `/uploads/admit-card-signatures/${fileName}`;
              fs.writeFileSync(filePath, upload.bytes, { flag: 'wx', mode: 0o644 });
              const previousPath = db.settings.admitCardSettings?.principalSignatureUrl || '';
              try {
                const updatedAt = new Date().toISOString();
                db.settings.admitCardSettings = { ...(db.settings.admitCardSettings || {}), principalSignatureUrl: publicPath, principalSignatureUpdatedAt: updatedAt };
                writeDbRaw(db);
              } catch (error) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                throw error;
              }
              removeOwnedAdmitCardSignature(previousPath);
              res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, signatureUrl: publicPath, admitCardSettings: db.settings.admitCardSettings }));
            } catch (error) {
              const validationError = /Only PNG|Please select|multipart field|boundary|image is empty|2 MB|does not match|corrupt|invalid dimensions/.test(error.message);
              console.error('Admit Card signature upload failed:', error);
              res.writeHead(validationError ? 400 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: error.message || 'Unable to save the Admit Card signature image.' }));
            }
          });
        }

        // DELETE /api/admit-card/signature
        if (reqPath === '/api/admit-card/signature' && method === 'DELETE') {
          return handleAdminRoute(() => {
            if (req.user?.role !== 'PrintOperator') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Print Portal authentication required.' })); }
            try {
              const previousPath = db.settings.admitCardSettings?.principalSignatureUrl || '';
              db.settings.admitCardSettings = { ...(db.settings.admitCardSettings || {}), principalSignatureUrl: '', principalSignatureUpdatedAt: new Date().toISOString() };
              writeDbRaw(db);
              removeOwnedAdmitCardSignature(previousPath);
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ success: true, signatureUrl: '', admitCardSettings: db.settings.admitCardSettings }));
            } catch (error) {
              console.error('Admit Card signature deletion failed:', error);
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: error.message || 'Unable to remove the Admit Card signature image.' }));
            }
          });
        }
        if(reqPath==='/api/whatsapp/webhook'&&method==='GET'){const c=WhatsApp.config(db,getJwtSecret()),t=String(parsedUrl.query?.['hub.verify_token']||''),v=String(c.verifyToken||'');if(parsedUrl.query?.['hub.mode']==='subscribe'&&v&&t.length===v.length&&crypto.timingSafeEqual(Buffer.from(t),Buffer.from(v))){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});return res.end(String(parsedUrl.query?.['hub.challenge']||''))}res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Webhook verification failed.'}))}
        if(reqPath==='/api/whatsapp/webhook'&&method==='POST'){const appSecret=String(process.env.META_APP_SECRET||'');if(appSecret){const supplied=String(req.headers['x-hub-signature-256']||''),expected='sha256='+crypto.createHmac('sha256',appSecret).update(req.rawBody||'').digest('hex');if(supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Invalid webhook signature.'}))}}try{const d=readDbRaw();WhatsApp.webhook(d,req.body);writeDbRaw(d)}catch(e){console.error('WhatsApp webhook failed:',e.message)}res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({success:true}))}
        if(reqPath==='/api/whatsapp/settings'&&method==='GET')return handleAdminRoute(()=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(WhatsApp.safe(db,getJwtSecret())))});
        if(reqPath==='/api/whatsapp/settings'&&method==='PUT')return handleAdminRoute(()=>{try{const out=WhatsApp.update(db,req.body||{},getJwtSecret(),req.user?.username);writeDbRaw(db);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(out))}catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}))}});
        if(reqPath==='/api/whatsapp/templates'&&method==='GET')return handleAdminRoute(()=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(WhatsApp.config(db,getJwtSecret()).templates))});
        if(reqPath==='/api/whatsapp/templates'&&method==='PUT')return handleAdminRoute(()=>{try{const body=req.body||{},templates=body.templates||body,templateLanguages=body.templateLanguages||{};const bad=Object.keys(templates).filter(k=>!Object.hasOwn(WhatsApp.TEMPLATES,k));if(bad.length)throw Error('Unknown template mapping: '+bad.join(', '));const badLanguages=Object.entries(templateLanguages).filter(([k,v])=>!Object.hasOwn(WhatsApp.TEMPLATES,k)||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(String(v)));if(badLanguages.length)throw Error('Invalid Meta template language mapping: '+badLanguages.map(([k])=>k).join(', '));const out=WhatsApp.update(db,{...WhatsApp.safe(db,getJwtSecret()),templates,templateLanguages},getJwtSecret(),req.user?.username);writeDbRaw(db);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({templates:out.templates,templateLanguages:out.templateLanguages}))}catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}))}});
        if(reqPath==='/api/whatsapp/status'&&method==='GET')return handleAdminRoute(async()=>{const out=await WhatsApp.service.getWhatsAppApiStatus(WhatsApp.config(db,getJwtSecret()));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(out))});
        if((reqPath==='/api/whatsapp/test'||reqPath==='/api/whatsapp/send')&&method==='POST')return handleAdminRoute(async()=>{try{const i=req.body||{},c=WhatsApp.config(db,getJwtSecret()),key=String(i.templateKey||''),name=i.templateName||c.templates[key]||'',languageCode=i.languageCode||c.templateLanguages[key]||'',components=WhatsApp.TEMPLATE_DEFINITIONS[key]?WhatsApp.buildTemplateComponents(key,i.testValues):i.components;if(name){const active=(await WhatsApp.service.getTemplateStatus(c,name)).find(t=>t.name===name&&t.language===languageCode&&t.status==='APPROVED');if(!active)throw Error('Meta template '+name+' with language '+languageCode+' is not Active in configured WABA.');}const out=await WhatsApp.send(db,{...i,templateKey:key,templateName:name,languageCode,components,messageType:name?'template':'text',text:i.text||'This is a WhatsApp Cloud API test message from Garumara Jatiya Vidyalaya.'},getJwtSecret(),writeDbRaw,readDbRaw);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(out))}catch(e){res.writeHead(Number(e.httpStatus)||400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message,httpStatus:e.httpStatus||null,metaCode:e.metaCode||null,metaSubcode:e.metaSubcode||null}))}});
        if(reqPath==='/api/whatsapp/logs'&&method==='GET')return handleAdminRoute(()=>{const n=Math.min(500,Math.max(1,Number(parsedUrl.query?.limit||100)));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify((db.whatsappMessageLogs||[]).slice(0,n)))});

        // Academic Session Management (Admin only)
        if (reqPath === '/api/academic-sessions' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Admin authorization required.' })); }
            const input = req.body || {}, name = canonicalAcademicSessionName(input.session_name || input.sessionName);
            const start = String(input.start_date || input.startDate || ''), end = String(input.end_date || input.endDate || '');
            if (!name) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Session name is required.' })); }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start >= end) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Start Date must be before End Date.' })); }
            const sessions = ensureAcademicSessions(db, activeSchool?.id);
            if (sessions.some(row => canonicalAcademicSessionName(row.session_name).toLowerCase() === name.toLowerCase())) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'An academic session with this name already exists.' })); }
            const now = new Date().toISOString(), activate = input.is_active === true || input.setAsCurrent === true, status = activate ? 'Active' : (['Closed','Archived'].includes(input.status) ? input.status : 'Closed');
            if (activate) sessions.forEach(row => { row.is_active = false; if (row.status === 'Active') row.status = 'Closed'; row.updated_at = now; });
            const row = { id: crypto.randomUUID(), school_id: activeSchool?.id || DEFAULT_SCHOOL_ID, session_name: name, start_date: start, end_date: end, is_active: activate, status, created_at: now, updated_at: now };
            (db.academicSessions = db.academicSessions || []).push(row);
            if (activate) {
              if (activeSchool?.id && activeSchool.id !== DEFAULT_SCHOOL_ID) {
                const sch = (db.schools || []).find(s => s.id === activeSchool.id);
                if (sch) {
                  sch.settings = sch.settings || {};
                  sch.settings.academicSession = name;
                  sch.settings.academicSessionId = row.id;
                }
              } else {
                db.settings.academicSession = name;
                db.settings.academicSessionId = row.id;
              }
            }
            writeDbRaw(db); res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(row));
          });
        }
        const academicSessionMatch = reqPath.match(/^\/api\/academic-sessions\/([^/]+)$/);
        const academicSessionActivateMatch = reqPath.match(/^\/api\/academic-sessions\/([^/]+)\/activate$/);
        if (academicSessionActivateMatch && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Admin authorization required.' })); }
            const sessions = ensureAcademicSessions(db, activeSchool?.id), row = sessions.find(item => item.id === decodeURIComponent(academicSessionActivateMatch[1]));
            if (!row || row.status === 'Archived') { res.writeHead(row ? 409 : 404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: row ? 'Archived sessions cannot be activated. Edit the session status first.' : 'Academic session not found.' })); }
            const previous = sessions.find(item => item.is_active), now = new Date().toISOString(); sessions.forEach(item => { item.is_active = item.id === row.id; item.status = item.id === row.id ? 'Active' : (item.status === 'Active' ? 'Closed' : item.status); item.updated_at = now; });
            if (activeSchool?.id && activeSchool.id !== DEFAULT_SCHOOL_ID) {
              const sch = (db.schools || []).find(s => s.id === activeSchool.id);
              if (sch) {
                sch.settings = sch.settings || {};
                sch.settings.academicSession = row.session_name;
                sch.settings.academicSessionId = row.id;
              }
            } else {
              db.settings.academicSession = row.session_name;
              db.settings.academicSessionId = row.id;
            }
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ success: true, previousSession: previous?.session_name || null, currentSession: row }));
          });
        }
        if (academicSessionMatch && method === 'PUT') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Admin authorization required.' })); }
            const sessions = ensureAcademicSessions(db, activeSchool?.id), row = sessions.find(item => item.id === decodeURIComponent(academicSessionMatch[1]));
            if (!row) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Academic session not found.' })); }
            const input=req.body||{}, name=canonicalAcademicSessionName(input.session_name || row.session_name), start=String(input.start_date || row.start_date), end=String(input.end_date || row.end_date);
            if (start >= end) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Start Date must be before End Date.' })); }
            if (sessions.some(item => item.id !== row.id && canonicalAcademicSessionName(item.session_name).toLowerCase() === name.toLowerCase())) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'An academic session with this name already exists.' })); }
            row.session_name=name; row.start_date=start; row.end_date=end; if (!row.is_active && ['Closed','Archived'].includes(input.status)) row.status=input.status; row.updated_at=new Date().toISOString();
            if (row.is_active) {
              if (activeSchool?.id && activeSchool.id !== DEFAULT_SCHOOL_ID) {
                const sch = (db.schools || []).find(s => s.id === activeSchool.id);
                if (sch) {
                  sch.settings = sch.settings || {};
                  sch.settings.academicSession = name;
                }
              } else {
                db.settings.academicSession = name;
              }
            }
            writeDbRaw(db);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(row));
          });
        }
        if (academicSessionMatch && method === 'DELETE') {
          return handleAdminRoute((db, activeSchool) => {
            if (req.user.role !== 'Admin') { res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Admin authorization required.' })); }
            const sessions=ensureAcademicSessions(db, activeSchool?.id), row=sessions.find(item => item.id === decodeURIComponent(academicSessionMatch[1]));
            if(!row){res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Academic session not found.'}));}
            const refs=academicSessionReferenceCount(db,row); if(row.is_active || refs){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error: row.is_active ? 'The active academic session cannot be deleted.' : 'This session contains school records and must be archived instead.', referenceCount: refs}));}
            const dbIndex = (db.academicSessions || []).findIndex(item => item.id === row.id);
            if (dbIndex >= 0) db.academicSessions.splice(dbIndex, 1);
            writeDbRaw(db); res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({success:true}));
          });
        }

        // GET /api/settings
        if (reqPath === '/api/settings' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            let safeSettings = { ...db.settings };
            delete safeSettings.adminPasswordHash;
            delete safeSettings.adminPasswordSalt;
            delete safeSettings.printPortalPasswordHash;
            delete safeSettings.printPortalPasswordSalt;
            delete safeSettings.whatsappCloud;
            if (req.user.role === 'Admin') { delete safeSettings.idCardSettings; delete safeSettings.admitCardSettings; }
            if (req.user.role === 'PrintOperator') safeSettings = { websiteContent: safeSettings.websiteContent, idCardSettings: safeSettings.idCardSettings, admitCardSettings: safeSettings.admitCardSettings };

            if (activeSchool) {
              safeSettings = {
                ...safeSettings,
                ...(activeSchool.settings || {}),
                schoolId: activeSchool.id,
                schoolName: activeSchool.name,
                schoolCode: activeSchool.code,
                logo: activeSchool.logo || '/logo.jpg',
                favicon: activeSchool.favicon || '/favicon.ico',
                websiteContent: activeSchool.websiteContent || {
                  schoolName: activeSchool.name,
                  tagline: activeSchool.schoolDescription || activeSchool.websiteTitle || '',
                  aboutText: activeSchool.aboutSchool || '',
                  principalName: activeSchool.principalName || '',
                  principalMessage: `Welcome to ${activeSchool.name}. As Principal, it is a privilege to lead our educational community.`,
                  address: [activeSchool.address, activeSchool.city, activeSchool.state, activeSchool.pincode].filter(Boolean).join(', ') || activeSchool.address || '',
                  phone: activeSchool.phone || '',
                  email: activeSchool.officialEmail || activeSchool.contactEmail || activeSchool.adminUsername || '',
                  mapEmbedUrl: '',
                  logo: activeSchool.logo || '/logo.jpg',
                  favicon: activeSchool.favicon || '/favicon.ico',
                  socialLinks: activeSchool.socialLinks || {}
                }
              };
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(safeSettings));
          });
        }

        // POST /api/settings (Update Settings & Password)
        if (reqPath === '/api/settings' && method === 'POST') {
          return handleAdminRoute((db, activeSchool) => {
            const data = req.body || {};
            const cardSettingKeys = new Set(['idCardSettings', 'admitCardSettings']);
            if (req.user.role === 'Admin' && (data.idCardSettings || data.admitCardSettings)) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Card templates are managed only through the Private Print Portal.' }));
            }
            if (req.user.role === 'PrintOperator' && Object.keys(data).some(key => !cardSettingKeys.has(key))) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Print Portal users may update only ID Card and Admit Card template settings.' }));
            }
            if (req.user.role !== 'SuperAdmin' && req.user.school_id && activeSchool && activeSchool.id !== req.user.school_id) {
              res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Unauthorized cross-school settings update.' }));
            }
            
            const isTenantSchool = activeSchool && activeSchool.id !== DEFAULT_SCHOOL_ID;

            // Password update check
            if (data.newPassword) {
              const salt = crypto.randomBytes(16).toString('hex');
              const hash = crypto.pbkdf2Sync(data.newPassword, salt, 1000, 64, 'sha512').toString('hex');
              if (activeSchool) {
                activeSchool.adminPasswordSalt = salt;
                activeSchool.adminPasswordHash = hash;
              }
              if (!isTenantSchool) {
                db.settings.adminPasswordSalt = salt;
                db.settings.adminPasswordHash = hash;
              }
            }

            if (activeSchool) {
              activeSchool.settings = activeSchool.settings || {};
              if (data.adminUsername) activeSchool.adminUsername = data.adminUsername;
              if (data.websiteContent) {
                activeSchool.websiteContent = {
                  ...(activeSchool.websiteContent || {}),
                  ...data.websiteContent
                };
                if (data.websiteContent.schoolName) activeSchool.name = String(data.websiteContent.schoolName).trim();
                if (data.websiteContent.phone) activeSchool.phone = String(data.websiteContent.phone).trim();
                if (data.websiteContent.email) activeSchool.officialEmail = String(data.websiteContent.email).trim();
                if (data.websiteContent.address) activeSchool.address = String(data.websiteContent.address).trim();
                if (data.websiteContent.principalName) {
                  activeSchool.principalName = String(data.websiteContent.principalName).trim();
                  const principalLeader = (db.leadership || []).find(l => matchTenant(l, activeSchool.id) && l.id === 'principal');
                  if (principalLeader) principalLeader.name = activeSchool.principalName;
                }
                if (data.websiteContent.principalMessage) {
                  const principalLeader = (db.leadership || []).find(l => matchTenant(l, activeSchool.id) && l.id === 'principal');
                  if (principalLeader) principalLeader.message = String(data.websiteContent.principalMessage).trim();
                }
                if (data.websiteContent.tagline) {
                  activeSchool.schoolDescription = String(data.websiteContent.tagline).trim();
                }
                if (data.websiteContent.aboutText) {
                  activeSchool.aboutSchool = String(data.websiteContent.aboutText).trim();
                }
                if (data.websiteContent.logo) activeSchool.logo = String(data.websiteContent.logo).trim();
                if (data.websiteContent.favicon) activeSchool.favicon = String(data.websiteContent.favicon).trim();

                // Only keep db.settings.websiteContent synchronized for default school
                if (activeSchool.id === DEFAULT_SCHOOL_ID) {
                  db.settings.websiteContent = {
                    ...(db.settings.websiteContent || {}),
                    ...activeSchool.websiteContent
                  };
                }
              }
              if (data.notificationsEnabled !== undefined) activeSchool.settings.notificationsEnabled = !!data.notificationsEnabled;
              if (data.whatsappEnabled !== undefined) activeSchool.settings.whatsappEnabled = !!data.whatsappEnabled;
              if (data.smsEnabled !== undefined) activeSchool.settings.smsEnabled = !!data.smsEnabled;
              if (data.whatsappTemplate) activeSchool.settings.whatsappTemplate = data.whatsappTemplate;
              if (data.smsTemplate) activeSchool.settings.smsTemplate = data.smsTemplate;
              activeSchool.updatedAt = new Date().toISOString();
            }

            if (!isTenantSchool) {
              if (data.adminUsername) db.settings.adminUsername = data.adminUsername;
              if (data.notificationsEnabled !== undefined) db.settings.notificationsEnabled = !!data.notificationsEnabled;
              if (data.whatsappEnabled !== undefined) db.settings.whatsappEnabled = !!data.whatsappEnabled;
              if (data.smsEnabled !== undefined) db.settings.smsEnabled = !!data.smsEnabled;
              if (data.whatsappTemplate) db.settings.whatsappTemplate = data.whatsappTemplate;
              if (data.smsTemplate) db.settings.smsTemplate = data.smsTemplate;
            }

            if (data.admitCardSettings) {
              db.settings.admitCardSettings = {
                ...db.settings.admitCardSettings,
                ...data.admitCardSettings
              };
            }
            if (data.idCardSettings) {
              db.settings.idCardSettings = {
                ...db.settings.idCardSettings,
                ...data.idCardSettings
              };
            }

            writeDbRaw(db);
            
            let safeSettings = activeSchool ? {
              ...db.settings,
              ...(activeSchool.settings || {}),
              schoolId: activeSchool.id,
              schoolName: activeSchool.name,
              schoolCode: activeSchool.code,
              logo: activeSchool.logo || '/logo.jpg',
              favicon: activeSchool.favicon || '/favicon.ico',
              websiteContent: activeSchool.websiteContent
            } : { ...db.settings };

            delete safeSettings.adminPasswordHash;
            delete safeSettings.adminPasswordSalt;
            delete safeSettings.printPortalPasswordHash;
            delete safeSettings.printPortalPasswordSalt;
            if (req.user.role === 'Admin') { delete safeSettings.idCardSettings; delete safeSettings.admitCardSettings; }
            if (req.user.role === 'PrintOperator') safeSettings = { websiteContent: safeSettings.websiteContent, idCardSettings: safeSettings.idCardSettings, admitCardSettings: safeSettings.admitCardSettings };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(safeSettings));
          });
        }

        // GET /api/notifications
        if (reqPath === '/api/notifications' && method === 'GET') {
          return handleAdminRoute(() => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(db.notifications || []));
          });
        }

        // POST /api/notifications/test (Trigger manual test notification)
        if (reqPath === '/api/notifications/test' && method === 'POST') {
          return handleAdminRoute(() => {
            const { studentId, type, message } = req.body;
            const student = db.students.find(s => s.admissionNo === studentId || s.id === studentId);
            if (!student) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'A real student record is required to send a test notification.' }));
            }
            
            if (db.settings.whatsappEnabled) {
              addNotificationLog(db, student, 'WhatsApp', type || 'Test', message || 'This is a test notification.');
            }
            if (db.settings.smsEnabled) {
              addNotificationLog(db, student, 'SMS', type || 'Test', message || 'This is a test notification.');
            }
            writeDbRaw(db);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Test notification triggered.' }));
          });
        }

        // GET /api/reports (Aggregate stats for charts)
        if (reqPath === '/api/reports' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const schoolStudents = (db.students || []).filter(s => matchTenant(s, activeSchool.id));
            const totalStudents = schoolStudents.length;
            
            // Calculate class distribution
            const classDist = {};
            schoolStudents.forEach(s => {
              classDist[s.className] = (classDist[s.className] || 0) + 1;
            });

            // Calculate fee collection totals by month
            const feeByMonth = {};
            (db.fees || []).filter(f => matchTenant(f, activeSchool.id)).forEach(f => {
              const month = f.month || getLocalMonthStr(f.date) || 'Other';
              const received = Number(f.totalReceived ?? (Number(f.amount || 0) + Number(f.lateFee || 0)));
              feeByMonth[month] = (feeByMonth[month] || 0) + received;
            });

            // Attendance rates (overall)
            let totalPresent = 0;
            let totalAbsent = 0;
            let totalLate = 0;
            (db.attendance || []).filter(att => matchTenant(att, activeSchool.id)).forEach(att => {
              (att.records || []).forEach(r => {
                if (r.status === 'Present') totalPresent++;
                else if (r.status === 'Absent') totalAbsent++;
                else if (r.status === 'Late') totalLate++;
              });
            });
            const totalAttCount = totalPresent + totalAbsent + totalLate;
            const attendanceRate = totalAttCount > 0 ? ((totalPresent + totalLate) / totalAttCount * 100).toFixed(1) : '100.0';

            const reports = {
              totalStudents,
              attendanceRate,
              classDistribution: classDist,
              feeCollectionByMonth: feeByMonth,
              attendanceStats: {
                present: totalPresent,
                absent: totalAbsent,
                late: totalLate
              }
            };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(reports));
          });
        }

        // GET /api/backup (Download database JSON)
        if (reqPath === '/api/backup' && method === 'GET') {
          return handleAdminRoute((db, activeSchool) => {
            const dataToExport = (req.user?.role === 'SuperAdmin')
              ? db
              : createScopedBackup(db, activeSchool);
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Disposition': `attachment; filename=${activeSchool.code || 'school'}_backup_${new Date().toISOString().split('T')[0]}.json`
            });
            return res.end(JSON.stringify(dataToExport, null, 2));
          });
        }

        // POST /api/backup/restore
        if (reqPath === '/api/backup/restore' && method === 'POST') {
          return handleAdminRoute(() => {
            const restoredData = req.body;
            if (!restoredData.settings || !restoredData.students) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({ error: 'Invalid backup file structure.' }));
            }

            writeDbRaw(restoredData);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, message: 'Database successfully restored.' }));
          });
        }

        // Fallback for unknown api
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: `Endpoint ${method} ${reqPath} not found.` }));
      });
    });
  } else {
    // Serve static files
    serveStaticFile(req, res, reqPath);
  }
}

function setInMemoryDb(db) {
  inMemoryDb = db;
}

// Create HTTP Server
const server = http.createServer(appHandler);

// Start Server when run directly
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Garumara Jatiya Vidyalaya Server running at http://localhost:${PORT}`);
  });
}

module.exports = server;
module.exports.server = server;
module.exports.appHandler = appHandler;
module.exports.setInMemoryDb = setInMemoryDb;

