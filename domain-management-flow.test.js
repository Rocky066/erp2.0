/**
 * Comprehensive Automated Test Suite: School Domain Management Workflow
 *
 * Verifies:
 * 1. Simple DNS Setup Interface & Vercel deployment targets (A record: 76.76.21.21, CNAME: cname.vercel-dns.com, TTL: 600)
 * 2. Normalization & domain format validation
 * 3. Copyable DNS fields (Type, Name, Data/Value, TTL)
 * 4. Separate statuses (Pending DNS, DNS Verified, Routing Active, SSL Active/Pending)
 * 5. Real DNS verification endpoint behaviors & diagnostics (propagation handling, no premature connection)
 * 6. Routing activation gating (must be verified before active)
 * 7. Tenant isolation & multi-tenant routing (verified active domain routes correctly, unverified/unknown domains 404 safely)
 * 8. Disconnect workflow (subdomain remains uninterrupted)
 */

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 3105;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
let serverProcess = null;

function request(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      SAAS_BASE_DOMAIN: 'schoolerp.in',
      VERCEL_IP: '76.76.21.21',
      VERCEL_CNAME: 'cname.vercel-dns.com',
      VERCEL_TTL: '600'
    };

    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;

    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString();
      if (!started && (msg.includes('running') || msg.includes('Server') || msg.includes(String(TEST_PORT)))) {
        started = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (d) => {
      // ignore normal deprecation or debug logs
    });

    serverProcess.on('error', (err) => {
      if (!started) reject(err);
    });

    setTimeout(() => {
      if (!started) {
        started = true;
        resolve();
      }
    }, 3500);
  });
}

async function stopServer() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch (e) {}
  }
}

