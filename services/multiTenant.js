const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SCHOOL_ID = 'school_gjv_default';
const DEFAULT_SCHOOL_CODE = 'gjv';
const SUPER_ADMIN_USERNAME = 'superadmin@schoolerp.in';

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone) {
  if (!phone) return true;
  const clean = String(phone).replace(/[\s\-\(\)\+]/g, '');
  return clean.length >= 7 && clean.length <= 15 && /^\d+$/.test(clean);
}

function isValidUrl(url) {
  if (!url) return true;
  return /^(https?:\/\/|\/\/)[^\s/$.?#].[^\s]*$/i.test(String(url).trim());
}

function isValidSchoolCode(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(clean) && clean.length >= 2 && clean.length <= 40;
}

function saveBrandingImage(dataUrl, schoolId, imageType, uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'branding')) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image format.');
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Image size exceeds 2 MB limit.');

  let ext = '.png';
  let isValid = false;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    ext = '.png';
    isValid = true;
  } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    ext = '.jpg';
    isValid = true;
  } else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    ext = '.webp';
    isValid = true;
  } else if (buffer.length >= 4 && ((buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) || (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x02 && buffer[3] === 0x00))) {
    ext = '.ico';
    isValid = true;
  }

  if (!isValid) throw new Error('Unsupported image type. Only PNG, JPEG, WEBP, and ICO files are permitted.');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const safeSchoolId = String(schoolId || 'school').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const fileName = `${safeSchoolId}_${imageType}_${Date.now()}${ext}`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer, { flag: 'w', mode: 0o644 });
  return `/uploads/branding/${fileName}`;
}

function getTenantId(item) {
  return item?.school_id || null;
}

function matchTenant(item, schoolId) {
  if (!item || !schoolId) return false;
  if (item.school_id) return item.school_id === schoolId;
  return schoolId === DEFAULT_SCHOOL_ID;
}

const DEFAULT_SAAS_CONFIG = {
  companyName: 'EduPulse Cloud SaaS',
  productName: 'EduPulse School ERP',
  baseDomain: 'schoolerp.in',
  headline: 'The Next-Generation Cloud ERP & Subdomain Platform for Modern Schools',
  subheadline: 'Automate admissions, fee collections, real-time WhatsApp attendance alerts, exams, and academic workflows with 100% data isolation and a dedicated school subdomain.',
  helplinePhone: '+91 8099456097',
  helplineWhatsapp: '+918099456097',
  salesEmail: 'sales@schoolerp.in',
  supportEmail: 'support@schoolerp.in',
  officeAddress: 'Tech Hub Guwahati, GS Road, Assam – 781005, India',
  plans: [
    {
      id: 'free-trial',
      name: 'Free 30-Day Trial',
      priceMonthly: 0,
      priceAnnual: 0,
      billing: 'Free 30-Day Trial',
      studentLimit: 'Up to 100 Students',
      features: [
        'Full ERP Core Features',
        'Dedicated School Subdomain',
        'Student Directory & Profiles',
        'Daily Attendance Marking',
        'Fee Ledger & Digital Receipts',
        'Single Academic Session',
        'Community Support'
      ],
      isPopular: false,
      badge: 'Zero Commitment'
    },
    {
      id: 'starter',
      name: 'Starter Tier',
      priceMonthly: 2499,
      priceAnnual: 1999,
      billing: 'Per school / month',
      studentLimit: 'Up to 300 Students',
      features: [
        'Everything in Free Trial',
        'Dedicated School Subdomain',
        'Automated Fee Receipts & SMS',
        'Exam Result Sheets & Grades',
        'Multi-Session Archives',
        'Standard Email Support',
        'Daily Automated Cloud Backups'
      ],
      isPopular: false
    },
    {
      id: 'professional',
      name: 'Professional Tier',
      priceMonthly: 5999,
      priceAnnual: 4799,
      billing: 'Per school / month',
      studentLimit: 'Up to 1,000 Students',
      features: [
        'Everything in Starter',
        'Meta WhatsApp Cloud API Integration',
        'ID Cards & Admit Cards Generator',
        'Online Public Admission Portal',
        'Teacher / Faculty Mobile Portal',
        'Custom Public Website Content Editor',
        'Priority WhatsApp & Phone Support'
      ],
      isPopular: true,
      badge: 'Most Popular'
    },
    {
      id: 'enterprise',
      name: 'Enterprise Tier',
      priceMonthly: 12999,
      priceAnnual: 10399,
      billing: 'Per school / month',
      studentLimit: 'Unlimited Students',
      features: [
        'Everything in Professional',
        'Custom Domain CNAME (e.g. portal.yourschool.edu)',
        'Multi-Campus & Branch Management',
        'Dedicated Cloud Sharding',
        'Custom Report Card Layouts',
        'White-Label Mobile App Options',
        '24/7 Dedicated Account Manager'
      ],
      isPopular: false,
      badge: 'For Multi-Branch Schools'
    }
  ]
};

