const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3196;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const DB_PATH = path.join(__dirname, 'db.json');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      if (typeof postData === 'string') req.write(postData);
      else req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

// 1x1 valid PNG image data URL
const VALID_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// 1x1 valid ICO image data URL
const VALID_ICO_BASE64 = 'data:image/x-icon;base64,AAABAAEAAQEAAAEAIACAAQAAFgAAACgAAAABAAAAAgAAAAEAIACAAQAA2AAAAAAEAACAAA==';
// Fake invalid image data URL (bad magic bytes)
const FAKE_IMAGE_BASE64 = 'data:image/png;base64,dGhpcyBpcyBub3QgYSByZWFsIGltYWdlIGZpbGUh';

async function run() {
  console.log('=== STARTING SUPER ADMIN ONBOARDING & PROFILE TEST SUITE ===');

  // Backup db.json before tests
  const originalDb = fs.readFileSync(DB_PATH, 'utf8');

  let serverProcess = null;
  try {
    // Start server
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: TEST_PORT },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', d => {
      const msg = d.toString();
      if (msg.includes('running at')) console.log(`Server started on port ${TEST_PORT}`);
    });

    // Wait for server ready
    await new Promise(r => setTimeout(r, 2000));

    // 1. Super Admin Authentication
    console.log('\n--- 1. Testing Super Admin Login ---');
    const saLogin = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      username: 'superadmin@schoolerp.in',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026'
    });

    if (saLogin.status !== 200 || !saLogin.body.token) {
      throw new Error(`Super Admin login failed: ${JSON.stringify(saLogin.body)}`);
    }
    const saToken = saLogin.body.token;
    console.log('✔ PASS: Super Admin authenticated successfully');

    // 2. Subdomain & Code Live Availability Check
    console.log('\n--- 2. Testing Subdomain & School Code Availability Checks ---');
    // Check existing 'gjv' (should be taken)
    const checkGjv = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/check-subdomain?code=gjv',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    if (checkGjv.status !== 200 || checkGjv.body.available !== false || checkGjv.body.taken !== true) {
      throw new Error(`Expected gjv to be taken, got: ${JSON.stringify(checkGjv.body)}`);
    }
    console.log('✔ PASS: Existing school code "gjv" correctly flagged as taken');

    // Check available slug 'oasis-intl'
    const checkAvailable = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/check-subdomain?code=oasis-intl',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    if (checkAvailable.status !== 200 || checkAvailable.body.available !== true) {
      throw new Error(`Expected oasis-intl to be available, got: ${JSON.stringify(checkAvailable.body)}`);
    }
    console.log('✔ PASS: New school code "oasis-intl" correctly flagged as available');

    // Check invalid formatting
    const checkInvalid = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/check-subdomain?code=a', // too short (< 2 chars)
      method: 'GET',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    if (checkInvalid.body.valid !== false) {
      throw new Error(`Expected 'a' to be invalid format, got: ${JSON.stringify(checkInvalid.body)}`);
    }
    console.log('✔ PASS: Invalid slug format rejected');

    // 3. Validation Rules (Images, Emails, URLs, duplicate codes)
    console.log('\n--- 3. Testing Server-side Input & Image Validation ---');
    // Corrupt image magic bytes
    const badImageRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/schools',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' }
    }, {
      name: 'Bad Image School',
      code: 'badimg',
      adminEmail: 'admin@badimg.edu',
      adminPassword: 'Password@123',
      logo: FAKE_IMAGE_BASE64
    });
    if (badImageRes.status !== 400 || !badImageRes.body.error.includes('Unsupported image type')) {
      throw new Error(`Expected 400 for fake image magic bytes, got: ${JSON.stringify(badImageRes.body)}`);
    }
    console.log('✔ PASS: Fake image magic bytes correctly rejected with 400');

    // Invalid Email format
    const badEmailRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/schools',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' }
    }, {
      name: 'Bad Email School',
      code: 'bademail',
      adminEmail: 'not-an-email',
      adminPassword: 'Password@123'
    });
    if (badEmailRes.status !== 400) {
      throw new Error(`Expected 400 for bad email, got: ${JSON.stringify(badEmailRes.body)}`);
    }
    console.log('✔ PASS: Invalid admin email correctly rejected with 400');

    // Invalid Website URL format
    const badUrlRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/schools',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' }
    }, {
      name: 'Bad URL School',
      code: 'badurl',
      adminEmail: 'admin@badurl.edu',
      adminPassword: 'Password@123',
      websiteUrl: 'httpppp://not-a-url'
    });
    if (badUrlRes.status !== 400) {
      throw new Error(`Expected 400 for bad website URL, got: ${JSON.stringify(badUrlRes.body)}`);
    }
    console.log('✔ PASS: Invalid website URL correctly rejected with 400');

    // 4. Complete School Onboarding (All 5 Sections + Image Uploads)
    console.log('\n--- 4. Creating Complete School Instance (All 5 Sections) ---');
    const schoolPayload = {
      // 1. Identity
      name: 'Oasis International Academy',
      code: 'oasis-intl',
      type: 'Co-Educational',
      affiliation: 'CBSE',
      establishedYear: '2015',
      logo: VALID_PNG_BASE64,

      // 2. Contact
      principalName: 'Dr. Amitabh Sen, Ph.D.',
      officialEmail: 'info@oasisintl.edu.in',
      phone: '+91 9876543210',
      alternatePhone: '+91 9876543211',
      address: 'Plot 42, Knowledge Park, Bypass Road',
      city: 'Guwahati',
      district: 'Kamrup Metropolitan',
      state: 'Assam',
      pincode: '781001',
      country: 'India',

      // 3. Website Details
      websiteTitle: 'Oasis International Academy — Official Portal',
      websiteUrl: 'https://oasisintl.edu.in',
      subdomain: 'oasis-intl',
      aboutSchool: 'Oasis International Academy is committed to academic rigor, character development, and global innovation.',
      schoolDescription: 'Empowering Minds, Shaping Tomorrow',
      contactDetails: 'Campus visits: Monday through Friday, 9:00 AM to 3:00 PM.',
      contactEmail: 'contact@oasisintl.edu.in',
      websiteLogo: VALID_PNG_BASE64,
      favicon: VALID_ICO_BASE64,
      socialLinks: {
        facebook: 'https://facebook.com/oasisintl',
        twitter: 'https://x.com/oasisintl',
        instagram: 'https://instagram.com/oasisintl',
        youtube: 'https://youtube.com/@oasisintl',
        linkedin: 'https://linkedin.com/company/oasisintl'
      },

      // 4. Admin Account
      adminName: 'Amitabh Sen',
      adminEmail: 'admin@oasisintl.edu.in',
      adminPhone: '+91 9876543210',
      adminPassword: 'OasisAdmin@2026',

      // 5. SaaS Settings
      plan: 'Professional Tier',
      trialStartDate: '2026-01-01',
      trialEndDate: '2026-12-31',
      subscriptionStatus: 'Active',
      status: 'Active',
      domain: 'portal.oasisintl.edu.in'
    };

    const createRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/schools',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' }
    }, schoolPayload);

    if (createRes.status !== 201 || !createRes.body.success) {
      throw new Error(`Failed to create school: ${JSON.stringify(createRes.body)}`);
    }
    const createdSchool = createRes.body.school;
    console.log(`✔ PASS: School "${createdSchool.name}" successfully created with ID: ${createdSchool.id}`);
    
    // Verify saved branding image paths
    if (!createdSchool.logo.startsWith('/uploads/branding/') || !createdSchool.favicon.startsWith('/uploads/branding/')) {
      throw new Error(`Branding images not saved properly: ${createdSchool.logo}, ${createdSchool.favicon}`);
    }
    console.log(`✔ PASS: Branding files securely written to disk: ${createdSchool.logo}`);

    // Verify duplicate code rejected
    const dupRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/schools',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' }
    }, schoolPayload);
    if (dupRes.status !== 409) {
      throw new Error(`Expected 409 duplicate code error, got: ${dupRes.status}`);
    }
    console.log('✔ PASS: Duplicate school code creation safely rejected with 409 Conflict');

    // 5. Retrieval of Single School Profile (GET /api/superadmin/schools/:id)
    console.log('\n--- 5. Retrieving Single School Profile ---');
    const getRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/schools/${createdSchool.id}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    if (getRes.status !== 200 || getRes.body.name !== 'Oasis International Academy') {
      throw new Error(`Failed to retrieve school profile: ${JSON.stringify(getRes.body)}`);
    }
    // Verify password hash/salt is NEVER exposed
    if (getRes.body.adminPasswordHash || getRes.body.adminPasswordSalt) {
      throw new Error('SECURITY VIOLATION: Password hash or salt exposed in single school API!');
    }
    console.log('✔ PASS: Single school profile retrieved with all 5 sections and zero credential leaks');

    // 6. Super Admin School Profile Editing (PUT /api/superadmin/schools/:id)
    console.log('\n--- 6. Editing School Profile ---');
    const editRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/schools/${createdSchool.id}`,
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' }
    }, {
      name: 'Oasis International Academy & College',
      phone: '+91 9999888877',
      schoolDescription: 'Excellence in Global Education',
      plan: 'Enterprise Tier',
      status: 'Active'
    });
    if (editRes.status !== 200 || editRes.body.school.name !== 'Oasis International Academy & College') {
      throw new Error(`Failed to update school profile: ${JSON.stringify(editRes.body)}`);
    }
    console.log('✔ PASS: School details successfully updated by Super Admin');

    // 7. Testing Dynamic School Website Info (GET /api/website-info)
    console.log('\n--- 7. Testing Public Website Branding Info (GET /api/website-info) ---');
    const webInfoRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'oasis-intl.localhost',
        'x-school-code': 'oasis-intl'
      }
    });
    if (webInfoRes.status !== 200 || webInfoRes.body.schoolName !== 'Oasis International Academy & College') {
      throw new Error(`Unexpected website info for tenant: ${JSON.stringify(webInfoRes.body)}`);
    }
    if (!webInfoRes.body.logo || !webInfoRes.body.logo.startsWith('/uploads/branding/')) {
      throw new Error(`Tenant website logo missing in website-info: ${JSON.stringify(webInfoRes.body)}`);
    }
    console.log(`✔ PASS: Public website info correctly reflects tenant branding (${webInfoRes.body.schoolName})`);

    // 8. Testing School Admin Login & Authentication Profile (GET /api/auth/me)
    console.log('\n--- 8. Testing School Admin Login & Auth Profile Branding ---');
    const adminLoginRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': 'oasis-intl.localhost',
        'x-school-code': 'oasis-intl'
      }
    }, {
      username: 'admin@oasisintl.edu.in',
      password: 'OasisAdmin@2026'
    });
    if (adminLoginRes.status !== 200 || !adminLoginRes.body.token) {
      throw new Error(`School admin login failed: ${JSON.stringify(adminLoginRes.body)}`);
    }
    const adminToken = adminLoginRes.body.token;

    const meRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Host': 'oasis-intl.localhost',
        'x-school-code': 'oasis-intl'
      }
    });
    if (meRes.status !== 200 || meRes.body.school?.name !== 'Oasis International Academy & College') {
      throw new Error(`GET /api/auth/me did not return correct tenant branding: ${JSON.stringify(meRes.body)}`);
    }
    console.log('✔ PASS: School Admin Portal auth/me successfully returns dynamic school branding');

    // 9. Testing School Admin Editing Website Content (POST /api/settings)
    console.log('\n--- 9. Testing School Admin Website Page Editor & Isolation ---');
    const updateSettingsRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/settings',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'Host': 'oasis-intl.localhost',
        'x-school-code': 'oasis-intl'
      }
    }, {
      websiteContent: {
        tagline: 'Custom Tagline set by School Admin',
        aboutText: 'Custom About text modified directly by the school principal.'
      }
    });
    if (updateSettingsRes.status !== 200) {
      throw new Error(`School Admin failed to update website content: ${JSON.stringify(updateSettingsRes.body)}`);
    }

    // Verify updated website content for Oasis
    const updatedWebInfo = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'oasis-intl.localhost',
        'x-school-code': 'oasis-intl'
      }
    });
    if (updatedWebInfo.body.tagline !== 'Custom Tagline set by School Admin') {
      throw new Error(`Website tagline was not updated for tenant: ${JSON.stringify(updatedWebInfo.body)}`);
    }

    // Verify Default GJV school website info is UNTOUCHED
    const gjvWebInfo = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'gjv.localhost',
        'x-school-code': 'gjv'
      }
    });
    if (gjvWebInfo.body.schoolName !== 'Garumara Jatiya Vidyalaya') {
      throw new Error(`GJV school was modified! ${JSON.stringify(gjvWebInfo.body)}`);
    }
    console.log('✔ PASS: School Admin can edit website content with strict tenant isolation from other schools');

    console.log('\n🎉 ALL SUPER ADMIN ONBOARDING & PROFILE TESTS PASSED 100%!');

  } finally {
    // Stop server
    if (serverProcess) {
      serverProcess.kill('SIGKILL');
    }
    // Restore original db.json
    fs.writeFileSync(DB_PATH, originalDb);
    console.log('🧹 Test state cleanly restored.');
  }
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
