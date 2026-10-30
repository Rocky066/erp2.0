-- ==============================================================================
-- SCHOOL ERP SAAS — COMPLETE SUPABASE POSTGRESQL SCHEMA MIGRATION
-- Migration: 20261030000000_init_school_erp_schema.sql
-- Description: Creates multi-tenant tables, indexes, constraints, and Row Level Security.
-- Safe execution: Idempotent (IF NOT EXISTS), preserves existing tables without drops.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. SAAS PLATFORM CONFIGURATION & SUPER ADMIN
CREATE TABLE IF NOT EXISTS saas_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    company_name TEXT DEFAULT 'School ERP SaaS',
    product_name TEXT DEFAULT 'School Management System',
    headline TEXT DEFAULT 'Next-Generation Multi-Tenant School Management Platform',
    subheadline TEXT DEFAULT 'Empowering K-12 institutions with automated admissions, fee collection, attendance, and instant student ID & admit card generation.',
    helpline_phone TEXT,
    helpline_whatsapp TEXT,
    sales_email TEXT,
    support_email TEXT,
    office_address TEXT,
    base_domain TEXT DEFAULT 'schoolerp.in',
    plans JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS super_admin (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT DEFAULT 'SuperAdmin',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. SCHOOL TENANTS
CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    subdomain TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    admin_username TEXT,
    admin_password_hash TEXT,
    admin_password_salt TEXT,
    phone TEXT,
    address TEXT,
    principal_name TEXT,
    logo TEXT,
    favicon TEXT,
    website_logo TEXT,
    type TEXT,
    affiliation TEXT,
    established_year TEXT,
    city TEXT,
    district TEXT,
    state TEXT,
    pincode TEXT,
    country TEXT DEFAULT 'India',
    official_email TEXT,
    website_title TEXT,
    plan TEXT DEFAULT 'Starter',
    subscription_status TEXT DEFAULT 'Active',
    contact_email TEXT,
    alternate_phone TEXT,
    admin_phone TEXT,
    website_url TEXT,
    about_school TEXT,
    school_description TEXT,
    contact_details JSONB DEFAULT '{}'::jsonb,
    social_links JSONB DEFAULT '{}'::jsonb,
    domain TEXT,
    admin_name TEXT,
    trial_start_date TIMESTAMPTZ,
    trial_end_date TIMESTAMPTZ,
    website_content JSONB DEFAULT '{}'::jsonb,
    id_card_design JSONB DEFAULT '{}'::jsonb,
    default_template_id TEXT DEFAULT 'royal-blue',
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. SCHOOL CUSTOM DOMAINS & ROUTING
CREATE TABLE IF NOT EXISTS school_domains (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_name TEXT,
    domain TEXT UNIQUE NOT NULL,
    verification_status TEXT DEFAULT 'Pending DNS',
    activation_status TEXT DEFAULT 'Inactive',
    ssl_status TEXT DEFAULT 'Pending',
    verification_token TEXT,
    txt_record_name TEXT,
    txt_record_value TEXT,
    cname_target TEXT DEFAULT 'cname.vercel-dns.com',
    a_record_ip TEXT DEFAULT '76.76.21.21',
    ttl INTEGER DEFAULT 600,
    dns_records JSONB DEFAULT '[]'::jsonb,
    dns_status TEXT DEFAULT 'Pending',
    routing_status TEXT DEFAULT 'Inactive',
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domain_audit_logs (
    id TEXT PRIMARY KEY,
    school_id TEXT,
    school_name TEXT,
    action TEXT NOT NULL,
    old_domain TEXT,
    new_domain TEXT,
    performed_by TEXT,
    details TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 5. ACADEMIC SESSIONS
CREATE TABLE IF NOT EXISTS academic_sessions (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    session_name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    migrated_at TIMESTAMPTZ
);

-- 6. STUDENTS
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    admission_no TEXT NOT NULL,
    name TEXT NOT NULL,
    dob DATE,
    gender TEXT,
    student_aadhaar TEXT,
    class_name TEXT NOT NULL,
    section TEXT DEFAULT 'A',
    roll_no TEXT,
    father_name TEXT,
    father_aadhaar TEXT,
    mother_name TEXT,
    guardian_name TEXT,
    mobile TEXT,
    address TEXT,
    admission_fee NUMERIC(10,2) DEFAULT 0,
    monthly_fee NUMERIC(10,2) DEFAULT 0,
    admission_date DATE,
    academic_session TEXT,
    academic_session_id TEXT,
    photo TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. TEACHERS & FACULTY
CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    emp_id TEXT NOT NULL,
    name TEXT NOT NULL,
    father_husband TEXT,
    photo TEXT,
    gender TEXT,
    dob DATE,
    mobile TEXT,
    alt_mobile TEXT,
    email TEXT,
    aadhaar TEXT,
    pan TEXT,
    qualification TEXT,
    experience TEXT,
    designation TEXT,
    employment_type TEXT,
    subject TEXT,
    assigned_subjects JSONB DEFAULT '[]'::jsonb,
    class_teacher TEXT,
    assigned_class TEXT,
    assigned_section TEXT,
    assigned_classes JSONB DEFAULT '[]'::jsonb,
    joining_date DATE,
    salary NUMERIC(10,2) DEFAULT 0,
    status TEXT DEFAULT 'Active',
    address TEXT,
    blood_group TEXT,
    emergency_contact TEXT,
    bank_details JSONB DEFAULT '{}'::jsonb,
    signature TEXT,
    documents JSONB DEFAULT '[]'::jsonb,
    login_username TEXT,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_login (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT,
    teacher_emp_id TEXT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    login_status TEXT DEFAULT 'Active',
    status TEXT DEFAULT 'Active',
    force_password_change BOOLEAN DEFAULT false,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    class_name TEXT NOT NULL,
    section TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    academic_session TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_permissions (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    permissions JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_attendance (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    date DATE NOT NULL,
    status TEXT DEFAULT 'Present',
    remarks TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_salaries (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    month TEXT NOT NULL,
    year INTEGER NOT NULL,
    basic_salary NUMERIC(10,2) DEFAULT 0,
    allowances NUMERIC(10,2) DEFAULT 0,
    deductions NUMERIC(10,2) DEFAULT 0,
    net_salary NUMERIC(10,2) DEFAULT 0,
    status TEXT DEFAULT 'Paid',
    payment_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_leaves (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    employee_code TEXT,
    teacher_name TEXT,
    leave_type TEXT NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    number_of_days NUMERIC(4,1) DEFAULT 1,
    reason TEXT,
    document_url TEXT,
    status TEXT DEFAULT 'Pending',
    submitted_at TIMESTAMPTZ DEFAULT now(),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    rejected_by TEXT,
    rejected_at TIMESTAMPTZ,
    admin_remarks TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_audit_logs (
    id TEXT PRIMARY KEY,
    school_id TEXT,
    emp_id TEXT,
    action TEXT NOT NULL,
    description TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 8. FEES & FINANCIAL LEDGERS
CREATE TABLE IF NOT EXISTS fees (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id TEXT,
    admission_number TEXT,
    student_name TEXT,
    class_id TEXT,
    class_name TEXT,
    section_id TEXT,
    section TEXT,
    receipt_no TEXT,
    legacy_due_id TEXT,
    source TEXT,
    academic_session_id TEXT,
    academic_session TEXT,
    fee_type TEXT,
    fee_heads JSONB DEFAULT '[]'::jsonb,
    expected_amount NUMERIC(10,2) DEFAULT 0,
    gross_amount NUMERIC(10,2) DEFAULT 0,
    discount_amount NUMERIC(10,2) DEFAULT 0,
    scholarship_amount NUMERIC(10,2) DEFAULT 0,
    amount NUMERIC(10,2) DEFAULT 0,
    late_fee NUMERIC(10,2) DEFAULT 0,
    total_received NUMERIC(10,2) DEFAULT 0,
    paid_amount NUMERIC(10,2) DEFAULT 0,
    applied_amount NUMERIC(10,2) DEFAULT 0,
    advance_amount NUMERIC(10,2) DEFAULT 0,
    cumulative_paid NUMERIC(10,2) DEFAULT 0,
    due_balance NUMERIC(10,2) DEFAULT 0,
    payment_status TEXT,
    billing_month TEXT,
    payment_mode TEXT,
    reference_no TEXT,
    remarks TEXT,
    idempotency_key TEXT,
    entered_by TEXT,
    date DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_structures (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_session TEXT NOT NULL,
    class_name TEXT NOT NULL,
    structures JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. STUDENT ATTENDANCE
CREATE TABLE IF NOT EXISTS student_attendance (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    teacher_id TEXT,
    class_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    attendance_date DATE NOT NULL,
    status TEXT DEFAULT 'Present',
    remarks TEXT,
    academic_session TEXT,
    academic_session_id TEXT,
    marked_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 10. EXAMINATIONS & MARKS
CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    exam_term TEXT,
    class_name TEXT NOT NULL,
    section TEXT,
    session TEXT,
    subject TEXT NOT NULL,
    max_marks INTEGER DEFAULT 100,
    pass_marks INTEGER DEFAULT 33,
    date DATE,
    time TEXT,
    room TEXT,
    status TEXT DEFAULT 'Scheduled',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_results (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    admission_number TEXT,
    student_name TEXT,
    teacher_id TEXT,
    subject_id TEXT,
    subject_name TEXT,
    exam_id TEXT,
    exam_term TEXT,
    class_id TEXT,
    class_name TEXT,
    section_id TEXT,
    section TEXT,
    academic_session TEXT,
    marks_obtained NUMERIC(5,2),
    maximum_marks NUMERIC(5,2) DEFAULT 100,
    pass_marks NUMERIC(5,2) DEFAULT 33,
    attendance_status TEXT DEFAULT 'Present',
    grade TEXT,
    result_status TEXT,
    remarks TEXT,
    entered_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 11. NOTICES, GALLERY & WEBSITE DATA
CREATE TABLE IF NOT EXISTS notices (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    date DATE NOT NULL,
    target TEXT DEFAULT 'All',
    is_urgent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gallery (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title TEXT,
    image TEXT NOT NULL,
    date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadership (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    qualification TEXT,
    designation TEXT NOT NULL,
    message TEXT,
    photo TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admission_applications (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    dob DATE,
    gender TEXT,
    class_name TEXT NOT NULL,
    father_name TEXT,
    mother_name TEXT,
    mobile TEXT NOT NULL,
    email TEXT,
    address TEXT,
    application_status TEXT DEFAULT 'Pending Review',
    submission_date TIMESTAMPTZ DEFAULT now(),
    remarks TEXT
);

CREATE TABLE IF NOT EXISTS saas_demo_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    school_name TEXT NOT NULL,
    student_count TEXT,
    subdomain TEXT,
    message TEXT,
    source TEXT DEFAULT 'Website',
    status TEXT DEFAULT 'New',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 12. PRINT CENTER PORTAL
CREATE TABLE IF NOT EXISTS print_center_accounts (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_name TEXT,
    school_code TEXT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    access_enabled BOOLEAN DEFAULT true,
    token_version INTEGER DEFAULT 1,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_center_audit_logs (
    id TEXT PRIMARY KEY,
    school_id TEXT,
    school_name TEXT,
    action TEXT NOT NULL,
    performed_by TEXT,
    role TEXT,
    details TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 13. WHATSAPP MESSAGE LOGS
CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
    id TEXT PRIMARY KEY,
    school_id TEXT,
    student_id TEXT,
    student_name TEXT,
    parent_name TEXT,
    mobile_number TEXT,
    message_type TEXT,
    template_name TEXT,
    language_code TEXT,
    academic_session TEXT,
    meta_message_id TEXT,
    meta_http_status INTEGER,
    status TEXT,
    sent_time TIMESTAMPTZ,
    delivered_time TIMESTAMPTZ,
    error_message TEXT,
    deduplication_key TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 14. TENANT-SPECIFIC SETTINGS STORE
CREATE TABLE IF NOT EXISTS school_settings (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unq_school_setting UNIQUE (school_id, key)
);

-- ==============================================================================
-- INDEXES FOR FAST MULTI-TENANT QUERYING & HIGH PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_schools_code ON schools(code);
CREATE INDEX IF NOT EXISTS idx_schools_subdomain ON schools(subdomain);
CREATE INDEX IF NOT EXISTS idx_school_domains_school_id ON school_domains(school_id);
CREATE INDEX IF NOT EXISTS idx_school_domains_domain ON school_domains(domain);
CREATE INDEX IF NOT EXISTS idx_academic_sessions_school_id ON academic_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_admission_no ON students(school_id, admission_no);
CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON teachers(school_id);
CREATE INDEX IF NOT EXISTS idx_teachers_emp_id ON teachers(school_id, emp_id);
CREATE INDEX IF NOT EXISTS idx_teacher_login_username ON teacher_login(username);
CREATE INDEX IF NOT EXISTS idx_fees_school_id ON fees(school_id);
CREATE INDEX IF NOT EXISTS idx_fees_student_id ON fees(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_fees_receipt_no ON fees(school_id, receipt_no);
CREATE INDEX IF NOT EXISTS idx_student_attendance_school_date ON student_attendance(school_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_exam_results_school_id ON exam_results(school_id);
CREATE INDEX IF NOT EXISTS idx_notices_school_id ON notices(school_id);
CREATE INDEX IF NOT EXISTS idx_print_accounts_school_id ON print_center_accounts(school_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) & STRICT MULTI-TENANT ACCESS POLICIES
-- ==============================================================================
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_login ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE leadership ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_center_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;

-- Service-Role Bypass Policy: The backend serverless functions connect using the service_role key,
-- which securely has full tenant isolation handled by server-side query filtering.
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'schools', 'school_domains', 'academic_sessions', 'students', 'teachers',
        'teacher_login', 'teacher_assignments', 'teacher_permissions', 'teacher_attendance',
        'teacher_salaries', 'teacher_leaves', 'fees', 'fee_structures', 'student_attendance',
        'exams', 'exam_results', 'notices', 'gallery', 'leadership', 'admission_applications',
        'print_center_accounts', 'school_settings'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS service_role_bypass_%s ON %I;', tbl, tbl);
        EXECUTE format('CREATE POLICY service_role_bypass_%s ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);', tbl, tbl);
    END LOOP;
END $$;