function isSchoolTenantRequest(req, db) {
  const schools = Array.isArray(db?.schools) ? db.schools : [];

  // 1. Direct School ID Header (useful for API clients & automated testing)
  const headerSchoolId = req.headers['x-school-id'];
  if (headerSchoolId) {
    const found = schools.find(s => s.id === headerSchoolId);
    if (found) return { isSchool: true, school: found, isUnknownSubdomain: false, subdomain: found.code };
    return { isSchool: false, school: null, isUnknownSubdomain: true, subdomain: headerSchoolId };
  }

  // 2. School Code / Subdomain Header
  const headerSchoolCode = req.headers['x-school-code'] || req.headers['x-school-subdomain'];
  if (headerSchoolCode) {
    const clean = String(headerSchoolCode).trim().toLowerCase();
    const found = schools.find(s =>
      String(s.code || '').toLowerCase() === clean ||
      String(s.subdomain || '').toLowerCase() === clean ||
      (s.code === 'gjv' && clean === 'garumara')
    );
    if (found) return { isSchool: true, school: found, isUnknownSubdomain: false, subdomain: clean };
    return { isSchool: false, school: null, isUnknownSubdomain: true, subdomain: clean };
  }

  // 3. School Query Parameter (useful for IP/localhost testing and gateway redirection)
  if (req && req.url) {
    try {
      const qIdx = req.url.indexOf('?');
      if (qIdx !== -1) {
        const queryParams = new URLSearchParams(req.url.slice(qIdx));
        const querySchool = queryParams.get('school') || queryParams.get('school_code') || queryParams.get('school_id') || queryParams.get('subdomain');
        if (querySchool) {
          const clean = String(querySchool).trim().toLowerCase();
          const found = schools.find(s =>
            s.id === querySchool ||
            String(s.code || '').toLowerCase() === clean ||
            String(s.subdomain || '').toLowerCase() === clean ||
            (s.code === 'gjv' && clean === 'garumara')
          );
          if (found) return { isSchool: true, school: found, isUnknownSubdomain: false, subdomain: clean };
          return { isSchool: false, school: null, isUnknownSubdomain: true, subdomain: clean };
        }
      }
    } catch (e) {}
  }

  // 4. Host / Subdomain Resolution
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim().toLowerCase();
  const hostname = host.split(':')[0];

  // Direct custom domain match (supports exact match or with/without www prefix)
  const domainMatch = schools.find(s => {
    if (!s.domain) return false;
    // Strict isolation check: ensure domain record is confirmed Active
    const domRecord = (db?.schoolDomains || []).find(d => d.school_id === s.id && d.domain && d.domain.toLowerCase() === s.domain.toLowerCase());
    if (!domRecord || domRecord.activation_status !== 'Active') {
      return false;
    }
    const sDom = String(s.domain).trim().toLowerCase();
    if (sDom === hostname) return true;
    if (hostname === `www.${sDom}`) return true;
    if (sDom === `www.${hostname}`) return true;
    return false;
  });
  if (domainMatch) return { isSchool: true, school: domainMatch, isUnknownSubdomain: false, subdomain: domainMatch.code, isCustomDomain: true };

  // Reserved host/subdomain words
  const reserved = new Set(['www', 'api', 'superadmin', 'super-admin', 'admin', 'mail', 'app']);

  // Check if naked localhost or raw IP address (Root SaaS Domain)
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  if (isIpAddress || hostname === 'localhost') {
    return { isSchool: false, school: null, isUnknownSubdomain: false, subdomain: null };
  }

  const baseDomain = String(process.env.SAAS_BASE_DOMAIN || db?.saasConfig?.baseDomain || 'schoolerp.in').trim().toLowerCase();
  const isPlatformHost = hostname === baseDomain || hostname === 'www.' + baseDomain || hostname === 'www.localhost';
  if (isPlatformHost) {
    return { isSchool: false, school: null, isUnknownSubdomain: false, subdomain: null };
  }

  // Check if candidate subdomain on localhost or baseDomain
  let candidate = null;
  if (hostname.endsWith('.localhost')) {
    candidate = hostname.slice(0, -'.localhost'.length);
  } else if (hostname.endsWith('.' + baseDomain)) {
    candidate = hostname.slice(0, -('.' + baseDomain).length);
  }

  if (candidate) {
    if (reserved.has(candidate)) {
      return { isSchool: false, school: null, isUnknownSubdomain: false, subdomain: candidate, isReserved: true };
    }
    const clean = candidate.toLowerCase();
    const found = schools.find(s =>
      String(s.subdomain || '').toLowerCase() === clean ||
      String(s.code || '').toLowerCase() === clean ||
      (s.code === 'gjv' && clean === 'garumara')
    );
    if (found) {
      return { isSchool: true, school: found, isUnknownSubdomain: false, subdomain: clean };
    }
    return { isSchool: false, school: null, isUnknownSubdomain: true, subdomain: clean };
  }

  // Foreign / Unknown / Unverified / Disconnected Custom Domain
  // Any external hostname reaching here is neither the SaaS platform domain nor a registered active school domain.
  return { isSchool: false, school: null, isUnknownSubdomain: true, subdomain: hostname, isCustomDomain: true, isUnverifiedDomain: true };
}

