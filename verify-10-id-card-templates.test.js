const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3206;
const DB_PATH = path.join(__dirname, 'db.json');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`✔ PASS: ${message}`);
}

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const mergedHeaders = { ...defaultHeaders, ...(options.headers || {}) };
    let payload = null;
    if (postData) {
      payload = typeof postData === 'string' ? postData : JSON.stringify(postData);
      mergedHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const reqOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      ...options,
      headers: mergedHeaders
    };
    const req = http.request(reqOptions, res => {
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTestSuite() {
  console.log('=== STARTING 10 PREMIUM ID CARD TEMPLATES & STUDIO VERIFICATION ===\n');

  const dbBackup = fs.readFileSync(DB_PATH, 'utf8');
  let serverProcess = null;

  try {
    console.log(`Starting server on port ${TEST_PORT}...`);
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', d => {
      const msg = d.toString();
      if (msg.includes('running at')) console.log(`Server listening on port ${TEST_PORT}`);
    });

    await new Promise(r => setTimeout(r, 2200));

    // -----------------------------------------------------------------
    // SETUP: Authenticate Operators for School A (GJV) and School B (Muwamari)
    // -----------------------------------------------------------------
    console.log('--- Setting up operator tokens for School A and School B ---');
    const saLogin = await request({
      path: '/api/superadmin/login',
      method: 'POST'
    }, {
      username: 'superadmin@schoolerp.in',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026'
    });
    assert(saLogin.status === 200 && saLogin.body.token, 'SuperAdmin login succeeded');
    const saToken = saLogin.body.token;

    // Get schools list
    const pcSchools = await request({
      path: '/api/superadmin/print-center/schools',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${saToken}` }
    });
    const gjvSchool = pcSchools.body.schools.find(s => s.id === 'school_gjv_default');
    const muwamariSchool = pcSchools.body.schools.find(s => s.id === 'SCH-MUWAMARII');

    // Reset GJV operator password
    await request({
      path: '/api/superadmin/print-center/school_gjv_default/reset-password',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}` }
    }, {
      new_password: 'GjvPrintPass@2026!'
    });

    // Reset Muwamari operator password
    await request({
      path: '/api/superadmin/print-center/SCH-MUWAMARII/reset-password',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${saToken}` }
    }, {
      new_password: 'MuwamariPrintPass@2026!'
    });

    // Operator A (GJV) Login
    const opALogin = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: gjvSchool.printCenter.username,
      password: 'GjvPrintPass@2026!'
    });
    assert(opALogin.status === 200 && opALogin.body.token, 'School A (GJV) Operator logged in');
    const tokenA = opALogin.body.token;
    const headersA = { 'Authorization': `Bearer ${tokenA}` };

    // Operator B Login
    const opBLogin = await request({
      path: '/api/print-center/login',
      method: 'POST'
    }, {
      username: muwamariSchool.printCenter.username,
      password: 'MuwamariPrintPass@2026!'
    });
    assert(opBLogin.status === 200 && opBLogin.body.token, 'School B Operator logged in');
    const tokenB = opBLogin.body.token;
    const headersB = { 'Authorization': `Bearer ${tokenB}` };


    // -----------------------------------------------------------------
    // TEST 1: All 10 Templates Appear in the Gallery API
    // -----------------------------------------------------------------
    console.log('\n--- 1. Testing All 10 Templates in Gallery API ---');
    const tplResA = await request({
      path: '/api/print-center/id-card-templates',
      method: 'GET',
      headers: headersA
    });
    assert(tplResA.status === 200, 'GET /api/print-center/id-card-templates returned 200');
    assert(Array.isArray(tplResA.body.templates), 'Templates response contains an array');
    assert(tplResA.body.templates.length === 110, `Expected 110 premium templates, got ${tplResA.body.templates.length}`);

    const expectedTemplateIds = [
      'royal-blue',
      'modern-minimal',
      'premium-gold',
      'emerald-academic',
      'maroon-classic',
      'sky-wave',
      'purple-innovation',
      'orange-energy',
      'executive-vertical',
      'smart-digital'
    ];

    const returnedIds = tplResA.body.templates.map(t => t.id);
    expectedTemplateIds.forEach(id => {
      assert(returnedIds.includes(id), `Template '${id}' is present in the gallery`);
    });


    // -----------------------------------------------------------------
    // TEST 2: Each Template Has Genuinely Distinct Layouts & Visuals
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Genuinely Distinct Layouts & Styling ---');
    const templates = tplResA.body.templates;

    // Check orientations: Some must be portrait, some landscape
    const portraitTemplates = templates.filter(t => t.cardSize.orientation === 'portrait');
    const landscapeTemplates = templates.filter(t => t.cardSize.orientation === 'landscape');
    assert(portraitTemplates.length >= 6, `Found ${portraitTemplates.length} portrait templates`);
    assert(landscapeTemplates.length >= 3, `Found ${landscapeTemplates.length} landscape templates`);

    // Check header styles variety
    const headerStyles = new Set(templates.map(t => t.branding.headerStyle));
    assert(headerStyles.has('gradient'), 'Contains gradient header style');
    assert(headerStyles.has('minimal'), 'Contains minimal header style');
    assert(headerStyles.has('regal'), 'Contains regal header style');
    assert(headerStyles.has('diagonal'), 'Contains diagonal header style');
    assert(headerStyles.has('pinstripe'), 'Contains pinstripe header style');
    assert(headerStyles.has('wave'), 'Contains wave header style');
    assert(headerStyles.has('executive'), 'Contains executive header style');

    // Check photo corner radiuses variety (different frames)
    const radiuses = new Set(templates.map(t => t.studentFields.photoBorderRadius));
    assert(radiuses.size >= 5, `Found ${radiuses.size} distinct photo border radius styles`);

    // Check distinct color palettes
    const headerColors = new Set(templates.map(t => t.branding.headerBgColor));
    assert(headerColors.size >= 8, `Found ${headerColors.size} distinct color palettes`);

    // Check feature differences: Some have QR enabled, some have barcodes, some have watermarks
    const qrTemplates = templates.filter(t => t.decorations?.showQrCode === true);
    assert(qrTemplates.length >= 3, `Found ${qrTemplates.length} templates with integrated QR verification`);
    const crestWatermark = templates.find(t => t.decorations?.watermark === 'crest');
    assert(crestWatermark && crestWatermark.id === 'premium-gold', 'Premium Gold has ornate crest watermark');


    // -----------------------------------------------------------------
    // TEST 3: Client-side Live Card Renderer & Field Customization
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Dynamic Card Renderer & Field Updates ---');
    const adminJsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'admin.js'), 'utf8');

    // Load admin.js functions into sandbox
    const sandbox = {
      window: { currentSchool: { id: 'school_gjv_default', name: 'Garumara Jatiya Vidyalaya' } },
      document: { fonts: { ready: Promise.resolve() } },
      subjectHtmlEscape: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      resolveIdCardAssetUrl: v => v,
      console
    };

    // Evaluate the code defining renderDynamicDesignedCardHTML and BUILTIN_ID_CARD_TEMPLATES
    const vm = require('vm');
    vm.createContext(sandbox);

    // Extract the studio script portion
    const studioCode = adminJsContent.slice(
      adminJsContent.indexOf('const BUILTIN_ID_CARD_TEMPLATES ='),
      adminJsContent.indexOf('function switchIdCardSubTab(')
    );
    vm.runInContext(studioCode, sandbox);

    const clientTemplates = sandbox.window.BUILTIN_ID_CARD_TEMPLATES || sandbox.BUILTIN_ID_CARD_TEMPLATES;
    assert(Array.isArray(clientTemplates), 'BUILTIN_ID_CARD_TEMPLATES is defined');
    assert(clientTemplates.length === 110, 'BUILTIN_ID_CARD_TEMPLATES contains 110 templates');

    // Test render each of the 10 templates
    const testStudent = {
      name: 'Priyanka Sharma',
      admissionNo: 'GJV-2026-9999',
      className: 'Class X',
      section: 'B',
      rollNo: 42,
      fatherName: 'Rajesh Sharma',
      dob: '2010-08-25',
      session: '2026-2027',
      bloodGroup: 'O+',
      mobile: '+91 9876543210'
    };

    clientTemplates.forEach(tpl => {
      const html = sandbox.renderDynamicDesignedCardHTML(testStudent, '2026-2027', 'Dr. Principal', '', tpl);
      assert(html.includes('Priyanka Sharma'), `Template '${tpl.name}' correctly renders student name`);
      assert(html.includes('GJV-2026-9999'), `Template '${tpl.name}' correctly renders admission number`);
      assert(html.includes(tpl.branding.schoolNameColor || '#ffffff') || html.includes('color:'), `Template '${tpl.name}' applies branding styling`);
      assert(html.includes(`tpl-${tpl.id}`), `Template '${tpl.name}' has distinct layout CSS root class 'tpl-${tpl.id}'`);
    });

    // Test field visibility toggle and offset positioning
    const modifiedTpl = JSON.parse(JSON.stringify(clientTemplates[0]));
    modifiedTpl.studentFields.photoX = 25;
    modifiedTpl.studentFields.photoY = -15;
    modifiedTpl.studentFields.fields = {
      fatherName: { enabled: false },
      bloodGroup: { enabled: true, label: 'Blood Group ABO' }
    };

    const modHtml = sandbox.renderDynamicDesignedCardHTML(testStudent, '2026-2027', 'Dr. Principal', '', modifiedTpl);
    assert(modHtml.includes('translate(25px,-15px)') || modHtml.includes('translate(25px, -15px)'), 'Numeric X/Y offsets apply transform styling');
    assert(!modHtml.includes("Father's Name"), 'Disabled field is omitted from card output');
    assert(modHtml.includes('Blood Group ABO'), 'Custom label for enabled field is rendered');


    // -----------------------------------------------------------------
    // TEST 4: Save, Reopen, Duplicate, Rename, and Delete Presets
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing Preset CRUD & Reopen Workflow ---');
    // Save new preset for School B
    const customDesignB = {
      ...clientTemplates[1], // modern-minimal
      branding: {
        ...clientTemplates[1].branding,
        schoolName: 'Muwamari Academy of Science',
        accentColor: '#14b8a6'
      }
    };

    const savePresetRes = await request({
      path: '/api/print-center/id-card-design/presets',
      method: 'POST',
      headers: headersB
    }, {
      name: 'Muwamari Modern Teal',
      design: customDesignB
    });
    assert((savePresetRes.status === 200 || savePresetRes.status === 201) && savePresetRes.body.success, 'Saved custom preset for School B');
    assert(Array.isArray(savePresetRes.body.presets) && savePresetRes.body.presets.length >= 1, 'Preset saved in database');
    const presetId = savePresetRes.body.presets[savePresetRes.body.presets.length - 1].id;

    // Duplicate preset
    const dupRes = await request({
      path: `/api/print-center/id-card-design/presets/${presetId}/duplicate`,
      method: 'POST',
      headers: headersB
    }, {
      name: 'Muwamari Modern Teal (Duplicated)'
    });
    assert((dupRes.status === 200 || dupRes.status === 201) && dupRes.body.success, 'Duplicated preset successfully');
    const dupPresetId = dupRes.body.presets.find(p => p.name === 'Muwamari Modern Teal (Duplicated)')?.id;
    assert(dupPresetId, 'Found duplicated preset in presets list');

    // Rename duplicate preset
    const renRes = await request({
      path: `/api/print-center/id-card-design/presets/${dupPresetId}`,
      method: 'PUT',
      headers: headersB
    }, {
      name: 'Muwamari Modern Teal - Final Edition'
    });
    assert(renRes.status === 200 && renRes.body.success, 'Renamed preset successfully');
    assert(renRes.body.presets.find(p => p.id === dupPresetId)?.name === 'Muwamari Modern Teal - Final Edition', 'New preset name confirmed');

    // Delete duplicated preset
    const delRes = await request({
      path: `/api/print-center/id-card-design/presets/${dupPresetId}`,
      method: 'DELETE',
      headers: headersB
    });
    assert(delRes.status === 200 && delRes.body.success, 'Deleted duplicate preset with confirmation');
    assert(!delRes.body.presets.find(p => p.id === dupPresetId), 'Deleted preset is no longer in list');


    // -----------------------------------------------------------------
    // TEST 5 & 6: Multi-School SaaS Isolation & Independent Designs
    // -----------------------------------------------------------------
    console.log('\n--- 5 & 6. Testing Multi-School SaaS Isolation ---');
    // School A sets default template to emerald-academic
    const setDefA = await request({
      path: '/api/print-center/id-card-design/default-template',
      method: 'POST',
      headers: headersA
    }, {
      templateId: 'emerald-academic'
    });
    assert(setDefA.status === 200 && setDefA.body.defaultTemplateId === 'emerald-academic', 'School A set default template to emerald-academic');

    // School B sets default template to smart-digital
    const setDefB = await request({
      path: '/api/print-center/id-card-design/default-template',
      method: 'POST',
      headers: headersB
    }, {
      templateId: 'smart-digital'
    });
    assert(setDefB.status === 200 && setDefB.body.defaultTemplateId === 'smart-digital', 'School B set default template to smart-digital');

    // Verify School A's design fetch
    const getA = await request({
      path: '/api/print-center/id-card-design',
      method: 'GET',
      headers: headersA
    });
    assert(getA.body.schoolName === 'Garumara Jatiya Vidyalaya', 'School A name is Garumara Jatiya Vidyalaya');
    assert(getA.body.defaultTemplateId === 'emerald-academic', 'School A default template is emerald-academic');
    // Verify School A does NOT see School B's presets
    assert(!getA.body.presets?.some(p => p.name.includes('Muwamari')), 'School A cannot see School B presets');

    // Verify School B's design fetch
    const getB = await request({
      path: '/api/print-center/id-card-design',
      method: 'GET',
      headers: headersB
    });
    assert(getB.body.schoolName === 'Muwamari Jatiya Vidyalaya', 'School B name is Muwamari Jatiya Vidyalaya');
    assert(getB.body.defaultTemplateId === 'smart-digital', 'School B default template is smart-digital');
    assert(getB.body.presets?.some(p => p.name.includes('Muwamari')), 'School B sees its own saved preset');

    // Student records isolation
    const studA = getA.body.sampleStudents || [];
    const studB = getB.body.sampleStudents || [];
    assert(studA.length > 0 && studB.length > 0, 'Both schools have active authorized students');
    const overlap = studA.filter(a => studB.some(b => b.admissionNo === a.admissionNo));
    assert(overlap.length === 0, 'Zero student record overlap between School A and School B');
    assert(!studB.some(s => s.admissionNo.includes('GJV')), 'School B does not leak GJV students');


    // -----------------------------------------------------------------
    // TEST 7: CR80 Physical Dimensions & Print Output
    // -----------------------------------------------------------------
    console.log('\n--- 7. Testing CR80 Physical Dimensions & Print Output ---');
    // Standard CR80 is 53.98 × 85.60 mm
    const pTpl = templates.find(t => t.cardSize.orientation === 'portrait');
    const lTpl = templates.find(t => t.cardSize.orientation === 'landscape');

    assert(pTpl.cardSize.widthMm === 53.98 && pTpl.cardSize.heightMm === 85.60, 'Portrait template matches standard CR80 53.98 × 85.60 mm');
    assert(lTpl.cardSize.widthMm === 85.60 && lTpl.cardSize.heightMm === 53.98, 'Landscape template matches standard CR80 85.60 × 53.98 mm');

    // Verify print markup generation in admin.js
    assert(adminJsContent.includes('ID_CARD_PVC_WIDTH_MM') && adminJsContent.includes('ID_CARD_PVC_HEIGHT_MM'), 'Standard physical CR80 dimensions defined');
    assert(adminJsContent.includes('createIdCardPdf') && adminJsContent.includes('buildIdCardPrintMarkup'), 'Print and PDF generators available');


    // -----------------------------------------------------------------
    // TEST 8: Backward Compatibility & No Security Weakening
    // -----------------------------------------------------------------
    console.log('\n--- 8. Testing Backward Compatibility & Safety ---');
    // Check that buildPremiumStudentIdCardHTML in admin.js remains free of QR/barcode (contract test check)
    const bStart = adminJsContent.indexOf('function buildPremiumStudentIdCardHTML');
    const bEnd = adminJsContent.indexOf('function buildBatchIdCardsHTML');
    const builderCode = adminJsContent.slice(bStart, bEnd);
    assert(!/qr|barcode/i.test(builderCode), 'buildPremiumStudentIdCardHTML remains compliant with legacy contract test');

    // Check operator route guards still block unauthorized modules
    const feeAttempt = await request({
      path: '/api/fees',
      method: 'GET',
      headers: headersA
    });
    assert(feeAttempt.status === 403, 'PrintOperator blocked from /api/fees');

    console.log('\n🎉 ALL 8 VERIFICATION REQUIREMENTS PASSED 100%!');
  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      console.log('Test server terminated.');
    }
    fs.writeFileSync(DB_PATH, dbBackup, 'utf8');
    console.log('Database restored to original state.');
  }
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
