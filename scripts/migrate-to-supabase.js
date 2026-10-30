// ==============================================================================
// SCHOOL ERP SAAS — AUTOMATED SUPABASE DATA MIGRATION SCRIPT
// Migrates all existing records from db.json directly into Supabase PostgreSQL.
// Run with: node scripts/migrate-to-supabase.js
// ==============================================================================

const fs = require('fs');
const path = require('path');

// Simple .env parser for local execution
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
}

loadEnv();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_URL.includes('your-project-id')) {
  console.error('\n❌ ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing or contains placeholder values.');
  console.error('Please configure your real credentials in .env first:');
  console.error('  SUPABASE_URL=https://[your-project-id].supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=[your-service-role-key]\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const DB_PATH = path.join(__dirname, '..', 'db.json');
if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ ERROR: Database file ${DB_PATH} not found.`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

async function migrate() {
  console.log('\n======================================================');
  console.log('🚀 STARTING SUPABASE MULTI-TENANT DATA MIGRATION');
  console.log('Target Supabase Instance:', SUPABASE_URL);
  console.log('======================================================\n');

  try {
    // 1. SaaS Config
    if (db.saasConfig) {
      process.stdout.write('1. Migrating SaaS Platform Configuration... ');
      const cfg = {
        id: 'default',
        company_name: db.saasConfig.companyName || 'School ERP SaaS',
        product_name: db.saasConfig.productName || 'School Management System',
        headline: db.saasConfig.headline || '',
        subheadline: db.saasConfig.subheadline || '',
        helpline_phone: db.saasConfig.helplinePhone || '',
        helpline_whatsapp: db.saasConfig.helplineWhatsapp || '',
        sales_email: db.saasConfig.salesEmail || '',
        support_email: db.saasConfig.supportEmail || '',
        office_address: db.saasConfig.officeAddress || '',
        base_domain: db.saasConfig.baseDomain || 'schoolerp.in',
        plans: db.saasConfig.plans || []
      };
      const { error } = await supabase.from('saas_config').upsert(cfg, { onConflict: 'id' });
      if (error) throw error;
      console.log('✓ Done');
    }

    // 2. Super Admin
    if (db.superAdmin) {
      process.stdout.write('2. Migrating SaaS Super Admin Account... ');
      const admin = {
        username: db.superAdmin.username,
        password_hash: db.superAdmin.passwordHash,
        password_salt: db.superAdmin.passwordSalt,
        role: db.superAdmin.role || 'SuperAdmin',
        created_at: db.superAdmin.createdAt || new Date().toISOString()
      };
      const { error } = await supabase.from('super_admin').upsert(admin, { onConflict: 'username' });
      if (error) throw error;
      console.log(`✓ Done (${admin.username})`);
    }

    // 3. School Tenants
    if (Array.isArray(db.schools) && db.schools.length) {
      process.stdout.write(`3. Migrating School Tenants (${db.schools.length} schools)... `);
      const rows = db.schools.map(s => ({
        id: s.id,
        code: s.code,
        subdomain: s.subdomain,
        name: s.name,
        status: s.status || 'Active',
        admin_username: s.adminUsername || '',
        admin_password_hash: s.adminPasswordHash || '',
        admin_password_salt: s.adminPasswordSalt || '',
        phone: s.phone || '',
        address: s.address || '',
        principal_name: s.principalName || '',
        logo: s.logo || '',
        favicon: s.favicon || '',
        website_logo: s.websiteLogo || '',
        type: s.type || '',
        affiliation: s.affiliation || '',
        established_year: s.establishedYear || '',
        city: s.city || '',
        district: s.district || '',
        state: s.state || '',
        pincode: s.pincode || '',
        country: s.country || 'India',
        official_email: s.officialEmail || '',
        website_title: s.websiteTitle || '',
        plan: s.plan || 'Starter',
        subscription_status: s.subscriptionStatus || 'Active',
        contact_email: s.contactEmail || '',
        alternate_phone: s.alternatePhone || '',
        admin_phone: s.adminPhone || '',
        website_url: s.websiteUrl || '',
        about_school: s.aboutSchool || '',
        school_description: s.schoolDescription || '',
        contact_details: s.contactDetails || {},
        social_links: s.socialLinks || {},
        domain: s.domain || '',
        admin_name: s.adminName || '',
        trial_start_date: s.trialStartDate || null,
        trial_end_date: s.trialEndDate || null,
        website_content: s.websiteContent || {},
        id_card_design: s.idCardDesign || {},
        default_template_id: s.defaultTemplateId || 'royal-blue',
        settings: s.settings || {},
        created_at: s.createdAt || new Date().toISOString(),
        updated_at: s.updatedAt || new Date().toISOString()
      }));
      const { error } = await supabase.from('schools').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 4. Custom Domains
    if (Array.isArray(db.schoolDomains) && db.schoolDomains.length) {
      process.stdout.write(`4. Migrating Custom Domains (${db.schoolDomains.length} records)... `);
      const rows = db.schoolDomains.map(d => ({
        id: d.id,
        school_id: d.school_id,
        school_name: d.school_name || '',
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
      const { error } = await supabase.from('school_domains').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 5. Academic Sessions
    if (Array.isArray(db.academicSessions) && db.academicSessions.length) {
      process.stdout.write(`5. Migrating Academic Sessions (${db.academicSessions.length} sessions)... `);
      const rows = db.academicSessions.map(s => ({
        id: s.id,
        school_id: s.school_id || 'school_gjv_default',
        session_name: s.session_name,
        start_date: s.start_date || null,
        end_date: s.end_date || null,
        is_active: Boolean(s.is_active),
        status: s.status || 'Active',
        created_at: s.created_at || new Date().toISOString(),
        updated_at: s.updated_at || new Date().toISOString(),
        migrated_at: s.migrated_at || null
      }));
      const { error } = await supabase.from('academic_sessions').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 6. Students
    if (Array.isArray(db.students) && db.students.length) {
      process.stdout.write(`6. Migrating Students (${db.students.length} students)... `);
      const rows = db.students.map(st => ({
        id: st.id || st.admissionNo,
        school_id: st.school_id || 'school_gjv_default',
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
      const { error } = await supabase.from('students').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 7. Teachers & Login
    if (Array.isArray(db.teachers) && db.teachers.length) {
      process.stdout.write(`7. Migrating Teachers (${db.teachers.length} faculty members)... `);
      const rows = db.teachers.map(t => ({
        id: t.id,
        school_id: t.school_id || 'school_gjv_default',
        emp_id: t.empId || t.emp_id,
        name: t.name,
        father_husband: t.fatherHusband || null,
        photo: t.photo || null,
        gender: t.gender || null,
        dob: t.dob || null,
        mobile: t.mobile || null,
        alt_mobile: t.altMobile || null,
        email: t.email || null,
        aadhaar: t.aadhaar || null,
        pan: t.pan || null,
        qualification: t.qualification || null,
        experience: t.experience || null,
        designation: t.designation || null,
        employment_type: t.employmentType || null,
        subject: t.subject || null,
        assigned_subjects: t.assignedSubjects || [],
        class_teacher: t.classTeacher || null,
        assigned_class: t.assignedClass || null,
        assigned_section: t.assignedSection || null,
        assigned_classes: t.assignedClasses || [],
        joining_date: t.joiningDate || null,
        salary: Number(t.salary || 0),
        status: t.status || 'Active',
        address: t.address || null,
        blood_group: t.bloodGroup || null,
        emergency_contact: t.emergencyContact || null,
        bank_details: t.bankDetails || {},
        signature: t.signature || null,
        documents: t.documents || [],
        login_username: t.loginUsername || null,
        last_login: t.lastLogin || null,
        created_at: t.createdAt || new Date().toISOString(),
        updated_at: t.updatedAt || new Date().toISOString()
      }));
      const { error } = await supabase.from('teachers').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    if (Array.isArray(db.teacherLogin) && db.teacherLogin.length) {
      process.stdout.write(`8. Migrating Teacher Logins (${db.teacherLogin.length} credentials)... `);
      const rows = db.teacherLogin.map(tl => ({
        id: tl.id,
        school_id: tl.school_id || 'school_gjv_default',
        teacher_id: tl.teacher_id,
        teacher_emp_id: tl.teacher_emp_id || tl.teacher_id,
        username: tl.username,
        password_hash: tl.password_hash,
        password_salt: tl.password_salt,
        login_status: tl.login_status || 'Active',
        status: tl.status || 'Active',
        force_password_change: Boolean(tl.force_password_change),
        last_login: tl.last_login || null,
        created_at: tl.created_at || new Date().toISOString(),
        updated_at: tl.updated_at || new Date().toISOString()
      }));
      const { error } = await supabase.from('teacher_login').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 9. Fees
    if (Array.isArray(db.fees) && db.fees.length) {
      process.stdout.write(`9. Migrating Fee Transactions (${db.fees.length} collections)... `);
      const rows = db.fees.map(f => ({
        id: f.id,
        school_id: f.school_id || 'school_gjv_default',
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
      const { error } = await supabase.from('fees').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 10. Print Center Accounts
    if (Array.isArray(db.printCenterAccounts) && db.printCenterAccounts.length) {
      process.stdout.write(`10. Migrating Print Center Accounts (${db.printCenterAccounts.length} accounts)... `);
      const rows = db.printCenterAccounts.map(pa => ({
        id: pa.id,
        school_id: pa.school_id || 'school_gjv_default',
        school_name: pa.school_name || '',
        school_code: pa.school_code || '',
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
      const { error } = await supabase.from('print_center_accounts').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 11. Demo Requests & Inquiries
    if (Array.isArray(db.saasDemoRequests) && db.saasDemoRequests.length) {
      process.stdout.write(`11. Migrating SaaS Demo Requests (${db.saasDemoRequests.length} leads)... `);
      const rows = db.saasDemoRequests.map(d => ({
        id: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        school_name: d.schoolName || d.school_name,
        student_count: String(d.studentCount || d.student_count || ''),
        subdomain: d.subdomain || null,
        message: d.message || null,
        source: d.source || 'Website',
        status: d.status || 'New',
        created_at: d.createdAt || d.created_at || new Date().toISOString()
      }));
      const { error } = await supabase.from('saas_demo_requests').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} rows)`);
    }

    // 12. School Settings & Website Content
    if (db.settings && typeof db.settings === 'object') {
      process.stdout.write('12. Migrating School Settings & Content... ');
      const rows = Object.entries(db.settings).map(([key, val]) => ({
        id: `school_gjv_default_${key}`,
        school_id: 'school_gjv_default',
        key,
        data: val,
        updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('school_settings').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      console.log(`✓ Done (${rows.length} setting keys)`);
    }

    console.log('\n======================================================');
    console.log('🎉 SUPABASE DATA MIGRATION COMPLETED SUCCESSFULLY! 🎉');
    console.log('All school records, accounts, and ledgers are now in PostgreSQL.');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ MIGRATION FAILED:', err.message || err);
    process.exit(1);
  }
}

migrate();