function resolveRequestSchool(req, db, options = {}) {
  const check = isSchoolTenantRequest(req, db);
  if (check.isSchool && check.school) return check.school;

  // Never silently fallback to Garumara!
  // Fallback is only allowed if explicitly requested with options.allowDefaultFallback === true
  if (options.allowDefaultFallback === true) {
    const schools = Array.isArray(db?.schools) ? db.schools : [];
    return schools.find(s => s.id === DEFAULT_SCHOOL_ID) || schools.find(s => s.code === DEFAULT_SCHOOL_CODE) || schools[0] || null;
  }

  return null;
}

function ensureMultiTenantSchema(db) {
  let updated = false;

  // 1. Ensure db.schools array
  if (!Array.isArray(db.schools)) {
    db.schools = [];
    updated = true;
  }

  // 2. Ensure default school is registered in db.schools
  let defaultSchool = db.schools.find(s => s.id === DEFAULT_SCHOOL_ID || s.code === DEFAULT_SCHOOL_CODE);
  if (!defaultSchool) {
    defaultSchool = {
      id: DEFAULT_SCHOOL_ID,
      code: DEFAULT_SCHOOL_CODE,
      subdomain: DEFAULT_SCHOOL_CODE,
      name: db.settings?.websiteContent?.schoolName || 'Garumara Jatiya Vidyalaya',
      status: 'Active',
      adminUsername: db.settings?.adminUsername || 'admin@garumarajatiyavidyalaya.in',
      adminPasswordHash: db.settings?.adminPasswordHash,
      adminPasswordSalt: db.settings?.adminPasswordSalt,
      phone: db.settings?.websiteContent?.phone || '+91 8099456097',
      address: db.settings?.websiteContent?.address || 'Garumara, Nagaon, Assam – 782140',
      principalName: db.settings?.websiteContent?.principalName || 'Dr. Anirban Sen, Ph.D.',
      createdAt: new Date().toISOString()
    };
    db.schools.unshift(defaultSchool);
    updated = true;
    // Keep credentials synchronized with db.settings
    if (db.settings?.adminPasswordHash && defaultSchool.adminPasswordHash !== db.settings.adminPasswordHash) {
      defaultSchool.adminPasswordHash = db.settings.adminPasswordHash;
      defaultSchool.adminPasswordSalt = db.settings.adminPasswordSalt;
      defaultSchool.adminUsername = db.settings.adminUsername;
      updated = true;
    }
  }

  // Ensure baseline profile attributes on defaultSchool
  if (defaultSchool) {
    if (!defaultSchool.logo) defaultSchool.logo = '/logo.jpg';
    if (!defaultSchool.favicon) defaultSchool.favicon = '/favicon.ico';
    if (!defaultSchool.websiteLogo) defaultSchool.websiteLogo = '/logo.jpg';
    if (!defaultSchool.type) defaultSchool.type = 'Co-Educational';
    if (!defaultSchool.affiliation) defaultSchool.affiliation = 'State Board (SEBA)';
    if (!defaultSchool.establishedYear) defaultSchool.establishedYear = '2023';
    if (!defaultSchool.city) defaultSchool.city = 'Nagaon';
    if (!defaultSchool.district) defaultSchool.district = 'Nagaon';
    if (!defaultSchool.state) defaultSchool.state = 'Assam';
    if (!defaultSchool.pincode) defaultSchool.pincode = '782140';
    if (!defaultSchool.country) defaultSchool.country = 'India';
    if (!defaultSchool.officialEmail) defaultSchool.officialEmail = 'info@garumarajv.in';
    if (!defaultSchool.websiteTitle) defaultSchool.websiteTitle = 'Garumara Jatiya Vidyalaya - School Management System';
    if (!defaultSchool.plan) defaultSchool.plan = 'Enterprise Plan';
    if (!defaultSchool.subscriptionStatus) defaultSchool.subscriptionStatus = 'Active';
  }

  // 3. Ensure Super Admin account
  if (!db.superAdmin || !db.superAdmin.passwordHash) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('SuperAdmin@2026', salt, 1000, 64, 'sha512').toString('hex');
    db.superAdmin = {
      username: SUPER_ADMIN_USERNAME,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'SuperAdmin',
      createdAt: new Date().toISOString()
    };
    updated = true;
  }

  // 4. Tag all tenant-scoped collections with default school_id
  const tenantCollections = [
    'students',
    'teachers',
    'teacherLogin',
    'teacherAssignments',
    'teacherAttendance',
    'teacherSalaries',
    'teacherLeaves',
    'fees',
    'legacyFeeDues',
    'feeAuditLogs',
    'studentAttendance',
    'attendance',
    'exams',
    'examResults',
    'notices',
    'gallery',
    'leadership',
    'notifications',
    'admissionApplications',
    'academicSessions'
  ];

  for (const col of tenantCollections) {
    if (Array.isArray(db[col])) {
      for (const item of db[col]) {
        if (item && typeof item === 'object' && !item.school_id) {
          item.school_id = DEFAULT_SCHOOL_ID;
          updated = true;
        }
      }
    }
  }

  // Ensure websiteContent and leadership isolation for every school
  if (defaultSchool) {
    if (!defaultSchool.websiteContent || !Object.keys(defaultSchool.websiteContent).length) {
      defaultSchool.websiteContent = JSON.parse(JSON.stringify(db.settings?.websiteContent || {}));
      updated = true;
    } else {
      if (!defaultSchool.websiteContent.aboutText && db.settings?.websiteContent?.aboutText) {
        defaultSchool.websiteContent.aboutText = db.settings.websiteContent.aboutText;
        updated = true;
      }
      if (!defaultSchool.websiteContent.principalMessage && db.settings?.websiteContent?.principalMessage) {
        defaultSchool.websiteContent.principalMessage = db.settings.websiteContent.principalMessage;
        updated = true;
      }
    }
  }

  if (Array.isArray(db.schools)) {
    for (const school of db.schools) {
      if (!school.websiteContent || !Object.keys(school.websiteContent).length) {
        school.websiteContent = {
          schoolName: school.name,
          tagline: school.schoolDescription || school.websiteTitle || '',
          aboutText: school.aboutSchool || '',
          principalName: school.principalName || '',
          principalMessage: `Welcome to ${school.name}. As Principal, it is a privilege to lead our educational community. We believe in nurturing critical thinking, ethical values, and holistic development for every learner.`,
          address: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || school.address || '',
          phone: school.phone || '',
          email: school.officialEmail || school.contactEmail || school.adminUsername || '',
          mapEmbedUrl: '',
          logo: school.logo || '/logo.jpg',
          favicon: school.favicon || '/favicon.ico',
          socialLinks: school.socialLinks || {}
        };
        updated = true;
      }
      if (ensureSchoolLeadership(db, school)) {
        updated = true;
      }
    }
  }

  // 5. Initialize SaaS Platform configuration and lead requests
  if (!db.saasConfig) {
    db.saasConfig = JSON.parse(JSON.stringify(DEFAULT_SAAS_CONFIG));
    updated = true;
  }
  if (!Array.isArray(db.saasDemoRequests)) {
    db.saasDemoRequests = [];
    updated = true;
  }

  return updated;
}

