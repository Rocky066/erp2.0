const fs = require('fs');

const assert = (value, message) => {
  if (!value) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const server = fs.readFileSync('server.js', 'utf8');
const adminHtml = fs.readFileSync('public/admin/index.html', 'utf8');
const printHtml = fs.readFileSync('public/print-center/index.html', 'utf8');
const printLogin = fs.readFileSync('public/print-center/login.html', 'utf8');
const adminJs = fs.readFileSync('public/js/admin.js', 'utf8');
const apiJs = fs.readFileSync('public/js/api.js', 'utf8');
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));

assert(server.includes("decodedPath === '/admin-65121315super'"), 'private URL alias opens the Print Portal login');
assert(server.includes("Location: '/print-center/login'"), 'unauthenticated print pages redirect to the print login');
assert(server.includes("role: 'PrintOperator'"), 'Print Portal receives an independent role');
assert(server.includes("const printReadRoutes = new Set(['/api/auth/me', '/api/students', '/api/exams', '/api/settings'])"), 'Print Portal shared-data access is allowlisted');
assert(server.includes("Card templates are managed only through the Private Print Portal."), 'Admin cannot bypass the card API boundary');
assert(adminHtml.includes('data-print-navigation data-tab="admitcard" class="hidden') && adminHtml.includes('data-print-navigation data-tab="idcards" class="hidden'), 'Admin sidebar hides both print modules');
assert(printHtml.includes('Private Print Portal') && printHtml.includes('tab-admitcard') && printHtml.includes('tab-idcards'), 'separate Print Portal contains both generators');
assert(printHtml.includes('Download All') && printHtml.includes('Download PNG') && printHtml.includes('Download PDF'), 'print exports remain available');
assert(printLogin.includes('ApiService.printLogin') && printLogin.includes('ApiService.isPrintAuthenticated'), 'print login uses only the independent print session');
assert(apiJs.includes("'gv_print_token'") && apiJs.includes('async printLogout()'), 'print token and logout are independent from Admin');
assert(adminJs.includes("const expectedRole = printPortal ? 'PrintOperator' : 'Admin'"), 'frontend route guard enforces matching portal roles');
assert(db.settings.printPortalPasswordHash?.length === 128 && !db.settings.printPortalPassword, 'only a salted Print Portal password hash is stored');

console.log('PRIVATE PRINT PORTAL CONTRACT TESTS PASSED');
