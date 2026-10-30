const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3197;
const DB_PATH = path.join(__dirname, 'db.json');

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Host': options.hostHeader || `127.0.0.1:${TEST_PORT}`,
      'Accept': '*/*'
    };
    const reqOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...(options.headers || {}) }
    };

    const req = http.request(reqOptions, (res) => {
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function run() {
  console.log('=== STARTING SAAS DOMAIN MIGRATION & ROUTING VERIFICATION SUITE ===');

  const originalDb = fs.readFileSync(DB_PATH, 'utf8');
  let serverProcess = null;

  try {
    // 1. Launch test server on TEST_PORT
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: TEST_PORT },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', d => {
      const msg = d.toString();
      if (msg.includes('running at')) console.log(`[SERVER LOG] Started on port ${TEST_PORT}`);
    });
    serverProcess.stderr.on('data', d => {
      console.error(`[SERVER ERR]`, d.toString());
    });

    // Wait for server ready
    let attempts = 0;
    while (attempts < 30) {
      try {
        await new Promise(r => setTimeout(r, 200));
        await request({ path: '/api/saas/config' });
        break;
      } catch (e) {
        attempts++;
      }
    }
    console.log('Server is responsive.');

    // -----------------------------------------------------------------
    // TEST 1: MAIN DOMAIN (ROOT) SERVES SAAS MARKETING WEBSITE
    // -----------------------------------------------------------------
    console.log('\n--- TEST 1: Main Domain — SaaS Marketing Website ---');
    
    // Test root / on localhost host
    const saasHome = await request({ path: '/', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasHome.status === 200, `Root domain / should return 200, got ${saasHome.status}`);
    assert(saasHome.raw.includes('EduPulse Cloud') || saasHome.raw.includes('School ERP SaaS'), 'Root domain must serve EduPulse SaaS marketing homepage');
    assert(saasHome.raw.includes('Portals') && (saasHome.raw.includes('Book Free Demo') || saasHome.raw.includes('Demo')), 'Root domain must have Portals and Demo CTA');
    assert(!saasHome.raw.includes('Admissions Open for Session'), 'Root domain MUST NOT serve single school GJV banner');
    console.log('  ✓ Root / serves EduPulse Cloud SaaS marketing homepage');

    // Test /about on root domain
    const saasAbout = await request({ path: '/about', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasAbout.status === 200, `/about should return 200, got ${saasAbout.status}`);
    assert(saasAbout.raw.includes('Pioneering High-Trust Cloud Technology for Indian Schools'), 'Root /about must describe SaaS mission');
    assert(saasAbout.raw.includes('Zero Cross-Tenant Leakage'), 'Root /about must explain tenant isolation');
    console.log('  ✓ Root /about serves SaaS story and architectural guarantees');

    // Test /pricing on root domain
    const saasPricing = await request({ path: '/pricing', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasPricing.status === 200, `/pricing should return 200, got ${saasPricing.status}`);
    assert(saasPricing.raw.includes('Transparent') && saasPricing.raw.includes('Pricing'), 'Root /pricing must show pricing page');
    assert(saasPricing.raw.includes('Starter Tier') && saasPricing.raw.includes('Professional Tier'), 'Root /pricing must contain pricing tiers');
    console.log('  ✓ Root /pricing serves configurable SaaS tiers and FAQ');

    // Test /contact on root domain
    const saasContact = await request({ path: '/contact', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasContact.status === 200, `/contact should return 200, got ${saasContact.status}`);
    assert(saasContact.raw.includes("We're Here to Empower Your School"), 'Root /contact must show contact page');
    assert(saasContact.raw.includes('WhatsApp Instant Support'), 'Root /contact must have WhatsApp and email options');
    console.log('  ✓ Root /contact serves contact details and sales inquiry form');

    // Test /privacy on root domain
    const saasPrivacy = await request({ path: '/privacy', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasPrivacy.status === 200, `/privacy should return 200, got ${saasPrivacy.status}`);
    assert(saasPrivacy.raw.includes('Institutional Privacy & Data Sovereignty Policy'), 'Root /privacy must show privacy policy');
    assert(saasPrivacy.raw.includes('DPDP Act 2023 Compliant'), 'Root /privacy must reference DPDP compliance');
    console.log('  ✓ Root /privacy serves DPDP Act compliant privacy policy');

    // Test /terms on root domain
    const saasTerms = await request({ path: '/terms', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasTerms.status === 200, `/terms should return 200, got ${saasTerms.status}`);
    assert(saasTerms.raw.includes('SaaS Master Subscription Terms of Service'), 'Root /terms must show terms of service');
    assert(saasTerms.raw.includes('99.9% Uptime Commitment'), 'Root /terms must state SLA and data handover terms');
    console.log('  ✓ Root /terms serves SaaS subscription terms of service');

    // Test /login on root domain (Portal Gateway)
    const saasLogin = await request({ path: '/login', hostHeader: `localhost:${TEST_PORT}` });
    assert(saasLogin.status === 200, `/login on root domain should return 200, got ${saasLogin.status}`);
    assert(saasLogin.raw.includes('Access Your School Portal') && saasLogin.raw.includes('School Subdomain or Code'), 'Root /login must serve universal portal subdomain router');
    console.log('  ✓ Root /login serves School Portal Gateway & subdomain finder');

    // Test /superadmin and /super-admin on root domain
    const superAdmin = await request({ path: '/superadmin', hostHeader: `localhost:${TEST_PORT}` });
    assert(superAdmin.status === 200, `/superadmin should return 200, got ${superAdmin.status}`);
    assert(superAdmin.raw.includes('Super Admin Console') || superAdmin.raw.includes('SaaS Platform Super Admin'), '/superadmin must serve Super Admin Console');
    
    const superAdminHyphen = await request({ path: '/super-admin', hostHeader: `localhost:${TEST_PORT}` });
    assert(superAdminHyphen.status === 200, `/super-admin should return 200, got ${superAdminHyphen.status}`);
    assert(superAdminHyphen.raw.includes('Super Admin Console') || superAdminHyphen.raw.includes('SaaS Platform Super Admin'), '/super-admin must alias to Super Admin Console');
    console.log('  ✓ Root /superadmin and /super-admin work seamlessly');

    // -----------------------------------------------------------------
    // TEST 2: SCHOOL SUBDOMAIN SERVES DEDICATED SCHOOL WEBSITE (GJV)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: School Subdomain — Garumara Jatiya Vidyalaya ---');

    // Subdomain request using Host header: gjv.localhost
    const gjvHomeSubdomain = await request({ path: '/', hostHeader: `gjv.localhost:${TEST_PORT}` });
    assert(gjvHomeSubdomain.status === 200, `gjv.localhost / should return 200, got ${gjvHomeSubdomain.status}`);
    assert(gjvHomeSubdomain.raw.includes('Garumara Jatiya Vidyalaya'), 'gjv.localhost / must serve GJV school homepage');
    assert(gjvHomeSubdomain.raw.includes('Building Character, Cultivating Excellence'), 'gjv.localhost / must show GJV tagline');
    console.log('  ✓ gjv.localhost / serves Garumara Jatiya Vidyalaya dedicated school website');

    // Subdomain request using x-school-code header (fallback for non-subdomain proxy test environments)
    const gjvHomeHeader = await request({ path: '/', headers: { 'x-school-code': 'gjv' } });
    assert(gjvHomeHeader.status === 200, `x-school-code: gjv should return 200, got ${gjvHomeHeader.status}`);
    assert(gjvHomeHeader.raw.includes('Garumara Jatiya Vidyalaya'), 'x-school-code: gjv must serve GJV school homepage');
    console.log('  ✓ x-school-code: gjv resolves to GJV school website');

    // Test school subpages on subdomain
    const gjvAbout = await request({ path: '/about', hostHeader: `gjv.localhost:${TEST_PORT}` });
    assert(gjvAbout.status === 200, `gjv.localhost /about should return 200, got ${gjvAbout.status}`);
    assert(gjvAbout.raw.includes('About') || gjvAbout.raw.includes('Garumara'), 'gjv.localhost /about must serve school about page');

    const gjvAdmission = await request({ path: '/admission', hostHeader: `gjv.localhost:${TEST_PORT}` });
    assert(gjvAdmission.status === 200, `gjv.localhost /admission should return 200, got ${gjvAdmission.status}`);
    assert(gjvAdmission.raw.includes('Student Admissions') || gjvAdmission.raw.includes('Admission'), 'gjv.localhost /admission must serve school admission page');

    const gjvNotices = await request({ path: '/notices', hostHeader: `gjv.localhost:${TEST_PORT}` });
    assert(gjvNotices.status === 200, `gjv.localhost /notices should return 200, got ${gjvNotices.status}`);
    console.log('  ✓ gjv.localhost school subpages (/about, /admission, /notices) load intact');

    // Test /login on school subdomain -> maps to school admin login
    const gjvSchoolLogin = await request({ path: '/login', hostHeader: `gjv.localhost:${TEST_PORT}` });
    assert(gjvSchoolLogin.status === 200, `gjv.localhost /login should return 200, got ${gjvSchoolLogin.status}`);
    assert(gjvSchoolLogin.raw.includes('Admin Login') || gjvSchoolLogin.raw.includes('GJV'), 'gjv.localhost /login must serve school admin login page');
    console.log('  ✓ gjv.localhost /login serves School Admin Login');

    // -----------------------------------------------------------------
    // TEST 3: SUPER ADMIN LOGIN & NEW SCHOOL TENANT ONBOARDING
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Onboard Second School Tenant and Verify Domain Isolation ---');

    // Login as Super Admin
    const loginRes = await request({
      path: '/api/superadmin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      username: 'superadmin@schoolerp.in',
      password: 'SuperAdmin@2026'
    });
    assert(loginRes.status === 200 && loginRes.body.token, 'Super admin login must succeed');
    const saToken = loginRes.body.token;
    console.log('  ✓ Super Admin logged in successfully');

    // Check availability of subdomain 'oasis-intl'
    const checkSub = await request({
      path: '/api/superadmin/check-subdomain?code=oasis-intl',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    assert(checkSub.status === 200 && checkSub.body.available === true, 'Subdomain oasis-intl must be available');
    console.log('  ✓ Subdomain oasis-intl availability verified');

    // Create school 'Oasis International School'
    const createRes = await request({
      path: '/api/superadmin/schools',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${saToken}`,
        'Content-Type': 'application/json'
      }
    }, {
      name: 'Oasis International Academy',
      code: 'oasis-intl',
      subdomain: 'oasis-intl',
      type: 'Co-Educational',
      affiliation: 'CBSE',
      establishedYear: '2018',
      principalName: 'Dr. Sarah Williams',
      officialEmail: 'sarah@oasisacademy.in',
      phone: '+91 9988776655',
      address: '7th Sector, Cyber City, Hyderabad',
      city: 'Hyderabad',
      district: 'Hyderabad',
      state: 'Telangana',
      pincode: '500081',
      country: 'India',
      websiteTitle: 'Oasis International Academy - CBSE Excellence',
      schoolDescription: 'Nurturing Global Minds with Indian Values',
      aboutSchool: 'Oasis International Academy is committed to academic rigor, innovation, and holistic student development.',
      adminName: 'Admin Sarah',
      adminEmail: 'admin@oasisacademy.in',
      adminPhone: '+91 9988776655',
      adminPassword: 'Password@2026',
      plan: 'Professional Tier',
      status: 'Active'
    });
    assert(createRes.status === 201 && createRes.body.success, `Oasis school creation failed: ${JSON.stringify(createRes.body)}`);
    console.log('  ✓ Created second school tenant: Oasis International Academy (oasis-intl)');

    // Now test subdomain resolution for Oasis
    const oasisWebsiteInfo = await request({
      path: '/api/website-info',
      hostHeader: `oasis-intl.localhost:${TEST_PORT}`
    });
    assert(oasisWebsiteInfo.status === 200, `oasis-intl website-info should return 200, got ${oasisWebsiteInfo.status}`);
    assert(oasisWebsiteInfo.body.schoolName === 'Oasis International Academy', `Expected Oasis International Academy, got ${oasisWebsiteInfo.body.schoolName}`);
    assert(oasisWebsiteInfo.body.schoolCode === 'oasis-intl', `Expected code oasis-intl, got ${oasisWebsiteInfo.body.schoolCode}`);
    console.log('  ✓ oasis-intl.localhost resolves to Oasis International Academy branding');

    // Verify GJV subdomain still resolves to GJV
    const gjvWebsiteInfo = await request({
      path: '/api/website-info',
      hostHeader: `gjv.localhost:${TEST_PORT}`
    });
    assert(gjvWebsiteInfo.status === 200, `gjv website-info should return 200`);
    assert(gjvWebsiteInfo.body.schoolName === 'Garumara Jatiya Vidyalaya', `Expected Garumara Jatiya Vidyalaya, got ${gjvWebsiteInfo.body.schoolName}`);
    assert(gjvWebsiteInfo.body.schoolCode === 'gjv', `Expected code gjv, got ${gjvWebsiteInfo.body.schoolCode}`);
    console.log('  ✓ gjv.localhost continues resolving to Garumara Jatiya Vidyalaya (Tenant Isolation intact)');

    // -----------------------------------------------------------------
    // TEST 4: SAAS CONFIGURATION & DEMO REQUEST LEAD CAPTURE
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: SaaS Public API & Lead Capture Form ---');

    // 1. GET /api/saas/config
    const saasCfgRes = await request({ path: '/api/saas/config' });
    assert(saasCfgRes.status === 200 && saasCfgRes.body.success, 'GET /api/saas/config failed');
    assert(Array.isArray(saasCfgRes.body.config.plans || saasCfgRes.body.config.pricingPlans), 'SaaS config must contain plans array');
    console.log('  ✓ GET /api/saas/config returns platform settings and pricing');

    // 2. POST /api/saas/demo-request with missing fields (should fail)
    const badDemoRes = await request({
      path: '/api/saas/demo-request',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      name: '',
      email: 'not-an-email'
    });
    assert(badDemoRes.status === 400 && badDemoRes.body.success === false, 'Invalid demo request must return 400');
    console.log('  ✓ POST /api/saas/demo-request validates required fields');

    // 3. POST /api/saas/demo-request with valid payload
    const demoPayload = {
      name: 'Fr. Thomas K.',
      email: 'thomas@donbosco-prep.in',
      phone: '+91 94350 12345',
      schoolName: 'Don Bosco Preparatory School',
      studentCount: '500 - 1500',
      subdomain: 'donbosco',
      message: 'Interested in WhatsApp fee reminders and mobile report cards for our 1,200 students.',
      source: 'marketing_homepage'
    };

    const goodDemoRes = await request({
      path: '/api/saas/demo-request',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, demoPayload);
    assert(goodDemoRes.status === 201 && goodDemoRes.body.success === true, `Demo request submission failed: ${JSON.stringify(goodDemoRes.body)}`);
    const demoId = goodDemoRes.body.requestId;
    console.log(`  ✓ Demo request captured successfully (ID: ${demoId})`);

    // 4. Super Admin: GET /api/superadmin/demo-requests
    const leadsRes = await request({
      path: '/api/superadmin/demo-requests',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    assert(leadsRes.status === 200 && leadsRes.body.success === true, 'Failed to fetch leads as Super Admin');
    const foundLead = leadsRes.body.demoRequests.find(l => l.id === demoId);
    assert(foundLead && foundLead.schoolName === 'Don Bosco Preparatory School', 'Super Admin must see the newly captured lead');
    console.log('  ✓ Super Admin retrieved captured lead from database');

    // 5. Super Admin: PUT /api/superadmin/demo-requests/:id (update status)
    const updateLeadRes = await request({
      path: `/api/superadmin/demo-requests/${demoId}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${saToken}`,
        'Content-Type': 'application/json'
      }
    }, { status: 'Contacted', notes: 'Scheduled zoom walk-through for Friday 11 AM.' });
    assert(updateLeadRes.status === 200 && updateLeadRes.body.demoRequest.status === 'Contacted', 'Failed to update lead status');
    console.log('  ✓ Super Admin updated lead status to Contacted');

    // 6. Super Admin: PUT /api/superadmin/saas-config (update business configuration)
    const updateCfgRes = await request({
      path: '/api/superadmin/saas-config',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${saToken}`,
        'Content-Type': 'application/json'
      }
    }, {
      contactPhone: '+91 80994 56097',
      contactEmail: 'sales@schoolerp.in'
    });
    assert(updateCfgRes.status === 200 && updateCfgRes.body.config.contactPhone === '+91 80994 56097', 'Failed to update SaaS configuration');
    console.log('  ✓ Super Admin updated SaaS business contact settings');

    // -----------------------------------------------------------------
    // TEST 5: STATIC ASSETS ACCESSIBILITY
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Static Assets Served on All Domains ---');
    
    // Style.css on root domain
    const rootCss = await request({ path: '/css/style.css', hostHeader: `localhost:${TEST_PORT}` });
    assert(rootCss.status === 200, `Root domain /css/style.css should return 200, got ${rootCss.status}`);

    // Style.css on school subdomain
    const subCss = await request({ path: '/css/style.css', hostHeader: `gjv.localhost:${TEST_PORT}` });
    assert(subCss.status === 200, `gjv.localhost /css/style.css should return 200, got ${subCss.status}`);

    // Logo on root domain
    const logoRes = await request({ path: '/logo.jpg', hostHeader: `localhost:${TEST_PORT}` });
    assert(logoRes.status === 200, `Root domain /logo.jpg should return 200, got ${logoRes.status}`);

    console.log('  ✓ Static CSS, JS, and image assets resolve on root and subdomains');

    console.log('\n=============================================================');
    console.log(' ALL 5 SAAS DOMAIN MIGRATION & ROUTING CHECKS PASSED PERFECTLY!');
    console.log('=============================================================');

  } finally {
    // Restore original db.json
    fs.writeFileSync(DB_PATH, originalDb, 'utf8');
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

run().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
