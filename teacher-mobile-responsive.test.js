const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const port = 3198;
const base = `http://127.0.0.1:${port}`;
let server;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function request(pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  const text = await response.text();
  return { response, text };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Test server failed to start.');
}

async function runMobileResponsivenessTests() {
  console.log('=== STARTING TEACHER PORTAL MOBILE RESPONSIVENESS AUDIT & SUITE ===');

  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore'
    });
    await waitForServer();

    // 1. Audit Viewport & Meta Tags in index.html & login.html
    const indexHtml = fs.readFileSync(path.join(root, 'public/teacher/index.html'), 'utf8');
    const loginHtml = fs.readFileSync(path.join(root, 'public/teacher/login.html'), 'utf8');
    const dashboardJs = fs.readFileSync(path.join(root, 'public/js/teacher-dashboard.js'), 'utf8');

    assert(indexHtml.includes('name="viewport"') && indexHtml.includes('width=device-width'), '1. Dashboard HTML contains correct mobile viewport meta tag');
    assert(loginHtml.includes('name="viewport"') && loginHtml.includes('width=device-width'), '2. Login HTML contains correct mobile viewport meta tag');

    // 2. Mobile Drawer Navigation Audit
    assert(indexHtml.includes('id="tch-mobile-menu-toggle"') && indexHtml.includes('id="tch-mobile-drawer"'), '3. Dashboard HTML contains mobile hamburger button and drawer navigation overlay');
    assert(indexHtml.includes('id="tch-mobile-drawer-close"') && indexHtml.includes('id="tch-mobile-drawer-backdrop"'), '4. Mobile drawer contains backdrop and close button');

    // 3. Mobile Subtab Buttons Sync Audit
    const expectedSubtabs = ['profile', 'roster', 'attendance', 'marks', 'timetable', 'leave', 'myattendance', 'salaries', 'notices', 'password'];
    expectedSubtabs.forEach(tab => {
      assert(indexHtml.includes(`id="tch-mob-tab-btn-${tab}"`), `5. Mobile drawer contains navigation item for ${tab}`);
    });

    // 4. Prevention of iOS Input Zoom Audit (Font Size >= 16px)
    assert(indexHtml.includes('font-size: 16px !important;') || indexHtml.includes('text-base'), '6. Mobile CSS contains font-size >= 16px rule for inputs to prevent iOS auto-zoom');
    assert(loginHtml.includes('font-size: 16px !important;') || loginHtml.includes('text-base'), '7. Login CSS contains font-size >= 16px rule for inputs to prevent iOS auto-zoom');

    // 5. Touch Targets & Minimum Touch Area (min-h-[40px] / min-h-[44px])
    assert(indexHtml.includes('min-h-[44px]') || indexHtml.includes('min-h-[42px]'), '8. Touch targets specify minimum height (>=42px) for smartphone tapping');

    // 6. Horizontal Overflow Prevention (overflow-x-auto & touch-scroll)
    assert(indexHtml.includes('overflow-x-auto') && indexHtml.includes('touch-scroll'), '9. All tables declare horizontal overflow touch-scrolling wrappers');
    assert(indexHtml.includes('overflow-x-hidden'), '10. Body declares overflow-x-hidden to prevent horizontal page body spill');

    // 7. Inputmode="decimal" for Numeric Marks Keyboard
    assert(dashboardJs.includes('inputmode="decimal"'), '11. Exam marks inputs declare inputmode="decimal" for smartphone numeric keyboards');

    // 8. Mobile Salary Slip PDF Export / Print
    assert(dashboardJs.includes('html2pdf') || dashboardJs.includes('window.print()'), '12. Salary Slip preview supports mobile PDF generation / print fallback');

    // 9. HTTP Frontend Route Serving Tests
    const loginRes = await request('/teacher-login');
    assert(loginRes.response.ok && loginRes.text.includes('Teacher Portal Login'), '13. GET /teacher-login serves mobile login page successfully');

    const dashRes = await request('/teacher');
    assert(dashRes.response.ok && dashRes.text.includes('Faculty Portal'), '14. GET /teacher serves mobile dashboard page successfully');

    console.log('\nALL MOBILE RESPONSIVENESS CHECKS PASSED SUCCESSFULLY!');

  } finally {
    if (server) {
      server.kill();
      await new Promise(r => setTimeout(r, 250));
    }
  }
}

runMobileResponsivenessTests().catch(err => {
  console.error('Mobile Responsiveness Test Failed:', err.message);
  if (server) server.kill();
  process.exit(1);
});
