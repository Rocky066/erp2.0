const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runFeeReceiptPdfAuditTests() {
  console.log('--- RUNNING FEE RECEIPT PDF AUDIT TESTS ---');

  const adminJsCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'admin.js'), 'utf8');

  // Minimal DOM mocking for Node VM environment
  class MockElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      const styleObj = { _cssText: '' };
      Object.defineProperty(styleObj, 'cssText', {
        get: () => styleObj._cssText,
        set: (text) => {
          styleObj._cssText = text;
          text.split(';').forEach(part => {
            const [k, v] = part.split(':').map(s => s.trim());
            if (k && v) {
              const camel = k.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
              styleObj[camel] = v;
              styleObj[k] = v;
            }
          });
        }
      });
      this.style = styleObj;
      this.classList = {
        _list: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._list.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._list.delete(c)),
        contains: (c) => this.classList._list.has(c)
      };
      this.dataset = {};
      this.attributes = {};
      this._innerHTML = '';
      this.textContent = '';
      this.isConnected = true;
      this.disabled = false;
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
      this._innerHTML = String(val);
      if (val && !this.children.length) {
        const child = new MockElement('div');
        this.appendChild(child);
      } else if (!val) {
        this.children = [];
      }
    }
    getContext() {
      return {
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8Array(32 * 32 * 4).fill(100) }),
        clearRect: () => {}
      };
    }
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    }
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
      }
    }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getBoundingClientRect() {
      return { width: 794, height: 1123, x: 0, y: 0, left: 0, top: 0, right: 794, bottom: 1123 };
    }
    getAttribute(attr) { return this.attributes[attr] || null; }
    setAttribute(attr, val) { this.attributes[attr] = String(val); }
    removeAttribute(attr) { delete this.attributes[attr]; }
    get firstElementChild() { return this.children[0] || null; }
  }

  const document = {
    body: new MockElement('body'),
    head: new MockElement('head'),
    createElement: (tag) => new MockElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: (id) => {
      if (id === 'print-feereceipt-template') {
        if (!document._template) {
          document._template = new MockElement('div');
          document._template.id = 'print-feereceipt-template';
        }
        return document._template;
      }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    fonts: { ready: Promise.resolve() }
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    Number,
    String,
    RegExp,
    Array,
    Map,
    Set,
    Uint8Array,
    Error,
    document,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    fetch: async () => ({ ok: false }),
    alert: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: 'http://localhost:3000/admin', search: '', reload: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    window: {}
  };
  sandbox.window = sandbox;
  sandbox.HTMLElement = MockElement;
  sandbox.HTMLButtonElement = MockElement;

  sandbox.state = { selectedStudentForFee: { admissionNo: 'GJV2026001', name: 'Rahul Sharma' } };
  sandbox.getSelectedFeeAcademicSession = () => ({ id: 'session-2026', name: '2026-2027' });
  sandbox.getCurrentAcademicSession = () => '2026-2027';

  sandbox.ApiService = {
    getAcademicSessions: async () => [{ id: 'session-2026', name: '2026-2027', status: 'Active' }],
    getFees: async () => [
      {
        receiptNo: 'REC-2026-001',
        studentId: 'GJV2026001',
        month: 'April 2026',
        type: 'Tuition Fee',
        amount: 1500,
        lateFee: 50,
        discountAmount: 0,
        scholarshipAmount: 0,
        dueBalance: 0,
        paymentMode: 'Cash',
        referenceNo: 'TXN12345',
        date: '2026-04-10'
      }
    ],
    searchFeeStudents: async () => [
      {
        admissionNo: 'GJV2026001',
        name: 'Rahul Sharma',
        className: 'Class X',
        section: 'A',
        rollNo: '12',
        fatherName: 'Rajesh Sharma'
      }
    ]
  };

  sandbox.html2canvas = async () => {
    const fakeCanvas = {
      width: 794,
      height: 1123,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8Array(32 * 32 * 4).fill(100) }),
        clearRect: () => {}
      }),
      toBlob: (cb, type) => cb(new Blob([], { type }))
    };
    return fakeCanvas;
  };
  sandbox.getHtml2Canvas = async () => sandbox.html2canvas;

  sandbox.jspdf = {
    jsPDF: function() {
      this.addImage = () => {};
      this.save = (filename) => { sandbox._lastSavedPdf = filename; };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(adminJsCode, sandbox);
  sandbox.getSelectedFeeAcademicSession = () => ({ id: 'session-2026', name: '2026-2027' });

  // Test 1: HTML Generation & Rupee Symbol formatting
  console.log('Test 1: Testing A4 Fee Receipt HTML rendering and ₹ symbol...');
  const html = await sandbox.buildA4FeeReceiptHTML('REC-2026-001');
  assert(html.includes('Garumara Jatiya Vidyalaya'), 'Receipt HTML should contain school header');
  assert(html.includes('REC-2026-001'), 'Receipt HTML should contain receipt number');
  assert(html.includes('Rahul Sharma'), 'Receipt HTML should contain student name');
  assert(html.includes('GJV2026001'), 'Receipt HTML should contain admission number');
  assert(html.includes('₹'), 'Receipt HTML should contain ₹ symbol');
  console.log('✓ Test 1 Passed');

  // Test 2: Offscreen mounting check
  console.log('Test 2: Testing offscreen receipt container positioning...');
  const mounted = await sandbox.mountFeeReceipt('REC-2026-001');
  assert(mounted.container, 'Mount should return receipt container');
  assert(mounted.container.style.cssText.includes('left:-9999px'), 'Container must be positioned off-screen (left: -9999px)');
  assert.strictEqual(mounted.container.style.opacity, '1', 'Container opacity must be 1 for full color rasterization');
  sandbox.unmountFeeReceipt(mounted.container);
  assert(mounted.container.classList.contains('hidden'), 'Unmount should hide container');
  console.log('✓ Test 2 Passed');

  // Test 3: Download PDF & Job Locking & UI loader
  console.log('Test 3: Testing downloadFeeReceiptPDF execution, button locking & PDF generation...');
  const testBtn = new MockElement('button');
  testBtn.setAttribute('onclick', "downloadFeeReceiptPDF('REC-2026-001', event)");
  document.body.appendChild(testBtn);

  const mockEvt = { currentTarget: testBtn, target: testBtn };
  const job1 = sandbox.downloadFeeReceiptPDF('REC-2026-001', mockEvt);
  assert.strictEqual(testBtn.disabled, true, 'Trigger button should be disabled immediately during PDF generation');
  assert(testBtn.innerHTML.includes('Generating PDF...'), 'Trigger button should show "Generating PDF..."');

  // Call again concurrently to test deduplication
  const job2 = sandbox.downloadFeeReceiptPDF('REC-2026-001', mockEvt);
  assert.strictEqual(job1, job2, 'Concurrent PDF requests for same receipt should return duplicate job lock promise');

  await job1;
  assert.strictEqual(sandbox._lastSavedPdf, 'Fee_Receipt_Student_REC-2026-001.pdf', 'PDF should save with correct filename');
  assert.strictEqual(testBtn.disabled, false, 'Trigger button should be re-enabled after PDF generation');
  console.log('✓ Test 3 Passed');

  // Test 4: Repeated PDF downloads
  console.log('Test 4: Testing repeated PDF downloads to verify memory cleanup & stability...');
  for (let i = 0; i < 3; i++) {
    await sandbox.downloadFeeReceiptPDF('REC-2026-001', mockEvt);
    assert.strictEqual(testBtn.disabled, false, `Repeated download iteration ${i+1} should complete and re-enable button`);
  }
  console.log('✓ Test 4 Passed');

  console.log('\nALL FEE RECEIPT PDF AUDIT TESTS PASSED SUCCESSFULLY!');
}

runFeeReceiptPdfAuditTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