function ensureSchoolLeadership(db, school) {
  if (!db || !school || !school.id) return false;
  if (!Array.isArray(db.leadership)) {
    db.leadership = [];
  }
  const schoolLeaders = db.leadership.filter(l => matchTenant(l, school.id));
  if (schoolLeaders.length > 0) {
    return false;
  }

  const pName = school.principalName || school.websiteContent?.principalName || 'Principal';
  const pMsg = school.websiteContent?.principalMessage || (school.id === DEFAULT_SCHOOL_ID ? (db.settings?.websiteContent?.principalMessage || '') : `Welcome to ${school.name}. As Principal, it is a privilege to lead our educational community. We believe in nurturing critical thinking, ethical values, and holistic development for every learner.`);

  const initialLeaders = [
    {
      id: 'principal',
      school_id: school.id,
      name: pName,
      qualification: school.id === DEFAULT_SCHOOL_ID ? 'B.Ed.' : '',
      designation: `Principal, ${school.name}`,
      message: pMsg,
      photo: school.id === DEFAULT_SCHOOL_ID ? 'uploads/principal.jpg' : ''
    },
    {
      id: 'vice_principal',
      school_id: school.id,
      name: school.id === DEFAULT_SCHOOL_ID ? 'Muzahirul Hoque Anchari' : 'Vice Principal',
      qualification: school.id === DEFAULT_SCHOOL_ID ? 'B Pharm' : '',
      designation: 'Vice Principal',
      message: `At ${school.name}, we aim to provide an environment where students can discover their true capabilities. I welcome all students and parents to work with us to achieve excellence in all domains of life.`,
      photo: school.id === DEFAULT_SCHOOL_ID ? 'uploads/vice_principal.jpg' : ''
    },
    {
      id: 'academic_director',
      school_id: school.id,
      name: school.id === DEFAULT_SCHOOL_ID ? 'Ahiya Alam' : 'Academic Director',
      qualification: school.id === DEFAULT_SCHOOL_ID ? 'BSc' : '',
      designation: 'Academic Director',
      message: 'Our curriculum is designed to balance standard academics with creative thinking and physical education. We strive to provide the best tools and pedagogy to guide our students on their educational journey.',
      photo: school.id === DEFAULT_SCHOOL_ID ? 'uploads/academic_director.jpg' : ''
    }
  ];

  db.leadership.push(...initialLeaders);
  return true;
}

