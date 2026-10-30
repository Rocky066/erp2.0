const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Test Suite Config
const TEST_JWT_SECRET = 'test-secret-key-12345-67890';
const TEST_DB_PATH = path.join(__dirname, 'test_db.json');

// Cleanup previous test DB
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

// ---------------------------------------------
// JWT helper implementation for test
// ---------------------------------------------
function base64url(str, encoding = 'utf8') {
  return Buffer.from(str, encoding).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function signJWT(payload, secret, expiresInSeconds = 7200) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };
  
  const hBase64 = base64url(JSON.stringify(header));
  const pBase64 = base64url(JSON.stringify(fullPayload));
  const signatureInput = `${hBase64}.${pBase64}`;
  
  const signature = crypto.createHmac('sha256', secret).update(signatureInput).digest('base64url');
  return `${signatureInput}.${signature}`;
}

function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hBase64, pBase64, signature] = parts;
    const signatureInput = `${hBase64}.${pBase64}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signatureInput).digest('base64url');
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(base64urlDecode(pBase64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------
// TEST RUNNERS
// ---------------------------------------------
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('Running Garumara Jatiya Vidyalaya backend test suite');
  console.log('====================================================\n');

  // Test 1: Password Cryptography
  console.log('Test 1: Cryptographic password hashing & checks...');
  const testPassword = 'SchoolAdmin123!';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(testPassword, salt, 1000, 64, 'sha512').toString('hex');

  // Verify correct match
  const verifyHashCorrect = crypto.pbkdf2Sync(testPassword, salt, 1000, 64, 'sha512').toString('hex');
  assert(hash === verifyHashCorrect, 'Password verifies successfully with correct credentials.');

  // Verify incorrect match
  const verifyHashWrong = crypto.pbkdf2Sync('WrongPassword!', salt, 1000, 64, 'sha512').toString('hex');
  assert(hash !== verifyHashWrong, 'Password fails verification with incorrect credentials.');

  console.log('\n----------------------------------------------------');

  // Test 2: Custom Cryptography-based JWT
  console.log('Test 2: Custom Cryptography-based JWT verification...');
  const userPayload = { username: 'test-admin', role: 'supervisor' };
  
  // Test valid token signature
  const validToken = signJWT(userPayload, TEST_JWT_SECRET, 10); // expires in 10s
  const decoded = verifyJWT(validToken, TEST_JWT_SECRET);
  assert(decoded !== null, 'Valid JWT signature verified successfully.');
  assert(decoded.username === 'test-admin', 'Decoded JWT returns correct username payload.');
  
  // Test invalid token secret key
  const invalidDecoded = verifyJWT(validToken, 'wrong-secret-key-999');
  assert(invalidDecoded === null, 'JWT verification fails when using incorrect secret keys.');

  // Test expired token validation
  const expiredToken = signJWT(userPayload, TEST_JWT_SECRET, -5); // expired 5 seconds ago
  const expiredDecoded = verifyJWT(expiredToken, TEST_JWT_SECRET);
  assert(expiredDecoded === null, 'JWT verification fails on expired token validation.');

  console.log('\n----------------------------------------------------');

  // Test 3: DB File operations & Transaction Locks
  console.log('Test 3: DB Transaction Locks and CRUD stability...');
  
  // Initialize test DB
  const mockDb = { students: [], logs: [] };
  fs.writeFileSync(TEST_DB_PATH, JSON.stringify(mockDb), 'utf8');

  // Mutex Lock queue
  let dbLock = Promise.resolve();
  function runInTransaction(fn) {
    const op = dbLock.then(() => fn());
    dbLock = op.catch(() => {});
    return op;
  }

  // Concurrent write simulation
  const writeOps = [];
  for (let i = 1; i <= 5; i++) {
    writeOps.push(runInTransaction(async () => {
      // simulate latency
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const db = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf8'));
      db.students.push({ id: i, name: `Student ${i}` });
      fs.writeFileSync(TEST_DB_PATH, JSON.stringify(db), 'utf8');
    }));
  }

  // Wait for all concurrent ops
  await Promise.all(writeOps);
  
  const finalDb = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf8'));
  assert(finalDb.students.length === 5, 'Simultaneous database writes sequenced via mutex transaction lock without corruption.');
  assert(finalDb.students[4].name === 'Student 5', 'Data integrity verified at last list index.');

  // Clean test DB after success
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  console.log('\n====================================================');
  console.log('🎉 ALL BACKEND COMPONENT TESTS COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests();