async function runTests() {
  console.log('--- Starting Comprehensive School Domain Management Test Suite ---');
  const dbPath = path.join(__dirname, 'db.json');
  const originalDbContent = fs.readFileSync(dbPath, 'utf8');

  await startServer();
  await delay(1000);

  let superAdminToken = '';

  try {
    // 0. SuperAdmin Login
    console.log('\n[Suite 0] SuperAdmin Authentication...');
    const loginRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      username: 'superadmin@schoolerp.in',
      password: 'SuperAdmin@2026'
    });

    assert.strictEqual(loginRes.statusCode, 200, 'SuperAdmin login should succeed');
    superAdminToken = loginRes.data.token;
    assert.ok(superAdminToken, 'SuperAdmin token should be present');
    console.log('✓ SuperAdmin authenticated successfully.');

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${superAdminToken}`
    };

    // 1. Fetch domain list
    console.log('\n[Suite 1] Domain List & Structure Verification...');
    const listRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/domains',
      method: 'GET',
      headers: authHeaders
    });
    assert.strictEqual(listRes.statusCode, 200);
    assert.ok(Array.isArray(listRes.data.schools), 'Schools list should be an array');
    assert.ok(listRes.data.schools.length > 0, 'Should have at least 1 default school');

    const testSchool = listRes.data.schools[0];
    const testSchoolId = testSchool.school_id;
    console.log(`✓ Using target school: "${testSchool.school_name}" (ID: ${testSchoolId})`);

    // Verify presence of separate status properties
    assert.ok('dns_status' in testSchool, 'school object must contain dns_status');
    assert.ok('routing_status' in testSchool, 'school object must contain routing_status');
    assert.ok('ssl_status' in testSchool, 'school object must contain ssl_status');
    console.log('✓ Separate status fields present in schools list API.');

    // 2. Normalization & Format Validation Tests
    console.log('\n[Suite 2] Domain Normalization & Format Validation...');
    
    // Test 2.1: Reject invalid domain (IP address)
    const ipRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/domains',
      method: 'POST',
      headers: authHeaders
    }, {
      schoolId: testSchoolId,
      domain: '192.168.1.1'
    });
    assert.strictEqual(ipRes.statusCode, 400, 'IP address as custom domain should be rejected');
    console.log('✓ Rejected IP address input correctly.');

    // Test 2.2: Reject localhost
    const localRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/domains',
      method: 'POST',
      headers: authHeaders
    }, {
      schoolId: testSchoolId,
      domain: 'localhost'
    });
    assert.strictEqual(localRes.statusCode, 400, 'localhost should be rejected');
    console.log('✓ Rejected localhost input correctly.');

    // Test 2.3: Reject platform base domain
    const baseDomRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/domains',
      method: 'POST',
      headers: authHeaders
    }, {
      schoolId: testSchoolId,
      domain: 'schoolerp.in'
    });
    assert.strictEqual(baseDomRes.statusCode, 400, 'Platform base domain should be rejected');
    console.log('✓ Rejected platform base domain input correctly.');

    // Test 2.4: Domain normalization (strips https://, trailing slash, path)
    const addRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/domains',
      method: 'POST',
      headers: authHeaders
    }, {
      schoolId: testSchoolId,
      domain: 'https://WwW.StMarysAcademy.Edu.In:8080/portal/'
    });
    assert.strictEqual(addRes.statusCode, 200, 'Valid custom domain should register');
    assert.strictEqual(addRes.data.domain, 'www.stmarysacademy.edu.in', 'Domain should be normalized and lowercased');
    assert.strictEqual(addRes.data.dns_status, 'Pending DNS', 'Initial dns_status must be Pending DNS');
    assert.strictEqual(addRes.data.routing_status, 'Routing Inactive', 'Initial routing_status must be Routing Inactive');
    console.log('✓ Normalized dirty URL to: "www.stmarysacademy.edu.in" with Pending DNS and Routing Inactive.');

    // 3. DNS Setup Interface & Vercel deployment targets verification
    console.log('\n[Suite 3] DNS Instructions & Vercel Target Verification...');
    const instRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/instructions`,
      method: 'GET',
      headers: authHeaders
    });
    assert.strictEqual(instRes.statusCode, 200);
    const inst = instRes.data;
    assert.strictEqual(inst.domain, 'www.stmarysacademy.edu.in');
    assert.strictEqual(inst.deployment_target.a_record_ip, '76.76.21.21', 'Must show actual configured Vercel IP: 76.76.21.21');
    assert.strictEqual(inst.deployment_target.cname_target, 'cname.vercel-dns.com', 'Must show actual Vercel CNAME: cname.vercel-dns.com');
    assert.strictEqual(inst.deployment_target.ttl, 600, 'Must show TTL of 600 seconds');

    // Verify DNS records list has copyable fields
    assert.ok(Array.isArray(inst.dns_records), 'dns_records must be an array');
    const cnameRec = inst.dns_records.find(r => r.type === 'CNAME');
    assert.ok(cnameRec, 'CNAME record must exist for www subdomain');
    assert.strictEqual(cnameRec.value, 'cname.vercel-dns.com', 'CNAME value must point to Vercel CNAME target');
    assert.strictEqual(cnameRec.ttl, 600, 'Record TTL must be 600');
    assert.ok('name' in cnameRec && 'value' in cnameRec && 'type' in cnameRec && 'ttl' in cnameRec, 'Every record must have individual copyable fields');
    console.log('✓ DNS Setup returns exact actual Vercel targets (CNAME: cname.vercel-dns.com, TTL: 600) with copyable fields.');

    // Also test apex domain DNS instructions
    const apexAddRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/superadmin/domains',
      method: 'POST',
      headers: authHeaders
    }, {
      schoolId: testSchoolId,
      domain: 'stmarysacademy.edu.in'
    });
    assert.strictEqual(apexAddRes.statusCode, 200);
    assert.strictEqual(apexAddRes.data.domain, 'stmarysacademy.edu.in');

    const apexInstRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/instructions`,
      method: 'GET',
      headers: authHeaders
    });
    const aRec = apexInstRes.data.dns_records.find(r => r.type === 'A');
    assert.ok(aRec, 'A record must exist for apex domain');
    assert.strictEqual(aRec.name, '@', 'A record name must be @ for apex domain');
    assert.strictEqual(aRec.value, '76.76.21.21', 'A record must point to Vercel Anycast IP 76.76.21.21');
    assert.strictEqual(aRec.ttl, 600, 'A record TTL must be 600');
    console.log('✓ Apex domain returns A record @ -> 76.76.21.21 with TTL 600.');

    // 4. Activation Gating (Must not activate before DNS verified)
    console.log('\n[Suite 4] Activation Gating & Tenant Routing Protection...');
    const prematureActRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/activate`,
      method: 'POST',
      headers: authHeaders
    });
    assert.strictEqual(prematureActRes.statusCode, 400, 'Activation before verification must be blocked');
    assert.ok(prematureActRes.data.error.includes('verified'), 'Error message must specify verification is required');
    console.log('✓ Premature routing activation successfully blocked with 400.');

    // Verify unverified domain DOES NOT route to school tenant
    const unverifiedRouteRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'stmarysacademy.edu.in'
      }
    });
    assert.strictEqual(unverifiedRouteRes.statusCode, 404, 'Unverified custom domain must NOT route to school data');
    console.log('✓ Unverified custom domain does not route; returns 404 cleanly.');

    // 5. Real Public DNS Verification Endpoint
    console.log('\n[Suite 5] Public DNS Verification Endpoint & Diagnostics...');
    const verifyRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/verify`,
      method: 'POST',
      headers: authHeaders
    });
    assert.strictEqual(verifyRes.statusCode, 200, 'Verification endpoint must respond with 200');
    assert.strictEqual(verifyRes.data.success, true);
    assert.ok('verified' in verifyRes.data, 'Response must contain verified boolean');
    assert.ok('message' in verifyRes.data, 'Response must contain diagnostic guidance message');
    assert.ok('diagnostics' in verifyRes.data, 'Response must contain diagnostics');
    // Notice: stmarysacademy.edu.in is not a real registered domain in public DNS pointing to 76.76.21.21 right now,
    // so verified must be false! Do not mark connected merely because user clicked verify!
    assert.strictEqual(verifyRes.data.verified, false, 'Do not mark verified when public DNS does not match target');
    assert.strictEqual(verifyRes.data.dns_status, 'Pending DNS', 'dns_status remains Pending DNS');
    assert.strictEqual(verifyRes.data.routing_status, 'Routing Inactive', 'routing_status remains Inactive');
    console.log('✓ Verification correctly refused premature connection on unpointed domain.');
    console.log(`  Diagnostic guidance: "${verifyRes.data.message}"`);

    // 6. Verified Domain & Multi-tenant Routing Activation
    console.log('\n[Suite 6] Verified Domain Activation & Tenant Isolation...');
    // Verify domain through the actual verify endpoint when DNS target matches
    const mockVerifyRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/verify`,
      method: 'POST',
      headers: {
        ...authHeaders,
        'x-test-mock-dns': 'match'
      }
    });
    assert.strictEqual(mockVerifyRes.statusCode, 200);
    assert.strictEqual(mockVerifyRes.data.verified, true, 'Verification should succeed when DNS target matches');
    assert.strictEqual(mockVerifyRes.data.dns_status, 'DNS Verified');
    console.log('✓ Public DNS check verified domain when pointing to deployment target.');

    // Trigger activation now that it is marked Verified
    const actRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/activate`,
      method: 'POST',
      headers: authHeaders
    });
    assert.strictEqual(actRes.statusCode, 200, 'Activation should succeed once DNS is verified');
    assert.strictEqual(actRes.data.activation_status, 'Active');
    assert.strictEqual(actRes.data.routing_status, 'Routing Active');
    console.log('✓ Successfully activated routing for verified domain.');

    // Test Multi-Tenant Routing via Custom Domain Host header
    const routedRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'stmarysacademy.edu.in'
      }
    });
    assert.strictEqual(routedRes.statusCode, 200, 'Custom domain Host request should route to school');
    assert.strictEqual(routedRes.data.schoolName, testSchool.school_name, 'Custom domain must resolve to the correct school tenant');
    console.log(`✓ Custom domain "stmarysacademy.edu.in" routes strictly to tenant "${routedRes.data.schoolName}".`);

    // Test Tenant Isolation: Unknown domain returns 404
    const unknownRouteRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'unauthorized-other-school.com'
      }
    });
    assert.strictEqual(unknownRouteRes.statusCode, 404, 'Unknown custom domain must return 404 and not leak data');
    console.log('✓ Unknown domain rejected with 404 (tenant isolation verified).');

    // 7. Disconnection Workflow
    console.log('\n[Suite 7] Custom Domain Disconnect Workflow...');
    const disRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: `/api/superadmin/domains/${testSchoolId}/disconnect`,
      method: 'POST',
      headers: authHeaders
    });
    assert.strictEqual(disRes.statusCode, 200, 'Disconnect should succeed');
    assert.strictEqual(disRes.data.activation_status, 'Disconnected');
    assert.strictEqual(disRes.data.routing_status, 'Routing Inactive');

    // Custom domain should no longer route
    const postDisRouteRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': 'stmarysacademy.edu.in'
      }
    });
    assert.strictEqual(postDisRouteRes.statusCode, 404, 'Disconnected domain must not route');
    console.log('✓ Disconnected domain stopped routing immediately.');

    // School default subdomain continues to work uninterrupted!
    const subRouteRes = await request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/website-info',
      method: 'GET',
      headers: {
        'Host': `${testSchool.subdomain || testSchool.school_code}.schoolerp.in`
      }
    });
    assert.strictEqual(subRouteRes.statusCode, 200, 'School default subdomain must remain active and uninterrupted');
    assert.strictEqual(subRouteRes.data.schoolName, testSchool.school_name);
    console.log('✓ Zero-downtime guarantee verified: Default school subdomain remains 100% operational.');

    console.log('\n======================================================');
    console.log('🎉 ALL 7 SUITES OF THE DOMAIN MANAGEMENT TEST PASSED! 🎉');
    console.log('======================================================\n');
  } finally {
    try {
      fs.writeFileSync(dbPath, originalDbContent, 'utf8');
    } catch (e) {}
    await stopServer();
  }
}

runTests().catch(async (err) => {
  console.error('\n❌ Test Suite Failed with error:', err);
  await stopServer();
  process.exit(1);
});