function generateAdmissionNo(db, school, year = new Date().getFullYear()) {
  const prefix = String(school?.code || 'GJV').toUpperCase();
  const schoolStudents = (db.students || []).filter(s => matchTenant(s, school?.id || DEFAULT_SCHOOL_ID));
  const maxSeq = schoolStudents.reduce((max, s) => {
    const match = String(s.admissionNo || '').match(/\d+$/);
    return match ? Math.max(max, parseInt(match[0], 10)) : max;
  }, 0);
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}-${year}-${nextSeq}`;
}

function createScopedBackup(db, school) {
  const schoolId = school?.id || DEFAULT_SCHOOL_ID;
  const isDefault = schoolId === DEFAULT_SCHOOL_ID;

  return {
    school,
    exportedAt: new Date().toISOString(),
    settings: isDefault ? db.settings : {
      schoolName: school.name,
      code: school.code,
      phone: school.phone,
      address: school.address,
      principalName: school.principalName
    },
    students: (db.students || []).filter(s => matchTenant(s, schoolId)),
    teachers: (db.teachers || []).filter(t => matchTenant(t, schoolId)),
    teacherLogin: (db.teacherLogin || []).filter(tl => matchTenant(tl, schoolId)),
    teacherAssignments: (db.teacherAssignments || []).filter(ta => matchTenant(ta, schoolId)),
    teacherAttendance: (db.teacherAttendance || []).filter(ta => matchTenant(ta, schoolId)),
    teacherSalaries: (db.teacherSalaries || []).filter(ts => matchTenant(ts, schoolId)),
    teacherLeaves: (db.teacherLeaves || []).filter(tl => matchTenant(tl, schoolId)),
    fees: (db.fees || []).filter(f => matchTenant(f, schoolId)),
    legacyFeeDues: (db.legacyFeeDues || []).filter(ld => matchTenant(ld, schoolId)),
    studentAttendance: (db.studentAttendance || []).filter(sa => matchTenant(sa, schoolId)),
    attendance: (db.attendance || []).filter(a => matchTenant(a, schoolId)),
    exams: (db.exams || []).filter(e => matchTenant(e, schoolId)),
    examResults: (db.examResults || []).filter(er => matchTenant(er, schoolId)),
    notices: (db.notices || []).filter(n => matchTenant(n, schoolId)),
    gallery: (db.gallery || []).filter(g => matchTenant(g, schoolId)),
    leadership: (db.leadership || []).filter(l => matchTenant(l, schoolId)),
    academicSessions: (db.academicSessions || []).filter(as => matchTenant(as, schoolId))
  };
}

module.exports = {
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
};
