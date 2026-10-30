// ==============================================================================
// SCHOOL ERP SAAS — SUPABASE DATABASE ADAPTER & PERSISTENCE LAYER
// Provides dual-mode data persistence:
// 1. Supabase PostgreSQL (Production / Cloud Mode)
// 2. Local db.json fallback (Offline Local Development Mode)
// ==============================================================================

const fs = require('fs');
const path = require('path');
let createClient = null;

try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (e) {
  // @supabase/supabase-js not loaded yet
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabaseClient = null;

function isConfigured() {
  return Boolean(createClient && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_URL.includes('your-project-id'));
}

function getClient() {
  if (!isConfigured()) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabaseClient;
}

// Test connectivity to Supabase
async function testConnection() {
  if (!isConfigured()) {
    return {
      connected: false,
      reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured in environment.'
    };
  }
  try {
    const client = getClient();
    const { data, error } = await client.from('schools').select('id, name, subdomain').limit(5);
    if (error) throw error;
    return {
      connected: true,
      schoolsCount: data ? data.length : 0,
      sampleSchools: data
    };
  } catch (err) {
    return {
      connected: false,
      reason: err.message || String(err)
    };
  }
}

// Map camelCase JSON keys to Supabase snake_case columns
function mapSchoolToRow(s) {
  return {
    id: s.id,
    code: s.code,
    subdomain: s.subdomain,
    name: s.name,
    status: s.status || 'Active',
    admin_username: s.adminUsername,
    admin_password_hash: s.adminPasswordHash,
    admin_password_salt: s.adminPasswordSalt,
    phone: s.phone,
    address: s.address,
    principal_name: s.principalName,
    logo: s.logo,
    favicon: s.favicon,
    website_logo: s.websiteLogo,
    type: s.type,
    affiliation: s.affiliation,
    established_year: s.establishedYear,
    city: s.city,
    district: s.district,
    state: s.state,
    pincode: s.pincode,
    country: s.country || 'India',
    official_email: s.officialEmail,
    website_title: s.websiteTitle,
    plan: s.plan || 'Starter',
    subscription_status: s.subscriptionStatus || 'Active',
    contact_email: s.contactEmail,
    alternate_phone: s.alternatePhone,
    admin_phone: s.adminPhone,
    website_url: s.websiteUrl,
    about_school: s.aboutSchool,
    school_description: s.schoolDescription,
    contact_details: s.contactDetails || {},
    social_links: s.socialLinks || {},
    domain: s.domain,
    admin_name: s.adminName,
    trial_start_date: s.trialStartDate,
    trial_end_date: s.trialEndDate,
    website_content: s.websiteContent || {},
    id_card_design: s.idCardDesign || {},
    default_template_id: s.defaultTemplateId || 'royal-blue',
    settings: s.settings || {},
    created_at: s.createdAt || new Date().toISOString(),
    updated_at: s.updatedAt || new Date().toISOString()
  };
}

function mapRowToSchool(r) {
  return {
    id: r.id,
    code: r.code,
    subdomain: r.subdomain,
    name: r.name,
    status: r.status,
    adminUsername: r.admin_username,
    adminPasswordHash: r.admin_password_hash,
    adminPasswordSalt: r.admin_password_salt,
    phone: r.phone,
    address: r.address,
    principalName: r.principal_name,
    logo: r.logo,
    favicon: r.favicon,
    websiteLogo: r.website_logo,
    type: r.type,
    affiliation: r.affiliation,
    establishedYear: r.established_year,
    city: r.city,
    district: r.district,
    state: r.state,
    pincode: r.pincode,
    country: r.country,
    officialEmail: r.official_email,
    websiteTitle: r.website_title,
    plan: r.plan,
    subscriptionStatus: r.subscription_status,
    contactEmail: r.contact_email,
    alternatePhone: r.alternate_phone,
    adminPhone: r.admin_phone,
    websiteUrl: r.website_url,
    aboutSchool: r.about_school,
    schoolDescription: r.school_description,
    contactDetails: r.contact_details || {},
    socialLinks: r.social_links || {},
    domain: r.domain,
    adminName: r.admin_name,
    trialStartDate: r.trial_start_date,
    trialEndDate: r.trial_end_date,
    websiteContent: r.website_content || {},
    idCardDesign: r.id_card_design || {},
    defaultTemplateId: r.default_template_id,
    settings: r.settings || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// Load complete dataset from Supabase into memory
async function loadFullDbFromSupabase() {
  const client = getClient();
  if (!client) return null;

  try {
    const [
      saasCfgRes,
      superAdminRes,
      schoolsRes,
      domainsRes,
      domainLogsRes,
      sessionsRes,
      studentsRes,
      teachersRes,
      teacherLoginRes,
      teacherAssignmentsRes,
      teacherPermissionsRes,
      teacherLeavesRes,
      feesRes,
      studentAttendanceRes,
      noticesRes,
      galleryRes,
      leadershipRes,
      demoReqsRes,
      printAccountsRes,
      settingsRes
    ] = await Promise.all([
      client.from('saas_config').select('*').limit(1),
      client.from('super_admin').select('*').limit(1),
      client.from('schools').select('*'),
      client.from('school_domains').select('*'),
      client.from('domain_audit_logs').select('*').order('timestamp', { ascending: false }).limit(200),
      client.from('academic_sessions').select('*'),
      client.from('students').select('*'),
      client.from('teachers').select('*'),
      client.from('teacher_login').select('*'),
      client.from('teacher_assignments').select('*'),
      client.from('teacher_permissions').select('*'),
      client.from('teacher_leaves').select('*'),
      client.from('fees').select('*'),
      client.from('student_attendance').select('*'),
      client.from('notices').select('*'),
      client.from('gallery').select('*'),
      client.from('leadership').select('*'),
      client.from('saas_demo_requests').select('*'),
      client.from('print_center_accounts').select('*'),
      client.from('school_settings').select('*')
    ]);

    const schools = (schoolsRes.data || []).map(mapRowToSchool);
    const superAdmin = superAdminRes.data && superAdminRes.data[0] ? {
      username: superAdminRes.data[0].username,
      passwordHash: superAdminRes.data[0].password_hash,
      passwordSalt: superAdminRes.data[0].password_salt,
      role: superAdminRes.data[0].role,
      createdAt: superAdminRes.data[0].created_at
    } : null;

    const saasConfig = saasCfgRes.data && saasCfgRes.data[0] ? {
      companyName: saasCfgRes.data[0].company_name,
      productName: saasCfgRes.data[0].product_name,
      headline: saasCfgRes.data[0].headline,
      subheadline: saasCfgRes.data[0].subheadline,
      helplinePhone: saasCfgRes.data[0].helpline_phone,
      helplineWhatsapp: saasCfgRes.data[0].helpline_whatsapp,
      salesEmail: saasCfgRes.data[0].sales_email,
      supportEmail: saasCfgRes.data[0].support_email,
      officeAddress: saasCfgRes.data[0].office_address,
      baseDomain: saasCfgRes.data[0].base_domain,
      plans: saasCfgRes.data[0].plans || []
    } : null;

    const settingsObj = {};
    (settingsRes.data || []).forEach(row => {
      settingsObj[row.key] = row.data;
    });

    return {
      saasConfig,
      superAdmin,
      schools,
      schoolDomains: (domainsRes.data || []).map(d => ({
        id: d.id,
        school_id: d.school_id,
        school_name: d.school_name,
        domain: d.domain,
        verification_status: d.verification_status,
        activation_status: d.activation_status,
        ssl_status: d.ssl_status,
        verification_token: d.verification_token,
        txt_record_name: d.txt_record_name,
        txt_record_value: d.txt_record_value,
        cname_target: d.cname_target,
        a_record_ip: d.a_record_ip,
        ttl: d.ttl,
        dns_records: d.dns_records,
        dns_status: d.dns_status,
        routing_status: d.routing_status,
        last_verified_at: d.last_verified_at,
        created_at: d.created_at,
        updated_at: d.updated_at
      })),
      domainAuditLogs: domainLogsRes.data || [],
      academicSessions: (sessionsRes.data || []).map(s => ({
        id: s.id,
        school_id: s.school_id,
        session_name: s.session_name,
        start_date: s.start_date,
        end_date: s.end_date,
        is_active: s.is_active,
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
        migrated_at: s.migrated_at
      })),
      students: (studentsRes.data || []).map(st => ({
        id: st.id,
        school_id: st.school_id,
        admissionNo: st.admission_no,
        name: st.name,
        dob: st.dob,
        gender: st.gender,
        studentAadhaar: st.student_aadhaar,
        className: st.class_name,
        section: st.section,
        rollNo: st.roll_no,
        fatherName: st.father_name,
        fatherAadhaar: st.father_aadhaar,
        motherName: st.mother_name,
        guardianName: st.guardian_name,
        mobile: st.mobile,
        address: st.address,
        admissionFee: Number(st.admission_fee || 0),
        monthlyFee: Number(st.monthly_fee || 0),
        admissionDate: st.admission_date,
        academicSession: st.academic_session,
        academic_session_id: st.academic_session_id,
        photo: st.photo,
        created_at: st.created_at,
        updated_at: st.updated_at
      })),
      teachers: (teachersRes.data || []).map(t => ({
        id: t.id,
        school_id: t.school_id,
        empId: t.emp_id,
        name: t.name,
        fatherHusband: t.father_husband,
        photo: t.photo,
        gender: t.gender,
        dob: t.dob,
        mobile: t.mobile,
        altMobile: t.alt_mobile,
        email: t.email,
        aadhaar: t.aadhaar,
        pan: t.pan,
        qualification: t.qualification,
        experience: t.experience,
        designation: t.designation,
        employmentType: t.employment_type,
        subject: t.subject,
        assignedSubjects: t.assigned_subjects || [],
        classTeacher: t.class_teacher,
        assignedClass: t.assigned_class,
        assignedSection: t.assigned_section,
        assignedClasses: t.assigned_classes || [],
        joiningDate: t.joining_date,
        salary: Number(t.salary || 0),
        status: t.status,
        address: t.address,
        bloodGroup: t.blood_group,
        emergencyContact: t.emergency_contact,
        bankDetails: t.bank_details || {},
        signature: t.signature,
        documents: t.documents || [],
        loginUsername: t.login_username,
        lastLogin: t.last_login,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      })),
      teacherLogin: (teacherLoginRes.data || []).map(tl => ({
        id: tl.id,
        school_id: tl.school_id,
        teacher_id: tl.teacher_id,
        teacher_emp_id: tl.teacher_emp_id,
        username: tl.username,
        password_hash: tl.password_hash,
        password_salt: tl.password_salt,
        login_status: tl.login_status,
        status: tl.status,
        force_password_change: tl.force_password_change,
        last_login: tl.last_login,
        created_at: tl.created_at,
        updated_at: tl.updated_at
      })),
      fees: (feesRes.data || []).map(f => ({
        id: f.id,
        school_id: f.school_id,
        student_id: f.student_id,
        studentId: f.student_id,
        admission_number: f.admission_number,
        studentName: f.student_name,
        class_id: f.class_id,
        className: f.class_name,
        section_id: f.section_id,
        section: f.section,
        receiptNo: f.receipt_no,
        legacy_due_id: f.legacy_due_id,
        source: f.source,
        academic_session_id: f.academic_session_id,
        academic_session: f.academic_session,
        fee_type: f.fee_type,
        feeHeads: f.fee_heads || [],
        expectedAmount: Number(f.expected_amount || 0),
        grossAmount: Number(f.gross_amount || 0),
        discountAmount: Number(f.discount_amount || 0),
        scholarshipAmount: Number(f.scholarship_amount || 0),
        amount: Number(f.amount || 0),
        lateFee: Number(f.late_fee || 0),
        totalReceived: Number(f.total_received || 0),
        paidAmount: Number(f.paid_amount || 0),
        appliedAmount: Number(f.applied_amount || 0),
        advanceAmount: Number(f.advance_amount || 0),
        cumulativePaid: Number(f.cumulative_paid || 0),
        dueBalance: Number(f.due_balance || 0),
        paymentStatus: f.payment_status,
        billing_month: f.billing_month,
        paymentMode: f.payment_mode,
        referenceNo: f.reference_no,
        remarks: f.remarks,
        idempotencyKey: f.idempotency_key,
        entered_by: f.entered_by,
        date: f.date,
        created_at: f.created_at,
        updated_at: f.updated_at
      })),
      studentAttendance: (studentAttendanceRes.data || []).map(a => ({
        id: a.id,
        school_id: a.school_id,
        student_id: a.student_id,
        teacher_id: a.teacher_id,
        class_id: a.class_id,
        section_id: a.section_id,
        attendance_date: a.attendance_date,
        status: a.status,
        remarks: a.remarks,
        academic_session: a.academic_session,
        academic_session_id: a.academic_session_id,
        marked_by: a.marked_by,
        created_at: a.created_at,
        updated_at: a.updated_at
      })),
      notices: noticesRes.data || [],
      gallery: galleryRes.data || [],
      leadership: leadershipRes.data || [],
      saasDemoRequests: demoReqsRes.data || [],
      printCenterAccounts: (printAccountsRes.data || []).map(pa => ({
        id: pa.id,
        school_id: pa.school_id,
        school_name: pa.school_name,
        school_code: pa.school_code,
        username: pa.username,
        password_hash: pa.password_hash,
        password_salt: pa.password_salt,
        status: pa.status,
        access_enabled: pa.access_enabled,
        token_version: pa.token_version,
        last_login: pa.last_login,
        created_at: pa.created_at,
        updated_at: pa.updated_at
      })),
      settings: settingsObj
    };
  } catch (err) {
    console.error('[SUPABASE] Failed to load snapshot from Supabase:', err.message);
    return null;
  }
}

// Background sync to Supabase when writeDbRaw is called
let syncDebounceTimer = null;
function queueSyncToSupabase(db) {
  if (!isConfigured()) return;
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

  syncDebounceTimer = setTimeout(async () => {
    try {
      const client = getClient();
      if (!client) return;

      // Upsert schools
      if (Array.isArray(db.schools) && db.schools.length) {
        const schoolRows = db.schools.map(mapSchoolToRow);
        await client.from('schools').upsert(schoolRows, { onConflict: 'id' });
      }

      // Upsert school custom domains
      if (Array.isArray(db.schoolDomains) && db.schoolDomains.length) {
        const domainRows = db.schoolDomains.map(d => ({
          id: d.id,
          school_id: d.school_id,
          school_name: d.school_name,
          domain: d.domain,
          verification_status: d.verification_status || 'Pending DNS',
          activation_status: d.activation_status || 'Inactive',
          ssl_status: d.ssl_status || 'Pending',
          verification_token: d.verification_token || '',
          txt_record_name: d.txt_record_name || '',
          txt_record_value: d.txt_record_value || '',
          cname_target: d.cname_target || 'cname.vercel-dns.com',
          a_record_ip: d.a_record_ip || '76.76.21.21',
          ttl: Number(d.ttl || 600),
          dns_records: d.dns_records || [],
          dns_status: d.dns_status || 'Pending',
          routing_status: d.routing_status || 'Inactive',
          last_verified_at: d.last_verified_at || null,
          created_at: d.created_at || new Date().toISOString(),
          updated_at: d.updated_at || new Date().toISOString()
        }));
        await client.from('school_domains').upsert(domainRows, { onConflict: 'id' });
      }

      // Upsert academic sessions
      if (Array.isArray(db.academicSessions) && db.academicSessions.length) {
        const sessionRows = db.academicSessions.map(s => ({
          id: s.id,
          school_id: s.school_id,
          session_name: s.session_name,
          start_date: s.start_date || null,
          end_date: s.end_date || null,
          is_active: Boolean(s.is_active),
          status: s.status || 'Active',
          created_at: s.created_at || new Date().toISOString(),
          updated_at: s.updated_at || new Date().toISOString()
        }));
        await client.from('academic_sessions').upsert(sessionRows, { onConflict: 'id' });
      }

      // Upsert students
      if (Array.isArray(db.students) && db.students.length) {
        const studentRows = db.students.map(st => ({
          id: st.id || st.admissionNo,
          school_id: st.school_id,
          admission_no: st.admissionNo || st.admission_no,
          name: st.name,
          dob: st.dob || null,
          gender: st.gender || null,
          student_aadhaar: st.studentAadhaar || null,
          class_name: st.className || st.class_name,
          section: st.section || 'A',
          roll_no: st.rollNo || st.roll_no || null,
          father_name: st.fatherName || st.father_name || null,
          father_aadhaar: st.fatherAadhaar || st.father_aadhaar || null,
          mother_name: st.motherName || st.mother_name || null,
          guardian_name: st.guardianName || st.guardian_name || null,
          mobile: st.mobile || null,
          address: st.address || null,
          admission_fee: Number(st.admissionFee || 0),
          monthly_fee: Number(st.monthlyFee || 0),
          admission_date: st.admissionDate || null,
          academic_session: st.academicSession || null,
          academic_session_id: st.academic_session_id || null,
          photo: st.photo || null,
          created_at: st.createdAt || new Date().toISOString(),
          updated_at: st.updatedAt || new Date().toISOString()
        }));
        await client.from('students').upsert(studentRows, { onConflict: 'id' });
      }

      // Upsert fees
      if (Array.isArray(db.fees) && db.fees.length) {
        const feeRows = db.fees.map(f => ({
          id: f.id,
          school_id: f.school_id,
          student_id: f.student_id || f.studentId,
          admission_number: f.admission_number || f.admissionNo,
          student_name: f.studentName || f.student_name,
          class_id: f.class_id,
          class_name: f.className || f.class_name,
          section_id: f.section_id,
          section: f.section,
          receipt_no: f.receiptNo || f.receipt_no,
          legacy_due_id: f.legacy_due_id || null,
          source: f.source || 'Standard',
          academic_session_id: f.academic_session_id || null,
          academic_session: f.academic_session || f.academicSession,
          fee_type: f.fee_type || f.type || 'Monthly',
          fee_heads: f.feeHeads || [],
          expected_amount: Number(f.expectedAmount || 0),
          gross_amount: Number(f.grossAmount || 0),
          discount_amount: Number(f.discountAmount || 0),
          scholarship_amount: Number(f.scholarshipAmount || 0),
          amount: Number(f.amount || 0),
          late_fee: Number(f.lateFee || 0),
          total_received: Number(f.totalReceived || 0),
          paid_amount: Number(f.paidAmount || 0),
          applied_amount: Number(f.appliedAmount || 0),
          advance_amount: Number(f.advanceAmount || 0),
          cumulative_paid: Number(f.cumulativePaid || 0),
          due_balance: Number(f.dueBalance || 0),
          payment_status: f.paymentStatus || 'Paid',
          billing_month: f.billing_month || f.month || null,
          payment_mode: f.paymentMode || 'Cash',
          reference_no: f.referenceNo || null,
          remarks: f.remarks || null,
          idempotency_key: f.idempotencyKey || null,
          entered_by: f.entered_by || 'Admin',
          date: f.date || null,
          created_at: f.created_at || new Date().toISOString(),
          updated_at: f.updated_at || new Date().toISOString()
        }));
        await client.from('fees').upsert(feeRows, { onConflict: 'id' });
      }

      // Upsert print center accounts
      if (Array.isArray(db.printCenterAccounts) && db.printCenterAccounts.length) {
        const printRows = db.printCenterAccounts.map(pa => ({
          id: pa.id,
          school_id: pa.school_id,
          school_name: pa.school_name,
          school_code: pa.school_code,
          username: pa.username,
          password_hash: pa.password_hash,
          password_salt: pa.password_salt,
          status: pa.status || 'Active',
          access_enabled: Boolean(pa.access_enabled !== false),
          token_version: Number(pa.token_version || 1),
          last_login: pa.last_login || null,
          created_at: pa.created_at || new Date().toISOString(),
          updated_at: pa.updated_at || new Date().toISOString()
        }));
        await client.from('print_center_accounts').upsert(printRows, { onConflict: 'id' });
      }
    } catch (err) {
      console.warn('[SUPABASE] Async sync failed safely:', err.message);
    }
  }, 1000);
}

module.exports = {
  isConfigured,
  getClient,
  testConnection,
  loadFullDbFromSupabase,
  queueSyncToSupabase
};
