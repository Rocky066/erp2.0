const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PORT = 3198;

function makeRequest(pathName, options = {}, hostHeader = 'localhost') {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    headers['Host'] = `${hostHeader}:${PORT}`;
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.body) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathName,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe'
  });
  return new Promise((resolve, reject) => {
    let started = false;
    child.stdout.on('data', (d) => {
      const s = d.toString();
      if (!started && (s.includes('running') || s.includes(String(PORT)))) {
        started = true;
        resolve(child);
      }
    });
    child.stderr.on('data', (d) => {
      // console.error('[Server Stderr]', d.toString());
    });
    child.on('error', reject);
    setTimeout(() => {
      if (!started) resolve(child);
    }, 2500);
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  STARTING WEBSITE CONTENT & LEADERSHIP ISOLATION TEST SUITE');
  console.log('================================================================');

  let serverProcess = await startServer();
  console.log('[+] Test server spawned on port ' + PORT);

  try {
    // 1. Authenticate School A (Garumara) Admin
    console.log('\n--> Step 1: Logging in as School A (Garumara) Admin...');
    const loginResA = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'Admin@123' })
    }, 'gjv.localhost');
    assert.strictEqual(loginResA.status, 200, 'School A login should succeed');
    const tokenA = loginResA.data.token;
    assert.ok(tokenA, 'School A token should exist');
    console.log('    ✓ School A Admin authenticated successfully');

    // 2. Authenticate School B (Muwamari) Admin
    console.log('\n--> Step 2: Logging in as School B (Muwamari) Admin...');
    const loginResB = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'mjv@schoolerp.in', password: 'Admin@123' })
    }, 'muwamarii.localhost');
    assert.strictEqual(loginResB.status, 200, 'School B login should succeed');
    const tokenB = loginResB.data.token;
    assert.ok(tokenB, 'School B token should exist');
    console.log('    ✓ School B Admin authenticated successfully');

    // 3. Verify baseline public website info & leadership separation
    console.log('\n--> Step 3: Checking baseline content isolation before edits...');
    const infoA = await makeRequest('/api/website-info', {}, 'gjv.localhost');
    const infoB = await makeRequest('/api/website-info', {}, 'muwamarii.localhost');
    assert.strictEqual(infoA.status, 200);
    assert.strictEqual(infoB.status, 200);
    assert.strictEqual(infoA.data.schoolName, 'Garumara Jatiya Vidyalaya');
    assert.strictEqual(infoB.data.schoolName, 'Muwamari Jatiya Vidyalaya');
    assert.notStrictEqual(infoA.data.schoolId, infoB.data.schoolId);
    console.log('    ✓ School A Website Info:', infoA.data.schoolName, `(${infoA.data.schoolId})`);
    console.log('    ✓ School B Website Info:', infoB.data.schoolName, `(${infoB.data.schoolId})`);

    const leadA = await makeRequest('/api/leadership', {}, 'gjv.localhost');
    const leadB = await makeRequest('/api/leadership', {}, 'muwamarii.localhost');
    assert.strictEqual(leadA.status, 200);
    assert.strictEqual(leadB.status, 200);
    assert.ok(Array.isArray(leadA.data) && leadA.data.length >= 3);
    assert.ok(Array.isArray(leadB.data) && leadB.data.length >= 3);
    const principalA = leadA.data.find(l => l.id === 'principal');
    const principalB = leadB.data.find(l => l.id === 'principal');
    assert.ok(principalA && principalB);
    assert.strictEqual(principalA.name, 'Rokibul Hussain');
    assert.strictEqual(principalB.name, 'Sulman Ali');
    console.log('    ✓ Baseline School A Principal:', principalA.name);
    console.log('    ✓ Baseline School B Principal:', principalB.name);

    // 4. Update School A's Leadership (Vice Principal)
    console.log('\n--> Step 4: Updating School A Leadership (Vice Principal)...');
    const updateLeadA = await makeRequest('/api/leadership/vice_principal', {
      method: 'PUT',
      token: tokenA,
      body: JSON.stringify({
        name: 'Muzahirul Hoque Anchari (Updated Ph.D)',
        qualification: 'B Pharm, Ph.D.',
        designation: 'Senior Vice Principal',
        message: 'Dedicated to student empowerment and excellence in science education.'
      })
    }, 'gjv.localhost');
    assert.strictEqual(updateLeadA.status, 200, 'School A leader update should succeed');
    assert.strictEqual(updateLeadA.data.name, 'Muzahirul Hoque Anchari (Updated Ph.D)');

    // 5. Verify School A's website displays new details, School B remains unchanged
    console.log('\n--> Step 5: Verifying School A changed while School B remains unchanged...');
    const leadA_after = await makeRequest('/api/leadership', {}, 'gjv.localhost');
    const vpA = leadA_after.data.find(l => l.id === 'vice_principal');
    assert.strictEqual(vpA.name, 'Muzahirul Hoque Anchari (Updated Ph.D)');
    assert.strictEqual(vpA.designation, 'Senior Vice Principal');
    console.log('    ✓ School A Vice Principal updated to:', vpA.name, '-', vpA.designation);

    const leadB_after = await makeRequest('/api/leadership', {}, 'muwamarii.localhost');
    const vpB = leadB_after.data.find(l => l.id === 'vice_principal');
    assert.strictEqual(vpB.name, 'Vice Principal');
    assert.strictEqual(vpB.designation, 'Vice Principal');
    console.log('    ✓ School B Vice Principal remains untouched:', vpB.name);

    // 6. Update School B's Principal Details
    console.log('\n--> Step 6: Updating School B Principal Details...');
    const updateLeadB = await makeRequest('/api/leadership/principal', {
      method: 'PUT',
      token: tokenB,
      body: JSON.stringify({
        name: 'Sulman Ali M.A. B.Ed.',
        qualification: 'M.A., B.Ed.',
        designation: 'Principal, Muwamari Jatiya Vidyalaya',
        message: 'Welcome to Muwamari Jatiya Vidyalaya under new leadership focus on holistic growth.'
      })
    }, 'muwamarii.localhost');
    assert.strictEqual(updateLeadB.status, 200, 'School B principal update should succeed');

    // 7. Verify School B changed while School A remains unchanged
    console.log('\n--> Step 7: Verifying School B Principal changed, School A remained unchanged...');
    const leadB_after2 = await makeRequest('/api/leadership', {}, 'muwamarii.localhost');
    const pB2 = leadB_after2.data.find(l => l.id === 'principal');
    assert.strictEqual(pB2.name, 'Sulman Ali M.A. B.Ed.');
    assert.strictEqual(pB2.message, 'Welcome to Muwamari Jatiya Vidyalaya under new leadership focus on holistic growth.');
    console.log('    ✓ School B Principal is now:', pB2.name);

    const leadA_after2 = await makeRequest('/api/leadership', {}, 'gjv.localhost');
    const pA2 = leadA_after2.data.find(l => l.id === 'principal');
    assert.strictEqual(pA2.name, 'Rokibul Hussain'); // Unchanged!
    console.log('    ✓ School A Principal remains unchanged:', pA2.name);

    // 8. Update School B Website Details (About Us, Contact, Logo, Tagline)
    console.log('\n--> Step 8: Updating School B About Us, Contact, Tagline via Settings API...');
    const updateSettingsB = await makeRequest('/api/settings', {
      method: 'POST',
      token: tokenB,
      body: JSON.stringify({
        websiteContent: {
          schoolName: 'Muwamari Jatiya Vidyalaya',
          tagline: 'Inspiring Minds, Building Futures',
          aboutText: 'Muwamari Jatiya Vidyalaya is committed to rural educational empowerment with state-of-the-art facilities.',
          principalName: 'Sulman Ali M.A. B.Ed.',
          principalMessage: 'Welcome to Muwamari Jatiya Vidyalaya. Nurturing future leaders.',
          phone: '+91 9864309995',
          email: 'principal@muwamarivk.org',
          address: 'Kuhumtoli, Nagaon, Assam 782140',
          mapEmbedUrl: 'https://maps.google.com/embed/muwamari'
        }
      })
    }, 'muwamarii.localhost');
    assert.strictEqual(updateSettingsB.status, 200);

    const infoB_after = await makeRequest('/api/website-info', {}, 'muwamarii.localhost');
    assert.strictEqual(infoB_after.data.tagline, 'Inspiring Minds, Building Futures');
    assert.strictEqual(infoB_after.data.aboutText, 'Muwamari Jatiya Vidyalaya is committed to rural educational empowerment with state-of-the-art facilities.');
    assert.strictEqual(infoB_after.data.email, 'principal@muwamarivk.org');
    console.log('    ✓ School B Website Info updated:', infoB_after.data.tagline, '|', infoB_after.data.email);

    // Verify School A website info is NOT affected
    const infoA_after = await makeRequest('/api/website-info', {}, 'gjv.localhost');
    assert.strictEqual(infoA_after.data.schoolName, 'Garumara Jatiya Vidyalaya');
    assert.strictEqual(infoA_after.data.phone, '+91 8099456097');
    assert.strictEqual(infoA_after.data.email, 'info@garumarajv.in');
    assert.notStrictEqual(infoA_after.data.tagline, 'Inspiring Minds, Building Futures');
    console.log('    ✓ School A Website Info completely unaffected:', infoA_after.data.phone, '|', infoA_after.data.email);

    // 9. Cross-School Security Tests
    console.log('\n--> Step 9: Testing Cross-School Update Tampering Prevention...');
    // Attempt 1: School A token used on School B host
    const crossRes1 = await makeRequest('/api/leadership/principal', {
      method: 'PUT',
      token: tokenA,
      body: JSON.stringify({ name: 'Hacked By School A' })
    }, 'muwamarii.localhost');
    assert.strictEqual(crossRes1.status, 403, 'Cross-school token usage on different host must be rejected with 403');
    console.log('    ✓ Cross-school request with School A token on School B host rejected with 403');

    // Attempt 2: School B token attempting to update settings on School A host
    const crossRes2 = await makeRequest('/api/settings', {
      method: 'POST',
      token: tokenB,
      body: JSON.stringify({ websiteContent: { schoolName: 'Hacked By School B' } })
    }, 'gjv.localhost');
    assert.strictEqual(crossRes2.status, 403, 'Cross-school settings update must be rejected with 403');
    console.log('    ✓ Cross-school settings update with School B token on School A host rejected with 403');

    // 10. Server Restart Persistence Verification
    console.log('\n--> Step 10: Restarting server to verify data persistence across reboots...');
    serverProcess.kill();
    await new Promise(r => setTimeout(r, 1000));
    serverProcess = await startServer();
    console.log('[+] Server restarted successfully on port ' + PORT);

    const infoA_reboot = await makeRequest('/api/website-info', {}, 'gjv.localhost');
    const infoB_reboot = await makeRequest('/api/website-info', {}, 'muwamarii.localhost');
    assert.strictEqual(infoA_reboot.data.schoolName, 'Garumara Jatiya Vidyalaya');
    assert.strictEqual(infoB_reboot.data.schoolName, 'Muwamari Jatiya Vidyalaya');
    assert.strictEqual(infoB_reboot.data.tagline, 'Inspiring Minds, Building Futures');

    const leadA_reboot = await makeRequest('/api/leadership', {}, 'gjv.localhost');
    const leadB_reboot = await makeRequest('/api/leadership', {}, 'muwamarii.localhost');
    const vpA_reboot = leadA_reboot.data.find(l => l.id === 'vice_principal');
    const pB_reboot = leadB_reboot.data.find(l => l.id === 'principal');
    assert.strictEqual(vpA_reboot.name, 'Muzahirul Hoque Anchari (Updated Ph.D)');
    assert.strictEqual(pB_reboot.name, 'Sulman Ali M.A. B.Ed.');
    console.log('    ✓ Verified: School A Vice Principal preserved after reboot:', vpA_reboot.name);
    console.log('    ✓ Verified: School B Principal preserved after reboot:', pB_reboot.name);
    console.log('    ✓ Verified: School B Tagline preserved after reboot:', infoB_reboot.data.tagline);

    // 11. Reset test fields back to clean baseline
    console.log('\n--> Step 11: Restoring test fields to original values...');
    await makeRequest('/api/leadership/vice_principal', {
      method: 'PUT',
      token: tokenA,
      body: JSON.stringify({
        name: 'Muzahirul Hoque Anchari',
        qualification: 'B Pharm',
        designation: 'Vice Principal',
        message: 'At GJV, we aim to provide an environment where students can discover their true capabilities. I welcome all students and parents to work with us to achieve excellence in all domains of life.'
      })
    }, 'gjv.localhost');

    await makeRequest('/api/leadership/principal', {
      method: 'PUT',
      token: tokenB,
      body: JSON.stringify({
        name: 'Sulman Ali',
        qualification: '',
        designation: 'Principal, Muwamari Jatiya Vidyalaya',
        message: 'Welcome to Muwamari Jatiya Vidyalaya. As Principal, it is a privilege to lead our educational community. We believe in nurturing critical thinking, ethical values, and holistic development for every learner.'
      })
    }, 'muwamarii.localhost');

    console.log('    ✓ Original baseline values cleanly restored');

    console.log('\n================================================================');
    console.log('  ALL 11 TEST PHASES PASSED WITH ZERO FAILURES (VERIFIED)');
    console.log('================================================================\n');

  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

runTests().catch(err => {
  console.error('\n[X] TEST FAILURE:', err);
  process.exit(1);
});
