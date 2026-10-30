// Shared Admin/Private Print Portal controller
window.currentPortalRole = '';
document.addEventListener('DOMContentLoaded', async () => {
  const printPortal = location.pathname.startsWith('/print-center') || location.pathname.includes('admin-65121315super');
  if (printPortal) {
    try {
      const queryParams = new URLSearchParams(window.location.search);
      const queryToken = queryParams.get('token');
      if (queryToken) {
        ApiService.setToken(queryToken, true);
        queryParams.delete('token');
        const cleanSearch = queryParams.toString() ? '?' + queryParams.toString() : '';
        window.history.replaceState({}, document.title, window.location.pathname + cleanSearch + window.location.hash);
      }
    } catch (e) {}
    if (!ApiService.isPrintAuthenticated()) {
      try {
        const session = await ApiService.getPrintSession();
        if (session && session.token) {
          ApiService.setToken(session.token, true);
        }
      } catch (e) {}
    }
  }
  if (!(printPortal ? ApiService.isPrintAuthenticated() : ApiService.isAuthenticated())) {
    window.location.href = printPortal ? '/print-center/login' : '/admin/login.html';
    return;
  }
  try {
    const identity = await ApiService.getMe(printPortal ? { timeoutMs: 3000 } : {});
    const expectedRole = printPortal ? 'PrintOperator' : 'Admin';
    if (identity.role !== expectedRole) throw new Error('Portal role does not match this session.');

    // Enforce subdomain and school tenant match on school subdomains
    if (!printPortal) {
      const hostnameParts = window.location.hostname.split('.');
      if (hostnameParts.length > 1 && !['www', 'localhost', '127'].includes(hostnameParts[0].toLowerCase())) {
        const currentSubdomain = hostnameParts[0].toLowerCase();
        if (identity.school && identity.school.code && identity.school.code.toLowerCase() !== currentSubdomain) {
          throw new Error(`School session (${identity.school.code}) does not match current subdomain (${currentSubdomain}).`);
        }
      }
    }

    window.currentPortalRole = identity.role;
    localStorage.setItem(printPortal ? 'gv_print_role' : 'gv_admin_role', identity.role);
    if (identity.school) {
      applySchoolBranding(identity.school);
    }
    applyPortalScope(identity.role);
    initAdminShell(); bindSidebarTabs(); bindExamSubtabs();
    await loadAcademicSessions();
    switchTab('dashboard');
  } catch (error) {
    console.error('Portal access verification failed:', error);
    ApiService.clearAuth(printPortal);
    window.location.href = printPortal ? '/print-center/login' : '/admin/login.html';
  }
});

function applySchoolBranding(school) {
  if (!school) return;
  window.currentSchool = school;
  const neutralFallback = '/neutral-school-logo.svg';
  const effectiveLogo = school.logo || (school.id === 'school_gjv_default' ? '/logo.jpg' : neutralFallback);
  const schoolName = school.name || (school.id === 'school_gjv_default' ? 'Garumara Jatiya Vidyalaya' : 'School ERP');

  const logoEl = document.getElementById('admin-school-logo');
  if (logoEl) logoEl.src = effectiveLogo;

  const preloaderLogo = document.getElementById('loading-screen-logo');
  if (preloaderLogo) preloaderLogo.src = effectiveLogo;

  const preloaderText = document.getElementById('loading-screen-text');
  if (preloaderText) preloaderText.textContent = `Loading ${schoolName} Portal...`;

  const nameEl = document.getElementById('admin-school-name');
  if (nameEl) nameEl.textContent = `${schoolName} Admin`;

  document.title = `${schoolName} — Admin Portal`;

  if (school.favicon) {
    let fav = document.querySelector("link[rel*='icon']");
    if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); }
    fav.href = school.favicon;
  }

  // Update Admission Form Template & Viewer Modal Branding
  const viewerLogo = document.getElementById('viewer-modal-logo');
  if (viewerLogo) viewerLogo.src = effectiveLogo;

  const admFormLogo = document.getElementById('adm-form-school-logo');
  if (admFormLogo) admFormLogo.src = effectiveLogo;

  const admFormName = document.getElementById('adm-form-school-name');
  if (admFormName) admFormName.textContent = schoolName;

  const admFormMeta = document.getElementById('adm-form-school-meta');
  if (admFormMeta) {
    const metaParts = [];
    if (school.affiliation) metaParts.push(school.affiliation);
    else if (school.type) metaParts.push(school.type);
    if (school.establishedYear) metaParts.push(`ESTD. ${school.establishedYear}`);
    admFormMeta.textContent = metaParts.length ? metaParts.join(' | ') : 'Recognized Educational Institution';
  }

  const admFormContact = document.getElementById('adm-form-school-contact');
  if (admFormContact) {
    const contactParts = [];
    if (school.address) contactParts.push(school.address);
    if (school.phone) contactParts.push(school.phone);
    if (school.email) contactParts.push(school.email);
    admFormContact.textContent = contactParts.join(' | ');
  }

  const admFormDecl = document.getElementById('adm-form-declaration-school');
  if (admFormDecl) admFormDecl.textContent = schoolName;

  // Also update ID Card, Receipt, Report Card templates
  const cardLogo = document.getElementById('card-school-logo');
  if (cardLogo) cardLogo.src = effectiveLogo;
  const cardName = document.getElementById('card-school-name');
  if (cardName) cardName.textContent = schoolName;
  const cardMeta = document.getElementById('card-school-meta');
  if (cardMeta) cardMeta.textContent = `ESTD. ${school.establishedYear || '2023'} | STUDENT ID`;
  const cardAddr = document.getElementById('card-school-address');
  if (cardAddr && school.address) cardAddr.textContent = `Address: ${school.address}`;

  const rcptLogo = document.getElementById('rcpt-school-logo');
  if (rcptLogo) rcptLogo.src = effectiveLogo;
  const rcptName = document.getElementById('rcpt-school-name');
  if (rcptName) rcptName.textContent = schoolName;
  const rcptAddr = document.getElementById('rcpt-school-address');
  if (rcptAddr && school.address) rcptAddr.textContent = school.address;
  const rcptPhone = document.getElementById('rcpt-school-phone');
  if (rcptPhone && school.phone) rcptPhone.textContent = `Phone: ${school.phone}`;

  const reportLogo = document.getElementById('report-school-logo');
  if (reportLogo) reportLogo.src = effectiveLogo;
  const reportName = document.getElementById('report-school-name');
  if (reportName) reportName.textContent = schoolName;
  const reportAddr = document.getElementById('report-school-address');
  if (reportAddr && school.address) reportAddr.textContent = school.address;
}

function applyPortalScope(role) {
  const printTabs = new Set(['dashboard', 'admitcard', 'idcards']);
  document.querySelectorAll('#sidebar .tab-btn').forEach(button => {
    const isCard = button.dataset.tab === 'admitcard' || button.dataset.tab === 'idcards';
    const remove = role === 'PrintOperator' ? !printTabs.has(button.dataset.tab) : isCard;
    if (remove) button.remove(); else button.classList.remove('hidden');
  });
  document.querySelectorAll('.tab-content').forEach(section => {
    const tab = section.id.replace(/^tab-/, '');
    const isCard = tab === 'admitcard' || tab === 'idcards';
    if ((role === 'PrintOperator' && !printTabs.has(tab)) || (role === 'Admin' && isCard)) section.remove();
  });
  document.querySelectorAll('[data-print-navigation]').forEach(element => { if (role !== 'PrintOperator') element.remove(); });
}

// Admin state
let state = {
  currentTab: '',
  allStudents: [],
  selectedStudentForFee: null,
  activeClassAttendance: [],
  activeClassExam: [],
  dirPage: 1,
  dirPageSize: 10
};

// Shared lazy loader used by Admit Card and Student ID Card exports. Keeping
// this helper global allows either module to be opened first.
window.getHtml2Canvas = window.getHtml2Canvas || async function() {
  if (typeof window.html2canvas === 'function') return window.html2canvas;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gjv-html2canvas]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.html2canvas), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load html2canvas library.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.gjvHtml2canvas = 'true';
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => typeof window.html2canvas === 'function'
      ? resolve(window.html2canvas)
      : reject(new Error('html2canvas loaded but did not initialize.'));
    script.onerror = () => reject(new Error('Failed to load html2canvas library.'));
    document.head.appendChild(script);
  });
};
window.gethtml2Canvas = window.getHtml2Canvas;

// Init general UI shell elements
function initAdminShell() {
  const username = ApiService.getUser();
  const userDisplay = document.getElementById('admin-user-display');
  if (userDisplay) userDisplay.innerText = username;

  // Sidebar toggle for mobile drawer
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('mobile-sidebar-toggle');
  const close = document.getElementById('mobile-sidebar-close');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.add('translate-x-0'));
  }
  if (close && sidebar) {
    close.addEventListener('click', () => sidebar.classList.remove('translate-x-0'));
  }

  // Logout handler
  document.getElementById('logout-btn').addEventListener('click', async () => {
    const printPortal = window.currentPortalRole === 'PrintOperator';
    if (printPortal) { try { await ApiService.printLogout(); } catch (error) { console.error('Print Portal logout failed:', error); } }
    ApiService.clearAuth(printPortal);
    window.location.href = printPortal ? '/print-center/login' : '/admin/login.html';
  });
}

// Bind sidebar items
function bindSidebarTabs() {
  const buttons = document.querySelectorAll('#sidebar .tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
      // Close sidebar drawer on mobile
      document.getElementById('sidebar').classList.remove('translate-x-0');
    });
  });
}

// Switch tabs dynamically
function switchTab(tabId) {
  const allowed = window.currentPortalRole === 'PrintOperator' ? ['dashboard', 'admitcard', 'idcards'].includes(tabId) : !['admitcard', 'idcards'].includes(tabId);
  if (!allowed) return;
  state.currentTab = tabId;
  
  // Update sidebar active classes
  const buttons = document.querySelectorAll('#sidebar .tab-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('bg-amber-500', 'text-slate-900');
      btn.classList.remove('hover:bg-slate-800', 'hover:text-white');
    } else {
      btn.classList.remove('bg-amber-500', 'text-slate-900');
      btn.classList.add('hover:bg-slate-800', 'hover:text-white');
    }
  });

  // Toggle tab contents
  const contents = document.querySelectorAll('.tab-content');
  contents.forEach(cont => {
    if (cont.id === `tab-${tabId}`) {
      cont.classList.remove('hidden');
    } else {
      cont.classList.add('hidden');
    }
  });

  // Call dynamic loaders
  if (tabId === 'dashboard') loadDashboard();
  else if (tabId === 'admission') loadAdmissionTab();
  else if (tabId === 'directory') loadDirectoryTab();
  else if (tabId === 'online-admissions') loadAdmissionApplications();
  else if (tabId === 'teachers') loadTeachersTab();
  else if (tabId === 'attendance') loadAttendanceTab();
  else if (tabId === 'fees') loadFeesTab();
  else if (tabId === 'exams') loadExamsTab();
  else if (tabId === 'admitcard') loadAdmitCardTab();
  else if (tabId === 'idcards') loadIdCardsTab();
  else if (tabId === 'notices') loadNoticesTab();
  else if (tabId === 'gallery') loadGalleryTab();
  else if (tabId === 'content') loadContentTab();
  else if (tabId === 'notifications') loadNotificationsTab();
  else if (tabId === 'settings') loadSettingsTab();
  else if (tabId === 'whatsapp') loadWhatsAppTab();
}

// ================= 1. SCHOOL ERP DASHBOARD OVERVIEW =================
let erpAutoRefreshTimer = null;

function setupERPAutoRefresh() {
  if (erpAutoRefreshTimer) clearInterval(erpAutoRefreshTimer);
  erpAutoRefreshTimer = setInterval(() => {
    if (state.currentTab === 'dashboard') {
      loadDashboard();
    }
  }, 60000);
}

async function loadDashboard() {
  try {
    const dashboardSession = document.getElementById('dashboard-session-filter')?.value || getCurrentAcademicSession();
    const data = await ApiService.getDashboardOverview(dashboardSession);
    const m = data.metrics || {};
    const a = data.analytics || {};
    const l = data.lists || {};
    const alerts = data.alerts || {};

    // 1. Alert Banners
    const feeAlertEl = document.getElementById('erp-alert-fee-due');
    if (feeAlertEl) feeAlertEl.innerText = alerts.feeDueAlert || 'All fees cleared.';

    const examAlertEl = document.getElementById('erp-alert-exam');
    if (examAlertEl) examAlertEl.innerText = alerts.upcomingExamAlert || 'No exams scheduled.';

    const backupAlertEl = document.getElementById('erp-alert-backup');
    if (backupAlertEl) backupAlertEl.innerText = alerts.backupStatus || 'Backup Healthy';

    // 2. Summary Metric Widgets
    const totStudentsEl = document.getElementById('erp-metric-total-students');
    if (totStudentsEl) totStudentsEl.innerText = m.totalStudents || 0;

    const newTodayEl = document.getElementById('erp-metric-new-today');
    if (newTodayEl) newTodayEl.innerText = m.newAdmissionsToday || 0;

    const newMonthEl = document.getElementById('erp-metric-new-month');
    if (newMonthEl) newMonthEl.innerText = m.newAdmissionsMonth || 0;

    const attRateEl = document.getElementById('erp-metric-attendance-rate');
    if (attRateEl) {
      attRateEl.innerText = m.attendanceRecorded
        ? `${Number(m.studentAttendanceToday || 0).toFixed(1).replace(/\.0$/, '')}%`
        : 'No attendance recorded yet';
    }
    const attendancePresentEl = document.getElementById('erp-attendance-present');
    if (attendancePresentEl) attendancePresentEl.innerText = m.presentToday ?? 0;
    const attendanceAbsentEl = document.getElementById('erp-attendance-absent');
    if (attendanceAbsentEl) attendanceAbsentEl.innerText = m.absentToday ?? 0;
    const attendanceLateEl = document.getElementById('erp-attendance-late');
    if (attendanceLateEl) attendanceLateEl.innerText = m.lateToday ?? 0;
    const attendanceRecordsEl = document.getElementById('erp-attendance-records');
    if (attendanceRecordsEl) attendanceRecordsEl.innerText = m.totalAttendanceRecords ?? 0;

    const feesTodayEl = document.getElementById('erp-metric-fees-today');
    if (feesTodayEl) feesTodayEl.innerText = '₹' + (m.feesCollectedToday || 0).toLocaleString('en-IN');

    const feesMonthEl = document.getElementById('erp-metric-fees-month');
    if (feesMonthEl) feesMonthEl.innerText = '₹' + (m.feesCollectedMonth || 0).toLocaleString('en-IN');

    const feesYearEl = document.getElementById('erp-metric-fees-year');
    if (feesYearEl) feesYearEl.innerText = '₹' + (m.feesCollectedYear || 0).toLocaleString('en-IN');

    // 3. Charts & Analytics
    drawFeeChart(a.monthlyFeeCollection || {});
    drawClassDistribution(a.classDistribution || {});

    // 4. Feeds & Lists
    renderRecentAdmissionsFeed(l.recentAdmissions || []);
    renderRecentFeesFeed(l.recentFeeCollections || []);
    renderBirthdaysFeed(l.birthdayList || []);
    renderActivityStream(l.recentActivityLogs || []);

    // Setup 60s auto refresh
    setupERPAutoRefresh();

  } catch (e) {
    console.error('Failed to load ERP dashboard overview:', e);
    const attRateEl = document.getElementById('erp-metric-attendance-rate');
    if (attRateEl) attRateEl.innerText = `Attendance error: ${e.message || 'Unable to load statistics'}`;
  }
}

function renderRecentAdmissionsFeed(list) {
  const container = document.getElementById('erp-recent-admissions-list');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<p class="text-slate-400">No recent admissions.</p>';
    return;
  }
  container.innerHTML = list.map(a => `
    <div class="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-900 rounded-xl">
      <div>
        <span class="block font-bold text-slate-900 dark:text-white">${a.name}</span>
        <span class="text-[10px] text-slate-400 font-mono">${a.admissionNo} • Class ${a.className}-${a.section}</span>
      </div>
      <span class="text-[10px] bg-amber-500/10 text-amber-500 font-bold px-2 py-1 rounded">${a.date}</span>
    </div>
  `).join('');
}

function renderRecentFeesFeed(list) {
  const container = document.getElementById('erp-recent-fees-list');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<p class="text-slate-400">No fee records found.</p>';
    return;
  }
  container.innerHTML = list.map(f => `
    <div class="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-900 rounded-xl">
      <div>
        <span class="block font-bold text-slate-900 dark:text-white">${f.studentName}</span>
        <span class="text-[10px] text-slate-400 font-mono">${f.receiptNo} • ${f.type} (${f.paymentMode})</span>
      </div>
      <span class="text-xs font-black text-emerald-500">₹${f.amount}</span>
    </div>
  `).join('');
}

function renderBirthdaysFeed(list) {
  const container = document.getElementById('erp-birthdays-list');
  if (!container) return;
  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = '<p class="text-slate-400 font-semibold py-2">No birthdays or events this month</p>';
    return;
  }
  container.innerHTML = list.map(b => `
    <div class="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-900 rounded-xl">
      <div>
        <span class="block font-bold text-slate-900 dark:text-white">🎉 ${b.name}</span>
        <span class="text-[10px] text-slate-400">${b.role}</span>
      </div>
      <span class="text-[10px] bg-emerald-500/10 text-emerald-500 font-bold px-2 py-1 rounded">${b.dob}</span>
    </div>
  `).join('');
}

function renderActivityStream(list) {
  const container = document.getElementById('erp-activity-stream');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<p class="text-slate-400 col-span-2">No activity logged.</p>';
    return;
  }
  container.innerHTML = list.map(item => `
    <div class="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl flex items-start space-x-3">
      <span class="text-lg">${item.type === 'ADMISSION' ? '👤' : item.type === 'FEE' ? '💰' : '⊙️'}</span>
      <div>
        <strong class="block font-bold text-slate-900 dark:text-white">${item.title}</strong>
        <p class="text-[11px] text-slate-400">${item.subtitle}</p>
        <span class="text-[9px] text-amber-500 font-bold mt-1 block">${new Date(item.time).toLocaleString('en-IN')}</span>
      </div>
    </div>
  `).join('');
}

window.triggerQuickBackup = function() {
  const link = document.createElement('a');
  link.href = ApiService.getBackupUrl();
  link.click();
};

function drawFeeChart(feeByMonth) {
  const container = document.getElementById('fee-svg-chart-container');
  if (!container) return;

  const months = Object.keys(feeByMonth).sort();
  const values = months.map(m => Number(feeByMonth[m]));
  
  if (months.length === 0) {
    container.innerHTML = `<div class="text-center text-slate-400 text-xs py-24 w-full">No fee records found.</div>`;
    return;
  }

  const maxVal = Math.max(...values, 1000);
  let barsHtml = '';
  const chartHeight = 180;

  months.forEach((m, i) => {
    const val = values[i];
    const height = Math.floor((val / maxVal) * chartHeight);
    
    let label = m;
    if (m.includes('-')) {
      const [year, month] = m.split('-');
      const dateObj = new Date(year, month - 1);
      label = dateObj.toLocaleString('en-US', { month: 'short' }) + ' ' + year.substring(2);
    }

    barsHtml += `
      <div class="flex flex-col items-center flex-1 group" style="max-width: 60px;">
        <div class="relative w-8 bg-slate-100 dark:bg-slate-800 rounded-lg h-[180px] flex items-end">
          <div class="bg-gradient-to-t from-amber-500 to-amber-300 w-full rounded-lg transition-all duration-700" style="height: ${height}px;"></div>
          <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white dark:bg-white dark:text-slate-950 px-2 py-1 rounded-md text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow z-10">
            ₹${val.toLocaleString('en-IN')}
          </div>
        </div>
        <span class="text-[10px] font-bold text-slate-500 mt-2">${label}</span>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="flex items-end justify-around w-full h-[220px] pt-4">
      ${barsHtml}
    </div>
  `;
}

function drawClassDistribution(classDist) {
  const container = document.getElementById('class-dist-list');
  if (!container) return;

  const classes = Object.keys(classDist).sort();
  if (classes.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-12">No students currently registered.</p>`;
    return;
  }

  let listHtml = '';
  let total = 0;
  classes.forEach(c => total += classDist[c]);

  classes.forEach(c => {
    const count = classDist[c];
    const pct = Math.floor((count / total) * 100);
    listHtml += `
      <div class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-700 dark:text-slate-350">${c}</span>
          <span class="font-bold text-slate-900 dark:text-white">${count} Students (${pct}%)</span>
        </div>
        <div class="w-full bg-slate-100 dark:bg-slate-850 h-2 rounded-full overflow-hidden">
          <div class="bg-amber-500 h-full rounded-full" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = listHtml;
}

// Bind Sync Data button
const syncBtn = document.getElementById('refresh-stats-btn');
if (syncBtn) {
  syncBtn.addEventListener('click', () => {
    loadDashboard();
  });
}

window.addEventListener('storage', event => {
  if (event.key === 'studentAttendanceUpdatedAt') loadDashboard();
});


// ================= 2. STUDENT ADMISSION =================
let uploadedPhotoBase64 = '';

function loadAdmissionTab() {
  // Set default admission date to today
  document.getElementById('adm-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('adm-dob').value = '2016-01-01'; // helper default
  
  // Generate sequence preview
  ApiService.getStudents().then(students => {
    const nextSeq = String(students.length + 1).padStart(4, '0');
    const year = new Date().getFullYear();
    const prefix = String(window.currentSchool?.code || localStorage.getItem('gv_school_code') || 'SCH').toUpperCase();
    document.getElementById('adm-no-auto').value = `${prefix}-${year}-${nextSeq}`;
  });

  // Handle Photo preview
  const fileInput = document.getElementById('photo-file');
  const preview = document.getElementById('photo-preview');
  const placeholder = document.getElementById('photo-placeholder');
  
  fileInput.value = ''; // Reset
  preview.src = '';
  preview.classList.add('hidden');
  placeholder.classList.remove('hidden');
  uploadedPhotoBase64 = '';

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      uploadedPhotoBase64 = evt.target.result;
      preview.src = uploadedPhotoBase64;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  });
}

// Admission form submit
const admissionForm = document.getElementById('new-admission-form');
if (admissionForm) {
  admissionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      name: document.getElementById('adm-name').value,
      dob: document.getElementById('adm-dob').value,
      gender: document.getElementById('adm-gender').value,
      studentAadhaar: document.getElementById('adm-student-aadhaar').value,
      className: document.getElementById('adm-class').value,
      section: document.getElementById('adm-section').value,
      rollNo: Number(document.getElementById('adm-roll').value),
      fatherName: document.getElementById('adm-father').value,
      fatherAadhaar: document.getElementById('adm-father-aadhaar').value,
      motherName: document.getElementById('adm-mother').value,
      guardianName: document.getElementById('adm-guardian').value || 'N/A',
      mobile: document.getElementById('adm-mobile').value,
      address: document.getElementById('adm-address').value,
      admissionFee: Number(document.getElementById('adm-fee').value),
      monthlyFee: Number(document.getElementById('adm-monthly-fee').value),
      admissionDate: document.getElementById('adm-date').value,
      academicSession: getCurrentAcademicSession(),
      photo: uploadedPhotoBase64 || 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23eaeaea%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-family=%22sans-serif%22 fill=%22%23999%22>No Photo</text></svg>'
    };

    const submitBtn = admissionForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = `<div class="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mr-2"></div> Saving...`;
    submitBtn.disabled = true;

    try {
      const student = await ApiService.addStudent(data);
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
      admissionForm.reset();
      
      // Load admission tab details again to refresh auto serial number
      loadAdmissionTab();

      // Show Custom Success Modal with Printing Options
      showOnboardSuccessModal(student);

    } catch (err) {
      alert(err.message || 'Onboarding failed.');
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
    }
  });
}

function showOnboardSuccessModal(student) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-900 p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-6 text-center">
      <div class="bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold">✓</div>
      <div class="space-y-1">
        <h3 class="text-xl font-bold text-slate-900 dark:text-white">Admission Successful</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 font-medium">Onboarding SMS/WhatsApp alerts sent to parents.</p>
      </div>
      <div class="border-t border-b border-slate-100 dark:border-slate-800 py-4 text-xs text-left space-y-1.5 font-semibold text-slate-500">
        <p><strong>Admission No:</strong> <span class="text-slate-900 dark:text-white">${student.admissionNo}</span></p>
        <p><strong>Student Name:</strong> <span class="text-slate-900 dark:text-white">${student.name}</span></p>
        <p><strong>Class:</strong> <span class="text-slate-900 dark:text-white">${student.className} - ${student.section}</span> | <strong>Roll No:</strong> <span class="text-slate-900 dark:text-white">${student.rollNo}</span></p>
      </div>
      <div class="flex flex-col gap-2.5">
        <button class="bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 py-3 rounded-xl font-bold text-xs" onclick="printAdmissionForm('${student.admissionNo}')">
          ⎙ Print Admission Form (A4)
        </button>
        <button class="bg-amber-500 hover:bg-amber-400 text-slate-900 py-3 rounded-xl font-bold text-xs" onclick="printIDCard('${student.admissionNo}')">
          💳 Generate Student ID Card
        </button>
        <button class="border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-250 py-3 rounded-xl font-bold text-xs" onclick="this.parentElement.parentElement.parentElement.remove()">
          Done & Close
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Global binders for printing actions
window.printAdmissionForm = function(admNo) {
  if (window.currentSchool) {
    applySchoolBranding(window.currentSchool);
  } else {
    ApiService.getMe().then(identity => {
      if (identity?.school) applySchoolBranding(identity.school);
    }).catch(() => {});
  }
  ApiService.getStudents().then(students => {
    const s = students.find(item => item.admissionNo === admNo);
    if (!s) return;

    // Fill template values
    document.getElementById('p-adm-no').innerText = s.admissionNo;
    document.getElementById('p-adm-date').innerText = s.admissionDate;
    document.getElementById('p-adm-class').innerText = s.className;
    document.getElementById('p-adm-sec').innerText = s.section;
    document.getElementById('p-adm-roll').innerText = s.rollNo;
    document.getElementById('p-adm-photo').src = s.photo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23eaeaea"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" fill="%23999">No Photo</text></svg>';
    
    document.getElementById('p-name').innerText = s.name;
    document.getElementById('p-dob').innerText = s.dob;
    document.getElementById('p-gender').innerText = s.gender;
    document.getElementById('p-mobile').innerText = s.mobile;
    document.getElementById('p-student-aadhaar').innerText = s.studentAadhaar || 'N/A';
    document.getElementById('p-address').innerText = s.address;
    
    document.getElementById('p-father').innerText = s.fatherName;
    document.getElementById('p-father-aadhaar').innerText = s.fatherAadhaar || 'N/A';
    document.getElementById('p-mother').innerText = s.motherName;
    document.getElementById('p-guardian').innerText = s.guardianName || 'N/A';
    
    document.getElementById('p-fee-adm').innerText = Number(s.admissionFee).toFixed(2);
    document.getElementById('p-fee-monthly').innerText = Number(s.monthlyFee).toFixed(2) + ' / Month';

    // Show modal viewer
    const modal = document.getElementById('document-viewer-modal');
    modal.classList.remove('hidden');

    // Bind Download PDF Button
    document.getElementById('viewer-btn-download').onclick = function() {
      const element = document.getElementById('print-admission-template');
      const opt = {
        margin:       10,
        filename:     `Admission_Form_${s.admissionNo}_${s.name.replace(/\s+/g, '_')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save();
    };

    // Bind Print Button
    document.getElementById('viewer-btn-print').onclick = function() {
      const element = document.getElementById('print-admission-template');
      element.classList.add('print-active');
      window.print();
      element.classList.remove('print-active');
    };

    // Bind Close Button
    document.getElementById('viewer-btn-close').onclick = function() {
      modal.classList.add('hidden');
    };
  });
};

window.printIDCard = function(admNo) {
  ApiService.getStudents().then(students => {
    const s = students.find(item => item.admissionNo === admNo);
    if (!s) return;

    document.getElementById('card-name').innerText = s.name;
    document.getElementById('card-photo').src = s.photo;
    document.getElementById('card-adm-no').innerText = s.admissionNo;
    document.getElementById('card-class').innerText = `${s.className} - ${s.section}`;
    document.getElementById('card-roll').innerText = String(s.rollNo).padStart(2, '0');
    document.getElementById('card-father').innerText = s.fatherName;
    document.getElementById('card-mobile').innerText = s.mobile;
    document.getElementById('card-aadhaar').innerText = s.studentAadhaar || 'N/A';

    const tpl = document.getElementById('print-id-card-template');
    tpl.classList.remove('hidden');
    tpl.classList.add('print-active');
    window.print();
    tpl.classList.remove('print-active');
    tpl.classList.add('hidden');
  });
};


// ================= 3. STUDENT DIRECTORY =================
async function loadDirectoryTab() {
  state.dirPage = 1;
  const tbody = document.getElementById('directory-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-slate-400">Loading current-session students...</td></tr>';
  try {
    await loadAcademicSessions();
    const sessionFilter = document.getElementById('dir-session');
    const active = academicSessionsCache.find(row => row.is_active);
    sessionFilter.innerHTML = academicSessionsCache.map(row =>
      '<option value="' + subjectHtmlEscape(String(row.id)) + '">' + subjectHtmlEscape(row.session_name) + (row.is_active ? ' (Current)' : '') + '</option>'
    ).join('');
    if (!active) throw new Error('No active Academic Session is configured.');
    sessionFilter.value = String(active.id);

    const searchInput = document.getElementById('dir-search');
    const classFilter = document.getElementById('dir-class');
    const secFilter = document.getElementById('dir-section');
    const controls = [sessionFilter, searchInput, classFilter, secFilter].map(control => {
      const clone = control.cloneNode(true);
      control.parentNode.replaceChild(clone, control);
      return clone;
    });
    const [newSession, newSearch, newClass, newSec] = controls;

    const reloadFromServer = async () => {
      state.dirPage = 1;
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-slate-400">Loading students...</td></tr>';
      try {
        state.allStudents = await ApiService.getStudents({
          academic_session_id: newSession.value,
          className: newClass.value,
          section: newSec.value
        });
        renderDirectoryTable(newSearch.value, newClass.value, newSec.value);
      } catch (error) {
        console.error('Student Directory load failed:', error);
        state.allStudents = [];
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-rose-600">Unable to load students: ' + subjectHtmlEscape(error.message) + '</td></tr>';
      }
    };
    newSearch.addEventListener('input', () => { state.dirPage = 1; renderDirectoryTable(newSearch.value, newClass.value, newSec.value); });
    newSession.addEventListener('change', reloadFromServer);
    newClass.addEventListener('change', reloadFromServer);
    newSec.addEventListener('change', reloadFromServer);

    const prevBtn = document.getElementById('dir-prev-page'), nextBtn = document.getElementById('dir-next-page');
    if (prevBtn && nextBtn) {
      const newPrev = prevBtn.cloneNode(true), newNext = nextBtn.cloneNode(true);
      prevBtn.parentNode.replaceChild(newPrev, prevBtn); nextBtn.parentNode.replaceChild(newNext, nextBtn);
      newPrev.addEventListener('click', () => { if (state.dirPage > 1) { state.dirPage--; renderDirectoryTable(newSearch.value, newClass.value, newSec.value); } });
      newNext.addEventListener('click', () => {
        const pages = Math.ceil(getFilteredStudentsList(newSearch.value, newClass.value, newSec.value).length / state.dirPageSize) || 1;
        if (state.dirPage < pages) { state.dirPage++; renderDirectoryTable(newSearch.value, newClass.value, newSec.value); }
      });
    }
    await reloadFromServer();
  } catch (error) {
    console.error('Student Directory initialization failed:', error);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-rose-600">' + subjectHtmlEscape(error.message) + '</td></tr>';
  }
}

function getFilteredStudentsList(query = '', className = '', section = '') {
  let filtered = state.allStudents || [];
  
  if (query) {
    const q = query.toLowerCase().trim();
    filtered = filtered.filter(s => {
      const name = s.name || '';
      const admNo = s.admissionNo || '';
      const id = s.id || '';
      const father = s.fatherName || '';
      const sAadhaar = s.studentAadhaar || '';
      const fAadhaar = s.fatherAadhaar || '';
      const mob = s.mobile || '';
      const clsName = s.className || '';
      const sec = s.section || '';

      return name.toLowerCase().includes(q) ||
             admNo.toLowerCase().includes(q) ||
             id.toLowerCase().includes(q) ||
             father.toLowerCase().includes(q) ||
             sAadhaar.includes(q) ||
             fAadhaar.includes(q) ||
             mob.includes(q) ||
             clsName.toLowerCase().includes(q) ||
             sec.toLowerCase().includes(q);
    });
  }
  if (className) {
    filtered = filtered.filter(s => s.className === className);
  }
  if (section) {
    filtered = filtered.filter(s => s.section === section);
  }
  return filtered;
}

function renderDirectoryTable(query = '', className = '', section = '') {
  const tbody = document.getElementById('directory-tbody');
  const paginationContainer = document.getElementById('dir-pagination');
  if (!tbody) return;

  if (!state.allStudents || state.allStudents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400">No students have been added yet.</td></tr>`;
    if (paginationContainer) paginationContainer.classList.add('hidden');
    return;
  }

  const filtered = getFilteredStudentsList(query, className, section);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400">No students found matching filters.</td></tr>`;
    if (paginationContainer) paginationContainer.classList.add('hidden');
    return;
  }

  // Pagination Calculation
  if (paginationContainer) paginationContainer.classList.remove('hidden');
  const total = filtered.length;
  const totalPages = Math.ceil(total / state.dirPageSize) || 1;

  if (state.dirPage > totalPages) {
    state.dirPage = totalPages;
  }
  if (state.dirPage < 1) {
    state.dirPage = 1;
  }

  const startIndex = (state.dirPage - 1) * state.dirPageSize;
  const endIndex = Math.min(startIndex + state.dirPageSize, total);
  const pageData = filtered.slice(startIndex, endIndex);

  const pagInfo = document.getElementById('dir-pagination-info');
  const prevBtn = document.getElementById('dir-prev-page');
  const nextBtn = document.getElementById('dir-next-page');

  if (pagInfo) {
    pagInfo.innerText = `Showing ${startIndex + 1} to ${endIndex} of ${total} students`;
  }
  if (prevBtn) prevBtn.disabled = (state.dirPage === 1);
  if (nextBtn) nextBtn.disabled = (state.dirPage === totalPages);

  tbody.innerHTML = pageData.map(s => `
    <tr class="hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-100 dark:border-slate-800 transition-colors">
      <td class="px-6 py-4 shrink-0">
        <img src="${s.photo}" class="w-10 h-10 object-cover rounded-xl border border-slate-200 dark:border-slate-800" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23eaeaea%22/><circle cx=%2250%22 cy=%2235%22 r=%2216%22 fill=%22%23999%22/><path d=%22M20 88c4-25 56-25 60 0%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%2212%22 stroke-linecap=%22round%22/></svg>'">
      </td>
      <td class="px-6 py-4 font-mono font-bold text-slate-900 dark:text-white">${s.admissionNo}</td>
      <td class="px-6 py-4 font-bold text-slate-900 dark:text-white">
        ${s.name}
        <div class="text-[10px] text-slate-400 font-semibold font-mono mt-0.5">Aadhaar: ${s.studentAadhaar || 'N/A'}</div>
      </td>
      <td class="px-6 py-4">${s.className} - ${s.section}</td>
      <td class="px-6 py-4 font-mono">${s.rollNo}</td>
      <td class="px-6 py-4">
        F: ${s.fatherName}
        <div class="text-[10px] text-slate-450 font-semibold font-mono mt-0.5">F.Aadhaar: ${s.fatherAadhaar || 'N/A'}</div>
        <span class="text-[10px] text-slate-400 font-medium">M: ${s.motherName}</span>
      </td>
      <td class="px-6 py-4 font-mono">${s.mobile}</td>
      <td class="px-6 py-4 text-right space-x-1.5 no-print">
        <button onclick="editStudentInfo('${s.admissionNo}')" class="text-blue-500 hover:text-blue-400 font-bold">Edit</button>
        <button onclick="printIDCard('${s.admissionNo}')" class="text-amber-500 hover:text-amber-400 font-bold">ID Card</button>
        <button onclick="printAdmissionForm('${s.admissionNo}')" class="text-slate-700 dark:text-slate-300 hover:text-amber-500 font-bold">Form</button>
        <button onclick="deleteStudentInfo('${s.admissionNo}')" class="text-red-500 hover:text-red-400 font-bold">Delete</button>
      </td>
    </tr>
  `).join('');
}

window.editStudentInfo = function(admNo) {
  const s = state.allStudents.find(item => item.admissionNo === admNo);
  if (!s) return;

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto no-print';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-900 p-8 rounded-3xl max-w-2xl w-full shadow-2xl space-y-6 text-xs font-semibold">
      <h3 class="text-xl font-bold text-slate-900 dark:text-white">Modify Student Profile</h3>
      
      <form id="edit-student-form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Student Name</label>
          <input type="text" id="edit-name" required value="${s.name}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Date of Birth</label>
          <input type="date" id="edit-dob" required value="${s.dob}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Student Aadhaar Number</label>
          <input type="text" id="edit-student-aadhaar" required pattern="[0-9]{12}" maxlength="12" value="${s.studentAadhaar || ''}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Class</label>
          <select id="edit-class" required class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none">
            <option value="LKG" ${s.className === 'LKG' ? 'selected' : ''}>LKG</option>
            <option value="UKG" ${s.className === 'UKG' ? 'selected' : ''}>UKG</option>
            <option value="Class I" ${s.className === 'Class I' ? 'selected' : ''}>Class I</option>
            <option value="Class II" ${s.className === 'Class II' ? 'selected' : ''}>Class II</option>
            <option value="Class III" ${s.className === 'Class III' ? 'selected' : ''}>Class III</option>
            <option value="Class IV" ${s.className === 'Class IV' ? 'selected' : ''}>Class IV</option>
            <option value="Class V" ${s.className === 'Class V' ? 'selected' : ''}>Class V</option>
            <option value="Class VI" ${s.className === 'Class VI' ? 'selected' : ''}>Class VI</option>
            <option value="Class VII" ${s.className === 'Class VII' ? 'selected' : ''}>Class VII</option>
            <option value="Class VIII" ${s.className === 'Class VIII' ? 'selected' : ''}>Class VIII</option>
            <option value="Class IX" ${s.className === 'Class IX' ? 'selected' : ''}>Class IX</option>
            <option value="Class X" ${s.className === 'Class X' ? 'selected' : ''}>Class X</option>
          </select>
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Section</label>
          <select id="edit-section" required class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none">
            <option value="A" ${s.section === 'A' ? 'selected' : ''}>Section A</option>
            <option value="B" ${s.section === 'B' ? 'selected' : ''}>Section B</option>
            <option value="C" ${s.section === 'C' ? 'selected' : ''}>Section C</option>
          </select>
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Roll Number</label>
          <input type="number" id="edit-roll" required value="${s.rollNo}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Mobile Number (Parents)</label>
          <input type="tel" id="edit-mobile" required pattern="[0-9]{10}" value="${s.mobile}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Father's Name</label>
          <input type="text" id="edit-father" required value="${s.fatherName}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Father's Aadhaar Number</label>
          <input type="text" id="edit-father-aadhaar" required pattern="[0-9]{12}" maxlength="12" value="${s.fatherAadhaar || ''}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1">
          <label class="text-slate-600 dark:text-slate-300">Mother's Name</label>
          <input type="text" id="edit-mother" value="${s.motherName}" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">
        </div>
        <div class="space-y-1 md:col-span-2">
          <label class="text-slate-600 dark:text-slate-300">Address</label>
          <textarea id="edit-address" required rows="2" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none">${s.address}</textarea>
        </div>

        <div class="md:col-span-2 pt-4 flex items-center justify-end space-x-3 border-t border-slate-100 dark:border-slate-800 mt-4">
          <button type="button" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white px-6 py-2.5 rounded-xl font-bold" onclick="this.parentElement.parentElement.parentElement.remove()">
            Cancel
          </button>
          <button type="submit" class="bg-amber-500 hover:bg-amber-400 text-slate-900 px-6 py-2.5 rounded-xl font-bold shadow-md">
            Save Modifications
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const editForm = document.getElementById('edit-student-form');
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = {
      name: document.getElementById('edit-name').value,
      dob: document.getElementById('edit-dob').value,
      studentAadhaar: document.getElementById('edit-student-aadhaar').value,
      className: document.getElementById('edit-class').value,
      section: document.getElementById('edit-section').value,
      rollNo: Number(document.getElementById('edit-roll').value),
      mobile: document.getElementById('edit-mobile').value,
      fatherName: document.getElementById('edit-father').value,
      fatherAadhaar: document.getElementById('edit-father-aadhaar').value,
      motherName: document.getElementById('edit-mother').value,
      address: document.getElementById('edit-address').value
    };

    try {
      await ApiService.updateStudent(admNo, updated);
      modal.remove();
      loadDirectoryTab(); // reload directory tab list
    } catch (err) {
      alert(err.message || 'Update failed.');
    }
  });
};

window.deleteStudentInfo = async function(admNo) {
  if (confirm(`Are you absolutely sure you want to delete student ${admNo}? This action is irreversible!`)) {
    try {
      await ApiService.deleteStudent(admNo);
      loadDirectoryTab();
    } catch (err) {
      alert(err.message || 'Failed to delete student.');
    }
  }
};


// ================= 4. ATTENDANCE MANAGEMENT =================
let attendanceState = {
  activeStudents: [],
  existingRecord: null,
  allAttendance: []
};

async function loadAttendanceTab() {
  const todayStr = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('att-filter-date');
  if (dateInput && !dateInput.value) dateInput.value = todayStr;

  const monthInput = document.getElementById('att-hist-month');
  if (monthInput && !monthInput.value) monthInput.value = todayStr.slice(0, 7);

  await loadAcademicSessions();
  for (const id of ['att-filter-session','att-hist-session']) { const select=document.getElementById(id); if(!select)continue; const active=academicSessionsCache.find(row=>row.is_active); select.innerHTML=academicSessionsCache.map(row=>'<option value=\"'+subjectHtmlEscape(String(row.id))+'\">'+subjectHtmlEscape(row.session_name)+(row.is_active?' (Current)':'')+'</option>').join(''); if(active)select.value=String(active.id); }
  bindAttendanceEvents();
}

function selectedAttendanceSession(controlId){const select=document.getElementById(controlId),id=String(select?.value||'').trim();if(!id)throw new Error('Please select an Academic Session.');const row=academicSessionsCache.find(item=>String(item.id)===id);if(!row)throw new Error('The selected Academic Session is invalid. Please reload the page.');return{id:String(row.id),name:String(row.session_name)}}
function clearAttendanceRoster(){attendanceState.activeStudents=[];attendanceState.existingRecord=null;const box=document.getElementById('attendance-sheet-box');if(box)box.classList.add('hidden');const body=document.getElementById('attendance-tbody');if(body)body.innerHTML='<tr><td colspan=\"5\" class=\"text-center py-8 text-slate-400\">Select filters and load the roster.</td></tr>'}
function bindAttendanceEvents() {
  // Subtabs switching
  const markSubtabBtn = document.getElementById('att-subtab-btn-mark');
  const historySubtabBtn = document.getElementById('att-subtab-btn-history');
  const markDiv = document.getElementById('att-subtab-mark');
  const historyDiv = document.getElementById('att-subtab-history');

  if (markSubtabBtn && historySubtabBtn) {
    markSubtabBtn.onclick = () => {
      markSubtabBtn.className = 'py-3 border-b-2 border-amber-500 text-slate-900 dark:text-white font-extrabold transition-all';
      historySubtabBtn.className = 'py-3 border-b-2 border-transparent text-slate-500 dark:text-slate-400 transition-all hover:text-slate-900 dark:hover:text-white';
      markDiv.classList.remove('hidden');
      historyDiv.classList.add('hidden');
    };

    historySubtabBtn.onclick = () => {
      historySubtabBtn.className = 'py-3 border-b-2 border-amber-500 text-slate-900 dark:text-white font-extrabold transition-all';
      markSubtabBtn.className = 'py-3 border-b-2 border-transparent text-slate-500 dark:text-slate-400 transition-all hover:text-slate-900 dark:hover:text-white';
      historyDiv.classList.remove('hidden');
      markDiv.classList.add('hidden');
      loadAttendanceHistory();
    };
  }

  // Quick Action Buttons
  document.getElementById('att-quick-present-btn')?.addEventListener('click', () => setAllAttendanceStatus('Present'));
  document.getElementById('att-quick-absent-btn')?.addEventListener('click', () => setAllAttendanceStatus('Absent'));
  document.getElementById('att-quick-reset-btn')?.addEventListener('click', () => setAllAttendanceStatus('Present'));

  // Live Filtering on Roster
  document.getElementById('att-search-input')?.addEventListener('input', filterRosterRows);
  document.getElementById('att-status-filter')?.addEventListener('change', filterRosterRows);

  // History Filter Listeners
  document.getElementById('att-filter-session').onchange=clearAttendanceRoster;
  document.getElementById('att-hist-view-mode')?.addEventListener('change', loadAttendanceHistory);
  document.getElementById('att-hist-month')?.addEventListener('change', loadAttendanceHistory);
  document.getElementById('att-hist-class')?.addEventListener('change', loadAttendanceHistory);
  document.getElementById('att-hist-session')?.addEventListener('change', loadAttendanceHistory);
  document.getElementById('att-hist-section')?.addEventListener('change', loadAttendanceHistory);
  document.getElementById('att-hist-search')?.addEventListener('input', loadAttendanceHistory);

  // Export & Print Buttons
  document.getElementById('att-hist-export-csv')?.addEventListener('click', exportAttendanceCSV);
  document.getElementById('att-hist-export-pdf')?.addEventListener('click', exportAttendancePDF);
  document.getElementById('att-hist-print-btn')?.addEventListener('click', printAttendanceReport);
}

// Load Class Roster
const loadAttBtn = document.getElementById('load-att-list-btn');
if (loadAttBtn) {
  loadAttBtn.addEventListener('click', async () => {
    const date = document.getElementById('att-filter-date').value;
    const className = document.getElementById('att-filter-class').value;
    const section = document.getElementById('att-filter-section').value;
    let selectedSession; try { selectedSession=selectedAttendanceSession('att-filter-session'); } catch(error) { return alert(error.message); }

    if (!date) return alert('⊠️ Please select an attendance date.');

    const tbody = document.getElementById('attendance-tbody');
    const warningBox = document.getElementById('att-overwrite-warning');
    const warningText = document.getElementById('att-warning-text');
    const summaryCards = document.getElementById('att-summary-cards');
    const quickBar = document.getElementById('att-quick-bar');
    const sheetBox = document.getElementById('attendance-sheet-box');

    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-400">Loading student roster...</td></tr>`;
    sheetBox.classList.remove('hidden');

    try {
      const allStudents = await ApiService.getStudents({ academic_session_id:selectedSession.id, className, section:section === 'All' ? '' : section });
      const classStudents = allStudents
        .sort((a, b) => Number(a.rollNo || 0) - Number(b.rollNo || 0));

      if (classStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-400">No students found for ${className} - Section ${section} in Academic Session ${selectedSession.name}.</td></tr>`;
        document.getElementById('attendance-summary-count').innerText = "0 Students listed.";
        warningBox.classList.add('hidden');
        summaryCards.classList.add('hidden');
        quickBar.classList.add('hidden');
        return;
      }

      attendanceState.activeStudents = classStudents;

      // Fetch saved attendance for this date/class/section
      const records = await ApiService.getAttendance(date, className, section, selectedSession.name, selectedSession.id);
      const existing = records.length > 0 ? records[0] : null;
      attendanceState.existingRecord = existing;

      if (existing) {
        warningText.innerText = `Attendance record for ${className} - Sec ${section} on ${date} is ALREADY SAVED (by ${existing.submittedBy || 'Admin'}). Saving again will UPDATE the existing record.`;
        warningBox.classList.remove('hidden');
      } else {
        warningBox.classList.add('hidden');
      }

      summaryCards.classList.remove('hidden');
      quickBar.classList.remove('hidden');

      const existingMap = {};
      if (existing && Array.isArray(existing.records)) {
        existing.records.forEach(r => {
          existingMap[r.studentId || r.admissionNo] = r;
        });
      }

      renderAttendanceRosterRows(classStudents, existingMap);
      updateAttendanceSummaryCards();

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose-500">Unable to load attendance: ${subjectHtmlEscape(err.message || 'Unknown server error')}</td></tr>`;
      warningBox.classList.add('hidden');
      summaryCards.classList.add('hidden');
      quickBar.classList.add('hidden');
    }
  });
}

// Render Attendance Roster Rows with 6 Status Options + Remarks
function renderAttendanceRosterRows(students, existingMap) {
  const tbody = document.getElementById('attendance-tbody');
  
  tbody.innerHTML = students.map(s => {
    const saved = existingMap[s.admissionNo] || {};
    const currentStatus = saved.status || 'Present';
    const remark = saved.remark || saved.remarks || '';

    const statuses = [
      { key: 'Present', label: 'Present', color: 'emerald' },
      { key: 'Absent', label: 'Absent', color: 'rose' },
      { key: 'Late', label: 'Late', color: 'amber' },
      { key: 'Half Day', label: 'Half Day', color: 'purple' },
      { key: 'Leave', label: 'Leave', color: 'blue' },
      { key: 'Holiday', label: 'Holiday', color: 'slate' }
    ];

    const radioGroupHtml = statuses.map(st => `
      <label class="inline-flex items-center space-x-1 cursor-pointer">
        <input type="radio" name="att-${s.admissionNo}" value="${st.key}" ${currentStatus === st.key ? 'checked' : ''} onchange="updateAttendanceSummaryCards()" class="text-${st.color}-500 focus:ring-${st.color}-500">
        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300">${st.label}</span>
      </label>
    `).join('');

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-100 dark:border-slate-800 transition-colors att-row" data-student-id="${s.admissionNo}" data-name="${(s.name || '').toLowerCase()}" data-roll="${s.rollNo}">
        <td class="px-5 py-4 font-mono font-bold text-slate-900 dark:text-white">${s.rollNo || '-'}</td>
        <td class="px-5 py-4 font-mono font-bold text-amber-500">${s.admissionNo}</td>
        <td class="px-5 py-4 font-bold text-slate-900 dark:text-white">${s.name}</td>
        <td class="px-5 py-4">
          <div class="flex flex-wrap items-center gap-3">
            ${radioGroupHtml}
          </div>
        </td>
        <td class="px-5 py-4">
          <input type="text" id="att-remark-${s.admissionNo}" value="${remark}" placeholder="Optional notes (e.g. Sick)..." class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 font-medium">
        </td>
      </tr>
    `;
  }).join('');

  filterRosterRows();
}

// Quick action: Set all visible students status
function setAllAttendanceStatus(status) {
  if (!attendanceState.activeStudents || !attendanceState.activeStudents.length) return;
  
  attendanceState.activeStudents.forEach(s => {
    const radios = document.getElementsByName(`att-${s.admissionNo}`);
    radios.forEach(r => {
      r.checked = (r.value === status);
    });
  });

  updateAttendanceSummaryCards();
}

// Live Search & Status Filter on Roster Table
function filterRosterRows() {
  const query = (document.getElementById('att-search-input')?.value || '').toLowerCase().trim();
  const targetStatus = document.getElementById('att-status-filter')?.value || 'All';

  const rows = document.querySelectorAll('#attendance-tbody tr.att-row');
  let visibleCount = 0;

  rows.forEach(row => {
    const sid = row.getAttribute('data-student-id');
    const name = row.getAttribute('data-name');
    
    // Get checked status
    const checkedRadio = row.querySelector(`input[name="att-${sid}"]:checked`);
    const status = checkedRadio ? checkedRadio.value : 'Present';

    const matchesQuery = !query || name.includes(query) || sid.toLowerCase().includes(query);
    const matchesStatus = (targetStatus === 'All') || (status === targetStatus);

    if (matchesQuery && matchesStatus) {
      row.classList.remove('hidden');
      visibleCount++;
    } else {
      row.classList.add('hidden');
    }
  });

  const countEl = document.getElementById('attendance-summary-count');
  if (countEl) countEl.innerText = `${visibleCount} of ${attendanceState.activeStudents.length} Students listed.`;
}

// Calculate Summary Cards
function updateAttendanceSummaryCards() {
  let total = attendanceState.activeStudents.length;
  let present = 0, absent = 0, late = 0, leave = 0, halfday = 0;

  attendanceState.activeStudents.forEach(s => {
    const checked = document.querySelector(`input[name="att-${s.admissionNo}"]:checked`);
    const status = checked ? checked.value : 'Present';

    if (status === 'Present') present++;
    else if (status === 'Absent') absent++;
    else if (status === 'Late') late++;
    else if (status === 'Leave') leave++;
    else if (status === 'Half Day') halfday++;
  });

  document.getElementById('att-card-total').innerText = total;
  document.getElementById('att-card-present').innerText = present;
  document.getElementById('att-card-absent').innerText = absent;
  document.getElementById('att-card-late').innerText = late;
  document.getElementById('att-card-leave').innerText = leave;
  document.getElementById('att-card-halfday').innerText = halfday;
}

// Save Attendance Record
const saveAttBtn = document.getElementById('save-attendance-btn');
if (saveAttBtn) {
  saveAttBtn.addEventListener('click', async () => {
    const date = document.getElementById('att-filter-date').value;
    const className = document.getElementById('att-filter-class').value;
    const section = document.getElementById('att-filter-section').value;
    let selectedSession; try { selectedSession=selectedAttendanceSession('att-filter-session'); } catch(error) { return alert(error.message); }

    if (!date || !attendanceState.activeStudents.length) {
      return alert('⊠️ Please load student roster before saving attendance.');
    }

    if (attendanceState.existingRecord) {
      if (!confirm(`⊠️ Attendance record already exists for Class ${className}-${section} on ${date}.\n\nDo you want to OVERWRITE and update the saved attendance record?`)) {
        return;
      }
    }

    const records = attendanceState.activeStudents.map(s => {
      const checked = document.querySelector(`input[name="att-${s.admissionNo}"]:checked`);
      const status = checked ? checked.value : 'Present';
      const remark = document.getElementById(`att-remark-${s.admissionNo}`)?.value || '';

      return {
        studentId: s.admissionNo,
        admissionNo: s.admissionNo,
        studentName: s.name,
        rollNo: s.rollNo,
        status,
        remark
      };
    });

    const payload = { date, className, section, academic_session_id:selectedSession.id, academic_session:selectedSession.name, records };
    saveAttBtn.disabled = true;
    saveAttBtn.innerText = '💾 Saving Attendance...';

    try {
      const savedAttendance = await ApiService.saveAttendance(payload);
      attendanceState.existingRecord = savedAttendance.attendance?.[0] || attendanceState.existingRecord || { submittedBy: 'Admin', records };
      alert(`✅ Attendance saved successfully for Class ${className}-${section} on ${date}!`);
      
      // Update warning banner to show saved status
      const warningBox = document.getElementById('att-overwrite-warning');
      const warningText = document.getElementById('att-warning-text');
      warningText.innerText = `Attendance record for ${className} - Sec ${section} on ${date} is SAVED. Saving again will update the existing record.`;
      warningBox.classList.remove('hidden');
      await loadDashboard();
      localStorage.setItem('studentAttendanceUpdatedAt', String(Date.now()));

    } catch (err) {
      alert('❌ Failed to save attendance: ' + (err.message || 'Server error'));
    } finally {
      saveAttBtn.disabled = false;
      saveAttBtn.innerText = '💾 Save Attendance Record';
    }
  });
}

// ================= ATTENDANCE HISTORY & MONTHLY SUMMARY =================
async function loadAttendanceHistory() {
  const viewMode = document.getElementById('att-hist-view-mode')?.value || 'datewise';
  const monthStr = document.getElementById('att-hist-month')?.value || new Date().toISOString().slice(0, 7);
  const targetClass = document.getElementById('att-hist-class')?.value || '';
  let historySession; try { historySession=selectedAttendanceSession('att-hist-session'); } catch(error) { return alert(error.message); }
  const targetSection = document.getElementById('att-hist-section')?.value || '';
  const query = (document.getElementById('att-hist-search')?.value || '').toLowerCase().trim();

  const thead = document.getElementById('att-hist-thead');
  const tbody = document.getElementById('att-hist-tbody');

  tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">Loading attendance history...</td></tr>`;

  try {
    const allAttendance = await ApiService.getAttendance('', targetClass, targetSection, historySession.name, historySession.id);
    attendanceState.allAttendance = allAttendance;
    const allStudents = await ApiService.getStudents({ academic_session_id:historySession.id, className:targetClass, section:targetSection });

    // Filter by Month
    let filteredLogs = allAttendance.filter(a => (a.date || '').startsWith(monthStr));
    if (targetClass) filteredLogs = filteredLogs.filter(a => a.className === targetClass);
    if (targetSection) filteredLogs = filteredLogs.filter(a => a.section === targetSection);

    if (viewMode === 'datewise') {
      thead.innerHTML = `
        <tr>
          <th class="px-5 py-4">Date</th>
          <th class="px-5 py-4">Class & Section</th>
          <th class="px-5 py-4 text-emerald-500">Present</th>
          <th class="px-5 py-4 text-rose-500">Absent</th>
          <th class="px-5 py-4 text-amber-500">Late</th>
          <th class="px-5 py-4 text-blue-500">Leave</th>
          <th class="px-5 py-4">Recorded By</th>
          <th class="px-5 py-4 text-right">Actions</th>
        </tr>
      `;

      if (filteredLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No attendance logs recorded for ${monthStr}.</td></tr>`;
        return;
      }

      tbody.innerHTML = filteredLogs.map(log => {
        let present = 0, absent = 0, late = 0, leave = 0;
        if (Array.isArray(log.records)) {
          log.records.forEach(r => {
            if (r.status === 'Present') present++;
            else if (r.status === 'Absent') absent++;
            else if (r.status === 'Late') late++;
            else if (r.status === 'Leave') leave++;
          });
        }

        return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-100 dark:border-slate-800 transition-colors">
            <td class="px-5 py-4 font-mono font-bold text-slate-900 dark:text-white">${log.date}</td>
            <td class="px-5 py-4 font-bold">${log.className} - Section ${log.section}</td>
            <td class="px-5 py-4 font-mono font-bold text-emerald-600">${present}</td>
            <td class="px-5 py-4 font-mono font-bold text-rose-500">${absent}</td>
            <td class="px-5 py-4 font-mono font-bold text-amber-500">${late}</td>
            <td class="px-5 py-4 font-mono font-bold text-blue-500">${leave}</td>
            <td class="px-5 py-4 text-slate-400 text-xs">${log.submittedBy || 'Admin'}</td>
            <td class="px-5 py-4 text-right space-x-2">
              <button onclick="editSavedAttendanceSheet('${log.date}', '${log.className}', '${log.section}', '${log.academic_session_id || historySession.id}')" class="bg-amber-500/10 hover:bg-amber-500 hover:text-slate-950 text-amber-500 font-bold px-3 py-1 rounded-xl text-xs transition-colors">✏️ Edit Sheet</button>
            </td>
          </tr>
        `;
      }).join('');

    } else {
      // Student-wise Monthly Summary (%)
      thead.innerHTML = `
        <tr>
          <th class="px-5 py-4">Roll No</th>
          <th class="px-5 py-4">Admission No</th>
          <th class="px-5 py-4">Student Name</th>
          <th class="px-5 py-4">Class</th>
          <th class="px-5 py-4 text-center">Total Working Days</th>
          <th class="px-5 py-4 text-center text-emerald-500">Present Days</th>
          <th class="px-5 py-4 text-center text-rose-500">Absent Days</th>
          <th class="px-5 py-4 text-center font-bold">Monthly %</th>
        </tr>
      `;

      let targetStudents = allStudents;
      if (targetClass) targetStudents = targetStudents.filter(s => s.className === targetClass);
      if (targetSection) targetStudents = targetStudents.filter(s => s.section === targetSection);
      if (query) targetStudents = targetStudents.filter(s => (s.name || '').toLowerCase().includes(query) || s.admissionNo.toLowerCase().includes(query));

      if (targetStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No students match filter criteria.</td></tr>`;
        return;
      }

      tbody.innerHTML = targetStudents.map(s => {
        let totalDays = 0, presentDays = 0, absentDays = 0, lateDays = 0, leaveDays = 0;

        filteredLogs.forEach(log => {
          if (log.className === s.className && log.section === s.section) {
            const match = (log.records || []).find(r => (r.studentId || r.admissionNo) === s.admissionNo);
            if (match) {
              totalDays++;
              if (match.status === 'Present' || match.status === 'Late' || match.status === 'Half Day') presentDays++;
              if (match.status === 'Absent') absentDays++;
              if (match.status === 'Late') lateDays++;
              if (match.status === 'Leave') leaveDays++;
            }
          }
        });

        const pct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
        let pctColor = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
        if (pct < 75) pctColor = 'text-rose-500 bg-rose-500/10 border-rose-500/30';
        else if (pct < 85) pctColor = 'text-amber-500 bg-amber-500/10 border-amber-500/30';

        return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-100 dark:border-slate-800 transition-colors">
            <td class="px-5 py-4 font-mono font-bold text-slate-900 dark:text-white">${s.rollNo || '-'}</td>
            <td class="px-5 py-4 font-mono text-amber-500 font-bold">${s.admissionNo}</td>
            <td class="px-5 py-4 font-bold text-slate-900 dark:text-white">${s.name}</td>
            <td class="px-5 py-4">${s.className} - ${s.section}</td>
            <td class="px-5 py-4 text-center font-mono font-bold">${totalDays}</td>
            <td class="px-5 py-4 text-center font-mono font-bold text-emerald-600">${presentDays}</td>
            <td class="px-5 py-4 text-center font-mono font-bold text-rose-500">${absentDays}</td>
            <td class="px-5 py-4 text-center">
              <span class="px-3 py-1 rounded-xl text-xs font-black border ${pctColor}">${pct}%</span>
            </td>
          </tr>
        `;
      }).join('');
    }

    } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-rose-500">Unable to load attendance history: ${subjectHtmlEscape(err.message || 'Unknown server error')}</td></tr>`;
  }
}

// Edit saved attendance sheet from history
window.editSavedAttendanceSheet = function(date, className, section, academicSessionId) {
  document.getElementById('att-subtab-btn-mark')?.click();
  document.getElementById('att-filter-date').value = date;
  document.getElementById('att-filter-class').value = className;
  document.getElementById('att-filter-section').value = section;
  if (academicSessionId) document.getElementById('att-filter-session').value = academicSessionId;
  document.getElementById('load-att-list-btn')?.click();
};

// Export CSV for Attendance History
function exportAttendanceCSV() {
  const monthStr = document.getElementById('att-hist-month')?.value || new Date().toISOString().slice(0, 7);
  const viewMode = document.getElementById('att-hist-view-mode')?.value || 'datewise';

  if (!attendanceState.allAttendance || !attendanceState.allAttendance.length) {
    return alert('No attendance records available to export.');
  }

  let csv = '';
  if (viewMode === 'datewise') {
    csv = 'Date,Class,Section,Total Records,Submitted By,Timestamp\n';
    attendanceState.allAttendance.forEach(a => {
      csv += `"${a.date}","${a.className}","${a.section}","${a.records ? a.records.length : 0}","${a.submittedBy || 'Admin'}","${a.timestamp || ''}"\n`;
    });
  } else {
    csv = 'Date,Class,Section,Admission No,Student Name,Status,Remark\n';
    attendanceState.allAttendance.forEach(a => {
      (a.records || []).forEach(r => {
        csv += `"${a.date}","${a.className}","${a.section}","${r.studentId || r.admissionNo}","${(r.studentName || '').replace(/"/g, '""')}","${r.status}","${(r.remark || '').replace(/"/g, '""')}"\n`;
      });
    });
  }

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Attendance_Report_${monthStr}.csv`;
  link.click();
}

// Export PDF for Attendance History
function exportAttendancePDF() {
  const table = document.querySelector('#att-subtab-history table');
  if (!table) return alert('No attendance data table available.');

  const monthStr = document.getElementById('att-hist-month')?.value || new Date().toISOString().slice(0, 7);
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
    <head>
      <title>Attendance Report - ${monthStr}</title>
      <style>
        body { font-family: sans-serif; padding: 20px; font-size: 11px; }
        h2 { margin: 0 0 5px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
        th { background: #0f172a; color: #fff; }
      </style>
    </head>
    <body onload="window.print()">
      <h2>GARUMARA JATIYA VIDYALAYA - ATTENDANCE REPORT</h2>
      <p>Report Month: <strong>${monthStr}</strong> | Generated Date: ${new Date().toLocaleDateString('en-IN')}</p>
      ${table.outerHTML}
    </body>
    </html>
  `);
  win.document.close();
}

// Print Attendance Report
function printAttendanceReport() {
  exportAttendancePDF();
}


// ================= 5. SCHOOL FEE MANAGEMENT SYSTEM =================

function getSelectedFeeAcademicSession(required = true) {
  const select = document.getElementById('fee-session');
  const value = String(select?.value || '').trim();
  const record = academicSessionsCache.find(row => String(row.id) === value || row.session_name === value);
  if (!record && required) throw new Error('Academic Session is required.');
  return record ? { id: String(record.id), name: record.session_name } : { id: '', name: '' };
}
function clearFeeStudentContext() {
  state.selectedStudentForFee = null; state.selectedFeeProfile = null; state.selectedAnnualFeeProfile = null; state.selectedLegacyDueId = null;
  const results=document.getElementById('fee-search-results'); if(results){results.innerHTML='';results.classList.add('hidden');}
  const search=document.getElementById('fee-student-search'); if(search)search.value='';
  const studentId=document.getElementById('fee-student-id'); if(studentId)studentId.value='';
  const display=document.getElementById('fee-display-name'); if(display)display.value='';
  const profile=document.getElementById('fee-student-profile'); if(profile)profile.classList.add('hidden');
  const history=document.getElementById('fee-history-tbody'); if(history)history.innerHTML='<tr><td colspan="8" class="text-center py-8 text-slate-400">Select a student to view this session ledger.</td></tr>';
  const annual=document.getElementById('student-fee-profile-status'); if(annual){annual.classList.remove('hidden');annual.textContent='Select a student from the selected Academic Session.';}
  const form=document.getElementById('collect-fee-form'); if(form)form.reset();
}

async function loadFeesTab() {
  await loadFeeTab();
}

async function loadFeeTab() {
  await loadAcademicSessions();
  const monthInput = document.getElementById('fee-month');
  const paymentDateInput = document.getElementById('fee-payment-date');
  if (paymentDateInput && !paymentDateInput.value) {
    const now = new Date();
    paymentDateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  if (monthInput && !monthInput.value) {
    monthInput.value = new Date().toISOString().substring(0, 7);
  }

  // Bind subtabs
  bindFeeSubtabs();

  // Load dashboard metrics
  await loadFeeDashboardMetrics();

  // Autocomplete student search
  const searchInput = document.getElementById('fee-student-search');
  const resultsDiv = document.getElementById('fee-search-results');
  const searchClass = document.getElementById('fee-search-class');
  const searchSection = document.getElementById('fee-search-section');

  if (searchInput && resultsDiv) {
    searchInput.value = '';
    resultsDiv.classList.add('hidden');

    const runStudentSearch = () => {
      const val = searchInput.value.trim().toLowerCase();
      if (!val) {
        resultsDiv.classList.add('hidden');
        return;
      }

      let selectedSession;
      try { selectedSession = getSelectedFeeAcademicSession(true); }
      catch (err) { resultsDiv.innerHTML = '<div class="p-3 text-rose-500 text-center">' + subjectHtmlEscape(err.message) + '</div>'; resultsDiv.classList.remove('hidden'); return; }
      ApiService.searchFeeStudents({ q: val, academic_session_id: selectedSession.id, className: searchClass?.value || '', section: searchSection?.value || '' }).then(matches => {
        if (!matches.length) resultsDiv.innerHTML = '<div class="p-3 text-slate-400 text-center">No matching students found in ' + subjectHtmlEscape(selectedSession.name) + '.</div>';
        else resultsDiv.innerHTML = matches.map(student => `<div onclick="selectStudentForFee('${student.admissionNo || student.admission_number || student.studentId || student.student_id || student.id}')" class="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-semibold border-b border-slate-100 dark:border-slate-850 truncate">${student.name || student.studentName || 'Unnamed Student'} (${student.admissionNo || student.admission_number || student.studentId || student.student_id || student.id}) - ${student.className || student.class_name || 'N/A'}-${String(student.section || student.section_name || 'N/A').replace(/^Section\s+/i, '')} | Mobile: ${student.mobile || 'N/A'}</div>`).join('');
        resultsDiv.classList.remove('hidden');
      }).catch(err => { resultsDiv.innerHTML = '<div class="p-3 text-rose-500 text-center">' + subjectHtmlEscape(err.message || 'Student search failed.') + '</div>'; resultsDiv.classList.remove('hidden'); });
    };
    searchInput.oninput = runStudentSearch;
    if (searchClass) searchClass.onchange = runStudentSearch;
    if (searchSection) searchSection.onchange = runStudentSearch;

    if (!resultsDiv.dataset.outsideClickBound) {
      resultsDiv.dataset.outsideClickBound = 'true';
      document.addEventListener('click', e => {
        if (e.target !== searchInput && !resultsDiv.contains(e.target)) resultsDiv.classList.add('hidden');
      });
    }
  }
}

let legacyDueRows = [];
function legacyMoney(value) { return '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function showLegacyMessage(id, text, error = false) { const box = document.getElementById(id); if (!box) return; box.textContent = text; box.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'bg-rose-50', 'text-rose-700'); box.classList.add(error ? 'bg-rose-50' : 'bg-emerald-50', error ? 'text-rose-700' : 'text-emerald-700'); }
async function loadLegacyDueManagement() {
  const tbody = document.getElementById('legacy-dues-tbody'); if (!tbody) return; tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400">Loading legacy dues...</td></tr>';
  try {
    const select = document.getElementById('legacy-student'); if (select && !select.dataset.loaded) { const students = await ApiService.getStudents(); select.innerHTML = '<option value="">Select student</option>' + students.filter(student => student.status !== 'Inactive').map(student => '<option value="' + subjectHtmlEscape(student.admissionNo || student.studentId || student.id) + '">' + subjectHtmlEscape(student.name) + ' ? ' + subjectHtmlEscape(student.admissionNo || student.studentId || student.id) + ' (' + subjectHtmlEscape(student.className || '') + '-' + subjectHtmlEscape(student.section || '') + ')</option>').join(''); select.dataset.loaded = 'true'; }
    const filters = { session: document.getElementById('legacy-filter-session')?.value || getCurrentAcademicSession(), month: document.getElementById('legacy-filter-month')?.value || '', status: document.getElementById('legacy-filter-status')?.value || '' }; legacyDueRows = await ApiService.getLegacyFeeDues(filters); renderLegacyDueRows();
  } catch (error) { console.error('Legacy due load failed:', error); tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-rose-500">' + subjectHtmlEscape(error.message) + '</td></tr>'; }
}
function renderLegacyDueRows() {
  const tbody = document.getElementById('legacy-dues-tbody'); if (!tbody) return; if (!legacyDueRows.length) { tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400">No legacy fee dues found.</td></tr>'; return; }
  tbody.innerHTML = legacyDueRows.map((due, index) => '<tr class="border-b border-slate-100 dark:border-slate-800"><td class="p-3"><b>' + subjectHtmlEscape(due.studentName) + '</b><br><span class="font-mono text-[10px]">' + subjectHtmlEscape(due.student_id) + '</span></td><td class="p-3">' + subjectHtmlEscape(due.academic_session) + '</td><td class="p-3">' + subjectHtmlEscape(due.due_month) + '</td><td class="p-3">' + subjectHtmlEscape(due.fee_category) + '</td><td class="p-3 text-right">' + legacyMoney(due.fee_amount) + '</td><td class="p-3 text-right text-emerald-600">' + legacyMoney(due.paid_amount) + '</td><td class="p-3 text-right text-amber-600">' + legacyMoney(due.pending_amount) + '</td><td class="p-3 text-right">' + legacyMoney(due.late_fine) + '</td><td class="p-3 text-right text-rose-600">' + legacyMoney(due.total_overdue) + '</td><td class="p-3 font-bold">' + subjectHtmlEscape(due.payment_status) + '</td><td class="p-3 text-right"><div class="flex justify-end gap-1">' + (due.total_outstanding > 0 ? '<button data-legacy-action="collect" data-index="' + index + '" class="bg-amber-500 px-2 py-1 rounded font-bold">Collect</button>' : '') + '<button data-legacy-action="edit" data-index="' + index + '" class="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded font-bold">Edit</button><button data-legacy-action="delete" data-index="' + index + '" class="bg-rose-100 text-rose-700 px-2 py-1 rounded font-bold">Delete</button></div></td></tr>').join('');
  tbody.querySelectorAll('[data-legacy-action]').forEach(button => button.onclick = async () => { const due = legacyDueRows[Number(button.dataset.index)]; if (!due) return; if (button.dataset.legacyAction === 'collect') return collectLegacyDue(due); if (button.dataset.legacyAction === 'edit') return editLegacyDue(due); if (button.dataset.legacyAction === 'delete') { if (!confirm('Delete this unpaid legacy opening balance?')) return; try { await ApiService.deleteLegacyFeeDue(due.id); await refreshAllLegacyFeeViews(); } catch (error) { alert(error.message); } } });
}
async function collectLegacyDue(due) { await window.selectStudentForFee(due.student_id); state.selectedLegacyDueId = due.id; document.getElementById('fee-session').value = due.academic_session; document.getElementById('fee-month').value = due.due_month; document.getElementById('fee-type').value = due.fee_category; document.getElementById('fee-amount').value = due.pending_amount; document.getElementById('fee-late-fine').value = due.outstanding_fine || 0; document.getElementById('fee-remarks').value = 'Payment against legacy opening balance ' + due.id; document.getElementById('fee-subtab-btn-collect')?.click(); }
function editLegacyDue(due) { document.getElementById('legacy-due-id').value = due.id; document.getElementById('legacy-student').value = due.student_id; document.getElementById('legacy-session').value = due.academic_session; document.getElementById('legacy-month').value = due.due_month; document.getElementById('legacy-category').value = due.fee_category; document.getElementById('legacy-amount').value = due.fee_amount; document.getElementById('legacy-fine').value = due.late_fine; document.getElementById('legacy-discount').value = due.discount_amount; document.getElementById('legacy-paid').value = due.opening_paid_amount || 0; document.getElementById('legacy-remarks').value = due.remarks || ''; document.getElementById('legacy-save-btn').textContent = 'Update Legacy Due'; }
function resetLegacyDueForm() { document.getElementById('legacy-due-form')?.reset(); document.getElementById('legacy-due-id').value = ''; document.getElementById('legacy-fine').value = '0'; document.getElementById('legacy-discount').value = '0'; document.getElementById('legacy-paid').value = '0'; document.getElementById('legacy-save-btn').textContent = 'Save Legacy Due'; }
async function refreshAllLegacyFeeViews() { await Promise.allSettled([loadLegacyDueManagement(), loadFeeDashboardMetrics(), loadStudentWiseDueList(), loadFeeDueList(), typeof loadDashboard === 'function' ? loadDashboard() : Promise.resolve()]); if (state.selectedStudentForFee) await Promise.allSettled([loadStudentLedger(state.selectedStudentForFee.admissionNo), loadSelectedStudentFeeProfile()]); }
function legacyExportRows() { return legacyDueRows.map(due => ({ 'Admission No': due.student_id, 'Student Name': due.studentName, 'Class': due.className, 'Section': due.section, 'Academic Session': due.academic_session, 'Due Month': due.due_month, 'Fee Category': due.fee_category, 'Fee Amount': due.fee_amount, 'Paid Amount': due.paid_amount, 'Pending Amount': due.pending_amount, 'Late Fine': due.late_fine, 'Total Overdue': due.total_overdue, 'Status': due.payment_status, 'Remarks': due.remarks || '' })); }
function downloadLegacyExcelTemplate() { if (!window.XLSX) return alert('Excel library is unavailable. Check the network connection and reload.'); const rows = [{ AdmissionNo: '', AcademicSession: getCurrentAcademicSession(), DueMonth: '2025-03', FeeCategory: 'Monthly Tuition Fee', FeeAmount: 0, LateFine: 0, Discount: 0, PaidAmount: 0, Remarks: '' }], book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Legacy Dues'); XLSX.writeFile(book, 'Legacy_Fee_Due_Import_Template.xlsx'); }
async function importLegacyExcel() { const input = document.getElementById('legacy-import-file'), button = document.getElementById('legacy-import-btn'); if (!input?.files?.[0]) return alert('Select an Excel or CSV file.'); if (!window.XLSX) return alert('Excel library is unavailable.'); button.disabled = true; button.textContent = 'Validating...'; try { const data = await input.files[0].arrayBuffer(), book = XLSX.read(data), raw = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' }); const records = raw.map(row => ({ admissionNo: row.AdmissionNo || row['Admission No'], academicSession: row.AcademicSession || row['Academic Session'], dueMonth: row.DueMonth || row['Due Month'], feeCategory: row.FeeCategory || row['Fee Category'], feeAmount: row.FeeAmount || row['Fee Amount'], lateFine: row.LateFine || row['Late Fine'] || 0, discount: row.Discount || 0, paidAmount: row.PaidAmount || row['Paid Amount'] || 0, remarks: row.Remarks || '' })); const result = await ApiService.importLegacyFeeDues(records, 'legacy-' + Date.now()); const details = [...result.skipped, ...result.errors].map(item => 'Row ' + item.row + ' (' + (item.admissionNo || 'no admission number') + '): ' + item.errors.join(' ')).join('\n'); showLegacyMessage('legacy-import-summary', 'Rows: ' + result.totalRows + '\nImported: ' + result.importedCount + '\nDuplicates skipped: ' + result.skippedCount + '\nInvalid: ' + result.errorCount + (details ? '\n\nDetails:\n' + details : ''), result.errorCount > 0); await refreshAllLegacyFeeViews(); } catch (error) { console.error('Legacy Excel import failed:', error); showLegacyMessage('legacy-import-summary', error.message, true); } finally { button.disabled = false; button.textContent = 'Validate & Import'; } }

document.getElementById('legacy-due-form')?.addEventListener('submit', async event => { event.preventDefault(); const button = document.getElementById('legacy-save-btn'), id = document.getElementById('legacy-due-id').value; const data = { id, studentId: document.getElementById('legacy-student').value, academicSession: document.getElementById('legacy-session').value, dueMonth: document.getElementById('legacy-month').value, feeCategory: document.getElementById('legacy-category').value, feeAmount: Number(document.getElementById('legacy-amount').value), lateFine: Number(document.getElementById('legacy-fine').value || 0), discount: Number(document.getElementById('legacy-discount').value || 0), paidAmount: Number(document.getElementById('legacy-paid').value || 0), remarks: document.getElementById('legacy-remarks').value }; button.disabled = true; try { if (id) await ApiService.updateLegacyFeeDue(data); else await ApiService.createLegacyFeeDue(data); showLegacyMessage('legacy-form-message', id ? 'Legacy due updated successfully.' : 'Legacy due saved successfully.'); resetLegacyDueForm(); await refreshAllLegacyFeeViews(); } catch (error) { showLegacyMessage('legacy-form-message', error.message, true); } finally { button.disabled = false; } });
document.getElementById('legacy-reset-btn')?.addEventListener('click', resetLegacyDueForm); document.getElementById('legacy-filter-btn')?.addEventListener('click', loadLegacyDueManagement); document.getElementById('legacy-template-btn')?.addEventListener('click', downloadLegacyExcelTemplate); document.getElementById('legacy-import-btn')?.addEventListener('click', importLegacyExcel);
document.getElementById('legacy-export-excel-btn')?.addEventListener('click', () => { if (!legacyDueRows.length) return alert('No legacy due records to export.'); if (!window.XLSX) return alert('Excel library is unavailable.'); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(legacyExportRows()), 'Legacy Due Report'); XLSX.writeFile(book, 'Legacy_Due_Report_' + new Date().toISOString().slice(0,10) + '.xlsx'); });
document.getElementById('legacy-export-pdf-btn')?.addEventListener('click', async () => { if (!legacyDueRows.length) return alert('No legacy due records to export.'); if (typeof html2pdf !== 'function') return alert('PDF library is unavailable.'); const box = document.createElement('div'); box.style.cssText = 'background:white;color:#0f172a;padding:12mm;width:210mm;font-family:sans-serif'; box.innerHTML = '<h2>Legacy Fee Due Report</h2><p>Generated ' + new Date().toLocaleDateString('en-IN') + '</p><table style="width:100%;border-collapse:collapse;font-size:9px"><thead><tr><th>Student</th><th>Class</th><th>Session</th><th>Month</th><th>Category</th><th>Pending</th><th>Fine</th><th>Status</th></tr></thead><tbody>' + legacyDueRows.map(due => '<tr><td>' + subjectHtmlEscape(due.studentName + ' (' + due.student_id + ')') + '</td><td>' + subjectHtmlEscape(due.className + '-' + due.section) + '</td><td>' + subjectHtmlEscape(due.academic_session) + '</td><td>' + subjectHtmlEscape(due.due_month) + '</td><td>' + subjectHtmlEscape(due.fee_category) + '</td><td>' + legacyMoney(due.pending_amount) + '</td><td>' + legacyMoney(due.late_fine) + '</td><td>' + subjectHtmlEscape(due.payment_status) + '</td></tr>').join('') + '</tbody></table>'; await html2pdf().set({ filename: 'Legacy_Due_Report_' + new Date().toISOString().slice(0,10) + '.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } }).from(box).save(); });

function bindFeeSubtabs() {
  const buttons = [
    { btnId: 'fee-subtab-btn-collect', contentId: 'fee-subtab-collect', action: null },
    { btnId: 'fee-subtab-btn-profile', contentId: 'fee-subtab-profile', action: loadSelectedStudentFeeProfile },
    { btnId: 'fee-subtab-btn-dues', contentId: 'fee-subtab-dues', action: loadFeeDueList },
    { btnId: 'fee-subtab-btn-student-dues', contentId: 'fee-subtab-student-dues', action: loadStudentWiseDueList },
    { btnId: 'fee-subtab-btn-legacy', contentId: 'fee-subtab-legacy', action: loadLegacyDueManagement },
    { btnId: 'fee-subtab-btn-structure', contentId: 'fee-subtab-structure', action: loadFeeStructureConfigurator },
    { btnId: 'fee-subtab-btn-reports', contentId: 'fee-subtab-reports', action: loadFeeReportsAndAudit }
  ];

  buttons.forEach(t => {
    const btn = document.getElementById(t.btnId);
    if (!btn) return;
    btn.onclick = () => {
      buttons.forEach(other => {
        const b = document.getElementById(other.btnId);
        const c = document.getElementById(other.contentId);
        if (b) {
          b.classList.remove('border-amber-500', 'text-slate-900', 'dark:text-white', 'font-extrabold');
          b.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        }
        if (c) c.classList.add('hidden');
      });

      btn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
      btn.classList.add('border-amber-500', 'text-slate-900', 'dark:text-white', 'font-extrabold');
      const activeContent = document.getElementById(t.contentId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (t.action) t.action();
    };
  });
}

function feeProfileCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function feeProfileText(value, fallback = 'N/A') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function feeProfileImageUrl(source) {
  const value = String(source || '').trim();
  if (!value || /^[a-z]:\\/i.test(value)) return '';
  try { return new URL(value, window.location.origin).href; } catch (_) { return ''; }
}

async function loadSelectedStudentFeeProfile() {
  const status = document.getElementById('student-fee-profile-status');
  const content = document.getElementById('student-fee-profile-content');
  const student = state.selectedStudentForFee;
  if (!status || !content) return;
  if (!student) {
    content.classList.add('hidden');
    status.classList.remove('hidden');
    status.textContent = 'Select a student from Record Payment or Student-wise Due List to open the annual fee profile.';
    return;
  }
  status.classList.remove('hidden');
  content.classList.add('hidden');
  status.textContent = 'Loading the student fee profile...';
  try {
    const selectedSession = getSelectedFeeAcademicSession(true);
    const profile = await ApiService.getStudentAnnualFeeProfile(student.admissionNo || student.studentId || student.id, selectedSession.name, selectedSession.id);
    state.selectedAnnualFeeProfile = profile;
    renderStudentFeeProfile(profile);
    status.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (error) {
    console.error('Student fee profile failed to load:', error);
    content.classList.add('hidden');
    status.classList.remove('hidden');
    status.textContent = `Unable to load fee profile: ${error.message}`;
  }
}

function renderStudentFeeProfile(profile) {
  const student = profile.student || {};
  const summary = profile.summary || {};
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  setText('sfp-name', feeProfileText(student.name, 'Unnamed Student'));
  setText('sfp-admission', feeProfileText(student.admissionNo));
  setText('sfp-student-id', feeProfileText(student.studentId));
  setText('sfp-class-section', `${feeProfileText(student.className)} - ${feeProfileText(student.section)}`);
  setText('sfp-session', feeProfileText(student.academicSession));
  setText('sfp-parent', feeProfileText(student.parentName));
  setText('sfp-mobile', feeProfileText(student.mobile));
  setText('sfp-total-annual', feeProfileCurrency(summary.totalAnnualFee));
  setText('sfp-total-paid', feeProfileCurrency(summary.totalPaid));
  setText('sfp-total-pending', feeProfileCurrency(summary.totalPending));
  setText('sfp-total-overdue', feeProfileCurrency(summary.totalOverdue));
  setText('sfp-late-fine', feeProfileCurrency(summary.lateFine));
  setText('sfp-discount', feeProfileCurrency(summary.discount));
  setText('sfp-pending-months', String(summary.pendingMonths || 0));
  setText('sfp-last-payment', summary.lastPaymentDate ? new Date(`${summary.lastPaymentDate}T00:00:00`).toLocaleDateString('en-IN') : 'No payment yet');

  const photo = document.getElementById('sfp-photo');
  const emptyPhoto = document.getElementById('sfp-photo-empty');
  const photoUrl = feeProfileImageUrl(student.photo);
  if (photo && emptyPhoto) {
    photo.onload = () => { photo.classList.remove('hidden'); emptyPhoto.classList.add('hidden'); };
    photo.onerror = () => { photo.removeAttribute('src'); photo.classList.add('hidden'); emptyPhoto.classList.remove('hidden'); };
    if (photoUrl) photo.src = photoUrl;
    else photo.onerror();
  }

  const collectButton = document.getElementById('sfp-collect-btn');
  if (collectButton) collectButton.onclick = () => {
    const firstDue = (profile.timeline || []).find(item => item.pendingAmount > 0);
    collectFeeForStudent(student.admissionNo, firstDue?.month || '', firstDue?.pendingAmount || 0, 'Monthly Tuition Fee');
  };
  const ledgerButton = document.getElementById('sfp-ledger-btn');
  if (ledgerButton) ledgerButton.onclick = () => viewLedgerForStudent(student.admissionNo);

  const tbody = document.getElementById('sfp-timeline-tbody');
  if (!tbody) return;
  const badgeClasses = {
    Paid: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800',
    Partial: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    Overdue: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800',
    Unpaid: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    'Not Due': 'bg-white text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700'
  };
  tbody.innerHTML = (profile.timeline || []).map((item, index) => `
    <tr class="border-b border-slate-100 dark:border-slate-800/70">
      <td class="p-3 font-extrabold text-slate-900 dark:text-white">${feeProfileText(item.monthName)}</td>
      <td class="p-3"><span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-black"><span class="w-2 h-2 rounded-full ${item.status === 'Paid' ? 'bg-emerald-500' : item.status === 'Partial' ? 'bg-amber-500' : item.status === 'Overdue' ? 'bg-rose-500' : 'bg-slate-300'}"></span><span class="px-1.5 py-0.5 rounded border ${badgeClasses[item.status] || badgeClasses.Unpaid}">${feeProfileText(item.status)}</span></span></td>
      <td class="p-3 text-center font-mono">${feeProfileText(item.dueDate, '—')}</td>
      <td class="p-3 text-right font-mono">${feeProfileCurrency(item.feeAmount)}</td>
      <td class="p-3 text-right font-mono text-emerald-600 font-bold">${feeProfileCurrency(item.paidAmount)}</td>
      <td class="p-3 text-right font-mono text-amber-600 font-bold">${feeProfileCurrency(item.pendingAmount)}</td>
      <td class="p-3 text-right font-mono">${feeProfileCurrency(item.lateFine)}</td>
      <td class="p-3 text-center font-mono">${feeProfileText(item.paymentDate, '—')}</td>
      <td class="p-3 text-center font-mono">${feeProfileText(item.receiptNo, '—')}</td>
      <td class="p-3 text-center">${feeProfileText(item.paymentMode, '—')}</td>
      <td class="p-3 text-right no-print"><div class="flex justify-end gap-1">${item.pendingAmount > 0 ? `<button data-sfp-action="collect" data-index="${index}" class="px-2 py-1 rounded-lg bg-amber-500 text-slate-900 font-bold">Collect</button>` : ''}${item.receiptNo ? `<button data-sfp-action="view" data-index="${index}" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold">View</button><button data-sfp-action="print" data-index="${index}" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold">Print</button><button data-sfp-action="pdf" data-index="${index}" class="px-2 py-1 rounded-lg bg-blue-600 text-white font-bold">PDF</button>` : ''}</div></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-sfp-action]').forEach(button => button.addEventListener('click', (evt) => {
    const item = profile.timeline[Number(button.dataset.index)];
    if (!item) return;
    if (button.dataset.sfpAction === 'collect') collectFeeForStudent(student.admissionNo, item.month, item.pendingAmount, 'Monthly Tuition Fee');
    if (button.dataset.sfpAction === 'view') viewFeeReceipt(item.receiptNo);
    if (button.dataset.sfpAction === 'print') printFeeReceipt(item.receiptNo);
    if (button.dataset.sfpAction === 'pdf') downloadFeeReceiptPDF(item.receiptNo, evt);
  }));
}

window.viewStudentFeeProfile = async function(admissionNo) {
  await window.selectStudentForFee(admissionNo);
  document.getElementById('fee-subtab-btn-profile')?.click();
};

window.viewFeeReceipt = async function(receiptNo) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/70 p-4 overflow-auto no-print flex items-center justify-center';
  modal.innerHTML = `
    <div class="max-w-4xl w-full mx-auto bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
        <h3 class="font-bold text-slate-900 dark:text-white text-base">Fee Receipt Preview (${receiptNo})</h3>
        <div class="flex items-center gap-2">
          <button class="bg-amber-500 hover:bg-amber-400 text-slate-900 px-3.5 py-2 rounded-xl text-xs font-bold shadow" onclick="printFeeReceipt('${receiptNo}')">⎙ Print</button>
          <button class="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow" onclick="downloadFeeReceiptPDF('${receiptNo}', event)">📄 Download PDF</button>
          <button class="border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-3.5 py-2 rounded-xl text-xs font-bold" onclick="this.closest('.fixed').remove()">Close</button>
        </div>
      </div>
      <div data-receipt-preview class="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl overflow-x-auto flex justify-center min-h-32 text-slate-500">Loading receipt...</div>
    </div>
  `;
  document.body.appendChild(modal);
  try { const preview = modal.querySelector('[data-receipt-preview]'); preview.dataset.receiptNo = receiptNo; preview.innerHTML = await buildA4FeeReceiptHTML(receiptNo); }
  catch (error) { console.error('Receipt preview failed:', error); modal.querySelector('[data-receipt-preview]').textContent = `Unable to load receipt: ${error.message}`; }
};
async function loadFeeDashboardMetrics() {
  try {
    const selectedSession = getSelectedFeeAcademicSession(true);
    const stats = await ApiService.getFeeDashboardStats(selectedSession.name, selectedSession.id);
    document.getElementById('fee-dash-total-collected').innerText = `₹${(stats.totalCollected || 0).toLocaleString('en-IN')}`;
    document.getElementById('fee-dash-today-collected').innerText = `₹${(stats.todayCollection || 0).toLocaleString('en-IN')}`;
    document.getElementById('fee-dash-monthly-collected').innerText = `₹${(stats.monthlyCollection || 0).toLocaleString('en-IN')}`;
    document.getElementById('fee-dash-total-due').innerText = `₹${(stats.totalDue || 0).toLocaleString('en-IN')}`;
    const overdue = document.getElementById('fee-dash-total-overdue');
    if (overdue) overdue.innerText = `₹${(stats.totalOverdue || 0).toLocaleString('en-IN')}`;
    document.getElementById('fee-dash-pending-count').innerText = `${stats.pendingCount || 0} Students`;
  } catch (err) {
    console.error('Failed to load fee dashboard stats:', err);
    ['fee-dash-total-collected', 'fee-dash-today-collected', 'fee-dash-monthly-collected', 'fee-dash-total-due', 'fee-dash-total-overdue', 'fee-dash-pending-count'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = 'Error';
        element.title = err.message || 'Fee dashboard statistics failed to load.';
      }
    });
  }
}

async function refreshSelectedStudentFeeProfile() {
  const student = state.selectedStudentForFee;
  if (!student) return null;
  const selectedSession = getSelectedFeeAcademicSession(true);
  const session = selectedSession.name;
  const month = document.getElementById('fee-month')?.value || new Date().toISOString().slice(0, 7);
  const type = document.getElementById('fee-type')?.value || 'Monthly Tuition Fee';
  const discountAmount = Number(document.getElementById('fee-discount')?.value || 0);
  const scholarshipAmount = Number(document.getElementById('fee-scholarship')?.value || 0);
  const currentAmount = Number(document.getElementById('fee-amount')?.value || 0);
  const profile = await ApiService.getStudentFeeProfile(student.admissionNo || student.studentId || student.id, {
    session,
    academic_session_id: selectedSession.id,
    month,
    type,
    discountAmount,
    scholarshipAmount,
    ...(type === 'Other Custom Fee' && currentAmount > 0 ? { expectedAmount: currentAmount } : {})
  });
  state.selectedFeeProfile = profile;
  const box = document.getElementById('fee-student-profile');
  if (box) box.classList.remove('hidden');
  document.getElementById('fee-profile-class').innerText = `${profile.student.class_id} - ${profile.student.section_id} | Session ${profile.session}`;
  document.getElementById('fee-profile-expected').innerText = `₹${Number(profile.invoice.expectedAmount || 0).toLocaleString('en-IN')}`;
  document.getElementById('fee-profile-paid').innerText = `₹${Number(profile.invoice.paidAmount || 0).toLocaleString('en-IN')}`;
  document.getElementById('fee-profile-balance').innerText = `₹${Number(profile.invoice.remainingBalance || 0).toLocaleString('en-IN')}`;
  document.getElementById('fee-profile-status').innerText = profile.invoice.paymentStatus;
  document.getElementById('fee-profile-previous-dues').innerText = `₹${Number(profile.previousDues || 0).toLocaleString('en-IN')}`;
  const advanceElement = document.getElementById('fee-profile-advance');
  if (advanceElement) advanceElement.innerText = `₹${Number(profile.advanceCredit || 0).toLocaleString('en-IN')}`;  const amountInput = document.getElementById('fee-amount');
  if (amountInput && type !== 'Other Custom Fee') amountInput.value = profile.invoice.remainingBalance || '';
  const fineInput = document.getElementById('fee-late-fine');
  if (fineInput && !Number(fineInput.value)) fineInput.value = profile.suggestedFine || 0;
  const payFullBtn = document.getElementById('fee-pay-full-btn');
  if (payFullBtn) payFullBtn.disabled = profile.invoice.remainingBalance <= 0;
  const collectBtn = document.getElementById('collect-fee-submit-btn');
  if (collectBtn) collectBtn.disabled = profile.invoice.remainingBalance <= 0 && type !== 'Other Custom Fee';
  return profile;
}

window.selectStudentForFee = async function(admNo) {
  try {
    const selectedSession = getSelectedFeeAcademicSession(true);
    const students = await ApiService.searchFeeStudents({ q: admNo, academic_session_id: selectedSession.id });
    const s = students.find(item =>
      [item.admissionNo, item.studentId, item.student_id, item.id].some(value =>
        String(value || '').toLowerCase() === String(admNo || '').toLowerCase()
      )
    );
    if (!s) throw new Error('Selected student was not found.');

    state.selectedStudentForFee = s;
    document.getElementById('fee-display-name').value = `${s.name} (${s.admissionNo}) - ${s.className}-${s.section}`;
    document.getElementById('fee-student-id').value = s.admissionNo || s.studentId || s.id;
    
    const searchInput = document.getElementById('fee-student-search');
    if (searchInput) searchInput.value = '';

    await refreshSelectedStudentFeeProfile();
    await loadStudentLedger(s.admissionNo || s.studentId || s.id);
  } catch (err) {
    alert(`Unable to load student fee profile: ${err.message}`);
  }
};

['fee-month', 'fee-type', 'fee-discount', 'fee-scholarship'].forEach(id => {
  const element = document.getElementById(id);
  if (element) element.onchange = () => {
    if (state.selectedStudentForFee) {
      refreshSelectedStudentFeeProfile().catch(err => alert(`Unable to refresh fee details: ${err.message}`));
    }
  };
});


const feeSessionSelector = document.getElementById('fee-session');
if (feeSessionSelector) feeSessionSelector.onchange = async () => {
  clearFeeStudentContext(); swdState.allDues = []; swdState.selectedIds.clear(); state.currentFeeDueList = [];
  await Promise.allSettled([loadFeeDashboardMetrics(), loadFeeDueList(), loadStudentWiseDueList(), loadFeeReportsAndAudit()]);
};

const payFullFeeBtn = document.getElementById('fee-pay-full-btn');
if (payFullFeeBtn) {
  payFullFeeBtn.onclick = () => {
    const balance = Number(state.selectedFeeProfile?.invoice?.remainingBalance || 0);
    document.getElementById('fee-amount').value = balance > 0 ? balance : '';
  };
}

async function loadStudentLedger(studentId) {
  const tbody = document.getElementById('fee-history-tbody');
  if (!tbody) return;
  const statementBtn = document.getElementById('fee-history-print-statement-btn');
  if (statementBtn) statementBtn.classList.add('hidden');
  tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-400">Loading ledger history...</td></tr>`;

  try {
    const selectedSession = getSelectedFeeAcademicSession(true);
    const fees = await ApiService.getFees(studentId, selectedSession.name, selectedSession.id);
    
    if (state.selectedStudentForFee) {
      document.getElementById('fee-history-header').innerText = `Ledger History - ${state.selectedStudentForFee.name} (${studentId})`;
    }

    if (fees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No fee records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = fees.map(f => `
      <tr class="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
        <td class="px-4 py-3 font-mono font-bold text-slate-950 dark:text-white">${f.receiptNo}</td>
        <td class="px-4 py-3 text-slate-400">${new Date(f.date).toLocaleDateString('en-IN')}</td>
        <td class="px-4 py-3 font-bold text-slate-950 dark:text-white">${f.type}</td>
        <td class="px-4 py-3 font-mono">${f.month}</td>
        <td class="px-4 py-3">${f.paymentMode}</td>
        <td class="px-4 py-3 font-mono font-bold">₹${f.amount}</td>
        <td class="px-4 py-3 font-mono font-bold ${f.status === 'Refunded' ? 'text-rose-500' : 'text-slate-600'}">${f.status === 'Refunded' ? 'Refunded' : `₹${Number(f.dueBalance ?? 0).toFixed(2)}`}</td>
        <td class="px-4 py-3 text-right space-x-2 no-print">
          ${f.read_only ? '<span class="text-slate-400">Opening balance</span>' : `\n          <button onclick="printFeeReceipt('${f.receiptNo}')" class="text-amber-500 hover:text-amber-400 font-bold">Print</button>\n          <button onclick="downloadFeeReceiptPDF('${f.receiptNo}', event)" class="text-blue-500 hover:text-blue-400 font-bold">PDF</button>\n          <button onclick="editFeeRecordPrompt('${f.id || f.receiptNo}')" class="text-slate-500 hover:text-slate-700 font-bold">Edit</button>\n          <button onclick="refundFeeRecordPrompt('${f.id || f.receiptNo}', '${f.receiptNo}')" class="text-rose-500 hover:text-rose-400 font-bold">Refund</button>\n          `}\n        </td>
      </tr>
    `).join('');
    if (statementBtn) statementBtn.classList.remove('hidden');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red-500 py-4">Failed to load ledger: ${subjectHtmlEscape(err.message || 'Unknown error')}</td></tr>`;
  }
}

// Fee Collect Form Handler
const feeForm = document.getElementById('collect-fee-form');
if (feeForm) {
  feeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const studentId = document.getElementById('fee-student-id').value;
    if (!studentId) return alert('Please search and select a student first.');

    state.feeSubmissionKey = state.feeSubmissionKey || (window.crypto?.randomUUID?.() || `fee-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const payload = {
      studentId,
      session: getSelectedFeeAcademicSession(true).name,
      academic_session_id: getSelectedFeeAcademicSession(true).id,
      month: document.getElementById('fee-month').value,
      paymentDate: document.getElementById('fee-payment-date')?.value,
      type: document.getElementById('fee-type').value,
      amount: Number(document.getElementById('fee-amount').value),
      lateFee: Number(document.getElementById('fee-late-fine').value || 0),
      discountAmount: Number(document.getElementById('fee-discount').value || 0),
      scholarshipAmount: Number(document.getElementById('fee-scholarship').value || 0),
      allowAdvance: Boolean(document.getElementById('fee-allow-advance')?.checked),
      paymentMode: document.getElementById('fee-mode').value,
      referenceNo: document.getElementById('fee-ref-no').value || 'N/A',
      remarks: document.getElementById('fee-remarks').value || 'Fee Paid',
      idempotencyKey: state.feeSubmissionKey,
      legacyDueId: state.selectedLegacyDueId || null
    };
    if (payload.paymentMode !== 'Cash' && (!payload.referenceNo || payload.referenceNo === 'N/A')) return alert(`Transaction reference is required for ${payload.paymentMode} payments.`);
    if (payload.type === 'Other Custom Fee') payload.expectedAmount = payload.amount;
    if (!payload.month) return alert('Please select a billing month.');
    if (!Number.isFinite(payload.amount) || payload.amount < 0 || (payload.amount <= 0 && payload.lateFee <= 0)) return alert('Enter a fee amount or an outstanding fine payment.');
    const knownBalance = Number(state.selectedFeeProfile?.invoice?.remainingBalance || 0);
    if (!payload.legacyDueId && payload.type !== 'Other Custom Fee' && payload.amount > knownBalance && !payload.allowAdvance) {
      return alert(`Payment cannot exceed the remaining balance of ₹${knownBalance.toFixed(2)}.`);
    }

    const collectBtn = document.getElementById('collect-fee-submit-btn');
    const originalText = collectBtn.innerHTML;
    collectBtn.innerHTML = `<div class="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mr-2"></div> Processing Payment...`;
    collectBtn.disabled = true;

    try {
      const allocateOldest = Boolean(document.getElementById('fee-allocate-oldest')?.checked);
      if (allocateOldest && (payload.type !== 'Monthly Tuition Fee' || payload.legacyDueId)) throw new Error('Oldest-first allocation is available only for regular Monthly Tuition Fee payments.');
      if (allocateOldest && (payload.discountAmount > 0 || payload.scholarshipAmount > 0)) throw new Error('Apply discounts or scholarships to an individual month before using oldest-first allocation.');
      const receipt = allocateOldest ? await ApiService.collectFeeOldestFirst(payload) : await ApiService.collectFee(payload);
      clearFeeReceiptCache();
      state.feeSubmissionKey = null;
      state.selectedLegacyDueId = null;
      collectBtn.innerHTML = originalText;
      collectBtn.disabled = false;

      document.getElementById('fee-remarks').value = '';
      document.getElementById('fee-ref-no').value = '';
      document.getElementById('fee-late-fine').value = '0';
      const advanceCheckbox = document.getElementById('fee-allow-advance');
      if (advanceCheckbox) advanceCheckbox.checked = false;
      const oldestCheckbox = document.getElementById('fee-allocate-oldest');
      if (oldestCheckbox) oldestCheckbox.checked = false;
      
      // Real-time automatic updates for all dashboard cards, charts, ledgers, and reports
      await loadFeeDashboardMetrics();
      await refreshSelectedStudentFeeProfile();
      await loadSelectedStudentFeeProfile();
      await loadStudentLedger(payload.studentId);
      if (typeof loadDashboard === 'function') loadDashboard();
      if (typeof loadFeeReportsAndAudit === 'function') loadFeeReportsAndAudit();
      if (typeof loadFeeDueList === 'function') loadFeeDueList();
      if (typeof loadStudentWiseDueList === 'function') loadStudentWiseDueList();
      if (typeof loadLegacyDueManagement === 'function') loadLegacyDueManagement();
      
      showFeeSuccessModal(receipt);

    } catch (err) {
      alert(err.message || 'Fee collection failed.');
      collectBtn.innerHTML = originalText;
      collectBtn.disabled = false;
    }
  });
}

function showFeeSuccessModal(receipt) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-900 p-8 rounded-3xl max-w-sm w-full shadow-2xl space-y-6 text-center">
      <div class="bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold">✓</div>
      <div class="space-y-1">
        <h3 class="text-xl font-bold text-slate-900 dark:text-white">Payment Recorded</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 font-medium">Receipt generated successfully from the saved payment record.</p>
      </div>
      <div class="border-t border-b border-slate-100 dark:border-slate-800 py-4 text-xs text-left space-y-1.5 font-semibold text-slate-500 leading-relaxed">
        <p><strong>Receipt No:</strong> <span class="text-slate-900 dark:text-white font-mono">${receipt.receiptNo}</span></p>
        <p><strong>Amount Collected:</strong> <span class="text-slate-900 dark:text-white">₹${receipt.amount}</span></p>
        <p><strong>Fee Head:</strong> <span class="text-slate-900 dark:text-white">${receipt.type} (${receipt.month})</span></p>
        <p><strong>Payment Mode:</strong> <span class="text-slate-900 dark:text-white">${receipt.paymentMode}</span></p>
        <p><strong>WhatsApp:</strong> <span class="${receipt.whatsapp?.status === 'Failed' ? 'text-rose-600' : 'text-slate-900 dark:text-white'}">${subjectHtmlEscape(receipt.whatsapp?.status || 'Not requested')}${receipt.whatsapp?.error ? ': ' + subjectHtmlEscape(receipt.whatsapp.error) : receipt.whatsapp?.message ? ': ' + subjectHtmlEscape(receipt.whatsapp.message) : ''}</span></p>
      </div>
      <div class="flex flex-col gap-2.5">
        <button class="bg-amber-500 hover:bg-amber-400 text-slate-900 py-3 rounded-xl font-bold text-xs shadow-md" onclick="printFeeReceipt('${receipt.receiptNo}')">
          ⎙ Print Professional A4 Receipt
        </button>
        <button class="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-bold text-xs shadow-md" onclick="downloadFeeReceiptPDF('${receipt.receiptNo}', event)">
          📄 Download PDF Receipt
        </button>
        <button class="border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-250 py-3 rounded-xl font-bold text-xs" onclick="this.parentElement.parentElement.parentElement.remove()">
          Close
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Render Professional A4 Fee Receipt HTML
const feeReceiptHtmlCache = new Map();
const feeReceiptLogoCache = new Map();
const FEE_RECEIPT_CACHE_TTL_MS = 30000;

async function getFeeReceiptLogoBase64(school) {
  const current = school || window.currentSchool;
  const schoolId = current?.id || 'default';
  if (feeReceiptLogoCache.has(schoolId)) return feeReceiptLogoCache.get(schoolId);

  const fallback = current?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg';
  const logoUrl = current?.logo || fallback;

  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return logoUrl;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result || logoUrl;
        feeReceiptLogoCache.set(schoolId, base64);
        resolve(base64);
      };
      reader.onerror = () => resolve(logoUrl);
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    return logoUrl;
  }
}

function clearFeeReceiptCache() {
  feeReceiptHtmlCache.clear();
  feeReceiptLogoCache.clear();
}

async function fetchA4FeeReceiptHTML(receiptNo) {
  const selectedSession = getSelectedFeeAcademicSession(true);
  const [allFees, students, logoUrl] = await Promise.all([
    ApiService.getFees('', selectedSession.name, selectedSession.id),
    ApiService.searchFeeStudents({ academic_session_id: selectedSession.id }),
    getFeeReceiptLogoBase64()
  ]);
  const baseFee = allFees.find(item => item.receiptNo === receiptNo || item.batchReceiptNo === receiptNo);
  if (!baseFee) throw new Error(`Receipt ${receiptNo} was not found.`);
  const receiptRows = baseFee.batchReceiptNo ? allFees.filter(item => item.batchReceiptNo === baseFee.batchReceiptNo && item.status !== 'Refunded') : [baseFee];
  const f = receiptRows.length > 1 ? { ...baseFee, receiptNo: baseFee.batchReceiptNo, month: receiptRows.map(item => item.month).join(', '), amount: receiptRows.reduce((sum, item) => sum + Number(item.amount || 0), 0), lateFee: receiptRows.reduce((sum, item) => sum + Number(item.lateFee || 0), 0), discountAmount: receiptRows.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0), scholarshipAmount: receiptRows.reduce((sum, item) => sum + Number(item.scholarshipAmount || 0), 0), dueBalance: receiptRows.reduce((sum, item) => sum + Number(item.dueBalance || 0), 0) } : baseFee;

  const s = students.find(item =>
    [item.admissionNo, item.admission_number, item.studentId, item.student_id, item.id]
      .some(value => String(value || '').trim().toLowerCase() === String(f.studentId || f.student_id || f.admission_number || '').trim().toLowerCase())
  );
  if (!s) throw new Error(`The student linked to receipt ${receiptNo} was not found. Receipt generation was stopped to prevent incorrect student data.`);
  const receiptStudent = {
    name: s.name || s.studentName || 'N/A',
    admissionNo: s.admissionNo || s.admission_number || s.studentId || s.id || 'N/A',
    className: s.className || s.class_name || 'N/A',
    section: String(s.section || s.section_name || 'N/A').replace(/^Section\s+/i, ''),
    rollNo: s.rollNo || s.roll_number || 'N/A',
    fatherName: s.fatherName || s.father_name || 'N/A'
  };

  const receiptSchoolName = (window.currentSchool?.name || 'School ERP').toUpperCase();
  const receiptSchoolMeta = window.currentSchool
    ? `${window.currentSchool.affiliation || window.currentSchool.type || 'Recognized Institution'}${window.currentSchool.establishedYear ? ' | ESTD. ' + window.currentSchool.establishedYear : ''} | ${window.currentSchool.address || ''}`
    : 'Recognized Educational Institution';
  const receiptSchoolContact = window.currentSchool
    ? `Contact Helpline: ${window.currentSchool.phone || ''} | Email: ${window.currentSchool.email || ''}`
    : '';

  return `
    <div style="width:210mm; min-h:297mm; background:white; color:#0f172a; padding:12mm; font-family:'Outfit','Noto Sans','Segoe UI',Arial,sans-serif; box-sizing:border-box;" class="space-y-6">
      
      <!-- Header -->
      <div style="border-bottom: 3px solid #0f172a; padding-bottom: 12px;" class="flex justify-between items-center">
        <div class="flex items-center space-x-4">
          <img src="${logoUrl}" style="width:64px; height:64px; object-fit:contain; border-radius:50%; border:1px solid #cbd5e1;">
          <div>
            <h1 style="font-size:22px; font-weight:900; color:#0f172a; text-transform:uppercase; margin:0; line-height:1;">${receiptSchoolName}</h1>
            <p style="font-size:11px; font-weight:700; color:#64748b; margin-top:4px; text-transform:uppercase; letter-spacing:0.05em;">${receiptSchoolMeta}</p>
            <p style="font-size:10px; color:#475569; margin-top:2px;">${receiptSchoolContact}</p>
          </div>
        </div>
        <div style="text-align:right;">
          <span style="background:#f59e0b; color:#0f172a; font-weight:900; font-size:11px; padding:4px 12px; border-radius:6px; text-transform:uppercase;">Official Fee Receipt</span>
          <p style="font-size:12px; font-weight:800; font-family:'Noto Sans','Segoe UI',Arial,sans-serif; margin-top:6px; color:#0f172a;">${f.receiptNo}</p>
          <p style="font-size:10px; color:#64748b; margin-top:2px;">Date: ${new Date(f.date).toLocaleDateString('en-IN')}</p>
        </div>
      </div>

      <!-- Student & Payment Metadata -->
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; font-size:12px;" class="grid grid-cols-2 gap-4">
        <div class="space-y-1">
          <p><span style="color:#64748b; font-weight:700;">Student Name:</span> <strong>${receiptStudent.name}</strong></p>
          <p><span style="color:#64748b; font-weight:700;">Admission No:</span> <strong data-receipt-admission style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">${receiptStudent.admissionNo}</strong></p>
          <p><span style="color:#64748b; font-weight:700;">Class & Section:</span> <strong>${receiptStudent.className} - ${receiptStudent.section}</strong> (Roll: ${s.rollNo || 'N/A'})</p>
          <p><span style="color:#64748b; font-weight:700;">Father's Name:</span> <strong>${s.fatherName || 'N/A'}</strong></p>
        </div>
        <div class="space-y-1 text-right">
          <p><span style="color:#64748b; font-weight:700;">Academic Session:</span> <strong>${f.session || getCurrentAcademicSession()}</strong></p>
          <p><span style="color:#64748b; font-weight:700;">Billing Month:</span> <strong>${f.month}</strong></p>
          <p><span style="color:#64748b; font-weight:700;">Payment Mode:</span> <strong>${f.paymentMode}</strong></p>
          <p><span style="color:#64748b; font-weight:700;">Ref / Txn No:</span> <strong>${f.referenceNo || 'N/A'}</strong></p>
        </div>
      </div>

      <!-- Fee Breakdown Table -->
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:16px;">
        <thead>
          <tr style="background:#0f172a; color:white; text-transform:uppercase; font-size:11px; text-align:left;">
            <th style="padding:10px 14px;">#</th>
            <th style="padding:10px 14px;">Fee Description / Head</th>
            <th style="padding:10px 14px;">Month / Period</th>
            <th style="padding:10px 14px; text-align:right;">Amount (<span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>)</th>
          </tr>
        </thead>
        <tbody>
          ${receiptRows.map((row, index) => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:12px 14px;font-weight:700;">${index + 1}</td><td style="padding:12px 14px;font-weight:700;">${row.type}</td><td style="padding:12px 14px;">${row.month}</td><td style="padding:12px 14px;text-align:right;font-family:'Noto Sans','Segoe UI',Arial,sans-serif;font-weight:800;"><span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>${Number(row.amount).toFixed(2)}</td></tr>`).join('')}
          ${f.lateFee > 0 ? `
          <tr style="border-bottom:1px solid #e2e8f0; background:#fffbeb;">
            <td style="padding:10px 14px; font-weight:700;">2</td>
            <td style="padding:10px 14px; font-weight:700; color:#b45309;">Late Fee / Fine Penalty</td>
            <td style="padding:10px 14px;">Overdue Fine</td>
            <td style="padding:10px 14px; text-align:right; font-family:'Noto Sans','Segoe UI',Arial,sans-serif; font-weight:800; color:#b45309;"><span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>${Number(f.lateFee).toFixed(2)}</td>
          </tr>` : ''}
          ${Number(f.discountAmount || 0) > 0 ? `
          <tr style="border-bottom:1px solid #e2e8f0;background:#f0fdf4;">
            <td style="padding:10px 14px;font-weight:700;">-</td>
            <td style="padding:10px 14px;font-weight:700;color:#15803d;">Discount Adjustment</td>
            <td style="padding:10px 14px;">Approved concession</td>
            <td style="padding:10px 14px;text-align:right;font-family:'Noto Sans','Segoe UI',Arial,sans-serif;font-weight:800;color:#15803d;">-<span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>${Number(f.discountAmount).toFixed(2)}</td>
          </tr>` : ''}
          ${Number(f.scholarshipAmount || 0) > 0 ? `
          <tr style="border-bottom:1px solid #e2e8f0;background:#eff6ff;">
            <td style="padding:10px 14px;font-weight:700;">-</td>
            <td style="padding:10px 14px;font-weight:700;color:#1d4ed8;">Scholarship Adjustment</td>
            <td style="padding:10px 14px;">Scholarship benefit</td>
            <td style="padding:10px 14px;text-align:right;font-family:'Noto Sans','Segoe UI',Arial,sans-serif;font-weight:800;color:#1d4ed8;">-<span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>${Number(f.scholarshipAmount).toFixed(2)}</td>
          </tr>` : ''}
        </tbody>
      </table>

      <!-- Summary Footer -->
      <div class="flex justify-between items-start pt-4">
        <div style="font-size:11px; color:#64748b;" class="space-y-1">
          <p><strong>Remarks:</strong> ${f.remarks || 'Payment Received in Full'}</p>
          <p><strong>Issued By:</strong> Accounts Section, GJV Nagaon</p>
          <p style="font-style:italic; margin-top:8px;">* Computer generated receipt does not require physical signature if sealed.</p>
        </div>
        <div style="text-align:right; width:220px;" class="space-y-2">
          <div style="border-top:2px dashed #cbd5e1; padding-top:8px;" class="flex justify-between text-xs font-extrabold">
            <span>Total Paid Amount:</span>
            <span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif; font-size:15px; color:#15803d;"><span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>${(Number(f.amount) + Number(f.lateFee || 0)).toFixed(2)}</span>
          </div>
          <div class="flex justify-between text-xs font-bold text-slate-500">
            <span>Balance Due:</span>
            <span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;"><span style="font-family:'Noto Sans','Segoe UI',Arial,sans-serif;">₹</span>${Number(f.dueBalance || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <!-- Signatures Block -->
      <div style="margin-top:40px; padding-top:20px; border-top:1px solid #e2e8f0;" class="flex justify-between items-end text-xs font-bold">
        <div style="text-align:center;">
          <p style="color:#94a3b8; font-size:10px;">_________________________</p>
          <p style="margin-top:4px; color:#0f172a;">Depositor / Parent Signature</p>
        </div>
        <div style="text-align:center;">
          <p style="font-family:cursive; font-weight:bold; color:#1e293b; margin-bottom:2px;">Anarul Hussain</p>
          <p style="color:#94a3b8; font-size:10px;">_________________________</p>
          <p style="margin-top:4px; color:#0f172a;">Authorised School Stamp & Seal</p>
        </div>
      </div>

    </div>
  `;
}

async function buildA4FeeReceiptHTML(receiptNo) {
  const selectedSession = getSelectedFeeAcademicSession(true);
  const cacheKey = `${selectedSession.id}:${receiptNo}`;
  const cached = feeReceiptHtmlCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < FEE_RECEIPT_CACHE_TTL_MS) return cached.promise;
  const promise = fetchA4FeeReceiptHTML(receiptNo).catch(error => {
    feeReceiptHtmlCache.delete(cacheKey);
    throw error;
  });
  feeReceiptHtmlCache.set(cacheKey, { createdAt: Date.now(), promise });
  return promise;
}

async function waitForFeeReceiptAssets(container) {
  if (!container || !container.isConnected) throw new Error('Fee receipt export container is not mounted.');
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Fee receipt export container has zero width or height.');
  if (document.fonts?.ready) await document.fonts.ready;
  const images = [...container.querySelectorAll('img')];
  await Promise.all(images.map(image => image.complete && image.naturalWidth > 0 ? Promise.resolve() : new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Receipt image loading timed out: ' + (image.currentSrc || image.src))), 10000);
    image.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    image.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Receipt image failed to load: ' + (image.currentSrc || image.src))); }, { once: true });
  })));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function mountFeeReceipt(receiptNo) {
  const container = document.getElementById('print-feereceipt-template');
  if (!container) throw new Error('Fee receipt render container is missing.');
  container.innerHTML = await buildA4FeeReceiptHTML(receiptNo);
  container.classList.remove('hidden');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;min-height:297mm;padding:0;margin:0;background:#ffffff;display:block;visibility:visible;opacity:1;z-index:-9999;pointer-events:none;overflow:visible;box-sizing:border-box;';
  const receipt = container.firstElementChild;
  if (!(receipt instanceof HTMLElement)) throw new Error('Fee receipt DOM was not rendered.');
  await waitForFeeReceiptAssets(receipt);
  const rect = receipt.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || receipt.scrollWidth <= 0 || receipt.scrollHeight <= 0) throw new Error('Fee receipt has invalid dimensions.');
  return { container, receipt, shared: false };
}

function unmountFeeReceipt(container) {
  if (!container) return;
  container.classList.remove('print-active');
  container.classList.add('hidden');
  container.removeAttribute('style');
  container.innerHTML = '';
}

function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function renderFeeReceiptCanvas(receipt) {
  const html2canvasFn = (typeof window.getHtml2Canvas === 'function' ? await window.getHtml2Canvas() : null) || window.html2canvas;
  if (typeof html2canvasFn !== 'function') throw new Error('html2canvas is not available.');
  const rect = receipt.getBoundingClientRect();
  await nextPaint();
  const canvas = await html2canvasFn(receipt, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
    windowWidth: Math.ceil(rect.width),
    windowHeight: Math.ceil(rect.height),
    scrollX: 0,
    scrollY: 0,
    logging: false
  });
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) throw new Error('Fee receipt renderer returned a zero-size canvas.');

  const probe = document.createElement('canvas');
  probe.width = 32;
  probe.height = 32;
  try {
    const context = probe.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Fee receipt canvas context is unavailable.');
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let nonWhite = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 248 || pixels[i + 1] < 248 || pixels[i + 2] < 248) nonWhite++;
    }
    if (nonWhite <= 5) throw new Error('Fee receipt canvas is blank.');
  } finally {
    probe.width = 0;
    probe.height = 0;
  }
  return canvas;
}

function feeReceiptCanvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) return reject(new Error('Fee receipt JPEG encoding failed.'));
      try { resolve(new Uint8Array(await blob.arrayBuffer())); }
      catch (error) { reject(error); }
    }, 'image/jpeg', 0.98);
  });
}

function setFeeReceiptPdfLoader(visible) {
  let loader = document.getElementById('fee-receipt-pdf-loader');
  if (visible) {
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'fee-receipt-pdf-loader';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-live', 'polite');
      loader.className = 'fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-opacity no-print';
      loader.innerHTML = `
        <div class="bg-slate-900 text-white px-6 py-5 rounded-2xl shadow-2xl flex items-center space-x-4 border border-slate-700">
          <svg class="animate-spin h-6 w-6 text-amber-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <div>
            <p class="font-bold text-sm text-white">Generating Fee Receipt PDF...</p>
            <p class="text-xs text-slate-400 mt-0.5">Please wait a moment while the high-resolution receipt is prepared.</p>
          </div>
        </div>
      `;
      document.body.appendChild(loader);
    }
  } else if (loader) {
    loader.remove();
  }
}

window.printFeeReceipt = async function(receiptNo) {
  let mounted;
  try {
    mounted = await mountFeeReceipt(receiptNo);
    mounted.container.classList.add('print-active');
    mounted.container.style.cssText = 'position:fixed;left:0;top:0;width:210mm;min-height:297mm;padding:0;margin:0;background:#ffffff;display:block;visibility:visible;opacity:1;z-index:99999;overflow:visible;box-sizing:border-box;';
    window.print();
  } catch (error) {
    console.error('Fee receipt print failed:', error);
    alert('Fee receipt print failed: ' + error.message);
  } finally {
    setTimeout(() => unmountFeeReceipt(mounted?.container), 500);
  }
};

const feeReceiptPdfJobs = new Map();
window.downloadFeeReceiptPDF = function(receiptNo, event) {
  const jobKey = String(receiptNo);
  if (feeReceiptPdfJobs.has(jobKey)) return feeReceiptPdfJobs.get(jobKey);

  const findButtons = () => {
    const list = [];
    if (event?.currentTarget instanceof HTMLButtonElement) list.push(event.currentTarget);
    else if (event?.target instanceof HTMLElement) {
      const btn = event.target.closest('button');
      if (btn) list.push(btn);
    }
    if (document.activeElement instanceof HTMLButtonElement && !list.includes(document.activeElement)) {
      list.push(document.activeElement);
    }
    document.querySelectorAll('button').forEach(btn => {
      const attr = btn.getAttribute('onclick') || '';
      if (attr.includes(`downloadFeeReceiptPDF('${receiptNo}'`) || attr.includes(`downloadFeeReceiptPDF("${receiptNo}"`)) {
        if (!list.includes(btn)) list.push(btn);
      }
    });
    return list;
  };

  const targets = findButtons();
  const originalState = targets.map(btn => ({ btn, text: btn.innerHTML, disabled: btn.disabled }));

  const job = (async () => {
    let mounted;
    let canvas;
    try {
      targets.forEach(btn => {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.innerHTML = `
          <span class="inline-flex items-center gap-1.5">
            <svg class="animate-spin h-3.5 w-3.5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Generating PDF...
          </span>
        `;
      });
      setFeeReceiptPdfLoader(true);

      // Yield execution to guarantee UI repaints before html2canvas blocks main thread
      await new Promise(resolve => setTimeout(resolve, 80));

      mounted = await mountFeeReceipt(receiptNo);
      canvas = await renderFeeReceiptCanvas(mounted.receipt);
      const jpegBytes = await feeReceiptCanvasToJpeg(canvas);
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      if (typeof JsPDF !== 'function') throw new Error('jsPDF is not available.');
      const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const pageWidth = 210, pageHeight = 297, ratio = canvas.width / canvas.height;
      let drawWidth = pageWidth, drawHeight = drawWidth / ratio;
      if (drawHeight > pageHeight) { drawHeight = pageHeight; drawWidth = drawHeight * ratio; }
      const x = (pageWidth - drawWidth) / 2, y = (pageHeight - drawHeight) / 2;
      pdf.addImage(jpegBytes, 'JPEG', x, y, drawWidth, drawHeight, undefined, 'FAST');
      const admissionNo = mounted.receipt.querySelector('[data-receipt-admission]')?.textContent?.trim() || state.selectedStudentForFee?.admissionNo || 'Student';
      const safeName = value => String(value).replace(/[^A-Za-z0-9_-]+/g, '_');
      pdf.save('Fee_Receipt_' + safeName(admissionNo) + '_' + safeName(receiptNo) + '.pdf');
    } catch (error) {
      console.error('Fee receipt PDF export failed:', error);
      alert('Unable to generate fee receipt PDF: ' + (error.message || error));
    } finally {
      if (canvas) {
        try {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        } catch (_) {}
        canvas.width = 0;
        canvas.height = 0;
      }
      unmountFeeReceipt(mounted?.container);
      setFeeReceiptPdfLoader(false);
      originalState.forEach(({ btn, text, disabled }) => {
        if (btn && btn.isConnected) {
          btn.disabled = disabled;
          btn.removeAttribute('aria-busy');
          btn.innerHTML = text;
        }
      });
    }
  })();

  feeReceiptPdfJobs.set(jobKey, job);
  job.finally(() => feeReceiptPdfJobs.delete(jobKey));
  return job;
};
const feeStatementBtn = document.getElementById('fee-history-print-statement-btn');
if (feeStatementBtn) {
  feeStatementBtn.onclick = async () => {
    const student = state.selectedStudentForFee;
    if (!student) return alert('Select a student before printing the ledger statement.');
    try {
      const selectedSession = getSelectedFeeAcademicSession(true);
      const fees = await ApiService.getFees(student.admissionNo || student.studentId || student.id, selectedSession.name, selectedSession.id);
      const total = fees.reduce((sum, fee) => sum + Number(fee.amount || 0) + Number(fee.lateFee || 0), 0);
      const rows = fees.map(fee => `
        <tr>
          <td style="padding:7px;border:1px solid #cbd5e1">${fee.receiptNo}</td>
          <td style="padding:7px;border:1px solid #cbd5e1">${new Date(fee.date).toLocaleDateString('en-IN')}</td>
          <td style="padding:7px;border:1px solid #cbd5e1">${fee.type}</td>
          <td style="padding:7px;border:1px solid #cbd5e1">${fee.month}</td>
          <td style="padding:7px;border:1px solid #cbd5e1;text-align:right">₹${(Number(fee.amount || 0) + Number(fee.lateFee || 0)).toFixed(2)}</td>
          <td style="padding:7px;border:1px solid #cbd5e1;text-align:right">₹${Number(fee.dueBalance || 0).toFixed(2)}</td>
        </tr>`).join('');
      const container = document.getElementById('print-feereceipt-template');
      container.innerHTML = `<div style="background:white;color:#0f172a;padding:12mm;font-family:sans-serif">
        <h1 style="font-size:22px;font-weight:900">Garumara Jatiya Vidyalaya</h1>
        <h2 style="font-size:15px;margin-top:4px">Student Fee Ledger Statement</h2>
        <p style="font-size:12px;margin:12px 0"><strong>${student.name}</strong> · ${student.admissionNo} · ${student.className}-${student.section}</p>
        <table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>
          <th style="padding:7px;border:1px solid #cbd5e1">Receipt</th><th style="padding:7px;border:1px solid #cbd5e1">Date</th>
          <th style="padding:7px;border:1px solid #cbd5e1">Category</th><th style="padding:7px;border:1px solid #cbd5e1">Month</th>
          <th style="padding:7px;border:1px solid #cbd5e1">Received</th><th style="padding:7px;border:1px solid #cbd5e1">Balance</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="6">No fee records found.</td></tr>'}</tbody></table>
        <p style="text-align:right;font-weight:800;margin-top:12px">Total Received: ₹${total.toFixed(2)}</p>
      </div>`;
      container.classList.remove('hidden');
      container.classList.add('print-active');
      window.print();
      setTimeout(() => {
        container.classList.remove('print-active');
        container.classList.add('hidden');
        container.innerHTML = '';
      }, 500);
    } catch (err) {
      alert(`Unable to print student ledger: ${err.message}`);
    }
  };
}

// SUBTAB 2: Load Fee Due List & Reminders
async function loadFeeDueList() {
  const tbody = document.getElementById('fee-due-tbody');
  if (!tbody) return;

  const className = document.getElementById('fee-due-filter-class').value;
  const section = document.getElementById('fee-due-filter-section').value;
  const month = document.getElementById('fee-due-filter-month').value;

  tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">Loading fee dues...</td></tr>`;

  try {
    const selectedSession = getSelectedFeeAcademicSession(true);
    const dues = await ApiService.getFeeDueList(className, section, month, selectedSession.name, selectedSession.id);
    state.currentFeeDueList = Array.isArray(dues) ? dues : [];

    if (dues.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400">No fee records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = dues.map(d => `
      <tr class="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
        <td class="px-4 py-3 font-mono font-bold">${d.studentId}</td>
        <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${d.name}</td>
        <td class="px-4 py-3">${d.className}-${d.section} (Roll: ${d.rollNo})</td>
        <td class="px-4 py-3">${d.mobile}</td>
        <td class="px-4 py-3 font-mono">₹${d.monthlyFee}</td>
        <td class="px-4 py-3 font-mono text-emerald-600">₹${d.paidAmount}</td>
        <td class="px-4 py-3 font-mono font-bold text-rose-500">₹${d.dueAmount}</td>
        <td class="px-4 py-3">
          <span class="px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${d.status === 'Paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'}">${d.status}</span>
        </td>
        <td class="px-4 py-3 text-right">
          <button onclick="selectStudentForFee('${d.studentId}'); document.getElementById('fee-subtab-btn-collect').click();" class="text-xs bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-3 py-1.5 rounded-lg">Collect Fee</button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-rose-500 py-4">Failed to load fee dues: ${subjectHtmlEscape(err.message || 'Unknown error')}</td></tr>`;
  }
}

function feeReminderResultMessage(result, label = 'Fee reminder') {
  const sent = Number(result?.sent || 0), duplicates = Number(result?.duplicates || 0), parts = [];
  if (sent) parts.push(`${sent} accepted by Meta`);
  if (duplicates) parts.push(`${duplicates} already sent`);
  return parts.length ? `${label}: ${parts.join(', ')}.` : `${label}: no new message was sent.`;
}

// Bind Due Filter & Send Reminders
const dueFilterBtn = document.getElementById('fee-due-load-btn');
if (dueFilterBtn) {
  dueFilterBtn.onclick = loadFeeDueList;
}

const sendRemindersBtn = document.getElementById('fee-send-due-reminders-btn');
if (sendRemindersBtn) {
  sendRemindersBtn.onclick = async () => {
    const dues = state.currentFeeDueList || [];
    if (!dues.length) return alert('Load a due list containing pending students before sending reminders.');
    if (!confirm(`Queue reminders for ${dues.length} due students?`)) return;
    const originalText = sendRemindersBtn.innerHTML;
    sendRemindersBtn.disabled = true;
    sendRemindersBtn.textContent = 'Queuing reminders...';
    try {
      const result = await ApiService.sendFeeReminders(dues.map(item => item.studentId), document.getElementById('fee-due-filter-month')?.value || '', 'due', getSelectedFeeAcademicSession(true).id);
      if(result.failed)throw new Error(result.error||`${result.failed} reminder(s) failed.`);alert(feeReminderResultMessage(result, 'Fee reminders'));
    } catch (error) {
      console.error('Fee due reminders failed:', error);
      alert(error.message || 'Fee due reminders failed.');
    } finally {
      sendRemindersBtn.disabled = false;
      sendRemindersBtn.innerHTML = originalText;
    }
  };
}
// ==========================================
// STUDENT-WISE DUE LIST MANAGEMENT MODULE
// ==========================================

let swdState = {
  allDues: [],
  filteredDues: [],
  selectedIds: new Set(),
  sortCol: 'name',
  sortDir: 'asc',
  currentPage: 1,
  pageSize: 25
};

async function loadStudentWiseDueList() {
  const tbody = document.getElementById('swd-table-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="17" class="text-center py-12 text-slate-400 font-semibold"><div class="inline-block w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-2"></div> Loading student-wise due records...</td></tr>`;

  try {
    const filters = {
      className: document.getElementById('swd-filter-class')?.value || '',
      section: document.getElementById('swd-filter-section')?.value || '',
      month: document.getElementById('swd-filter-month')?.value || '',
      session: document.getElementById('swd-filter-session')?.value || getSelectedFeeAcademicSession(true).name,
      academic_session_id: (academicSessionsCache.find(row => row.session_name === (document.getElementById('swd-filter-session')?.value || getSelectedFeeAcademicSession(true).name)) || getSelectedFeeAcademicSession(true)).id,
      category: document.getElementById('swd-filter-category')?.value || '',
      status: document.getElementById('swd-filter-status')?.value || ''
    };

    const duesData = await ApiService.getStudentWiseDueList(filters);

    swdState.allDues = duesData;
    swdState.selectedIds.clear();
    updateSWDSelectedCount();
    applySWDFiltersAndRender();

  } catch (err) {
    console.error('Error loading student-wise due list:', err);
    tbody.innerHTML = `<tr><td colspan="17" class="text-center py-10 text-rose-500 font-bold">Failed to load student due list: ${subjectHtmlEscape(err.message || 'Unknown error')}</td></tr>`;
  }
}

function applySWDFiltersAndRender() {
  const searchTerm = (document.getElementById('swd-filter-search')?.value || '').toLowerCase().trim();
  const filterClass = document.getElementById('swd-filter-class')?.value || '';
  const filterSection = document.getElementById('swd-filter-section')?.value || '';
  const filterSession = document.getElementById('swd-filter-session')?.value || '';
  const filterMonth = document.getElementById('swd-filter-month')?.value || '';
  const filterCategory = document.getElementById('swd-filter-category')?.value || '';
  const filterStatus = document.getElementById('swd-filter-status')?.value || '';

  swdState.filteredDues = swdState.allDues.filter(item => {
    if (searchTerm) {
      const matchName = String(item.name || '').toLowerCase().includes(searchTerm);
      const matchAdm = String(item.admissionNo || item.studentId || '').toLowerCase().includes(searchTerm);
      const matchMob = String(item.mobile || '').toLowerCase().includes(searchTerm);
      const matchFather = String(item.fatherName || '').toLowerCase().includes(searchTerm);
      if (!matchName && !matchAdm && !matchMob && !matchFather) return false;
    }
    if (filterClass && item.className !== filterClass) return false;
    if (filterSection && item.section !== filterSection) return false;
    if (filterSession && item.academicSession !== filterSession) return false;
    if (filterMonth && !(item.dueMonths || [item.dueMonth]).includes(filterMonth)) return false;
    if (filterCategory && item.feeCategory !== filterCategory) return false;
    if (filterStatus === 'Overdue' && Number(item.overdueMonths || 0) <= 0) return false;
    if (['Partial', 'Partially Paid'].includes(filterStatus) && !item.isPartiallyPaid) return false;
    if (filterStatus === 'Pending' && item.dueStatus !== 'Pending') return false;
    if (['Paid', 'Cleared'].includes(filterStatus) && item.dueStatus !== 'Paid') return false;
    return true;
  });

  // Sort
  const col = swdState.sortCol;
  const dir = swdState.sortDir === 'asc' ? 1 : -1;
  swdState.filteredDues.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];
    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }
    return String(valA || '').localeCompare(String(valB || '')) * dir;
  });

  updateSWDSummaryCards();
  swdState.currentPage = 1;
  renderSWDTable();
}

function updateSWDSummaryCards() {
  const list = swdState.filteredDues;

  const dueStudents = list.filter(d => Number(d.pendingAmount || 0) > 0).length;
  const totalPending = list.reduce((sum, d) => sum + Number(d.pendingAmount || 0), 0);
  const totalOverdue = list.reduce((sum, d) => sum + Number(d.totalOverdue || 0), 0);
  const partialStudents = list.filter(d => d.isPartiallyPaid).length;
  const dueThisMonth = list.reduce((sum, d) => sum + Number(d.dueThisMonthAmount || 0), 0);

  if (document.getElementById('swd-card-due-students')) document.getElementById('swd-card-due-students').innerText = dueStudents;
  if (document.getElementById('swd-card-pending-amount')) document.getElementById('swd-card-pending-amount').innerText = `₹${totalPending.toLocaleString('en-IN')}`;
  if (document.getElementById('swd-card-overdue-amount')) document.getElementById('swd-card-overdue-amount').innerText = `₹${totalOverdue.toLocaleString('en-IN')}`;
  if (document.getElementById('swd-card-partial-students')) document.getElementById('swd-card-partial-students').innerText = partialStudents;
  if (document.getElementById('swd-card-this-month-amount')) document.getElementById('swd-card-this-month-amount').innerText = `₹${dueThisMonth.toLocaleString('en-IN')}`;
}

function renderSWDTable() {
  const tbody = document.getElementById('swd-table-tbody');
  if (!tbody) return;

  const totalItems = swdState.filteredDues.length;
  const pageSize = Number(document.getElementById('swd-page-size')?.value || swdState.pageSize);
  swdState.pageSize = pageSize;

  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  if (swdState.currentPage > totalPages) swdState.currentPage = totalPages;
  if (swdState.currentPage < 1) swdState.currentPage = 1;

  const startIndex = (swdState.currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageItems = swdState.filteredDues.slice(startIndex, endIndex);

  // Pagination Text
  const pageInfo = document.getElementById('swd-pagination-info');
  if (pageInfo) pageInfo.innerText = totalItems > 0 ? `Showing ${startIndex + 1}-${endIndex} of ${totalItems}` : `Showing 0-0 of 0`;

  const currPageElem = document.getElementById('swd-current-page');
  if (currPageElem) currPageElem.innerText = `Page ${swdState.currentPage} of ${totalPages}`;

  const prevBtn = document.getElementById('swd-prev-page-btn');
  if (prevBtn) prevBtn.disabled = swdState.currentPage === 1;

  const nextBtn = document.getElementById('swd-next-page-btn');
  if (nextBtn) nextBtn.disabled = swdState.currentPage === totalPages;

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" class="text-center py-12 text-slate-400 font-semibold">No student due records match the applied filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageItems.map((d, index) => {
    const isChecked = swdState.selectedIds.has(d.admissionNo) ? 'checked' : '';
    
    // Status Badge & Accent Color
    let statusClass = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    if (d.dueStatus === 'Overdue') {
      statusClass = 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 border-red-200 dark:border-red-800';
    } else if (d.dueStatus === 'Partially Paid') {
      statusClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    } else if (d.dueStatus === 'Paid') {
      statusClass = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
    }

    return `
      <tr class="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
        <td class="p-3.5 text-center">
          <input type="checkbox" class="swd-row-cb w-4 h-4 rounded text-amber-500 focus:ring-amber-500 cursor-pointer" data-id="${d.admissionNo}" ${isChecked} onchange="toggleSWDSelection('${d.admissionNo}', this.checked)">
        </td>
        <td class="p-3.5">
          <span class="font-bold text-slate-900 dark:text-white block hover:text-amber-500 cursor-pointer" onclick="viewStudentDetails('${d.admissionNo}')">${d.name}</span>
        </td>
        <td class="p-3.5 font-mono font-bold text-slate-800 dark:text-slate-200">${d.admissionNo}</td>
        <td class="p-3.5"><span class="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-bold">${d.className}-${d.section}</span></td>
        <td class="p-3.5 text-slate-600 dark:text-slate-300">${d.fatherName}</td>
        <td class="p-3.5 font-mono text-slate-600 dark:text-slate-300">${d.mobile}</td>
        <td class="p-3.5">${d.academicSession}</td>
        <td class="p-3.5 font-mono text-slate-700 dark:text-slate-300"><span class="block">${(d.dueMonths || []).join(', ') || d.dueMonth}</span><span class="block mt-1 text-[10px] text-slate-400">Pending: ${d.pendingMonths || 0}${d.overdueMonths ? ` | Overdue: ${d.overdueMonths} | ${d.overdueDays} days` : ''}</span></td>
        <td class="p-3.5"><span class="text-[11px] font-bold text-amber-600 dark:text-amber-400">${d.feeCategory}</span></td>
        <td class="p-3.5 font-mono text-right text-slate-800 dark:text-slate-200">₹${d.totalFee}</td>
        <td class="p-3.5 font-mono text-right text-emerald-600 font-bold">₹${d.paidAmount}</td>
        <td class="p-3.5 font-mono text-right text-amber-600 font-bold">₹${d.pendingAmount}</td>
        <td class="p-3.5 font-mono text-right text-slate-500">₹${d.lateFine}</td>
        <td class="p-3.5 font-mono text-right font-black text-rose-600 text-sm">₹${d.totalOutstanding}<span class="block text-[9px] font-semibold text-slate-400">Overdue ₹${d.totalOverdue || 0}</span></td>
        <td class="p-3.5 font-mono text-slate-500 text-[11px]">${d.lastPaymentDate}</td>
        <td class="p-3.5 text-center">
          <span class="px-2.5 py-1 rounded-md text-[10px] font-black uppercase border ${statusClass}">${d.dueStatus}</span>
        </td>
        <td class="p-3.5 text-right sticky right-0 bg-white dark:bg-slate-950 shadow-sm">
          <div class="flex items-center justify-end space-x-1">
            <button onclick="collectFeeForStudent('${d.admissionNo}', '${d.nextDueMonth || d.dueMonths?.[0] || ''}', ${d.nextDueAmount || d.pendingAmount}, '${d.feeCategory}')" title="Collect Fee" class="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-2.5 py-1 rounded-lg text-xs transition-colors">
              💳 Collect
            </button>
            <button onclick="viewLedgerForStudent('${d.admissionNo}')" title="View Ledger" class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg text-xs font-bold">
              📋
            </button>
            <button onclick="printStudentDueNotice('${d.admissionNo}')" title="Print Due Notice" class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg text-xs font-bold">
              𖠀
            </button>
            <button onclick="sendStudentReminder('${d.admissionNo}', '${d.name}', '${d.mobile}', ${d.totalOutstanding})" title="Send Reminder" class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg text-xs font-bold">
              📲
            </button>
            <button onclick="editStudentInfo('${d.admissionNo}')" title="View Profile" class="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg text-xs font-bold">
              👤
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.sortSWD = function(column) {
  if (swdState.sortCol === column) {
    swdState.sortDir = swdState.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    swdState.sortCol = column;
    swdState.sortDir = 'asc';
  }
  applySWDFiltersAndRender();
};

window.toggleSWDSelection = function(id, checked) {
  if (checked) swdState.selectedIds.add(id);
  else swdState.selectedIds.delete(id);
  updateSWDSelectedCount();
};

function updateSWDSelectedCount() {
  const countElem = document.getElementById('swd-selected-count');
  if (countElem) countElem.innerText = `${swdState.selectedIds.size} Selected`;

  const selectAllCb = document.getElementById('swd-select-all');
  if (selectAllCb) {
    const totalVisible = swdState.filteredDues.length;
    selectAllCb.checked = totalVisible > 0 && swdState.selectedIds.size === totalVisible;
  }
}

// Action Button Handlers
window.collectFeeForStudent = async function(admissionNo, dueMonth, pendingAmount, feeCategory = 'Monthly Tuition Fee') {
  try {
    await window.selectStudentForFee(admissionNo);
    const monthInput = document.getElementById('fee-month');
    const typeInput = document.getElementById('fee-type');
    if (monthInput && dueMonth) monthInput.value = dueMonth;
    if (typeInput && feeCategory) typeInput.value = feeCategory;
    await refreshSelectedStudentFeeProfile();
    const amountInput = document.getElementById('fee-amount');
    const currentBalance = Number(state.selectedFeeProfile?.invoice?.remainingBalance || pendingAmount || 0);
    if (amountInput) amountInput.value = currentBalance > 0 ? currentBalance : '';
    document.getElementById('fee-subtab-btn-collect')?.click();
  } catch (error) {
    console.error('Unable to open overdue invoice for collection:', error);
    alert(`Unable to open overdue invoice: ${error.message}`);
  }
};
window.viewLedgerForStudent = function(admissionNo) {
  window.selectStudentForFee(admissionNo);
  const collectBtn = document.getElementById('fee-subtab-btn-collect');
  if (collectBtn) collectBtn.click();
};

window.viewStudentDetails = function(admissionNo) {
  return window.viewStudentFeeProfile(admissionNo);
};

window.printStudentDueNotice = function(admissionNo) {
  const student = (swdState.allDues || []).find(d => d.admissionNo === admissionNo);
  if (!student) return alert('Student details not found.');

  const renderBox = document.getElementById('swd-notice-render-box');
  if (!renderBox) return;

  const todayStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const refNo = `GJV/DUE/${new Date().getFullYear()}/${admissionNo}/${student.dueMonth || 'CURRENT'}`;

  renderBox.innerHTML = `
    <div style="border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg')}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: contain;">
        <div>
          <h2 style="font-size: 18px; font-weight: 900; color: #0f172a; margin: 0; text-transform: uppercase;">${(window.currentSchool?.name || 'Garumara Jatiya Vidyalaya').toUpperCase()}</h2>
          <p style="font-size: 10px; color: #64748b; margin: 0;">${window.currentSchool ? (window.currentSchool.address || '') + (window.currentSchool.phone ? ' | Phone: ' + window.currentSchool.phone : '') : 'Garumara, Nagaon, Assam - 782141 | Phone: +91 98765 43210'}</p>
        </div>
      </div>
      <div style="text-align: right; font-size: 10px; color: #475569;">
        <p style="margin: 0; font-weight: 800; color: #d97706;">FEE DUE NOTICE</p>
        <p style="margin: 0; font-family: monospace;">Ref: ${refNo}</p>
        <p style="margin: 0;">Date: ${todayStr}</p>
      </div>
    </div>

    <div style="font-size: 11px; line-height: 1.5; color: #1e293b;">
      <p style="margin-bottom: 12px;"><strong>To the Parent / Guardian of:</strong></p>
      <div style="background: #f8fafc; padding: 10px 14px; border-radius: 8px; border: 1px solid #e2e8f0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 16px;">
        <div><strong>Student Name:</strong> ${student.name}</div>
        <div><strong>Admission No:</strong> ${student.admissionNo}</div>
        <div><strong>Class & Section:</strong> ${student.className} - ${student.section}</div>
        <div><strong>Father's Name:</strong> ${student.fatherName}</div>
        <div><strong>Contact Mobile:</strong> ${student.mobile}</div>
        <div><strong>Academic Session:</strong> ${student.academicSession}</div>
      </div>

      <p style="margin-bottom: 8px;">Dear Parent/Guardian,</p>
      <p style="margin-bottom: 12px; text-align: justify;">
        This is a polite reminder regarding the outstanding school fee dues for your ward for the month of <strong>${student.dueMonth}</strong>. Kindly clear the pending balance at your earliest convenience to avoid any disruption in academic services or examination eligibility.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px;">
        <thead>
          <tr style="background: #0f172a; color: #ffffff;">
            <th style="padding: 6px 10px; text-align: left;">Fee Category</th>
            <th style="padding: 6px 10px; text-align: center;">Billing Month</th>
            <th style="padding: 6px 10px; text-align: right;">Total Fee</th>
            <th style="padding: 6px 10px; text-align: right;">Paid Amount</th>
            <th style="padding: 6px 10px; text-align: right;">Late Fine</th>
            <th style="padding: 6px 10px; text-align: right;">Total Outstanding</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px 10px;">${student.feeCategory}</td>
            <td style="padding: 8px 10px; text-align: center;">${student.dueMonth}</td>
            <td style="padding: 8px 10px; text-align: right;">₹${student.totalFee}</td>
            <td style="padding: 8px 10px; text-align: right; color: #16a34a;">₹${student.paidAmount}</td>
            <td style="padding: 8px 10px; text-align: right; color: #d97706;">₹${student.lateFine}</td>
            <td style="padding: 8px 10px; text-align: right; font-weight: 900; color: #dc2626;">₹${student.totalOutstanding}</td>
          </tr>
        </tbody>
      </table>

      <div style="background: #fffbeb; border: 1px solid #fef3c7; padding: 10px; border-radius: 8px; font-size: 10px; color: #92400e; margin-bottom: 24px;">
        <strong>Payment Modes Accepted:</strong> Cash at School Accounts Desk, UPI / GPay / PhonePe to School Account, or Direct Bank Transfer. Please bring this notice copy or provide the admission number during payment.
      </div>

      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; font-size: 10px;">
        <div style="text-align: center; width: 120px;">
          <div style="border-bottom: 1px solid #94a3b8; margin-bottom: 4px; height: 16px;"></div>
          <span>Accounts Department</span>
        </div>
        <div style="text-align: center; width: 140px;">
          <div style="font-family: 'Great Vibes', cursive, sans-serif; font-size: 14px; color: #d97706; font-weight: bold; margin-bottom: 2px;">Anarul Hussain</div>
          <span>Principal / Headmaster</span>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById('swd-due-notice-modal');
  if (modal) modal.classList.remove('hidden');
};

window.sendStudentReminder = async function(admissionNo, name) {
  try {
    const month = (swdState.allDues || []).find(item => item.admissionNo === admissionNo)?.dueMonth || '';
    const result = await ApiService.sendFeeReminders([admissionNo], month, 'due', (academicSessionsCache.find(row=>row.session_name===((swdState.allDues||[]).find(item=>item.admissionNo===admissionNo)?.academicSession))||getSelectedFeeAcademicSession(true)).id);
    if(result.failed)throw new Error(result.error||'Fee reminder failed.');alert(feeReminderResultMessage(result, `Fee reminder for ${name}`));
  } catch (error) {
    console.error('Fee reminder failed:', error);
    alert(error.message || 'Fee reminder failed.');
  }
};

function initSWDEvents() {
  const searchInput = document.getElementById('swd-filter-search');
  if (searchInput) searchInput.addEventListener('input', applySWDFiltersAndRender);

  ['swd-filter-class', 'swd-filter-section', 'swd-filter-session', 'swd-filter-month', 'swd-filter-category', 'swd-filter-status'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) elem.addEventListener('change', applySWDFiltersAndRender);
  });

  const resetBtn = document.getElementById('swd-reset-filters-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (document.getElementById('swd-filter-search')) document.getElementById('swd-filter-search').value = '';
      if (document.getElementById('swd-filter-class')) document.getElementById('swd-filter-class').value = '';
      if (document.getElementById('swd-filter-section')) document.getElementById('swd-filter-section').value = '';
      if (document.getElementById('swd-filter-session')) document.getElementById('swd-filter-session').value = '';
      if (document.getElementById('swd-filter-month')) document.getElementById('swd-filter-month').value = '';
      if (document.getElementById('swd-filter-category')) document.getElementById('swd-filter-category').value = '';
      if (document.getElementById('swd-filter-status')) document.getElementById('swd-filter-status').value = '';
      applySWDFiltersAndRender();
    };
  }

  // Select All Checkbox
  const selectAllCb = document.getElementById('swd-select-all');
  if (selectAllCb) {
    selectAllCb.onchange = (e) => {
      const isChecked = e.target.checked;
      swdState.filteredDues.forEach(d => {
        if (isChecked) swdState.selectedIds.add(d.admissionNo);
        else swdState.selectedIds.delete(d.admissionNo);
      });
      updateSWDSelectedCount();
      renderSWDTable();
    };
  }

  // Pagination
  const pageSizeSelect = document.getElementById('swd-page-size');
  if (pageSizeSelect) pageSizeSelect.onchange = () => renderSWDTable();

  const prevBtn = document.getElementById('swd-prev-page-btn');
  if (prevBtn) prevBtn.onclick = () => { if (swdState.currentPage > 1) { swdState.currentPage--; renderSWDTable(); } };

  const nextBtn = document.getElementById('swd-next-page-btn');
  if (nextBtn) nextBtn.onclick = () => { swdState.currentPage++; renderSWDTable(); };

  // Bulk Print Notices
  const bulkPrintBtn = document.getElementById('swd-bulk-print-notice-btn');
  if (bulkPrintBtn) {
    bulkPrintBtn.onclick = () => {
      if (swdState.selectedIds.size === 0) return alert('Please select at least one student from the list.');
      const selectedList = swdState.allDues.filter(d => swdState.selectedIds.has(d.admissionNo));
      
      const printWin = window.open('', '_blank');
      printWin.document.write(`
        <html>
        <head>
          <title>Batch Student Fee Due Notices</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #000; }
            .notice-page { page-break-after: always; break-after: page; border: 1.5px solid #0f172a; padding: 25px; border-radius: 12px; margin-bottom: 20px; }
            @media print { .notice-page { page-break-after: always; } }
          </style>
        </head>
        <body onload="window.print()">
          ${selectedList.map(s => `
            <div class="notice-page">
              <div style="border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px; display: flex; justify-content: space-between;">
                <div>
                  <h2 style="margin:0; font-size: 18px;">GARUMARA JATIYA VIDYALAYA</h2>
                  <p style="margin:0; font-size:10px;">Garumara, Nagaon, Assam | Phone: +91 98765 43210</p>
                </div>
                <div style="text-align: right; font-size:10px;">
                  <strong style="color:#d97706;">FEE DUE NOTICE</strong><br>
                  Date: ${new Date().toLocaleDateString('en-IN')}
                </div>
              </div>
              <p style="font-size: 11px;"><strong>Student Name:</strong> ${s.name} (${s.admissionNo}) | <strong>Class & Sec:</strong> ${s.className}-${s.section} | <strong>Father:</strong> ${s.fatherName} | <strong>Mobile:</strong> ${s.mobile}</p>
              <table style="width:100%; border-collapse:collapse; font-size:11px; margin: 15px 0;" border="1" cellpadding="6">
                <thead><tr style="background:#f1f5f9;"><th>Category</th><th>Month</th><th>Total Fee</th><th>Paid</th><th>Late Fine</th><th>Total Outstanding</th></tr></thead>
                <tbody><tr><td>${s.feeCategory}</td><td align="center">${s.dueMonth}</td><td align="right">₹${s.totalFee}</td><td align="right">₹${s.paidAmount}</td><td align="right">₹${s.lateFine}</td><td align="right"><strong>₹${s.totalOutstanding}</strong></td></tr></tbody>
              </table>
              <p style="font-size:10px;">Please clear the total outstanding amount at the school accounts desk.</p>
            </div>
          `).join('')}
        </body>
        </html>
      `);
      printWin.document.close();
    };
  }

  // Bulk Reminders
  const bulkRemindBtn = document.getElementById('swd-bulk-reminder-btn');
  if (bulkRemindBtn) {
    bulkRemindBtn.onclick = async () => {
      const targetList = swdState.selectedIds.size > 0
        ? swdState.allDues.filter(item => swdState.selectedIds.has(item.admissionNo))
        : swdState.filteredDues;
      if (!targetList.length) return alert('No due students are available for reminders.');
      if (!confirm(`Queue fee due SMS/WhatsApp reminders for ${targetList.length} students?`)) return;
      const originalText = bulkRemindBtn.innerHTML;
      bulkRemindBtn.disabled = true;
      bulkRemindBtn.textContent = 'Queuing reminders...';
      try {
        const result = await ApiService.sendFeeReminders(targetList.map(item => item.admissionNo), document.getElementById('swd-filter-month')?.value || '', 'due', (academicSessionsCache.find(row=>row.session_name===(document.getElementById('swd-filter-session')?.value||getSelectedFeeAcademicSession(true).name))||getSelectedFeeAcademicSession(true)).id);
        if(result.failed)throw new Error(result.error||`${result.failed} reminder(s) failed.`);alert(feeReminderResultMessage(result, 'Fee reminders'));
      } catch (error) {
        console.error('Bulk fee reminders failed:', error);
        alert(error.message || 'Bulk fee reminders failed.');
      } finally {
        bulkRemindBtn.disabled = false;
        bulkRemindBtn.innerHTML = originalText;
      }
    };
  }

  // Bulk Export CSV
  const bulkExportCsvBtn = document.getElementById('swd-bulk-export-csv-btn');
  if (bulkExportCsvBtn) {
    bulkExportCsvBtn.onclick = () => {
      const targetList = swdState.selectedIds.size > 0 
        ? swdState.allDues.filter(d => swdState.selectedIds.has(d.admissionNo))
        : swdState.filteredDues;

      if (!targetList.length) return alert('No due records available to export.');

      let csv = 'Student Name,Admission No,Class,Section,Father Name,Mobile,Session,Due Months,Pending Months,Overdue Months,Overdue Days,Fee Category,Total Fee,Paid Amount,Pending Amount,Late Fine,Total Overdue,Total Outstanding,Last Payment Date,Due Status\n';
      targetList.forEach(r => {
        csv += `"${r.name}","${r.admissionNo}","${r.className}","${r.section}","${r.fatherName}","${r.mobile}","${r.academicSession}","${(r.dueMonths || []).join('; ')}",${r.pendingMonths || 0},${r.overdueMonths || 0},${r.overdueDays || 0},"${r.feeCategory}",${r.totalFee},${r.paidAmount},${r.pendingAmount},${r.lateFee},${r.totalOverdue || 0},${r.totalOutstanding},"${r.lastPaymentDate}","${r.dueStatus}"\n`;
      });

      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Student_Wise_Due_List_${new Date().toISOString().substring(0, 10)}.csv`;
      a.click();
    };
  }

  // Bulk Download PDF / Print Report
  const bulkExportPdfBtn = document.getElementById('swd-bulk-export-pdf-btn');
  if (bulkExportPdfBtn) {
    bulkExportPdfBtn.onclick = () => {
      const targetList = swdState.selectedIds.size > 0 
        ? swdState.allDues.filter(d => swdState.selectedIds.has(d.admissionNo))
        : swdState.filteredDues;

      if (!targetList.length) return alert('No due records available for PDF.');

      const printWin = window.open('', '_blank');
      printWin.document.write(`
        <html>
        <head>
          <title>Student-wise Fee Due Report</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; font-size: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
            th { background: #0f172a; color: #fff; }
          </style>
        </head>
        <body onload="window.print()">
          <h2>GARUMARA JATIYA VIDYALAYA - STUDENT-WISE FEE DUE REPORT</h2>
          <p>Generated Date: ${new Date().toLocaleString('en-IN')} | Total Records: ${targetList.length}</p>
          <table>
            <thead>
              <tr>
                <th>#</th><th>Student Name</th><th>Adm No</th><th>Class</th><th>Father Name</th><th>Mobile</th><th>Due Months</th><th>Pending Months</th><th>Overdue Days</th><th>Category</th><th>Total Fee</th><th>Paid</th><th>Pending</th><th>Late Fine</th><th>Total Overdue</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${targetList.map((r, i) => `
                <tr>
                  <td>${i+1}</td><td><strong>${r.name}</strong></td><td>${r.admissionNo}</td><td>${r.className}-${r.section}</td><td>${r.fatherName}</td><td>${r.mobile}</td><td>${(r.dueMonths || []).join(', ')}</td><td>${r.pendingMonths || 0}</td><td>${r.overdueDays || 0}</td><td>${r.feeCategory}</td><td>₹${r.totalFee}</td><td>₹${r.paidAmount}</td><td>₹${r.pendingAmount}</td><td>₹${r.lateFine || 0}</td><td><strong>₹${r.totalOverdue || 0}</strong></td><td>${r.dueStatus}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
        </html>
      `);
      printWin.document.close();
    };
  }

  // Modal Close buttons
  const closeNoticeBtn = document.getElementById('swd-notice-modal-close');
  if (closeNoticeBtn) closeNoticeBtn.onclick = () => document.getElementById('swd-due-notice-modal')?.classList.add('hidden');

  const closeNoticeBtn2 = document.getElementById('swd-notice-modal-close-btn');
  if (closeNoticeBtn2) closeNoticeBtn2.onclick = () => document.getElementById('swd-due-notice-modal')?.classList.add('hidden');

  const printNoticeBtn = document.getElementById('swd-notice-modal-print-btn');
  if (printNoticeBtn) {
    printNoticeBtn.onclick = () => {
      const content = document.getElementById('swd-notice-render-box')?.innerHTML;
      if (!content) return;
      const win = window.open('', '_blank');
      win.document.write(`<html><head><meta charset="UTF-8"><script src="/js/icon-runtime.js" defer></script><title>Print Fee Notice</title></head><body onload="window.print()">${content}</body></html>`);
      win.document.close();
    };
  }
}

setTimeout(initSWDEvents, 500);

// SUBTAB 3: Class Fee Structure Configurator
async function loadFeeStructureConfigurator() {
  const tbody = document.getElementById('fee-structure-tbody');
  if (!tbody) return;

  const classes = ['LKG', 'UKG', 'Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Class VI', 'Class VII', 'Class VIII', 'Class IX', 'Class X'];

  try {
    const structureSession = document.getElementById('fee-structure-session')?.value || getCurrentAcademicSession();
    const existing = await ApiService.getFeeStructures(structureSession);

    tbody.innerHTML = classes.map(cls => {
      const s = existing[cls] || {};
      return `
        <tr class="border-b border-slate-100 dark:border-slate-800">
          <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${cls}</td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="admissionFee" value="${s.admissionFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="tuitionFee" value="${s.tuitionFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="examFee" value="${s.examFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="annualFee" value="${s.annualFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="developmentFee" value="${s.developmentFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="libraryFee" value="${s.libraryFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="computerFee" value="${s.computerFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
          <td class="px-4 py-3"><input type="number" data-class="${cls}" data-field="transportFee" value="${s.transportFee ?? ''}" class="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-mono"></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load fee structures:', err);
  }
}

const saveStructureBtn = document.getElementById('fee-save-structure-btn');
if (saveStructureBtn) {
  saveStructureBtn.onclick = async () => {
    const inputs = document.querySelectorAll('#fee-structure-tbody input');
    const structure = {};

    inputs.forEach(inp => {
      const cls = inp.getAttribute('data-class');
      const field = inp.getAttribute('data-field');
      if (!structure[cls]) structure[cls] = {};
      structure[cls][field] = Number(inp.value || 0);
    });

    try {
      saveStructureBtn.disabled = true;
      saveStructureBtn.innerText = 'Saving...';
      await ApiService.saveFeeStructures(structure, document.getElementById('fee-structure-session')?.value || getCurrentAcademicSession());
      alert('Class fee structures saved successfully!');
    } catch (err) {
      alert('Failed to save fee structures: ' + err.message);
    } finally {
      saveStructureBtn.disabled = false;
      saveStructureBtn.innerText = 'Save Fee Structure';
    }
  };
}

async function getFilteredFeeReportTransactions() {
  const startDate = document.getElementById('fee-rpt-start-date')?.value || '';
  const endDate = document.getElementById('fee-rpt-end-date')?.value || '';
  const mode = document.getElementById('fee-rpt-mode')?.value || '';
  const reportType = document.getElementById('fee-rpt-type')?.value || 'collections';
  const className = document.getElementById('fee-rpt-class')?.value || '';
  const search = (document.getElementById('fee-rpt-search')?.value || '').trim().toLowerCase();
  const reportSession = document.getElementById('fee-rpt-session')?.value || getCurrentAcademicSession();
  if (startDate && endDate && startDate > endDate) throw new Error('Report start date cannot be after the end date.');
  if (reportType === 'classwise' && !className) throw new Error('Select a class for the Class-wise Collection report.');
  if (reportType === 'student-ledger' && !search) throw new Error('Enter a student name, Student ID, or admission number for the Student Ledger report.');
  if (reportType === 'payment-mode' && !mode) throw new Error('Select a payment mode for the Payment Mode report.');
  if (reportType === 'overdue') {
    const dues = await ApiService.getStudentWiseDueList({ className, status: 'Overdue', session: reportSession });
    return (Array.isArray(dues) ? dues : []).filter(due => {
      const searchable = [due.admissionNo, due.studentId, due.name, due.mobile].join(' ').toLowerCase();
      return !search || searchable.includes(search);
    }).map(due => ({ id: due.legacyDueId || due.admissionNo, receiptNo: 'OVERDUE', date: new Date().toISOString(), studentId: due.admissionNo, studentName: due.name, className: due.className + '-' + due.section, type: due.feeCategory, month: (due.dueMonths || []).join('; '), paymentMode: due.dueStatus, amount: Number(due.totalOutstanding || 0), lateFee: Number(due.lateFine || 0), remarks: 'Pending months: ' + Number(due.pendingMonths || 0), isDueReport: true }));
  }
  const reportSessionRecord = academicSessionsCache.find(row => row.session_name === reportSession);
  if (!reportSessionRecord) throw new Error('Academic Session is required.');
  const allFees = await ApiService.getFees('', reportSessionRecord.session_name, reportSessionRecord.id);
  return (Array.isArray(allFees) ? allFees : []).filter(fee => {
    const date = String(fee.date || fee.created_at || '').slice(0, 10);
    if (startDate && date < startDate) return false; if (endDate && date > endDate) return false;
    if (mode && fee.paymentMode !== mode) return false; if (className && (fee.className || fee.class_id) !== className) return false;
    const searchable = [fee.receiptNo, fee.studentId, fee.student_id, fee.studentName].join(' ').toLowerCase(); if (search && !searchable.includes(search)) return false;
    if (['collections','daily','monthly','fine','discount','classwise','student-ledger','payment-mode'].includes(reportType) && fee.status === 'Refunded') return false;
    const today = new Date(); const localToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    if (reportType === 'daily' && date !== localToday) return false; if (reportType === 'monthly' && date.slice(0, 7) !== localToday.slice(0, 7)) return false;
    if (reportType === 'fine' && Number(fee.lateFee || 0) <= 0) return false; if (reportType === 'discount' && Number(fee.discountAmount || 0) + Number(fee.scholarshipAmount || 0) <= 0) return false;
    if (reportType === 'refund' && fee.status !== 'Refunded') return false; return true;
  });
}
// SUBTAB 4: Reports & Audit Log
async function loadFeeReportsAndAudit() {
  const tbody = document.getElementById('fee-reports-tbody');
  const auditTbody = document.getElementById('fee-audit-log-tbody');

  if (tbody) {
    try {
      const filtered = await getFilteredFeeReportTransactions();

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">No fee records found.</td></tr>`;
      } else {
        tbody.innerHTML = filtered.map(f => `
          <tr class="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
            <td class="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">${f.receiptNo}</td>
            <td class="px-4 py-3 text-slate-400">${new Date(f.date).toLocaleDateString('en-IN')}</td>
            <td class="px-4 py-3 font-bold">${f.studentName || f.studentId}</td>
            <td class="px-4 py-3">${f.className || 'N/A'}</td>
            <td class="px-4 py-3 font-semibold">${f.type}</td>
            <td class="px-4 py-3">${f.paymentMode}</td>
            <td class="px-4 py-3 font-mono font-bold text-emerald-600">₹${f.amount}</td>
            <td class="px-4 py-3 text-right space-x-2">
              ${f.isDueReport ? `<button onclick="collectFeeForStudent('${f.studentId}', '${String(f.month || '').split('; ')[0]}', ${Number(f.amount || 0)}, '${f.type}')" class="text-xs bg-amber-500 text-slate-900 px-2.5 py-1 rounded font-bold">Collect</button>` : `<button onclick="editFeeRecordPrompt('${f.id || f.receiptNo}')" class="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-250 px-2.5 py-1 rounded font-bold">Edit</button><button onclick="refundFeeRecordPrompt('${f.id || f.receiptNo}', '${f.receiptNo}')" class="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-950 dark:text-rose-400 px-2.5 py-1 rounded font-bold">Refund</button>`}
            </td>
          </tr>
        `).join('');
      }

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-rose-500 py-4">Failed to load reports: ${subjectHtmlEscape(err.message || 'Unknown error')}</td></tr>`;
    }
  }

  if (auditTbody) {
    try {
      const logs = await ApiService.getFeeAuditLog();
      if (logs.length === 0) {
        auditTbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">No admin refund or edit audit logs recorded.</td></tr>`;
      } else {
        auditTbody.innerHTML = logs.map(l => `
          <tr>
            <td class="px-3 py-2 text-slate-400">${new Date(l.timestamp).toLocaleString('en-IN')}</td>
            <td class="px-3 py-2 font-bold text-amber-500">${l.action}</td>
            <td class="px-3 py-2 font-bold">${l.receiptNo}</td>
            <td class="px-3 py-2">${l.studentId}</td>
            <td class="px-3 py-2">₹${l.amount || l.newAmount || 0}</td>
            <td class="px-3 py-2">${l.adminUser}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      auditTbody.innerHTML = `<tr><td colspan="6" class="text-center text-rose-500 py-2">Audit log unavailable.</td></tr>`;
    }
  }
}

// Bind Filter Reports Button
const filterReportsBtn = document.getElementById('fee-filter-reports-btn');
if (filterReportsBtn) {
  filterReportsBtn.onclick = loadFeeReportsAndAudit;
}

// Export Reports to Excel (CSV)
const exportExcelBtn = document.getElementById('fee-export-excel-btn');
if (exportExcelBtn) {
  exportExcelBtn.onclick = async () => {
    try {
      const allFees = await getFilteredFeeReportTransactions();
      if (allFees.length === 0) return alert('No fee transactions match the applied report filters.');

      let csv = 'Receipt No,Date,Student ID,Student Name,Class,Fee Head,Billing Month,Payment Mode,Amount,Late Fine,Remarks\n';

      allFees.forEach(f => {
        const d = new Date(f.date).toLocaleDateString('en-IN');
        csv += `"${f.receiptNo}","${d}","${f.studentId}","${f.studentName || ''}","${f.className || ''}","${f.type}","${f.month}","${f.paymentMode}","${f.amount}","${f.lateFee || 0}","${(f.remarks || '').replace(/"/g, '""')}"\n`;
      });

      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `Fee_Collection_Report_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (err) {
      alert('Excel export failed: ' + err.message);
    }
  };
}

// Export Reports to PDF
const exportPdfBtn = document.getElementById('fee-export-pdf-btn');
if (exportPdfBtn) {
  exportPdfBtn.onclick = async () => {
    try {
      const allFees = await getFilteredFeeReportTransactions();
      if (allFees.length === 0) return alert('No fee transactions match the applied report filters.');

      const element = document.createElement('div');
      element.style.padding = '10mm';
      element.style.background = 'white';
      element.style.width = '210mm';
      element.innerHTML = `
        <div style="font-family:sans-serif; color:#0f172a;" class="space-y-4">
          <div style="border-bottom:2px solid #0f172a; padding-bottom:8px;" class="flex justify-between items-center">
            <div>
              <h2 style="font-size:18px; font-weight:900; margin:0; text-transform:uppercase;">Garumara Jatiya Vidyalaya</h2>
              <p style="font-size:10px; color:#64748b;">Fee Collection Summary Ledger Report - Generated ${new Date().toLocaleDateString('en-IN')}</p>
            </div>
            <span style="font-size:11px; font-weight:bold;">Total Records: ${allFees.length}</span>
          </div>

          <table style="width:100%; border-collapse:collapse; font-size:10px;">
            <thead>
              <tr style="background:#0f172a; color:white;">
                <th style="padding:6px; text-align:left;">Receipt No</th>
                <th style="padding:6px; text-align:left;">Date</th>
                <th style="padding:6px; text-align:left;">Student Name</th>
                <th style="padding:6px; text-align:left;">Class</th>
                <th style="padding:6px; text-align:left;">Fee Head</th>
                <th style="padding:6px; text-align:left;">Mode</th>
                <th style="padding:6px; text-align:right;">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${allFees.map(f => `
                <tr style="border-bottom:1px solid #e2e8f0;">
                  <td style="padding:6px; font-family:monospace; font-weight:bold;">${f.receiptNo}</td>
                  <td style="padding:6px;">${new Date(f.date).toLocaleDateString('en-IN')}</td>
                  <td style="padding:6px; font-weight:bold;">${f.studentName || f.studentId}</td>
                  <td style="padding:6px;">${f.className || ''}</td>
                  <td style="padding:6px;">${f.type}</td>
                  <td style="padding:6px;">${f.paymentMode}</td>
                  <td style="padding:6px; text-align:right; font-family:monospace; font-weight:bold;">₹${f.amount}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      const opt = {
        margin:       0,
        filename:     `Fee_Collection_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, dpi: 300 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(element).save();

    } catch (err) {
      alert('PDF report export failed: ' + err.message);
    }
  };
}

// Edit Fee Prompt (Admin Only)
window.editFeeRecordPrompt = async function(feeId) {
  const newAmount = prompt('Enter updated payment amount (₹):');
  if (!newAmount || isNaN(newAmount)) return;

  const newRemarks = prompt('Enter edit reason / remarks:') || 'Admin Updated';

  try {
    await ApiService.updateFee({ id: feeId, amount: Number(newAmount), remarks: newRemarks });
    clearFeeReceiptCache();
    alert('Fee record updated successfully!');
    await loadFeeDashboardMetrics();
    if (state.selectedStudentForFee) {
      await refreshSelectedStudentFeeProfile();
      await loadStudentLedger(state.selectedStudentForFee.admissionNo);
    }
    loadFeeReportsAndAudit();
    loadFeeDueList();
    loadStudentWiseDueList();
    loadDashboard();
  } catch (err) {
    alert('Failed to update fee record: ' + err.message);
  }
};

// Refund / Delete Fee Prompt (Admin Only)
window.refundFeeRecordPrompt = async function(feeId, receiptNo) {
  if (!confirm(`Refund receipt ${receiptNo}? The original receipt and a permanent audit record will be preserved.`)) return;
  const reason = prompt('Enter the refund reason (required):');
  if (!reason || reason.trim().length < 3) return alert('A refund reason of at least 3 characters is required.');
  try {
    await ApiService.refundFee(feeId, receiptNo, reason.trim());
    clearFeeReceiptCache();
    alert(`Receipt ${receiptNo} refunded successfully.`);
    await loadFeeDashboardMetrics();
    if (state.selectedStudentForFee) {
      await refreshSelectedStudentFeeProfile();
      await loadStudentLedger(state.selectedStudentForFee.admissionNo || state.selectedStudentForFee.studentId || state.selectedStudentForFee.id);
    }
    await Promise.allSettled([loadFeeReportsAndAudit(), loadFeeDueList(), loadStudentWiseDueList(), typeof loadDashboard === 'function' ? loadDashboard() : Promise.resolve()]);
  } catch (error) {
    console.error('Fee refund failed:', error);
    alert(`Fee refund failed: ${error.message}`);
  }
};


// ================= 6. EXAM & RESULT MANAGEMENT =================
let examState = {
  activeStudents: [],
  existingExam: null,
  subjectInfo: null,
  allExams: []
};

// Bind Subtab Navigation Globally
function bindExamSubtabs() {
  const buttons = [
    { btnId: 'exm-subtab-btn-scores', contentId: 'exm-subtab-scores', action: null },
    { btnId: 'exm-subtab-btn-history', contentId: 'exm-subtab-history', action: loadExamHistory },
    { btnId: 'exm-subtab-btn-subjects', contentId: 'exm-subtab-subjects', action: loadSubjectsList }
  ];

  buttons.forEach(t => {
    const btn = document.getElementById(t.btnId);
    if (!btn) return;
    btn.onclick = (e) => {
      if (e) e.preventDefault();
      buttons.forEach(other => {
        const b = document.getElementById(other.btnId);
        const c = document.getElementById(other.contentId);
        if (b) {
          b.classList.remove('border-amber-500', 'text-slate-900', 'dark:text-white', 'font-extrabold');
          b.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        }
        if (c) c.classList.add('hidden');
      });

      btn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
      btn.classList.add('border-amber-500', 'text-slate-900', 'dark:text-white', 'font-extrabold');
      const activeContent = document.getElementById(t.contentId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (t.action) t.action();
    };
  });
}

// Grade calculation helper
function calculateGrade(marks, maxMarks, isAbsent = false) {
  if (isAbsent) return 'ABSENT';
  if (marks === '' || marks === null || isNaN(marks)) return '-';
  const pct = maxMarks > 0 ? (Number(marks) / Number(maxMarks)) * 100 : 0;
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 33) return 'D';
  return 'F';
}

// Result Status Badge calculation helper
function calculateResultStatus(marks, passMarks, isAbsent = false) {
  if (isAbsent) return { label: 'ABSENT', color: 'bg-slate-500/10 text-slate-400 border-slate-500/30' };
  if (marks === '' || marks === null || isNaN(marks)) return { label: 'PENDING', color: 'bg-slate-500/10 text-slate-400 border-slate-500/30' };
  const m = Number(marks);
  const p = Number(passMarks || 33);
  if (m >= p) return { label: 'PASS', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 font-black' };
  return { label: 'FAIL', color: 'bg-rose-500/10 text-rose-500 border-rose-500/30 font-black' };
}

// Dynamic Subject Dropdown Populator with Class, Section, Exam Term, and Session Filtering
let cachedScoreSheetSubjects = [];

function normalizeSubjectClass(value) {
  const text = String(value || '').replace(/\|\|.*$/g, '').trim();
  if (/^all(?:\s+classes?)?$/i.test(text)) return 'all';
  if (/^(lkg|ukg)$/i.test(text)) return text.toLowerCase();
  return text.replace(/^class\s+/i, '').trim().toLowerCase();
}

function normalizeSubjectSection(value) {
  const text = String(value || '').replace(/\|\|/g, ' ').trim();
  if (!text || /^all(?:\s+sections?)?$/i.test(text)) return 'all';
  return text.replace(/^sections?\s*/i, '').replace(/^sec(?:tion)?\s*/i, '').trim().toLowerCase();
}

function normalizeSubjectExam(value) {
  const text = String(value || '')
    .replace(/[-–—_]+/g, ' ')
    .replace(/\bexams?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return !text || text === 'all' ? 'all' : text;
}

function selectedScoreSheetSubject() {
  const select = document.getElementById('exm-filter-subject');
  const option = select?.selectedOptions?.[0];
  const subjectId = select?.value || '';
  const subject = cachedScoreSheetSubjects.find(item => item.id === subjectId);
  if (subject) return subject;
  return option?.dataset?.subjectName
    ? { id: subjectId, name: option.dataset.subjectName }
    : null;
}

async function populateDynamicSubjectDropdowns(subjectsOverride = null) {
  const exmSubjSelect = document.getElementById('exm-filter-subject');
  const histSubjSelect = document.getElementById('exm-hist-subject');
  if (!exmSubjSelect) return;

  const className = document.getElementById('exm-filter-class')?.value || '';
  const section = document.getElementById('exm-filter-section')?.value || '';
  const examType = document.getElementById('exm-filter-name')?.value || '';
  const session = document.getElementById('exm-filter-session')?.value || '';

  try {
    const providedSubjects = Array.isArray(subjectsOverride) ? subjectsOverride : null;
    const previousSubjectId = exmSubjSelect.value;
    const allSubjects = providedSubjects || await ApiService.getSubjects({
      className,
      section,
      examType,
      session
    });
    const subjects = providedSubjects
      ? allSubjects.filter(subject => {
          const classKey = normalizeSubjectClass(subject.className);
          const sectionKey = normalizeSubjectSection(subject.section);
          const examKey = normalizeSubjectExam(subject.examType);
          return (classKey === 'all' || classKey === normalizeSubjectClass(className)) &&
            (sectionKey === 'all' || sectionKey === normalizeSubjectSection(section)) &&
            (examKey === 'all' || examKey === normalizeSubjectExam(examType)) &&
            String(subject.session || session) === String(session);
        })
      : allSubjects;
    cachedScoreSheetSubjects = subjects;
    if (!subjects || !subjects.length) {
      exmSubjSelect.innerHTML = '<option value="">No subject assigned for the selected class, section, exam and session.</option>';
      if (histSubjSelect) histSubjSelect.innerHTML = '<option value="">All Subjects</option>';
      return;
    }
    const uniqueSubjects = subjects.filter((subject, index, list) =>
      list.findIndex(item => item.id === subject.id) === index
    );
    exmSubjSelect.innerHTML = uniqueSubjects.map(subject =>
      `<option value="${subjectHtmlEscape(subject.id)}" data-subject-name="${subjectHtmlEscape(subject.name)}">${subjectHtmlEscape(subject.name)}</option>`
    ).join('');
    if (uniqueSubjects.some(subject => subject.id === previousSubjectId)) {
      exmSubjSelect.value = previousSubjectId;
    }

    if (histSubjSelect) {
      const historySource = providedSubjects || await ApiService.getSubjects();
      const allUnique = [...new Set(historySource.map(s => s.name))];
      histSubjSelect.innerHTML = '<option value="">All Subjects</option>' + allUnique.map(name => `<option value="${subjectHtmlEscape(name)}">${subjectHtmlEscape(name)}</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to populate dynamic subjects dropdown:', err);
    exmSubjSelect.innerHTML = `<option value="">Unable to load subjects: ${subjectHtmlEscape(err.message || 'Unknown server error')}</option>`;
  }
}

// Filter listeners for Score Sheet Toolbar
document.getElementById('exm-filter-class')?.addEventListener('change', populateDynamicSubjectDropdowns);
document.getElementById('exm-filter-section')?.addEventListener('change', populateDynamicSubjectDropdowns);
document.getElementById('exm-filter-name')?.addEventListener('change', populateDynamicSubjectDropdowns);
document.getElementById('exm-filter-session')?.addEventListener('change', populateDynamicSubjectDropdowns);

// Load Subjects Table List (Manage Subjects Subtab)
let cachedSubjects = [];

function subjectHtmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function loadSubjectsList() {
  const tbody = document.getElementById('subjects-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">Loading subjects master...</td></tr>`;

  try {
    const className = document.getElementById('sbj-filter-class')?.value || '';
    const examType = document.getElementById('sbj-filter-exam')?.value || '';
    const session = document.getElementById('sbj-filter-session')?.value || '';
    const search = (document.getElementById('sbj-search-input')?.value || '').toLowerCase().trim();

    let subjects = await ApiService.getSubjects({ className, examType, session });
    cachedSubjects = await ApiService.getSubjects();

    if (search) {
      subjects = subjects.filter(s => 
        (s.name || '').toLowerCase().includes(search) || 
        (s.code || '').toLowerCase().includes(search) ||
        (s.teacherName || '').toLowerCase().includes(search)
      );
    }

    if (!subjects || !subjects.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400 font-semibold">No subject found. Please add a subject.</td></tr>`;
      return;
    }

    tbody.innerHTML = subjects.map(s => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800/60 transition-colors">
        <td class="px-4 py-3 font-mono font-bold text-amber-500">${subjectHtmlEscape(s.code || '-')}</td>
        <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${subjectHtmlEscape(s.name)}</td>
        <td class="px-4 py-3">
          <span class="bg-blue-500/10 text-blue-500 font-bold px-2 py-0.5 rounded text-[11px]">${subjectHtmlEscape(s.className || 'All Classes')}</span>
          ${s.section && s.section !== 'All Sections' ? `<span class="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[10px] ml-1">Sec ${subjectHtmlEscape(s.section)}</span>` : ''}
        </td>
        <td class="px-4 py-3"><span class="bg-purple-500/10 text-purple-400 font-bold px-2 py-0.5 rounded text-[11px]">${subjectHtmlEscape(s.examType || 'All Exams')}</span></td>
        <td class="px-4 py-3 font-mono">${subjectHtmlEscape(s.session || getCurrentAcademicSession())}</td>
        <td class="px-4 py-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">${subjectHtmlEscape(s.maxMarks ?? 100)} / <span class="text-amber-500">${subjectHtmlEscape(s.passMarks ?? 33)}</span></td>
        <td class="px-4 py-3">
          <span class="font-semibold ${s.teacherName === 'Unassigned' ? 'text-slate-400' : 'text-emerald-400'}">${subjectHtmlEscape(s.teacherName || 'Unassigned')}</span>
        </td>
        <td class="px-4 py-3 text-right space-x-2">
          <button type="button" data-subject-action="edit" data-subject-id="${subjectHtmlEscape(s.id)}" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-500 font-bold px-3 py-1.5 rounded-xl text-xs transition-colors">✏️ Edit</button>
          <button type="button" data-subject-action="delete" data-subject-id="${subjectHtmlEscape(s.id)}" data-subject-name="${subjectHtmlEscape(s.name)}" class="bg-red-500/10 hover:bg-red-500 hover:text-white text-red-500 font-bold px-3 py-1.5 rounded-xl text-xs transition-colors">🗑️ Delete</button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-rose-500 font-semibold">Failed to load subjects list.</td></tr>`;
  }
}

// Subject Modal Controllers
window.openSubjectModal = async function(subject = null) {
  const modal = document.getElementById('subject-modal');
  if (!modal) return;

  const titleEl = document.getElementById('subject-modal-title');
  const teacherSelect = document.getElementById('sbj-teacher');
  const selectedTeacherId = subject?.teacherId || 'Unassigned';

  if (subject) {
    if (titleEl) titleEl.innerText = 'Edit Subject Details';
    document.getElementById('sbj-edit-id').value = subject.id;
    document.getElementById('sbj-name').value = subject.name || '';
    document.getElementById('sbj-code').value = subject.code || '';
    document.getElementById('sbj-class').value = subject.className || 'All Classes';
    document.getElementById('sbj-section').value = subject.section || 'All Sections';
    document.getElementById('sbj-exam-type').value = subject.examType || 'All Exams';
    document.getElementById('sbj-session').value = subject.session || getCurrentAcademicSession();
    document.getElementById('sbj-max-marks').value = subject.maxMarks ?? 100;
    document.getElementById('sbj-pass-marks').value = subject.passMarks ?? 33;
  } else {
    if (titleEl) titleEl.innerText = 'Add New Subject';
    document.getElementById('sbj-edit-id').value = '';
    document.getElementById('sbj-name').value = '';
    document.getElementById('sbj-code').value = '';
    document.getElementById('sbj-class').value = 'All Classes';
    document.getElementById('sbj-section').value = 'All Sections';
    document.getElementById('sbj-exam-type').value = 'All Exams';
    document.getElementById('sbj-session').value = getCurrentAcademicSession();
    document.getElementById('sbj-max-marks').value = 100;
    document.getElementById('sbj-pass-marks').value = 33;
  }

  if (teacherSelect) {
    teacherSelect.disabled = true;
    teacherSelect.innerHTML = '<option value="">Loading teachers...</option>';
  }
  modal.classList.remove('hidden');
  document.getElementById('sbj-name')?.focus();

  try {
    const teachers = await ApiService.getTeachers();
    if (teacherSelect) {
      teacherSelect.innerHTML = '<option value="Unassigned">Unassigned</option>' + (teachers || []).map(t => 
        `<option value="${subjectHtmlEscape(t.empId)}">${subjectHtmlEscape(t.name)} (${subjectHtmlEscape(t.empId)})</option>`
      ).join('');
      teacherSelect.value = selectedTeacherId;
      if (!teacherSelect.value && selectedTeacherId !== 'Unassigned') {
        const retainedTeacher = document.createElement('option');
        retainedTeacher.value = selectedTeacherId;
        retainedTeacher.textContent = `${subject?.teacherName || 'Previously assigned teacher'} (${selectedTeacherId})`;
        retainedTeacher.selected = true;
        teacherSelect.appendChild(retainedTeacher);
      }
    }
  } catch (e) {
    if (teacherSelect) {
      teacherSelect.innerHTML = selectedTeacherId === 'Unassigned'
        ? '<option value="Unassigned">Unassigned</option>'
        : `<option value="${subjectHtmlEscape(selectedTeacherId)}">${subjectHtmlEscape(subject?.teacherName || 'Previously assigned teacher')} (${subjectHtmlEscape(selectedTeacherId)})</option>`;
    }
    alert('⊠️ Teacher list could not be loaded. Existing assignment has been preserved.');
  } finally {
    if (teacherSelect) teacherSelect.disabled = false;
  }
};

window.closeSubjectModal = function() {
  const modal = document.getElementById('subject-modal');
  if (modal) modal.classList.add('hidden');
};

window.openEditSubjectModal = async function(id) {
  try {
    const target = cachedSubjects.find(subject => subject.id === id) || await ApiService.getSubject(id);
    await window.openSubjectModal(target);
  } catch (err) {
    alert('Failed to fetch subject details: ' + err.message);
  }
};

async function synchronizeSubjectConsumers() {
  const subjects = await ApiService.getSubjects();
  cachedSubjects = subjects;
  await populateDynamicSubjectDropdowns(subjects);

  const assignmentSelect = document.getElementById('tch-asn-subject');
  if (assignmentSelect) {
    const selected = assignmentSelect.value;
    const uniqueNames = [...new Set(subjects.map(subject => subject.name).filter(Boolean))];
    assignmentSelect.innerHTML = uniqueNames.length
      ? uniqueNames.map(name => `<option value="${subjectHtmlEscape(name)}">${subjectHtmlEscape(name)}</option>`).join('')
      : '<option value="">No subject found. Please add a subject.</option>';
    if (uniqueNames.includes(selected)) assignmentSelect.value = selected;
  }

  localStorage.setItem('gjv_subjects_updated_at', String(Date.now()));
  window.dispatchEvent(new CustomEvent('gjv:subjects-updated', { detail: { subjects } }));
}

window.confirmDeleteSubject = async function(id, name) {
  if (confirm(`Are you sure you want to delete subject "${name}"?\nThis cannot be undone.`)) {
    try {
      await ApiService.deleteSubject(id);
      await loadSubjectsList();
      await synchronizeSubjectConsumers();
      alert(`✅ Subject "${name}" deleted successfully.`);
    } catch (err) {
      alert('❌ Delete failed: ' + err.message);
    }
  }
};

window.handleSubjectFormSubmit = async function(e) {
  if (e) e.preventDefault();

  const editId = document.getElementById('sbj-edit-id')?.value;
  const form = document.getElementById('subject-form');
  if (form && !form.reportValidity()) return;

  const name = document.getElementById('sbj-name')?.value?.trim() || '';
  const code = document.getElementById('sbj-code')?.value?.trim() || '';
  const className = document.getElementById('sbj-class')?.value;
  const section = document.getElementById('sbj-section')?.value;
  const examType = document.getElementById('sbj-exam-type')?.value;
  const session = document.getElementById('sbj-session')?.value;
  const maxMarks = Number(document.getElementById('sbj-max-marks')?.value || 100);
  const passMarks = Number(document.getElementById('sbj-pass-marks')?.value || 33);
  const teacherId = document.getElementById('sbj-teacher')?.value || 'Unassigned';

  if (!name || !code || !className || !section || !examType || !session) {
    return alert('⊠️ Please complete all required subject fields.');
  }
  if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
    return alert('⊠️ Maximum Marks must be greater than zero.');
  }
  if (!Number.isFinite(passMarks) || passMarks < 0 || passMarks > maxMarks) {
    return alert('⊠️ Pass Marks must be between 0 and Maximum Marks.');
  }

  try {
    const subjects = cachedSubjects.length ? cachedSubjects : await ApiService.getSubjects();
    const otherSubjects = subjects.filter(subject => subject.id !== editId);
    const normalize = value => String(value || '').trim().toLowerCase();
    if (otherSubjects.some(subject => normalize(subject.code) === normalize(code))) {
      return alert(`❌ Subject Code "${code}" already exists.`);
    }
    if (otherSubjects.some(subject =>
      normalize(subject.name) === normalize(name) &&
      normalize(subject.className) === normalize(className) &&
      normalize(subject.section) === normalize(section) &&
      normalize(subject.examType) === normalize(examType) &&
      normalize(subject.session) === normalize(session)
    )) {
      return alert(`❌ Subject "${name}" already exists for the selected Class, Section, Exam Type, and Academic Session.`);
    }
  } catch (err) {
    return alert('❌ Unable to validate subject details: ' + err.message);
  }

  const saveBtn = document.getElementById('sbj-modal-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = '💾 Saving...'; }

  const payload = { name, code, className, section, examType, session, maxMarks, passMarks, teacherId };

  try {
    if (editId) {
      await ApiService.updateSubject(editId, payload);
    } else {
      await ApiService.createSubject(payload);
    }

    window.closeSubjectModal();
    await loadSubjectsList();
    await synchronizeSubjectConsumers();
    alert(editId
      ? `✅ Subject "${name}" updated successfully!`
      : `✅ Subject "${name}" added successfully!`);

  } catch (err) {
    alert('❌ Error: ' + (err.message || 'Failed to save subject'));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = '💾 Save Subject'; }
  }
};

function bindSubjectManagementEvents() {
  const addButton = document.getElementById('add-subject-btn');
  const closeButton = document.getElementById('subject-modal-close');
  const cancelButton = document.getElementById('sbj-modal-cancel');
  const form = document.getElementById('subject-form');
  const tableBody = document.getElementById('subjects-tbody');
  const modal = document.getElementById('subject-modal');

  addButton?.addEventListener('click', () => window.openSubjectModal());
  closeButton?.addEventListener('click', window.closeSubjectModal);
  cancelButton?.addEventListener('click', window.closeSubjectModal);
  form?.addEventListener('submit', window.handleSubjectFormSubmit);
  modal?.addEventListener('click', event => {
    if (event.target === modal) window.closeSubjectModal();
  });
  tableBody?.addEventListener('click', event => {
    const button = event.target.closest('[data-subject-action]');
    if (!button) return;
    if (button.dataset.subjectAction === 'edit') {
      window.openEditSubjectModal(button.dataset.subjectId);
    } else if (button.dataset.subjectAction === 'delete') {
      window.confirmDeleteSubject(button.dataset.subjectId, button.dataset.subjectName || 'this subject');
    }
  });

  document.getElementById('sbj-filter-class')?.addEventListener('change', loadSubjectsList);
  document.getElementById('sbj-filter-exam')?.addEventListener('change', loadSubjectsList);
  document.getElementById('sbj-filter-session')?.addEventListener('change', loadSubjectsList);
  document.getElementById('sbj-search-input')?.addEventListener('input', loadSubjectsList);
}

bindSubjectManagementEvents();

function loadExamsTab() {
  document.getElementById('exm-filter-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('exam-sheet-box').classList.add('hidden');
  bindExamSubtabs();
  populateDynamicSubjectDropdowns();
}

// Load Score Sheet
const loadExamBtn = document.getElementById('load-exam-sheet-btn');
if (loadExamBtn) {
  loadExamBtn.addEventListener('click', async () => {
    const examName = document.getElementById('exm-filter-name').value;
    const className = document.getElementById('exm-filter-class').value;
    const section = document.getElementById('exm-filter-section').value;
    const selectedSubject = selectedScoreSheetSubject();
    const subjectName = selectedSubject?.name || '';
    const session = document.getElementById('exm-filter-session').value;
    const date = document.getElementById('exm-filter-date').value;

    if (!date) return alert('⊠️ Please select an exam date.');
    if (!subjectName) return alert('⊠️ No subject assigned for the selected class, section, exam and session.');

    const tbody = document.getElementById('exam-tbody');
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400">Loading student roster and subject master...</td></tr>`;
    document.getElementById('exam-sheet-box').classList.remove('hidden');
    updateExamSummaryCards();

    try {
      // 1. Fetch Subject Master details (Pass Marks, Max Marks)
      const allSubjects = await ApiService.getSubjects();
      const targetSubj = allSubjects.find(s => s.id === selectedSubject.id) ||
        allSubjects.find(s => (s.name || '').toLowerCase() === subjectName.toLowerCase());
      const defaultMaxMarks = targetSubj ? Number(targetSubj.maxMarks || 100) : 100;
      const defaultPassMarks = targetSubj ? Number(targetSubj.passMarks || 33) : 33;
      examState.subjectInfo = { maxMarks: defaultMaxMarks, passMarks: defaultPassMarks };

      // 2. Fetch Students for Class & Section
      const rawStudents = await ApiService.getStudents();
      const allStudents = Array.isArray(rawStudents) ? rawStudents : (rawStudents?.students || rawStudents?.data || []);
      const normClass = className.replace(/^Class\s+/i, '').trim().toLowerCase();
      const normalizedSession = String(session || '').replace(/\//g, '-').replace(/\s+/g, '');
      const classStudents = allStudents
        .filter(s => {
          if (!s) return false;
          const sClass = (s.className || s.class_name || s.class || '').replace(/^Class\s+/i, '').trim().toLowerCase();
          const sSec = String(s.section || s.section_name || s.sec || 'A').replace(/^section\s+/i, '').trim().toUpperCase();
          const requestedSection = String(section || '').replace(/^section\s+/i, '').trim().toUpperCase();
          const studentSession = String(s.academicSession || s.academic_session || s.session || session || '').replace(/\//g, '-').replace(/\s+/g, '');
          const studentStatus = String(s.status || s.student_status || 'Active').trim().toLowerCase();
          const matchCls = sClass === normClass || s.className === className;
          const matchSec = (requestedSection === 'ALL' || requestedSection === 'ALL SECTIONS' || !requestedSection || sSec === requestedSection);
          return matchCls && matchSec && studentStatus === 'active' && studentSession === normalizedSession;
        })
        .sort((a, b) => Number(a.rollNo || a.roll_number || 0) - Number(b.rollNo || b.roll_number || 0));

      if (classStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-slate-400 font-semibold">No students found for the selected class and section.</td></tr>`;
        document.getElementById('exam-summary-count').innerText = "0 Students listed.";
        updateExamSummaryCards();
        return;
      }

      examState.activeStudents = classStudents;

      // 3. Fetch saved marks from the central per-student result source.
      const savedResults = await ApiService.getExamResults({
        examName,
        className,
        section,
        subjectId: selectedSubject.id,
        session
      });
      const resultRows = Array.isArray(savedResults) ? savedResults : [];
      examState.existingExam = resultRows.length ? {
        name: examName,
        examName,
        className,
        section,
        subject_id: selectedSubject.id,
        subject: subjectName,
        session,
        status: resultRows.some(row => row.status === 'Submitted') ? 'Submitted' : 'Draft',
        marks: resultRows
      } : null;

      const scoresMap = resultRows.reduce((acc, m) => {
        const sKey = m.student_id || m.studentId || m.admission_number || m.admissionNo || m.id;
        if (sKey) acc[sKey] = m;
        return acc;
      }, {});

      window.renderScoreSheetTableRows(classStudents, scoresMap, defaultMaxMarks, defaultPassMarks);
      updateExamSummaryCards();

    } catch (err) {
      console.error('Failed to load score sheet:', err);
      alert('❌ Failed to load score sheet: ' + err.message);
    }
  });
}

// Render Score Sheet Table Rows (Global function with fallbacks and error handling)
window.renderScoreSheetTableRows = function(students, scoresMap = {}, defaultMax = 100, defaultPass = 33) {
  const tbody = document.getElementById('exam-tbody');
  if (!tbody) return;

  // Clear old table contents first
  tbody.innerHTML = '';

  // Normalize input response format (students, data.students, result.students, response.data)
  let studentList = students;
  if (students && !Array.isArray(students)) {
    if (Array.isArray(students.students)) studentList = students.students;
    else if (Array.isArray(students.data)) studentList = students.data;
    else if (students.data && Array.isArray(students.data.students)) studentList = students.data.students;
    else if (Array.isArray(students.result)) studentList = students.result;
    else if (students.result && Array.isArray(students.result.students)) studentList = students.result.students;
  }

  if (!Array.isArray(studentList) || studentList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-slate-400 font-semibold">No students found for the selected class and section.</td></tr>`;
    const countEl = document.getElementById('exam-summary-count');
    if (countEl) countEl.innerText = "0 Students listed.";
    return;
  }

  try {
    const rowsHtml = studentList.map(s => {
      if (!s) return '';

      // Fallback property mapping for null/undefined fields
      const admissionNo = s.admissionNo || s.admission_number || s.admission_no || s.studentId || s.id || '-';
      const rollNo = s.rollNo || s.roll_number || s.roll_no || s.roll || '-';
      const name = s.name || s.student_name || s.studentName || s.fullName || 'Unknown Student';

      const saved = (scoresMap && (scoresMap[admissionNo] || scoresMap[s.id])) || {};
      const isAbsent = Boolean(saved.isAbsent || saved.attendance_status === 'Absent' || saved.status === 'Absent' || saved.result_status === 'ABSENT' || saved.resultStatus === 'ABSENT');
      
      const savedMarks = saved.marks_obtained ?? saved.marksObtained ?? saved.score;
      const scoreVal = isAbsent ? '' : (savedMarks !== undefined && savedMarks !== null ? savedMarks : '');
      const maxMarks = saved.maximum_marks || saved.maxMarks || saved.maxScore || s.max_marks || s.maxMarks || defaultMax || 100;
      const passMarks = saved.pass_marks || saved.passMarks || saved.passScore || s.pass_marks || s.passMarks || defaultPass || 33;
      const remark = saved.remark || saved.remarks || '';

      const grade = calculateGrade(scoreVal, maxMarks, isAbsent);
      const resStatus = calculateResultStatus(scoreVal, passMarks, isAbsent);

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-slate-100 dark:border-slate-800 transition-colors exm-row" data-student-id="${admissionNo}" data-name="${name.toLowerCase()}">
          <td class="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">${rollNo}</td>
          <td class="px-4 py-3 font-mono text-amber-500 font-bold">${admissionNo}</td>
          <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${name}</td>
          <td class="px-4 py-3 text-center">
            <label class="inline-flex items-center space-x-1 cursor-pointer">
              <input type="checkbox" id="exm-absent-${admissionNo}" ${isAbsent ? 'checked' : ''} onchange="toggleStudentAbsent('${admissionNo}')" class="rounded text-rose-500 focus:ring-rose-500">
              <span class="text-[11px] font-bold ${isAbsent ? 'text-rose-500' : 'text-slate-400'}">Absent</span>
            </label>
          </td>
          <td class="px-4 py-3">
            <input type="number" id="exm-score-${admissionNo}" ${isAbsent ? 'disabled' : ''} min="0" max="${maxMarks}" placeholder="Marks" value="${scoreVal}" oninput="recalculateStudentRow('${admissionNo}')" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 w-24 text-center text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 disabled:opacity-50">
          </td>
          <td class="px-4 py-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
            <span id="exm-max-${admissionNo}">${maxMarks}</span>
          </td>
          <td class="px-4 py-3 text-center font-mono font-bold text-amber-500">
            <span id="exm-pass-${admissionNo}">${passMarks}</span>
          </td>
          <td class="px-4 py-3 text-center font-bold">
            <span id="exm-grade-${admissionNo}" class="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">${grade}</span>
          </td>
          <td class="px-4 py-3 text-center">
            <span id="exm-status-${admissionNo}" class="px-2.5 py-1 rounded-xl text-[10px] font-black border uppercase ${resStatus.color}">${resStatus.label}</span>
          </td>
          <td class="px-4 py-3">
            <input type="text" id="exm-remark-${admissionNo}" value="${remark}" placeholder="Notes..." class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 font-medium">
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    const searchInput = document.getElementById('exm-search-input');
    if (searchInput) searchInput.oninput = filterExamRosterRows;
    const countEl = document.getElementById('exam-summary-count');
    if (countEl) countEl.innerText = `${studentList.length} Students listed.`;

  } catch (err) {
    console.error('Error rendering score sheet table rows:', err);
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-rose-500">Failed to render student score sheet. Check console for details.</td></tr>`;
  }
};

function filterExamRosterRows() {
  const term = (document.getElementById('exm-search-input')?.value || '').trim().toLowerCase();
  const rows = [...document.querySelectorAll('#exam-tbody .exm-row')];
  let visible = 0;
  rows.forEach(row => {
    const searchable = `${row.dataset.studentId || ''} ${row.dataset.name || ''}`.toLowerCase();
    const show = !term || searchable.includes(term);
    row.classList.toggle('hidden', !show);
    if (show) visible++;
  });
  const countEl = document.getElementById('exam-summary-count');
  if (countEl) countEl.innerText = `${visible} Students listed.`;
}

function updateExamSummaryCards() {
  const rows = [...document.querySelectorAll('#exam-tbody .exm-row')];
  const visibleRows = rows;
  const completed = visibleRows.filter(row => {
    const id = row.dataset.studentId;
    const absent = document.getElementById(`exm-absent-${id}`)?.checked;
    const score = document.getElementById(`exm-score-${id}`)?.value;
    return absent || score !== '';
  }).length;
  let passed = 0;
  let failed = 0;
  let absentCount = 0;
  let completedNonAbsent = 0;
  let percentageTotal = 0;
  let highest = null;

  rows.forEach(row => {
    const id = row.dataset.studentId;
    const absent = Boolean(document.getElementById(`exm-absent-${id}`)?.checked);
    const scoreValue = document.getElementById(`exm-score-${id}`)?.value ?? '';
    const maxMarks = Number(document.getElementById(`exm-max-${id}`)?.innerText || 0);
    const passMarks = Number(document.getElementById(`exm-pass-${id}`)?.innerText || 0);
    if (absent) {
      absentCount += 1;
      return;
    }
    if (scoreValue === '' || !Number.isFinite(Number(scoreValue))) return;
    const score = Number(scoreValue);
    completedNonAbsent += 1;
    if (score >= passMarks) passed += 1;
    else failed += 1;
    if (maxMarks > 0) percentageTotal += (score / maxMarks) * 100;
    highest = highest === null ? score : Math.max(highest, score);
  });

  const cardValues = {
    'exm-card-total': String(rows.length),
    'exm-card-passed': String(passed),
    'exm-card-failed': String(failed),
    'exm-card-absent': String(absentCount),
    'exm-card-avg': `${completedNonAbsent ? (percentageTotal / completedNonAbsent).toFixed(1).replace(/\.0$/, '') : '0'}%`,
    'exm-card-highest': String(highest ?? 0)
  };
  Object.entries(cardValues).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
  const countEl = document.getElementById('exam-summary-count');
  if (countEl) countEl.innerText = `${visibleRows.length} Students listed • ${completed} completed.`;
}

window.recalculateStudentRow = function(admissionNo) {
  const scoreInput = document.getElementById(`exm-score-${admissionNo}`);
  const maxMarks = Number(document.getElementById(`exm-max-${admissionNo}`)?.innerText || 100);
  const passMarks = Number(document.getElementById(`exm-pass-${admissionNo}`)?.innerText || 33);
  const absent = document.getElementById(`exm-absent-${admissionNo}`)?.checked || false;
  const score = absent ? '' : (scoreInput?.value ?? '');

  if (scoreInput && score !== '' && (Number(score) < 0 || Number(score) > maxMarks)) {
    scoreInput.setCustomValidity(`Marks must be between 0 and ${maxMarks}.`);
  } else if (scoreInput) {
    scoreInput.setCustomValidity('');
  }

  const gradeEl = document.getElementById(`exm-grade-${admissionNo}`);
  if (gradeEl) gradeEl.innerText = calculateGrade(score, maxMarks, absent);

  const status = calculateResultStatus(score, passMarks, absent);
  const statusEl = document.getElementById(`exm-status-${admissionNo}`);
  if (statusEl) {
    statusEl.innerText = status.label;
    statusEl.className = `px-2.5 py-1 rounded-xl text-[10px] font-black border uppercase ${status.color}`;
  }
  updateExamSummaryCards();
};

window.toggleStudentAbsent = function(admissionNo) {
  const absent = document.getElementById(`exm-absent-${admissionNo}`)?.checked || false;
  const scoreInput = document.getElementById(`exm-score-${admissionNo}`);
  if (scoreInput) {
    scoreInput.disabled = absent;
    if (absent) scoreInput.value = '';
  }
  window.recalculateStudentRow(admissionNo);
};

function collectExamSheetMarks() {
  const rows = [...document.querySelectorAll('#exam-tbody .exm-row')];
  if (!rows.length) throw new Error('Please load the student score sheet first.');

  return rows.map(row => {
    const admissionNo = row.dataset.studentId;
    const student = examState.activeStudents.find(s =>
      (s.admissionNo || s.studentId || s.id) === admissionNo
    ) || {};
    const absent = document.getElementById(`exm-absent-${admissionNo}`)?.checked || false;
    const scoreInput = document.getElementById(`exm-score-${admissionNo}`);
    const maxMarks = Number(document.getElementById(`exm-max-${admissionNo}`)?.innerText || 100);
    const passMarks = Number(document.getElementById(`exm-pass-${admissionNo}`)?.innerText || 33);
    const rawScore = scoreInput?.value ?? '';

    if (!absent && (rawScore === '' || !Number.isFinite(Number(rawScore)) || Number(rawScore) < 0 || Number(rawScore) > maxMarks)) {
      throw new Error(`Enter valid marks (0-${maxMarks}) for ${student.name || admissionNo}.`);
    }

    const marksObtained = absent ? 0 : Number(rawScore);
    return {
      studentId: admissionNo,
      admissionNo,
      name: student.name || row.dataset.name || '',
      rollNo: student.rollNo || '',
      marksObtained,
      score: marksObtained,
      maxMarks,
      maxScore: maxMarks,
      passMarks,
      grade: calculateGrade(marksObtained, maxMarks, absent),
      resultStatus: calculateResultStatus(marksObtained, passMarks, absent).label,
      isAbsent: absent,
      remark: document.getElementById(`exm-remark-${admissionNo}`)?.value || ''
    };
  });
}

async function saveCurrentExamSheet(status) {
  const examName = document.getElementById('exm-filter-name')?.value;
  const className = document.getElementById('exm-filter-class')?.value;
  const section = document.getElementById('exm-filter-section')?.value || 'A';
  const subject = selectedScoreSheetSubject()?.name || '';
  const subjectId = selectedScoreSheetSubject()?.id || '';
  const session = document.getElementById('exm-filter-session')?.value || getCurrentAcademicSession();
  const date = document.getElementById('exm-filter-date')?.value;
  if (!examName || !className || !subject || !date) {
    throw new Error('Exam, class, subject, and exam date are required.');
  }

  const record = await ApiService.saveExams({
    name: examName,
    examName,
    className,
    section,
    subject_id: subjectId,
    subject,
    session,
    date,
    status,
    marks: collectExamSheetMarks()
  });
  examState.existingExam = record;
  return record;
}

function bindExamActionButton(id, status) {
  const button = document.getElementById(id);
  if (!button) return;
  button.onclick = async () => {
    const original = button.innerHTML;
    try {
      button.disabled = true;
      button.innerText = status === 'Draft' ? 'Saving Draft...' : 'Submitting...';
      await saveCurrentExamSheet(status);
      updateExamSummaryCards();
      alert(status === 'Draft' ? '✅ Exam marks saved as draft.' : '✅ Final marks submitted and synchronized with Teacher/Admin portals.');
    } catch (err) {
      alert('❌ Failed to save marks: ' + err.message);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  };
}

bindExamActionButton('exm-save-draft-btn', 'Draft');
bindExamActionButton('save-exam-marks-btn', 'Submitted');

const editExamMarksBtn = document.getElementById('exm-edit-marks-btn');
if (editExamMarksBtn) {
  editExamMarksBtn.onclick = () => {
    document.querySelectorAll('#exam-tbody input').forEach(input => {
      if (input.type !== 'checkbox' || !input.checked) input.disabled = false;
      input.readOnly = false;
    });
    alert('✏️ Saved marks are unlocked for editing. Submit again to synchronize changes.');
  };
}

async function loadExamHistory() {
  const tbody = document.getElementById('exm-hist-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">Loading result history...</td></tr>';
  try {
    const results = await ApiService.getExamResults();
    examState.allExams = Array.isArray(results) ? results : [];
    renderExamHistory();
  } catch (err) {
    console.error('Failed to load exam history:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-rose-500">Failed to load result history: ${err.message}</td></tr>`;
  }
}

function renderExamHistory() {
  const tbody = document.getElementById('exm-hist-tbody');
  if (!tbody) return;
  const selectedClass = document.getElementById('exm-hist-class')?.value || '';
  const selectedExam = document.getElementById('exm-hist-exam')?.value || '';
  const selectedSubject = document.getElementById('exm-hist-subject')?.value || '';
  const selectedSession = document.getElementById('exm-hist-session')?.value || '';
  const search = (document.getElementById('exm-hist-search')?.value || '').trim().toLowerCase();

  const rows = (examState.allExams || []).filter(r => {
    const classMatch = !selectedClass || (r.className || '') === selectedClass;
    const examMatch = !selectedExam || (r.examName || r.name || '') === selectedExam;
    const subjectMatch = !selectedSubject || (r.subject || '') === selectedSubject;
    const sessionMatch = !selectedSession || (r.academicSession || r.session || '') === selectedSession;
    const text = `${r.studentId || r.admissionNo || ''} ${r.studentName || r.name || ''}`.toLowerCase();
    return classMatch && examMatch && subjectMatch && sessionMatch && (!search || text.includes(search));
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-10 text-slate-400">No matching result history found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const obtained = Number(r.marksObtained ?? r.score ?? 0);
    const maximum = Number(r.maxMarks ?? r.maxScore ?? 100);
    const result = r.resultStatus || (r.isAbsent ? 'ABSENT' : (obtained >= Number(r.passMarks || 33) ? 'PASS' : 'FAIL'));
    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60">
        <td class="px-4 py-3 font-mono text-amber-500">${r.studentId || r.admissionNo || '-'}</td>
        <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${r.studentName || r.name || '-'}</td>
        <td class="px-4 py-3">${r.className || '-'}${r.section ? `-${r.section}` : ''}</td>
        <td class="px-4 py-3">${r.subject || '-'}</td>
        <td class="px-4 py-3">${r.examName || r.name || '-'}</td>
        <td class="px-4 py-3 text-center font-mono font-bold">${obtained} / ${maximum}</td>
        <td class="px-4 py-3 text-center font-black">${r.grade || calculateGrade(obtained, maximum, r.isAbsent)}</td>
        <td class="px-4 py-3 text-center font-black ${result === 'PASS' ? 'text-emerald-500' : result === 'FAIL' ? 'text-rose-500' : 'text-slate-400'}">${result}</td>
        <td class="px-4 py-3 font-mono text-[11px]">${(r.updatedAt || '').slice(0, 10) || '-'} / ${r.academicSession || r.session || '-'}</td>
      </tr>
    `;
  }).join('');
}

['exm-hist-class', 'exm-hist-exam', 'exm-hist-subject', 'exm-hist-session'].forEach(id => {
  const input = document.getElementById(id);
  if (input) input.onchange = renderExamHistory;
});
const examHistorySearch = document.getElementById('exm-hist-search');
if (examHistorySearch) examHistorySearch.oninput = renderExamHistory;

const examPdfBtn = document.getElementById('exm-download-pdf-btn');
if (examPdfBtn) {
  examPdfBtn.onclick = async () => {
    const sheet = document.getElementById('exam-sheet-box');
    if (!sheet || sheet.classList.contains('hidden')) return alert('Please load the score sheet first.');
    try {
      if (typeof html2pdf !== 'function') throw new Error('PDF library is unavailable.');
      await html2pdf().set({
        margin: 5,
        filename: `Exam_Score_Sheet_${Date.now()}.pdf`,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
      }).from(sheet).save();
    } catch (err) {
      alert('PDF generation failed: ' + err.message);
    }
  };
}

const examExcelBtn = document.getElementById('exm-export-excel-btn');
if (examExcelBtn) {
  examExcelBtn.onclick = () => {
    try {
      const marks = collectExamSheetMarks();
      const header = ['Admission No', 'Student Name', 'Roll No', 'Marks', 'Max Marks', 'Pass Marks', 'Grade', 'Result', 'Absent', 'Remark'];
      const csv = [header, ...marks.map(m => [
        m.admissionNo, m.name, m.rollNo, m.marksObtained, m.maxMarks,
        m.passMarks, m.grade, m.resultStatus, m.isAbsent ? 'Yes' : 'No', m.remark
      ])].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
      link.download = `Exam_Score_Sheet_${Date.now()}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      alert('Excel export failed: ' + err.message);
    }
  };
}

// Print Progress Reports for entire class
const printReportCardsBtn = document.getElementById('print-all-report-cards');
if (printReportCardsBtn) {
  printReportCardsBtn.addEventListener('click', async () => {
    const examName = document.getElementById('exm-filter-name').value;
    const className = document.getElementById('exm-filter-class').value;

    try {
      // Gather all subjects for the exam to present a comprehensive card
      const examsList = await ApiService.getExams();
      const classExams = examsList.filter(e => 
        (e.name === examName || e.examName === examName) && 
        (e.className === className || e.className.replace(/^Class\s+/i, '').toLowerCase() === className.replace(/^Class\s+/i, '').toLowerCase())
      );
      
      if (classExams.length === 0) {
        return alert("No exam data recorded to generate reports.");
      }

      // We will print report cards sequentially
      const students = (examState.activeStudents && examState.activeStudents.length) ? examState.activeStudents : (state.activeClassExam || []);
      
      if (!students || students.length === 0) {
        return alert("⊠️ Please load the student roster before printing report cards.");
      }

      const printContainer = document.createElement('div');
      printContainer.className = 'print-reports-container';
      
      students.forEach(s => {
        let tbodyHtml = '';
        let totalObt = 0;
        let totalMax = 0;

        classExams.forEach(ex => {
          const match = ex.marks.find(m => (m.studentId || m.admissionNo) === s.admissionNo);
          if (match) {
            const obt = Number(match.marksObtained !== undefined ? match.marksObtained : match.score);
            const max = Number(match.maxMarks !== undefined ? match.maxMarks : match.maxScore);
            const pct = max > 0 ? Math.round((obt / max) * 100) : 0;
            
            // Calc Grade
            let grade = 'D';
            if (pct >= 90) grade = 'A+';
            else if (pct >= 80) grade = 'A';
            else if (pct >= 60) grade = 'B';
            else if (pct >= 40) grade = 'C';

            totalObt += obt;
            totalMax += max;

            tbodyHtml += `
              <tr class="border border-black text-center">
                <td class="px-4 py-2 border border-black text-left font-bold">${ex.subject}</td>
                <td class="px-4 py-2 border border-black">${obt}</td>
                <td class="px-4 py-2 border border-black">${max}</td>
                <td class="px-4 py-2 border border-black">${pct}%</td>
                <td class="px-4 py-2 border border-black font-bold">${grade}</td>
              </tr>
            `;
          }
        });

        const overallPct = totalMax > 0 ? Math.round((totalObt / totalMax) * 100) : 0;
        let overallGrade = 'D';
        if (overallPct >= 90) overallGrade = 'A+';
        else if (overallPct >= 80) overallGrade = 'A';
        else if (overallPct >= 60) overallGrade = 'B';
        else if (overallPct >= 40) overallGrade = 'C';

        tbodyHtml += `
          <tr class="border border-black text-center font-extrabold bg-slate-100">
            <td class="px-4 py-2 border border-black text-left">OVERALL CUMULATIVE</td>
            <td class="px-4 py-2 border border-black">${totalObt}</td>
            <td class="px-4 py-2 border border-black">${totalMax}</td>
            <td class="px-4 py-2 border border-black">${overallPct}%</td>
            <td class="px-4 py-2 border border-black text-amber-600">${overallGrade}</td>
          </tr>
        `;

        // Render report card block
        const rCard = document.createElement('div');
        rCard.className = 'print-page-break p-8 bg-white text-black space-y-8';
        rCard.innerHTML = `
          <div class="border-b-4 border-slate-900 pb-4 text-center space-y-1">
            <h1 class="text-3xl font-black uppercase tracking-tight">Garumara Jatiya Vidyalaya</h1>
            <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Garumara, Nagaon, Assam – 782140</p>
            <p class="text-base font-extrabold text-slate-950 uppercase border-y border-black py-1 mt-2">Academic Progress Report Card</p>
          </div>

          <div class="grid grid-cols-2 gap-4 text-xs border border-black p-4 rounded-xl">
            <p><strong>Student Name:</strong> <span>${s.name}</span></p>
            <p><strong>Admission No:</strong> <span>${s.admissionNo}</span></p>
            <p><strong>Class:</strong> <span>${s.className} - ${s.section}</span></p>
            <p><strong>Roll No:</strong> <span>${s.rollNo}</span></p>
            <p class="col-span-2"><strong>Term Examination:</strong> <span>${examName}</span></p>
          </div>

          <div class="space-y-4">
            <table class="w-full text-left text-xs border border-collapse border-black">
              <thead>
                <tr class="bg-slate-100 border border-black text-center font-bold">
                  <th class="px-4 py-2 text-left border border-black">Subject</th>
                  <th class="px-4 py-2 border border-black">Marks Obtained</th>
                  <th class="px-4 py-2 border border-black">Max Marks</th>
                  <th class="px-4 py-2 border border-black">Percentage</th>
                  <th class="px-4 py-2 border border-black">Grade</th>
                </tr>
              </thead>
              <tbody>
                ${tbodyHtml}
              </tbody>
            </table>
          </div>

          <div class="border border-black p-4 rounded-lg space-y-1.5 text-[9px] font-mono leading-none">
            <p class="font-bold">Grading System Scale:</p>
            <p>A+ (90-100%): Outstanding | A (80-89%): Excellent | B (60-79%): Good | C (40-59%): Satisfactory | D (Below 40%): Needs Improvement / Fail</p>
          </div>

          <div class="pt-24 grid grid-cols-3 text-xs text-center font-bold">
            <div class="space-y-1">
              <p class="border-b border-black w-32 mx-auto"></p>
              <p>Class Teacher</p>
            </div>
            <div class="space-y-1">
              <p class="border-b border-black w-32 mx-auto"></p>
              <p>Parent/Guardian</p>
            </div>
            <div class="space-y-1">
              <p class="border-b border-black w-32 mx-auto"></p>
              <p>Principal & Seal</p>
            </div>
          </div>
        `;
        printContainer.appendChild(rCard);
      });

      // Temporarily replace page template with class lists
      printContainer.classList.add('print-active');
      document.body.appendChild(printContainer);
      window.print();
      printContainer.remove();

    } catch (err) {
      alert(err.message || 'Report cards generation failed.');
    }
  });
}


// ================= 7. NOTICE MANAGEMENT =================
async function loadNoticesTab() {
  const container = document.getElementById('notices-mgr-list');
  container.innerHTML = `<p class="text-xs text-slate-400">Fetching notices...</p>`;

  try {
    const notices = await ApiService.getPublicNotices(document.getElementById('notice-session-filter')?.value || getCurrentAcademicSession());
    if (notices.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-400 py-8 text-center">No notices posted.</p>`;
      return;
    }

    container.innerHTML = notices.map(n => `
      <div class="border border-slate-200 dark:border-slate-800 p-4 rounded-2xl flex justify-between items-start space-x-4 bg-slate-50/50 dark:bg-slate-900/30">
        <div>
          <span class="text-[10px] text-slate-400 font-bold block mb-1">${n.date}</span>
          <h4 class="font-bold text-slate-900 dark:text-white text-sm mb-1">
            ${n.title}
            ${n.isUrgent ? `<span class="bg-red-500 text-white text-[8px] px-1 rounded uppercase font-black ml-2">Urgent</span>` : ''}
          </h4>
          <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${n.content}</p>
        </div>
        <button onclick="deleteNoticeMgr('${n.id}')" class="text-red-500 hover:text-red-400 font-bold text-xs shrink-0 no-print">Delete</button>
      </div>
    `).join('');

  } catch (err) {
    container.innerHTML = `<p class="text-xs text-red-500">Failed to load list.</p>`;
  }
}

// Notice form submit
const noticeForm = document.getElementById('notice-publish-form');
if (noticeForm) {
  noticeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      title: document.getElementById('not-title').value,
      target: document.getElementById('not-target').value,
      isUrgent: document.getElementById('not-urgent').checked,
      content: document.getElementById('not-content').value,
      academic_session: document.getElementById('notice-session-filter')?.value || getCurrentAcademicSession()
    };

    try {
      await ApiService.createNotice(data);
      noticeForm.reset();
      loadNoticesTab();
    } catch (err) {
      alert(err.message || 'Publish failed.');
    }
  });
}

window.deleteNoticeMgr = async function(id) {
  if (confirm('Delete this announcement?')) {
    try {
      await ApiService.deleteNotice(id);
      loadNoticesTab();
    } catch (err) {
      alert('Delete failed.');
    }
  }
};


// ================= 8. GALLERY MANAGEMENT =================
let galleryPhotoBase64 = '';

function loadGalleryTab() {
  const fileInput = document.getElementById('gal-file');
  fileInput.value = '';
  galleryPhotoBase64 = '';

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
      galleryPhotoBase64 = evt.target.result;
    };
    reader.readAsDataURL(file);
  });

  renderGalleryMgrGrid();
}

async function renderGalleryMgrGrid() {
  const container = document.getElementById('gallery-mgr-grid');
  container.innerHTML = `<p class="text-xs text-slate-400 col-span-2">Fetching photos...</p>`;

  try {
    const photos = await ApiService.getPublicGallery();
    if (photos.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-400 py-8 text-center col-span-2">Gallery is empty.</p>`;
      return;
    }

    container.innerHTML = photos.map(p => `
      <div class="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 flex flex-col justify-between">
        <img src="${p.image}" class="w-full h-32 object-cover" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23eaeaea%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-family=%22sans-serif%22 fill=%22%23999%22>No Image</text></svg>'">
        <div class="p-3 flex justify-between items-center text-xs">
          <span class="font-bold truncate max-w-[120px]" title="${p.title}">${p.title}</span>
          <button onclick="deleteGalleryPhotoMgr('${p.id}')" class="text-red-500 hover:text-red-400 font-bold shrink-0 no-print">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<p class="text-xs text-red-500 col-span-2">Failed to load grid.</p>`;
  }
}

const galleryForm = document.getElementById('gallery-upload-form');
if (galleryForm) {
  galleryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!galleryPhotoBase64) return alert("Select photo file.");

    const data = {
      title: document.getElementById('gal-title').value,
      image: galleryPhotoBase64
    };

    try {
      await ApiService.uploadGalleryPhoto(data);
      galleryForm.reset();
      galleryPhotoBase64 = '';
      renderGalleryMgrGrid();
    } catch (err) {
      alert(err.message || 'Upload failed.');
    }
  });
}

window.deleteGalleryPhotoMgr = async function(id) {
  if (confirm('Delete this photo from gallery?')) {
    try {
      await ApiService.deleteGalleryPhoto(id);
      renderGalleryMgrGrid();
    } catch (err) {
      alert('Delete failed.');
    }
  }
};


// ================= 9. WEBSITE CONTENT EDITOR =================
async function loadLeadershipAdmin() {
  const container = document.getElementById('leadership-mgr-cards');
  if (!container) return;
  container.innerHTML = `<div class="col-span-3 text-center py-6 text-slate-400">Loading leadership profiles...</div>`;
  
  try {
    const leaders = await ApiService.getLeadership();
    container.innerHTML = '';
    
    leaders.forEach(l => {
      const defaultAvatar = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23eaeaea"/><circle cx=%2250%22 cy=%2235%22 r=%2216%22 fill=%22%23999%22/><path d=%22M20 88c4-25 56-25 60 0%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%2212%22 stroke-linecap=%22round%22/></svg>`;
      const photoSrc = l.photo || defaultAvatar;

      const card = document.createElement('div');
      card.className = 'border border-slate-200 dark:border-slate-800 p-6 rounded-2xl space-y-4 flex flex-col bg-slate-50/50 dark:bg-slate-900/50';
      card.innerHTML = `
        <div class="flex flex-col items-center space-y-2 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div class="w-24 h-24 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center overflow-hidden shrink-0 relative">
            <img id="mgr-photo-preview-${l.id}" src="${photoSrc}" class="w-full h-full object-cover">
          </div>
          <input type="file" id="mgr-file-${l.id}" accept="image/*" class="hidden">
          <button type="button" id="mgr-file-btn-${l.id}" class="text-[10px] text-amber-500 hover:underline cursor-pointer">Change Photo</button>
        </div>
        
        <div class="space-y-1">
          <label class="text-slate-500 block text-[10px] uppercase">Name</label>
          <input type="text" id="mgr-name-${l.id}" value="${l.name}" required class="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500">
        </div>
        
        <div class="space-y-1">
          <label class="text-slate-500 block text-[10px] uppercase">Qualification</label>
          <input type="text" id="mgr-qualification-${l.id}" value="${l.qualification || ''}" class="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500">
        </div>
        
        <div class="space-y-1">
          <label class="text-slate-500 block text-[10px] uppercase">Designation</label>
          <input type="text" id="mgr-designation-${l.id}" value="${l.designation}" required class="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500">
        </div>
        
        <div class="space-y-1 flex-1 flex flex-col">
          <label class="text-slate-500 block text-[10px] uppercase">Welcome Message</label>
          <textarea id="mgr-message-${l.id}" rows="5" required class="w-full flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 resize-none">${l.message}</textarea>
        </div>
        
        <button type="button" id="mgr-save-${l.id}" class="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-950 py-2.5 rounded-xl font-bold hover:bg-amber-500 hover:text-slate-950 dark:hover:bg-amber-400 dark:hover:text-slate-950 transition-all text-center">
          Save Profile
        </button>
      `;
      container.appendChild(card);

      // Handle photo upload triggers & base64 encoding
      const fileInput = card.querySelector(`#mgr-file-${l.id}`);
      const fileBtn = card.querySelector(`#mgr-file-btn-${l.id}`);
      const imgPreview = card.querySelector(`#mgr-photo-preview-${l.id}`);
      
      fileBtn.addEventListener('click', () => fileInput.click());
      
      let selectedPhotoBase64 = l.photo;
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          alert('Photo must be under 2MB.');
          fileInput.value = '';
          return;
        }
        
        const reader = new FileReader();
        reader.onload = (event) => {
          selectedPhotoBase64 = event.target.result;
          imgPreview.src = selectedPhotoBase64;
        };
        reader.readAsDataURL(file);
      });

      // Save button click
      const saveBtn = card.querySelector(`#mgr-save-${l.id}`);
      saveBtn.addEventListener('click', async () => {
        const nameVal = card.querySelector(`#mgr-name-${l.id}`).value;
        const qualVal = card.querySelector(`#mgr-qualification-${l.id}`).value;
        const desigVal = card.querySelector(`#mgr-designation-${l.id}`).value;
        const msgVal = card.querySelector(`#mgr-message-${l.id}`).value;

        if (!nameVal || !desigVal || !msgVal) {
          alert('All fields except qualification are required.');
          return;
        }

        try {
          saveBtn.innerText = 'Saving...';
          saveBtn.disabled = true;
          await ApiService.updateLeader(l.id, {
            name: nameVal,
            qualification: qualVal,
            designation: desigVal,
            message: msgVal,
            photo: selectedPhotoBase64
          });
          alert(`${l.designation} profile updated successfully!`);
          loadLeadershipAdmin();
        } catch (err) {
          alert(err.message || 'Failed to update leadership profile.');
        } finally {
          saveBtn.innerText = 'Save Profile';
          saveBtn.disabled = false;
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="col-span-3 text-center text-red-500 py-6">Failed to load leadership team details: ${err.message}</div>`;
  }
}

async function loadContentTab() {
  try {
    const settings = await ApiService.getSettings();
    const c = settings.websiteContent || {};
    
    document.getElementById('web-school-name').value = c.schoolName || '';
    document.getElementById('web-tagline').value = c.tagline || '';
    document.getElementById('web-about-text').value = c.aboutText || '';
    document.getElementById('web-principal-name').value = c.principalName || '';
    document.getElementById('web-principal-message').value = c.principalMessage || '';
    document.getElementById('web-phone').value = c.phone || '';
    document.getElementById('web-email').value = c.email || '';
    document.getElementById('web-address').value = c.address || '';
    document.getElementById('web-map-embed').value = c.mapEmbedUrl || '';

    // Load leadership profiles editor
    loadLeadershipAdmin();

  } catch (err) {
    alert('Failed to load website content settings.');
  }
}

const contentForm = document.getElementById('website-content-form');
if (contentForm) {
  contentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      websiteContent: {
        schoolName: document.getElementById('web-school-name').value,
        tagline: document.getElementById('web-tagline').value,
        aboutText: document.getElementById('web-about-text').value,
        principalName: document.getElementById('web-principal-name').value,
        principalMessage: document.getElementById('web-principal-message').value,
        phone: document.getElementById('web-phone').value,
        email: document.getElementById('web-email').value,
        address: document.getElementById('web-address').value,
        mapEmbedUrl: document.getElementById('web-map-embed').value
      }
    };

    try {
      await ApiService.saveSettings(data);
      alert('Website Content updated successfully!');
      loadContentTab();
    } catch (err) {
      alert(err.message || 'Update failed.');
    }
  });
}


// ================= 10. NOTIFICATION CENTER =================
async function loadNotificationsTab() {
  loadNotSettings();
  loadNotLogs();
}

async function loadNotSettings() {
  try {
    const [s] = await Promise.all([ApiService.getSettings(), loadAcademicSessions()]);
    document.getElementById('not-opt-master').checked = !!s.notificationsEnabled;
    document.getElementById('not-opt-whatsapp').checked = !!s.whatsappEnabled;
    document.getElementById('not-opt-sms').checked = !!s.smsEnabled;
    document.getElementById('not-tpl-whatsapp').value = s.whatsappTemplate || '';
    document.getElementById('not-tpl-sms').value = s.smsTemplate || '';
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function loadNotLogs() {
  const tbody = document.getElementById('not-logs-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">Loading logs...</td></tr>`;

  try {
    const logs = await ApiService.getNotifications();
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">No notifications sent yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const dateStr = new Date(l.timestamp).toLocaleString('en-IN');
      const badge = l.status === 'Delivered' 
        ? `<span class="bg-green-150 text-green-700 dark:bg-green-950/40 dark:text-green-400 px-2 py-0.5 rounded font-black text-[9px]">Delivered</span>`
        : `<span class="bg-red-150 text-red-700 dark:bg-red-950/40 dark:text-red-400 px-2 py-0.5 rounded font-black text-[9px]">Failed</span>`;

      return `
        <tr class="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors text-[11px] leading-relaxed">
          <td class="px-4 py-3 font-mono text-slate-400">${dateStr}</td>
          <td class="px-4 py-3">
            <span class="font-bold text-slate-950 dark:text-white block">${l.studentName}</span>
            <span class="font-mono text-slate-450 block">${l.recipientMobile} (${l.studentId})</span>
          </td>
          <td class="px-4 py-3 font-bold">${l.channel}</td>
          <td class="px-4 py-3 font-bold">${l.type}</td>
          <td class="px-4 py-3 max-w-[200px] truncate" title="${l.message}">${l.message}</td>
          <td class="px-4 py-3 text-right">${badge}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-red-500 py-4">Failed to load logs.</td></tr>`;
  }
}

// Notification settings form submit
const notSettingsForm = document.getElementById('notification-settings-form');
if (notSettingsForm) {
  notSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      notificationsEnabled: document.getElementById('not-opt-master').checked,
      whatsappEnabled: document.getElementById('not-opt-whatsapp').checked,
      smsEnabled: document.getElementById('not-opt-sms').checked,
      whatsappTemplate: document.getElementById('not-tpl-whatsapp').value,
      smsTemplate: document.getElementById('not-tpl-sms').value
    };

    try {
      await ApiService.saveSettings(data);
      alert('Notification settings updated!');
      loadNotSettings();
    } catch (e) {
      alert('Save failed.');
    }
  });
}

// Send test alert simulator
const testAlertForm = document.getElementById('test-alert-form');
if (testAlertForm) {
  testAlertForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      type: document.getElementById('test-alert-type').value,
      message: document.getElementById('test-alert-msg').value || 'This is a test notification.'
    };

    try {
      await ApiService.triggerTestNotification(payload);
      document.getElementById('test-alert-msg').value = '';
      alert('Simulated Alert Log generated!');
      loadNotLogs(); // reload logs list
    } catch (e) {
      alert('Simulation trigger failed.');
    }
  });
}


let academicSessionsCache = [];
let activeAcademicSession = null;
function generatedAcademicSessionFallback() { const now = new Date(), year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return year + '-' + String(year + 1).slice(-2); }
function getCurrentAcademicSession() { return activeAcademicSession?.session_name || localStorage.getItem('gv_current_academic_session') || generatedAcademicSessionFallback(); }
window.getCurrentAcademicSession = getCurrentAcademicSession;
function academicSessionEscape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function hydrateAcademicSessionControls(root = document) {
  if (!academicSessionsCache.length) return;
  root.querySelectorAll('select').forEach(select => {
    const identity = (select.id + ' ' + select.name).toLowerCase();
    if (!identity.includes('session')) return;
    const previous = select.value, options = academicSessionsCache.map(row => '<option value="' + academicSessionEscape(row.session_name) + '">' + academicSessionEscape(row.session_name) + (row.is_active ? ' (Current)' : '') + '</option>').join('');
    select.innerHTML = '<option value="">All Sessions</option>' + options;
    select.value = academicSessionsCache.some(row => row.session_name === previous) ? previous : getCurrentAcademicSession();
  });
  root.querySelectorAll('input[name="academicSession"], input[id*="session" i]').forEach(input => { if (!input.value) input.value = getCurrentAcademicSession(); });
  const payrollMonth = root.querySelector('#tch-sal-month'); const active = academicSessionsCache.find(row => row.session_name === getCurrentAcademicSession()); if (payrollMonth && active?.start_date && active?.end_date) { const selected=payrollMonth.value, months=[]; let cursor=new Date(active.start_date+'T00:00:00'), end=new Date(active.end_date+'T00:00:00'); while(cursor<=end){const value=cursor.getFullYear()+'-'+String(cursor.getMonth()+1).padStart(2,'0');months.push('<option value="'+value+'">'+cursor.toLocaleDateString('en-IN',{month:'long',year:'numeric'})+'</option>');cursor.setMonth(cursor.getMonth()+1);} payrollMonth.innerHTML=months.join(''); if(months.some(option=>option.includes('value="'+selected+'"')))payrollMonth.value=selected; }
}
async function loadAcademicSessions() {
  const data = await ApiService.getAcademicSessions(); academicSessionsCache = data.sessions || []; activeAcademicSession = data.currentSession || academicSessionsCache.find(row => row.is_active) || null;
  if (activeAcademicSession) localStorage.setItem('gv_current_academic_session', activeAcademicSession.session_name);
  document.querySelectorAll('#current-academic-session-indicator, #current-academic-session-inline').forEach(el => el.textContent = 'Session: ' + getCurrentAcademicSession());
  const badge=document.getElementById('settings-current-session'); if(badge) badge.textContent='Current: '+getCurrentAcademicSession(); hydrateAcademicSessionControls(); renderAcademicSessions(); return data;
}
function showAcademicSessionMessage(message, error=false) { const el=document.getElementById('academic-session-message'); if(!el)return; el.textContent=message; el.className='text-xs font-semibold '+(error?'text-red-600':'text-emerald-600'); }
function resetAcademicSessionForm(){ const form=document.getElementById('academic-session-form'); form?.reset(); document.getElementById('academic-session-id').value=''; document.getElementById('academic-session-status').value='Closed'; document.getElementById('academic-session-cancel')?.classList.add('hidden'); document.getElementById('academic-session-save').textContent='Save Session'; }
function renderAcademicSessions(){ const body=document.getElementById('academic-sessions-tbody'); if(!body)return; if(!academicSessionsCache.length){body.innerHTML='<tr><td colspan="6" class="p-6 text-center text-slate-400">No academic sessions found.</td></tr>';return;} body.innerHTML=academicSessionsCache.map(row => '<tr class="border-b border-slate-100 dark:border-slate-800"><td class="p-3 font-bold">'+academicSessionEscape(row.session_name)+'</td><td class="p-3">'+academicSessionEscape(row.start_date)+'</td><td class="p-3">'+academicSessionEscape(row.end_date)+'</td><td class="p-3"><span class="px-2 py-1 rounded-lg '+(row.status==='Active'?'bg-emerald-100 text-emerald-700':row.status==='Archived'?'bg-slate-200 text-slate-600':'bg-amber-100 text-amber-700')+'">'+academicSessionEscape(row.status)+'</span></td><td class="p-3">'+(row.is_active?'Yes':'No')+'</td><td class="p-3 text-right space-x-1"><button data-session-action="edit" data-id="'+row.id+'" class="px-2 py-1 rounded-lg bg-blue-100 text-blue-700">Edit</button>'+(row.is_active?'':'<button data-session-action="activate" data-id="'+row.id+'" class="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700">Set Active</button>')+(row.is_active?'':'<button data-session-action="delete" data-id="'+row.id+'" class="px-2 py-1 rounded-lg bg-red-100 text-red-700">Delete</button>')+'</td></tr>').join(''); }

// ================= 11. SETTINGS & DATABASE BACKUPS =================
async function loadSettingsTab() {
  try {
    const s = await ApiService.getSettings();
    document.getElementById('set-username').value = s.adminUsername || '';
    document.getElementById('set-password').value = '';

    // Bind token to backup download URL
    const dBtn = document.getElementById('download-backup-btn');
    if (dBtn) {
      dBtn.href = ApiService.getBackupUrl();
    }

  } catch (err) {
    console.error('Failed to load profile settings:', err);
  }
}

// Credentials Form submit
const credsForm = document.getElementById('credentials-form');
if (credsForm) {
  credsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const user = document.getElementById('set-username').value;
    const pass = document.getElementById('set-password').value;

    const payload = { adminUsername: user };
    if (pass) {
      payload.newPassword = pass;
    }

    try {
      await ApiService.saveSettings(payload);
      alert('Admin Profile updated successfully! If username changed, please log in again.');
      if (pass || user !== localStorage.getItem('gv_admin_user')) {
        ApiService.clearAuth();
        window.location.href = '/admin/login.html';
      } else {
        loadSettingsTab();
      }
    } catch (err) {
      alert(err.message || 'Credentials update failed.');
    }
  });
}

// Database Restore Handler
const restoreFileInput = document.getElementById('restore-db-file');
const restoreBtn = document.getElementById('restore-db-btn');
if (restoreBtn && restoreFileInput) {
  restoreBtn.addEventListener('click', () => {
    const file = restoreFileInput.files[0];
    if (!file) return alert('Please select a backup JSON file first.');

    if (confirm('Restoring will completely overwrite the database! Are you sure?')) {
      const reader = new FileReader();
      reader.onload = async function(evt) {
        try {
          const restoredJson = JSON.parse(evt.target.result);
          
          restoreBtn.disabled = true;
          restoreBtn.innerText = 'Restoring...';

          const res = await ApiService.restoreDatabase(restoredJson);
          alert(res.message || 'Database restored successfully! Re-routing to login.');
          
          // Clear current session to force credential reload
          ApiService.clearAuth();
          window.location.href = '/admin/login.html';

        } catch (e) {
          alert('Failed to parse database file. Ensure it is a valid JSON backup.');
          restoreBtn.disabled = false;
          restoreBtn.innerText = 'Upload & Restore';
        }
      };
      reader.readAsText(file);
    }
  });
}

// ================= 12. ADMIT CARD GENERATOR =================
let admitCardSettingsCached = null;
let pendingAdmitCardSignatureFile = null;
let pendingAdmitCardSignaturePreviewUrl = '';

const CARD_SESSION_STORAGE_KEYS={admit:'gv_admit_card_academic_session_id',idcard:'gv_id_card_academic_session_id'};
async function populateCardSessionSelector(id,key){if(!academicSessionsCache.length)await loadAcademicSessions();const el=document.getElementById(id);if(!el)throw Error('Academic Session selector is missing.');const stored=localStorage.getItem(key)||'',active=academicSessionsCache.find(x=>x.is_active)||activeAcademicSession,chosen=academicSessionsCache.find(x=>String(x.id)===stored)||active||academicSessionsCache[0];el.innerHTML=academicSessionsCache.map(x=>'<option value=\"'+subjectHtmlEscape(String(x.session_name))+'\" data-session-id=\"'+subjectHtmlEscape(String(x.id))+'\">'+subjectHtmlEscape(String(x.session_name))+(x.is_active?' (Current)':'')+'</option>').join('');if(!chosen){el.innerHTML='<option value=\"\">No academic sessions found</option>';el.disabled=true;throw Error('No Academic Session is configured.')}el.disabled=false;el.value=chosen.session_name;el.dataset.academicSessionId=String(chosen.id);return chosen}
function selectedCardSession(id){const el=document.getElementById(id),name=String(el?.value||getCurrentAcademicSession()).trim(),row=academicSessionsCache.find(x=>x.session_name===name),sessionId=String(row?.id||el?.dataset?.academicSessionId||'').trim();if(el)el.dataset.academicSessionId=sessionId;return{id:sessionId,name}}
function getSelectedAdmitCardSession(){return selectedCardSession('admit-set-session')} function getSelectedIdCardSession(){return selectedCardSession('idcard-set-session')} function withSelectedAdmitCardSession(v=admitCardSettingsCached){const x=getSelectedAdmitCardSession();return{...(v||{}),session:x.name,academic_session_id:x.id}}
async function reloadAdmitCardSessionData(){const x=getSelectedAdmitCardSession(),status=document.getElementById('admit-preview-status');if(status)status.textContent='Loading students for '+x.name+'...';const [sr,er]=await Promise.all([ApiService.getStudents({academic_session_id:x.id,session:x.name}),ApiService.getExams({academic_session_id:x.id,session:x.name})]);const rows=Array.isArray(sr)?sr:(sr?.students||sr?.data||[]);state.allStudents=rows.map(normalizeAdmitCardStudent);state.selectedAdmitPreviewAdmissionNo='';const es=document.getElementById('admit-exam-select');if(es){const old=es.value,ex=Array.isArray(er)?er:(er?.exams||er?.data||[]),names=[...new Set(ex.map(e=>String(e.name||e.examName||e.exam_type||'').trim()).filter(Boolean))];es.innerHTML=names.length?names.map(n=>'<option value=\"'+subjectHtmlEscape(n)+'\">'+subjectHtmlEscape(n)+'</option>').join(''):'<option value=\"\">No exams found for this session</option>';if(names.includes(old))es.value=old}admitCardSettingsCached=withSelectedAdmitCardSession(admitCardSettingsCached);filterAndRenderAdmitStudents()}
async function reloadIdCardSessionData(){const x=getSelectedIdCardSession(),status=document.getElementById('idcard-preview-status');if(status)status.textContent='Loading students for '+x.name+'...';const sr=await ApiService.getStudents({academic_session_id:x.id,session:x.name}),rows=Array.isArray(sr)?sr:(sr?.students||sr?.data||[]);state.allStudents=rows.map(normalizeAdmitCardStudent);state.selectedIdCardPreviewAdmissionNo='';idCardSettingsCached={...(idCardSettingsCached||{}),session:x.name,academic_session_id:x.id};filterAndRenderIdCardsStudents()}

function normalizeAdmitCardStudent(student) {
  const source = student || {};
  return {
    ...source,
    admissionNo: String(source.admissionNo || source.admission_number || source.studentId || source.id || '').trim(),
    name: String(source.name || source.studentName || 'Unnamed Student').trim(),
    className: String(source.className || source.class_name || source.class || 'N/A').trim(),
    section: String(source.section || source.sectionName || source.section_name || 'N/A').replace(/^Section\s+/i, '').trim() || 'N/A',
    rollNo: source.rollNo ?? source.roll_number ?? source.roll ?? '',
    fatherName: String(source.fatherName || source.father_name || 'N/A').trim(),
    dob: source.dob || source.dateOfBirth || source.date_of_birth || '',
    photo: source.photo || source.photoUrl || source.photo_url || ''
  };
}

async function loadAdmitCardTab() {
  try {
    const previewStatus = document.getElementById('admit-preview-status');
    if (previewStatus) previewStatus.textContent = 'Loading preview...';
    const settings = await ApiService.getSettings();
    admitCardSettingsCached = settings.admitCardSettings || {
      session: getCurrentAcademicSession(),
      centre: "Garumara Jatiya Vidyalaya Campus",
      instructions: "1. Candidates must bring their printed Admit Card to the exam hall.\n2. Report at least 30 minutes prior to the exam start time.\n3. Smart gadgets, mobile phones, and calculators are strictly prohibited.",
      principalSignatureName: "Anarul Hussain",
      principalSignatureUrl: "",
      principalSignatureUpdatedAt: "",
      examDates: "Unit Test: Aug 10 - Aug 15\nHalf Yearly: Oct 12 - Oct 20\nAnnual: Dec 07 - Dec 18"
    };

    await populateCardSessionSelector('admit-set-session', CARD_SESSION_STORAGE_KEYS.admit);
    document.getElementById('admit-set-centre').value = admitCardSettingsCached.centre || '';
    document.getElementById('admit-set-principal').value = admitCardSettingsCached.principalSignatureName || '';
    updateAdmitCardSignatureSettingsUi(withAdmitCardSignatureCacheBust(getAdmitCardSignatureUrl(admitCardSettingsCached), admitCardSettingsCached.principalSignatureUpdatedAt));
    document.getElementById('admit-set-dates').value = admitCardSettingsCached.examDates || '';
    document.getElementById('admit-set-instructions').value = admitCardSettingsCached.instructions || '';

    await reloadAdmitCardSessionData();
  } catch (err) {
    console.error('Failed to load Admit Card tab data:', err);
    const message = err?.message || 'Unknown loading error';
    const previewStatus = document.getElementById('admit-preview-status');
    const previewBox = document.getElementById('admit-live-preview-a4');
    if (previewStatus) previewStatus.textContent = `Preview failed: ${message}`;
    if (previewBox) {
      previewBox.style.display = 'block';
      previewBox.style.visibility = 'visible';
      previewBox.style.opacity = '1';
      previewBox.innerHTML = `<div class="flex min-h-[600px] items-center justify-center p-8 text-center text-sm text-red-600">Unable to load Admit Card preview: ${subjectHtmlEscape(message)}</div>`;
    }
  }
}

function filterAndRenderAdmitStudents() {
  const targetClass = document.getElementById('admit-class-select').value;
  const targetSection = document.getElementById('admit-section-select').value;
  const searchVal = document.getElementById('admit-student-search').value.toLowerCase().trim();

  const filtered = (state.allStudents || []).filter(s => {
    const studentClass = String(s.className || '').trim();
    const studentSection = String(s.section || '').replace(/^Section\s+/i, '').trim();
    const matchClass = !targetClass || studentClass === targetClass;
    const matchSection = !targetSection || studentSection === targetSection;
    const searchable = `${s.name || ''} ${s.admissionNo || ''} ${s.rollNo || ''}`.toLowerCase();
    const matchSearch = !searchVal || searchable.includes(searchVal);
    return matchClass && matchSection && matchSearch;
  });

  renderAdmitStudentChecklist(filtered);
}

function renderAdmitStudentChecklist(students) {
  const listContainer = document.getElementById('admit-student-list');
  if (!listContainer) return;

  if (students.length === 0) {
    listContainer.innerHTML = `<p class="text-slate-400 text-xs text-center py-4">No matching students found.</p>`;
    document.getElementById('admit-live-preview-a4').innerHTML = `
      <div class="h-full flex items-center justify-center text-slate-400 text-sm py-24">
        No students match the criteria.
      </div>
    `;
    document.getElementById('admit-preview-status').innerText = 'No students selected';
    return;
  }

  listContainer.innerHTML = '';

  const selectAllDiv = document.createElement('div');
  selectAllDiv.className = 'flex items-center space-x-2 pb-2 mb-2 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10';
  selectAllDiv.innerHTML = `
    <input type="checkbox" id="admit-select-all" class="rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer">
    <span class="text-xs font-bold text-slate-700 dark:text-slate-300">Select All Students (${students.length})</span>
  `;
  listContainer.appendChild(selectAllDiv);

  students.forEach(s => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-lg text-slate-700 dark:text-slate-300 transition-colors';
    row.innerHTML = `
      <div class="flex items-center space-x-2 min-w-0">
        <input type="checkbox" data-admission-no="${s.admissionNo}" class="admit-student-checkbox rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer">
        <span class="text-xs truncate">${s.name} (Roll: ${s.rollNo || 'N/A'})</span>
      </div>
      <button type="button" class="text-[10px] text-amber-500 hover:text-amber-600 font-bold px-2 py-0.5 rounded border border-amber-500/20 hover:bg-amber-500/10 shrink-0 select-preview-btn" data-admission-no="${s.admissionNo}">Preview</button>
    `;
    listContainer.appendChild(row);
  });

  const selectAllCheckbox = document.getElementById('admit-select-all');
  const cbxs = listContainer.querySelectorAll('.admit-student-checkbox');
  
  selectAllCheckbox.addEventListener('change', () => {
    cbxs.forEach(cb => cb.checked = selectAllCheckbox.checked);
  });

  listContainer.querySelectorAll('.select-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const admissionNo = btn.getAttribute('data-admission-no');
      state.selectedAdmitPreviewAdmissionNo = admissionNo;
      renderAdmitCardPreview();
    });
  });

  const activeNos = students.map(s => s.admissionNo);
  if (!state.selectedAdmitPreviewAdmissionNo || !activeNos.includes(state.selectedAdmitPreviewAdmissionNo)) {
    state.selectedAdmitPreviewAdmissionNo = students[0].admissionNo;
  }

  const matchingCheckbox = listContainer.querySelector(`.admit-student-checkbox[data-admission-no="${state.selectedAdmitPreviewAdmissionNo}"]`);
  if (matchingCheckbox) {
    matchingCheckbox.checked = true;
  }

  renderAdmitCardPreview();
}

async function renderAdmitCardPreview(options = {}) {
  const refreshSettings = options?.refreshSettings !== false;
  const previewBox = document.getElementById('admit-live-preview-a4');
  const previewStatus = document.getElementById('admit-preview-status');
  const wrapper = document.getElementById('admit-preview-scroll-wrapper');
  const scaler = document.getElementById('admit-preview-scale-container');
  if (!previewBox || !previewStatus || !wrapper || !scaler) {
    const error = new Error('Admit Card preview container is missing from the page.');
    console.error('Admit Card preview failed:', error);
    return;
  }

  wrapper.style.display = 'flex';
  wrapper.style.visibility = 'visible';
  wrapper.style.opacity = '1';
  wrapper.style.minHeight = '600px';
  scaler.style.display = 'flex';
  scaler.style.visibility = 'visible';
  scaler.style.opacity = '1';
  scaler.style.width = '210mm';
  previewBox.style.display = 'block';
  previewBox.style.visibility = 'visible';
  previewBox.style.opacity = '1';
  previewBox.style.width = '210mm';
  previewBox.style.minHeight = '297mm';
  previewStatus.textContent = 'Loading preview...';
  previewBox.innerHTML = '<div class="h-full flex items-center justify-center text-slate-500 text-sm py-24">Loading preview...</div>';

  try {
    const selectedKey = String(state.selectedAdmitPreviewAdmissionNo || '').trim();
    const currentStudent = (state.allStudents || []).find(student => {
      const keys = [student.admissionNo, student.admission_number, student.studentId, student.id].map(value => String(value || '').trim());
      return selectedKey && keys.includes(selectedKey);
    });
    if (!currentStudent) throw new Error('Please select a student before opening the Admit Card preview.');

    if (refreshSettings) {
      const settingsObj = await ApiService.getSettings();
      admitCardSettingsCached = withSelectedAdmitCardSession(settingsObj?.admitCardSettings || admitCardSettingsCached || {});
    }
    if (!admitCardSettingsCached) admitCardSettingsCached = {};

    const examName = document.getElementById('admit-exam-select')?.value || 'Examination';
    const html = buildAdmitCardHTML(currentStudent, examName, admitCardSettingsCached);
    if (!String(html || '').trim()) throw new Error('The Admit Card template returned no preview content.');
    previewBox.innerHTML = html;
    await preloadAllImages(previewBox);
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    adjustAdmitCardPreviewScale();
    if (previewBox.getBoundingClientRect().width <= 0 || previewBox.getBoundingClientRect().height <= 0) throw new Error('The Admit Card preview container has zero width or height.');
    previewStatus.textContent = `Preview loaded successfully: ${currentStudent.name || currentStudent.studentName || selectedKey}`;
  } catch (error) {
    console.error('Admit Card preview failed:', error);
    previewStatus.textContent = `Preview failed: ${error.message}`;
    previewBox.innerHTML = `<div class="h-full flex items-center justify-center text-rose-600 text-sm font-semibold text-center px-6 py-24">Unable to load Admit Card preview: ${subjectHtmlEscape(error.message || 'Unknown preview error')}</div>`;
    adjustAdmitCardPreviewScale();
  }
}
function adjustAdmitCardPreviewScale() {
  const wrapper = document.getElementById('admit-preview-scroll-wrapper');
  const scaler = document.getElementById('admit-preview-scale-container');
  if (!wrapper || !scaler) return;

  const wrapperWidth = wrapper.clientWidth - 48; // padding offset
  const targetWidth = 794; // A4 210mm in pixels at 96 DPI approx
  
  if (wrapperWidth < targetWidth && wrapperWidth > 100) {
    const scale = wrapperWidth / targetWidth;
    scaler.style.transform = `scale(${scale})`;
    const targetHeight = 1123; // A4 297mm in pixels at 96 DPI approx
    wrapper.style.height = `${(targetHeight * scale) + 48}px`;
    wrapper.style.minHeight = '0';
  } else {
    scaler.style.transform = 'scale(1)';
    wrapper.style.height = 'auto';
    wrapper.style.minHeight = '600px';
  }
}

// Register window resize scaling handler
window.addEventListener('resize', adjustAdmitCardPreviewScale);

const QRCodeGenerator = (function() {
  const exp = [];
  const log = [];
  for (let i = 0; i < 8; i++) exp[i] = 1 << i;
  for (let i = 8; i < 256; i++) exp[i] = exp[i - 4] ^ exp[i - 5] ^ exp[i - 6] ^ exp[i - 8];
  for (let i = 0; i < 255; i++) log[exp[i]] = i;

  function glog(n) { if (n < 1) throw new Error("glog(" + n + ")"); return log[n]; }
  function gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return exp[n]; }

  class Polynomial {
    constructor(num, shift) {
      let offset = 0;
      while (offset < num.length && num[offset] == 0) offset++;
      this.num = new Array(num.length - offset + shift);
      for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
      for (let i = num.length - offset; i < this.num.length; i++) this.num[i] = 0;
    }
    getAt(i) { return this.num[i]; }
    getLength() { return this.num.length; }
    multiply(e) {
      const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
      for (let i = 0; i < this.getLength(); i++) {
        for (let j = 0; j < e.getLength(); j++) {
          num[i + j] ^= gexp(glog(this.getAt(i)) + glog(e.getAt(j)));
        }
      }
      return new Polynomial(num, 0);
    }
    mod(e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = glog(this.getAt(0)) - glog(e.getAt(0));
      const num = new Array(this.getLength());
      for (let i = 0; i < this.getLength(); i++) num[i] = this.getAt(i);
      for (let i = 0; i < e.getLength(); i++) num[i] ^= gexp(glog(e.getAt(i)) + ratio);
      return new Polynomial(num, 0).mod(e);
    }
  }

  class BitBuffer {
    constructor() { this.buffer = []; this.length = 0; }
    put(num, len) { for (let i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) == 1); }
    putBit(bit) {
      const idx = Math.floor(this.length / 8);
      if (this.buffer.length <= idx) this.buffer.push(0);
      if (bit) this.buffer[idx] |= (0x80 >>> (this.length % 8));
      this.length++;
    }
  }

  const typeNumber = 4;
  const moduleCount = 33;
  const dataCount = 80;
  const rsCount = 20;

  function getRSBlock() { return { totalCount: 1, dataCount: 80, rsCount: 20 }; }

  function makeBytes(text) {
    const buffer = new BitBuffer();
    buffer.put(4, 4);
    buffer.put(text.length, 8);
    for (let i = 0; i < text.length; i++) {
      buffer.put(text.charCodeAt(i), 8);
    }
    if (buffer.length + 4 <= dataCount * 8) buffer.put(0, 4);
    while (buffer.length % 8 != 0) buffer.putBit(false);
    while (true) {
      if (buffer.length >= dataCount * 8) break;
      buffer.put(0xEC, 8);
      if (buffer.length >= dataCount * 8) break;
      buffer.put(0x11, 8);
    }
    return buffer;
  }

  function createData(text) {
    const buffer = makeBytes(text);
    const rsBlock = getRSBlock();
    const dcCount = rsBlock.dataCount;
    const ecCount = rsBlock.rsCount;
    
    const data = new Array(dcCount);
    for (let i = 0; i < dcCount; i++) {
      data[i] = (buffer.buffer[i] || 0);
    }
    
    let rsPoly = new Polynomial(data, 0);
    let generator = new Polynomial([1], 0);
    for (let i = 0; i < ecCount; i++) {
      generator = generator.multiply(new Polynomial([1, gexp(i)], 0));
    }
    
    const mod = rsPoly.mod(generator);
    const ecData = new Array(ecCount).fill(0);
    for (let i = 0; i < mod.getLength(); i++) {
      ecData[i + ecCount - mod.getLength()] = mod.getAt(i);
    }
    
    return data.concat(ecData);
  }

  function fillFinderPattern(modules, r, c) {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        if (r + i <= -1 || moduleCount <= r + i || c + j <= -1 || moduleCount <= c + j) continue;
        if ((0 <= i && i <= 6 && (j == 0 || j == 6)) || (0 <= j && j <= 6 && (i == 0 || i == 6)) || (2 <= i && i <= 4 && 2 <= j && j <= 4)) {
          modules[r + i][c + j] = true;
        } else {
          modules[r + i][c + j] = false;
        }
      }
    }
  }

  function fillAlignmentPattern(modules, r, c) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) == 2 || Math.abs(j) == 2 || (i == 0 && j == 0)) {
          modules[r + i][c + j] = true;
        } else {
          modules[r + i][c + j] = false;
        }
      }
    }
  }

  function fillTimingPattern(modules) {
    for (let i = 8; i < moduleCount - 8; i++) {
      if (modules[i][6] != null) continue;
      modules[i][6] = (i % 2 == 0);
    }
    for (let j = 8; j < moduleCount - 8; j++) {
      if (modules[6][j] != null) continue;
      modules[6][j] = (j % 2 == 0);
    }
  }

  function getBchTypeInfo(data) {
    const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
    let d = data << 10;
    while (true) {
      let digit = 0;
      let temp = d;
      while (temp != 0) { digit++; temp >>>= 1; }
      let gDigit = 0;
      let gTemp = G15;
      while (gTemp != 0) { gDigit++; gTemp >>>= 1; }
      if (digit - gDigit < 0) break;
      d ^= (G15 << (digit - gDigit));
    }
    return ((data << 10) | d) ^ G15_MASK;
  }

  function fillTypeInfo(modules, maskPattern) {
    const data = (1 << 3) | maskPattern;
    const typeInfo = getBchTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      const bit = ((typeInfo >>> i) & 1) == 1;
      if (i < 6) modules[i][8] = bit;
      else if (i < 8) modules[i + 1][8] = bit;
      else modules[moduleCount - 15 + i][8] = bit;
    }
    for (let i = 0; i < 15; i++) {
      const bit = ((typeInfo >>> i) & 1) == 1;
      if (i < 8) modules[8][moduleCount - i - 1] = bit;
      else if (i < 9) modules[8][15 - i - 1 + 1] = bit;
      else modules[8][15 - i - 1] = bit;
    }
    modules[moduleCount - 8][8] = true;
  }

  function mapData(modules, data, maskPattern) {
    let inc = -1;
    let row = moduleCount - 1;
    let bitIndex = 0;
    let byteIndex = 0;
    for (let col = moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          const currentCol = col - c;
          if (modules[row][currentCol] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (((data[byteIndex] >>> (7 - bitIndex)) & 1) == 1);
            }
            let mask = false;
            switch (maskPattern) {
              case 0: mask = (row + currentCol) % 2 == 0; break;
              case 1: mask = row % 2 == 0; break;
              case 2: mask = currentCol % 3 == 0; break;
              case 3: mask = (row + currentCol) % 3 == 0; break;
              case 4: mask = (Math.floor(row / 2) + Math.floor(currentCol / 3)) % 2 == 0; break;
              case 5: mask = (row * currentCol) % 2 + (row * currentCol) % 3 == 0; break;
              case 6: mask = ((row * currentCol) % 2 + (row * currentCol) % 3) % 2 == 0; break;
              case 7: mask = ((row * currentCol) % 3 + (row + currentCol) % 2) % 2 == 0; break;
            }
            if (mask) dark = !dark;
            modules[row][currentCol] = dark;
            bitIndex++;
            if (bitIndex == 8) { bitIndex = 0; byteIndex++; }
          }
        }
        row += inc;
        if (row < 0 || moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  return {
    generateSVG: function(text, maskPattern = 0) {
      const modules = new Array(moduleCount);
      for (let i = 0; i < moduleCount; i++) modules[i] = new Array(moduleCount).fill(null);
      
      fillFinderPattern(modules, 0, 0);
      fillFinderPattern(modules, moduleCount - 7, 0);
      fillFinderPattern(modules, 0, moduleCount - 7);
      fillAlignmentPattern(modules, 6, 26);
      fillAlignmentPattern(modules, 26, 6);
      fillAlignmentPattern(modules, 26, 26);
      fillTimingPattern(modules);
      fillTypeInfo(modules, maskPattern);
      
      const data = createData(text);
      mapData(modules, data, maskPattern);

      const scale = 2;
      const totalSize = moduleCount * scale;
      let xml = `<svg viewBox="0 0 ${totalSize} ${totalSize}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">`;
      xml += `<rect width="${totalSize}" height="${totalSize}" fill="white"/>`;
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (modules[r][c]) {
            xml += `<rect x="${c * scale}" y="${r * scale}" width="${scale}" height="${scale}" fill="black"/>`;
          }
        }
      }
      xml += `</svg>`;
      return xml;
    }
  };
})();

function generateBarcodeSVG(text) {
  const code39 = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
    '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
    '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
    'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
    'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
    'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
    'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
    'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
    'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
    '-': '010000101', '.': '110000100', ' ': '011000100', '*': '010010100',
    '$': '010101000', '/': '010100010', '+': '010001010', '%': '000101010'
  };

  const cleanText = '*' + text.toUpperCase().trim() + '*';
  let totalWidth = 0;
  const narrow = 1;
  const wide = 3;
  const gap = 1;

  for (let c of cleanText) {
    const pattern = code39[c] || code39['*'];
    for (let i = 0; i < 9; i++) {
      const isWide = pattern[i] === '1';
      totalWidth += isWide ? wide : narrow;
    }
    totalWidth += gap;
  }
  totalWidth -= gap;

  let xml = `<svg viewBox="0 0 ${totalWidth + 10} 40" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">`;
  xml += `<rect width="${totalWidth + 10}" height="40" fill="white"/>`;
  let x = 5;
  for (let c of cleanText) {
    const pattern = code39[c] || code39['*'];
    for (let i = 0; i < 9; i++) {
      const isBar = i % 2 === 0;
      const isWide = pattern[i] === '1';
      const w = isWide ? wide : narrow;
      if (isBar) {
        xml += `<rect x="${x}" y="3" width="${w}" height="24" fill="black"/>`;
      }
      x += w;
    }
    x += gap;
  }
  xml += `<text x="${(totalWidth + 10)/2}" y="36" font-size="6" font-family="monospace" text-anchor="middle" fill="black">${text}</text>`;
  xml += `</svg>`;
  return xml;
}

function generateBarcodeImage(text) {
  const svg = generateBarcodeSVG(text);
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}

function generateQRCodeImage(text) {
  const svg = QRCodeGenerator.generateSVG(text);
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}

function resolveAdmitCardMediaUrl(url) {
  const value = String(url || '').trim();
  if (!value || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) return '';
  if (/^(data:|blob:|https?:\/\/)/i.test(value) || value.startsWith('//') || value.startsWith('/')) return value;
  return `/${value.replace(/^\.\//, '')}`;
}
function buildSingleStudentCardHTML(student, examName, settings) {
  if (!student) return '';
  const safe = value => subjectHtmlEscape(String(value ?? ''));
  const sourceStudent = student || {};
  const rawAdmissionNo = String(sourceStudent.admissionNo || sourceStudent.admission_number || sourceStudent.studentId || sourceStudent.id || '0001');
  const viewStudent = {
    name: safe(sourceStudent.name || sourceStudent.studentName || 'N/A'),
    admissionNo: safe(rawAdmissionNo),
    className: safe(sourceStudent.className || sourceStudent.class_name || sourceStudent.class || 'N/A'),
    section: safe(sourceStudent.section || sourceStudent.sectionName || sourceStudent.section_name || 'N/A')
  };
  const photoFallback = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="%23f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="24" font-family="sans-serif" fill="%2394a3b8">No Photo</text></svg>`;
  const photoSrc = resolveAdmitCardMediaUrl(sourceStudent.photo || sourceStudent.photoUrl || sourceStudent.photo_url) || photoFallback;
  const rawAdmNo = rawAdmissionNo.replace(/^GJV-\d{4}-/i, '').replace(/^GJV-/i, '');
  const admitCardNo = `GJV-AC-${new Date().getFullYear()}-${safe(rawAdmNo)}`;
  const safeSettings = withSelectedAdmitCardSession(settings || {});
  const session = safe(safeSettings.session);
  const centre = safe(safeSettings.centre || 'Garumara Jatiya Vidyalaya Campus');
  const instructionsFormatted = safe(safeSettings.instructions || '1. Candidates must bring their Printed Admit Card to the exam hall daily.\n2. Arrive 15 minutes prior to start time.\n3. Electronic devices are strictly prohibited.').replace(/\n/g, '<br>');
  const datesFormatted = safe(safeSettings.examDates || 'As per official school datesheet schedule.').replace(/\n/g, '<br>');
  const safeExamName = safe(examName || 'Examination');
  const principalSignatureName = safeSettings.principalSignatureName || 'Anarul Hussain';
  const principalSignatureSrc = withAdmitCardSignatureCacheBust(getAdmitCardSignatureUrl(safeSettings), safeSettings.principalSignatureUpdatedAt);
  const principalSignatureMarkup = principalSignatureSrc
    ? `<img src="${safe(principalSignatureSrc)}" alt="Principal Signature" crossorigin="anonymous" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';" style="display:block;width:120px;height:28px;object-fit:contain;object-position:center;margin:0 auto 2px auto;"><div style="display:none;font-family:'Great Vibes',cursive,'Brush Script MT',sans-serif;font-size:13px;color:#d97706;font-weight:bold;margin-bottom:2px;">${safe(principalSignatureName)}</div>`
    : `<div style="font-family: 'Great Vibes', cursive, 'Brush Script MT', sans-serif; font-size: 13px; color: #d97706; font-weight: bold; margin-bottom: 2px;">${safe(principalSignatureName)}</div>`;
  return `
    <div class="admit-card-container" style="width: 100%; max-width: 100%; height: 132mm; max-height: 132mm; border: 3px solid #0f172a; border-radius: 14px; padding: 20px 16px 12px 16px; margin-top: 2px; box-sizing: border-box; position: relative; background: #ffffff; color: #0f172a; overflow: visible; font-family: 'Segoe UI', Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between; page-break-inside: avoid; break-inside: avoid;">
      <style>
        .admit-card-container, .admit-card-container * { box-sizing: border-box !important; }
        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm 10mm 10mm; }
          .admit-card-container { page-break-inside: avoid !important; break-inside: avoid !important; overflow: visible !important; }
        }
      </style>

      <!-- 3. Background Watermark Layering (z-index: 0, opacity: 0.04, pointer-events: none, width: 80%, top: 35%) -->
      <div style="position: absolute; width: 80%; left: 10%; top: 35%; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; opacity: 0.04; z-index: 0; overflow: visible;">
        <span style="font-size: 48px; font-weight: 900; text-transform: uppercase; text-align: center; line-height: 1.05; letter-spacing: 4px; color: #0f172a; user-select: none;">${(window.currentSchool?.name || 'School ERP').replace(/\s+/g, '<br>')}</span>
      </div>

      <!-- 1. Header Section (2-Column Flexbox with explicit max-widths & padding guard) -->
      <div class="header-section" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; border-bottom: 2.5px solid #0f172a; padding-bottom: 6px; position: relative; z-index: 10; box-sizing: border-box; overflow: visible;">
        <!-- Left Side: School Logo & Info -->
        <div style="display: flex; align-items: center; max-width: 70%; overflow: visible;">
          <img src="${window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg')}" style="width: 48px; height: 48px; object-fit: contain; border-radius: 50%; border: 1.5px solid #cbd5e1; margin-right: 12px; flex-shrink: 0;" onerror="this.src='/neutral-school-logo.svg'">
          <div style="line-height: 1.2; overflow: visible;">
            <h1 style="font-size: 17px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.2px; color: #1e3a8a; margin: 0;">${window.currentSchool?.name || 'Garumara Jatiya Vidyalaya'}</h1>
            <p style="font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin: 1px 0 0 0;">${window.currentSchool ? (window.currentSchool.establishedYear ? 'ESTD ' + window.currentSchool.establishedYear + ' | ' : '') + (window.currentSchool.address || '') : 'ESTD 2023 | Nagaon, Assam - 782140'}</p>
            <p style="font-size: 8.5px; font-weight: 600; color: #64748b; margin: 1px 0 0 0;">${window.currentSchool ? 'Helpline: ' + (window.currentSchool.phone || 'N/A') + (window.currentSchool.email ? ' | Email: ' + window.currentSchool.email : '') : 'Helpline: +91 8099456097 | Email: info@garumarajatiyavidyalaya.in'}</p>
          </div>
        </div>
        
        <!-- Right Side: Top-Right UNIT TEST & Session Badge -->
        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-start; max-width: 28%; flex-shrink: 0; margin-top: 1px; overflow: visible;">
          <div style="background: #1e293b; color: #ffffff; font-weight: 800; font-size: 9px; letter-spacing: 0.8px; text-transform: uppercase; padding: 3.5px 10px; border-radius: 6px; margin-bottom: 2px; white-space: nowrap;">
            ${safeExamName}
          </div>
          <span style="font-size: 8.5px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;">Session: ${session}</span>
        </div>
      </div>

      <!-- 2. Examination Badge Header (Centered Orange Pill Badge with margin: 10px auto 16px auto) -->
      <div class="exam-badge" style="text-align: center; margin: 10px auto 14px auto; width: 100%; display: flex; justify-content: center; position: relative; z-index: 10; box-sizing: border-box; overflow: visible;">
        <span style="background-color: #d96b00; color: #ffffff; padding: 5px 22px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; display: inline-block; letter-spacing: 1.5px; border: 1.5px solid #0f172a; box-shadow: 0 1px 2px rgba(0,0,0,0.1); max-width: 90%;">
          EXAMINATION ADMIT CARD
        </span>
      </div>

      <!-- 3. Student Details Grid (z-index: 2 for 100% sharpness over watermark) & Photo Box -->
      <div class="student-info-grid" style="display: flex; gap: 12px; align-items: flex-start; width: 100%; position: relative; z-index: 2; box-sizing: border-box; overflow: visible;">
        <!-- Student Information 2-Column Grid -->
        <div style="flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px 12px; font-size: 11.5px; line-height: 1.25; overflow: visible;">
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Student Name</span>
            <span style="font-weight: 900; color: #0f172a; text-transform: uppercase; font-size: 13px; display: block; overflow: visible; white-space: normal; word-break: break-word;">${viewStudent.name}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Admission Number</span>
            <span style="font-weight: 800; color: #0f172a; font-family: monospace; font-size: 12.5px; display: block; overflow: visible;">${viewStudent.admissionNo}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Class & Section</span>
            <span style="font-weight: 900; color: #1e3a8a; font-size: 12.5px; display: block; overflow: visible;">${viewStudent.className} - ${viewStudent.section}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Roll Number</span>
            <span style="font-weight: 900; color: #0f172a; font-size: 12.5px; display: block; overflow: visible;">${student.rollNo || 'N/A'}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Date of Birth</span>
            <span style="font-weight: 800; color: #0f172a; font-size: 11.5px; display: block; overflow: visible;">${student.dob || 'N/A'}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Father's Name</span>
            <span style="font-weight: 800; color: #0f172a; font-size: 11.5px; display: block; overflow: visible; white-space: normal; word-break: break-word;">${student.fatherName || 'N/A'}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Exam Centre</span>
            <span style="font-weight: 800; color: #0f172a; font-size: 11.5px; display: block; overflow: visible; white-space: normal; word-break: break-word;">${centre}</span>
          </div>
          <div>
            <span style="color: #64748b; display: block; font-size: 9.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 1px;">Admit Card Number</span>
            <span style="font-family: monospace; font-weight: 800; color: #d97706; font-size: 10.5px; display: block; overflow: visible;">${admitCardNo}</span>
          </div>
        </div>

        <!-- Student Photo Box -->
        <div style="width: 80px; height: 96px; border: 2px solid #0f172a; border-radius: 8px; overflow: hidden; background: #f8fafc; flex-shrink: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <img alt="Student Photo" crossorigin="anonymous" style="width: 100%; height: 100%; object-fit: cover; display:block;" src="${safe(photoSrc)}" onerror="this.style.display='none';">
        </div>
      </div>

      <!-- 4. Lower Section: Exam Schedule & Corrected Candidate Instructions ("Candidates must bring their Printed Admit Card...") -->
      <div style="margin-top: 4px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; border-top: 1.5px solid #cbd5e1; border-bottom: 1.5px solid #cbd5e1; padding: 4px 0; position: relative; z-index: 10; font-size: 8.5px; line-height: 1.3; box-sizing: border-box;">
        <div>
          <span style="font-weight: 900; color: #0f172a; text-transform: uppercase; display: block; margin-bottom: 1px; letter-spacing: 0.4px;">📅 Exam Schedule / Dates:</span>
          <div style="color: #334155; font-weight: 600;">${datesFormatted || 'As per official school datesheet schedule.'}</div>
        </div>
        <div>
          <span style="font-weight: 900; color: #0f172a; text-transform: uppercase; display: block; margin-bottom: 1px; letter-spacing: 0.4px;">⊠️ Candidate Instructions:</span>
          <div style="color: #334155; text-align: justify; font-weight: 600;">${instructionsFormatted}</div>
        </div>
      </div>

      <!-- 5. Signatures Footer -->
      <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; font-weight: 800; position: relative; z-index: 10; box-sizing: border-box;">
        <div style="text-align: center; width: 110px;">
          <span style="color: #334155; display: block; margin-top: 14px;">Candidate Signature</span>
        </div>
        <div style="text-align: center; width: 65px;">
          <div style="width: 30px; height: 30px; border: 1.5px dashed #94a3b8; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 7px; color: #64748b; margin: 0 auto; user-select: none; font-weight: bold;">
            Seal
          </div>
        </div>
        <div style="text-align: center; width: 130px;">
${principalSignatureMarkup}
          <span style="color: #334155; display: block;">Principal / Superintendent</span>
        </div>
      </div>

    </div>
  `;
}

function buildPairAdmitCardsHTML(student1, student2, examName, settings) {
  const topCard = buildSingleStudentCardHTML(student1, examName, settings);
  
  if (!student2) {
    // 5. Single Student Card 2-Up Alignment: Center vertically on A4 page without cut separator line
    return `
      <div class="admit-card-2up-wrapper" style="width: 210mm; height: 297mm; max-height: 297mm; padding: 12mm 10mm; box-sizing: border-box; background: #ffffff; color: #000000; font-family: 'Segoe UI', Arial, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; overflow: hidden; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid;">
        <div style="width: 100%;">
          ${topCard}
        </div>
      </div>
    `;
  }

  const bottomCard = buildSingleStudentCardHTML(student2, examName, settings);
  return `
    <div class="admit-card-2up-wrapper" style="width: 210mm; height: 297mm; max-height: 297mm; padding: 6mm 10mm; box-sizing: border-box; background: #ffffff; color: #000000; font-family: 'Segoe UI', Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid;">
      <!-- TOP HALF: STUDENT 1 -->
      ${topCard}

      <!-- CUT LINE -->
      <div style="height: 5mm; border-top: 1.5px dashed #64748b; margin: 1.5mm 0; position: relative; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <span style="background: #ffffff; padding: 0 10px; font-size: 7.5px; font-family: monospace; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; position: relative; top: -1px;">
          ✂ CUT ALONG DOTTED LINE
        </span>
      </div>

      <!-- BOTTOM HALF: STUDENT 2 -->
      ${bottomCard}
    </div>
  `;
}

function buildBatchAdmitCardsHTML(studentList, examName, settings) {
  let fullHtml = '';
  for (let i = 0; i < studentList.length; i += 2) {
    const s1 = studentList[i];
    const s2 = studentList[i + 1] || null;
    const pageHtml = buildPairAdmitCardsHTML(s1, s2, examName, settings);
    fullHtml += pageHtml;
  }
  return fullHtml;
}

async function preloadAllImages(element) {
  const imgs = element.querySelectorAll('img');
  const promises = Array.from(imgs).map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (!img.src) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        console.warn('Image preload timed out:', img.src);
        resolve();
      }, 2000); // 2 seconds timeout max per image
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  });
  await Promise.all(promises);
  await new Promise(r => setTimeout(r, 100));
}

function buildAdmitCardHTML(student, examName, settings) {
  return buildPairAdmitCardsHTML(student, null, examName, settings);
}

function getAdmitCardSignatureUrl(settings = admitCardSettingsCached) {
  return String(settings?.principalSignatureUrl || '').trim();
}

function resolveAdmitCardSignatureAssetUrl(url) {
  const value = String(url || '').trim();
  if (!value || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) return '';
  if (/^(data:|blob:)/i.test(value)) return value;
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) return value;
  return value.startsWith('/') ? value : `/${value.replace(/^\.\//, '')}`;
}

function isAdmitCardSignaturePublicUrl(url) {
  const resolved = resolveAdmitCardSignatureAssetUrl(url);
  if (!resolved || /^(data:|blob:)/i.test(resolved)) return false;
  try {
    const parsed = new URL(resolved, window.location.origin);
    return /^https?:$/.test(parsed.protocol) && parsed.pathname.startsWith('/uploads/admit-card-signatures/');
  } catch {
    return false;
  }
}
function withAdmitCardSignatureCacheBust(url, version) {
  const value = resolveAdmitCardSignatureAssetUrl(url);
  if (!value || /^(data:|blob:)/i.test(value)) return value;
  const stamp = encodeURIComponent(String(version || Date.now()));
  return `${value}${value.includes('?') ? '&' : '?'}v=${stamp}`;
}
function validateAdmitCardSignatureFile(file) {
  if (!file) throw new Error('Please select a Principal signature image.');
  const extension = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedExtensions.includes(extension) || !allowedTypes.includes(String(file.type || '').toLowerCase())) throw new Error('Only PNG, JPG, JPEG, or WEBP signature files are allowed.');
  if (file.size <= 0) throw new Error('The selected signature image is empty.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Signature image must not exceed 2 MB.');
}
function updateAdmitCardSignatureSettingsUi(source, message = '') {
  const preview = document.getElementById('admit-signature-preview');
  const wrapper = document.getElementById('admit-signature-preview-wrap');
  const removeButton = document.getElementById('admit-signature-remove-btn');
  const status = document.getElementById('admit-signature-status');
  const value = String(source || '').trim();
  if (preview && wrapper) {
    if (value) {
      preview.src = value;
      wrapper.classList.remove('hidden');
    } else {
      preview.removeAttribute('src');
      wrapper.classList.add('hidden');
    }
  }
  if (removeButton) removeButton.classList.toggle('hidden', !getAdmitCardSignatureUrl());
  if (status) status.textContent = message || (value ? 'Saved signature loaded.' : 'PNG, JPG, JPEG or WEBP. Maximum 2 MB.');
}
// Global Event Initialization for Filters and Actions
function initAdmitCardFilters() {
  const examSelect = document.getElementById('admit-exam-select');
  const sessionSelect = document.getElementById('admit-set-session');
  const classSelect = document.getElementById('admit-class-select');
  const sectionSelect = document.getElementById('admit-section-select');
  const searchInput = document.getElementById('admit-student-search');

  if(sessionSelect&&!sessionSelect.dataset.sessionBound){sessionSelect.dataset.sessionBound='true';sessionSelect.addEventListener('change',async()=>{const x=getSelectedAdmitCardSession();localStorage.setItem(CARD_SESSION_STORAGE_KEYS.admit,x.id);try{await reloadAdmitCardSessionData()}catch(error){console.error('Admit Card Academic Session switch failed:',error);const status=document.getElementById('admit-preview-status');if(status)status.textContent='Session load failed: '+error.message}})}
  if (examSelect) examSelect.addEventListener('change', renderAdmitCardPreview);
  if (classSelect) classSelect.addEventListener('change', filterAndRenderAdmitStudents);
  if (sectionSelect) sectionSelect.addEventListener('change', filterAndRenderAdmitStudents);
  if (searchInput) searchInput.addEventListener('input', filterAndRenderAdmitStudents);
  const signatureInput = document.getElementById('admit-signature-file');
  const signatureUploadButton = document.getElementById('admit-signature-upload-btn');
  const signatureRemoveButton = document.getElementById('admit-signature-remove-btn');
  if (signatureInput) {
    signatureInput.addEventListener('change', () => {
      const file = signatureInput.files?.[0];
      if (pendingAdmitCardSignaturePreviewUrl) URL.revokeObjectURL(pendingAdmitCardSignaturePreviewUrl);
      pendingAdmitCardSignaturePreviewUrl = '';
      pendingAdmitCardSignatureFile = null;
      if (signatureUploadButton) signatureUploadButton.disabled = true;
      if (!file) {
        updateAdmitCardSignatureSettingsUi(getAdmitCardSignatureUrl());
        return;
      }
      try {
        validateAdmitCardSignatureFile(file);
        pendingAdmitCardSignatureFile = file;
        pendingAdmitCardSignaturePreviewUrl = URL.createObjectURL(file);
        updateAdmitCardSignatureSettingsUi(pendingAdmitCardSignaturePreviewUrl, 'Preview ready. Click Upload Signature to save it.');
        if (signatureUploadButton) signatureUploadButton.disabled = false;
      } catch (error) {
        signatureInput.value = '';
        updateAdmitCardSignatureSettingsUi(getAdmitCardSignatureUrl(), error.message);
      }
    });
  }
  if (signatureUploadButton) {
    signatureUploadButton.addEventListener('click', async () => {
      const file = pendingAdmitCardSignatureFile;
      if (!file) return updateAdmitCardSignatureSettingsUi(getAdmitCardSignatureUrl(), 'Please select a Principal signature image first.');
      signatureUploadButton.disabled = true;
      signatureInput.disabled = true;
      if (signatureRemoveButton) signatureRemoveButton.disabled = true;
      updateAdmitCardSignatureSettingsUi(pendingAdmitCardSignaturePreviewUrl, 'Uploading signature...');
      try {
        const response = await ApiService.uploadAdmitCardSignature(file);
        const savedSignatureUrl = String(response.signatureUrl || '').trim();
        if (!response.success || !isAdmitCardSignaturePublicUrl(savedSignatureUrl)) throw new Error('The server did not return a valid saved signature URL.');
        admitCardSettingsCached = {
          ...(admitCardSettingsCached || {}),
          ...(response.admitCardSettings || {}),
          principalSignatureUrl: savedSignatureUrl,
          principalSignatureUpdatedAt: response.admitCardSettings?.principalSignatureUpdatedAt || new Date().toISOString()
        };
        if (pendingAdmitCardSignaturePreviewUrl) URL.revokeObjectURL(pendingAdmitCardSignaturePreviewUrl);
        pendingAdmitCardSignaturePreviewUrl = '';
        pendingAdmitCardSignatureFile = null;
        signatureInput.value = '';
        updateAdmitCardSignatureSettingsUi(withAdmitCardSignatureCacheBust(getAdmitCardSignatureUrl(), admitCardSettingsCached.principalSignatureUpdatedAt), 'Signature uploaded and saved successfully.');
        await renderAdmitCardPreview({ refreshSettings: false });
      } catch (error) {
        console.error('Admit Card Principal signature upload failed:', error);
        updateAdmitCardSignatureSettingsUi(pendingAdmitCardSignaturePreviewUrl || getAdmitCardSignatureUrl(), error.message || 'Signature upload failed.');
      } finally {
        signatureInput.disabled = false;
        signatureUploadButton.disabled = !pendingAdmitCardSignatureFile;
        if (signatureRemoveButton) signatureRemoveButton.disabled = false;
      }
    });
  }
  if (signatureRemoveButton) {
    signatureRemoveButton.addEventListener('click', async () => {
      if (!getAdmitCardSignatureUrl()) return;
      if (!window.confirm('Delete the saved Admit Card Principal signature image?')) return;
      signatureRemoveButton.disabled = true;
      if (signatureInput) signatureInput.disabled = true;
      try {
        const response = await ApiService.deleteAdmitCardSignature();
        admitCardSettingsCached = response.admitCardSettings || { ...(admitCardSettingsCached || {}), principalSignatureUrl: '' };
        if (pendingAdmitCardSignaturePreviewUrl) URL.revokeObjectURL(pendingAdmitCardSignaturePreviewUrl);
        pendingAdmitCardSignaturePreviewUrl = '';
        pendingAdmitCardSignatureFile = null;
        if (signatureInput) signatureInput.value = '';
        if (signatureUploadButton) signatureUploadButton.disabled = true;
        updateAdmitCardSignatureSettingsUi('', 'Signature deleted successfully. The default signature name will be used.');
        renderAdmitCardPreview();
      } catch (error) {
        console.error('Admit Card Principal signature deletion failed:', error);
        updateAdmitCardSignatureSettingsUi(withAdmitCardSignatureCacheBust(getAdmitCardSignatureUrl(), admitCardSettingsCached?.principalSignatureUpdatedAt), error.message || 'Signature deletion failed.');
      } finally {
        signatureRemoveButton.disabled = false;
        if (signatureInput) signatureInput.disabled = false;
      }
    });
  }

  const saveSettingsBtn = document.getElementById('admit-save-settings-btn');
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      try {
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.innerText = 'Saving...';

        const updatedSettings = {
          admitCardSettings: {
            session: getSelectedAdmitCardSession().name,
            academic_session_id: getSelectedAdmitCardSession().id,
            centre: document.getElementById('admit-set-centre').value,
            principalSignatureName: document.getElementById('admit-set-principal').value,
            examDates: document.getElementById('admit-set-dates').value,
            instructions: document.getElementById('admit-set-instructions').value
          }
        };

        const res = await ApiService.saveSettings(updatedSettings);
        admitCardSettingsCached = res.admitCardSettings;
        alert('Admit card template settings saved successfully!');
        renderAdmitCardPreview();
      } catch (err) {
        console.error('Failed to save settings:', err);
        alert('Failed to save template settings: ' + err.message);
      } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.innerText = 'Save Template Settings';
      }
    });
  }

  const previewBtn = document.getElementById('admit-btn-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', async () => {
      const checkedStudent = document.querySelector('#admit-student-list .admit-student-checkbox:checked');
      if (checkedStudent?.dataset?.admissionNo) state.selectedAdmitPreviewAdmissionNo = checkedStudent.dataset.admissionNo;
      await renderAdmitCardPreview();
    });
  }
  const previewAllBtn = document.getElementById('admit-btn-preview-all');
  if (previewAllBtn) {
    previewAllBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('#admit-student-list .admit-student-checkbox:checked');
      if (checkedBoxes.length === 0) {
        return alert('Please select one or more students using checkboxes to preview all.');
      }

      const selectedNos = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-admission-no'));
      const examName = document.getElementById('admit-exam-select').value;

      try {
        const settingsObj = await ApiService.getSettings();
        admitCardSettingsCached = settingsObj.admitCardSettings || {};
      } catch (err) {
        console.error('Failed to fetch settings for preview all:', err);
      }

      const selectedStudents = selectedNos.map(admNo => state.allStudents.find(s => s.admissionNo === admNo)).filter(Boolean);
      const previewHtml = buildBatchAdmitCardsHTML(selectedStudents, examName, admitCardSettingsCached);

      const previewBox = document.getElementById('admit-live-preview-a4');
      previewBox.innerHTML = previewHtml;
      document.getElementById('admit-preview-status').innerText = `Previewing: All Selected (${selectedStudents.length} students paired on A4 pages)`;
    });
  }



  const printBtn = document.getElementById('admit-btn-print');
  if (printBtn) {
    printBtn.addEventListener('click', async () => {
      const currentStudent = state.allStudents.find(s => s.admissionNo === state.selectedAdmitPreviewAdmissionNo);
      if (!currentStudent) return alert('No student selected for printing.');
      const printContainer = document.getElementById('print-admitcard-template');
      if (!printContainer) return alert('Admit Card print container is unavailable.');
      printBtn.disabled = true;
      try {
        const settingsObj = await ApiService.getSettings();
        admitCardSettingsCached = settingsObj.admitCardSettings || admitCardSettingsCached || {};
        printContainer.innerHTML = buildAdmitCardHTML(currentStudent, document.getElementById('admit-exam-select').value, admitCardSettingsCached);
        printContainer.classList.remove('hidden');
        printContainer.classList.add('print-active');
        await preloadAllImages(printContainer);
        if (document.fonts?.ready) await document.fonts.ready;
        window.print();
      } catch (error) {
        console.error('Admit Card print failed:', error);
        alert('Admit Card print failed: ' + error.message);
      } finally {
        printContainer.classList.remove('print-active');
        printContainer.classList.add('hidden');
        printContainer.innerHTML = '';
        printBtn.disabled = false;
      }
    });
  }
  const downloadBtn = document.getElementById('admit-btn-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const currentStudent = state.allStudents.find(s => s.admissionNo === state.selectedAdmitPreviewAdmissionNo);
      if (!currentStudent) return alert('No student selected for download.');

      const examName = document.getElementById('admit-exam-select').value;

      try {
        const settingsObj = await ApiService.getSettings();
        admitCardSettingsCached = settingsObj.admitCardSettings || {};
      } catch (err) {
        console.error('Failed to fetch settings for download:', err);
      }

      downloadBtn.disabled = true;
      downloadBtn.innerText = 'Exporting PDF...';

      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '210mm';
      container.style.background = '#ffffff';
      container.style.color = '#000000';
      container.style.opacity = '1';
      container.style.zIndex = '99999';
      container.innerHTML = buildPairAdmitCardsHTML(currentStudent, null, examName, admitCardSettingsCached);
      document.body.appendChild(container);

      try {
        await preloadAllImages(container);
        const html2canvasFn = await getHtml2Canvas();
        
        const canvas = await html2canvasFn(container, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.98);
        const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        const pdf = new jsPDFClass({ unit: 'mm', format: [210, 297], orientation: 'portrait' });

        // 100% Fixed Aspect Ratio Lock
        const canvasRatio = canvas.width / canvas.height;
        let pdfWidth = 210;
        let pdfHeight = 210 / canvasRatio;
        let offsetX = 0;
        let offsetY = 0;

        if (pdfHeight > 297) {
          pdfHeight = 297;
          pdfWidth = 297 * canvasRatio;
          offsetX = (210 - pdfWidth) / 2;
        } else {
          offsetY = (297 - pdfHeight) / 2;
        }

        pdf.addImage(imgData, 'JPEG', offsetX, offsetY, pdfWidth, pdfHeight);

        const filename = `AdmitCard_${currentStudent.name.replace(/\s+/g, '_')}_${currentStudent.className.replace(/\s+/g, '_')}.pdf`;
        pdf.save(filename);
      } catch (err) {
        console.error('PDF export failed:', err);
        alert('PDF generation failed: ' + err.message);
      } finally {
        if (container && container.parentNode) {
          container.parentNode.removeChild(container);
        }
        downloadBtn.disabled = false;
        downloadBtn.innerText = 'Download PDF';
      }
    });
  }

async function getHtml2Canvas() {
  if (typeof window !== 'undefined' && typeof window.html2canvas === 'function') {
    return window.html2canvas;
  }
  if (typeof html2canvas === 'function') {
    return html2canvas;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => {
      if (typeof window.html2canvas === 'function') {
        resolve(window.html2canvas);
      } else {
        reject(new Error('html2canvas loaded but window.html2canvas function is unavailable.'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load html2canvas library from CDN.'));
    document.head.appendChild(script);
  });
}

// Global case-insensitive aliases for html2canvas retriever function
if (typeof window !== 'undefined') {
  window.getHtml2Canvas = getHtml2Canvas;
  window.gethtml2Canvas = getHtml2Canvas;
}

async function generateUnlimitedBulkPDF(selectedStudents, examName, settings, btn) {
  const totalStudents = selectedStudents.length;
  const totalPages = Math.ceil(totalStudents / 2);
  btn.disabled = true;

  const PAGES_PER_CHUNK = 5;
  const STUDENTS_PER_CHUNK = PAGES_PER_CHUNK * 2;
  const totalChunks = Math.ceil(totalStudents / STUDENTS_PER_CHUNK);

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '210mm';
  container.style.background = '#ffffff';
  container.style.color = '#000000';
  container.style.opacity = '1';
  container.style.zIndex = '99999';
  document.body.appendChild(container);

  try {
    const html2canvasFn = await window.getHtml2Canvas();
    if (!html2canvasFn) {
      throw new Error('html2canvas library is not initialized.');
    }

    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    let pdfDoc = null;

    for (let c = 0; c < totalChunks; c++) {
      const startIdx = c * STUDENTS_PER_CHUNK;
      const chunkStudents = selectedStudents.slice(startIdx, startIdx + STUDENTS_PER_CHUNK);
      
      const startPageNum = (c * PAGES_PER_CHUNK) + 1;
      const endPageNum = Math.min((c + 1) * PAGES_PER_CHUNK, totalPages);
      
      const pct = Math.round((c / totalChunks) * 100);
      btn.innerText = `Exporting PDF (${pct}%): Pages ${startPageNum}-${endPageNum} of ${totalPages}...`;

      container.innerHTML = buildBatchAdmitCardsHTML(chunkStudents, examName, settings);
      await preloadAllImages(container);

      const canvas = await html2canvasFn(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0
      });

      const chunkPages = Math.ceil(chunkStudents.length / 2);
      const singlePageCanvasHeight = canvas.height / chunkPages;

      for (let p = 0; p < chunkPages; p++) {
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = singlePageCanvasHeight;
        const ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          canvas,
          0, p * singlePageCanvasHeight, canvas.width, singlePageCanvasHeight,
          0, 0, canvas.width, singlePageCanvasHeight
        );

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.98);

        // Aspect ratio lock per page canvas
        const pageRatio = pageCanvas.width / pageCanvas.height;
        let pdfWidth = 210;
        let pdfHeight = 210 / pageRatio;
        let offsetX = 0;
        let offsetY = 0;

        if (pdfHeight > 297) {
          pdfHeight = 297;
          pdfWidth = 297 * pageRatio;
          offsetX = (210 - pdfWidth) / 2;
        } else {
          offsetY = (297 - pdfHeight) / 2;
        }

        if (!pdfDoc) {
          if (jsPDFClass) {
            pdfDoc = new jsPDFClass({ unit: 'mm', format: [210, 297], orientation: 'portrait' });
            pdfDoc.addImage(imgData, 'JPEG', offsetX, offsetY, pdfWidth, pdfHeight);
          } else {
            pdfDoc = await html2pdf().set({ margin: 0, jsPDF: { unit: 'mm', format: [210, 297], orientation: 'portrait' } }).from(container).toPdf().get('pdf');
          }
        } else {
          pdfDoc.addPage([210, 297], 'portrait');
          pdfDoc.addImage(imgData, 'JPEG', offsetX, offsetY, pdfWidth, pdfHeight);
        }
      }

      container.innerHTML = '';
      await new Promise(r => setTimeout(r, 10));
    }

    btn.innerText = 'Saving PDF File...';
    const filename = `AdmitCards_Bulk_${examName.replace(/\s+/g, '_')}_${totalStudents}_Students.pdf`;
    pdfDoc.save(filename);

  } catch (err) {
    console.error('Bulk PDF Export Error:', err);
    try {
      btn.innerText = 'Falling back to standard PDF export...';
      const fallbackHtml = buildBatchAdmitCardsHTML(selectedStudents, examName, settings);
      container.innerHTML = fallbackHtml;
      await preloadAllImages(container);
      const filename = `AdmitCards_Bulk_${examName.replace(/\s+/g, '_')}_${totalStudents}_Students.pdf`;
      const opt = {
        margin:       0,
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF:        { unit: 'mm', format: [210, 297], orientation: 'portrait' }
      };
      await html2pdf().set(opt).from(container).save();
    } catch (fallbackErr) {
      alert('Bulk PDF export failed: ' + fallbackErr.message);
    }
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    btn.disabled = false;
    btn.innerText = 'Download All';
  }
}

  const downloadAllBtn = document.getElementById('admit-btn-download-all');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('#admit-student-list .admit-student-checkbox:checked');
      if (checkedBoxes.length === 0) {
        return alert('Please select one or more students using checkboxes to download all.');
      }

      const selectedNos = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-admission-no'));
      const examName = document.getElementById('admit-exam-select').value;

      try {
        const settingsObj = await ApiService.getSettings();
        admitCardSettingsCached = settingsObj.admitCardSettings || {};
      } catch (err) {
        console.error('Failed to fetch settings for download all:', err);
      }

      const selectedStudents = selectedNos.map(admNo => state.allStudents.find(s => s.admissionNo === admNo)).filter(Boolean);
      await generateUnlimitedBulkPDF(selectedStudents, examName, admitCardSettingsCached, downloadAllBtn);
    });
  }


}

// Automatically trigger filters setup
initAdmitCardFilters();

// =========================================================================
// 13. STUDENT ID CARD GENERATOR MODULE
// =========================================================================
let idCardSettingsCached = null;

async function loadIdCardsTab() {
  try {
    const previewStatus = document.getElementById('admit-preview-status');
    if (previewStatus) previewStatus.textContent = 'Loading preview...';
    const settings = await ApiService.getSettings();
    idCardSettingsCached = settings.idCardSettings || {
      session: getCurrentAcademicSession(),
      principalSignatureName: "Anarul Hussain"
    };

    await populateCardSessionSelector('idcard-set-session', CARD_SESSION_STORAGE_KEYS.idcard);
    document.getElementById('idcard-set-principal').value = idCardSettingsCached.principalSignatureName || '';
    updateIdCardSignatureSettingsUi(idCardSettingsCached.principalSignatureImage || '');

    await reloadIdCardSessionData();
  } catch (err) {
    console.error('Failed to load ID Cards tab data:', err);
    alert('Failed to load ID Cards parameters: ' + err.message);
  }
}

function filterAndRenderIdCardsStudents() {
  const targetClass = document.getElementById('idcard-class-select').value;
  const targetSection = document.getElementById('idcard-section-select').value;
  const searchVal = document.getElementById('idcard-student-search').value.toLowerCase().trim();

  const filtered = (state.allStudents || []).filter(s => {
    const studentClass = String(s.className || '').trim();
    const studentSection = String(s.section || '').replace(/^Section\s+/i, '').trim();
    const matchClass = !targetClass || studentClass === targetClass;
    const matchSection = !targetSection || studentSection === targetSection;
    const searchable = `${s.name || ''} ${s.admissionNo || ''} ${s.rollNo || ''}`.toLowerCase();
    const matchSearch = !searchVal || searchable.includes(searchVal);
    return matchClass && matchSection && matchSearch;
  });

  renderIdCardsStudentChecklist(filtered);
}

function renderIdCardsStudentChecklist(students) {
  const listContainer = document.getElementById('idcard-student-list');
  if (!listContainer) return;

  if (students.length === 0) {
    listContainer.innerHTML = `<p class="text-slate-400 text-xs text-center py-4">No matching students found.</p>`;
    document.getElementById('idcard-live-preview-a4').innerHTML = `
      <div class="h-full flex items-center justify-center text-slate-400 text-sm py-24">
        No students match the criteria.
      </div>
    `;
    document.getElementById('idcard-preview-status').innerText = 'No students selected';
    return;
  }

  listContainer.innerHTML = '';

  const selectAllDiv = document.createElement('div');
  selectAllDiv.className = 'flex items-center space-x-2 pb-2 mb-2 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10';
  selectAllDiv.innerHTML = `
    <input type="checkbox" id="idcard-select-all" class="rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer">
    <span class="text-xs font-bold text-slate-700 dark:text-slate-300">Select All Students (${students.length})</span>
  `;
  listContainer.appendChild(selectAllDiv);

  students.forEach(s => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-lg text-slate-700 dark:text-slate-300 transition-colors';
    row.innerHTML = `
      <div class="flex items-center space-x-2 min-w-0">
        <input type="checkbox" data-admission-no="${s.admissionNo}" class="idcard-student-checkbox rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer">
        <span class="text-xs truncate">${s.name} (Roll: ${s.rollNo || 'N/A'})</span>
      </div>
      <button type="button" class="text-[10px] text-amber-500 hover:text-amber-600 font-bold px-2 py-0.5 rounded border border-amber-500/20 hover:bg-amber-500/10 shrink-0 idcard-preview-btn" data-admission-no="${s.admissionNo}">Preview</button>
    `;
    listContainer.appendChild(row);
  });

  const selectAllCheckbox = document.getElementById('idcard-select-all');
  const cbxs = listContainer.querySelectorAll('.idcard-student-checkbox');
  
  selectAllCheckbox.addEventListener('change', () => {
    cbxs.forEach(cb => cb.checked = selectAllCheckbox.checked);
  });

  listContainer.querySelectorAll('.idcard-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const admissionNo = btn.getAttribute('data-admission-no');
      state.selectedIdCardPreviewAdmissionNo = admissionNo;
      renderIdCardsPreview();
    });
  });

  const activeNos = students.map(s => s.admissionNo);
  if (!state.selectedIdCardPreviewAdmissionNo || !activeNos.includes(state.selectedIdCardPreviewAdmissionNo)) {
    state.selectedIdCardPreviewAdmissionNo = students[0].admissionNo;
  }

  const matchingCheckbox = listContainer.querySelector(`.idcard-student-checkbox[data-admission-no="${state.selectedIdCardPreviewAdmissionNo}"]`);
  if (matchingCheckbox) {
    matchingCheckbox.checked = true;
  }

  renderIdCardsPreview();
}

async function renderIdCardsPreview() {
  const previewBox = document.getElementById('idcard-live-preview-a4');
  if (!previewBox) return;

  const currentStudent = state.allStudents.find(s => s.admissionNo === state.selectedIdCardPreviewAdmissionNo);
  if (!currentStudent) {
    previewBox.innerHTML = `
      <div class="h-full flex items-center justify-center text-slate-400 text-sm py-24">
        Please select a student to preview.
      </div>
    `;
    document.getElementById('idcard-preview-status').innerText = 'No student selected';
    adjustIdCardPreviewScale();
    return;
  }

  document.getElementById('idcard-preview-status').innerText = `Previewing: ${currentStudent.name}`;

  try {
    const settingsObj = await ApiService.getSettings();
    idCardSettingsCached = settingsObj.idCardSettings || {};
  } catch (err) {
    console.error('Failed to fetch settings for ID card preview:', err);
  }

  const selectedSession=getSelectedIdCardSession();idCardSettingsCached={...(idCardSettingsCached||{}),session:selectedSession.name,academic_session_id:selectedSession.id};
  const html = buildBatchIdCardsHTML([currentStudent], selectedSession.name, idCardSettingsCached.principalSignatureName, idCardSettingsCached.principalSignatureImage);
  previewBox.innerHTML = html;
  
  // Wait for rendering then scale fitment
  setTimeout(adjustIdCardPreviewScale, 50);
}

function adjustIdCardPreviewScale() {
  const wrapper = document.getElementById('idcard-preview-scroll-wrapper');
  const scaler = document.getElementById('idcard-preview-scale-container');
  const preview = document.getElementById('idcard-live-preview-a4');
  if (!wrapper || !scaler || !preview) return;
  scaler.style.transform = 'none';
  scaler.style.width = '100%';
  scaler.style.height = 'auto';
  scaler.style.display = 'flex';
  scaler.style.justifyContent = 'center';
  wrapper.style.height = 'auto';
  wrapper.style.minHeight = '600px';
  wrapper.style.overflow = 'auto';
  preview.style.width = '100%';
  preview.style.minHeight = '0';
  preview.style.background = 'transparent';
  preview.style.boxShadow = 'none';
}
function buildSingleStudentIdCardHTML(student, session, principalName) {
  if (!student) return '';
  const photoSrc = student.photo || `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="%23f1f5f9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="40" font-family="sans-serif" fill="%2394a3b8">No Photo</text></svg>`;
  const displaySession = session || getCurrentAcademicSession();
  const displayPrincipal = principalName || 'Anarul Hussain';

  const formatDateOfBirth = (dobStr) => {
    if (!dobStr) return 'N/A';
    const parts = dobStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
    }
    return dobStr;
  };

  const nameLen = student.name.length;
  let nameFontSize = '28px';
  if (nameLen > 15) {
    nameFontSize = Math.max(18, Math.floor(28 * (15 / nameLen))) + 'px';
  }

  const logoUrl = window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg');

  const isSigImage = displayPrincipal && (displayPrincipal.startsWith('data:') || displayPrincipal.startsWith('http') || displayPrincipal.startsWith('/') || displayPrincipal.endsWith('.png') || displayPrincipal.endsWith('.jpg') || displayPrincipal.endsWith('.jpeg') || displayPrincipal.endsWith('.svg'));
  const sigHTML = isSigImage
    ? `<img id="principalSignature" class="signature" src="${displayPrincipal}" alt="Principal Signature" />`
    : `<div id="principalSignature" class="signature-name" style="font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 26px; color: #062d55; line-height: 1; margin-bottom: 4px; text-align: center; font-weight: bold;">${displayPrincipal}</div>`;

  return `
    <div class="idcard-scaling-wrapper" style="width: 53.98mm; height: 85.60mm; position: relative; overflow: visible; display: inline-block; page-break-inside: avoid; break-inside: avoid; margin: 0; padding: 0; flex-shrink: 0; box-sizing: border-box;">
      <div style="transform: scale(0.3778); transform-origin: top left; position: absolute; top: 0; left: 0; width: 540px; height: 860px; pointer-events: auto; box-sizing: border-box;">
        
        <style>
          :root {
            --navy: #062d55;
            --navy-dark: #031f3c;
            --gold: #e2ac00;
            --gold-light: #f4ca39;
            --text: #082a4d;
            --muted: #6d7785;
            --white: #fff;
          }
          .student-id-card * {
            box-sizing: border-box;
          }
          .student-id-card, .id-card {
            width: 540px;
            height: 860px;
            position: relative;
            overflow: hidden;
            border-radius: 34px;
            background: #fff;
            border: 3px solid var(--navy-dark);
            box-shadow: 0 18px 45px rgba(0,0,0,.22);
            isolation: isolate;
            font-family: Arial, Helvetica, sans-serif;
          }
          .header {
            position: absolute;
            inset: 0 0 auto 0;
            height: 300px;
            background: radial-gradient(circle at 85% 18%, rgba(255,255,255,.08), transparent 26%), linear-gradient(135deg, var(--navy) 0%, var(--navy-dark) 100%);
            z-index: 1;
          }
          .logo {
            position: absolute;
            top: 12px;
            left: 12px;
            width: 109px;
            height: 109px;
            object-fit: contain;
            object-position: center;
            overflow: hidden;
            background: transparent;
            border: none;
            box-shadow: none;
            border-radius: 50%;
            z-index: 3;
            box-sizing: border-box;
          }
          .brand {
            position: absolute;
            top: 30px;
            left: 121px;
            right: 0;
            z-index: 3;
            line-height: 1;
            text-transform: uppercase;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          .brand .line1 {
            margin: 0;
            color: #fff;
            font-size: 34px;
            font-weight: 900;
            letter-spacing: 1px;
            width: 100%;
            text-align: center;
          }
          .brand .line2 {
            margin: 8px 0 0;
            color: var(--gold-light);
            font-size: 31px;
            font-weight: 900;
            letter-spacing: .5px;
            width: 100%;
            text-align: center;
          }
          .card-title-above-photo {
            position: absolute;
            top: 158px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 4;
            color: #ffffff;
            font-size: 21px;
            font-weight: 900;
            letter-spacing: 3px;
            text-transform: uppercase;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .card-title-above-photo::before, .card-title-above-photo::after {
            content: "";
            height: 2px;
            width: 48px;
            background: #ffffff;
            opacity: .9;
          }
          .dot-grid {
            position: absolute;
            top: 42px;
            right: 22px;
            width: 35px;
            height: 60px;
            opacity: .95;
            background-image: radial-gradient(var(--gold-light) 2px, transparent 2.5px);
            background-size: 11px 11px;
            z-index: 3;
          }
          .photo-wrap {
            position: absolute;
            top: 206px;
            left: 50%;
            transform: translateX(-50%);
            width: 250px;
            height: 280px;
            z-index: 5;
            filter: drop-shadow(0 12px 12px rgba(0,0,0,.16));
          }
          .photo-frame {
            position: absolute;
            inset: 0;
            background: #fff;
            clip-path: polygon(50% 0, 92% 20%, 92% 80%, 50% 100%, 8% 80%, 8% 20%);
          }
          .photo-frame::before {
            content: "";
            position: absolute;
            inset: 8px;
            background: var(--gold);
            clip-path: inherit;
          }
          .photo-frame::after {
            content: "";
            position: absolute;
            inset: 16px;
            background: #f8f8f8;
            clip-path: inherit;
          }
          .student-photo {
            position: absolute;
            inset: 20px;
            width: calc(100% - 40px);
            height: calc(100% - 40px);
            object-fit: cover;
            object-position: center top;
            clip-path: polygon(50% 0, 92% 20%, 92% 80%, 50% 100%, 8% 80%, 8% 20%);
            z-index: 2;
            background: #ececec;
          }
          .name-row {
            position: absolute;
            top: 492px;
            left: 30px;
            right: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            z-index: 6;
          }
          .name-row .decor {
            height: 2px;
            width: 72px;
            background: var(--gold);
            position: relative;
          }
          .name-row .decor:after {
            content: "";
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--gold);
            top: 50%;
            transform: translateY(-50%);
          }
          .name-row .decor.left:after {
            right: -2px;
          }
          .name-row .decor.right:after {
            left: -2px;
          }
          .student-name {
            max-width: 300px;
            margin: 0;
            color: var(--text);
            font-size: ${nameFontSize};
            font-weight: 900;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: .5px;
            white-space: nowrap;
          }
          .details {
            position: absolute;
            top: 538px;
            left: 42px;
            right: 42px;
            height: 208px;
            display: grid;
            grid-template-columns: 1fr 2px 1fr;
            column-gap: 26px;
            z-index: 6;
          }
          .divider {
            width: 2px;
            background: linear-gradient(to bottom, transparent, var(--gold) 8%, var(--gold) 92%, transparent);
          }
          .column {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: 100%;
          }
          .field {
            display: grid;
            grid-template-columns: 44px 1fr;
            gap: 12px;
            align-items: center;
            height: 44px;
          }
          .icon {
            width: 44px;
            height: 44px;
            border-radius: 11px;
            display: grid;
            place-items: center;
            color: #fff;
            background: linear-gradient(145deg, var(--navy), var(--navy-dark));
            font-size: 20px;
            font-weight: 700;
          }
          .field .label {
            color: var(--muted);
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: .35px;
            margin-bottom: 2px;
            line-height: 1;
          }
          .field .value {
            color: var(--text);
            font-size: 17px;
            font-weight: 900;
            line-height: 1.1;
            text-transform: uppercase;
            word-break: break-word;
          }
          .signature-box {
            margin-top: auto;
            text-align: center;
            padding-top: 2px;
          }
          .signature {
            width: 170px;
            height: 44px;
            object-fit: contain;
            display: block;
            margin: 0 auto 2px;
          }
          .signature-line {
            height: 2px;
            background: var(--gold);
            margin: 0 auto 7px;
            max-width: 180px;
            position: relative;
          }
          .signature-line::after {
            content: "";
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: var(--gold);
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
          }
          .signature-label {
            color: var(--text);
            font-size: 13px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: .4px;
          }
          .footer {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            height: 55px;
            background: #062d55;
            border-top: 3px solid #e2ac00;
            z-index: 5;
          }
          .micro-dots {
            position: absolute;
            width: 46px;
            height: 70px;
            opacity: .25;
            background-image: radial-gradient(var(--navy) 2px, transparent 2.5px);
            background-size: 12px 12px;
            z-index: 3;
          }
          .micro-dots.left {
            left: 25px;
            top: 440px;
          }
          .micro-dots.right {
            right: 25px;
            top: 360px;
          }
          @media print {
            body {
              background: #fff;
            }
            .id-card {
              box-shadow: none;
            }
          }
        </style>

        <div class="student-id-card id-card" id="studentIdCard">
          <div class="header"></div>
          <img id="schoolLogo" class="logo" src="${logoUrl}" alt="School Logo" />
          <div class="brand">
            <h1 class="line1">GARUMARA</h1>
            <h2 class="line2">JATIYA VIDYALAYA</h2>
          </div>
          <div class="card-title-above-photo">STUDENT ID CARD</div>
          <div class="dot-grid"></div>
          <div class="micro-dots left"></div>
          <div class="micro-dots right"></div>
          <div class="photo-wrap">
            <div class="photo-frame"></div>
            <img id="studentPhoto" class="student-photo" src="${photoSrc}" alt="Student Photo" />
          </div>
          <div class="name-row">
            <span class="decor left"></span>
            <h3 id="studentName" class="student-name">${student.name}</h3>
            <span class="decor right"></span>
          </div>
          <div class="details">
            <div class="column">
              <div class="field"><div class="icon">●</div><div><div class="label">Father's Name</div><div id="fatherName" class="value">${student.fatherName || 'N/A'}</div></div></div>
              <div class="field"><div class="icon">▣</div><div><div class="label">Date of Birth</div><div id="dob" class="value">${formatDateOfBirth(student.dob)}</div></div></div>
              <div class="field"><div class="icon">▤</div><div><div class="label">Admission No.</div><div id="admissionNo" class="value">${student.admissionNo}</div></div></div>
              <div class="field"><div class="icon">▰</div><div><div class="label">Class & Section</div><div id="classSection" class="value">${student.className} - ${student.section}</div></div></div>
            </div>
            <div class="divider"></div>
            <div class="column">
              <div style="display: flex; flex-direction: column; gap: 10px;">
                <div class="field"><div class="icon">▣</div><div><div class="label">Roll Number</div><div id="rollNumber" class="value">${student.rollNo || 'N/A'}</div></div></div>
                <div class="field"><div class="icon">◆</div><div><div class="label">Academic Session</div><div id="academicSession" class="value">${displaySession}</div></div></div>
              </div>
              <div class="signature-box">
                ${sigHTML}
                <div class="signature-line"></div>
                <div class="signature-label">Principal Signature</div>
              </div>
            </div>
          </div>
          <div class="footer"></div>
        </div>

      </div>
    </div>
  `;
}

const ID_CARD_V5_CSS = String.raw`.idcard-uploaded-preview-shell{width:420px;height:672px;overflow:hidden;border-radius:28px;box-shadow:0 30px 70px #041b3138,0 3px 12px #041b3124;background:#fff;flex:0 0 auto}
.idcard-uploaded-preview-scale{width:600px;height:960px;transform:scale(.7);transform-origin:top left}
.gjv-id-v5{--ink:#09233f;--navy:#082f55;--deep:#041b31;--gold:#c99a35;--pale:#f5e3b6;--muted:#647386;width:600px;height:960px;min-width:600px;max-width:600px;min-height:960px;max-height:960px;position:relative;overflow:hidden;border-radius:40px;background:#fff;border:3px solid var(--deep);isolation:isolate}
.gjv-id-v5:before{content:"";position:absolute;inset:14px;border:1px solid #c99a3580;border-radius:27px;z-index:12;pointer-events:none}
.gjv-id-v5 .header{position:absolute;inset:0 0 auto;height:295px;background:radial-gradient(circle at 85% 0,#ffffff1a,transparent 210px),linear-gradient(132deg,var(--navy),var(--deep))}
.gjv-id-v5 .header:after{content:"";position:absolute;left:-45px;right:-45px;bottom:-63px;height:125px;background:#fff;border-radius:50% 50% 0 0/42% 42% 0 0;border-top:8px solid var(--gold)}
.gjv-id-v5 .pattern{position:absolute;right:26px;top:28px;width:100px;height:100px;opacity:.22;background-image:radial-gradient(var(--pale) 2px,transparent 2.5px);background-size:14px 14px}
.gjv-id-v5 .topline{position:absolute;left:34px;right:34px;top:27px;height:1px;background:linear-gradient(90deg,var(--gold),transparent)}
.gjv-id-v5 .logo-wrap{position:absolute;top:49px;left:42px;width:112px;height:112px;padding:7px;border-radius:50%;background:#fff;border:3px solid var(--gold);box-shadow:0 9px 24px #0003;z-index:3}
.gjv-id-v5 .logo{width:100%;height:100%;object-fit:contain;border-radius:50%;display:block}
.gjv-id-v5 .brand{position:absolute;top:56px;left:164px;right:46px;z-index:3;text-transform:uppercase}
.gjv-id-v5 .line1{color:#fff;font-family:Georgia,serif;font-size:39px;font-weight:700;line-height:1;letter-spacing:.035em}
.gjv-id-v5 .line2{margin-top:8px;color:var(--pale);font-size:25px;font-weight:700;line-height:1.15;letter-spacing:.04em}
.gjv-id-v5 .sub{position:absolute;top:170px;left:0;right:0;z-index:3;display:flex;align-items:center;justify-content:center;gap:10px;color:#fff;font-size:11px;font-weight:800;letter-spacing:.28em;text-transform:uppercase}
.gjv-id-v5 .sub:before{content:"";width:36px;height:2px;background:var(--gold)}
.gjv-id-v5 .credential{position:absolute;top:205px;left:0;right:0;color:#fff;text-align:center;font-size:10px;font-weight:700;letter-spacing:.32em;text-transform:uppercase;z-index:3;opacity:.8}
.gjv-id-v5 .photo-frame{position:absolute;top:218px;left:50%;transform:translateX(-50%);width:196px;height:252px;padding:7px;background:#fff;border:4px solid var(--gold);z-index:5;box-shadow:0 17px 28px #09233f38}
.gjv-id-v5 .photo-frame:after{content:"";position:absolute;inset:4px;border:1px solid #082f5538;pointer-events:none}
.gjv-id-v5 .photo{width:100%;height:100%;object-fit:cover;object-position:center top;background:#edf0f2;display:block}
.gjv-id-v5 .name-block{position:absolute;top:493px;left:38px;right:38px;text-align:center}
.gjv-id-v5 .name-kicker{color:var(--gold);font-size:10px;font-weight:800;letter-spacing:.28em;text-transform:uppercase}
.gjv-id-v5 .name{margin:6px 0 0;font-family:Georgia,serif;font-size:34px;line-height:1.05;font-weight:700;text-transform:uppercase;white-space:nowrap}
.gjv-id-v5 .name-rule{display:flex;align-items:center;gap:9px;justify-content:center;margin:13px auto 0;width:270px}
.gjv-id-v5 .name-rule:before,.gjv-id-v5 .name-rule:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--gold))}
.gjv-id-v5 .name-rule:after{background:linear-gradient(90deg,var(--gold),transparent)}
.gjv-id-v5 .name-rule span{width:7px;height:7px;background:var(--gold);transform:rotate(45deg)}
.gjv-id-v5 .details{position:absolute;left:42px;right:42px;top:596px;display:grid;grid-template-columns:1fr 1fr;gap:11px 18px}
.gjv-id-v5 .row{min-height:67px;display:grid;grid-template-columns:42px 1fr;gap:11px;align-items:center;padding:9px 11px;background:#f6f8fa;border:1px solid #e3e8ed;border-radius:12px}
.gjv-id-v5 .icon{width:42px;height:42px;display:grid;place-items:center;border-radius:9px;color:var(--pale);background:linear-gradient(145deg,var(--navy),var(--deep));font-size:9px;font-weight:900}
.gjv-id-v5 .lab{margin-bottom:5px;color:var(--muted);font-size:9px;line-height:1;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
.gjv-id-v5 .val{font-size:15px;line-height:1.12;font-weight:800;text-transform:uppercase;overflow-wrap:anywhere}
.gjv-id-v5 .signature-area{position:absolute;left:42px;right:42px;top:834px;height:62px;display:flex;align-items:flex-end;justify-content:flex-end}
.gjv-id-v5 .sigbox{width:206px;text-align:center}
.gjv-id-v5 .sigimg{display:none;width:180px;height:35px;object-fit:contain;margin:0 auto 2px}
.gjv-id-v5 .signame{font-family:"Brush Script MT","Segoe Script",cursive;font-size:25px;color:var(--navy);line-height:1;margin-bottom:2px}
.gjv-id-v5 .sigline{height:1px;background:var(--gold);margin:0 auto 6px}
.gjv-id-v5 .siglabel{font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
.gjv-id-v5 .footer{position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(90deg,var(--deep),#0d4777,var(--deep));border-top:3px solid var(--gold)}
.gjv-id-v5{--ink:#09233f;--navy:#082f55;--deep:#041b31;--gold:#c99a35;--pale:#f5e3b6;--muted:#647386;
  border:2px solid var(--deep);
  border-radius:34px;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.32);
}
.gjv-id-v5:before{
  inset:12px;
  border-color:rgba(201,154,53,.42);
  border-radius:23px;
}
.gjv-id-v5 .header{height:282px}
.gjv-id-v5 .header:after{
  left:-40px;
  right:-40px;
  bottom:-50px;
  height:100px;
  border-top-width:5px;
}
.gjv-id-v5 .pattern{right:28px;top:30px;opacity:.16}
.gjv-id-v5 .logo-wrap{
  top:43px;
  left:40px;
  width:112px;
  height:112px;
  padding:7px;
  border-width:2px;
  box-shadow:0 8px 20px rgba(0,0,0,.16);
}
.gjv-id-v5 .brand{top:51px;left:174px;right:32px}
.gjv-id-v5 .line1{font-size:37px;letter-spacing:.025em}
.gjv-id-v5 .line2{position:absolute;top:46px;left:-140px;right:2px;width:auto;max-width:none;margin:0;font-size:23px;letter-spacing:.035em;text-align:center;white-space:nowrap}
.gjv-id-v5 .sub{
  top:168px;
  gap:12px;
  letter-spacing:.25em;
}
.gjv-id-v5 .sub:before,.gjv-id-v5 .sub:after{
  content:"";
  width:38px;
  height:1px;
  background:var(--gold);
}
.gjv-id-v5 .photo-frame{
  top:218px;
  width:196px;
  height:252px;
  padding:6px;
  border-width:3px;
  box-shadow:0 12px 24px rgba(9,35,63,.16);
}
.gjv-id-v5 .name-block{top:492px}
.gjv-id-v5 .name-kicker{font-size:9px;letter-spacing:.3em}
.gjv-id-v5 .name{margin-top:7px;font-size:32px;letter-spacing:.015em}
.gjv-id-v5 .name-rule{width:240px;margin-top:12px}
.gjv-id-v5 .details{
  left:38px;
  right:38px;
  top:590px;
  gap:10px 12px;
}
.gjv-id-v5 .row{
  min-height:70px;
  grid-template-columns:40px 1fr;
  gap:11px;
  padding:10px 11px;
  background:#f8fafb;
  border-color:#e0e6eb;
  border-radius:11px;
  box-shadow:0 2px 5px rgba(9,35,63,.025);
}
.gjv-id-v5 .icon{
  width:40px;
  height:40px;
  border-radius:8px;
  font-size:8px;
  letter-spacing:.02em;
}
.gjv-id-v5 .lab{font-size:9px;letter-spacing:.08em}
.gjv-id-v5 .val{font-size:15px;line-height:1.15}
.gjv-id-v5 .signature-area{
  top:832px;
  justify-content:center;
}
.gjv-id-v5 .sigbox{width:210px}
.gjv-id-v5 .sigline{width:190px}
.gjv-id-v5 .footer{
  height:20px;
  border-top-width:2px;
  background:linear-gradient(90deg,var(--deep),var(--navy),var(--deep));
}
@media(max-width:480px){.idcard-uploaded-preview-shell{width:330px;height:528px;border-radius:22px}.idcard-uploaded-preview-scale{transform:scale(.55)}}`;
const ID_CARD_WIDTH = 600;
const ID_CARD_HEIGHT = 960;
const ID_CARD_EXPORT_SCALE = 4;
const ID_CARD_PVC_WIDTH_MM = 53.98;
const ID_CARD_PVC_HEIGHT_MM = 85.6;
const ID_CARD_PRINT_WIDTH_MM = ID_CARD_PVC_HEIGHT_MM * (ID_CARD_WIDTH / ID_CARD_HEIGHT);

function resolveIdCardAssetUrl(source) {
  const value = String(source || '').trim();
  if (!value) return '';
  if (/^(data:|blob:)/i.test(value)) return value;
  return new URL(value.startsWith('/') ? value : `/${value.replace(/^\.\//, '')}`, window.location.origin).href;
}

function buildPremiumStudentIdCardHTML(student, session, principalName, principalSignatureImage) {
  if (!student) return '';
  const safe = value => subjectHtmlEscape(String(value ?? ''));
  const dob = String(student.dob || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3-$2-$1') || 'N/A';
  const defaultLogo = resolveIdCardAssetUrl('/logo.jpg');
  const logo = resolveIdCardAssetUrl(window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? defaultLogo : '/neutral-school-logo.svg'));
  const emptyPhoto = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='350' height='450'%3E%3Crect width='100%25' height='100%25' fill='%23edf0f2'/%3E%3Ccircle cx='175' cy='150' r='70' fill='%23cbd2d8'/%3E%3Crect x='75' y='250' width='200' height='170' rx='90' fill='%23cbd2d8'/%3E%3C/svg%3E";
  const savedSignatureImage = String(principalSignatureImage || '').trim();
  const principal = savedSignatureImage || String(principalName || '').trim() || (window.currentSchool?.principalName || 'Principal');
  const signatureIsImage = !!savedSignatureImage || /^(data:|https?:|\/)/i.test(principal) || /\.(png|jpe?g|svg|webp)$/i.test(principal);
  const signature = signatureIsImage
    ? `<img class="sigimg" alt="Principal signature" src="${safe(resolveIdCardAssetUrl(principal))}" crossorigin="anonymous" style="display:block">`
    : `<div class="signame">${safe(principal)}</div>`;
  const schoolBrandName = safe(window.currentSchool?.name || 'Garumara Jatiya Vidyalaya');

  if (window.schoolIdCardDesign && typeof renderDynamicDesignedCardHTML === 'function') {
    return renderDynamicDesignedCardHTML(student, session, principal, savedSignatureImage, window.schoolIdCardDesign);
  }

  return `<div class="idcard-uploaded-preview-shell"><div class="idcard-uploaded-preview-scale"><style>${ID_CARD_V5_CSS}</style><article class="gjv-id-v5" data-admission-no="${safe(student.admissionNo)}"><div class="header"></div><div class="pattern"></div><div class="logo-wrap"><img class="logo" alt="School Logo" src="${logo}" crossorigin="anonymous"></div><div class="brand"><div class="line1">${schoolBrandName}</div></div><div class="sub">Student Identity Card</div><div class="photo-frame"><img class="photo" alt="Student Photo" src="${safe(resolveIdCardAssetUrl(student.photo) || emptyPhoto)}" crossorigin="anonymous"></div><div class="name-block"><div class="name-kicker">Student</div><h2 class="name">${safe(student.name || 'N/A')}</h2><div class="name-rule"><span></span></div></div><div class="details"><div class="row"><div class="icon">F/N</div><div><div class="lab">Father's Name</div><div class="val">${safe(student.fatherName || 'N/A')}</div></div></div><div class="row"><div class="icon">DOB</div><div><div class="lab">Date of Birth</div><div class="val">${safe(dob)}</div></div></div><div class="row"><div class="icon">ID</div><div><div class="lab">Admission No.</div><div class="val">${safe(student.admissionNo || 'N/A')}</div></div></div><div class="row"><div class="icon">CLS</div><div><div class="lab">Class & Section</div><div class="val">${safe(`${student.className || 'N/A'} - ${student.section || 'N/A'}`)}</div></div></div><div class="row"><div class="icon">NO.</div><div><div class="lab">Roll Number</div><div class="val">${safe(student.rollNo || 'N/A')}</div></div></div><div class="row"><div class="icon">YR</div><div><div class="lab">Academic Session</div><div class="val">${safe(session || student.session || 'N/A')}</div></div></div></div><div class="signature-area"><div class="sigbox">${signature}<div class="sigline"></div><div class="siglabel">Principal Signature</div></div></div><div class="footer"></div></article></div></div>`;
}

function buildBatchIdCardsHTML(students, session, principalName, principalSignatureImage) {
  session=getSelectedIdCardSession().name||session;
  return `<div class="idcard-uploaded-preview-list" style="width:100%;display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:center;gap:24px;padding:24px;box-sizing:border-box">${students.map(student => buildPremiumStudentIdCardHTML(student, session, principalName, principalSignatureImage)).join('')}</div>`;
}

function idCardWithTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not finish loading.`)), ms); })]).finally(() => clearTimeout(timer));
}

async function waitForIdCardFonts() {
  if (!document.fonts?.ready) return;
  await idCardWithTimeout(document.fonts.ready, 15000, 'Fonts');
  await idCardWithTimeout(Promise.all([document.fonts.load('700 37px Georgia', 'GARUMARA'), document.fonts.load('800 15px Outfit', 'STUDENT')]), 15000, 'Card fonts');
}

async function waitForIdCardImage(image) {
  if (!image.src) return;
  if (!image.complete) {
    await idCardWithTimeout(new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error(`${image.alt || 'Image'} failed to load: ${image.currentSrc || image.src}`)), { once: true });
    }), 15000, image.alt || 'Image');
  }
  if (typeof image.decode === 'function') {
    try { await idCardWithTimeout(image.decode(), 15000, image.alt || 'Image'); }
    catch (error) { if (!image.complete || !image.naturalWidth) throw error; }
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(`${image.alt || 'Image'} is blank or invalid: ${image.currentSrc || image.src}`);
}

async function waitForIdCardAssets(root) {
  await waitForIdCardFonts();
  await Promise.all(Array.from(root.querySelectorAll('img')).map(waitForIdCardImage));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function validateIdCardCanvas(canvas) {
  const isLandscape = window.schoolIdCardDesign?.cardSize?.orientation === 'landscape';
  const targetW = (isLandscape ? ID_CARD_HEIGHT : ID_CARD_WIDTH) * ID_CARD_EXPORT_SCALE;
  const targetH = (isLandscape ? ID_CARD_WIDTH : ID_CARD_HEIGHT) * ID_CARD_EXPORT_SCALE;
  const isStandard = canvas && canvas.width === ID_CARD_WIDTH * ID_CARD_EXPORT_SCALE && canvas.height === ID_CARD_HEIGHT * ID_CARD_EXPORT_SCALE;
  const isLandscapeValid = canvas && canvas.width === targetW && canvas.height === targetH;
  if (!canvas || (!isStandard && !isLandscapeValid)) throw new Error('Export canvas has invalid dimensions.');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Export canvas could not be created.');
  const sample = context.getImageData(0, 0, Math.min(canvas.width, 32), Math.min(canvas.height, 32)).data;
  let visible = false;
  for (let index = 3; index < sample.length; index += 4) { if (sample[index] > 0) { visible = true; break; } }
  if (!visible) throw new Error('Export canvas is blank.');
  return canvas;
}

async function renderIdCardCanvas(card) {
  const html2canvasFn = await window.getHtml2Canvas();
  if (typeof html2canvasFn !== 'function') throw new Error('PNG renderer is unavailable.');
  if (!(card instanceof HTMLElement) || !card.isConnected) throw new Error('The visible Student ID Card is unavailable.');
  await waitForIdCardAssets(card);
  const isLandscape = window.schoolIdCardDesign?.cardSize?.orientation === 'landscape';
  const targetWidth = isLandscape ? ID_CARD_HEIGHT : ID_CARD_WIDTH;
  const targetHeight = isLandscape ? ID_CARD_WIDTH : ID_CARD_HEIGHT;
  const exportOptions = {
    scale: ID_CARD_EXPORT_SCALE,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    width: ID_CARD_WIDTH,
    height: ID_CARD_HEIGHT,
    scrollX: 0,
    scrollY: 0,
    logging: false,
    imageTimeout: 15000,
    removeContainer: true,
    onclone: doc => {
      const admissionNo = card.dataset.admissionNo;
      const clone = Array.from(doc.querySelectorAll('.gjv-id-v5')).find(item => item.dataset.admissionNo === admissionNo);
      if (!clone) throw new Error(`Export clone is missing student ${admissionNo}.`);
      const shell = clone.closest('.idcard-uploaded-preview-shell');
      const scaler = clone.closest('.idcard-uploaded-preview-scale');
      const finalW = targetWidth || ID_CARD_WIDTH;
      const finalH = targetHeight || ID_CARD_HEIGHT;
      if (shell) Object.assign(shell.style, { width: `${finalW}px`, height: `${finalH}px`, overflow: 'visible', borderRadius: '0', boxShadow: 'none' });
      if (scaler) Object.assign(scaler.style, { width: `${finalW}px`, height: `${finalH}px`, transform: 'none', transformOrigin: 'top left' });
      Object.assign(clone.style, { width: `${ID_CARD_WIDTH}px`, height: `${ID_CARD_HEIGHT}px`, minWidth: `${finalW}px`, maxWidth: `${finalW}px`, minHeight: `${finalH}px`, maxHeight: `${finalH}px`, transform: 'none', zoom: '1', margin: '0' });
    }
  };
  if (isLandscape) {
    exportOptions.width = targetWidth;
    exportOptions.height = targetHeight;
  }
  const canvas = await html2canvasFn(card, exportOptions);
  return validateIdCardCanvas(canvas);
}

function idCardCanvasToBlob(canvas, type = 'image/png', quality = 1) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob && blob.size ? resolve(blob) : reject(new Error('Canvas produced a blank file.')), type, quality));
}

function idCardSafeFileName(value, fallback = 'student') {
  const result = String(value || fallback).trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return result || fallback;
}

function downloadIdCardBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function createIdCardPdf(canvases) {
  const jsPDFClass = window.jspdf?.jsPDF || window.jsPDF;
  if (!jsPDFClass) throw new Error('PDF renderer is unavailable.');
  const isLandscape = window.schoolIdCardDesign?.cardSize?.orientation === 'landscape';
  const pdfW = isLandscape ? ID_CARD_PVC_HEIGHT_MM : ID_CARD_PVC_WIDTH_MM;
  const pdfH = isLandscape ? ID_CARD_PVC_WIDTH_MM : ID_CARD_PVC_HEIGHT_MM;
  const printW = isLandscape ? ID_CARD_PVC_HEIGHT_MM : ID_CARD_PRINT_WIDTH_MM;
  const printH = isLandscape ? ID_CARD_PVC_WIDTH_MM : ID_CARD_PVC_HEIGHT_MM;
  const orientation = isLandscape ? 'landscape' : 'portrait';
  const pdf = new jsPDFClass({ orientation, unit: 'mm', format: [pdfW, pdfH], compress: true });
  const x = isLandscape ? 0 : ((ID_CARD_PVC_WIDTH_MM - ID_CARD_PRINT_WIDTH_MM) / 2);
  canvases.forEach((canvas, index) => {
    if (index) pdf.addPage([pdfW, pdfH], orientation);
    pdf.addImage(canvas, 'PNG', x, 0, printW, printH, undefined, 'FAST');
  });
  return pdf;
}

function buildIdCardPrintMarkup(dataUrl) {
  const isLandscape = window.schoolIdCardDesign?.cardSize?.orientation === 'landscape';
  const printPageW = isLandscape ? ID_CARD_PVC_HEIGHT_MM : ID_CARD_PVC_WIDTH_MM;
  const printPageH = isLandscape ? ID_CARD_PVC_WIDTH_MM : ID_CARD_PVC_HEIGHT_MM;
  const printImgW = isLandscape ? ID_CARD_PVC_HEIGHT_MM : ID_CARD_PRINT_WIDTH_MM;
  const printImgH = isLandscape ? ID_CARD_PVC_WIDTH_MM : ID_CARD_PVC_HEIGHT_MM;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Print Student ID Card</title><style>@page{size:${printPageW}mm ${printPageH}mm;margin:0}html,body{margin:0;width:${ID_CARD_PVC_WIDTH_MM}mm;height:${ID_CARD_PVC_HEIGHT_MM}mm;background:#fff;overflow:hidden}body{display:grid;place-items:start center}img{display:block;width:${printImgW}mm;height:${printImgH}mm;object-fit:fill}</style></head><body><img src="${dataUrl}" alt="Student ID Card"></body></html>`;
}

async function buildIdCardBulkZip(canvases, names) {
  if (typeof window.JSZip !== 'function') throw new Error('ZIP renderer is unavailable.');
  const zip = new window.JSZip();
  for (let index = 0; index < canvases.length; index += 1) zip.file(`${String(index + 1).padStart(3, '0')}-${idCardSafeFileName(names[index])}.png`, await idCardCanvasToBlob(canvases[index]));
  zip.file('all-student-id-cards.pdf', createIdCardPdf(canvases).output('blob'));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

function currentIdCardStudent() {
  return state.allStudents.find(student => student.admissionNo === state.selectedIdCardPreviewAdmissionNo) || null;
}

async function exportStudentIdCards({ format, button, students = null }) {
  const preview = document.getElementById('idcard-live-preview-a4');
  const status = document.getElementById('idcard-preview-status');
  const isBulk = format === 'all';
  const selected = isBulk ? students : [currentIdCardStudent()].filter(Boolean);
  const printWindow = format === 'print' ? window.open('', '_blank', 'width=700,height=1000') : null;
  if (format === 'print' && !printWindow) return alert('Allow pop-ups to print the card.');
  if (!selected.length) { if (printWindow) printWindow.close(); return alert(isBulk ? 'Please select one or more students.' : 'Please select a student first.'); }
  const originalText = button?.innerText || '';
  if (button) { button.disabled = true; button.innerText = 'Preparing ID Card...'; }
  try {
    preview.innerHTML = buildBatchIdCardsHTML(selected, idCardSettingsCached?.session, idCardSettingsCached?.principalSignatureName, idCardSettingsCached?.principalSignatureImage);
    if (status) status.innerText = isBulk ? `Previewing: ${selected.length} selected students` : `Previewing: ${selected[0].name}`;
    adjustIdCardPreviewScale();
    const cards = Array.from(preview.querySelectorAll('.gjv-id-v5'));
    if (cards.length !== selected.length) throw new Error(`Expected ${selected.length} visible cards but found ${cards.length}.`);
    const canvases = [];
    for (let index = 0; index < cards.length; index += 1) {
      if (status) status.innerText = `Rendering card ${index + 1} of ${cards.length}...`;
      canvases.push(await renderIdCardCanvas(cards[index]));
    }
    const names = selected.map(student => student.name || student.admissionNo || 'student');
    if (format === 'png') {
      downloadIdCardBlob(await idCardCanvasToBlob(canvases[0]), `${idCardSafeFileName(names[0])}-id-card.png`);
    } else if (format === 'pdf') {
      const blob = createIdCardPdf(canvases).output('blob');
      if (!blob.size) throw new Error('PDF output is blank.');
      downloadIdCardBlob(blob, `${idCardSafeFileName(names[0])}-id-card.pdf`);
    } else if (format === 'print') {
      const dataUrl = canvases[0].toDataURL('image/png', 1);
      printWindow.document.open();
      printWindow.document.write(buildIdCardPrintMarkup(dataUrl));
      printWindow.document.close();
      await waitForIdCardImage(printWindow.document.querySelector('img'));
      printWindow.focus();
      printWindow.print();
    } else if (isBulk) {
      const blob = await buildIdCardBulkZip(canvases, names);
      if (!blob.size) throw new Error('Bulk ZIP output is blank.');
      downloadIdCardBlob(blob, 'garumara-student-id-cards.zip');
    } else {
      throw new Error(`Unsupported export mode: ${format}`);
    }
    if (status) status.innerText = isBulk ? `${canvases.length} cards downloaded successfully.` : `${format.toUpperCase()} completed successfully.`;
  } catch (error) {
    if (printWindow && !printWindow.closed) printWindow.close();
    console.error('ID card export failed', error);
    if (status) status.innerText = `${format.toUpperCase()} failed: ${error.message}`;
    alert(`ID Card export failed: ${error.message}`);
  } finally {
    if (button) { button.disabled = false; button.innerText = originalText; }
  }
}
function updateIdCardSignatureSettingsUi(source, message = '') {
  const preview = document.getElementById('idcard-signature-preview');
  const wrapper = document.getElementById('idcard-signature-preview-wrap');
  const removeButton = document.getElementById('idcard-signature-remove-btn');
  const status = document.getElementById('idcard-signature-status');
  const value = String(source || '').trim();
  if (preview && wrapper && removeButton) {
    if (value) {
      preview.src = resolveIdCardAssetUrl(value);
      wrapper.classList.remove('hidden');
      removeButton.classList.remove('hidden');
    } else {
      preview.removeAttribute('src');
      wrapper.classList.add('hidden');
      removeButton.classList.add('hidden');
    }
  }
  if (status) {
    status.textContent = message || (value ? 'Saved signature loaded.' : 'PNG, JPG, JPEG or WEBP. Maximum 2 MB.');
    status.className = `text-[10px] ${message && /failed|invalid|only|exceed|error/i.test(message) ? 'text-rose-600' : value ? 'text-emerald-600' : 'text-slate-500'}`;
  }
}

function readIdCardSignatureFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the signature image.'));
    reader.readAsDataURL(file);
  });
}

function validateIdCardSignatureFile(file) {
  if (!file) throw new Error('Please select a signature image.');
  const validExtension = /\.(png|jpe?g)$/i.test(file.name || '');
  const validType = ['image/png', 'image/jpeg'].includes(String(file.type || '').toLowerCase());
  if (!validExtension || !validType) throw new Error('Only PNG, JPG, or JPEG signature files are allowed.');
  if (file.size <= 0) throw new Error('The selected signature image is empty.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Signature image must not exceed 2 MB.');
}
// Global Event Initialization for ID Cards filters and actions
function initIdCardsFilters() {
  const classSelect = document.getElementById('idcard-class-select');
  const sessionSelect = document.getElementById('idcard-set-session');
  const sectionSelect = document.getElementById('idcard-section-select');
  const searchInput = document.getElementById('idcard-student-search');

  if(sessionSelect&&!sessionSelect.dataset.sessionBound){sessionSelect.dataset.sessionBound='true';sessionSelect.addEventListener('change',async()=>{const x=getSelectedIdCardSession();localStorage.setItem(CARD_SESSION_STORAGE_KEYS.idcard,x.id);try{await reloadIdCardSessionData()}catch(error){console.error('Student ID Card Academic Session switch failed:',error);const status=document.getElementById('idcard-preview-status');if(status)status.textContent='Session load failed: '+error.message}})}
  if (classSelect) classSelect.addEventListener('change', filterAndRenderIdCardsStudents);
  if (sectionSelect) sectionSelect.addEventListener('change', filterAndRenderIdCardsStudents);
  if (searchInput) searchInput.addEventListener('input', filterAndRenderIdCardsStudents);

  const signatureInput = document.getElementById('idcard-signature-file');
  const signatureRemoveButton = document.getElementById('idcard-signature-remove-btn');
  if (signatureInput) {
    signatureInput.addEventListener('change', async () => {
      const file = signatureInput.files?.[0];
      const previousPath = idCardSettingsCached?.principalSignatureImage || '';
      try {
        validateIdCardSignatureFile(file);
        const dataUrl = await readIdCardSignatureFile(file);
        updateIdCardSignatureSettingsUi(dataUrl, 'Uploading signature...');
        signatureInput.disabled = true;
        if (signatureRemoveButton) signatureRemoveButton.disabled = true;
        const response = await ApiService.uploadIdCardSignature({ fileName: file.name, mimeType: file.type, dataUrl });
        idCardSettingsCached = response.idCardSettings || { ...(idCardSettingsCached || {}), principalSignatureImage: response.principalSignatureImage };
        signatureInput.value = '';
        updateIdCardSignatureSettingsUi(idCardSettingsCached.principalSignatureImage, 'Signature uploaded and saved successfully.');
        await renderIdCardsPreview();
      } catch (error) {
        console.error('Principal signature upload failed:', error);
        signatureInput.value = '';
        updateIdCardSignatureSettingsUi(previousPath, error.message || 'Signature upload failed.');
      } finally {
        signatureInput.disabled = false;
        if (signatureRemoveButton) signatureRemoveButton.disabled = false;
      }
    });
  }
  if (signatureRemoveButton) {
    signatureRemoveButton.addEventListener('click', async () => {
      if (!idCardSettingsCached?.principalSignatureImage) return;
      if (!window.confirm('Remove the saved Principal signature image?')) return;
      signatureRemoveButton.disabled = true;
      if (signatureInput) signatureInput.disabled = true;
      try {
        const response = await ApiService.deleteIdCardSignature();
        idCardSettingsCached = response.idCardSettings || { ...(idCardSettingsCached || {}), principalSignatureImage: '' };
        updateIdCardSignatureSettingsUi('', 'Signature removed successfully. The default signature name will be used.');
        await renderIdCardsPreview();
      } catch (error) {
        console.error('Principal signature removal failed:', error);
        updateIdCardSignatureSettingsUi(idCardSettingsCached.principalSignatureImage, error.message || 'Signature removal failed.');
      } finally {
        signatureRemoveButton.disabled = false;
        if (signatureInput) signatureInput.disabled = false;
      }
    });
  }
  const saveSettingsBtn = document.getElementById('idcard-save-settings-btn');
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      const session = document.getElementById('idcard-set-session').value;
      const principal = document.getElementById('idcard-set-principal').value;

      saveSettingsBtn.disabled = true;
      saveSettingsBtn.innerText = 'Saving...';

      try {
        const payload = {
          idCardSettings: {
            session,
            academic_session_id: getSelectedIdCardSession().id,
            principalSignatureName: principal
          }
        };
        const res = await ApiService.saveSettings(payload);
        idCardSettingsCached = res.idCardSettings;
        alert('ID Card settings saved successfully!');
        renderIdCardsPreview();
      } catch (err) {
        console.error('Failed to save ID Card settings:', err);
        alert('Failed to save settings: ' + err.message);
      } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.innerText = 'Save Template Settings';
      }
    });
  }

  const previewBtn = document.getElementById('idcard-btn-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      renderIdCardsPreview();
    });
  }

  const previewAllBtn = document.getElementById('idcard-btn-preview-all');
  if (previewAllBtn) {
    previewAllBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('#idcard-student-list .idcard-student-checkbox:checked');
      if (checkedBoxes.length === 0) {
        return alert('Please select one or more students using checkboxes to preview all.');
      }

      const selectedNos = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-admission-no'));
      
      try {
        const settingsObj = await ApiService.getSettings();
        idCardSettingsCached = settingsObj.idCardSettings || {};
      } catch (err) {
        console.error('Failed to fetch settings for preview all:', err);
      }

      const selectedStudents = selectedNos.map(admNo => state.allStudents.find(s => s.admissionNo === admNo)).filter(Boolean);
      const previewHtml = buildBatchIdCardsHTML(selectedStudents, idCardSettingsCached.session, idCardSettingsCached.principalSignatureName, idCardSettingsCached.principalSignatureImage);

      const previewBox = document.getElementById('idcard-live-preview-a4');
      previewBox.innerHTML = previewHtml;
      document.getElementById('idcard-preview-status').innerText = `Previewing: All Selected (${selectedStudents.length} students)`;
      adjustIdCardPreviewScale();
    });
  }

  // Bind PNG and PDF download buttons
  const downloadPngBtn = document.getElementById("downloadPngButton");
  if (downloadPngBtn) {
    downloadPngBtn.onclick = () => exportStudentIdCards({ format: 'png', button: downloadPngBtn });
  }

  const downloadPdfBtn = document.getElementById("downloadPdfButton");
  if (downloadPdfBtn) {
    downloadPdfBtn.onclick = () => exportStudentIdCards({ format: 'pdf', button: downloadPdfBtn });
  }


  const printIdCardBtn = document.getElementById('idcard-btn-print');
  if (printIdCardBtn) {
    printIdCardBtn.onclick = () => exportStudentIdCards({ format: 'print', button: printIdCardBtn });
  }
  const downloadAllBtn = document.getElementById('idcard-btn-download-all');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('#idcard-student-list .idcard-student-checkbox:checked');
      if (checkedBoxes.length === 0) {
        return alert('Please select one or more students using checkboxes to download all.');
      }

      const selectedNos = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-admission-no'));
      
      try {
        const settingsObj = await ApiService.getSettings();
        idCardSettingsCached = settingsObj.idCardSettings || {};
      } catch (err) {
        console.error('Failed to fetch settings for download all:', err);
      }

      const selectedStudents = selectedNos.map(admNo => state.allStudents.find(s => s.admissionNo === admNo)).filter(Boolean);
      await exportStudentIdCards({ format: 'all', button: downloadAllBtn, students: selectedStudents });
    });
  }
}

// Automatically trigger ID Card filters setup
initIdCardsFilters();

// =========================================================================
// ID CARD DESIGN STUDIO & DYNAMIC RENDERER CONTROLLER
// 10 Premium Editable Student ID Card Templates & Visual Studio
// =========================================================================

const BUILTIN_ID_CARD_TEMPLATES = [
  {
    id: 'royal-blue',
    name: 'Royal Blue Professional',
    description: 'Royal blue & gold wave header, floating class/roll wing badges around the portrait, royal ribbon name banner, and rounded capsule data cells.',
    layoutStyle: 'royal-blue',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 31, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#fde68a',
      headerBgColor: '#0b3b75', headerBgColorEnd: '#051d3b', cardBgColor: '#ffffff',
      accentColor: '#d4a038', textColor: '#082f55', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 74, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 188, photoHeight: 238, photoBorderRadius: 28, photoBorderColor: '#d4a038', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#ffffff', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    description: 'Full-height dark-slate left profile sidebar with photo & ID pill, paired with a clean white editorial right canvas, 2-column capsule grid, and bottom QR dock.',
    layoutStyle: 'modern-minimal',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#0f172a',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11, cardHeadingColor: '#0284c7',
      headerBgColor: '#f8fafc', headerBgColorEnd: '#f1f5f9', cardBgColor: '#ffffff',
      accentColor: '#0284c7', textColor: '#0f172a', fontFamily: 'Inter, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 176, photoHeight: 218, photoBorderRadius: 20, photoBorderColor: '#38bdf8', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 25, nameFontWeight: '800', nameColor: '#ffffff', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 74, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'premium-gold',
    name: 'Premium Gold',
    description: 'Regal obsidian-navy & metallic gold header over a warm pearl-ivory print-friendly body with dual gold filigree borders, crest watermark, and gold capsule cells.',
    layoutStyle: 'premium-gold',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '700', schoolNameColor: '#fde68a',
      cardHeading: 'OFFICIAL STUDENT CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#fbbf24',
      headerBgColor: '#0a192f', headerBgColorEnd: '#040d1a', cardBgColor: '#fffdf9',
      accentColor: '#d97706', textColor: '#0a192f', fontFamily: 'Georgia, serif',
      headerStyle: 'regal', showLogo: true, logoSize: 74, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 192, photoHeight: 244, photoBorderRadius: 24, photoBorderColor: '#d97706', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 28, nameFontWeight: '700', nameColor: '#0a192f', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'crest', accentStripe: true },
    signature: { showSignature: true, label: 'Head of Institution', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'emerald-academic',
    name: 'Emerald Academic',
    description: 'Forest emerald & gold wave header, side-by-side horizontal hero profile card, and structured academic particulars table with mint-emerald capsules.',
    layoutStyle: 'emerald-academic',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 31, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#a7f3d0',
      headerBgColor: '#064e3b', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
      accentColor: '#10b981', textColor: '#064e3b', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 74, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 154, photoHeight: 194, photoBorderRadius: 18, photoBorderColor: '#10b981', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 26, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
      alignment: 'left', fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'maroon-classic',
    name: 'Maroon Classic',
    description: 'Heritage crimson-maroon & gold curved header, double-ringed portrait frame, maroon ribbon student banner, and formal convent-style bordered ledger table.',
    layoutStyle: 'maroon-classic',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '700', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#fde68a',
      headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#fdfbf7',
      accentColor: '#991b1b', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 188, photoHeight: 238, photoBorderRadius: 14, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 26, nameFontWeight: '700', nameColor: '#ffffff', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'sky-wave',
    name: 'Sky Blue Wave',
    description: 'Ocean cerulean & sky cyan dual-wave S-curve header, squircle portrait frame, capsule student badge, and rounded sky-tinted data cells.',
    layoutStyle: 'sky-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 31, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 12, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0284c7', headerBgColorEnd: '#0c4a6e', cardBgColor: '#ffffff',
      accentColor: '#0ea5e9', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 74, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 196, photoHeight: 248, photoBorderRadius: 36, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 29, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'purple-innovation',
    name: 'Purple Innovation',
    description: 'Royal violet wave-cut landscape pass with overlapping lavender profile card, rounded violet capsule data cells, and horizontal verification dock.',
    layoutStyle: 'purple-innovation',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'INNOVATION ACADEMY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#f3e8ff',
      headerBgColor: '#581c87', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
      accentColor: '#9333ea', textColor: '#2e1065', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 26, photoBorderColor: '#9333ea', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#3b0764', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 72, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'orange-energy',
    name: 'Orange Energy',
    description: 'Sunset amber-orange dual-wave curve header, squircle portrait frame, warm capsule student name badge, and rounded amber-tinted data cells.',
    layoutStyle: 'orange-energy',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 31, schoolNameFontWeight: '900', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY CARD', cardHeadingFontSize: 12, cardHeadingColor: '#ffedd5',
      headerBgColor: '#ea580c', headerBgColorEnd: '#9a3412', cardBgColor: '#ffffff',
      accentColor: '#f97316', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 74, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 194, photoHeight: 246, photoBorderRadius: 32, photoBorderColor: '#ea580c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 29, nameFontWeight: '900', nameColor: '#9a3412', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 14, labelFontSize: 9, spacing: 10, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 80, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'executive-vertical',
    name: 'Executive Vertical',
    description: 'Executive indigo-slate curved header with top lanyard slot bezel, squircle portrait frame, capsule student badge, and rounded slate-tinted data cells.',
    layoutStyle: 'executive-vertical',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL ACADEMIC CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#e2e8f0',
      headerBgColor: '#1e293b', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#3b82f6', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 194, photoHeight: 246, photoBorderRadius: 30, photoBorderColor: '#2563eb', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 28, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'barcode', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'smart-digital',
    name: 'Smart Digital',
    description: 'Cyber-navy & electric cyan wave-trimmed smart pass with gold EMV chip, squircle portrait with verified pill, cyan capsule data grid, and QR authority dock.',
    layoutStyle: 'smart-digital',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SMART CAMPUS PASS', cardHeadingFontSize: 11, cardHeadingColor: '#67e8f9',
      headerBgColor: '#0f172a', headerBgColorEnd: '#0369a1', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 174, photoHeight: 216, photoBorderRadius: 24, photoBorderColor: '#06b6d4', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 25, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
      alignment: 'left', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 82, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Campus Authority', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'ocean-breeze',
    name: 'Ocean Breeze Wave',
    description: 'Unique classic overlap architecture with s wave header, squircle portrait frame, and capsule data layout.',
    layoutStyle: 'ocean-breeze',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0369a1', headerBgColorEnd: '#075985', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'sapphire-crest',
    name: 'Sapphire Royal Crest',
    description: 'Unique left spine architecture with inverted arch header, arch window portrait frame, and stat bar grid data layout.',
    layoutStyle: 'sapphire-crest',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fde68a',
      headerBgColor: '#1d4ed8', headerBgColorEnd: '#1e3a8a', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#1e3a8a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e3a8a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'teal-horizon',
    name: 'Teal Horizon Spine',
    description: 'Unique right ribbon architecture with reverse slash header, hexagon portrait frame, and hex node data layout.',
    layoutStyle: 'teal-horizon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
      headerBgColor: '#0f766e', headerBgColorEnd: '#115e59', cardBgColor: '#ffffff',
      accentColor: '#14b8a6', textColor: '#134e4a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'crimson-scholar',
    name: 'Crimson Scholar Pavilion',
    description: 'Unique floating header box architecture with hex bevel header, polaroid frame portrait frame, and split pill data layout.',
    layoutStyle: 'crimson-scholar',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
      headerBgColor: '#b91c1c', headerBgColorEnd: '#7f1d1d', cardBgColor: '#ffffff',
      accentColor: '#f43f5e', textColor: '#7f1d1d', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#b91c1c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#7f1d1d', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'indigo-modern',
    name: 'Indigo Modern Ticket',
    description: 'Unique double frame crest architecture with ribbon fold header, shield crest portrait frame, and minimal underline data layout.',
    layoutStyle: 'indigo-modern',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
      headerBgColor: '#4338ca', headerBgColorEnd: '#312e81', cardBgColor: '#ffffff',
      accentColor: '#6366f1', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#4338ca', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'amber-sunburst',
    name: 'Amber Sunburst Showcase',
    description: 'Unique pavilion hero architecture with gold emblem rule header, notched tech portrait frame, and minimal underline data layout.',
    layoutStyle: 'amber-sunburst',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#d97706', headerBgColorEnd: '#92400e', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#78350f', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#d97706', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#78350f', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'forest-heritage',
    name: 'Forest Heritage Ledger',
    description: 'Unique corner geometric architecture with royal arch header, arch window portrait frame, and floating tag data layout.',
    layoutStyle: 'forest-heritage',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#15803d', headerBgColorEnd: '#14532d', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#14532d', fontFamily: 'Georgia, serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#15803d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#14532d', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cobalt-executive-land',
    name: 'Cobalt Executive Sidebar',
    description: 'Unique land left sidebar architecture with dual wave header, hexagon portrait frame, and formal table data layout.',
    layoutStyle: 'cobalt-executive-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11, cardHeadingColor: '#bae6fd',
      headerBgColor: '#1e40af', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#0284c7', textColor: '#0f172a', fontFamily: 'Inter, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 18, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'rose-blossom',
    name: 'Rose Blossom Ribbon',
    description: 'Unique lanyard ticket architecture with diagonal slash header, hexagon portrait frame, and dotted leader data layout.',
    layoutStyle: 'rose-blossom',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fce7f3',
      headerBgColor: '#be123c', headerBgColorEnd: '#881337', cardBgColor: '#ffffff',
      accentColor: '#ec4899', textColor: '#881337', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#be123c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#881337', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'slate-corporate',
    name: 'Slate Corporate Lanyard',
    description: 'Unique frosted inner card architecture with scallop arch header, polaroid frame portrait frame, and striped rows data layout.',
    layoutStyle: 'slate-corporate',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#334155', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#0ea5e9', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#334155', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'turquoise-wave',
    name: 'Turquoise Hex Bevel',
    description: 'Unique magazine showcase architecture with crown peaks header, shield crest portrait frame, and top accent data layout.',
    layoutStyle: 'turquoise-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0891b2', headerBgColorEnd: '#155e75', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#164e63', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0891b2', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#164e63', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'burgundy-convent',
    name: 'Burgundy Convent Frame',
    description: 'Unique classic overlap architecture with gold emblem rule header, notched tech portrait frame, and top accent data layout.',
    layoutStyle: 'burgundy-convent',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#881337', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#4c0519', fontFamily: 'Georgia, serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#881337', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'emerald-wave',
    name: 'Emerald Frosted Card',
    description: 'Unique left spine architecture with royal arch header, reverse leaf portrait frame, and left accent data layout.',
    layoutStyle: 'emerald-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#d1fae5',
      headerBgColor: '#059669', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
      accentColor: '#10b981', textColor: '#064e3b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#059669', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'violet-zenith-land',
    name: 'Violet Zenith Smart Pass',
    description: 'Unique land smart pass architecture with chevron crest header, arch window portrait frame, and minimal underline data layout.',
    layoutStyle: 'violet-zenith-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11, cardHeadingColor: '#ede9fe',
      headerBgColor: '#6d28d9', headerBgColorEnd: '#4c1d95', cardBgColor: '#ffffff',
      accentColor: '#8b5cf6', textColor: '#2e1065', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 44, photoBorderColor: '#6d28d9', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'navy-gold-wave',
    name: 'Navy & Gold Crown Pass',
    description: 'Unique right ribbon architecture with diagonal slash header, hexagon portrait frame, and ledger box data layout.',
    layoutStyle: 'navy-gold-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#1e3a8a', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'coral-sunrise',
    name: 'Coral Sunrise Diagonal',
    description: 'Unique floating header box architecture with scallop arch header, polaroid frame portrait frame, and formal table data layout.',
    layoutStyle: 'coral-sunrise',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
      headerBgColor: '#e11d48', headerBgColorEnd: '#9f1239', cardBgColor: '#ffffff',
      accentColor: '#fb7185', textColor: '#881337', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#e11d48', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#881337', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cerulean-arch',
    name: 'Cerulean Arch Wing Pass',
    description: 'Unique double frame crest architecture with crown peaks header, shield crest portrait frame, and capsule data layout.',
    layoutStyle: 'cerulean-arch',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0284c7', headerBgColorEnd: '#0369a1', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'olive-academy',
    name: 'Olive Academy Box',
    description: 'Unique pavilion hero architecture with sawtooth trim header, notched tech portrait frame, and capsule data layout.',
    layoutStyle: 'olive-academy',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#ecfccb',
      headerBgColor: '#3f6212', headerBgColorEnd: '#1a2e05', cardBgColor: '#ffffff',
      accentColor: '#65a30d', textColor: '#1a2e05', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#3f6212', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1a2e05', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'plum-royal',
    name: 'Plum Royal Scallop',
    description: 'Unique corner geometric architecture with dual wave header, reverse leaf portrait frame, and stat bar grid data layout.',
    layoutStyle: 'plum-royal',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#f3e8ff',
      headerBgColor: '#7e22ce', headerBgColorEnd: '#581c87', cardBgColor: '#ffffff',
      accentColor: '#a855f7', textColor: '#3b0764', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#7e22ce', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#3b0764', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'teal-smart-land',
    name: 'Teal Smart Campus Pass',
    description: 'Unique land overlap card architecture with stepped cradle header, squircle portrait frame, and left accent data layout.',
    layoutStyle: 'teal-smart-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#ccfbf1',
      headerBgColor: '#0f766e', headerBgColorEnd: '#134e4a', cardBgColor: '#ffffff',
      accentColor: '#14b8a6', textColor: '#134e4a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 32, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'azure-ribbon',
    name: 'Azure Origami Fold',
    description: 'Unique lanyard ticket architecture with chevron crest header, circle ring portrait frame, and hex node data layout.',
    layoutStyle: 'azure-ribbon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
      headerBgColor: '#2563eb', headerBgColorEnd: '#1d4ed8', cardBgColor: '#ffffff',
      accentColor: '#3b82f6', textColor: '#1e3a8a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#2563eb', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e3a8a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'bronze-imperial',
    name: 'Bronze Imperial Medallion',
    description: 'Unique frosted inner card architecture with stepped cradle header, polaroid frame portrait frame, and split pill data layout.',
    layoutStyle: 'bronze-imperial',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fde68a',
      headerBgColor: '#78350f', headerBgColorEnd: '#451a03', cardBgColor: '#ffffff',
      accentColor: '#d97706', textColor: '#451a03', fontFamily: 'Georgia, serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#78350f', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'mint-fresh',
    name: 'Mint Fresh Spine Pass',
    description: 'Unique magazine showcase architecture with asymmetric sweep header, shield crest portrait frame, and minimal underline data layout.',
    layoutStyle: 'mint-fresh',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
      headerBgColor: '#0d9488', headerBgColorEnd: '#0f766e', cardBgColor: '#ffffff',
      accentColor: '#14b8a6', textColor: '#134e4a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0d9488', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'crimson-wave',
    name: 'Crimson Sawtooth Shield',
    description: 'Unique classic overlap architecture with sawtooth trim header, notched tech portrait frame, and minimal underline data layout.',
    layoutStyle: 'crimson-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fee2e2',
      headerBgColor: '#dc2626', headerBgColorEnd: '#991b1b', cardBgColor: '#ffffff',
      accentColor: '#ef4444', textColor: '#7f1d1d', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#dc2626', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#7f1d1d', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'midnight-cyan-land',
    name: 'Midnight Cyan VIP Pass',
    description: 'Unique land right vip architecture with asymmetric sweep header, leaf drop portrait frame, and hex node data layout.',
    layoutStyle: 'midnight-cyan-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#cffafe',
      headerBgColor: '#090d16', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 34, photoBorderColor: '#090d16', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'indigo-wing',
    name: 'Indigo Winged Scholar',
    description: 'Unique left spine architecture with dual wave header, reverse leaf portrait frame, and floating tag data layout.',
    layoutStyle: 'indigo-wing',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
      headerBgColor: '#3730a3', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
      accentColor: '#4f46e5', textColor: '#1e1b4b', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#3730a3', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'tangerine-wave',
    name: 'Tangerine Geometric Cut',
    description: 'Unique right ribbon architecture with chevron crest header, circle ring portrait frame, and dotted leader data layout.',
    layoutStyle: 'tangerine-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffedd5',
      headerBgColor: '#f97316', headerBgColorEnd: '#c2410c', cardBgColor: '#ffffff',
      accentColor: '#fb923c', textColor: '#7c2d12', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#f97316', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#7c2d12', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'jade-scholar',
    name: 'Jade Scholar Table',
    description: 'Unique floating header box architecture with stepped cradle header, diamond cut portrait frame, and striped rows data layout.',
    layoutStyle: 'jade-scholar',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#d1fae5',
      headerBgColor: '#047857', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
      accentColor: '#10b981', textColor: '#064e3b', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#047857', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'magenta-modern',
    name: 'Magenta Modern Pavilion',
    description: 'Unique double frame crest architecture with asymmetric sweep header, shield crest portrait frame, and top accent data layout.',
    layoutStyle: 'magenta-modern',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#fae8ff',
      headerBgColor: '#a21caf', headerBgColorEnd: '#701a75', cardBgColor: '#ffffff',
      accentColor: '#d946ef', textColor: '#4a044e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#a21caf', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'royal-gold-land',
    name: 'Royal Gold Horizon Pass',
    description: 'Unique land horizon split architecture with stadium curve header, corner brackets portrait frame, and striped rows data layout.',
    layoutStyle: 'royal-gold-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11, cardHeadingColor: '#fde68a',
      headerBgColor: '#1e3a8a', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#d97706', textColor: '#0f172a', fontFamily: 'Georgia, serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 10, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'peacock-blue',
    name: 'Peacock Blue Ticket',
    description: 'Unique pavilion hero architecture with stadium curve header, notched tech portrait frame, and top accent data layout.',
    layoutStyle: 'peacock-blue',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0369a1', headerBgColorEnd: '#164e63', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'garnet-shield',
    name: 'Garnet Shield Identity',
    description: 'Unique corner geometric architecture with s wave header, reverse leaf portrait frame, and left accent data layout.',
    layoutStyle: 'garnet-shield',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fde68a',
      headerBgColor: '#991b1b', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#991b1b', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cobalt-wave',
    name: 'Cobalt Frosted Showcase',
    description: 'Unique lanyard ticket architecture with inverted arch header, circle ring portrait frame, and ledger box data layout.',
    layoutStyle: 'cobalt-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
      headerBgColor: '#1d4ed8', headerBgColorEnd: '#1e3a8a', cardBgColor: '#ffffff',
      accentColor: '#3b82f6', textColor: '#172554', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#172554', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cypress-split',
    name: 'Cypress Split Hero',
    description: 'Unique frosted inner card architecture with reverse slash header, diamond cut portrait frame, and formal table data layout.',
    layoutStyle: 'cypress-split',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#dcfce7',
      headerBgColor: '#166534', headerBgColorEnd: '#052e16', cardBgColor: '#ffffff',
      accentColor: '#22c55e', textColor: '#052e16', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#166534', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#052e16', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'amethyst-wave-land',
    name: 'Amethyst Wave Landscape',
    description: 'Unique land left sidebar architecture with s wave header, octagon portrait frame, and capsule data layout.',
    layoutStyle: 'amethyst-wave-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11, cardHeadingColor: '#ede9fe',
      headerBgColor: '#5b21b6', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
      accentColor: '#8b5cf6', textColor: '#2e1065', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 20, photoBorderColor: '#5b21b6', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'navy-horizon',
    name: 'Navy Horizon Banner',
    description: 'Unique magazine showcase architecture with hex bevel header, octagon portrait frame, and capsule data layout.',
    layoutStyle: 'navy-horizon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0f172a', headerBgColorEnd: '#1e293b', cardBgColor: '#ffffff',
      accentColor: '#0284c7', textColor: '#0f172a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#0f172a', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'saffron-heritage',
    name: 'Saffron Heritage Crest',
    description: 'Unique classic overlap architecture with stadium curve header, notched tech portrait frame, and capsule data layout.',
    layoutStyle: 'saffron-heritage',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#c2410c', headerBgColorEnd: '#7c2d12', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#431407', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#c2410c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#431407', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'arctic-blue',
    name: 'Arctic Blue Scholar Box',
    description: 'Unique left spine architecture with s wave header, reverse leaf portrait frame, and stat bar grid data layout.',
    layoutStyle: 'arctic-blue',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0284c7', headerBgColorEnd: '#075985', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'mulberry-classic',
    name: 'Mulberry Classic Ledger',
    description: 'Unique right ribbon architecture with inverted arch header, circle ring portrait frame, and hex node data layout.',
    layoutStyle: 'mulberry-classic',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fae8ff',
      headerBgColor: '#701a75', headerBgColorEnd: '#4a044e', cardBgColor: '#ffffff',
      accentColor: '#d946ef', textColor: '#4a044e', fontFamily: 'Georgia, serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#701a75', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'emerald-smart-land',
    name: 'Emerald Smart Campus Pass',
    description: 'Unique land smart pass architecture with inverted arch header, diamond cut portrait frame, and floating tag data layout.',
    layoutStyle: 'emerald-smart-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11, cardHeadingColor: '#d1fae5',
      headerBgColor: '#065f46', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
      accentColor: '#10b981', textColor: '#022c22', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 16, photoBorderColor: '#065f46', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'denim-modern',
    name: 'Denim Right-Ribbon Pass',
    description: 'Unique floating header box architecture with reverse slash header, diamond cut portrait frame, and split pill data layout.',
    layoutStyle: 'denim-modern',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
      headerBgColor: '#1e40af', headerBgColorEnd: '#172554', cardBgColor: '#ffffff',
      accentColor: '#3b82f6', textColor: '#1e3a8a', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e3a8a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'ruby-executive',
    name: 'Ruby Executive Badge',
    description: 'Unique double frame crest architecture with hex bevel header, octagon portrait frame, and minimal underline data layout.',
    layoutStyle: 'ruby-executive',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
      headerBgColor: '#be123c', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
      accentColor: '#f43f5e', textColor: '#4c0519', fontFamily: 'Roboto, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#be123c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'lagoon-wave',
    name: 'Lagoon Arch Window',
    description: 'Unique pavilion hero architecture with ribbon fold header, corner brackets portrait frame, and minimal underline data layout.',
    layoutStyle: 'lagoon-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0e7490', headerBgColorEnd: '#083344', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#0e7490', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'gold-sovereign',
    name: 'Gold Sovereign Crest',
    description: 'Unique corner geometric architecture with gold emblem rule header, reverse leaf portrait frame, and floating tag data layout.',
    layoutStyle: 'gold-sovereign',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#1e293b', headerBgColorEnd: '#090d16', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#0f172a', fontFamily: 'Georgia, serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#1e293b', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'crimson-sidebar-land',
    name: 'Crimson Executive Sidebar',
    description: 'Unique land overlap card architecture with reverse slash header, circle ring portrait frame, and ledger box data layout.',
    layoutStyle: 'crimson-sidebar-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11, cardHeadingColor: '#fde68a',
      headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
      accentColor: '#d97706', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'executive', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 50, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'periwinkle-wave',
    name: 'Periwinkle Polaroid Pass',
    description: 'Unique lanyard ticket architecture with royal arch header, circle ring portrait frame, and dotted leader data layout.',
    layoutStyle: 'periwinkle-wave',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
      headerBgColor: '#4f46e5', headerBgColorEnd: '#312e81', cardBgColor: '#ffffff',
      accentColor: '#818cf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#4f46e5', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'pine-crest',
    name: 'Pine Crest Scholar',
    description: 'Unique frosted inner card architecture with diagonal slash header, diamond cut portrait frame, and striped rows data layout.',
    layoutStyle: 'pine-crest',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#14532d', headerBgColorEnd: '#052e16', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#052e16', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#14532d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#052e16', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'ochre-modern',
    name: 'Ochre Modern Split',
    description: 'Unique magazine showcase architecture with scallop arch header, octagon portrait frame, and top accent data layout.',
    layoutStyle: 'ochre-modern',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#b45309', headerBgColorEnd: '#78350f', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#451a03', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#b45309', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'glacier-wave-land',
    name: 'Glacier VIP Landscape',
    description: 'Unique land right vip architecture with hex bevel header, reverse leaf portrait frame, and split pill data layout.',
    layoutStyle: 'glacier-wave-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0369a1', headerBgColorEnd: '#0c4a6e', cardBgColor: '#ffffff',
      accentColor: '#0ea5e9', textColor: '#0c4a6e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 34, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'imperial-indigo-land',
    name: 'Imperial Indigo Smart Pass',
    description: 'Unique land horizon split architecture with ribbon fold header, notched tech portrait frame, and top accent data layout.',
    layoutStyle: 'imperial-indigo-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#312e81', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 12, photoBorderColor: '#312e81', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'aurora-teal-spine',
    name: 'Aurora Teal Vertical Spine',
    description: 'Unique classic overlap architecture with ribbon fold header, corner brackets portrait frame, and top accent data layout.',
    layoutStyle: 'aurora-teal-spine',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
      headerBgColor: '#0f766e', headerBgColorEnd: '#042f2e', cardBgColor: '#ffffff',
      accentColor: '#2dd4bf', textColor: '#042f2e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#042f2e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'imperial-maroon-pavilion',
    name: 'Imperial Maroon Pavilion',
    description: 'Unique left spine architecture with gold emblem rule header, leaf drop portrait frame, and left accent data layout.',
    layoutStyle: 'imperial-maroon-pavilion',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
      accentColor: '#fbbf24', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cyber-indigo-hexagon',
    name: 'Cyber Indigo Hex Grid',
    description: 'Unique right ribbon architecture with royal arch header, circle ring portrait frame, and ledger box data layout.',
    layoutStyle: 'cyber-indigo-hexagon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#312e81', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 50, photoBorderColor: '#312e81', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'emerald-ivy-frame',
    name: 'Emerald Ivy Double Frame',
    description: 'Unique floating header box architecture with diagonal slash header, diamond cut portrait frame, and formal table data layout.',
    layoutStyle: 'emerald-ivy-frame',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#065f46', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
      accentColor: '#fbbf24', textColor: '#022c22', fontFamily: 'Georgia, serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#065f46', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'sunset-amber-ticket',
    name: 'Sunset Amber Ticket Pass',
    description: 'Unique double frame crest architecture with scallop arch header, octagon portrait frame, and capsule data layout.',
    layoutStyle: 'sunset-amber-ticket',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffedd5',
      headerBgColor: '#c2410c', headerBgColorEnd: '#7c2d12', cardBgColor: '#ffffff',
      accentColor: '#fb923c', textColor: '#431407', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#c2410c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#431407', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'nordic-slate-minimal',
    name: 'Nordic Slate Minimal Box',
    description: 'Unique pavilion hero architecture with crown peaks header, corner brackets portrait frame, and capsule data layout.',
    layoutStyle: 'nordic-slate-minimal',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#1e293b', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Inter, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#1e293b', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'royal-amethyst-ribbon',
    name: 'Royal Amethyst Right Ribbon',
    description: 'Unique corner geometric architecture with sawtooth trim header, leaf drop portrait frame, and stat bar grid data layout.',
    layoutStyle: 'royal-amethyst-ribbon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fae8ff',
      headerBgColor: '#581c87', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
      accentColor: '#e879f9', textColor: '#2e1065', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#581c87', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'pacific-cobalt-showcase',
    name: 'Pacific Cobalt Showcase',
    description: 'Unique lanyard ticket architecture with dual wave header, squircle portrait frame, and hex node data layout.',
    layoutStyle: 'pacific-cobalt-showcase',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#1d4ed8', headerBgColorEnd: '#172554', cardBgColor: '#ffffff',
      accentColor: '#22d3ee', textColor: '#172554', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#172554', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'crimson-gold-horizon-land',
    name: 'Crimson Gold Horizon Land',
    description: 'Unique land left sidebar architecture with gold emblem rule header, shield crest portrait frame, and stat bar grid data layout.',
    layoutStyle: 'crimson-gold-horizon-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11, cardHeadingColor: '#fef08a',
      headerBgColor: '#991b1b', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 26, photoBorderColor: '#991b1b', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'botanical-sage-arch',
    name: 'Botanical Sage Arch Window',
    description: 'Unique frosted inner card architecture with chevron crest header, diamond cut portrait frame, and split pill data layout.',
    layoutStyle: 'botanical-sage-arch',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#ecfccb',
      headerBgColor: '#3f6212', headerBgColorEnd: '#1a2e05', cardBgColor: '#ffffff',
      accentColor: '#a3e635', textColor: '#1a2e05', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 16, photoBorderColor: '#3f6212', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1a2e05', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'oxford-navy-striped',
    name: 'Oxford Navy Striped Ledger',
    description: 'Unique magazine showcase architecture with stepped cradle header, octagon portrait frame, and minimal underline data layout.',
    layoutStyle: 'oxford-navy-striped',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#1e3a8a', headerBgColorEnd: '#090d16', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#0f172a', fontFamily: 'Georgia, serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'flamingo-rose-frosted',
    name: 'Flamingo Rose Frosted Pass',
    description: 'Unique classic overlap architecture with crown peaks header, corner brackets portrait frame, and minimal underline data layout.',
    layoutStyle: 'flamingo-rose-frosted',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fce7f3',
      headerBgColor: '#be185d', headerBgColorEnd: '#500724', cardBgColor: '#ffffff',
      accentColor: '#f472b6', textColor: '#500724', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#be185d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#500724', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'titanium-cyan-corner',
    name: 'Titanium Cyan Corner Cut',
    description: 'Unique left spine architecture with sawtooth trim header, leaf drop portrait frame, and floating tag data layout.',
    layoutStyle: 'titanium-cyan-corner',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0f172a', headerBgColorEnd: '#1e293b', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#0f172a', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'copper-leaf-academy',
    name: 'Copper Leaf Academy Card',
    description: 'Unique right ribbon architecture with dual wave header, squircle portrait frame, and dotted leader data layout.',
    layoutStyle: 'copper-leaf-academy',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#9a3412', headerBgColorEnd: '#431407', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#431407', fontFamily: 'Georgia, serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#9a3412', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#431407', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'sapphire-vip-land',
    name: 'Sapphire Right-VIP Landscape',
    description: 'Unique land smart pass architecture with royal arch header, polaroid frame portrait frame, and dotted leader data layout.',
    layoutStyle: 'sapphire-vip-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#1e40af', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 14, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'velvet-plum-polaroid',
    name: 'Velvet Plum Polaroid Crest',
    description: 'Unique floating header box architecture with chevron crest header, arch window portrait frame, and striped rows data layout.',
    layoutStyle: 'velvet-plum-polaroid',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#f3e8ff',
      headerBgColor: '#6b21a8', headerBgColorEnd: '#3b0764', cardBgColor: '#ffffff',
      accentColor: '#c084fc', textColor: '#3b0764', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#6b21a8', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#3b0764', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'aquamarine-crown-pass',
    name: 'Aquamarine Crown Peak Pass',
    description: 'Unique double frame crest architecture with stepped cradle header, octagon portrait frame, and top accent data layout.',
    layoutStyle: 'aquamarine-crown-pass',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ccfbf1',
      headerBgColor: '#0e7490', headerBgColorEnd: '#164e63', cardBgColor: '#ffffff',
      accentColor: '#2dd4bf', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 20, photoBorderColor: '#0e7490', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'charcoal-gold-pavilion',
    name: 'Charcoal Gold Pavilion',
    description: 'Unique pavilion hero architecture with asymmetric sweep header, corner brackets portrait frame, and top accent data layout.',
    layoutStyle: 'charcoal-gold-pavilion',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#18181b', headerBgColorEnd: '#09090b', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#09090b', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#18181b', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#09090b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cerulean-dotted-editorial',
    name: 'Cerulean Dotted Editorial',
    description: 'Unique corner geometric architecture with stadium curve header, leaf drop portrait frame, and left accent data layout.',
    layoutStyle: 'cerulean-dotted-editorial',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0284c7', headerBgColorEnd: '#0c4a6e', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0c4a6e', fontFamily: 'Inter, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0c4a6e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'forest-mint-horizon-land',
    name: 'Forest Mint Horizon Land',
    description: 'Unique land overlap card architecture with diagonal slash header, hexagon portrait frame, and formal table data layout.',
    layoutStyle: 'forest-mint-horizon-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11, cardHeadingColor: '#d1fae5',
      headerBgColor: '#047857', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
      accentColor: '#34d399', textColor: '#022c22', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 18, photoBorderColor: '#047857', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'burgundy-gold-spine',
    name: 'Burgundy Gold Spine Pass',
    description: 'Unique lanyard ticket architecture with s wave header, squircle portrait frame, and ledger box data layout.',
    layoutStyle: 'burgundy-gold-spine',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#881337', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
      accentColor: '#fbbf24', textColor: '#4c0519', fontFamily: 'Georgia, serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#881337', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'electric-cobalt-notched',
    name: 'Electric Cobalt Notched Tech',
    description: 'Unique frosted inner card architecture with inverted arch header, arch window portrait frame, and formal table data layout.',
    layoutStyle: 'electric-cobalt-notched',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
      headerBgColor: '#2563eb', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
      accentColor: '#60a5fa', textColor: '#1e1b4b', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#2563eb', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'terracotta-warm-ticket',
    name: 'Terracotta Warm Ticket',
    description: 'Unique magazine showcase architecture with reverse slash header, hexagon portrait frame, and capsule data layout.',
    layoutStyle: 'terracotta-warm-ticket',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffedd5',
      headerBgColor: '#b45309', headerBgColorEnd: '#451a03', cardBgColor: '#ffffff',
      accentColor: '#fb923c', textColor: '#451a03', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#b45309', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'jade-lotus-scallop',
    name: 'Jade Lotus Scallop Card',
    description: 'Unique classic overlap architecture with asymmetric sweep header, corner brackets portrait frame, and capsule data layout.',
    layoutStyle: 'jade-lotus-scallop',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#d1fae5',
      headerBgColor: '#059669', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
      accentColor: '#6ee7b7', textColor: '#064e3b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 10, photoBorderColor: '#059669', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'obsidian-emerald-land',
    name: 'Obsidian Emerald VIP Land',
    description: 'Unique land right vip architecture with scallop arch header, arch window portrait frame, and minimal underline data layout.',
    layoutStyle: 'obsidian-emerald-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11, cardHeadingColor: '#d1fae5',
      headerBgColor: '#090d16', headerBgColorEnd: '#022c22', cardBgColor: '#ffffff',
      accentColor: '#10b981', textColor: '#022c22', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 44, photoBorderColor: '#090d16', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#022c22', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'indigo-origami-ribbon',
    name: 'Indigo Origami Right Ribbon',
    description: 'Unique left spine architecture with stadium curve header, leaf drop portrait frame, and stat bar grid data layout.',
    layoutStyle: 'indigo-origami-ribbon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0e7ff',
      headerBgColor: '#3730a3', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
      accentColor: '#818cf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#3730a3', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'ruby-diamond-frame',
    name: 'Ruby Diamond Double Frame',
    description: 'Unique right ribbon architecture with s wave header, squircle portrait frame, and hex node data layout.',
    layoutStyle: 'ruby-diamond-frame',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
      headerBgColor: '#be123c', headerBgColorEnd: '#4c0519', cardBgColor: '#ffffff',
      accentColor: '#fda4af', textColor: '#4c0519', fontFamily: 'Georgia, serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#be123c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4c0519', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'sky-horizon-floating-box',
    name: 'Sky Horizon Floating Box',
    description: 'Unique floating header box architecture with inverted arch header, arch window portrait frame, and split pill data layout.',
    layoutStyle: 'sky-horizon-floating-box',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#0369a1', headerBgColorEnd: '#082f49', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#082f49', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#082f49', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'amethyst-gold-showcase',
    name: 'Amethyst Gold Showcase',
    description: 'Unique double frame crest architecture with reverse slash header, hexagon portrait frame, and minimal underline data layout.',
    layoutStyle: 'amethyst-gold-showcase',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#4c1d95', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#2e1065', fontFamily: 'Georgia, serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#4c1d95', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'teal-executive-sidebar-land',
    name: 'Teal Executive Sidebar Land',
    description: 'Unique land horizon split architecture with crown peaks header, squircle portrait frame, and left accent data layout.',
    layoutStyle: 'teal-executive-sidebar-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11, cardHeadingColor: '#ccfbf1',
      headerBgColor: '#0d9488', headerBgColorEnd: '#134e4a', cardBgColor: '#ffffff',
      accentColor: '#2dd4bf', textColor: '#134e4a', fontFamily: 'Inter, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 32, photoBorderColor: '#0d9488', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#134e4a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cobalt-sawtooth-corner',
    name: 'Cobalt Sawtooth Corner Cut',
    description: 'Unique pavilion hero architecture with hex bevel header, polaroid frame portrait frame, and minimal underline data layout.',
    layoutStyle: 'cobalt-sawtooth-corner',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#1d4ed8', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#1d4ed8', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'olive-gold-spine',
    name: 'Olive Gold Vertical Spine',
    description: 'Unique corner geometric architecture with ribbon fold header, leaf drop portrait frame, and floating tag data layout.',
    layoutStyle: 'olive-gold-spine',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#365314', headerBgColorEnd: '#1a2e05', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#1a2e05', fontFamily: 'Georgia, serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 34, photoBorderColor: '#365314', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#1a2e05', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'coral-frosted-inner',
    name: 'Coral Frosted Inner Card',
    description: 'Unique lanyard ticket architecture with gold emblem rule header, squircle portrait frame, and dotted leader data layout.',
    layoutStyle: 'coral-frosted-inner',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#ffe4e6',
      headerBgColor: '#e11d48', headerBgColorEnd: '#881337', cardBgColor: '#ffffff',
      accentColor: '#fda4af', textColor: '#881337', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#e11d48', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#881337', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'navy-bevel-split-pill',
    name: 'Navy Bevel Split-Pill Card',
    description: 'Unique frosted inner card architecture with royal arch header, arch window portrait frame, and striped rows data layout.',
    layoutStyle: 'navy-bevel-split-pill',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#e0f2fe',
      headerBgColor: '#1e3a8a', headerBgColorEnd: '#0f172a', cardBgColor: '#ffffff',
      accentColor: '#38bdf8', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#1e3a8a', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'magenta-smart-pass-land',
    name: 'Magenta Smart Campus Land',
    description: 'Unique land left sidebar architecture with sawtooth trim header, leaf drop portrait frame, and hex node data layout.',
    layoutStyle: 'magenta-smart-pass-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11, cardHeadingColor: '#fae8ff',
      headerBgColor: '#86198f', headerBgColorEnd: '#4a044e', cardBgColor: '#ffffff',
      accentColor: '#e879f9', textColor: '#4a044e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 34, photoBorderColor: '#86198f', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'emerald-pavilion-crest',
    name: 'Emerald Pavilion Crest',
    description: 'Unique magazine showcase architecture with diagonal slash header, hexagon portrait frame, and top accent data layout.',
    layoutStyle: 'emerald-pavilion-crest',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#047857', headerBgColorEnd: '#064e3b', cardBgColor: '#ffffff',
      accentColor: '#fbbf24', textColor: '#064e3b', fontFamily: 'Georgia, serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#047857', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#064e3b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'amber-right-ribbon',
    name: 'Amber Right-Ribbon Scholar',
    description: 'Unique classic overlap architecture with hex bevel header, polaroid frame portrait frame, and top accent data layout.',
    layoutStyle: 'amber-right-ribbon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#d97706', headerBgColorEnd: '#78350f', cardBgColor: '#ffffff',
      accentColor: '#fbbf24', textColor: '#451a03', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#d97706', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'arctic-lanyard-ticket',
    name: 'Arctic Lanyard Ticket Pass',
    description: 'Unique left spine architecture with ribbon fold header, shield crest portrait frame, and left accent data layout.',
    layoutStyle: 'arctic-lanyard-ticket',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0284c7', headerBgColorEnd: '#075985', cardBgColor: '#ffffff',
      accentColor: '#22d3ee', textColor: '#083344', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#0284c7', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'maroon-showcase-plaque',
    name: 'Maroon Showcase Plaque',
    description: 'Unique right ribbon architecture with gold emblem rule header, squircle portrait frame, and ledger box data layout.',
    layoutStyle: 'maroon-showcase-plaque',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#7f1d1d', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 32, photoBorderColor: '#7f1d1d', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'indigo-overlap-land',
    name: 'Indigo Overlap Landscape',
    description: 'Unique land smart pass architecture with dual wave header, corner brackets portrait frame, and striped rows data layout.',
    layoutStyle: 'indigo-overlap-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11, cardHeadingColor: '#e0e7ff',
      headerBgColor: '#4338ca', headerBgColorEnd: '#1e1b4b', cardBgColor: '#ffffff',
      accentColor: '#818cf8', textColor: '#1e1b4b', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 10, photoBorderColor: '#4338ca', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#1e1b4b', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'teal-double-frame',
    name: 'Teal Ornamental Frame',
    description: 'Unique floating header box architecture with royal arch header, arch window portrait frame, and formal table data layout.',
    layoutStyle: 'teal-double-frame',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#0f766e', headerBgColorEnd: '#042f2e', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#042f2e', fontFamily: 'Georgia, serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#0f766e', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#042f2e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'violet-corner-polygon',
    name: 'Violet Corner Polygon Pass',
    description: 'Unique double frame crest architecture with diagonal slash header, hexagon portrait frame, and capsule data layout.',
    layoutStyle: 'violet-corner-polygon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11.5, cardHeadingColor: '#f3e8ff',
      headerBgColor: '#6d28d9', headerBgColorEnd: '#2e1065', cardBgColor: '#ffffff',
      accentColor: '#c084fc', textColor: '#2e1065', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#6d28d9', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#2e1065', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'sapphire-floating-box',
    name: 'Sapphire Floating Header Box',
    description: 'Unique pavilion hero architecture with scallop arch header, polaroid frame portrait frame, and capsule data layout.',
    layoutStyle: 'sapphire-floating-box',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'VERIFIED STUDENT BADGE', cardHeadingFontSize: 11.5, cardHeadingColor: '#dbeafe',
      headerBgColor: '#1e40af', headerBgColorEnd: '#172554', cardBgColor: '#ffffff',
      accentColor: '#60a5fa', textColor: '#172554', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'executive', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#1e40af', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#172554', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'crimson-spine-academy',
    name: 'Crimson Spine Academy Card',
    description: 'Unique corner geometric architecture with crown peaks header, shield crest portrait frame, and stat bar grid data layout.',
    layoutStyle: 'crimson-spine-academy',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'SCHOLAR ID CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef3c7',
      headerBgColor: '#b91c1c', headerBgColorEnd: '#450a0a', cardBgColor: '#ffffff',
      accentColor: '#fbbf24', textColor: '#450a0a', fontFamily: 'Georgia, serif',
      headerStyle: 'gradient', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 26, photoBorderColor: '#b91c1c', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#450a0a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'bronze-vip-land',
    name: 'Bronze Right-VIP Landscape',
    description: 'Unique land overlap card architecture with chevron crest header, octagon portrait frame, and capsule data layout.',
    layoutStyle: 'bronze-vip-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL CAMPUS PASS', cardHeadingFontSize: 11, cardHeadingColor: '#fef3c7',
      headerBgColor: '#78350f', headerBgColorEnd: '#451a03', cardBgColor: '#ffffff',
      accentColor: '#f59e0b', textColor: '#451a03', fontFamily: 'Georgia, serif',
      headerStyle: 'minimal', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 20, photoBorderColor: '#78350f', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#451a03', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'cyan-frosted-shield',
    name: 'Cyan Frosted Shield Pass',
    description: 'Unique lanyard ticket architecture with sawtooth trim header, notched tech portrait frame, and hex node data layout.',
    layoutStyle: 'cyan-frosted-shield',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT CREDENTIAL CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#cffafe',
      headerBgColor: '#0891b2', headerBgColorEnd: '#083344', cardBgColor: '#ffffff',
      accentColor: '#22d3ee', textColor: '#083344', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'split', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 12, photoBorderColor: '#0891b2', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#083344', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'forest-pavilion-scholar',
    name: 'Forest Pavilion Scholar',
    description: 'Unique frosted inner card architecture with dual wave header, arch window portrait frame, and split pill data layout.',
    layoutStyle: 'forest-pavilion-scholar',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'STUDENT IDENTITY PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#dcfce7',
      headerBgColor: '#166534', headerBgColorEnd: '#052e16', cardBgColor: '#ffffff',
      accentColor: '#4ade80', textColor: '#052e16', fontFamily: 'Montserrat, sans-serif',
      headerStyle: 'wave', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 44, photoBorderColor: '#166534', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#052e16', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'plum-ticket-credential',
    name: 'Plum Ticket Credential',
    description: 'Unique magazine showcase architecture with chevron crest header, hexagon portrait frame, and minimal underline data layout.',
    layoutStyle: 'plum-ticket-credential',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'OFFICIAL STUDENT CARD', cardHeadingFontSize: 11.5, cardHeadingColor: '#fce7f3',
      headerBgColor: '#701a75', headerBgColorEnd: '#4a044e', cardBgColor: '#ffffff',
      accentColor: '#f472b6', textColor: '#4a044e', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'regal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 18, photoBorderColor: '#701a75', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#4a044e', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'slate-gold-right-ribbon',
    name: 'Slate Gold Right Ribbon',
    description: 'Unique classic overlap architecture with scallop arch header, polaroid frame portrait frame, and minimal underline data layout.',
    layoutStyle: 'slate-gold-right-ribbon',
    cardSize: { preset: 'CR80_PORTRAIT', widthMm: 53.98, heightMm: 85.60, orientation: 'portrait', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 30, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'ACADEMIC SCHOLAR PASS', cardHeadingFontSize: 11.5, cardHeadingColor: '#fef08a',
      headerBgColor: '#334155', headerBgColorEnd: '#090d16', cardBgColor: '#ffffff',
      accentColor: '#eab308', textColor: '#0f172a', fontFamily: 'Roboto, sans-serif',
      headerStyle: 'diagonal', showLogo: true, logoSize: 72, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 184, photoHeight: 228, photoBorderRadius: 14, photoBorderColor: '#334155', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 27, nameFontWeight: '800', nameColor: '#0f172a', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13.5, labelFontSize: 9, spacing: 9, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: false, qrSize: 78, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: true },
    signature: { showSignature: true, label: 'Principal Signature', signatureX: 0, signatureY: 0, alignment: 'right' }
  },
  {
    id: 'ocean-horizon-split-land',
    name: 'Ocean Horizon Split Land',
    description: 'Unique land right vip architecture with stepped cradle header, diamond cut portrait frame, and floating tag data layout.',
    layoutStyle: 'ocean-horizon-split-land',
    cardSize: { preset: 'CR80_LANDSCAPE', widthMm: 85.60, heightMm: 53.98, orientation: 'landscape', safeMarginMm: 3 },
    branding: {
      schoolNameFontSize: 28, schoolNameFontWeight: '800', schoolNameColor: '#ffffff',
      cardHeading: 'CAMPUS IDENTITY CREDENTIAL', cardHeadingFontSize: 11, cardHeadingColor: '#cffafe',
      headerBgColor: '#0369a1', headerBgColorEnd: '#082f49', cardBgColor: '#ffffff',
      accentColor: '#06b6d4', textColor: '#082f49', fontFamily: 'Outfit, sans-serif',
      headerStyle: 'pinstripe', showLogo: true, logoSize: 58, logoPosition: 'left',
      logoX: 0, logoY: 0
    },
    studentFields: {
      photoWidth: 172, photoHeight: 214, photoBorderRadius: 16, photoBorderColor: '#0369a1', photoBorderWidth: 3, photoShadow: true,
      photoX: 0, photoY: 0, nameFontSize: 24, nameFontWeight: '800', nameColor: '#082f49', nameX: 0, nameY: 0,
      alignment: 'center', fieldFontSize: 13, labelFontSize: 9, spacing: 8, detailsX: 0, detailsY: 0
    },
    decorations: { showQrCode: true, qrSize: 76, qrX: 0, qrY: 0, qrFormat: 'qr', watermark: 'none', accentStripe: false },
    signature: { showSignature: true, label: 'Authorized Signatory', signatureX: 0, signatureY: 0, alignment: 'right' }
  }
];

if (typeof window !== 'undefined') {
  window.BUILTIN_ID_CARD_TEMPLATES = BUILTIN_ID_CARD_TEMPLATES;
}

let designerCurrentSide = 'front';
let isDesignerDirty = false;
let designerZoomLevel = 0.85;
let currentGalleryFilter = 'all';
let modalTemplateId = 'royal-blue';
let modalSide = 'front';

// Undo / Redo history stacks
let designerUndoStack = [];
let designerRedoStack = [];

function pushUndoState() {
  try {
    const snap = collectDesignerDesignFromForm();
    if (designerUndoStack.length > 30) designerUndoStack.shift();
    designerUndoStack.push(snap);
    designerRedoStack = [];
    updateUndoRedoButtons();
  } catch (e) {
    console.warn('Failed to push undo state:', e);
  }
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('designer-btn-undo');
  const redoBtn = document.getElementById('designer-btn-redo');
  if (undoBtn) {
    const canUndo = designerUndoStack.length > 1;
    undoBtn.disabled = !canUndo;
    undoBtn.classList.toggle('cursor-not-allowed', !canUndo);
    undoBtn.classList.toggle('text-slate-400', !canUndo);
    undoBtn.classList.toggle('text-slate-800', canUndo);
    undoBtn.classList.toggle('dark:text-slate-200', canUndo);
  }
  if (redoBtn) {
    const canRedo = designerRedoStack.length > 0;
    redoBtn.disabled = !canRedo;
    redoBtn.classList.toggle('cursor-not-allowed', !canRedo);
    redoBtn.classList.toggle('text-slate-400', !canRedo);
    redoBtn.classList.toggle('text-slate-800', canRedo);
    redoBtn.classList.toggle('dark:text-slate-200', canRedo);
  }
}

function undoDesigner() {
  if (designerUndoStack.length <= 1) return;
  const current = designerUndoStack.pop();
  designerRedoStack.push(current);
  const prev = designerUndoStack[designerUndoStack.length - 1];
  if (prev) {
    populateDesignerFormFromDesign(prev);
    isDesignerDirty = true;
    document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
    renderDesignerLivePreview();
  }
  updateUndoRedoButtons();
}

function redoDesigner() {
  if (designerRedoStack.length === 0) return;
  const next = designerRedoStack.pop();
  designerUndoStack.push(next);
  if (next) {
    populateDesignerFormFromDesign(next);
    isDesignerDirty = true;
    document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
    renderDesignerLivePreview();
  }
  updateUndoRedoButtons();
}

// -------------------------------------------------------------------------
// DYNAMIC CARD RENDERER (Supports 10 distinct layouts + offsets + QR codes)
// Isolated from the default V5 ID card so default card remains untouched
// -------------------------------------------------------------------------
const DESIGNED_TEMPLATES_ISOLATION_CSS = `<style>
.gjv-id-v5[class*="tpl-"]::before,
.gjv-id-v5.custom-card-back::before {
  content: none !important;
  display: none !important;
  border: none !important;
}
.gjv-id-v5[class*="tpl-"] *,
.gjv-id-v5.custom-card-back * {
  box-sizing: border-box;
}
</style>`;

function buildFallbackVerificationDataUrl(seedText, format = 'qr', accentColor = '#0f172a') {
  const s = String(seedText || 'ID-2026');
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  if (format === 'barcode') {
    let bars = '';
    let x = 8;
    for (let i = 0; i < 28; i++) {
      const w = ((Math.abs(hash >> (i % 16)) + i * 7) % 3) + 1.5;
      const gap = ((Math.abs(hash >> ((i + 5) % 16)) + i * 3) % 2) + 1.2;
      bars += `<rect x="${x.toFixed(1)}" y="6" width="${w.toFixed(1)}" height="32" rx="0.5" fill="#0f172a"/>`;
      x += w + gap;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(x + 8)} 44" width="140" height="44"><rect width="100%" height="100%" fill="#ffffff"/>${bars}</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  const n = 11;
  const cell = 8;
  const pad = 6;
  const total = n * cell + pad * 2;
  let rects = `<rect width="${total}" height="${total}" rx="6" fill="#ffffff"/>`;
  const drawFinder = (ox, oy) => {
    rects += `<rect x="${ pad + ox * cell }" y="${ pad + oy * cell }" width="${ 3 * cell }" height="${ 3 * cell }" rx="2" fill="#0f172a"/>`;
    rects += `<rect x="${ pad + (ox + 0.5) * cell }" y="${ pad + (oy + 0.5) * cell }" width="${ 2 * cell }" height="${ 2 * cell }" rx="1" fill="#ffffff"/>`;
    rects += `<rect x="${ pad + (ox + 1) * cell }" y="${ pad + (oy + 1) * cell }" width="${ cell }" height="${ cell }" fill="${accentColor}"/>`;
  };
  drawFinder(0, 0);
  drawFinder(n - 3, 0);
  drawFinder(0, n - 3);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if ((r < 4 && c < 4) || (r < 4 && c >= n - 4) || (r >= n - 4 && c < 4)) continue;
      const bit = (Math.abs(hash ^ ((r * 31 + c * 17) * 2654435761)) % 10) < 5;
      if (bit) {
        rects += `<rect x="${ pad + c * cell }" y="${ pad + r * cell }" width="${ cell - 1 }" height="${ cell - 1 }" rx="1.5" fill="#0f172a"/>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}">${rects}</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderDynamicDesignedCardHTML(student, session, principal, savedSignatureImage, design, side = 'front', options = {}) {
  if (!student) return '';
  const safe = value => subjectHtmlEscape(String(value ?? ''));
  const dob = String(student.dob || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3-$2-$1') || 'N/A';
  const defaultLogo = resolveIdCardAssetUrl('/logo.jpg');
  const logo = resolveIdCardAssetUrl(window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? defaultLogo : '/neutral-school-logo.svg'));
  const emptyPhoto = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='350' height='450'%3E%3Crect width='100%25' height='100%25' fill='%23edf0f2'/%3E%3Ccircle cx='175' cy='150' r='70' fill='%23cbd2d8'/%3E%3Crect x='75' y='250' width='200' height='170' rx='90' fill='%23cbd2d8'/%3E%3C/svg%3E";
  const studentPhoto = safe(resolveIdCardAssetUrl(student.photo) || emptyPhoto);

  const isLandscape = design?.cardSize?.orientation === 'landscape';
  const cardW = isLandscape ? 960 : 600;
  const cardH = isLandscape ? 600 : 960;
  const scale = options.previewScale || (isLandscape ? 0.65 : 0.7);
  const shellW = Math.round(cardW * scale);
  const shellH = Math.round(cardH * scale);
  const cardDimLock = `width:${cardW}px;height:${cardH}px;min-width:${cardW}px;max-width:${cardW}px;min-height:${cardH}px;max-height:${cardH}px;`;

  const branding = design?.branding || {};
  const rawSchoolName = String(branding.schoolName || window.currentSchool?.name || 'School Name').trim();
  const schoolName = safe(rawSchoolName);
  const schoolNameSize = Number(branding.schoolNameFontSize || (isLandscape ? 28 : 31));
  const schoolNameWeight = branding.schoolNameFontWeight || '800';
  const schoolNameColor = branding.schoolNameColor || '#ffffff';
  const cardHeading = safe(branding.cardHeading || 'STUDENT IDENTITY CARD');
  const cardHeadingSize = Number(branding.cardHeadingFontSize || 12);
  const cardHeadingColor = branding.cardHeadingColor || '#c99a35';
  const headerBgStart = branding.headerBgColor || '#082f55';
  const headerBgEnd = branding.headerBgColorEnd || '#041b31';
  const cardBg = branding.cardBgColor || '#ffffff';
  const accentColor = branding.accentColor || '#c99a35';
  const textColor = branding.textColor || '#082f55';
  const fontFamily = branding.fontFamily || 'Outfit, sans-serif';
  const headerStyle = branding.headerStyle || 'gradient';
  const showLogo = branding.showLogo !== false;
  const logoSize = Number(branding.logoSize || (isLandscape ? 58 : 74));
  const logoPos = branding.logoPosition || 'left';
  const schoolAddress = safe(branding.schoolAddress || window.currentSchool?.address || '');
  const schoolPhone = safe(branding.schoolPhone || window.currentSchool?.phone || '');
  const schoolWebsite = safe(branding.schoolWebsite || window.currentSchool?.websiteUrl || '');
  const schoolContactLine = [schoolAddress, schoolPhone ? `Tel: ${schoolPhone}` : '', schoolWebsite].filter(Boolean).join(' • ');

  // Element Offsets
  const logoX = Number(branding.logoX || 0);
  const logoY = Number(branding.logoY || 0);

  const studentFieldsCfg = design?.studentFields || {};
  const photoW = Number(studentFieldsCfg.photoWidth || (isLandscape ? 174 : 194));
  const photoH = Number(studentFieldsCfg.photoHeight || (isLandscape ? 216 : 246));
  const photoRadius = Number(studentFieldsCfg.photoBorderRadius ?? (isLandscape ? 20 : 28));
  const photoBorderColor = studentFieldsCfg.photoBorderColor || accentColor;
  const photoBorderWidth = Number(studentFieldsCfg.photoBorderWidth ?? 3);
  const photoShadow = studentFieldsCfg.photoShadow !== false;
  const nameSize = Number(studentFieldsCfg.nameFontSize || (isLandscape ? 25 : 28));
  const nameWeight = studentFieldsCfg.nameFontWeight || '800';
  const nameColor = studentFieldsCfg.nameColor || headerBgEnd;
  const nameAlign = studentFieldsCfg.alignment || (isLandscape ? 'left' : 'center');
  const fieldFontSize = Number(studentFieldsCfg.fieldFontSize || (isLandscape ? 13 : 14));
  const labelFontSize = Number(studentFieldsCfg.labelFontSize || 9);
  const fieldSpacing = Number(studentFieldsCfg.spacing || (isLandscape ? 8 : 10));
  const fieldsMap = studentFieldsCfg.fields || {};

  const photoX = Number(studentFieldsCfg.photoX || 0);
  const photoY = Number(studentFieldsCfg.photoY || 0);
  const nameX = Number(studentFieldsCfg.nameX || 0);
  const nameY = Number(studentFieldsCfg.nameY || 0);
  const detailsX = Number(studentFieldsCfg.detailsX || 0);
  const detailsY = Number(studentFieldsCfg.detailsY || 0);

  const sigCfg = design?.signature || {};
  const showSignature = sigCfg.showSignature !== false;
  const sigLabel = safe(sigCfg.label || 'Principal Signature');
  const sigPrincipal = savedSignatureImage || String(sigCfg.principalName || principal || '').trim() || (window.currentSchool?.principalName || 'Principal');
  const sigIsImage = !!savedSignatureImage || /^(data:|https?:|\/)/i.test(sigPrincipal) || /\.(png|jpe?g|svg|webp)$/i.test(sigPrincipal);
  const sigX = Number(sigCfg.signatureX || 0);
  const sigY = Number(sigCfg.signatureY || 0);

  const layoutStyle = design?.layoutStyle || design?.templateId || (isLandscape ? 'modern-minimal' : 'royal-blue');
  const sigTextColor = textColor || '#0f172a';
  const sigFontSize = isLandscape ? 18 : 22;

  const sigMarkup = sigIsImage
    ? `<img alt="Principal signature" src="${safe(resolveIdCardAssetUrl(sigPrincipal))}" crossorigin="anonymous" style="display:block;max-height:42px;max-width:175px;object-fit:contain;margin:0 auto">`
    : `<div style="font-family:'Brush Script MT','Segoe Script','Georgia',cursive,serif;font-style:italic;font-size:${sigFontSize}px;color:${sigTextColor};font-weight:700;line-height:1.1;text-align:center;white-space:nowrap">${safe(sigPrincipal)}</div>`;

  const decorations = design?.decorations || {};
  const showQrCode = decorations.showQrCode ?? design?.showQrCode ?? false;
  const qrSize = Number(decorations.qrSize || (isLandscape ? 78 : 80));
  const qrX = Number(decorations.qrX || 0);
  const qrY = Number(decorations.qrY || 0);
  const qrFormat = decorations.qrFormat || 'qr';
  const watermark = decorations.watermark || 'none';
  const accentStripe = decorations.accentStripe !== false;

  const safeMarginMm = Number(design?.cardSize?.safeMarginMm || 3);
  const marginInsetPx = Math.round(safeMarginMm * 3.78);
  const marginGuideHtml = options.showMargins
    ? `<div style="position:absolute;top:${marginInsetPx}px;left:${marginInsetPx}px;right:${marginInsetPx}px;bottom:${marginInsetPx}px;border:2px dashed #10b981;border-radius:14px;pointer-events:none;z-index:99;box-sizing:border-box"></div>`
    : '';

  // Generate Scannable QR Code or Barcode Data URL if enabled
  let qrCodeDataUrl = '';
  if (showQrCode) {
    const qrPayload = JSON.stringify({
      school: rawSchoolName,
      id: student.admissionNo || '',
      name: student.name || '',
      cls: `${student.className || ''} ${student.section || ''}`.trim(),
      roll: student.rollNo || '',
      sess: session || student.session || ''
    });
    try {
      if (qrFormat === 'barcode' && typeof generateBarcodeImage === 'function') {
        qrCodeDataUrl = generateBarcodeImage(String(student.admissionNo || 'ID-2026'));
      } else if (typeof generateQRCodeImage === 'function') {
        qrCodeDataUrl = generateQRCodeImage(qrPayload);
      } else {
        qrCodeDataUrl = buildFallbackVerificationDataUrl(qrPayload, qrFormat, accentColor);
      }
    } catch (e) {
      qrCodeDataUrl = buildFallbackVerificationDataUrl(qrPayload, qrFormat, accentColor);
    }
  }

  // Watermark layer
  let watermarkHtml = '';
  if (watermark === 'dots') {
    watermarkHtml = `<div style="position:absolute;inset:0;background-image:radial-gradient(${accentColor} 1.25px, transparent 1.25px);background-size:20px 20px;opacity:0.055;pointer-events:none;z-index:1"></div>`;
  } else if (watermark === 'crest' && logo) {
    watermarkHtml = `<div style="position:absolute;top:58%;left:50%;transform:translate(-50%,-50%);width:290px;height:290px;opacity:0.05;pointer-events:none;z-index:1;background:url('${logo}') center/contain no-repeat;filter:grayscale(100%)"></div>`;
  }

  // BACK SIDE RENDERING
  if (side === 'back') {
    const backCfg = design?.backSide || {};
    const backHeading = safe(backCfg.heading || 'RULES & INSTRUCTIONS');
    const termsList = (backCfg.terms || '1. This card is valid for the academic session specified.\n2. In case of loss, report immediately to the school office.\n3. This card is non-transferable and must be presented on demand.')
      .split('\n').map(l => l.trim()).filter(Boolean);
    const termsHtml = termsList.map((line, idx) => {
      const cleaned = line.replace(/^\d+[\.\)]\s*/, '');
      return `<div style="display:flex;align-items:center;gap:14px;padding:${isLandscape ? '10px 14px' : '15px 16px'};background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${accentColor};border-radius:14px;margin-bottom:${isLandscape ? '8px' : '12px'}">
        <span style="width:26px;height:26px;border-radius:50%;background:${accentColor};color:#ffffff;font-size:12px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">${idx + 1}</span>
        <span style="font-size:${isLandscape ? '13px' : '14.5px'};font-weight:700;color:#1e293b;line-height:1.4">${safe(cleaned)}</span>
      </div>`;
    }).join('');
    const helpline = safe(backCfg.emergencyHelpline || schoolPhone || 'School Office');
    const returnAddr = safe(backCfg.returnAddress || schoolAddress || rawSchoolName);
    const backVerifyUrl = buildFallbackVerificationDataUrl(student.admissionNo || rawSchoolName, 'qr', accentColor);

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 16px 36px rgba(15,23,42,0.18)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 custom-card-back tpl-${layoutStyle}-back" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:28px;border:2.5px solid ${headerBgStart};overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}
          <div style="position:relative;z-index:2;background:linear-gradient(135deg, ${headerBgStart}, ${headerBgEnd});color:${schoolNameColor};padding:${isLandscape ? '18px 34px' : '28px 32px 24px'};border-bottom:4px solid ${accentColor};display:flex;align-items:center;justify-content:${isLandscape ? 'space-between' : 'center'};gap:16px;text-align:${isLandscape ? 'left' : 'center'}">
            <div style="display:flex;align-items:center;gap:14px;flex-direction:${isLandscape ? 'row' : 'column'}">
              ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${isLandscape ? 50 : 64}px;height:${isLandscape ? 50 : 64}px;object-fit:contain;border-radius:50%;background:#ffffff;padding:4px;border:2px solid ${accentColor};box-shadow:0 4px 12px rgba(0,0,0,0.2)">` : ''}
              <div>
                <div style="font-size:${Math.round(schoolNameSize * 0.85)}px;font-weight:${schoolNameWeight};color:${schoolNameColor};line-height:1.15;letter-spacing:0.4px;text-transform:uppercase">${schoolName}</div>
                <div style="display:inline-block;margin-top:7px;padding:4px 14px;border-radius:999px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.24);font-size:11px;color:${cardHeadingColor};text-transform:uppercase;font-weight:800;letter-spacing:1.8px">${backHeading}</div>
              </div>
            </div>
            ${isLandscape ? `<div style="text-align:right;font-size:11px;font-weight:800;color:${cardHeadingColor};letter-spacing:1px;text-transform:uppercase">SESSION ${safe(session || student.session || '2026-2027')}</div>` : ''}
          </div>
          <div style="position:relative;z-index:2;flex:1;padding:${isLandscape ? '20px 34px' : '26px 34px'};display:flex;flex-direction:${isLandscape ? 'row' : 'column'};gap:20px;justify-content:space-between">
            <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
              <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:1.6px;color:${accentColor};margin-bottom:12px">Official Cardholder Directives</div>
              ${termsHtml}
            </div>
            <div style="${isLandscape ? 'width:265px;' : 'width:100%;'}background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:16px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px">
              <div style="min-width:0;flex:1">
                <div style="font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:${accentColor}">Verified Cardholder</div>
                <div style="font-size:17px;font-weight:900;color:${textColor};margin-top:3px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                <div style="font-size:12px;font-weight:800;color:#64748b;margin-top:4px;text-transform:uppercase">ID: ${safe(student.admissionNo || 'N/A')} • ${safe(`${student.className || 'N/A'}-${student.section || 'N/A'}`)}</div>
                <div style="font-size:11px;font-weight:800;color:${accentColor};margin-top:3px;text-transform:uppercase">Academic Session: ${safe(session || student.session || 'N/A')}</div>
              </div>
              <div style="padding:6px;background:#ffffff;border-radius:10px;border:1.5px solid ${accentColor};flex-shrink:0">
                <img src="${qrCodeDataUrl || backVerifyUrl}" alt="Verify QR" style="width:68px;height:68px;display:block;object-fit:contain">
              </div>
            </div>
          </div>
          <div style="position:relative;z-index:2;padding:${isLandscape ? '12px 34px 18px' : '0 34px 26px'}">
            <div style="background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:16px;padding:16px 20px;display:grid;grid-template-columns:1fr 1.3fr;gap:16px;align-items:center">
              <div>
                <div style="font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:1px;color:${accentColor}">Emergency Helpline</div>
                <div style="font-size:15px;font-weight:900;color:${textColor};margin-top:3px">${helpline}</div>
                ${schoolWebsite ? `<div style="font-size:10.5px;font-weight:700;color:#64748b;margin-top:2px">${schoolWebsite}</div>` : ''}
              </div>
              <div style="text-align:right;border-left:1.5px solid #cbd5e1;padding-left:16px">
                <div style="font-size:10px;text-transform:uppercase;font-weight:800;letter-spacing:1px;color:${accentColor}">If Found, Please Return To</div>
                <div style="font-size:12px;font-weight:700;color:#334155;margin-top:3px;line-height:1.35">${returnAddr}</div>
              </div>
            </div>
          </div>
          <div style="height:12px;background:linear-gradient(90deg, ${headerBgStart}, ${accentColor}, ${headerBgEnd});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // FRONT SIDE RENDERING
  const fieldItems = [];
  if (fieldsMap.fatherName?.enabled !== false) fieldItems.push({ key: 'fatherName', icon: fieldsMap.fatherName?.icon || 'F/N', label: fieldsMap.fatherName?.label || "Father's Name", value: safe(student.fatherName || 'N/A') });
  if (fieldsMap.dob?.enabled !== false) fieldItems.push({ key: 'dob', icon: fieldsMap.dob?.icon || 'DOB', label: fieldsMap.dob?.label || 'Date of Birth', value: safe(dob) });
  if (fieldsMap.admissionNo?.enabled !== false) fieldItems.push({ key: 'admissionNo', icon: fieldsMap.admissionNo?.icon || 'ID', label: fieldsMap.admissionNo?.label || 'Admission No.', value: safe(student.admissionNo || 'N/A') });
  if (fieldsMap.classSection?.enabled !== false) fieldItems.push({ key: 'classSection', icon: fieldsMap.classSection?.icon || 'CLS', label: fieldsMap.classSection?.label || 'Class & Section', value: safe(`${student.className || 'N/A'} - ${student.section || 'N/A'}`) });
  if (fieldsMap.rollNo?.enabled !== false) fieldItems.push({ key: 'rollNo', icon: fieldsMap.rollNo?.icon || 'NO.', label: fieldsMap.rollNo?.label || 'Roll Number', value: safe(student.rollNo || 'N/A') });
  if (fieldsMap.session?.enabled !== false) fieldItems.push({ key: 'session', icon: fieldsMap.session?.icon || 'YR', label: fieldsMap.session?.label || 'Academic Session', value: safe(session || student.session || 'N/A') });
  if (fieldsMap.bloodGroup?.enabled) fieldItems.push({ key: 'bloodGroup', icon: fieldsMap.bloodGroup?.icon || 'BG', label: fieldsMap.bloodGroup?.label || 'Blood Group', value: safe(student.bloodGroup || 'N/A') });
  if (fieldsMap.emergencyContact?.enabled) fieldItems.push({ key: 'emergencyContact', icon: fieldsMap.emergencyContact?.icon || 'EMG', label: fieldsMap.emergencyContact?.label || 'Emergency Contact', value: safe(student.phone || student.fatherPhone || student.mobile || 'N/A') });
  if (fieldsMap.address?.enabled) fieldItems.push({ key: 'address', icon: fieldsMap.address?.icon || 'ADR', label: fieldsMap.address?.label || 'Address', value: safe(student.address || 'N/A') });

  const isDenseFields = fieldItems.length > 6;
  const dragAttr = attr => `data-draggable="${attr}"`;

  // Render QR or Barcode Block HTML
  const isBarcodeMode = qrFormat === 'barcode';
  const qrBlockHtml = showQrCode && qrCodeDataUrl
    ? `<div ${dragAttr('qrcode')} class="idcard-drag-elem" style="transform:translate(${qrX}px,${qrY}px);cursor:move;padding:${isBarcodeMode ? '6px 10px' : '6px'};background:#ffffff;border-radius:12px;box-shadow:0 4px 14px rgba(15,23,42,0.1);display:inline-flex;flex-direction:column;align-items:center;border:1.5px solid ${accentColor};position:relative;z-index:6">
        <img src="${qrCodeDataUrl}" alt="Student QR" style="width:${isBarcodeMode ? Math.round(qrSize * 1.45) : qrSize}px;height:${isBarcodeMode ? Math.round(qrSize * 0.52) : qrSize}px;display:block;object-fit:contain">
        <span style="font-size:7.5px;font-weight:800;color:${accentColor};text-transform:uppercase;margin-top:3px;letter-spacing:0.8px">${isBarcodeMode ? safe(student.admissionNo || 'ID VERIFIED') : 'Scan to Verify'}</span>
      </div>`
    : '';

  const renderGridCells = (cellBuilder) => {
    const total = fieldItems.length;
    return fieldItems.map((item, idx) => {
      const isLastOdd = (total % 2 === 1) && (idx === total - 1);
      return cellBuilder(item, idx, isLastOdd);
    }).join('');
  };

  const buildHeaderBrandRow = (logoRingStyle, titleExtraStyle = '', subtitleBadgeStyle = '') => {
    const flexDir = logoPos === 'right' ? 'row-reverse' : (logoPos === 'left' ? 'row' : 'column');
    const textAlign = logoPos === 'right' ? 'right' : (logoPos === 'left' ? 'left' : 'center');
    return `<div style="display:flex;flex-direction:${flexDir};align-items:center;justify-content:${logoPos === 'center' ? 'center' : 'flex-start'};gap:${logoPos === 'center' ? '10px' : '18px'};width:100%;text-align:${textAlign}">
      ${showLogo ? `<div style="flex-shrink:0;${logoRingStyle}"><img src="${logo}" alt="School Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;display:block"></div>` : ''}
      <div style="min-width:0;flex:1">
        <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};color:${schoolNameColor};line-height:1.06;letter-spacing:0.4px;${titleExtraStyle}">${schoolName}</div>
        ${schoolContactLine ? `<div style="font-size:10.5px;font-weight:600;color:${schoolNameColor};opacity:0.84;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</div>` : ''}
        <div style="margin-top:8px;${subtitleBadgeStyle}">${cardHeading}</div>
      </div>
    </div>`;
  };

  const pRowMinH = isDenseFields ? '52px' : '64px';
  const pRowPad = isDenseFields ? '7px 10px' : '10px 13px';
  const pRowGap = isDenseFields ? '8px 12px' : '10px 14px';
  const pIconSize = isDenseFields ? 34 : 38;
  const pValSize = isDenseFields ? Math.max(12.5, fieldFontSize - 0.5) : Math.max(15, fieldFontSize + 1);

  const lRowMinH = isDenseFields ? '52px' : '64px';
  const lRowPad = isDenseFields ? '7px 11px' : '10px 14px';
  const lRowGap = isDenseFields ? '9px 14px' : '12px 16px';
  const lIconSize = isDenseFields ? 32 : 38;
  const lValSize = isDenseFields ? Math.max(12, fieldFontSize - 0.5) : Math.max(14, fieldFontSize + 1);

  // -----------------------------------------------------------------------
  // TEMPLATE 1: ROYAL BLUE PROFESSIONAL (Portrait CR80 - 600x960)
  // Royal Wave Header + Floating Wing Badges + Royal Pill Name Ribbon + Capsule Grid
  // -----------------------------------------------------------------------
  if (layoutStyle === 'royal-blue') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${pRowMinH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:11px;align-items:center;padding:${pRowPad};background:#f0f6ff;border:1.5px solid #bfdbfe;border-radius:16px">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:12px;background:linear-gradient(135deg, ${headerBgStart}, #1d4ed8);color:#ffffff;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(11,59,117,0.2)">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#1e40af;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.18;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerBadgeOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:9px 16px;background:#f0f6ff;border:1.5px solid #bfdbfe;border-radius:999px">
        <span style="width:10px;height:10px;border-radius:50%;background:${accentColor}"></span>
        <span style="font-size:12px;font-weight:800;color:${headerBgStart}">SESSION ${safe(session || student.session || '2026-2027')}</span>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 42px rgba(5,29,59,0.22)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-royal-blue" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid #93c5fd;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Royal Wave & Gold Curve Header -->
          <div style="position:relative;background:radial-gradient(circle at 82% 18%, rgba(212,160,56,0.25), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:24px 34px 72px;z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid ${accentColor};box-shadow:0 6px 18px rgba(0,0,0,0.22);`,
                `letter-spacing:0.4px;text-transform:uppercase;`,
                `display:inline-block;padding:4px 16px;border-radius:999px;background:rgba(212,160,56,0.22);border:1px solid ${accentColor};color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            <svg viewBox="0 0 600 56" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:44px;z-index:2">
              <path d="M0,56 L0,18 Q300,-14 600,18 L600,56 Z" fill="${accentColor}" opacity="0.9"></path>
              <path d="M0,56 L0,26 Q300,-6 600,26 L600,56 Z" fill="${cardBg}"></path>
            </svg>
          </div>

          <!-- Squircle Portrait Frame Flanked by Floating Class & Roll Wing Pills -->
          <div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:-72px;padding:0 34px">
            <div style="display:flex;align-items:center;justify-content:center;gap:14px;width:100%">
              <div style="flex:1;background:#f0f6ff;border:1.5px solid #bfdbfe;border-radius:16px;padding:10px 8px;text-align:center;box-shadow:0 4px 12px rgba(11,59,117,0.06)">
                <div style="font-size:8.5px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.8px">Class</div>
                <div style="font-size:14px;font-weight:900;color:${headerBgStart};margin-top:2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(`${student.className || 'N/A'}-${student.section || 'A'}`)}</div>
              </div>
              <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:${photoW}px;height:${photoH}px;padding:5px;background:#ffffff;border-radius:${photoRadius}px;border:${photoBorderWidth}px solid ${photoBorderColor};${photoShadow ? 'box-shadow:0 15px 30px rgba(11,59,117,0.22);' : ''}flex-shrink:0">
                <div style="width:100%;height:100%;border-radius:${Math.max(6, photoRadius - 5)}px;overflow:hidden;background:#dbeafe">
                  <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
                </div>
              </div>
              <div style="flex:1;background:#f0f6ff;border:1.5px solid #bfdbfe;border-radius:16px;padding:10px 8px;text-align:center;box-shadow:0 4px 12px rgba(11,59,117,0.06)">
                <div style="font-size:8.5px;font-weight:800;color:#1e40af;text-transform:uppercase;letter-spacing:0.8px">Roll No.</div>
                <div style="font-size:15px;font-weight:900;color:${headerBgStart};margin-top:2px">${safe(student.rollNo || 'N/A')}</div>
              </div>
            </div>

            <!-- Royal Navy & Gold Capsule Name Banner -->
            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:12px;text-align:${nameAlign};width:100%">
              <div style="display:inline-flex;align-items:center;gap:10px;max-width:100%;padding:6px 28px;background:linear-gradient(135deg, ${headerBgStart}, ${headerBgEnd});border-radius:999px;border:2px solid ${accentColor};box-shadow:0 6px 16px rgba(11,59,117,0.18)">
                <span style="color:${accentColor};font-size:11px">★</span>
                <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                <span style="color:${accentColor};font-size:11px">★</span>
              </div>
              <div style="font-size:10px;font-weight:800;color:#1e40af;letter-spacing:1.5px;margin-top:6px;text-transform:uppercase">ADMISSION ID • ${safe(student.admissionNo || 'N/A')}</div>
            </div>
          </div>

          <!-- 2-Column Rounded Capsule Details Grid -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:8px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">
              ${fieldsHtml}
            </div>
          </div>

          <!-- Signature & Session Pill Row -->
          <div style="position:relative;z-index:5;padding:6px 36px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerBadgeOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:42px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:${accentColor};margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1.1px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <div style="height:16px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 2: MODERN MINIMAL (Landscape CR80 - 960x600)
  // Full-Height Left Dark-Slate Profile Sidebar + Right Editorial White Canvas
  // -----------------------------------------------------------------------
  if (layoutStyle === 'modern-minimal') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${lRowMinH};display:flex;align-items:center;gap:12px;padding:${lRowPad};background:#f0f9ff;border:1px solid #bae6fd;border-radius:14px">
        <div style="width:${lIconSize}px;height:${lIconSize}px;border-radius:11px;background:linear-gradient(135deg, ${accentColor}, #0369a1);color:#ffffff;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">${item.icon}</div>
        <div style="min-width:0;flex:1">
          <div style="font-size:${labelFontSize}px;color:#0284c7;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${lValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;margin-top:4px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 36px rgba(15,23,42,0.16)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-modern-minimal" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:row;border-radius:26px;border:2px solid #bae6fd;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Left Full-Height Dark-Slate & Sky Sidebar (285px) -->
          <div style="width:285px;background:radial-gradient(circle at 50% 15%, rgba(56,189,248,0.22), transparent 180px), linear-gradient(180deg, #0f172a 0%, #082f49 100%);border-right:5px solid ${accentColor};padding:24px 22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;flex-shrink:0;z-index:3">
            <div style="padding:4px 16px;background:rgba(56,189,248,0.16);border:1px solid rgba(56,189,248,0.45);border-radius:999px;font-size:10px;font-weight:800;color:#7dd3fc;letter-spacing:1.6px;text-transform:uppercase">SESSION ${safe(session || student.session || '2026-2027')}</div>

            <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:${photoW}px;height:${photoH}px;padding:5px;background:#ffffff;border-radius:${photoRadius}px;border:${photoBorderWidth}px solid #38bdf8;box-shadow:0 14px 28px rgba(0,0,0,0.35)">
              <div style="width:100%;height:100%;border-radius:${Math.max(4, photoRadius - 4)}px;overflow:hidden;background:#e0f2fe">
                <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
              </div>
            </div>

            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;text-align:center;width:100%">
              <div style="display:inline-block;max-width:100%;padding:6px 20px;background:rgba(255,255,255,0.1);border:1.5px solid #38bdf8;border-radius:999px">
                <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.1;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
              </div>
              <div style="margin-top:8px;font-size:11px;font-weight:800;color:#38bdf8;letter-spacing:1.2px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
            </div>
          </div>

          <!-- Right Editorial Content Canvas (675px) -->
          <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:24px 32px 20px;min-width:0;z-index:3;background:#ffffff">
            <!-- Top School Header -->
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:2px solid #e0f2fe">
              <div style="display:flex;align-items:center;gap:14px;min-width:0">
                ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:#f0f9ff;padding:3px;border:2px solid ${accentColor};flex-shrink:0">` : ''}
                <div style="min-width:0">
                  <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};color:${schoolNameColor};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                  ${schoolContactLine ? `<div style="font-size:10.5px;color:#64748b;font-weight:600;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</div>` : ''}
                  <div style="display:inline-block;margin-top:5px;padding:3px 12px;background:#e0f2fe;color:${accentColor};border-radius:999px;font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">${cardHeading}</div>
                </div>
              </div>
            </div>

            <!-- Center 2-Column Rounded Capsule Data Matrix -->
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center;padding:12px 0">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:${lRowGap}">
                ${fieldsHtml}
              </div>
            </div>

            <!-- Bottom Verification QR & Signatory Dock -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px">
              <div style="display:flex;align-items:center;gap:12px">
                ${qrBlockHtml}
                <div>
                  <div style="font-size:9.5px;font-weight:800;color:${accentColor};text-transform:uppercase;letter-spacing:1px">Official Verification</div>
                  <div style="font-size:11.5px;font-weight:700;color:#475569;margin-top:2px">Scan QR code to verify active student enrollment</div>
                </div>
              </div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:185px;flex-shrink:0">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:#0284c7;letter-spacing:0.8px">${sigLabel}</div>
              </div>` : ''}
            </div>
          </div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 3: PREMIUM GOLD (Portrait CR80 - 600x960)
  // Regal Obsidian-Navy Pediment Header + Oval Gold Medallion + Gold Filigree Ledger
  // -----------------------------------------------------------------------
  if (layoutStyle === 'premium-gold') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${isDenseFields ? '50px' : '60px'};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:10px;align-items:center;padding:8px 12px;background:#ffffff;border:1px solid #fde68a;border-left:3.5px solid #d97706;border-radius:10px">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:8px;background:linear-gradient(135deg, ${headerBgStart}, #1e293b);border:1.5px solid #f59e0b;color:#fde68a;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#b45309;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:800;color:#0a192f;text-transform:uppercase;line-height:1.18;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerSealOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 15px;background:#0a192f;border:1.5px solid #f59e0b;border-radius:10px">
        <span style="color:#fbbf24;font-size:13px">★</span>
        <div>
          <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#fde68a;letter-spacing:1px">Official Seal</div>
          <div style="font-size:12px;font-weight:800;color:#ffffff">${safe(session || student.session || '2026-2027')}</div>
        </div>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 42px rgba(10,25,47,0.24)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-premium-gold" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:#fffdf9;font-family:${fontFamily};color:#0a192f;display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid #d97706;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}
          <!-- Ornate Dual Filigree Outer Frame -->
          <div style="position:absolute;inset:9px;border:1.5px solid rgba(217,119,6,0.42);border-radius:22px;pointer-events:none;z-index:15"></div>

          <!-- Regal Navy & Metallic Gold Pediment Header -->
          <div style="position:relative;background:radial-gradient(circle at 50% 0%, rgba(251,191,36,0.24), transparent 220px), linear-gradient(180deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:24px 34px 72px;z-index:2;overflow:hidden">
            <div style="position:absolute;top:0;left:0;right:0;height:5px;background:linear-gradient(90deg, #78350f, #fbbf24, #fef08a, #fbbf24, #78350f)"></div>
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid #fbbf24;box-shadow:0 6px 18px rgba(0,0,0,0.3);`,
                `letter-spacing:0.6px;text-transform:uppercase;`,
                `display:inline-block;padding:3px 15px;border-top:1px solid #fbbf24;border-bottom:1px solid #fbbf24;background:rgba(251,191,36,0.14);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:700;letter-spacing:2px;text-transform:uppercase;`
              )}
            </div>
            <svg viewBox="0 0 600 54" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:42px;z-index:2">
              <polygon points="0,54 0,12 300,42 600,12 600,54" fill="#f59e0b" opacity="0.9"></polygon>
              <polygon points="0,54 0,20 300,50 600,20 600,54" fill="#fffdf9"></polygon>
            </svg>
          </div>

          <!-- Oval Gold Medallion Portrait & Filigree Plaque Name -->
          <div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:-64px;padding:0 36px">
            <div style="position:relative;display:flex;flex-direction:column;align-items:center">
              <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:190px;height:224px;padding:6px;background:linear-gradient(145deg, #fde68a, #d97706, #78350f);border-radius:50%;outline:2px solid #f59e0b;outline-offset:3px;${photoShadow ? 'box-shadow:0 14px 28px rgba(10,25,47,0.28);' : ''}">
                <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:#fef3c7">
                  <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
                </div>
              </div>
              <div style="margin-top:-14px;position:relative;z-index:6;padding:3px 16px;background:#0a192f;border:1.5px solid #fbbf24;border-radius:999px;font-size:9px;font-weight:800;color:#fde68a;letter-spacing:1.4px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
            </div>

            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:8px;text-align:${nameAlign};width:100%">
              <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#0a192f;line-height:1.08;text-transform:uppercase;letter-spacing:0.8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:5px">
                <span style="width:70px;height:1.5px;background:linear-gradient(90deg, transparent, #d97706)"></span>
                <span style="width:6px;height:6px;background:#d97706;transform:rotate(45deg)"></span>
                <span style="width:70px;height:1.5px;background:linear-gradient(90deg, #d97706, transparent)"></span>
              </div>
            </div>
          </div>

          <!-- 2-Column Gold Filigree Ledger Box -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="padding:12px;background:#fffbeb;border:1.5px solid #fcd34d;border-radius:16px;display:grid;grid-template-columns:1fr 1fr;gap:9px 12px">
              ${fieldsHtml}
            </div>
          </div>

          <!-- Ornate Footer Signature & Seal -->
          <div style="position:relative;z-index:5;padding:6px 36px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerSealOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:40px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:#d97706;margin:4px 0 5px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:#92400e;letter-spacing:1.2px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <!-- Gilded Metallic Bottom Ribbon -->
          <div style="height:14px;background:linear-gradient(90deg, ${headerBgStart}, #d97706, #fbbf24, #d97706, ${headerBgStart});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 4: EMERALD ACADEMIC (Portrait CR80 - 600x960)
  // Forest Emerald Wave Header + Side-by-Side Hero Profile Card + Academic Grid
  // -----------------------------------------------------------------------
  if (layoutStyle === 'emerald-academic') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${isDenseFields ? '50px' : '60px'};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:11px;align-items:center;padding:${pRowPad};background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:15px">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:12px;background:linear-gradient(135deg, ${headerBgStart}, ${accentColor});color:#ffffff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#047857;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.18;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerScholarOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:9px 16px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:999px">
        <span style="width:10px;height:10px;border-radius:50%;background:${accentColor}"></span>
        <span style="font-size:12px;font-weight:800;color:#065f46">SESSION ${safe(session || student.session || '2026-2027')}</span>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(6,78,59,0.2)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-emerald-academic" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid #a7f3d0;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Emerald Dual-Wave Header -->
          <div style="position:relative;background:radial-gradient(circle at 80% 15%, rgba(52,211,153,0.28), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:22px 34px 60px;z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid #34d399;box-shadow:0 6px 18px rgba(0,0,0,0.2);`,
                `text-transform:uppercase;letter-spacing:0.4px;`,
                `display:inline-block;padding:4px 16px;border-radius:999px;background:rgba(255,255,255,0.16);border:1px solid rgba(167,243,208,0.45);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            <svg viewBox="0 0 600 60" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:46px;z-index:2">
              <path d="M0,14 C190,62 390,-10 600,28 L600,60 L0,60 Z" fill="#34d399" opacity="0.45"></path>
              <path d="M0,26 C210,66 410,0 600,38 L600,60 L0,60 Z" fill="${cardBg}"></path>
            </svg>
          </div>

          <!-- Side-by-Side Horizontal Hero Profile Card on Portrait Canvas -->
          <div style="position:relative;z-index:5;margin-top:-48px;padding:0 34px">
            <div style="background:#f0fdf4;border:2px solid #6ee7b7;border-radius:24px;padding:16px 20px;display:flex;align-items:center;gap:20px;box-shadow:0 12px 28px rgba(6,78,59,0.12)">
              <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:156px;height:196px;padding:4px;background:#ffffff;border-radius:20px;border:${photoBorderWidth}px solid ${accentColor};box-shadow:0 8px 20px rgba(6,78,59,0.18);flex-shrink:0">
                <div style="width:100%;height:100%;border-radius:15px;overflow:hidden;background:#d1fae5">
                  <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
                </div>
              </div>
              <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;flex:1;min-width:0">
                <div style="display:inline-block;padding:3px 12px;background:#10b981;color:#ffffff;border-radius:999px;font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">VERIFIED SCHOLAR</div>
                <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#022c22;line-height:1.1;margin-top:8px;text-transform:uppercase;overflow-wrap:anywhere">${safe(student.name || 'N/A')}</div>
                <div style="margin-top:10px;padding:8px 12px;background:#ffffff;border:1px solid #a7f3d0;border-radius:12px">
                  <div style="font-size:8.5px;font-weight:800;color:#047857;text-transform:uppercase;letter-spacing:0.8px">Admission ID</div>
                  <div style="font-size:14px;font-weight:900;color:#064e3b;margin-top:2px">${safe(student.admissionNo || 'N/A')}</div>
                </div>
                <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
                  <span style="padding:4px 10px;background:#064e3b;color:#ffffff;border-radius:8px;font-size:10px;font-weight:800;text-transform:uppercase">${safe(`${student.className || 'Class'} - ${student.section || 'A'}`)}</span>
                  <span style="padding:4px 10px;background:#d1fae5;color:#065f46;border-radius:8px;font-size:10px;font-weight:800;text-transform:uppercase">ROLL: ${safe(student.rollNo || 'N/A')}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 2-Column Rounded Mint Capsule Details Grid -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:8px 34px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="font-size:9.5px;font-weight:800;color:#047857;text-transform:uppercase;letter-spacing:1.6px;margin-bottom:8px;padding-left:4px">Academic & Personal Particulars</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">
              ${fieldsHtml}
            </div>
          </div>

          <!-- Signature & Session Pill Row -->
          <div style="position:relative;z-index:5;padding:6px 34px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerScholarOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:42px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:${accentColor};margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:#047857;letter-spacing:1.1px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <div style="height:16px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 5: MAROON CLASSIC (Portrait CR80 - 600x960)
  // Heritage Maroon & Gold Wave Header + Convent-Style Formal Bordered Ledger Table
  // -----------------------------------------------------------------------
  if (layoutStyle === 'maroon-classic') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${isDenseFields ? '48px' : '58px'};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:11px;align-items:center;padding:${pRowPad};background:#ffffff;border-bottom:1.5px solid #f3e8d8;border-right:1.5px solid #f3e8d8">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:10px;background:linear-gradient(135deg, ${headerBgStart}, #991b1b);color:#fde68a;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#991b1b;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.18;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerHeritageOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:9px 16px;background:#fff1f2;border:1.5px solid #fecdd3;border-radius:999px">
        <span style="width:10px;height:10px;border-radius:50%;background:${headerBgStart}"></span>
        <span style="font-size:12px;font-weight:800;color:${headerBgStart}">SESSION ${safe(session || student.session || '2026-2027')}</span>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(69,10,10,0.22)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-maroon-classic" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:28px;border:3px solid ${headerBgStart};overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Classical Maroon & Gold Curved Header -->
          <div style="position:relative;background:radial-gradient(circle at 20% 15%, rgba(251,191,36,0.2), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:24px 34px 72px;z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid #fbbf24;box-shadow:0 6px 18px rgba(0,0,0,0.25);`,
                `letter-spacing:0.5px;text-transform:uppercase;`,
                `display:inline-block;padding:4px 16px;border-radius:999px;background:rgba(253,230,138,0.18);border:1px solid rgba(253,230,138,0.55);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            <svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:40px;z-index:2">
              <path d="M0,50 L0,10 Q300,48 600,10 L600,50 Z" fill="#f59e0b" opacity="0.85"></path>
              <path d="M0,50 L0,18 Q300,54 600,18 L600,50 Z" fill="${cardBg}"></path>
            </svg>
          </div>

          <!-- Double-Ringed Portrait & Maroon Capsule Name Banner -->
          <div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:-70px;padding:0 36px">
            <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:${photoW}px;height:${photoH}px;padding:5px;background:#ffffff;border-radius:${photoRadius}px;border:${photoBorderWidth}px solid ${headerBgStart};outline:2px solid #f59e0b;outline-offset:2px;${photoShadow ? 'box-shadow:0 15px 30px rgba(69,10,10,0.24);' : ''}">
              <div style="width:100%;height:100%;border-radius:${Math.max(4, photoRadius - 4)}px;overflow:hidden;background:#fef2f2">
                <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
              </div>
            </div>
            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:10px;text-align:${nameAlign};width:100%">
              <div style="display:inline-block;max-width:100%;padding:6px 28px;background:linear-gradient(90deg, #450a0a, #7f1d1d, #450a0a);border-radius:8px;border:1.5px solid #f59e0b;box-shadow:0 4px 12px rgba(127,29,29,0.18)">
                <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.08;text-transform:uppercase;letter-spacing:0.6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
              </div>
              <div style="font-size:10px;font-weight:800;color:#991b1b;letter-spacing:1.6px;margin-top:5px;text-transform:uppercase">ADMISSION NO • ${safe(student.admissionNo || 'N/A')}</div>
            </div>
          </div>

          <!-- Formal Convent-Style Bordered Ledger Table -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:8px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="border:2px solid ${headerBgStart};border-radius:16px;overflow:hidden;background:#ffffff;box-shadow:0 4px 14px rgba(127,29,29,0.06)">
              <div style="background:linear-gradient(90deg, ${headerBgStart}, #991b1b);color:#fde68a;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.8px;padding:6px 14px;text-align:center">Official Student Particulars</div>
              <div style="display:grid;grid-template-columns:1fr 1fr">
                ${fieldsHtml}
              </div>
            </div>
          </div>

          <!-- Heritage Footer Signature & Session Pill -->
          <div style="position:relative;z-index:5;padding:6px 36px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerHeritageOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:42px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:${headerBgStart};margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1.2px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <div style="height:16px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, #d97706);width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 6: SKY BLUE WAVE (Portrait CR80 - 600x960)
  // PRESERVED EXACTLY AS APPROVED BY USER
  // -----------------------------------------------------------------------
  if (layoutStyle === 'sky-wave') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${pRowMinH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:11px;align-items:center;padding:${pRowPad};background:#f0f9ff;border:1px solid #bae6fd;border-radius:15px">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:12px;background:linear-gradient(135deg, ${headerBgStart}, ${accentColor});color:#ffffff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#0284c7;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.18;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerWaveOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:9px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:999px">
        <span style="width:10px;height:10px;border-radius:50%;background:${accentColor}"></span>
        <span style="font-size:12px;font-weight:800;color:#0369a1">SESSION ${safe(session || student.session || '2026-2027')}</span>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(2,132,199,0.2)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-sky-wave" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid #bae6fd;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Sky Wave Multi-Layer SVG Banner -->
          <div style="position:relative;background:radial-gradient(circle at 20% 15%, rgba(56,189,248,0.35), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:30px 34px 88px;z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid #38bdf8;box-shadow:0 6px 18px rgba(0,0,0,0.18);`,
                `letter-spacing:0.4px;text-transform:uppercase;`,
                `display:inline-block;padding:4px 16px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(224,242,254,0.45);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            <!-- Dual Layered Smooth S-Wave SVG -->
            <svg viewBox="0 0 600 65" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:54px;z-index:2">
              <path d="M0,15 C180,68 380,-12 600,32 L600,65 L0,65 Z" fill="#38bdf8" opacity="0.45"></path>
              <path d="M0,28 C210,72 410,0 600,42 L600,65 L0,65 Z" fill="${cardBg}"></path>
            </svg>
          </div>

          <!-- Squircle Portrait Frame & Capsule Name Badge -->
          <div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:-70px;padding:0 36px">
            <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:${photoW}px;height:${photoH}px;padding:5px;background:#ffffff;border-radius:${photoRadius}px;border:${photoBorderWidth}px solid ${accentColor};${photoShadow ? 'box-shadow:0 15px 30px rgba(2,132,199,0.24);' : ''}">
              <div style="width:100%;height:100%;border-radius:${Math.max(6, photoRadius - 5)}px;overflow:hidden;background:#e0f2fe">
                <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
              </div>
            </div>
            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:12px;text-align:${nameAlign};width:100%">
              <div style="display:inline-block;max-width:100%;padding:6px 26px;background:#f0f9ff;border-radius:999px;border:1.5px solid #bae6fd;box-shadow:0 2px 8px rgba(2,132,199,0.06)">
                <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${nameColor};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
              </div>
              <div style="font-size:10px;font-weight:800;color:#0284c7;letter-spacing:1.6px;margin-top:6px;text-transform:uppercase">STUDENT ID • ${safe(student.admissionNo || 'N/A')}</div>
            </div>
          </div>

          <!-- 2-Column Rounded Capsule Details Grid -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:8px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">
              ${fieldsHtml}
            </div>
          </div>

          <!-- Signature & QR Row -->
          <div style="position:relative;z-index:5;padding:6px 36px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerWaveOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:42px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:#38bdf8;margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:#0284c7;letter-spacing:1.1px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <!-- Fluid Wave Bottom Bar -->
          <div style="height:16px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 7: PURPLE INNOVATION (Landscape CR80 - 960x600)
  // Royal Violet Wave-Cut Header + Overlapping Lavender Profile Pill + Capsule Grid
  // -----------------------------------------------------------------------
  if (layoutStyle === 'purple-innovation') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${lRowMinH};display:flex;align-items:center;gap:12px;padding:${lRowPad};background:#faf5ff;border:1.5px solid #e9d5ff;border-radius:14px">
        <span style="width:${lIconSize}px;height:${lIconSize}px;border-radius:11px;font-size:9px;font-weight:800;color:#ffffff;background:linear-gradient(135deg, ${headerBgStart}, ${accentColor});display:flex;align-items:center;justify-content:center;flex-shrink:0">${item.icon}</span>
        <div style="min-width:0;flex:1">
          <div style="font-size:${labelFontSize}px;color:#7e22ce;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${lValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;margin-top:4px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 38px rgba(59,7,100,0.22)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-purple-innovation" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;border-radius:26px;border:2.5px solid #d8b4fe;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Royal Violet Curved Wave Header -->
          <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;background:radial-gradient(circle at 80% 20%, rgba(192,132,252,0.3), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);color:${schoolNameColor};padding:20px 36px 34px;display:flex;align-items:center;justify-content:space-between;z-index:2;overflow:hidden">
            <div style="display:flex;align-items:center;gap:16px;min-width:0;position:relative;z-index:3">
              ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:#ffffff;padding:4px;border:2.5px solid #c084fc;flex-shrink:0">` : ''}
              <div style="min-width:0">
                <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
                  <span style="padding:3px 12px;border-radius:999px;background:rgba(255,255,255,0.16);border:1px solid rgba(233,213,255,0.4);font-size:${cardHeadingSize}px;color:${cardHeadingColor};font-weight:800;letter-spacing:1.5px;text-transform:uppercase">${cardHeading}</span>
                  ${schoolContactLine ? `<span style="color:#c084fc">•</span><span style="font-size:10.5px;color:#f3e8ff;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</span>` : ''}
                </div>
              </div>
            </div>
            <div style="position:relative;z-index:3;font-size:11px;font-weight:800;color:#ffffff;background:rgba(168,85,247,0.32);border:1.5px solid #d8b4fe;padding:6px 16px;border-radius:999px;letter-spacing:1px;flex-shrink:0">SESSION ${safe(session || student.session || '2026-2027')}</div>
            <svg viewBox="0 0 960 40" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:26px;z-index:2">
              <path d="M0,10 C320,42 640,-8 960,22 L960,40 L0,40 Z" fill="#c084fc" opacity="0.5"></path>
              <path d="M0,20 C350,46 660,4 960,30 L960,40 L0,40 Z" fill="${cardBg}"></path>
            </svg>
          </div>

          <!-- 2-Zone Landscape Body: Left Lavender Capsule Profile + Right Data & Verification Dock -->
          <div style="flex:1;display:flex;align-items:stretch;padding:6px 34px 18px;gap:24px;z-index:4">
            <!-- Left Overlapping Lavender Capsule Profile -->
            <div style="width:240px;margin-top:-22px;background:linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%);border:2px solid #d8b4fe;border-radius:24px;padding:16px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;box-shadow:0 12px 28px rgba(88,28,135,0.12);flex-shrink:0">
              <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:${photoW}px;height:${photoH}px;padding:5px;background:#ffffff;border-radius:${photoRadius}px;border:${photoBorderWidth}px solid ${accentColor};${photoShadow ? 'box-shadow:0 10px 24px rgba(124,58,237,0.22);' : ''}">
                <div style="width:100%;height:100%;border-radius:${Math.max(6, photoRadius - 5)}px;overflow:hidden;background:#f3e8ff">
                  <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
                </div>
              </div>
              <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;text-align:center;width:100%;margin-top:8px">
                <div style="display:inline-block;max-width:100%;padding:5px 18px;background:#ffffff;border:1.5px solid #c084fc;border-radius:999px">
                  <div style="font-size:${Math.min(22, nameSize)}px;font-weight:${nameWeight};color:${nameColor};line-height:1.1;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                </div>
                <div style="margin-top:6px;font-size:10px;font-weight:800;color:#7e22ce;letter-spacing:1.2px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
              </div>
            </div>

            <!-- Right 2-Column Capsule Grid + Horizontal Bottom QR & Signatory Dock -->
            <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0">
              <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:${lRowGap}">
                  ${fieldsHtml}
                </div>
              </div>

              <div style="background:#faf5ff;border:1.5px solid #e9d5ff;border-radius:16px;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:10px">
                <div style="display:flex;align-items:center;gap:12px">
                  ${qrBlockHtml}
                  <div>
                    <div style="font-size:9.5px;font-weight:800;color:#7e22ce;text-transform:uppercase;letter-spacing:1px">Digital Campus Pass</div>
                    <div style="font-size:11.5px;font-weight:700;color:#581c87;margin-top:2px">Verified Student • ${safe(`${student.className || 'Class'} - ${student.section || 'A'}`)}</div>
                  </div>
                </div>
                ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:185px;flex-shrink:0">
                  <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                  <div style="width:100%;height:1.5px;background:#9333ea;margin:3px 0 4px"></div>
                  <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:#6b21a8;letter-spacing:0.8px">${sigLabel}</div>
                </div>` : ''}
              </div>
            </div>
          </div>

          <div style="height:12px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 8: ORANGE ENERGY (Portrait CR80 - 600x960)
  // Asymmetric Diagonal Slash Header + Left Photo / Right Quick-Identity Stack
  // -----------------------------------------------------------------------
  if (layoutStyle === 'orange-energy') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${pRowMinH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:11px;align-items:center;padding:${pRowPad};background:#fff7ed;border:1.5px solid #fed7aa;border-left:4px solid ${headerBgStart};border-radius:12px">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:9px;background:#0f172a;color:#fb923c;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#c2410c;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:900;color:${textColor};text-transform:uppercase;line-height:1.18;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerAthleticOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:9px 15px;background:#0f172a;color:#ffffff;border-radius:10px;border-left:4px solid ${accentColor}">
        <div>
          <div style="font-size:8px;font-weight:800;color:#fb923c;text-transform:uppercase;letter-spacing:1px">Academic Session</div>
          <div style="font-size:12.5px;font-weight:900;color:#ffffff">${safe(session || student.session || '2026-2027')}</div>
        </div>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(234,88,12,0.2)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-orange-energy" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid #0f172a;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Sunset Orange Asymmetric Diagonal Slash Header -->
          <div style="position:relative;background:radial-gradient(circle at 85% 15%, rgba(251,146,60,0.35), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:26px 34px 66px;z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid #0f172a;box-shadow:0 6px 18px rgba(0,0,0,0.2);`,
                `letter-spacing:0.4px;text-transform:uppercase;`,
                `display:inline-block;padding:4px 16px;border-radius:6px;background:#0f172a;border:1px solid #fb923c;color:#ffedd5;font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            <svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:42px;z-index:2">
              <polygon points="0,50 0,30 600,0 600,50" fill="#0f172a"></polygon>
              <polygon points="0,50 0,38 600,10 600,50" fill="${cardBg}"></polygon>
            </svg>
          </div>

          <!-- Asymmetric 2-Column Hero: Left Overlapping Portrait + Right Identity & Stat Stack -->
          <div style="position:relative;z-index:5;margin-top:-44px;padding:0 36px;display:flex;align-items:flex-end;gap:20px">
            <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:172px;height:216px;padding:5px;background:#ffffff;border-radius:20px;border:3.5px solid ${headerBgStart};outline:2px solid #0f172a;${photoShadow ? 'box-shadow:0 14px 28px rgba(234,88,12,0.24);' : ''}flex-shrink:0">
              <div style="width:100%;height:100%;border-radius:14px;overflow:hidden;background:#ffedd5">
                <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
              </div>
            </div>
            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;flex:1;min-width:0;padding-bottom:4px">
              <div style="display:inline-block;padding:3px 12px;background:${headerBgStart};color:#ffffff;border-radius:6px;font-size:9px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase">ACTIVE STUDENT PASS</div>
              <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#0f172a;line-height:1.08;margin-top:6px;text-transform:uppercase;overflow-wrap:anywhere">${safe(student.name || 'N/A')}</div>
              <div style="margin-top:8px;padding:7px 12px;background:#0f172a;color:#ffffff;border-radius:10px;border-left:4px solid ${accentColor}">
                <div style="font-size:8px;font-weight:800;color:#fb923c;text-transform:uppercase;letter-spacing:0.8px">Admission Number</div>
                <div style="font-size:13.5px;font-weight:900;margin-top:1px">${safe(student.admissionNo || 'N/A')}</div>
              </div>
              <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:5px 8px;text-align:center">
                  <div style="font-size:7.5px;font-weight:800;color:#9a3412;text-transform:uppercase">Class</div>
                  <div style="font-size:12px;font-weight:900;color:#0f172a;text-transform:uppercase">${safe(`${student.className || 'N/A'}-${student.section || 'A'}`)}</div>
                </div>
                <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:5px 8px;text-align:center">
                  <div style="font-size:7.5px;font-weight:800;color:#9a3412;text-transform:uppercase">Roll No</div>
                  <div style="font-size:12px;font-weight:900;color:#0f172a">${safe(student.rollNo || 'N/A')}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2-Column Warm Amber Accent Cards -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:8px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">
              ${fieldsHtml}
            </div>
          </div>

          <!-- Signature & Session Row -->
          <div style="position:relative;z-index:5;padding:6px 36px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerAthleticOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:42px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:2px;background:${headerBgStart};margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:900;color:#0f172a;letter-spacing:1.1px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <div style="height:16px;background:linear-gradient(90deg, #0f172a 0%, #0f172a 60%, ${headerBgStart} 60%, ${accentColor} 100%);width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 9: EXECUTIVE VERTICAL (Portrait CR80 - 600x960)
  // Lanyard Bezel + Stepped Header + Full-Width Edge-to-Edge Indigo Name Bar
  // -----------------------------------------------------------------------
  if (layoutStyle === 'executive-vertical') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${pRowMinH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:11px;align-items:center;padding:${pRowPad};background:#f8fafc;border:1.5px solid #cbd5e1;border-top:3px solid #1e293b;border-radius:10px">
        <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:8px;background:#1e293b;color:#60a5fa;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
        <div style="min-width:0">
          <div style="font-size:${labelFontSize}px;color:#475569;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.18;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    const footerExecOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 14px;background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:8px">
        <span style="width:9px;height:9px;background:#2563eb;border-radius:2px"></span>
        <span style="font-size:11.5px;font-weight:800;color:#0f172a">SESSION ${safe(session || student.session || '2026-2027')}</span>
      </div>`;

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-executive-vertical" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:28px;border:2.5px solid #1e293b;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Realistic Top Lanyard Slot Bezel -->
          <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);width:68px;height:12px;background:#090d16;border:2px solid rgba(203,213,225,0.45);border-radius:999px;z-index:12;box-shadow:inset 0 2px 4px rgba(0,0,0,0.6)"></div>

          <!-- Executive Indigo-Slate Stepped Geometric Header -->
          <div style="position:relative;background:radial-gradient(circle at 80% 15%, rgba(59,130,246,0.28), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:30px 34px 72px;z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid #60a5fa;box-shadow:0 6px 18px rgba(0,0,0,0.22);`,
                `letter-spacing:0.4px;text-transform:uppercase;`,
                `display:inline-block;padding:4px 16px;border-radius:6px;background:rgba(59,130,246,0.22);border:1px solid rgba(147,197,253,0.45);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            <svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:40px;z-index:2">
              <polygon points="0,50 0,6 170,6 210,36 390,36 430,6 600,6 600,50" fill="#2563eb" opacity="0.9"></polygon>
              <polygon points="0,50 0,14 166,14 206,44 394,44 434,14 600,14 600,50" fill="${cardBg}"></polygon>
            </svg>
          </div>

          <!-- Centered Executive Portrait + Full-Width Edge-to-Edge Indigo Name Bar -->
          <div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:-62px">
            <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:184px;height:228px;padding:5px;background:#ffffff;border-radius:16px;border:3px solid #1e293b;outline:2px solid #3b82f6;outline-offset:2px;${photoShadow ? 'box-shadow:0 14px 28px rgba(15,23,42,0.22);' : ''}">
              <div style="width:100%;height:100%;border-radius:11px;overflow:hidden;background:#e2e8f0">
                <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
              </div>
            </div>
            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:12px;width:100%;background:linear-gradient(90deg, #0f172a, #1e3a8a, #0f172a);border-top:2px solid #3b82f6;border-bottom:2px solid #3b82f6;padding:8px 36px;display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
              <span style="padding:4px 12px;background:rgba(59,130,246,0.25);border:1px solid #60a5fa;border-radius:6px;font-size:10.5px;font-weight:800;color:#93c5fd;letter-spacing:0.8px;flex-shrink:0">ID: ${safe(student.admissionNo || 'N/A')}</span>
            </div>
          </div>

          <!-- 2-Column Corporate Top-Bordered Details Grid -->
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:8px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">
              ${fieldsHtml}
            </div>
          </div>

          <!-- Signature & Session Row -->
          <div style="position:relative;z-index:5;padding:6px 36px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerExecOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:40px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:#1e293b;margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:#1e293b;letter-spacing:1.1px">${sigLabel}</div>
            </div>` : ''}
          </div>

          <div style="height:14px;background:linear-gradient(90deg, ${headerBgEnd}, #2563eb, ${headerBgEnd});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // -----------------------------------------------------------------------
  // TEMPLATE 10: SMART DIGITAL (Landscape CR80 - 960x600)
  // Cyber-Navy & Electric Cyan Wave Header + Squircle Portrait + Cyan Capsules
  // -----------------------------------------------------------------------
  if (layoutStyle === 'smart-digital') {
    const fieldsHtml = renderGridCells((item, idx, isLastOdd) => `
      <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${lRowMinH};display:flex;align-items:center;gap:12px;padding:${lRowPad};background:#ecfeff;border:1.5px solid #a5f3fc;border-radius:14px">
        <div style="width:${lIconSize}px;height:${lIconSize}px;border-radius:11px;background:linear-gradient(135deg, #0284c7, ${accentColor});color:#ffffff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${item.icon}</div>
        <div style="min-width:0;flex:1">
          <div style="font-size:${labelFontSize}px;color:#0891b2;text-transform:uppercase;font-weight:800;letter-spacing:0.6px;line-height:1">${item.label}</div>
          <div style="font-size:${lValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;margin-top:4px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
        </div>
      </div>
    `);

    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 38px rgba(2,6,23,0.22)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-smart-digital" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;border-radius:26px;border:2.5px solid #a5f3fc;overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}

          <!-- Cyber-Navy & Electric Cyan Wave Header with Gold EMV Smart Chip -->
          <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;background:radial-gradient(circle at 75% 30%, rgba(34,211,238,0.28), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);color:${schoolNameColor};padding:18px 34px 32px;display:flex;align-items:center;justify-content:space-between;z-index:2;overflow:hidden">
            <div style="display:flex;align-items:center;gap:16px;min-width:0;position:relative;z-index:3">
              ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:#ffffff;padding:4px;border:2.5px solid #22d3ee;flex-shrink:0">` : ''}
              <div style="min-width:0">
                <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
                  <span style="padding:3px 12px;border-radius:999px;background:rgba(6,182,212,0.24);border:1px solid rgba(103,232,249,0.5);font-size:${cardHeadingSize}px;color:${cardHeadingColor};font-weight:800;letter-spacing:1.6px;text-transform:uppercase">${cardHeading}</span>
                  ${schoolContactLine ? `<span style="color:#22d3ee">•</span><span style="font-size:10.5px;color:#e0f2fe;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</span>` : ''}
                </div>
              </div>
            </div>
            <!-- Gold EMV Smart Chip + RFID Pill -->
            <div style="position:relative;z-index:3;display:flex;align-items:center;gap:12px;flex-shrink:0">
              <div style="width:46px;height:36px;background:linear-gradient(135deg, #fde68a, #f59e0b, #b45309);border-radius:6px;border:1.5px solid #92400e;box-shadow:inset 0 1px 2px rgba(255,255,255,0.5);position:relative">
                <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:#78350f"></div>
                <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#78350f"></div>
                <div style="position:absolute;top:6px;left:6px;right:6px;bottom:6px;border:1px solid #78350f;border-radius:2px"></div>
              </div>
              <div style="padding:5px 14px;border-radius:999px;background:rgba(34,211,238,0.18);border:1.5px solid #22d3ee;font-size:10px;font-weight:800;color:#67e8f9;letter-spacing:1px">SMART PASS</div>
            </div>
            <svg viewBox="0 0 960 40" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:24px;z-index:2">
              <path d="M0,10 C320,42 640,-8 960,22 L960,40 L0,40 Z" fill="#22d3ee" opacity="0.5"></path>
              <path d="M0,20 C350,46 660,4 960,30 L960,40 L0,40 Z" fill="${cardBg}"></path>
            </svg>
          </div>

          <!-- 3-Zone Smart Pass Body -->
          <div style="flex:1;display:flex;align-items:stretch;padding:8px 34px 18px;gap:22px;z-index:4">
            <!-- Left: Squircle Photo with Overlapping Verified Pill -->
            <div style="width:215px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">
              <div ${dragAttr('photo')} class="idcard-drag-elem" style="transform:translate(${photoX}px,${photoY}px);cursor:move;width:${photoW}px;height:${photoH}px;padding:5px;background:#ffffff;border-radius:${photoRadius}px;border:${photoBorderWidth}px solid ${accentColor};${photoShadow ? 'box-shadow:0 12px 26px rgba(6,182,212,0.22);' : ''}">
                <div style="width:100%;height:100%;border-radius:${Math.max(6, photoRadius - 5)}px;overflow:hidden;background:#e0f2fe">
                  <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
                </div>
              </div>
              <div style="margin-top:-14px;position:relative;z-index:5;padding:5px 16px;background:linear-gradient(90deg, #0284c7, #06b6d4);color:#ffffff;border:2px solid #ffffff;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;box-shadow:0 4px 10px rgba(2,132,199,0.25)">ID • ${safe(student.admissionNo || 'N/A')}</div>
            </div>

            <!-- Center: Cyan Capsule Student Name Banner + 2-Column Cyan Capsule Grid -->
            <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0">
              <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;background:#ecfeff;border:1.5px solid #a5f3fc;border-radius:999px;padding:10px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#0c4a6e;line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                <span style="padding:5px 14px;background:linear-gradient(135deg, #0284c7, #06b6d4);color:#ffffff;border-radius:999px;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;flex-shrink:0">${safe(`${student.className || 'Class'} - ${student.section || 'A'}`)}</span>
              </div>

              <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center;padding-top:10px">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:${lRowGap}">
                  ${fieldsHtml}
                </div>
              </div>
            </div>

            <!-- Right: Sky-Cyan Rounded QR & Campus Authority Dock -->
            <div style="width:176px;background:#ecfeff;border:1.5px solid #a5f3fc;border-radius:20px;padding:14px 12px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;flex-shrink:0">
              <div>${qrBlockHtml}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:100%">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:#0891b2;letter-spacing:0.7px">${sigLabel}</div>
              </div>` : ''}
            </div>
          </div>

          <div style="height:12px;background:linear-gradient(90deg, ${headerBgStart}, #0284c7, ${accentColor});width:100%"></div>
        </article>
      </div>
    </div>`;
  }


  // -----------------------------------------------------------------------
  // TEMPLATES 11 TO 110: 100 STRUCTURALLY UNIQUE SCHOOL ID CARD DESIGNS
  // 15 Macro-Architectures x 16 SVG Header Shapes x 12 Photo Frames x 12 Data Grids
  // -----------------------------------------------------------------------
  const EXTRA_100_VARIANTS = {"ocean-breeze": {"orient": "portrait", "macro": "classic-overlap", "arch": "s-wave", "hero": "squircle-pill", "photoShape": "squircle", "cell": "capsule", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "STUDENT IDENTITY PASS", "qr": true}, "sapphire-crest": {"orient": "portrait", "macro": "left-spine", "arch": "inverted-arch", "hero": "medallion-plaque", "photoShape": "arch-window", "cell": "stat-bar-grid", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "teal-horizon": {"orient": "portrait", "macro": "right-ribbon", "arch": "reverse-slash", "hero": "horizontal-card", "photoShape": "hexagon", "cell": "hex-node", "pillBg": "#f0fdfa", "pillBorder": "#99f6e4", "heading": "ACADEMIC SCHOLAR PASS", "qr": false}, "crimson-scholar": {"orient": "portrait", "macro": "floating-header-box", "arch": "hex-bevel", "hero": "floating-ribbon", "photoShape": "polaroid-frame", "cell": "split-pill", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": true}, "indigo-modern": {"orient": "portrait", "macro": "double-frame-crest", "arch": "ribbon-fold", "hero": "edge-banner", "photoShape": "shield-crest", "cell": "minimal-underline", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "amber-sunburst": {"orient": "portrait", "macro": "pavilion-hero", "arch": "gold-emblem-rule", "hero": "wing-badges", "photoShape": "notched-tech", "cell": "minimal-underline", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "SCHOLAR ID CARD", "qr": false}, "forest-heritage": {"orient": "portrait", "macro": "corner-geometric", "arch": "royal-arch", "hero": "polaroid-badge", "photoShape": "arch-window", "cell": "floating-tag", "pillBg": "#f0fdf4", "pillBorder": "#bbf7d0", "heading": "OFFICIAL CAMPUS PASS", "qr": true}, "cobalt-executive-land": {"orient": "landscape", "macro": "land-left-sidebar", "arch": "dual-wave", "hero": "squircle-pill", "photoShape": "hexagon", "cell": "formal-table", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "STUDENT CREDENTIAL CARD", "qr": true}, "rose-blossom": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "diagonal-slash", "hero": "asymmetric-split", "photoShape": "hexagon", "cell": "dotted-leader", "pillBg": "#fff1f2", "pillBorder": "#fbcfe8", "heading": "STUDENT IDENTITY PASS", "qr": false}, "slate-corporate": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "scallop-arch", "hero": "wing-badges", "photoShape": "polaroid-frame", "cell": "striped-rows", "pillBg": "#f8fafc", "pillBorder": "#cbd5e1", "heading": "OFFICIAL STUDENT CARD", "qr": true}, "turquoise-wave": {"orient": "portrait", "macro": "magazine-showcase", "arch": "crown-peaks", "hero": "polaroid-badge", "photoShape": "shield-crest", "cell": "top-accent", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "ACADEMIC SCHOLAR PASS", "qr": false}, "burgundy-convent": {"orient": "portrait", "macro": "classic-overlap", "arch": "gold-emblem-rule", "hero": "asymmetric-split", "photoShape": "notched-tech", "cell": "top-accent", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "emerald-wave": {"orient": "portrait", "macro": "left-spine", "arch": "royal-arch", "hero": "squircle-pill", "photoShape": "reverse-leaf", "cell": "left-accent", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "VERIFIED STUDENT BADGE", "qr": true}, "violet-zenith-land": {"orient": "landscape", "macro": "land-smart-pass", "arch": "chevron-crest", "hero": "horizontal-card", "photoShape": "arch-window", "cell": "minimal-underline", "pillBg": "#f5f3ff", "pillBorder": "#ddd6fe", "heading": "SCHOLAR ID CARD", "qr": true}, "navy-gold-wave": {"orient": "portrait", "macro": "right-ribbon", "arch": "diagonal-slash", "hero": "medallion-plaque", "photoShape": "hexagon", "cell": "ledger-box", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "coral-sunrise": {"orient": "portrait", "macro": "floating-header-box", "arch": "scallop-arch", "hero": "horizontal-card", "photoShape": "polaroid-frame", "cell": "formal-table", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "STUDENT CREDENTIAL CARD", "qr": true}, "cerulean-arch": {"orient": "portrait", "macro": "double-frame-crest", "arch": "crown-peaks", "hero": "floating-ribbon", "photoShape": "shield-crest", "cell": "capsule", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "STUDENT IDENTITY PASS", "qr": false}, "olive-academy": {"orient": "portrait", "macro": "pavilion-hero", "arch": "sawtooth-trim", "hero": "edge-banner", "photoShape": "notched-tech", "cell": "capsule", "pillBg": "#f7fee7", "pillBorder": "#d9f99d", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "plum-royal": {"orient": "portrait", "macro": "corner-geometric", "arch": "dual-wave", "hero": "horizontal-card", "photoShape": "reverse-leaf", "cell": "stat-bar-grid", "pillBg": "#faf5ff", "pillBorder": "#e9d5ff", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "teal-smart-land": {"orient": "landscape", "macro": "land-overlap-card", "arch": "stepped-cradle", "hero": "edge-banner", "photoShape": "squircle", "cell": "left-accent", "pillBg": "#f0fdfa", "pillBorder": "#99f6e4", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": true}, "azure-ribbon": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "chevron-crest", "hero": "floating-ribbon", "photoShape": "circle-ring", "cell": "hex-node", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "bronze-imperial": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "stepped-cradle", "hero": "edge-banner", "photoShape": "polaroid-frame", "cell": "split-pill", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "SCHOLAR ID CARD", "qr": true}, "mint-fresh": {"orient": "portrait", "macro": "magazine-showcase", "arch": "asymmetric-sweep", "hero": "wing-badges", "photoShape": "shield-crest", "cell": "minimal-underline", "pillBg": "#f0fdfa", "pillBorder": "#99f6e4", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "crimson-wave": {"orient": "portrait", "macro": "classic-overlap", "arch": "sawtooth-trim", "hero": "polaroid-badge", "photoShape": "notched-tech", "cell": "minimal-underline", "pillBg": "#fef2f2", "pillBorder": "#fecaca", "heading": "STUDENT CREDENTIAL CARD", "qr": false}, "midnight-cyan-land": {"orient": "landscape", "macro": "land-right-vip", "arch": "asymmetric-sweep", "hero": "polaroid-badge", "photoShape": "leaf-drop", "cell": "hex-node", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "STUDENT IDENTITY PASS", "qr": true}, "indigo-wing": {"orient": "portrait", "macro": "left-spine", "arch": "dual-wave", "hero": "asymmetric-split", "photoShape": "reverse-leaf", "cell": "floating-tag", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "tangerine-wave": {"orient": "portrait", "macro": "right-ribbon", "arch": "chevron-crest", "hero": "squircle-pill", "photoShape": "circle-ring", "cell": "dotted-leader", "pillBg": "#fff7ed", "pillBorder": "#fed7aa", "heading": "ACADEMIC SCHOLAR PASS", "qr": false}, "jade-scholar": {"orient": "portrait", "macro": "floating-header-box", "arch": "stepped-cradle", "hero": "medallion-plaque", "photoShape": "diamond-cut", "cell": "striped-rows", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": true}, "magenta-modern": {"orient": "portrait", "macro": "double-frame-crest", "arch": "asymmetric-sweep", "hero": "asymmetric-split", "photoShape": "shield-crest", "cell": "top-accent", "pillBg": "#fdf4ff", "pillBorder": "#f5d0fe", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "royal-gold-land": {"orient": "landscape", "macro": "land-horizon-split", "arch": "stadium-curve", "hero": "squircle-pill", "photoShape": "corner-brackets", "cell": "striped-rows", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "SCHOLAR ID CARD", "qr": true}, "peacock-blue": {"orient": "portrait", "macro": "pavilion-hero", "arch": "stadium-curve", "hero": "squircle-pill", "photoShape": "notched-tech", "cell": "top-accent", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "OFFICIAL CAMPUS PASS", "qr": true}, "garnet-shield": {"orient": "portrait", "macro": "corner-geometric", "arch": "s-wave", "hero": "medallion-plaque", "photoShape": "reverse-leaf", "cell": "left-accent", "pillBg": "#fef2f2", "pillBorder": "#fecaca", "heading": "STUDENT CREDENTIAL CARD", "qr": false}, "cobalt-wave": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "inverted-arch", "hero": "horizontal-card", "photoShape": "circle-ring", "cell": "ledger-box", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "STUDENT IDENTITY PASS", "qr": false}, "cypress-split": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "reverse-slash", "hero": "floating-ribbon", "photoShape": "diamond-cut", "cell": "formal-table", "pillBg": "#f0fdf4", "pillBorder": "#bbf7d0", "heading": "OFFICIAL STUDENT CARD", "qr": true}, "amethyst-wave-land": {"orient": "landscape", "macro": "land-left-sidebar", "arch": "s-wave", "hero": "horizontal-card", "photoShape": "octagon", "cell": "capsule", "pillBg": "#f5f3ff", "pillBorder": "#ddd6fe", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "navy-horizon": {"orient": "portrait", "macro": "magazine-showcase", "arch": "hex-bevel", "hero": "edge-banner", "photoShape": "octagon", "cell": "capsule", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "saffron-heritage": {"orient": "portrait", "macro": "classic-overlap", "arch": "stadium-curve", "hero": "wing-badges", "photoShape": "notched-tech", "cell": "capsule", "pillBg": "#fff7ed", "pillBorder": "#fed7aa", "heading": "VERIFIED STUDENT BADGE", "qr": true}, "arctic-blue": {"orient": "portrait", "macro": "left-spine", "arch": "s-wave", "hero": "polaroid-badge", "photoShape": "reverse-leaf", "cell": "stat-bar-grid", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "SCHOLAR ID CARD", "qr": false}, "mulberry-classic": {"orient": "portrait", "macro": "right-ribbon", "arch": "inverted-arch", "hero": "edge-banner", "photoShape": "circle-ring", "cell": "hex-node", "pillBg": "#fdf4ff", "pillBorder": "#f5d0fe", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "emerald-smart-land": {"orient": "landscape", "macro": "land-smart-pass", "arch": "inverted-arch", "hero": "edge-banner", "photoShape": "diamond-cut", "cell": "floating-tag", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "STUDENT CREDENTIAL CARD", "qr": true}, "denim-modern": {"orient": "portrait", "macro": "floating-header-box", "arch": "reverse-slash", "hero": "wing-badges", "photoShape": "diamond-cut", "cell": "split-pill", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "STUDENT IDENTITY PASS", "qr": false}, "ruby-executive": {"orient": "portrait", "macro": "double-frame-crest", "arch": "hex-bevel", "hero": "polaroid-badge", "photoShape": "octagon", "cell": "minimal-underline", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "lagoon-wave": {"orient": "portrait", "macro": "pavilion-hero", "arch": "ribbon-fold", "hero": "asymmetric-split", "photoShape": "corner-brackets", "cell": "minimal-underline", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "gold-sovereign": {"orient": "portrait", "macro": "corner-geometric", "arch": "gold-emblem-rule", "hero": "squircle-pill", "photoShape": "reverse-leaf", "cell": "floating-tag", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "crimson-sidebar-land": {"orient": "landscape", "macro": "land-overlap-card", "arch": "reverse-slash", "hero": "polaroid-badge", "photoShape": "circle-ring", "cell": "ledger-box", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "VERIFIED STUDENT BADGE", "qr": true}, "periwinkle-wave": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "royal-arch", "hero": "medallion-plaque", "photoShape": "circle-ring", "cell": "dotted-leader", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "SCHOLAR ID CARD", "qr": true}, "pine-crest": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "diagonal-slash", "hero": "horizontal-card", "photoShape": "diamond-cut", "cell": "striped-rows", "pillBg": "#f0fdf4", "pillBorder": "#bbf7d0", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "ochre-modern": {"orient": "portrait", "macro": "magazine-showcase", "arch": "scallop-arch", "hero": "floating-ribbon", "photoShape": "octagon", "cell": "top-accent", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "STUDENT CREDENTIAL CARD", "qr": false}, "glacier-wave-land": {"orient": "landscape", "macro": "land-right-vip", "arch": "hex-bevel", "hero": "squircle-pill", "photoShape": "reverse-leaf", "cell": "split-pill", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "STUDENT IDENTITY PASS", "qr": true}, "imperial-indigo-land": {"orient": "landscape", "macro": "land-horizon-split", "arch": "ribbon-fold", "hero": "horizontal-card", "photoShape": "notched-tech", "cell": "top-accent", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "OFFICIAL STUDENT CARD", "qr": true}, "aurora-teal-spine": {"orient": "portrait", "macro": "classic-overlap", "arch": "ribbon-fold", "hero": "medallion-plaque", "photoShape": "corner-brackets", "cell": "top-accent", "pillBg": "#f0fdfa", "pillBorder": "#99f6e4", "heading": "ACADEMIC SCHOLAR PASS", "qr": false}, "imperial-maroon-pavilion": {"orient": "portrait", "macro": "left-spine", "arch": "gold-emblem-rule", "hero": "horizontal-card", "photoShape": "leaf-drop", "cell": "left-accent", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": true}, "cyber-indigo-hexagon": {"orient": "portrait", "macro": "right-ribbon", "arch": "royal-arch", "hero": "floating-ribbon", "photoShape": "circle-ring", "cell": "ledger-box", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "emerald-ivy-frame": {"orient": "portrait", "macro": "floating-header-box", "arch": "diagonal-slash", "hero": "edge-banner", "photoShape": "diamond-cut", "cell": "formal-table", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "SCHOLAR ID CARD", "qr": false}, "sunset-amber-ticket": {"orient": "portrait", "macro": "double-frame-crest", "arch": "scallop-arch", "hero": "wing-badges", "photoShape": "octagon", "cell": "capsule", "pillBg": "#fff7ed", "pillBorder": "#fed7aa", "heading": "OFFICIAL CAMPUS PASS", "qr": true}, "nordic-slate-minimal": {"orient": "portrait", "macro": "pavilion-hero", "arch": "crown-peaks", "hero": "polaroid-badge", "photoShape": "corner-brackets", "cell": "capsule", "pillBg": "#f8fafc", "pillBorder": "#cbd5e1", "heading": "STUDENT CREDENTIAL CARD", "qr": false}, "royal-amethyst-ribbon": {"orient": "portrait", "macro": "corner-geometric", "arch": "sawtooth-trim", "hero": "asymmetric-split", "photoShape": "leaf-drop", "cell": "stat-bar-grid", "pillBg": "#faf5ff", "pillBorder": "#e9d5ff", "heading": "STUDENT IDENTITY PASS", "qr": false}, "pacific-cobalt-showcase": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "dual-wave", "hero": "squircle-pill", "photoShape": "squircle", "cell": "hex-node", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "OFFICIAL STUDENT CARD", "qr": true}, "crimson-gold-horizon-land": {"orient": "landscape", "macro": "land-left-sidebar", "arch": "gold-emblem-rule", "hero": "edge-banner", "photoShape": "shield-crest", "cell": "stat-bar-grid", "pillBg": "#fef2f2", "pillBorder": "#fecaca", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "botanical-sage-arch": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "chevron-crest", "hero": "polaroid-badge", "photoShape": "diamond-cut", "cell": "split-pill", "pillBg": "#f7fee7", "pillBorder": "#d9f99d", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "oxford-navy-striped": {"orient": "portrait", "macro": "magazine-showcase", "arch": "stepped-cradle", "hero": "asymmetric-split", "photoShape": "octagon", "cell": "minimal-underline", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "VERIFIED STUDENT BADGE", "qr": true}, "flamingo-rose-frosted": {"orient": "portrait", "macro": "classic-overlap", "arch": "crown-peaks", "hero": "squircle-pill", "photoShape": "corner-brackets", "cell": "minimal-underline", "pillBg": "#fdf2f8", "pillBorder": "#fbcfe8", "heading": "SCHOLAR ID CARD", "qr": false}, "titanium-cyan-corner": {"orient": "portrait", "macro": "left-spine", "arch": "sawtooth-trim", "hero": "medallion-plaque", "photoShape": "leaf-drop", "cell": "floating-tag", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "copper-leaf-academy": {"orient": "portrait", "macro": "right-ribbon", "arch": "dual-wave", "hero": "horizontal-card", "photoShape": "squircle", "cell": "dotted-leader", "pillBg": "#fff7ed", "pillBorder": "#fed7aa", "heading": "STUDENT CREDENTIAL CARD", "qr": true}, "sapphire-vip-land": {"orient": "landscape", "macro": "land-smart-pass", "arch": "royal-arch", "hero": "polaroid-badge", "photoShape": "polaroid-frame", "cell": "dotted-leader", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "STUDENT IDENTITY PASS", "qr": true}, "velvet-plum-polaroid": {"orient": "portrait", "macro": "floating-header-box", "arch": "chevron-crest", "hero": "floating-ribbon", "photoShape": "arch-window", "cell": "striped-rows", "pillBg": "#faf5ff", "pillBorder": "#e9d5ff", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "aquamarine-crown-pass": {"orient": "portrait", "macro": "double-frame-crest", "arch": "stepped-cradle", "hero": "edge-banner", "photoShape": "octagon", "cell": "top-accent", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "charcoal-gold-pavilion": {"orient": "portrait", "macro": "pavilion-hero", "arch": "asymmetric-sweep", "hero": "wing-badges", "photoShape": "corner-brackets", "cell": "top-accent", "pillBg": "#fefce8", "pillBorder": "#fde047", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "cerulean-dotted-editorial": {"orient": "portrait", "macro": "corner-geometric", "arch": "stadium-curve", "hero": "floating-ribbon", "photoShape": "leaf-drop", "cell": "left-accent", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "forest-mint-horizon-land": {"orient": "landscape", "macro": "land-overlap-card", "arch": "diagonal-slash", "hero": "squircle-pill", "photoShape": "hexagon", "cell": "formal-table", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "SCHOLAR ID CARD", "qr": true}, "burgundy-gold-spine": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "s-wave", "hero": "edge-banner", "photoShape": "squircle", "cell": "ledger-box", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "electric-cobalt-notched": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "inverted-arch", "hero": "wing-badges", "photoShape": "arch-window", "cell": "formal-table", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "STUDENT CREDENTIAL CARD", "qr": false}, "terracotta-warm-ticket": {"orient": "portrait", "macro": "magazine-showcase", "arch": "reverse-slash", "hero": "polaroid-badge", "photoShape": "hexagon", "cell": "capsule", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "STUDENT IDENTITY PASS", "qr": true}, "jade-lotus-scallop": {"orient": "portrait", "macro": "classic-overlap", "arch": "asymmetric-sweep", "hero": "asymmetric-split", "photoShape": "corner-brackets", "cell": "capsule", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "obsidian-emerald-land": {"orient": "landscape", "macro": "land-right-vip", "arch": "scallop-arch", "hero": "horizontal-card", "photoShape": "arch-window", "cell": "minimal-underline", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "indigo-origami-ribbon": {"orient": "portrait", "macro": "left-spine", "arch": "stadium-curve", "hero": "squircle-pill", "photoShape": "leaf-drop", "cell": "stat-bar-grid", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": true}, "ruby-diamond-frame": {"orient": "portrait", "macro": "right-ribbon", "arch": "s-wave", "hero": "medallion-plaque", "photoShape": "squircle", "cell": "hex-node", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "sky-horizon-floating-box": {"orient": "portrait", "macro": "floating-header-box", "arch": "inverted-arch", "hero": "horizontal-card", "photoShape": "arch-window", "cell": "split-pill", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "SCHOLAR ID CARD", "qr": false}, "amethyst-gold-showcase": {"orient": "portrait", "macro": "double-frame-crest", "arch": "reverse-slash", "hero": "squircle-pill", "photoShape": "hexagon", "cell": "minimal-underline", "pillBg": "#f5f3ff", "pillBorder": "#ddd6fe", "heading": "OFFICIAL CAMPUS PASS", "qr": true}, "teal-executive-sidebar-land": {"orient": "landscape", "macro": "land-horizon-split", "arch": "crown-peaks", "hero": "edge-banner", "photoShape": "squircle", "cell": "left-accent", "pillBg": "#f0fdfa", "pillBorder": "#99f6e4", "heading": "STUDENT CREDENTIAL CARD", "qr": true}, "cobalt-sawtooth-corner": {"orient": "portrait", "macro": "pavilion-hero", "arch": "hex-bevel", "hero": "medallion-plaque", "photoShape": "polaroid-frame", "cell": "minimal-underline", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "STUDENT IDENTITY PASS", "qr": false}, "olive-gold-spine": {"orient": "portrait", "macro": "corner-geometric", "arch": "ribbon-fold", "hero": "horizontal-card", "photoShape": "leaf-drop", "cell": "floating-tag", "pillBg": "#f7fee7", "pillBorder": "#d9f99d", "heading": "OFFICIAL STUDENT CARD", "qr": true}, "coral-frosted-inner": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "gold-emblem-rule", "hero": "floating-ribbon", "photoShape": "squircle", "cell": "dotted-leader", "pillBg": "#fff1f2", "pillBorder": "#fecdd3", "heading": "ACADEMIC SCHOLAR PASS", "qr": false}, "navy-bevel-split-pill": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "royal-arch", "hero": "edge-banner", "photoShape": "arch-window", "cell": "striped-rows", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "magenta-smart-pass-land": {"orient": "landscape", "macro": "land-left-sidebar", "arch": "sawtooth-trim", "hero": "polaroid-badge", "photoShape": "leaf-drop", "cell": "hex-node", "pillBg": "#fdf4ff", "pillBorder": "#f5d0fe", "heading": "VERIFIED STUDENT BADGE", "qr": true}, "emerald-pavilion-crest": {"orient": "portrait", "macro": "magazine-showcase", "arch": "diagonal-slash", "hero": "wing-badges", "photoShape": "hexagon", "cell": "top-accent", "pillBg": "#ecfdf5", "pillBorder": "#a7f3d0", "heading": "SCHOLAR ID CARD", "qr": false}, "amber-right-ribbon": {"orient": "portrait", "macro": "classic-overlap", "arch": "hex-bevel", "hero": "polaroid-badge", "photoShape": "polaroid-frame", "cell": "top-accent", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "OFFICIAL CAMPUS PASS", "qr": false}, "arctic-lanyard-ticket": {"orient": "portrait", "macro": "left-spine", "arch": "ribbon-fold", "hero": "asymmetric-split", "photoShape": "shield-crest", "cell": "left-accent", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "STUDENT CREDENTIAL CARD", "qr": true}, "maroon-showcase-plaque": {"orient": "portrait", "macro": "right-ribbon", "arch": "gold-emblem-rule", "hero": "wing-badges", "photoShape": "squircle", "cell": "ledger-box", "pillBg": "#fef2f2", "pillBorder": "#fecaca", "heading": "STUDENT IDENTITY PASS", "qr": false}, "indigo-overlap-land": {"orient": "landscape", "macro": "land-smart-pass", "arch": "dual-wave", "hero": "squircle-pill", "photoShape": "corner-brackets", "cell": "striped-rows", "pillBg": "#eef2ff", "pillBorder": "#c7d2fe", "heading": "OFFICIAL STUDENT CARD", "qr": true}, "teal-double-frame": {"orient": "portrait", "macro": "floating-header-box", "arch": "royal-arch", "hero": "polaroid-badge", "photoShape": "arch-window", "cell": "formal-table", "pillBg": "#f0fdfa", "pillBorder": "#99f6e4", "heading": "ACADEMIC SCHOLAR PASS", "qr": true}, "violet-corner-polygon": {"orient": "portrait", "macro": "double-frame-crest", "arch": "diagonal-slash", "hero": "asymmetric-split", "photoShape": "hexagon", "cell": "capsule", "pillBg": "#faf5ff", "pillBorder": "#e9d5ff", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": false}, "sapphire-floating-box": {"orient": "portrait", "macro": "pavilion-hero", "arch": "scallop-arch", "hero": "squircle-pill", "photoShape": "polaroid-frame", "cell": "capsule", "pillBg": "#eff6ff", "pillBorder": "#bfdbfe", "heading": "VERIFIED STUDENT BADGE", "qr": false}, "crimson-spine-academy": {"orient": "portrait", "macro": "corner-geometric", "arch": "crown-peaks", "hero": "medallion-plaque", "photoShape": "shield-crest", "cell": "stat-bar-grid", "pillBg": "#fef2f2", "pillBorder": "#fecaca", "heading": "SCHOLAR ID CARD", "qr": true}, "bronze-vip-land": {"orient": "landscape", "macro": "land-overlap-card", "arch": "chevron-crest", "hero": "horizontal-card", "photoShape": "octagon", "cell": "capsule", "pillBg": "#fffbeb", "pillBorder": "#fde68a", "heading": "OFFICIAL CAMPUS PASS", "qr": true}, "cyan-frosted-shield": {"orient": "portrait", "macro": "lanyard-ticket", "arch": "sawtooth-trim", "hero": "horizontal-card", "photoShape": "notched-tech", "cell": "hex-node", "pillBg": "#ecfeff", "pillBorder": "#a5f3fc", "heading": "STUDENT CREDENTIAL CARD", "qr": false}, "forest-pavilion-scholar": {"orient": "portrait", "macro": "frosted-inner-card", "arch": "dual-wave", "hero": "floating-ribbon", "photoShape": "arch-window", "cell": "split-pill", "pillBg": "#f0fdf4", "pillBorder": "#bbf7d0", "heading": "STUDENT IDENTITY PASS", "qr": true}, "plum-ticket-credential": {"orient": "portrait", "macro": "magazine-showcase", "arch": "chevron-crest", "hero": "edge-banner", "photoShape": "hexagon", "cell": "minimal-underline", "pillBg": "#fdf4ff", "pillBorder": "#f5d0fe", "heading": "OFFICIAL STUDENT CARD", "qr": false}, "slate-gold-right-ribbon": {"orient": "portrait", "macro": "classic-overlap", "arch": "scallop-arch", "hero": "horizontal-card", "photoShape": "polaroid-frame", "cell": "minimal-underline", "pillBg": "#f8fafc", "pillBorder": "#cbd5e1", "heading": "ACADEMIC SCHOLAR PASS", "qr": false}, "ocean-horizon-split-land": {"orient": "landscape", "macro": "land-right-vip", "arch": "stepped-cradle", "hero": "edge-banner", "photoShape": "diamond-cut", "cell": "floating-tag", "pillBg": "#f0f9ff", "pillBorder": "#bae6fd", "heading": "CAMPUS IDENTITY CREDENTIAL", "qr": true}};
  if (EXTRA_100_VARIANTS[layoutStyle]) {
    const v = EXTRA_100_VARIANTS[layoutStyle];
    const pillBg = v.pillBg || '#f0f9ff';
    const pillBorder = v.pillBorder || '#bae6fd';
    const sessionStr = safe(session || student.session || '2026-2027');

    // Helper: Render Photo Frame with 12 distinct shapes/frames
    const buildUniquePhotoFrame = (w, h, extraWrapStyle = '') => {
      const ps = v.photoShape || 'squircle';
      let outerRad = `${photoRadius}px`;
      let innerRad = `${Math.max(4, photoRadius - 5)}px`;
      let clipStyle = '';
      let frameExtra = '';
      let overlayDecor = '';

      if (ps === 'circle-ring') {
        outerRad = '50%';
        innerRad = '50%';
        frameExtra = `outline:2.5px dashed ${accentColor};outline-offset:4px;`;
      } else if (ps === 'hexagon') {
        outerRad = '14px';
        innerRad = '10px';
        clipStyle = `clip-path:polygon(50% 0%, 96% 22%, 96% 78%, 50% 100%, 4% 78%, 4% 22%);`;
      } else if (ps === 'octagon') {
        outerRad = '14px';
        innerRad = '10px';
        clipStyle = `clip-path:polygon(28% 0%, 72% 0%, 100% 28%, 100% 72%, 72% 100%, 28% 100%, 0% 72%, 0% 28%);`;
      } else if (ps === 'shield-crest') {
        outerRad = '18px 18px 92px 92px';
        innerRad = '14px 14px 86px 86px';
      } else if (ps === 'leaf-drop') {
        outerRad = '52px 12px 52px 12px';
        innerRad = '46px 8px 46px 8px';
      } else if (ps === 'reverse-leaf') {
        outerRad = '12px 52px 12px 52px';
        innerRad = '8px 46px 8px 46px';
      } else if (ps === 'arch-window') {
        outerRad = '96px 96px 16px 16px';
        innerRad = '90px 90px 12px 12px';
      } else if (ps === 'diamond-cut') {
        outerRad = '12px';
        innerRad = '8px';
        clipStyle = `clip-path:polygon(16% 0%, 84% 0%, 100% 16%, 100% 84%, 84% 100%, 16% 100%, 0% 84%, 0% 16%);`;
      } else if (ps === 'polaroid-frame') {
        outerRad = '14px';
        innerRad = '10px';
        frameExtra = `padding:6px 6px 26px 6px !important;`;
        overlayDecor = `<div style="position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:9px;font-weight:900;color:${headerBgStart};letter-spacing:1.2px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>`;
      } else if (ps === 'corner-brackets') {
        outerRad = '10px';
        innerRad = '7px';
        overlayDecor = `
          <span style="position:absolute;top:-4px;left:-4px;width:18px;height:18px;border-top:4px solid ${accentColor};border-left:4px solid ${accentColor};border-radius:4px 0 0 0;pointer-events:none"></span>
          <span style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-top:4px solid ${accentColor};border-right:4px solid ${accentColor};border-radius:0 4px 0 0;pointer-events:none"></span>
          <span style="position:absolute;bottom:-4px;left:-4px;width:18px;height:18px;border-bottom:4px solid ${accentColor};border-left:4px solid ${accentColor};border-radius:0 0 0 4px;pointer-events:none"></span>
          <span style="position:absolute;bottom:-4px;right:-4px;width:18px;height:18px;border-bottom:4px solid ${accentColor};border-right:4px solid ${accentColor};border-radius:0 0 4px 0;pointer-events:none"></span>`;
      } else if (ps === 'notched-tech') {
        outerRad = '8px';
        innerRad = '6px';
        clipStyle = `clip-path:polygon(0 18px, 18px 0, calc(100% - 18px) 0, 100% 18px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 18px 100%, 0 calc(100% - 18px));`;
      }

      return `<div ${dragAttr('photo')} class="idcard-drag-elem" data-photo-shape="${ps}" style="transform:translate(${photoX}px,${photoY}px);cursor:move;position:relative;width:${w}px;height:${h}px;padding:5px;background:linear-gradient(145deg, #ffffff, ${pillBg});border-radius:${outerRad};border:${photoBorderWidth}px solid ${accentColor};box-shadow:0 14px 28px rgba(15,23,42,0.22);flex-shrink:0;${frameExtra}${extraWrapStyle}">
        <div style="width:100%;height:100%;border-radius:${innerRad};overflow:hidden;background:${pillBg};${clipStyle}">
          <img src="${studentPhoto}" alt="Student Photo" crossorigin="anonymous" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">
        </div>
        ${overlayDecor}
      </div>`;
    };

    // Helper: Render 16 distinct Header Bottom SVG Cutouts
    const buildHeaderSvg = (archType, hPx = 46) => {
      if (archType === 'dual-wave') {
        return `<svg viewBox="0 0 600 65" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <path d="M0,32 C200,-12 400,66 600,14 L600,65 L0,65 Z" fill="${accentColor}" opacity="0.55"></path>
          <path d="M0,42 C210,2 410,70 600,26 L600,65 L0,65 Z" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'royal-arch') {
        return `<svg viewBox="0 0 600 54" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <path d="M0,54 L0,18 Q300,-14 600,18 L600,54 Z" fill="${accentColor}" opacity="0.88"></path>
          <path d="M0,54 L0,26 Q300,-6 600,26 L600,54 Z" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'inverted-arch') {
        return `<svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <path d="M0,50 L0,8 Q300,48 600,8 L600,50 Z" fill="${accentColor}" opacity="0.85"></path>
          <path d="M0,50 L0,18 Q300,54 600,18 L600,50 Z" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'chevron-crest') {
        return `<svg viewBox="0 0 600 54" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,54 0,10 300,42 600,10 600,54" fill="${accentColor}" opacity="0.88"></polygon>
          <polygon points="0,54 0,20 300,50 600,20 600,54" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'diagonal-slash') {
        return `<svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,50 0,30 600,0 600,50" fill="${accentColor}" opacity="0.85"></polygon>
          <polygon points="0,50 0,38 600,10 600,50" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'reverse-slash') {
        return `<svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,50 0,0 600,30 600,50" fill="${accentColor}" opacity="0.85"></polygon>
          <polygon points="0,50 0,10 600,38 600,50" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'stepped-cradle') {
        return `<svg viewBox="0 0 600 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,50 0,6 170,6 210,36 390,36 430,6 600,6 600,50" fill="${accentColor}" opacity="0.9"></polygon>
          <polygon points="0,50 0,14 166,14 206,44 394,44 434,14 600,14 600,50" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'scallop-arch') {
        return `<svg viewBox="0 0 600 54" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <path d="M0,54 L0,22 Q150,-6 300,22 Q450,-6 600,22 L600,54 Z" fill="${accentColor}" opacity="0.85"></path>
          <path d="M0,54 L0,30 Q150,4 300,30 Q450,4 600,30 L600,54 Z" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'hex-bevel') {
        return `<svg viewBox="0 0 600 52" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,52 0,26 140,4 460,4 600,26 600,52" fill="${accentColor}" opacity="0.88"></polygon>
          <polygon points="0,52 0,34 146,12 454,12 600,34 600,52" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'asymmetric-sweep') {
        return `<svg viewBox="0 0 600 60" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <path d="M0,4 C120,56 420,48 600,8 L600,60 L0,60 Z" fill="${accentColor}" opacity="0.75"></path>
          <path d="M0,14 C130,62 430,54 600,18 L600,60 L0,60 Z" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'crown-peaks') {
        return `<svg viewBox="0 0 600 54" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,54 0,14 150,38 300,6 450,38 600,14 600,54" fill="${accentColor}" opacity="0.86"></polygon>
          <polygon points="0,54 0,24 150,46 300,16 450,46 600,24 600,54" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'ribbon-fold') {
        return `<svg viewBox="0 0 600 54" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,54 0,18 220,38 380,8 600,28 600,54" fill="${accentColor}" opacity="0.88"></polygon>
          <polygon points="0,54 0,28 220,46 380,16 600,36 600,54" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'stadium-curve') {
        return `<svg viewBox="0 0 600 56" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <path d="M0,0 C80,48 520,48 600,0 L600,56 L0,56 Z" fill="${accentColor}" opacity="0.85"></path>
          <path d="M0,10 C90,54 510,54 600,10 L600,56 L0,56 Z" fill="${cardBg}"></path>
        </svg>`;
      }
      if (archType === 'sawtooth-trim') {
        return `<svg viewBox="0 0 600 48" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
          <polygon points="0,48 0,16 100,34 200,16 300,34 400,16 500,34 600,16 600,48" fill="${accentColor}" opacity="0.85"></polygon>
          <polygon points="0,48 0,24 100,42 200,24 300,42 400,24 500,42 600,24 600,48" fill="${cardBg}"></polygon>
        </svg>`;
      }
      if (archType === 'gold-emblem-rule') {
        return `<div style="position:absolute;bottom:0;left:0;right:0;height:10px;background:linear-gradient(90deg, ${headerBgEnd}, ${accentColor}, ${headerBgEnd});z-index:2"></div>`;
      }
      // Default 's-wave'
      return `<svg viewBox="0 0 600 65" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:${hPx}px;z-index:2">
        <path d="M0,15 C180,68 380,-12 600,32 L600,65 L0,65 Z" fill="${accentColor}" opacity="0.48"></path>
        <path d="M0,28 C210,72 410,0 600,42 L600,65 L0,65 Z" fill="${cardBg}"></path>
      </svg>`;
    };

    // Helper: Render 12 distinct Data Grid / Table / Strip Styles
    const buildDetailsSection = (isCompact = false) => {
      const cs = v.cell || 'capsule';
      const minH = isCompact ? '44px' : pRowMinH;
      const pad = isCompact ? '6px 10px' : pRowPad;

      if (cs === 'formal-table') {
        const tCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${minH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:9px;align-items:center;padding:${pad};background:#ffffff;border-bottom:1.5px solid ${pillBorder};border-right:1.5px solid ${pillBorder}">
            <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:9px;background:linear-gradient(135deg, ${headerBgStart}, ${headerBgEnd});color:${cardHeadingColor};font-size:8.5px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
            <div style="min-width:0">
              <div style="font-size:${labelFontSize}px;color:${headerBgStart};text-transform:uppercase;font-weight:800;letter-spacing:0.5px;line-height:1">${item.label}</div>
              <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
            </div>
          </div>
        `);
        return `<div data-cell-style="formal-table" style="border:2px solid ${headerBgStart};border-radius:15px;overflow:hidden;background:#ffffff">
          <div style="background:linear-gradient(90deg, ${headerBgStart}, ${headerBgEnd});color:${cardHeadingColor};font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:1.6px;padding:5px 12px;text-align:center">Official Student Particulars</div>
          <div style="display:grid;grid-template-columns:1fr 1fr">${tCells}</div>
        </div>`;
      }

      if (cs === 'ledger-box') {
        const lBoxCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${minH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:9px;align-items:center;padding:${pad};background:#ffffff;border:1px solid ${pillBorder};border-left:3.5px solid ${accentColor};border-radius:10px">
            <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:8px;background:${headerBgStart};color:${cardHeadingColor};font-size:8.5px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
            <div style="min-width:0">
              <div style="font-size:${labelFontSize}px;color:${headerBgStart};text-transform:uppercase;font-weight:800;letter-spacing:0.5px;line-height:1">${item.label}</div>
              <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
            </div>
          </div>
        `);
        return `<div data-cell-style="ledger-box" style="padding:10px;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px 10px">${lBoxCells}</div>`;
      }

      if (cs === 'left-accent' || cs === 'top-accent') {
        const borderRule = cs === 'top-accent'
          ? `border:1.5px solid ${pillBorder};border-top:3.5px solid ${headerBgStart}`
          : `border:1.5px solid ${pillBorder};border-left:4px solid ${headerBgStart}`;
        const aCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${minH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:10px;align-items:center;padding:${pad};background:${pillBg};${borderRule};border-radius:12px">
            <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:8px;background:${headerBgStart};color:#ffffff;font-size:8.5px;font-weight:900;display:flex;align-items:center;justify-content:center">${item.icon}</div>
            <div style="min-width:0">
              <div style="font-size:${labelFontSize}px;color:${headerBgStart};text-transform:uppercase;font-weight:800;letter-spacing:0.5px;line-height:1">${item.label}</div>
              <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
            </div>
          </div>
        `);
        return `<div data-cell-style="${cs}" style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">${aCells}</div>`;
      }

      if (cs === 'striped-rows') {
        const sRows = fieldItems.map((item, idx) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 14px;background:${idx % 2 === 0 ? pillBg : '#ffffff'};border-bottom:1px solid ${pillBorder}">
            <div style="display:flex;align-items:center;gap:9px;min-width:0">
              <span style="width:22px;height:22px;border-radius:6px;background:${headerBgStart};color:#ffffff;font-size:8px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${item.icon}</span>
              <span style="font-size:${labelFontSize}px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:0.6px">${item.label}</span>
            </div>
            <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:58%">${item.value}</div>
          </div>
        `).join('');
        return `<div data-cell-style="striped-rows" style="border:1.5px solid ${pillBorder};border-radius:14px;overflow:hidden;background:#ffffff">${sRows}</div>`;
      }

      if (cs === 'dotted-leader') {
        const dRows = fieldItems.map((item) => `
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:6px 10px;background:#ffffff;border-radius:8px">
            <span style="font-size:${labelFontSize}px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:0.7px;flex-shrink:0">▪ ${item.label}</span>
            <span style="flex:1;border-bottom:1.5px dashed ${pillBorder};margin:0 6px;min-width:16px"></span>
            <span style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%">${item.value}</span>
          </div>
        `).join('');
        return `<div data-cell-style="dotted-leader" style="padding:8px 10px;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:14px;display:flex;flex-direction:column;gap:4px">${dRows}</div>`;
      }

      if (cs === 'floating-tag') {
        const fCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}position:relative;margin-top:6px;padding:11px 12px 7px;background:#ffffff;border:1.5px solid ${pillBorder};border-radius:12px">
            <span style="position:absolute;top:-8px;left:10px;padding:2px 8px;background:${headerBgStart};color:#ffffff;border-radius:999px;font-size:7.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px">${item.label}</span>
            <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
          </div>
        `);
        return `<div data-cell-style="floating-tag" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px">${fCells}</div>`;
      }

      if (cs === 'minimal-underline') {
        const mCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}padding:6px 8px;border-bottom:2px solid ${pillBorder};display:flex;flex-direction:column;justify-content:center">
            <div style="font-size:${labelFontSize}px;color:${accentColor};text-transform:uppercase;font-weight:900;letter-spacing:0.8px;line-height:1">${item.label}</div>
            <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.2;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
          </div>
        `);
        return `<div data-cell-style="minimal-underline" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px">${mCells}</div>`;
      }

      if (cs === 'split-pill') {
        const spCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${minH};display:flex;align-items:stretch;border:1.5px solid ${pillBorder};border-radius:12px;overflow:hidden;background:#ffffff">
            <div style="width:40px;background:linear-gradient(180deg, ${headerBgStart}, ${headerBgEnd});color:#ffffff;font-size:8.5px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">${item.icon}</div>
            <div style="padding:6px 10px;min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center">
              <div style="font-size:${labelFontSize}px;color:${headerBgStart};text-transform:uppercase;font-weight:800;line-height:1">${item.label}</div>
              <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
            </div>
          </div>
        `);
        return `<div data-cell-style="split-pill" style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">${spCells}</div>`;
      }

      if (cs === 'hex-node') {
        const hCells = renderGridCells((item, idx, isLastOdd) => `
          <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${minH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:10px;align-items:center;padding:${pad};background:linear-gradient(135deg, #ffffff 0%, ${pillBg} 100%);border:1.5px solid ${accentColor};clip-path:polygon(0 8px, 8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px))">
            <div style="width:${pIconSize}px;height:${pIconSize}px;background:${headerBgStart};color:${cardHeadingColor};font-size:8.5px;font-weight:900;display:flex;align-items:center;justify-content:center;clip-path:polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)">${item.icon}</div>
            <div style="min-width:0">
              <div style="font-size:${labelFontSize}px;color:${headerBgStart};text-transform:uppercase;font-weight:800;line-height:1">${item.label}</div>
              <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
            </div>
          </div>
        `);
        return `<div data-cell-style="hex-node" style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">${hCells}</div>`;
      }

      if (cs === 'stat-bar-grid') {
        const top3 = fieldItems.slice(0, 3);
        const rest = fieldItems.slice(3);
        const topHtml = top3.map((item) => `
          <div style="background:${headerBgStart};color:#ffffff;border-radius:11px;padding:7px 8px;text-align:center;border-bottom:3px solid ${accentColor}">
            <div style="font-size:7.5px;font-weight:800;color:${cardHeadingColor};text-transform:uppercase;letter-spacing:0.6px">${item.label}</div>
            <div style="font-size:12.5px;font-weight:900;margin-top:2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
          </div>
        `).join('');
        const restHtml = rest.map((item, idx) => {
          const isLastOdd = (rest.length % 2 === 1) && (idx === rest.length - 1);
          return `<div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}padding:7px 11px;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:11px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span style="font-size:${labelFontSize}px;font-weight:800;color:${headerBgStart};text-transform:uppercase">${item.label}</span>
            <span style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</span>
          </div>`;
        }).join('');
        return `<div data-cell-style="stat-bar-grid" style="display:flex;flex-direction:column;gap:8px">
          <div style="display:grid;grid-template-columns:repeat(${Math.max(1, top3.length)}, 1fr);gap:8px">${topHtml}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${restHtml}</div>
        </div>`;
      }

      // Default 'capsule'
      const cCells = renderGridCells((item, idx, isLastOdd) => `
        <div style="${isLastOdd ? 'grid-column:1 / -1;' : ''}min-height:${minH};display:grid;grid-template-columns:${pIconSize}px 1fr;gap:10px;align-items:center;padding:${pad};background:${pillBg};border:1.5px solid ${pillBorder};border-radius:15px">
          <div style="width:${pIconSize}px;height:${pIconSize}px;border-radius:11px;background:linear-gradient(135deg, ${headerBgStart}, ${accentColor});color:#ffffff;font-size:8.5px;font-weight:800;display:flex;align-items:center;justify-content:center">${item.icon}</div>
          <div style="min-width:0">
            <div style="font-size:${labelFontSize}px;color:${headerBgStart};text-transform:uppercase;font-weight:800;letter-spacing:0.5px;line-height:1">${item.label}</div>
            <div style="font-size:${pValSize}px;font-weight:800;color:${textColor};text-transform:uppercase;line-height:1.15;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.value}</div>
          </div>
        </div>
      `);
      return `<div data-cell-style="capsule" style="display:grid;grid-template-columns:1fr 1fr;gap:${pRowGap}">${cCells}</div>`;
    };

    // -------------------------------------------------------------------
    // LANDSCAPE TEMPLATES (5 DISTINCT LANDSCAPE MACRO-ARCHITECTURES)
    // -------------------------------------------------------------------
    if (isLandscape || v.orient === 'landscape') {
      const lMacro = v.macro || 'land-left-sidebar';

      if (lMacro === 'land-left-sidebar') {
        return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 36px rgba(15,23,42,0.16)">
          <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
            ${DESIGNED_TEMPLATES_ISOLATION_CSS}
            <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${lMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:row;border-radius:26px;border:2.5px solid ${pillBorder};overflow:hidden">
              ${marginGuideHtml}
              ${watermarkHtml}
              <div style="width:282px;background:radial-gradient(circle at 50% 15%, rgba(255,255,255,0.18), transparent 180px), linear-gradient(180deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);border-right:5px solid ${accentColor};padding:22px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;flex-shrink:0;z-index:3">
                <div style="padding:4px 16px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.35);border-radius:999px;font-size:10px;font-weight:800;color:${cardHeadingColor};letter-spacing:1.5px;text-transform:uppercase">SESSION ${sessionStr}</div>
                ${buildUniquePhotoFrame(photoW, photoH)}
                <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;text-align:center;width:100%">
                  <div style="display:inline-block;max-width:100%;padding:6px 18px;background:rgba(255,255,255,0.14);border:1.5px solid ${accentColor};border-radius:999px">
                    <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.1;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                  </div>
                  <div style="margin-top:6px;font-size:10.5px;font-weight:800;color:${cardHeadingColor};letter-spacing:1.2px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
                </div>
              </div>
              <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:22px 30px 18px;min-width:0;z-index:3;background:#ffffff">
                <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:12px;border-bottom:2px solid ${pillBorder}">
                  <div style="display:flex;align-items:center;gap:14px;min-width:0">
                    ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:${pillBg};padding:3px;border:2px solid ${accentColor};flex-shrink:0">` : ''}
                    <div style="min-width:0">
                      <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};color:${headerBgStart};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                      ${schoolContactLine ? `<div style="font-size:10px;color:#64748b;font-weight:600;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</div>` : ''}
                      <div style="display:inline-block;margin-top:4px;padding:3px 12px;background:${pillBg};color:${headerBgStart};border:1px solid ${pillBorder};border-radius:999px;font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">${cardHeading}</div>
                    </div>
                  </div>
                </div>
                <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center;padding:10px 0">
                  ${buildDetailsSection(true)}
                </div>
                <div style="background:${pillBg};border:1.5px solid ${pillBorder};border-radius:14px;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px">
                  <div style="display:flex;align-items:center;gap:12px">
                    ${qrBlockHtml}
                    <div>
                      <div style="font-size:9px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:1px">Official Verification</div>
                      <div style="font-size:11px;font-weight:700;color:${textColor};margin-top:2px">Active Student • ${safe(`${student.className || 'Class'} - ${student.section || 'A'}`)}</div>
                    </div>
                  </div>
                  ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:180px;flex-shrink:0">
                    <div style="min-height:36px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                    <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                    <div style="font-size:8.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:0.8px">${sigLabel}</div>
                  </div>` : ''}
                </div>
              </div>
            </article>
          </div>
        </div>`;
      }

      if (lMacro === 'land-right-vip') {
        return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 36px rgba(15,23,42,0.18)">
          <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
            ${DESIGNED_TEMPLATES_ISOLATION_CSS}
            <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${lMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:row;border-radius:26px;border:2.5px solid ${pillBorder};overflow:hidden">
              ${marginGuideHtml}
              ${watermarkHtml}
              <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:22px 28px 18px;min-width:0;z-index:3">
                <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;background:linear-gradient(135deg, ${headerBgStart}, ${headerBgEnd});color:#ffffff;border-radius:18px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:4px solid ${accentColor}">
                  <div style="display:flex;align-items:center;gap:12px;min-width:0">
                    ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:14px;background:#ffffff;padding:4px;border:2px solid ${accentColor};flex-shrink:0">` : ''}
                    <div style="min-width:0">
                      <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};line-height:1.06;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                      <div style="font-size:${cardHeadingSize}px;color:${cardHeadingColor};font-weight:800;letter-spacing:1.4px;text-transform:uppercase;margin-top:3px">${cardHeading}</div>
                    </div>
                  </div>
                  <span style="padding:4px 12px;background:rgba(255,255,255,0.16);border:1px solid ${accentColor};border-radius:999px;font-size:9.5px;font-weight:800;color:${cardHeadingColor};flex-shrink:0">${sessionStr}</span>
                </div>
                <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:8px;display:flex;align-items:center;justify-content:space-between;background:${pillBg};border-left:5px solid ${headerBgStart};border-radius:12px;padding:8px 16px">
                  <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${textColor};text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                  <span style="font-size:11px;font-weight:900;color:${headerBgStart};letter-spacing:1px">ID: ${safe(student.admissionNo || 'N/A')}</span>
                </div>
                <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center;padding:8px 0">
                  ${buildDetailsSection(true)}
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding-top:6px;border-top:1.5px dashed ${pillBorder}">
                  <div style="font-size:10px;color:#64748b;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine || 'Verified Institutional Identity Pass'}</div>
                  ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:170px;flex-shrink:0">
                    <div style="min-height:32px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                    <div style="width:100%;height:1.5px;background:${accentColor};margin:2px 0 3px"></div>
                    <div style="font-size:8.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart}">${sigLabel}</div>
                  </div>` : ''}
                </div>
              </div>
              <div style="width:270px;background:linear-gradient(165deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);border-left:5px solid ${accentColor};padding:22px 18px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;flex-shrink:0;z-index:3">
                ${buildUniquePhotoFrame(photoW, photoH)}
                <div style="background:rgba(255,255,255,0.95);border-radius:14px;padding:8px 12px;width:100%;display:flex;align-items:center;justify-content:center;gap:10px">
                  ${qrBlockHtml}
                </div>
              </div>
            </article>
          </div>
        </div>`;
      }

      if (lMacro === 'land-horizon-split') {
        return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 38px rgba(15,23,42,0.2)">
          <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
            ${DESIGNED_TEMPLATES_ISOLATION_CSS}
            <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${lMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;border-radius:26px;border:2.5px solid ${pillBorder};overflow:hidden">
              ${marginGuideHtml}
              ${watermarkHtml}
              <div style="height:210px;background:linear-gradient(120deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);border-bottom:5px solid ${accentColor};padding:20px 34px;display:flex;align-items:flex-start;justify-content:space-between;position:relative;z-index:2">
                <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;display:flex;align-items:center;gap:14px;max-width:66%">
                  ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:#ffffff;padding:4px;border:2.5px solid ${accentColor};flex-shrink:0">` : ''}
                  <div style="min-width:0;color:#ffffff">
                    <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};line-height:1.06;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                    ${schoolContactLine ? `<div style="font-size:10px;opacity:0.86;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</div>` : ''}
                    <div style="margin-top:6px;display:inline-flex;align-items:center;gap:8px;padding:3px 12px;background:rgba(255,255,255,0.16);border:1px solid ${accentColor};border-radius:999px;font-size:${cardHeadingSize}px;color:${cardHeadingColor};font-weight:800;letter-spacing:1.4px;text-transform:uppercase">${cardHeading} • ${sessionStr}</div>
                  </div>
                </div>
                <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;position:absolute;bottom:14px;left:34px;right:300px;display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.14);border:1.5px solid rgba(255,255,255,0.4);border-radius:14px;padding:8px 18px;color:#ffffff">
                  <div style="font-size:${nameSize}px;font-weight:${nameWeight};text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                  <span style="padding:3px 10px;background:${accentColor};color:#ffffff;border-radius:8px;font-size:10px;font-weight:900">ID: ${safe(student.admissionNo || 'N/A')}</span>
                </div>
              </div>
              <div style="position:absolute;top:24px;right:34px;z-index:6">
                ${buildUniquePhotoFrame(photoW, photoH)}
              </div>
              <div style="flex:1;display:flex;align-items:stretch;justify-content:space-between;padding:16px 34px 18px;gap:22px;z-index:4">
                <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center">
                  ${buildDetailsSection(true)}
                </div>
                <div style="width:210px;padding-top:46px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:10px;flex-shrink:0">
                  <div style="display:flex;align-items:center;gap:10px">${qrBlockHtml}</div>
                  ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:100%">
                    <div style="min-height:34px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                    <div style="width:100%;height:1.5px;background:${accentColor};margin:2px 0 3px"></div>
                    <div style="font-size:8.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart}">${sigLabel}</div>
                  </div>` : ''}
                </div>
              </div>
            </article>
          </div>
        </div>`;
      }

      if (lMacro === 'land-smart-pass') {
        return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 38px rgba(15,23,42,0.2)">
          <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
            ${DESIGNED_TEMPLATES_ISOLATION_CSS}
            <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${lMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;border-radius:26px;border:2.5px solid ${pillBorder};overflow:hidden">
              ${marginGuideHtml}
              ${watermarkHtml}
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;background:radial-gradient(circle at 75% 30%, rgba(255,255,255,0.22), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);color:${schoolNameColor};padding:18px 34px 30px;display:flex;align-items:center;justify-content:space-between;z-index:2;overflow:hidden">
                <div style="display:flex;align-items:center;gap:16px;min-width:0;position:relative;z-index:3">
                  ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:#ffffff;padding:4px;border:2.5px solid ${accentColor};flex-shrink:0">` : ''}
                  <div style="min-width:0">
                    <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                    <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
                      <span style="padding:3px 12px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.4);font-size:${cardHeadingSize}px;color:${cardHeadingColor};font-weight:800;letter-spacing:1.6px;text-transform:uppercase">${cardHeading}</span>
                      ${schoolContactLine ? `<span style="color:${accentColor}">•</span><span style="font-size:10.5px;color:#ffffff;opacity:0.88;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</span>` : ''}
                    </div>
                  </div>
                </div>
                <div style="position:relative;z-index:3;display:flex;align-items:center;gap:12px;flex-shrink:0">
                  <div style="width:44px;height:34px;background:linear-gradient(135deg, #fde68a, #f59e0b, #b45309);border-radius:6px;border:1.5px solid #92400e"></div>
                  <div style="padding:5px 14px;border-radius:999px;background:rgba(255,255,255,0.16);border:1.5px solid ${accentColor};font-size:10px;font-weight:800;color:${cardHeadingColor};letter-spacing:1px">${sessionStr}</div>
                </div>
                ${buildHeaderSvg(v.arch, 24)}
              </div>
              <div style="flex:1;display:flex;align-items:stretch;padding:8px 34px 16px;gap:20px;z-index:4">
                <div style="width:210px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">
                  ${buildUniquePhotoFrame(photoW, photoH)}
                  <div style="margin-top:-12px;position:relative;z-index:5;padding:4px 14px;background:linear-gradient(90deg, ${headerBgStart}, ${accentColor});color:#ffffff;border:2px solid #ffffff;border-radius:999px;font-size:9.5px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
                </div>
                <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0">
                  <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:999px;padding:8px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px">
                    <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${textColor};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                    <span style="padding:4px 12px;background:linear-gradient(135deg, ${headerBgStart}, ${accentColor});color:#ffffff;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;flex-shrink:0">${safe(`${student.className || 'Class'} - ${student.section || 'A'}`)}</span>
                  </div>
                  <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center;padding-top:8px">
                    ${buildDetailsSection(true)}
                  </div>
                </div>
                <div style="width:172px;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:20px;padding:12px 10px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;flex-shrink:0">
                  <div>${qrBlockHtml}</div>
                  ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:100%">
                    <div style="min-height:36px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                    <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                    <div style="font-size:8.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:0.7px">${sigLabel}</div>
                  </div>` : ''}
                </div>
              </div>
              <div style="height:12px;background:linear-gradient(90deg, ${headerBgStart}, ${accentColor}, ${headerBgEnd});width:100%"></div>
            </article>
          </div>
        </div>`;
      }

      // Default Landscape ('land-overlap-card')
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:22px;box-shadow:0 16px 38px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${lMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;border-radius:26px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;background:radial-gradient(circle at 80% 20%, rgba(255,255,255,0.24), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);color:${schoolNameColor};padding:20px 36px 32px;display:flex;align-items:center;justify-content:space-between;z-index:2;overflow:hidden">
              <div style="display:flex;align-items:center;gap:16px;min-width:0;position:relative;z-index:3">
                ${showLogo ? `<img src="${logo}" alt="Logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;object-fit:contain;border-radius:50%;background:#ffffff;padding:4px;border:2.5px solid ${accentColor};flex-shrink:0">` : ''}
                <div style="min-width:0">
                  <div style="font-size:${schoolNameSize}px;font-weight:${schoolNameWeight};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolName}</div>
                  <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
                    <span style="padding:3px 12px;border-radius:999px;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.38);font-size:${cardHeadingSize}px;color:${cardHeadingColor};font-weight:800;letter-spacing:1.5px;text-transform:uppercase">${cardHeading}</span>
                    ${schoolContactLine ? `<span style="color:${accentColor}">•</span><span style="font-size:10.5px;color:#ffffff;opacity:0.88;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${schoolContactLine}</span>` : ''}
                  </div>
                </div>
              </div>
              <div style="position:relative;z-index:3;font-size:10.5px;font-weight:800;color:#ffffff;background:rgba(255,255,255,0.18);border:1.5px solid ${accentColor};padding:6px 16px;border-radius:999px;letter-spacing:1px;flex-shrink:0">SESSION ${sessionStr}</div>
              ${buildHeaderSvg(v.arch, 24)}
            </div>
            <div style="flex:1;display:flex;align-items:stretch;padding:6px 34px 16px;gap:22px;z-index:4">
              <div style="width:236px;margin-top:-20px;background:${pillBg};border:2px solid ${pillBorder};border-radius:24px;padding:14px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;box-shadow:0 12px 28px rgba(15,23,42,0.1);flex-shrink:0">
                ${buildUniquePhotoFrame(photoW, photoH)}
                <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;text-align:center;width:100%">
                  <div style="display:inline-block;max-width:100%;padding:5px 16px;background:#ffffff;border:1.5px solid ${pillBorder};border-radius:999px">
                    <div style="font-size:${Math.min(22, nameSize)}px;font-weight:${nameWeight};color:${nameColor};line-height:1.1;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                  </div>
                  <div style="margin-top:5px;font-size:10px;font-weight:800;color:${headerBgStart};letter-spacing:1.2px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
                </div>
              </div>
              <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0">
                <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;flex:1;display:flex;flex-direction:column;justify-content:center">
                  ${buildDetailsSection(true)}
                </div>
                <div style="background:${pillBg};border:1.5px solid ${pillBorder};border-radius:16px;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:8px">
                  <div style="display:flex;align-items:center;gap:12px">
                    ${qrBlockHtml}
                    <div>
                      <div style="font-size:9px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:1px">Verified Campus Pass</div>
                      <div style="font-size:11px;font-weight:700;color:${textColor};margin-top:2px">Class: ${safe(`${student.className || 'Class'} - ${student.section || 'A'}`)} • Roll: ${safe(student.rollNo || 'N/A')}</div>
                    </div>
                  </div>
                  ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;text-align:center;width:180px;flex-shrink:0">
                    <div style="min-height:36px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                    <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                    <div style="font-size:8.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:0.8px">${sigLabel}</div>
                  </div>` : ''}
                </div>
              </div>
            </div>
            <div style="height:12px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
          </article>
        </div>
      </div>`;
    }

    // -------------------------------------------------------------------
    // PORTRAIT TEMPLATES (10 DISTINCT PORTRAIT MACRO-ARCHITECTURES)
    // -------------------------------------------------------------------
    const pMacro = v.macro || 'classic-overlap';
    const footerPillOrQr = qrBlockHtml || `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 16px;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:999px">
        <span style="width:9px;height:9px;border-radius:50%;background:${accentColor}"></span>
        <span style="font-size:11.5px;font-weight:800;color:${headerBgStart}">SESSION ${sessionStr}</span>
      </div>`;

    const buildHeroSection = (topMargin = '-64px', sidePad = '34px') => {
      const hType = v.hero || 'squircle-pill';
      if (hType === 'wing-badges') {
        return `<div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:${topMargin};padding:0 ${sidePad}">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;width:100%">
            <div style="flex:1;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:14px;padding:8px 6px;text-align:center">
              <div style="font-size:8px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:0.7px">Class</div>
              <div style="font-size:13px;font-weight:900;color:${textColor};margin-top:2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(`${student.className || 'N/A'}-${student.section || 'A'}`)}</div>
            </div>
            ${buildUniquePhotoFrame(178, 222)}
            <div style="flex:1;background:${pillBg};border:1.5px solid ${pillBorder};border-radius:14px;padding:8px 6px;text-align:center">
              <div style="font-size:8px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:0.7px">Roll No</div>
              <div style="font-size:14px;font-weight:900;color:${textColor};margin-top:2px">${safe(student.rollNo || 'N/A')}</div>
            </div>
          </div>
          <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:9px;text-align:${nameAlign};width:100%">
            <div style="display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:6px 24px;background:linear-gradient(135deg, ${headerBgStart}, ${headerBgEnd});border-radius:999px;border:2px solid ${accentColor}">
              <span style="color:${cardHeadingColor};font-size:10px">★</span>
              <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
              <span style="color:${cardHeadingColor};font-size:10px">★</span>
            </div>
            <div style="font-size:9.5px;font-weight:800;color:${headerBgStart};letter-spacing:1.4px;margin-top:4px;text-transform:uppercase">ADMISSION ID • ${safe(student.admissionNo || 'N/A')}</div>
          </div>
        </div>`;
      }
      if (hType === 'horizontal-card') {
        return `<div style="position:relative;z-index:5;margin-top:-44px;padding:0 ${sidePad}">
          <div style="background:${pillBg};border:2px solid ${pillBorder};border-radius:22px;padding:12px 16px;display:flex;align-items:center;gap:16px;box-shadow:0 10px 24px rgba(15,23,42,0.1)">
            ${buildUniquePhotoFrame(148, 186)}
            <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;flex:1;min-width:0">
              <div style="display:inline-block;padding:3px 10px;background:${headerBgStart};color:#ffffff;border-radius:999px;font-size:8.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase">VERIFIED STUDENT</div>
              <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${textColor};line-height:1.08;margin-top:6px;text-transform:uppercase;overflow-wrap:anywhere">${safe(student.name || 'N/A')}</div>
              <div style="margin-top:8px;padding:6px 10px;background:#ffffff;border:1px solid ${pillBorder};border-radius:10px">
                <div style="font-size:7.5px;font-weight:800;color:${headerBgStart};text-transform:uppercase;letter-spacing:0.8px">Admission ID</div>
                <div style="font-size:13px;font-weight:900;color:${textColor};margin-top:1px">${safe(student.admissionNo || 'N/A')}</div>
              </div>
              <div style="margin-top:7px;display:flex;align-items:center;gap:7px">
                <span style="padding:3px 9px;background:${headerBgStart};color:#ffffff;border-radius:7px;font-size:9.5px;font-weight:800;text-transform:uppercase">${safe(`${student.className || 'Class'}-${student.section || 'A'}`)}</span>
                <span style="padding:3px 9px;background:#ffffff;border:1px solid ${pillBorder};color:${headerBgStart};border-radius:7px;font-size:9.5px;font-weight:800;text-transform:uppercase">ROLL: ${safe(student.rollNo || 'N/A')}</span>
              </div>
            </div>
          </div>
        </div>`;
      }
      if (hType === 'asymmetric-split') {
        return `<div style="position:relative;z-index:5;margin-top:-42px;padding:0 ${sidePad};display:flex;align-items:flex-end;gap:16px">
          ${buildUniquePhotoFrame(162, 204)}
          <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;flex:1;min-width:0;padding-bottom:2px">
            <div style="display:inline-block;padding:3px 10px;background:${headerBgStart};color:#ffffff;border-radius:6px;font-size:8.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase">OFFICIAL PASS</div>
            <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${textColor};line-height:1.08;margin-top:5px;text-transform:uppercase;overflow-wrap:anywhere">${safe(student.name || 'N/A')}</div>
            <div style="margin-top:7px;padding:6px 10px;background:${headerBgEnd};color:#ffffff;border-radius:9px;border-left:4px solid ${accentColor}">
              <div style="font-size:7.5px;font-weight:800;color:${cardHeadingColor};text-transform:uppercase;letter-spacing:0.7px">Admission Number</div>
              <div style="font-size:12.5px;font-weight:900;margin-top:1px">${safe(student.admissionNo || 'N/A')}</div>
            </div>
            <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:7px">
              <div style="background:${pillBg};border:1px solid ${pillBorder};border-radius:8px;padding:4px 6px;text-align:center">
                <div style="font-size:7px;font-weight:800;color:${headerBgStart};text-transform:uppercase">Class</div>
                <div style="font-size:11.5px;font-weight:900;color:${textColor};text-transform:uppercase">${safe(`${student.className || 'N/A'}-${student.section || 'A'}`)}</div>
              </div>
              <div style="background:${pillBg};border:1px solid ${pillBorder};border-radius:8px;padding:4px 6px;text-align:center">
                <div style="font-size:7px;font-weight:800;color:${headerBgStart};text-transform:uppercase">Roll No</div>
                <div style="font-size:11.5px;font-weight:900;color:${textColor}">${safe(student.rollNo || 'N/A')}</div>
              </div>
            </div>
          </div>
        </div>`;
      }
      if (hType === 'edge-banner') {
        return `<div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:${topMargin}">
          ${buildUniquePhotoFrame(178, 220)}
          <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:10px;width:100%;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${headerBgEnd});border-top:2px solid ${accentColor};border-bottom:2px solid ${accentColor};padding:7px ${sidePad};display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:#ffffff;line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
            <span style="padding:3px 10px;background:rgba(255,255,255,0.16);border:1px solid ${cardHeadingColor};border-radius:6px;font-size:10px;font-weight:800;color:${cardHeadingColor};letter-spacing:0.8px;flex-shrink:0">ID: ${safe(student.admissionNo || 'N/A')}</span>
          </div>
        </div>`;
      }
      if (hType === 'medallion-plaque') {
        return `<div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:${topMargin};padding:0 ${sidePad}">
          <div style="position:relative;display:flex;flex-direction:column;align-items:center">
            ${buildUniquePhotoFrame(182, 218)}
            <div style="margin-top:-12px;position:relative;z-index:6;padding:3px 15px;background:${headerBgStart};border:1.5px solid ${accentColor};border-radius:999px;font-size:8.5px;font-weight:800;color:${cardHeadingColor};letter-spacing:1.3px;text-transform:uppercase">ID • ${safe(student.admissionNo || 'N/A')}</div>
          </div>
          <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:7px;text-align:${nameAlign};width:100%">
            <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${textColor};line-height:1.08;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
            <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px">
              <span style="width:64px;height:1.5px;background:linear-gradient(90deg, transparent, ${accentColor})"></span>
              <span style="width:6px;height:6px;background:${accentColor};transform:rotate(45deg)"></span>
              <span style="width:64px;height:1.5px;background:linear-gradient(90deg, ${accentColor}, transparent)"></span>
            </div>
          </div>
        </div>`;
      }
      if (hType === 'floating-ribbon') {
        return `<div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:${topMargin};padding:0 ${sidePad}">
          ${buildUniquePhotoFrame(180, 222)}
          <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:-14px;position:relative;z-index:6;text-align:center;width:100%">
            <div style="display:inline-block;max-width:94%;padding:7px 26px;background:linear-gradient(90deg, ${headerBgStart}, ${accentColor}, ${headerBgEnd});color:#ffffff;clip-path:polygon(12px 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 12px 100%, 0 50%);box-shadow:0 8px 18px rgba(15,23,42,0.18)">
              <div style="font-size:${nameSize}px;font-weight:${nameWeight};line-height:1.06;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
            </div>
            <div style="font-size:9.5px;font-weight:800;color:${headerBgStart};letter-spacing:1.5px;margin-top:4px;text-transform:uppercase">SCHOLAR ID • ${safe(student.admissionNo || 'N/A')}</div>
          </div>
        </div>`;
      }
      // Default 'squircle-pill' / 'polaroid-badge'
      return `<div style="position:relative;z-index:5;display:flex;flex-direction:column;align-items:center;margin-top:${topMargin};padding:0 ${sidePad}">
        ${buildUniquePhotoFrame(182, 226)}
        <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:9px;text-align:${nameAlign};width:100%">
          <div style="display:inline-block;max-width:100%;padding:6px 24px;background:${pillBg};border-radius:999px;border:1.5px solid ${pillBorder}">
            <div style="font-size:${nameSize}px;font-weight:${nameWeight};color:${nameColor};line-height:1.08;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
          </div>
          <div style="font-size:9.5px;font-weight:800;color:${headerBgStart};letter-spacing:1.5px;margin-top:4px;text-transform:uppercase">STUDENT ID • ${safe(student.admissionNo || 'N/A')}</div>
        </div>
      </div>`;
    };

    // MACRO P2: Left Vertical Spine Architecture
    if (pMacro === 'left-spine') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:row;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="width:54px;background:linear-gradient(180deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);border-right:4px solid ${accentColor};display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 0;color:#ffffff;flex-shrink:0;z-index:6">
              <div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.18);border:1.5px solid ${accentColor};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:${cardHeadingColor}">ID</div>
              <div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;font-weight:900;letter-spacing:3.2px;color:${cardHeadingColor};text-transform:uppercase;white-space:nowrap">${cardHeading} • ${sessionStr}</div>
              <div style="width:10px;height:48px;border-radius:999px;background:${accentColor}"></div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0;position:relative">
              <div style="position:relative;background:linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:22px 26px 68px;z-index:2;overflow:hidden">
                <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                  ${buildHeaderBrandRow(
                    `padding:4px;background:#ffffff;border-radius:14px;border:2px solid ${accentColor};`,
                    `letter-spacing:0.3px;text-transform:uppercase;`,
                    `display:inline-block;padding:3px 12px;border-radius:999px;background:rgba(255,255,255,0.16);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;`
                  )}
                </div>
                ${buildHeaderSvg(v.arch, 44)}
              </div>
              ${buildHeroSection('-56px', '24px')}
              <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 24px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
                ${buildDetailsSection()}
              </div>
              <div style="position:relative;z-index:5;padding:6px 24px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
                <div>${footerPillOrQr}</div>
                ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:185px;text-align:center;margin-left:auto">
                  <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                  <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                  <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
                </div>` : ''}
              </div>
            </div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P3: Right Vertical Ribbon Pillar Architecture
    if (pMacro === 'right-ribbon') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:row;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0;position:relative">
              <div style="position:relative;background:linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:22px 26px 68px;z-index:2;overflow:hidden">
                <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                  ${buildHeaderBrandRow(
                    `padding:4px;background:#ffffff;border-radius:50%;border:2px solid ${accentColor};`,
                    `letter-spacing:0.3px;text-transform:uppercase;`,
                    `display:inline-block;padding:3px 12px;border-radius:6px;background:rgba(255,255,255,0.18);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;`
                  )}
                </div>
                ${buildHeaderSvg(v.arch, 44)}
              </div>
              ${buildHeroSection('-56px', '24px')}
              <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 24px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
                ${buildDetailsSection()}
              </div>
              <div style="position:relative;z-index:5;padding:6px 24px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
                <div>${footerPillOrQr}</div>
                ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:185px;text-align:center;margin-left:auto">
                  <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                  <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                  <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
                </div>` : ''}
              </div>
            </div>
            <div style="width:48px;background:linear-gradient(180deg, ${accentColor} 0%, ${headerBgStart} 45%, ${headerBgEnd} 100%);border-left:3px solid ${pillBorder};display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 0;color:#ffffff;flex-shrink:0;z-index:6">
              <span style="font-size:14px;color:${cardHeadingColor}">★</span>
              <div style="writing-mode:vertical-rl;font-size:10.5px;font-weight:900;letter-spacing:3px;color:#ffffff;text-transform:uppercase;white-space:nowrap">ID • ${safe(student.admissionNo || 'N/A')} • ${sessionStr}</div>
              <span style="font-size:14px;color:${cardHeadingColor}">★</span>
            </div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P4: Floating Inset Header Card Architecture
    if (pMacro === 'floating-header-box') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:linear-gradient(180deg, ${pillBg} 0%, #ffffff 42%, #ffffff 100%);font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden;padding:18px 0 0">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="margin:0 24px;background:linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);border-radius:24px;border:2.5px solid ${accentColor};padding:18px 24px 54px;position:relative;z-index:2;box-shadow:0 12px 26px rgba(15,23,42,0.16);overflow:hidden">
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                ${buildHeaderBrandRow(
                  `padding:4px;background:#ffffff;border-radius:16px;border:2px solid ${accentColor};`,
                  `letter-spacing:0.4px;text-transform:uppercase;`,
                  `display:inline-block;padding:3px 14px;border-radius:999px;background:rgba(255,255,255,0.18);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;`
                )}
              </div>
            </div>
            ${buildHeroSection('-48px', '32px')}
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 32px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
              ${buildDetailsSection()}
            </div>
            <div style="position:relative;z-index:5;padding:6px 32px 14px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px">
              <div>${footerPillOrQr}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:195px;text-align:center;margin-left:auto">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
              </div>` : ''}
            </div>
            <div style="height:14px;background:linear-gradient(90deg, ${headerBgStart}, ${accentColor}, ${headerBgEnd});width:100%"></div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P5: Double Ornamental Frame Crest Architecture
    if (pMacro === 'double-frame-crest') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:3px solid ${headerBgStart};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="position:absolute;inset:10px;border:2px solid ${accentColor};border-radius:22px;pointer-events:none;z-index:10"></div>
            <div style="position:relative;background:linear-gradient(180deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:26px 36px 76px;z-index:2;overflow:hidden">
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                ${buildHeaderBrandRow(
                  `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid ${accentColor};`,
                  `letter-spacing:0.5px;text-transform:uppercase;`,
                  `display:inline-block;padding:4px 16px;border-radius:999px;background:rgba(255,255,255,0.15);border:1px solid ${accentColor};color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;`
                )}
              </div>
              ${buildHeaderSvg(v.arch, 48)}
            </div>
            ${buildHeroSection('-64px', '36px')}
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 36px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
              ${buildDetailsSection()}
            </div>
            <div style="position:relative;z-index:5;padding:6px 36px 24px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px">
              <div>${footerPillOrQr}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:195px;text-align:center;margin-left:auto">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
              </div>` : ''}
            </div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P6: Pavilion Hero Integrated Top Architecture
    if (pMacro === 'pavilion-hero') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="position:relative;background:radial-gradient(circle at 85% 20%, rgba(255,255,255,0.2), transparent 240px), linear-gradient(145deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:24px 34px 48px;z-index:2;overflow:hidden">
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3;padding-bottom:14px;border-bottom:1.5px solid rgba(255,255,255,0.22)">
                ${buildHeaderBrandRow(
                  `padding:4px;background:#ffffff;border-radius:14px;border:2px solid ${accentColor};`,
                  `letter-spacing:0.4px;text-transform:uppercase;`,
                  `display:inline-block;padding:3px 12px;border-radius:999px;background:rgba(255,255,255,0.18);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;`
                )}
              </div>
              <div style="position:relative;z-index:4;margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:18px">
                <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;flex:1;min-width:0;color:#ffffff">
                  <div style="display:inline-block;padding:3px 12px;background:${accentColor};color:#ffffff;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase">SESSION ${sessionStr}</div>
                  <div style="font-size:${nameSize}px;font-weight:${nameWeight};line-height:1.08;margin-top:8px;text-transform:uppercase;overflow-wrap:anywhere">${safe(student.name || 'N/A')}</div>
                  <div style="margin-top:10px;padding:7px 12px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.35);border-radius:10px">
                    <div style="font-size:8px;font-weight:800;color:${cardHeadingColor};text-transform:uppercase;letter-spacing:0.8px">Admission No</div>
                    <div style="font-size:14px;font-weight:900;color:#ffffff;margin-top:1px">${safe(student.admissionNo || 'N/A')}</div>
                  </div>
                </div>
                ${buildUniquePhotoFrame(162, 202)}
              </div>
              ${buildHeaderSvg(v.arch, 36)}
            </div>
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:10px 34px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
              ${buildDetailsSection()}
            </div>
            <div style="position:relative;z-index:5;padding:6px 34px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px">
              <div>${footerPillOrQr}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:195px;text-align:center;margin-left:auto">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
              </div>` : ''}
            </div>
            <div style="height:14px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P7: Diagonal Corner Geometric Architecture
    if (pMacro === 'corner-geometric') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <svg viewBox="0 0 220 220" style="position:absolute;bottom:0;right:0;width:180px;height:180px;z-index:1;pointer-events:none">
              <polygon points="220,220 220,40 40,220" fill="${pillBg}"></polygon>
              <polygon points="220,220 220,90 90,220" fill="${accentColor}" opacity="0.22"></polygon>
            </svg>
            <div style="position:relative;background:linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:24px 34px 74px;z-index:2;overflow:hidden">
              <div style="position:absolute;top:-30px;right:-30px;width:130px;height:130px;background:${accentColor};opacity:0.28;transform:rotate(35deg)"></div>
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                ${buildHeaderBrandRow(
                  `padding:4px;background:#ffffff;border-radius:14px;border:2.5px solid ${accentColor};`,
                  `letter-spacing:0.4px;text-transform:uppercase;`,
                  `display:inline-block;padding:4px 14px;border-radius:6px;background:rgba(255,255,255,0.18);border-left:3px solid ${accentColor};color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;`
                )}
              </div>
              ${buildHeaderSvg(v.arch, 46)}
            </div>
            ${buildHeroSection('-62px', '34px')}
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 34px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
              ${buildDetailsSection()}
            </div>
            <div style="position:relative;z-index:5;padding:6px 34px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px">
              <div>${footerPillOrQr}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:195px;text-align:center;margin-left:auto">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
              </div>` : ''}
            </div>
            <div style="height:14px;background:linear-gradient(90deg, ${accentColor}, ${headerBgStart}, ${headerBgEnd});width:100%;z-index:5"></div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P8: Campus Lanyard Ticket Credential Pass Architecture
    if (pMacro === 'lanyard-ticket') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);width:74px;height:13px;background:#090d16;border:2px solid rgba(255,255,255,0.45);border-radius:999px;z-index:12"></div>
            <div style="position:absolute;top:240px;left:-18px;width:36px;height:36px;border-radius:50%;background:${pillBg};border:2.5px solid ${accentColor};z-index:12"></div>
            <div style="position:absolute;top:240px;right:-18px;width:36px;height:36px;border-radius:50%;background:${pillBg};border:2.5px solid ${accentColor};z-index:12"></div>
            <div style="position:relative;background:linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:32px 34px 72px;z-index:2;overflow:hidden">
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                ${buildHeaderBrandRow(
                  `padding:4px;background:#ffffff;border-radius:50%;border:2.5px solid ${accentColor};`,
                  `letter-spacing:0.4px;text-transform:uppercase;`,
                  `display:inline-block;padding:3px 14px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid ${accentColor};color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;`
                )}
              </div>
              ${buildHeaderSvg(v.arch, 44)}
            </div>
            ${buildHeroSection('-60px', '34px')}
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 34px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
              ${buildDetailsSection()}
            </div>
            <div style="position:relative;z-index:5;padding:6px 34px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px">
              <div>${footerPillOrQr}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:195px;text-align:center;margin-left:auto">
                <div style="min-height:38px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 5px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
              </div>` : ''}
            </div>
            <div style="height:14px;background:repeating-linear-gradient(45deg, ${headerBgStart}, ${headerBgStart} 12px, ${accentColor} 12px, ${accentColor} 24px);width:100%"></div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P9: Frosted Elevated Inner Card Chassis Architecture
    if (pMacro === 'frosted-inner-card') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:linear-gradient(160deg, ${headerBgStart} 0%, ${headerBgEnd} 45%, ${pillBg} 100%);font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;padding:22px 22px 18px;overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3;padding:4px 8px 54px">
              ${buildHeaderBrandRow(
                `padding:4px;background:#ffffff;border-radius:50%;border:2.5px solid ${accentColor};`,
                `letter-spacing:0.4px;text-transform:uppercase;`,
                `display:inline-block;padding:3px 14px;border-radius:999px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.45);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;`
              )}
            </div>
            <div style="flex:1;background:#ffffff;border-radius:26px;border:2px solid ${pillBorder};box-shadow:0 18px 36px rgba(15,23,42,0.18);display:flex;flex-direction:column;justify-content:space-between;padding:0 0 14px;position:relative;z-index:4">
              ${buildHeroSection('-56px', '22px')}
              <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;padding:6px 22px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
                ${buildDetailsSection()}
              </div>
              <div style="padding:6px 22px 0;display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
                <div>${footerPillOrQr}</div>
                ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:185px;text-align:center;margin-left:auto">
                  <div style="min-height:36px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                  <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                  <div style="font-size:8.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
                </div>` : ''}
              </div>
            </div>
          </article>
        </div>
      </div>`;
    }

    // MACRO P10: Magazine Showcase Portrait Plaque Architecture
    if (pMacro === 'magazine-showcase') {
      return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
        <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
          ${DESIGNED_TEMPLATES_ISOLATION_CSS}
          <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
            ${marginGuideHtml}
            ${watermarkHtml}
            <div style="position:relative;background:linear-gradient(90deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);border-bottom:4px solid ${accentColor};padding:20px 32px;z-index:2">
              <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
                ${buildHeaderBrandRow(
                  `padding:4px;background:#ffffff;border-radius:14px;border:2px solid ${accentColor};`,
                  `letter-spacing:0.4px;text-transform:uppercase;`,
                  `display:inline-block;padding:3px 12px;border-radius:6px;background:rgba(255,255,255,0.18);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;`
                )}
              </div>
            </div>
            <div style="position:relative;z-index:5;padding:14px 34px 0;display:flex;flex-direction:column;align-items:center">
              <div style="width:100%;background:linear-gradient(135deg, ${pillBg} 0%, #ffffff 100%);border:2px solid ${pillBorder};border-radius:22px;padding:12px 16px;display:flex;flex-direction:column;align-items:center;position:relative">
                <span style="position:absolute;top:12px;right:14px;padding:3px 10px;background:${headerBgStart};color:${cardHeadingColor};border-radius:999px;font-size:8.5px;font-weight:800;letter-spacing:1px">${sessionStr}</span>
                ${buildUniquePhotoFrame(178, 216)}
                <div ${dragAttr('name')} class="idcard-drag-elem" style="transform:translate(${nameX}px,${nameY}px);cursor:move;margin-top:-16px;position:relative;z-index:6;width:92%;background:linear-gradient(90deg, ${headerBgStart}, ${headerBgEnd});border:2px solid ${accentColor};border-radius:14px;padding:7px 16px;text-align:center;color:#ffffff;box-shadow:0 8px 20px rgba(15,23,42,0.2)">
                  <div style="font-size:${nameSize}px;font-weight:${nameWeight};line-height:1.06;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(student.name || 'N/A')}</div>
                  <div style="font-size:9px;font-weight:800;color:${cardHeadingColor};letter-spacing:1.4px;margin-top:2px;text-transform:uppercase">ADMISSION ID • ${safe(student.admissionNo || 'N/A')}</div>
                </div>
              </div>
            </div>
            <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 34px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
              ${buildDetailsSection()}
            </div>
            <div style="position:relative;z-index:5;padding:6px 34px 14px;display:flex;align-items:flex-end;justify-content:space-between;gap:14px">
              <div>${footerPillOrQr}</div>
              ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:195px;text-align:center;margin-left:auto">
                <div style="min-height:36px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
                <div style="width:100%;height:1.5px;background:${accentColor};margin:3px 0 4px"></div>
                <div style="font-size:9px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1px">${sigLabel}</div>
              </div>` : ''}
            </div>
            <div style="height:14px;background:linear-gradient(90deg, ${headerBgStart}, ${accentColor}, ${headerBgEnd});width:100%"></div>
          </article>
        </div>
      </div>`;
    }

    // DEFAULT PORTRAIT MACRO P1 ('classic-overlap')
    const headerPadBottom = (v.hero === 'horizontal-card' || v.hero === 'asymmetric-split') ? '62px' : '78px';
    return `<div class="idcard-uploaded-preview-shell" style="width:${shellW}px;height:${shellH}px;position:relative;overflow:hidden;border-radius:24px;box-shadow:0 18px 40px rgba(15,23,42,0.2)">
      <div class="idcard-uploaded-preview-scale" style="width:${cardW}px;height:${cardH}px;transform:scale(${scale});transform-origin:top left">
        ${DESIGNED_TEMPLATES_ISOLATION_CSS}
        <article class="gjv-id-v5 tpl-${layoutStyle}" data-macro="${pMacro}" data-admission-no="${safe(student.admissionNo)}" style="${cardDimLock}box-sizing:border-box;position:relative;background:${cardBg};font-family:${fontFamily};color:${textColor};display:flex;flex-direction:column;justify-content:space-between;border-radius:30px;border:2.5px solid ${pillBorder};overflow:hidden">
          ${marginGuideHtml}
          ${watermarkHtml}
          <div style="position:relative;background:radial-gradient(circle at 20% 15%, rgba(255,255,255,0.22), transparent 220px), linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%);padding:26px 34px ${headerPadBottom};z-index:2;overflow:hidden">
            <div ${dragAttr('logo')} class="idcard-drag-elem" style="transform:translate(${logoX}px,${logoY}px);cursor:move;position:relative;z-index:3">
              ${buildHeaderBrandRow(
                `padding:5px;background:#ffffff;border-radius:50%;border:2.5px solid ${accentColor};box-shadow:0 6px 18px rgba(0,0,0,0.2);`,
                `letter-spacing:0.4px;text-transform:uppercase;`,
                `display:inline-block;padding:4px 16px;border-radius:999px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.4);color:${cardHeadingColor};font-size:${cardHeadingSize}px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;`
              )}
            </div>
            ${buildHeaderSvg(v.arch, 48)}
          </div>
          ${buildHeroSection('-66px', '34px')}
          <div ${dragAttr('details')} class="idcard-drag-elem" style="transform:translate(${detailsX}px,${detailsY}px);cursor:move;position:relative;z-index:4;padding:6px 34px 0;flex:1;display:flex;flex-direction:column;justify-content:center">
            ${buildDetailsSection()}
          </div>
          <div style="position:relative;z-index:5;padding:6px 34px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
            <div>${footerPillOrQr}</div>
            ${showSignature ? `<div ${dragAttr('signature')} class="idcard-drag-elem" style="transform:translate(${sigX}px,${sigY}px);cursor:move;width:200px;text-align:center;margin-left:auto">
              <div style="min-height:40px;display:flex;align-items:flex-end;justify-content:center">${sigMarkup}</div>
              <div style="width:100%;height:1.5px;background:${accentColor};margin:4px 0 6px"></div>
              <div style="font-size:9.5px;text-transform:uppercase;font-weight:800;color:${headerBgStart};letter-spacing:1.1px">${sigLabel}</div>
            </div>` : ''}
          </div>
          <div style="height:16px;background:linear-gradient(90deg, ${headerBgEnd}, ${headerBgStart}, ${accentColor});width:100%"></div>
        </article>
      </div>
    </div>`;
  }

  // Fallback to Royal Blue layout if layoutStyle unrecognized
  return renderDynamicDesignedCardHTML(student, session, principal, savedSignatureImage, { ...design, layoutStyle: 'royal-blue' }, side, options);
}

// -------------------------------------------------------------------------
// SUBTAB SWITCHER (Batch, Gallery, Designer)
// -------------------------------------------------------------------------
function switchIdCardSubTab(subtab) {
  if (subtab !== 'designer' && isDesignerDirty) {
    if (!confirm('You have unsaved changes in your ID Card design. Are you sure you want to navigate away without saving?')) {
      return;
    }
  }

  const batchBtn = document.getElementById('subtab-idcard-batch-btn');
  const galleryBtn = document.getElementById('subtab-idcard-gallery-btn');
  const designerBtn = document.getElementById('subtab-idcard-designer-btn');

  const batchView = document.getElementById('idcard-subview-batch');
  const galleryView = document.getElementById('idcard-subview-gallery');
  const designerView = document.getElementById('idcard-subview-designer');

  const resetBtnClass = btn => {
    btn?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    btn?.classList.add('text-slate-500');
  };
  const setBtnActive = btn => {
    btn?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    btn?.classList.remove('text-slate-500');
  };

  resetBtnClass(batchBtn);
  resetBtnClass(galleryBtn);
  resetBtnClass(designerBtn);

  batchView?.classList.add('hidden');
  galleryView?.classList.add('hidden');
  designerView?.classList.add('hidden');

  if (subtab === 'designer') {
    setBtnActive(designerBtn);
    designerView?.classList.remove('hidden');
    loadIdCardDesigner();
  } else if (subtab === 'gallery') {
    setBtnActive(galleryBtn);
    galleryView?.classList.remove('hidden');
    loadIdCardTemplates();
  } else {
    setBtnActive(batchBtn);
    batchView?.classList.remove('hidden');
    updateBatchViewBanner();
  }
}

function updateBatchViewBanner() {
  const badgeTpl = document.getElementById('batch-active-template-badge');
  const badgeOrient = document.getElementById('batch-active-orientation-badge');
  if (badgeTpl && window.schoolIdCardDesign) {
    const tId = window.schoolIdCardDesign.templateId || window.schoolIdCardDesign.layoutStyle || 'royal-blue';
    const tpl = (window.schoolBuiltinTemplates || BUILTIN_ID_CARD_TEMPLATES).find(t => t.id === tId);
    badgeTpl.textContent = tpl ? tpl.name : tId;
  }
  if (badgeOrient && window.schoolIdCardDesign) {
    const isL = window.schoolIdCardDesign.cardSize?.orientation === 'landscape';
    badgeOrient.textContent = isL ? 'CR80 Landscape' : 'CR80 Portrait';
  }
}

function setDesignerZoom(level) {
  designerZoomLevel = level;
  const scaler = document.getElementById('designer-stage-scaler');
  if (scaler) scaler.style.transform = `scale(${level})`;
}

function setDesignerSide(side) {
  designerCurrentSide = side;
  const frontBtn = document.getElementById('designer-btn-side-front');
  const backBtn = document.getElementById('designer-btn-side-back');
  const sideBadge = document.getElementById('designer-preview-side-badge');

  if (side === 'back') {
    backBtn?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    backBtn?.classList.remove('text-slate-500');
    frontBtn?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    frontBtn?.classList.add('text-slate-500');
    if (sideBadge) {
      sideBadge.textContent = 'BACK SIDE';
      sideBadge.className = 'px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-bold rounded-lg border border-amber-500/20';
    }
  } else {
    frontBtn?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    frontBtn?.classList.remove('text-slate-500');
    backBtn?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    backBtn?.classList.add('text-slate-500');
    if (sideBadge) {
      sideBadge.textContent = 'FRONT SIDE';
      sideBadge.className = 'px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] font-bold rounded-lg border border-blue-500/20';
    }
  }

  renderDesignerLivePreview();
}

// -------------------------------------------------------------------------
// TEMPLATE GALLERY CONTROLLER (10 Originals + Saved Presets)
// -------------------------------------------------------------------------
async function loadIdCardTemplates() {
  try {
    const res = await ApiService.getPrintCenterIdCardTemplates();
    if (res && res.templates) {
      window.schoolBuiltinTemplates = res.templates;
      window.schoolDefaultTemplateId = res.defaultTemplateId || 'royal-blue';
    }
    renderGalleryCards();
  } catch (err) {
    console.warn('Failed to load templates via API, using defaults:', err);
    window.schoolBuiltinTemplates = BUILTIN_ID_CARD_TEMPLATES;
    renderGalleryCards();
  }
}

function filterGalleryTemplates(filter) {
  currentGalleryFilter = filter;
  ['all', 'builtin', 'custom'].forEach(f => {
    const btn = document.getElementById(`gallery-filter-${f}`);
    if (btn) {
      if (f === filter) {
        btn.className = 'px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-bold';
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white';
      }
    }
  });
  renderGalleryCards();
}

function renderGalleryCards() {
  const grid = document.getElementById('gallery-templates-grid');
  if (!grid) return;

  const sample = (window.designerSampleStudents || [])[0] || {
    name: 'Sample Student',
    admissionNo: 'ADM-2026-001',
    className: 'Class X',
    section: 'A',
    rollNo: 1,
    fatherName: 'Guardian Name',
    dob: '2012-05-15',
    session: '2026-2027',
    bloodGroup: 'O+'
  };

  const builtinList = (window.schoolBuiltinTemplates && window.schoolBuiltinTemplates.length > 0)
    ? window.schoolBuiltinTemplates
    : BUILTIN_ID_CARD_TEMPLATES;

  let items = [];
  if (currentGalleryFilter === 'all' || currentGalleryFilter === 'builtin') {
    items = items.concat(builtinList.map(t => ({ ...t, isCustom: false })));
  }
  if (currentGalleryFilter === 'all' || currentGalleryFilter === 'custom') {
    const customPresets = (window.schoolIdCardPresets || []).map(p => ({
      id: p.id,
      name: p.name,
      description: 'Custom school-saved design preset.',
      layoutStyle: p.design?.layoutStyle || 'royal-blue',
      cardSize: p.design?.cardSize || { orientation: 'portrait' },
      isCustom: true,
      design: p.design
    }));
    items = items.concat(customPresets);
  }

  if (items.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-400 text-xs">No templates found for this filter.</div>`;
    return;
  }

  const defaultId = window.schoolDefaultTemplateId || window.currentSchool?.defaultTemplateId || 'royal-blue';

  grid.innerHTML = items.map(tpl => {
    const isLandscape = tpl.cardSize?.orientation === 'landscape';
    const isDefault = tpl.id === defaultId;
    const miniScale = isLandscape ? 0.32 : 0.28;
    const tplDesign = tpl.isCustom ? tpl.design : tpl;

    const miniCard = renderDynamicDesignedCardHTML(
      sample,
      '2026-2027',
      window.currentSchool?.principalName || 'Principal',
      '',
      tplDesign,
      'front',
      { previewScale: miniScale }
    );

    return `
      <div class="glass border border-slate-200/60 dark:border-slate-800/60 rounded-3xl p-5 flex flex-col justify-between space-y-4 hover:border-amber-500/50 transition-all group shadow-sm hover:shadow-xl">
        <div>
          <!-- Header Bar of Template Card -->
          <div class="flex items-center justify-between gap-2 mb-3">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono ${tpl.isCustom ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'}">
              ${tpl.isCustom ? 'Custom Saved' : 'Original Template'}
            </span>
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-mono font-bold">
                ${isLandscape ? 'CR80 Landscape' : 'CR80 Portrait'}
              </span>
              ${isDefault ? `<span class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold border border-amber-500/30">★ Default</span>` : ''}
            </div>
          </div>

          <!-- Miniature Live Preview Window -->
          <div class="w-full bg-slate-100 dark:bg-slate-950 rounded-2xl flex items-center justify-center p-3 overflow-hidden border border-slate-200/50 dark:border-slate-800/50 min-h-[240px] max-h-[260px] cursor-pointer" onclick="openTemplatePreviewModal('${tpl.id}')">
            <div style="pointer-events:none">
              ${miniCard}
            </div>
          </div>

          <!-- Template Info -->
          <div class="mt-4 space-y-1">
            <h4 class="font-black text-slate-900 dark:text-white text-sm group-hover:text-amber-500 transition-colors">${tpl.name}</h4>
            <p class="text-xs text-slate-500 line-clamp-2 leading-relaxed">${tpl.description || ''}</p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onclick="openTemplatePreviewModal('${tpl.id}')" class="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all text-center">
            👁️ Preview
          </button>
          <button type="button" onclick="customizeTemplate('${tpl.id}')" class="py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 text-xs font-bold hover:bg-amber-500 hover:text-slate-950 dark:hover:bg-amber-400 dark:hover:text-slate-950 transition-all text-center">
            🎨 Edit
          </button>
          <button type="button" onclick="useTemplate('${tpl.id}')" class="py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-all text-center shadow-sm">
            ⭐ Use
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------------------
// TEMPLATE PREVIEW MODAL
// -------------------------------------------------------------------------
function openTemplatePreviewModal(templateId) {
  modalTemplateId = templateId;
  modalSide = 'front';
  const modal = document.getElementById('idcard-template-modal');
  if (!modal) return;

  const tpl = (window.schoolBuiltinTemplates || BUILTIN_ID_CARD_TEMPLATES).find(t => t.id === templateId)
    || (window.schoolIdCardPresets || []).find(p => p.id === templateId)?.design
    || BUILTIN_ID_CARD_TEMPLATES[0];

  const titleEl = document.getElementById('modal-template-title');
  const descEl = document.getElementById('modal-template-desc');
  const badgeEl = document.getElementById('modal-template-badge');

  if (titleEl) titleEl.textContent = tpl.name || 'Template Preview';
  if (descEl) descEl.textContent = tpl.description || 'High-definition live card preview.';
  if (badgeEl) {
    const isL = tpl.cardSize?.orientation === 'landscape';
    badgeEl.textContent = `${tpl.name} (${isL ? 'CR80 Landscape' : 'CR80 Portrait'})`;
  }

  // Bind Customize and Use buttons in modal
  const custBtn = document.getElementById('modal-btn-customize');
  if (custBtn) {
    custBtn.onclick = () => {
      closeTemplatePreviewModal();
      customizeTemplate(templateId);
    };
  }

  const useBtn = document.getElementById('modal-btn-use');
  if (useBtn) {
    useBtn.onclick = () => {
      closeTemplatePreviewModal();
      useTemplate(templateId);
    };
  }

  renderModalPreview();
  modal.classList.remove('hidden');
}

function closeTemplatePreviewModal() {
  const modal = document.getElementById('idcard-template-modal');
  modal?.classList.add('hidden');
}

function setModalSide(side) {
  modalSide = side;
  const frontBtn = document.getElementById('modal-btn-side-front');
  const backBtn = document.getElementById('modal-btn-side-back');
  if (side === 'back') {
    backBtn?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    backBtn?.classList.remove('text-slate-500');
    frontBtn?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    frontBtn?.classList.add('text-slate-500');
  } else {
    frontBtn?.classList.add('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    frontBtn?.classList.remove('text-slate-500');
    backBtn?.classList.remove('bg-white', 'dark:bg-slate-900', 'text-slate-900', 'dark:text-white', 'shadow-sm');
    backBtn?.classList.add('text-slate-500');
  }
  renderModalPreview();
}

function renderModalPreview() {
  const container = document.getElementById('modal-template-preview-card');
  if (!container) return;

  const tpl = (window.schoolBuiltinTemplates || BUILTIN_ID_CARD_TEMPLATES).find(t => t.id === modalTemplateId)
    || (window.schoolIdCardPresets || []).find(p => p.id === modalTemplateId)?.design
    || BUILTIN_ID_CARD_TEMPLATES[0];

  const sample = (window.designerSampleStudents || [])[0] || {
    name: 'Sample Student',
    admissionNo: 'ADM-2026-001',
    className: 'Class X',
    section: 'A',
    rollNo: 1,
    fatherName: 'Guardian Name',
    dob: '2012-05-15',
    session: '2026-2027',
    bloodGroup: 'B+'
  };

  const isL = tpl.cardSize?.orientation === 'landscape';
  const cardHtml = renderDynamicDesignedCardHTML(
    sample,
    '2026-2027',
    window.currentSchool?.principalName || 'Principal',
    '',
    tpl,
    modalSide,
    { previewScale: isL ? 0.65 : 0.68, showMargins: true }
  );

  container.innerHTML = cardHtml;
}

function customizeTemplate(templateId) {
  switchIdCardSubTab('designer');
  applyTemplateToDesigner(templateId);
}

async function useTemplate(templateId) {
  const tpl = (window.schoolBuiltinTemplates || BUILTIN_ID_CARD_TEMPLATES).find(t => t.id === templateId)
    || (window.schoolIdCardPresets || []).find(p => p.id === templateId)?.design;

  if (!tpl) return alert('Template not found.');

  try {
    const confirmed = confirm(`Set "${tpl.name || templateId}" as the active student ID card design for ${window.currentSchool?.name || 'this school'}?`);
    if (!confirmed) return;

    // Reset/apply design on backend
    const resetRes = await ApiService.resetPrintCenterIdCardDesign(templateId);
    window.schoolIdCardDesign = resetRes.design || tpl;

    // Set as default template
    await ApiService.setDefaultPrintCenterIdCardTemplate(templateId);
    window.schoolDefaultTemplateId = templateId;
    if (window.currentSchool) window.currentSchool.defaultTemplateId = templateId;

    updateBatchViewBanner();
    alert(`Success! "${tpl.name || templateId}" is now the active template for this school.`);
    switchIdCardSubTab('batch');
  } catch (err) {
    console.error('Failed to set active template:', err);
    alert('Error setting template: ' + err.message);
  }
}

// -------------------------------------------------------------------------
// DESIGN STUDIO FORM SYNC & PRESETS
// -------------------------------------------------------------------------
function applyTemplateToDesigner(templateId) {
  const tpl = (window.schoolBuiltinTemplates || BUILTIN_ID_CARD_TEMPLATES).find(t => t.id === templateId);
  if (!tpl) return;

  const currentBranding = window.schoolIdCardDesign?.branding || {};
  const currentSignature = window.schoolIdCardDesign?.signature || {};

  // Merge template styling while preserving school-specific identity
  const cloned = JSON.parse(JSON.stringify(tpl));
  cloned.branding.schoolName = currentBranding.schoolName || window.currentSchool?.name || cloned.branding.schoolName;
  cloned.branding.schoolAddress = currentBranding.schoolAddress || cloned.branding.schoolAddress;
  cloned.branding.schoolPhone = currentBranding.schoolPhone || cloned.branding.schoolPhone;
  cloned.branding.schoolWebsite = currentBranding.schoolWebsite || cloned.branding.schoolWebsite;
  cloned.signature.principalName = currentSignature.principalName || cloned.signature.principalName;
  cloned.signature.principalSignatureImage = currentSignature.principalSignatureImage || '';

  populateDesignerFormFromDesign(cloned);
  isDesignerDirty = true;
  document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
  pushUndoState();
  renderDesignerLivePreview();
}

function resetDesignerOffsets() {
  const offsetIds = [
    'designer-photo-x', 'designer-photo-y',
    'designer-logo-x', 'designer-logo-y',
    'designer-name-x', 'designer-name-y',
    'designer-details-x', 'designer-details-y',
    'designer-sig-x', 'designer-sig-y',
    'designer-qrcode-x', 'designer-qrcode-y'
  ];
  offsetIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 0;
  });

  isDesignerDirty = true;
  document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
  pushUndoState();
  renderDesignerLivePreview();
}

function populateDesignerFormFromDesign(design) {
  if (!design) return;

  // 0. Template & Layout Selector
  const tplSel = document.getElementById('designer-template-select');
  if (tplSel) tplSel.value = design.layoutStyle || design.templateId || 'royal-blue';

  // 1. Dimensions
  const cardSize = design.cardSize || {};
  const presetSel = document.getElementById('designer-card-preset');
  if (presetSel) presetSel.value = cardSize.preset || 'CR80_PORTRAIT';
  const widthInp = document.getElementById('designer-card-width-mm');
  if (widthInp) widthInp.value = cardSize.widthMm || 53.98;
  const heightInp = document.getElementById('designer-card-height-mm');
  if (heightInp) heightInp.value = cardSize.heightMm || 85.60;
  const orientSel = document.getElementById('designer-card-orientation');
  if (orientSel) orientSel.value = cardSize.orientation || 'portrait';
  const marginInp = document.getElementById('designer-card-margin-mm');
  if (marginInp) marginInp.value = cardSize.safeMarginMm || 3;

  // 2. Branding & Colors
  const branding = design.branding || {};
  const nameInp = document.getElementById('designer-school-name');
  if (nameInp) nameInp.value = branding.schoolName || window.currentSchool?.name || '';
  const nameSize = document.getElementById('designer-school-name-size');
  if (nameSize) nameSize.value = branding.schoolNameFontSize || 30;
  const nameWeight = document.getElementById('designer-school-name-weight');
  if (nameWeight) nameWeight.value = branding.schoolNameFontWeight || '800';
  const nameColor = document.getElementById('designer-school-name-color');
  if (nameColor) nameColor.value = branding.schoolNameColor || '#ffffff';

  const headingInp = document.getElementById('designer-card-heading');
  if (headingInp) headingInp.value = branding.cardHeading || 'STUDENT IDENTITY CARD';
  const headingColor = document.getElementById('designer-card-heading-color');
  if (headingColor) headingColor.value = branding.cardHeadingColor || '#c99a35';

  const headerStyleSel = document.getElementById('designer-header-style');
  if (headerStyleSel) headerStyleSel.value = branding.headerStyle || 'gradient';

  const headStart = document.getElementById('designer-header-bg-start');
  if (headStart) headStart.value = branding.headerBgColor || '#082f55';
  const headEnd = document.getElementById('designer-header-bg-end');
  if (headEnd) headEnd.value = branding.headerBgColorEnd || '#041b31';
  const cardBg = document.getElementById('designer-card-bg');
  if (cardBg) cardBg.value = branding.cardBgColor || '#ffffff';
  const accent = document.getElementById('designer-accent-color');
  if (accent) accent.value = branding.accentColor || '#c99a35';
  const textColor = document.getElementById('designer-text-color');
  if (textColor) textColor.value = branding.textColor || '#082f55';

  const fontFam = document.getElementById('designer-font-family');
  if (fontFam) fontFam.value = branding.fontFamily || 'Outfit, sans-serif';

  const showLogo = document.getElementById('designer-show-logo');
  if (showLogo) showLogo.checked = branding.showLogo !== false;
  const logoSize = document.getElementById('designer-logo-size');
  if (logoSize) logoSize.value = branding.logoSize || 64;
  const logoPos = document.getElementById('designer-logo-pos');
  if (logoPos) logoPos.value = branding.logoPosition || 'center';

  const schoolAddr = document.getElementById('designer-school-address');
  if (schoolAddr) schoolAddr.value = branding.schoolAddress || '';
  const schoolPhone = document.getElementById('designer-school-phone');
  if (schoolPhone) schoolPhone.value = branding.schoolPhone || '';
  const schoolWeb = document.getElementById('designer-school-website');
  if (schoolWeb) schoolWeb.value = branding.schoolWebsite || '';

  // 3. Student fields
  const sFields = design.studentFields || {};
  const pWidth = document.getElementById('designer-photo-width');
  if (pWidth) pWidth.value = sFields.photoWidth || 196;
  const pHeight = document.getElementById('designer-photo-height');
  if (pHeight) pHeight.value = sFields.photoHeight || 252;
  const pRadius = document.getElementById('designer-photo-radius');
  if (pRadius) pRadius.value = sFields.photoBorderRadius ?? 16;
  const pBorderColor = document.getElementById('designer-photo-border-color');
  if (pBorderColor) pBorderColor.value = sFields.photoBorderColor || branding.accentColor || '#c99a35';
  const pBorderWidth = document.getElementById('designer-photo-border-width');
  if (pBorderWidth) pBorderWidth.value = sFields.photoBorderWidth ?? 3;

  const sNameSize = document.getElementById('designer-student-name-size');
  if (sNameSize) sNameSize.value = sFields.nameFontSize || 28;
  const sNameColor = document.getElementById('designer-student-name-color');
  if (sNameColor) sNameColor.value = sFields.nameColor || '#041b31';
  const sNameAlign = document.getElementById('designer-student-name-align');
  if (sNameAlign) sNameAlign.value = sFields.alignment || 'center';

  const fieldsMap = sFields.fields || {};
  const fieldKeys = ['fatherName', 'dob', 'admissionNo', 'classSection', 'rollNo', 'session', 'bloodGroup', 'emergencyContact', 'address'];
  fieldKeys.forEach(k => {
    const chk = document.getElementById(`designer-field-${k}`);
    const lbl = document.getElementById(`designer-label-${k}`);
    if (chk) chk.checked = !!fieldsMap[k]?.enabled;
    if (lbl && fieldsMap[k]?.label) lbl.value = fieldsMap[k].label;
  });

  const fSize = document.getElementById('designer-field-font-size');
  if (fSize) fSize.value = sFields.fieldFontSize || 13;
  const lSize = document.getElementById('designer-label-font-size');
  if (lSize) lSize.value = sFields.labelFontSize || 9;
  const fSpacing = document.getElementById('designer-field-spacing');
  if (fSpacing) fSpacing.value = sFields.spacing || 8;

  // 4. Numeric Offsets
  const offsets = [
    { id: 'designer-photo-x', val: sFields.photoX ?? 0 },
    { id: 'designer-photo-y', val: sFields.photoY ?? 0 },
    { id: 'designer-logo-x', val: branding.logoX ?? 0 },
    { id: 'designer-logo-y', val: branding.logoY ?? 0 },
    { id: 'designer-name-x', val: sFields.nameX ?? 0 },
    { id: 'designer-name-y', val: sFields.nameY ?? 0 },
    { id: 'designer-details-x', val: sFields.detailsX ?? 0 },
    { id: 'designer-details-y', val: sFields.detailsY ?? 0 },
    { id: 'designer-sig-x', val: design.signature?.signatureX ?? 0 },
    { id: 'designer-sig-y', val: design.signature?.signatureY ?? 0 },
    { id: 'designer-qrcode-x', val: design.decorations?.qrX ?? 0 },
    { id: 'designer-qrcode-y', val: design.decorations?.qrY ?? 0 }
  ];
  offsets.forEach(o => {
    const el = document.getElementById(o.id);
    if (el) el.value = o.val;
  });

  // 5. QR Code & Decorations
  const dec = design.decorations || {};
  const showQr = document.getElementById('designer-show-qrcode');
  if (showQr) showQr.checked = dec.showQrCode ?? design.showQrCode ?? false;
  const qrSizeInp = document.getElementById('designer-qrcode-size');
  if (qrSizeInp) qrSizeInp.value = dec.qrSize || 84;
  const qrFormatSel = document.getElementById('designer-qrcode-format');
  if (qrFormatSel) qrFormatSel.value = dec.qrFormat || 'qr';
  const watermarkSel = document.getElementById('designer-watermark');
  if (watermarkSel) watermarkSel.value = dec.watermark || 'none';

  // 6. Signature
  const sig = design.signature || {};
  const showSig = document.getElementById('designer-show-signature');
  if (showSig) showSig.checked = sig.showSignature !== false;
  const sigLbl = document.getElementById('designer-signature-label');
  if (sigLbl) sigLbl.value = sig.label || 'Principal Signature';
  const sigName = document.getElementById('designer-signature-name');
  if (sigName) sigName.value = sig.principalName || '';

  // 7. Back Side
  const back = design.backSide || {};
  const backEn = document.getElementById('designer-backside-enabled');
  if (backEn) backEn.checked = back.enabled !== false;
  const backHead = document.getElementById('designer-backside-heading');
  if (backHead) backHead.value = back.heading || 'RULES & INSTRUCTIONS';
  const backTerms = document.getElementById('designer-backside-terms');
  if (backTerms) backTerms.value = back.terms || '';
  const backHelp = document.getElementById('designer-backside-helpline');
  if (backHelp) backHelp.value = back.emergencyHelpline || '';
  const backRet = document.getElementById('designer-backside-return');
  if (backRet) backRet.value = back.returnAddress || '';
}

function collectDesignerDesignFromForm() {
  const current = window.schoolIdCardDesign || {};
  const fieldKeys = ['fatherName', 'dob', 'admissionNo', 'classSection', 'rollNo', 'session', 'bloodGroup', 'emergencyContact', 'address'];
  const defaultIcons = { fatherName: 'F/N', dob: 'DOB', admissionNo: 'ID', classSection: 'CLS', rollNo: 'NO.', session: 'YR', bloodGroup: 'BG', emergencyContact: 'EMG', address: 'ADR' };
  const builtFields = {};

  fieldKeys.forEach(k => {
    const chk = document.getElementById(`designer-field-${k}`);
    const lbl = document.getElementById(`designer-label-${k}`);
    builtFields[k] = {
      enabled: chk ? chk.checked : true,
      label: lbl ? lbl.value.trim() : k,
      icon: current.studentFields?.fields?.[k]?.icon || defaultIcons[k] || '•'
    };
  });

  const photoX = parseInt(document.getElementById('designer-photo-x')?.value || 0);
  const photoY = parseInt(document.getElementById('designer-photo-y')?.value || 0);
  const logoX = parseInt(document.getElementById('designer-logo-x')?.value || 0);
  const logoY = parseInt(document.getElementById('designer-logo-y')?.value || 0);
  const nameX = parseInt(document.getElementById('designer-name-x')?.value || 0);
  const nameY = parseInt(document.getElementById('designer-name-y')?.value || 0);
  const detailsX = parseInt(document.getElementById('designer-details-x')?.value || 0);
  const detailsY = parseInt(document.getElementById('designer-details-y')?.value || 0);
  const sigX = parseInt(document.getElementById('designer-sig-x')?.value || 0);
  const sigY = parseInt(document.getElementById('designer-sig-y')?.value || 0);
  const qrX = parseInt(document.getElementById('designer-qrcode-x')?.value || 0);
  const qrY = parseInt(document.getElementById('designer-qrcode-y')?.value || 0);

  const templateId = document.getElementById('designer-template-select')?.value || current.templateId || current.layoutStyle || 'royal-blue';

  return {
    version: 2,
    templateId,
    layoutStyle: templateId,
    cardSize: {
      preset: document.getElementById('designer-card-preset')?.value || 'CR80_PORTRAIT',
      widthMm: parseFloat(document.getElementById('designer-card-width-mm')?.value || 53.98),
      heightMm: parseFloat(document.getElementById('designer-card-height-mm')?.value || 85.60),
      orientation: document.getElementById('designer-card-orientation')?.value || 'portrait',
      safeMarginMm: parseFloat(document.getElementById('designer-card-margin-mm')?.value || 3)
    },
    branding: {
      schoolName: document.getElementById('designer-school-name')?.value.trim() || window.currentSchool?.name || '',
      schoolNameFontSize: parseInt(document.getElementById('designer-school-name-size')?.value || 30),
      schoolNameFontWeight: document.getElementById('designer-school-name-weight')?.value || '800',
      schoolNameColor: document.getElementById('designer-school-name-color')?.value || '#ffffff',
      cardHeading: document.getElementById('designer-card-heading')?.value.trim() || 'STUDENT IDENTITY CARD',
      cardHeadingFontSize: parseInt(current.branding?.cardHeadingFontSize || 13),
      cardHeadingColor: document.getElementById('designer-card-heading-color')?.value || '#c99a35',
      headerStyle: document.getElementById('designer-header-style')?.value || 'gradient',
      headerBgColor: document.getElementById('designer-header-bg-start')?.value || '#082f55',
      headerBgColorEnd: document.getElementById('designer-header-bg-end')?.value || '#041b31',
      cardBgColor: document.getElementById('designer-card-bg')?.value || '#ffffff',
      accentColor: document.getElementById('designer-accent-color')?.value || '#c99a35',
      textColor: document.getElementById('designer-text-color')?.value || '#082f55',
      fontFamily: document.getElementById('designer-font-family')?.value || 'Outfit, sans-serif',
      showLogo: document.getElementById('designer-show-logo')?.checked ?? true,
      logoSize: parseInt(document.getElementById('designer-logo-size')?.value || 64),
      logoPosition: document.getElementById('designer-logo-pos')?.value || 'center',
      logoX,
      logoY,
      schoolAddress: document.getElementById('designer-school-address')?.value.trim() || '',
      schoolPhone: document.getElementById('designer-school-phone')?.value.trim() || '',
      schoolWebsite: document.getElementById('designer-school-website')?.value.trim() || ''
    },
    studentFields: {
      photoWidth: parseInt(document.getElementById('designer-photo-width')?.value || 196),
      photoHeight: parseInt(document.getElementById('designer-photo-height')?.value || 252),
      photoBorderRadius: parseInt(document.getElementById('designer-photo-radius')?.value || 16),
      photoBorderColor: document.getElementById('designer-photo-border-color')?.value || document.getElementById('designer-accent-color')?.value || '#c99a35',
      photoBorderWidth: parseInt(document.getElementById('designer-photo-border-width')?.value ?? 3),
      photoX,
      photoY,
      nameFontSize: parseInt(document.getElementById('designer-student-name-size')?.value || 28),
      nameFontWeight: document.getElementById('designer-school-name-weight')?.value || '800',
      nameColor: document.getElementById('designer-student-name-color')?.value || '#041b31',
      nameX,
      nameY,
      alignment: document.getElementById('designer-student-name-align')?.value || 'center',
      fields: builtFields,
      fieldFontSize: parseInt(document.getElementById('designer-field-font-size')?.value || 13),
      labelFontSize: parseInt(document.getElementById('designer-label-font-size')?.value || 9),
      spacing: parseInt(document.getElementById('designer-field-spacing')?.value || 8),
      detailsX,
      detailsY
    },
    decorations: {
      showQrCode: document.getElementById('designer-show-qrcode')?.checked ?? false,
      qrSize: parseInt(document.getElementById('designer-qrcode-size')?.value || 84),
      qrFormat: document.getElementById('designer-qrcode-format')?.value || 'qr',
      qrX,
      qrY,
      watermark: document.getElementById('designer-watermark')?.value || 'none',
      accentStripe: true
    },
    signature: {
      showSignature: document.getElementById('designer-show-signature')?.checked ?? true,
      label: document.getElementById('designer-signature-label')?.value.trim() || 'Principal Signature',
      principalName: document.getElementById('designer-signature-name')?.value.trim() || current.signature?.principalName || '',
      principalSignatureImage: current.signature?.principalSignatureImage || '',
      signatureX: sigX,
      signatureY: sigY
    },
    backSide: {
      enabled: document.getElementById('designer-backside-enabled')?.checked ?? true,
      heading: document.getElementById('designer-backside-heading')?.value.trim() || 'RULES & INSTRUCTIONS',
      terms: document.getElementById('designer-backside-terms')?.value.trim() || '',
      emergencyHelpline: document.getElementById('designer-backside-helpline')?.value.trim() || '',
      returnAddress: document.getElementById('designer-backside-return')?.value.trim() || ''
    },
    updatedAt: new Date().toISOString()
  };
}

function renderDesignerLivePreview() {
  const container = document.getElementById('designer-card-preview-card');
  if (!container) return;

  const currentDesign = collectDesignerDesignFromForm();
  const showMargins = document.getElementById('designer-chk-margins')?.checked ?? true;

  // Selected sample student
  const sampleSelect = document.getElementById('designer-sample-student');
  const selectedAdm = sampleSelect?.value;
  const student = (window.designerSampleStudents || []).find(s => s.admissionNo === selectedAdm) || (window.designerSampleStudents?.[0]) || {
    name: 'Sample Student',
    admissionNo: 'SAMPLE-2026-0001',
    className: 'Class X',
    section: 'A',
    rollNo: 1,
    fatherName: 'Father Name',
    dob: '2012-05-15',
    session: '2026-2027',
    bloodGroup: 'B+',
    phone: '+91 9876543210',
    address: 'Guwahati, Assam'
  };

  const dimBadge = document.getElementById('designer-preview-dimension-badge');
  if (dimBadge) {
    dimBadge.textContent = `${currentDesign.cardSize.preset === 'CR80_LANDSCAPE' || currentDesign.cardSize.orientation === 'landscape' ? 'CR80 Landscape' : 'CR80 Portrait'} (${currentDesign.cardSize.widthMm} × ${currentDesign.cardSize.heightMm} mm)`;
  }

  const cardHtml = renderDynamicDesignedCardHTML(
    student,
    student.session || '2026-2027',
    currentDesign.signature?.principalName,
    currentDesign.signature?.principalSignatureImage,
    currentDesign,
    designerCurrentSide,
    { showMargins, previewScale: currentDesign.cardSize.orientation === 'landscape' ? 0.65 : 0.7 }
  );

  container.innerHTML = cardHtml;
}

// -------------------------------------------------------------------------
// DRAG & DROP POSITIONING ENGINE ON CANVAS
// -------------------------------------------------------------------------
let activeDrag = null;

function initDesignerDragAndDrop() {
  const stageViewport = document.getElementById('designer-stage-viewport');
  if (!stageViewport || stageViewport.dataset.dragBound) return;
  stageViewport.dataset.dragBound = 'true';

  stageViewport.addEventListener('mousedown', e => {
    const target = e.target.closest('[data-draggable]');
    if (!target) return;
    e.preventDefault();

    const elemKey = target.dataset.draggable;
    const xInputId = `designer-${elemKey === 'signature' ? 'sig' : elemKey}-x`;
    const yInputId = `designer-${elemKey === 'signature' ? 'sig' : elemKey}-y`;
    const xInput = document.getElementById(xInputId);
    const yInput = document.getElementById(yInputId);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialOffsetX = parseFloat(xInput?.value || 0);
    const initialOffsetY = parseFloat(yInput?.value || 0);
    const isL = document.getElementById('designer-card-orientation')?.value === 'landscape';
    const effScale = designerZoomLevel * (isL ? 0.65 : 0.7);

    activeDrag = {
      elemKey,
      target,
      xInput,
      yInput,
      startX,
      startY,
      initialOffsetX,
      initialOffsetY,
      scale: effScale
    };

    target.style.outline = '2px dashed #f59e0b';
    target.style.outlineOffset = '2px';
  });

  window.addEventListener('mousemove', e => {
    if (!activeDrag) return;
    const dx = (e.clientX - activeDrag.startX) / activeDrag.scale;
    const dy = (e.clientY - activeDrag.startY) / activeDrag.scale;
    const newX = Math.round(activeDrag.initialOffsetX + dx);
    const newY = Math.round(activeDrag.initialOffsetY + dy);

    if (activeDrag.xInput) activeDrag.xInput.value = newX;
    if (activeDrag.yInput) activeDrag.yInput.value = newY;

    activeDrag.target.style.transform = `translate(${newX}px, ${newY}px)`;
  });

  window.addEventListener('mouseup', () => {
    if (!activeDrag) return;
    activeDrag.target.style.outline = '';
    activeDrag.target.style.outlineOffset = '';
    activeDrag = null;

    isDesignerDirty = true;
    document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
    pushUndoState();
    renderDesignerLivePreview();
  });
}

// -------------------------------------------------------------------------
// DESIGN STUDIO CONTROLLER INITIALIZATION
// -------------------------------------------------------------------------
async function loadIdCardDesigner() {
  try {
    const res = await ApiService.getPrintCenterIdCardDesign();
    if (res && res.design) {
      window.schoolIdCardDesign = res.design;
      window.designerSampleStudents = res.sampleStudents || [];
      window.schoolIdCardPresets = res.presets || [];
      window.schoolBuiltinTemplates = res.templates || BUILTIN_ID_CARD_TEMPLATES;
      window.schoolDefaultTemplateId = res.defaultTemplateId || 'royal-blue';

      // Update preset dropdown options
      refreshPresetsDropdown();

      // Populate sample students dropdown
      const studentSelect = document.getElementById('designer-sample-student');
      if (studentSelect) {
        studentSelect.innerHTML = '';
        if (window.designerSampleStudents.length === 0) {
          studentSelect.innerHTML = '<option value="">No students in school</option>';
        } else {
          window.designerSampleStudents.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.admissionNo;
            opt.textContent = `${s.name} (${s.className || 'Class'} - ${s.admissionNo})`;
            studentSelect.appendChild(opt);
          });
        }
      }

      populateDesignerFormFromDesign(window.schoolIdCardDesign);
      isDesignerDirty = false;
      document.getElementById('designer-dirty-pill')?.classList.add('hidden');

      // Initialize undo stack
      designerUndoStack = [collectDesignerDesignFromForm()];
      designerRedoStack = [];
      updateUndoRedoButtons();

      renderDesignerLivePreview();
    }
  } catch (err) {
    console.error('Failed to load ID card designer data:', err);
    alert('Failed to load designer: ' + err.message);
  }
}

function refreshPresetsDropdown() {
  const presetSelect = document.getElementById('designer-preset-select');
  if (!presetSelect) return;

  presetSelect.innerHTML = '<option value="current">Current School Design</option>';
  (window.schoolIdCardPresets || []).forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = `preset_${idx}`;
    opt.textContent = p.name || `Preset ${idx + 1}`;
    presetSelect.appendChild(opt);
  });

  const dupBtn = document.getElementById('designer-btn-duplicate-preset');
  const renBtn = document.getElementById('designer-btn-rename-preset');
  const delBtn = document.getElementById('designer-btn-delete-preset');

  const isCustom = presetSelect.value.startsWith('preset_');
  dupBtn?.classList.toggle('hidden', !isCustom);
  renBtn?.classList.toggle('hidden', !isCustom);
  delBtn?.classList.toggle('hidden', !isCustom);
}

function initIdCardDesigner() {
  const container = document.getElementById('idcard-subview-designer');
  if (!container) return;

  // Track changes on all inputs inside designer
  const inputs = container.querySelectorAll('input, select, textarea');
  inputs.forEach(el => {
    if (el.dataset.designerBound) return;
    el.dataset.designerBound = 'true';

    const evtName = (el.type === 'color' || el.type === 'range' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? 'input' : 'change';
    el.addEventListener(evtName, () => {
      if (el.id === 'designer-template-select') {
        applyTemplateToDesigner(el.value);
        return;
      }

      if (el.id === 'designer-card-preset') {
        const val = el.value;
        const widthInp = document.getElementById('designer-card-width-mm');
        const heightInp = document.getElementById('designer-card-height-mm');
        const orientSel = document.getElementById('designer-card-orientation');
        if (val === 'CR80_PORTRAIT') {
          if (widthInp) widthInp.value = 53.98;
          if (heightInp) heightInp.value = 85.60;
          if (orientSel) orientSel.value = 'portrait';
        } else if (val === 'CR80_LANDSCAPE') {
          if (widthInp) widthInp.value = 85.60;
          if (heightInp) heightInp.value = 53.98;
          if (orientSel) orientSel.value = 'landscape';
        }
      } else if (el.id === 'designer-card-orientation') {
        const orient = el.value;
        const widthInp = document.getElementById('designer-card-width-mm');
        const heightInp = document.getElementById('designer-card-height-mm');
        const w = parseFloat(widthInp?.value || 53.98);
        const h = parseFloat(heightInp?.value || 85.60);
        if (orient === 'landscape' && w < h) {
          if (widthInp) widthInp.value = h;
          if (heightInp) heightInp.value = w;
        } else if (orient === 'portrait' && w > h) {
          if (widthInp) widthInp.value = h;
          if (heightInp) heightInp.value = w;
        }
      }

      isDesignerDirty = true;
      document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
      pushUndoState();
      renderDesignerLivePreview();
    });
  });

  // Preset selector
  const presetSel = document.getElementById('designer-preset-select');
  if (presetSel && !presetSel.dataset.designerBound) {
    presetSel.dataset.designerBound = 'true';
    presetSel.addEventListener('change', () => {
      const val = presetSel.value;
      const dupBtn = document.getElementById('designer-btn-duplicate-preset');
      const renBtn = document.getElementById('designer-btn-rename-preset');
      const delBtn = document.getElementById('designer-btn-delete-preset');

      const isCustom = val.startsWith('preset_');
      dupBtn?.classList.toggle('hidden', !isCustom);
      renBtn?.classList.toggle('hidden', !isCustom);
      delBtn?.classList.toggle('hidden', !isCustom);

      if (val === 'current') {
        populateDesignerFormFromDesign(window.schoolIdCardDesign);
      } else if (isCustom) {
        const idx = parseInt(val.replace('preset_', ''));
        const preset = window.schoolIdCardPresets?.[idx];
        if (preset?.design) {
          populateDesignerFormFromDesign(preset.design);
          isDesignerDirty = true;
          document.getElementById('designer-dirty-pill')?.classList.remove('hidden');
          pushUndoState();
        }
      }
      renderDesignerLivePreview();
    });
  }

  // Save as Preset button
  const savePresetBtn = document.getElementById('designer-btn-save-preset');
  if (savePresetBtn && !savePresetBtn.dataset.designerBound) {
    savePresetBtn.dataset.designerBound = 'true';
    savePresetBtn.addEventListener('click', async () => {
      const presetName = prompt('Enter a name for this ID Card design preset (e.g., Landscape Modern):');
      if (!presetName || !presetName.trim()) return;

      const design = collectDesignerDesignFromForm();
      try {
        savePresetBtn.disabled = true;
        savePresetBtn.textContent = 'Saving...';
        const res = await ApiService.savePrintCenterIdCardPreset(presetName.trim(), design);
        alert(`Preset "${presetName.trim()}" saved successfully!`);
        window.schoolIdCardPresets = res.presets || [];
        refreshPresetsDropdown();
        if (presetSel) presetSel.value = `preset_${window.schoolIdCardPresets.length - 1}`;
        presetSel?.dispatchEvent(new Event('change'));
      } catch (err) {
        console.error('Failed to save preset:', err);
        alert('Failed to save preset: ' + err.message);
      } finally {
        savePresetBtn.disabled = false;
        savePresetBtn.textContent = '+ Preset';
      }
    });
  }

  // Duplicate Preset button
  const dupPresetBtn = document.getElementById('designer-btn-duplicate-preset');
  if (dupPresetBtn && !dupPresetBtn.dataset.designerBound) {
    dupPresetBtn.dataset.designerBound = 'true';
    dupPresetBtn.addEventListener('click', async () => {
      const val = presetSel?.value;
      if (!val || !val.startsWith('preset_')) return;
      const idx = parseInt(val.replace('preset_', ''));
      const preset = window.schoolIdCardPresets?.[idx];
      if (!preset?.id) return;

      const newName = prompt('Enter duplicate preset name:', `${preset.name} (Copy)`);
      if (!newName || !newName.trim()) return;

      try {
        dupPresetBtn.disabled = true;
        const res = await ApiService.duplicatePrintCenterIdCardPreset(preset.id, newName.trim());
        alert('Preset duplicated successfully!');
        window.schoolIdCardPresets = res.presets || [];
        refreshPresetsDropdown();
        if (presetSel) presetSel.value = `preset_${window.schoolIdCardPresets.length - 1}`;
        presetSel?.dispatchEvent(new Event('change'));
      } catch (err) {
        console.error('Failed to duplicate preset:', err);
        alert('Failed to duplicate: ' + err.message);
      } finally {
        dupPresetBtn.disabled = false;
      }
    });
  }

  // Rename Preset button
  const renPresetBtn = document.getElementById('designer-btn-rename-preset');
  if (renPresetBtn && !renPresetBtn.dataset.designerBound) {
    renPresetBtn.dataset.designerBound = 'true';
    renPresetBtn.addEventListener('click', async () => {
      const val = presetSel?.value;
      if (!val || !val.startsWith('preset_')) return;
      const idx = parseInt(val.replace('preset_', ''));
      const preset = window.schoolIdCardPresets?.[idx];
      if (!preset?.id) return;

      const newName = prompt('Enter new preset name:', preset.name);
      if (!newName || !newName.trim() || newName.trim() === preset.name) return;

      try {
        renPresetBtn.disabled = true;
        const res = await ApiService.updatePrintCenterIdCardPreset(preset.id, { name: newName.trim() });
        alert('Preset renamed successfully!');
        window.schoolIdCardPresets = res.presets || [];
        refreshPresetsDropdown();
        if (presetSel) presetSel.value = val;
      } catch (err) {
        console.error('Failed to rename preset:', err);
        alert('Failed to rename: ' + err.message);
      } finally {
        renPresetBtn.disabled = false;
      }
    });
  }

  // Delete Preset button
  const delPresetBtn = document.getElementById('designer-btn-delete-preset');
  if (delPresetBtn && !delPresetBtn.dataset.designerBound) {
    delPresetBtn.dataset.designerBound = 'true';
    delPresetBtn.addEventListener('click', async () => {
      const val = presetSel?.value;
      if (!val || !val.startsWith('preset_')) return;
      const idx = parseInt(val.replace('preset_', ''));
      const preset = window.schoolIdCardPresets?.[idx];
      if (!preset?.id) return;

      if (!confirm(`Are you sure you want to delete preset "${preset.name}"? This action cannot be undone.`)) return;

      try {
        delPresetBtn.disabled = true;
        const res = await ApiService.deletePrintCenterIdCardPreset(preset.id);
        alert('Preset deleted successfully.');
        window.schoolIdCardPresets = res.presets || [];
        refreshPresetsDropdown();
        if (presetSel) presetSel.value = 'current';
        presetSel?.dispatchEvent(new Event('change'));
      } catch (err) {
        console.error('Failed to delete preset:', err);
        alert('Failed to delete: ' + err.message);
      } finally {
        delPresetBtn.disabled = false;
      }
    });
  }

  // Set Default Template button
  const setDefaultBtn = document.getElementById('designer-btn-set-default');
  if (setDefaultBtn && !setDefaultBtn.dataset.designerBound) {
    setDefaultBtn.dataset.designerBound = 'true';
    setDefaultBtn.addEventListener('click', async () => {
      const tId = document.getElementById('designer-template-select')?.value || 'royal-blue';
      const confirmed = confirm(`Set template "${tId}" as the default starting design for this school?`);
      if (!confirmed) return;

      try {
        setDefaultBtn.disabled = true;
        await ApiService.setDefaultPrintCenterIdCardTemplate(tId);
        window.schoolDefaultTemplateId = tId;
        if (window.currentSchool) window.currentSchool.defaultTemplateId = tId;
        alert(`Default template updated to "${tId}" for ${window.currentSchool?.name || 'this school'}!`);
      } catch (err) {
        console.error('Failed to set default template:', err);
        alert('Failed to set default: ' + err.message);
      } finally {
        setDefaultBtn.disabled = false;
      }
    });
  }

  // Reset to default button
  const resetBtn = document.getElementById('designer-btn-reset');
  if (resetBtn && !resetBtn.dataset.designerBound) {
    resetBtn.dataset.designerBound = 'true';
    resetBtn.addEventListener('click', async () => {
      const tId = document.getElementById('designer-template-select')?.value;
      if (!confirm('Are you sure you want to reset this school ID card design to the default template? All unsaved and custom styles will be restored to defaults.')) {
        return;
      }
      try {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetting...';
        const res = await ApiService.resetPrintCenterIdCardDesign(tId);
        window.schoolIdCardDesign = res.design;
        populateDesignerFormFromDesign(res.design);
        isDesignerDirty = false;
        document.getElementById('designer-dirty-pill')?.classList.add('hidden');
        pushUndoState();
        renderDesignerLivePreview();
        alert('ID Card design has been reset to default template.');
      } catch (err) {
        console.error('Failed to reset design:', err);
        alert('Failed to reset: ' + err.message);
      } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = '↩️ Reset';
      }
    });
  }

  // Reset Offsets button
  const resetOffsetsBtn = document.getElementById('designer-btn-reset-offsets');
  if (resetOffsetsBtn && !resetOffsetsBtn.dataset.designerBound) {
    resetOffsetsBtn.dataset.designerBound = 'true';
    resetOffsetsBtn.addEventListener('click', () => {
      resetDesignerOffsets();
    });
  }

  // Undo button
  const undoBtn = document.getElementById('designer-btn-undo');
  if (undoBtn && !undoBtn.dataset.designerBound) {
    undoBtn.dataset.designerBound = 'true';
    undoBtn.addEventListener('click', () => undoDesigner());
  }

  // Redo button
  const redoBtn = document.getElementById('designer-btn-redo');
  if (redoBtn && !redoBtn.dataset.designerBound) {
    redoBtn.dataset.designerBound = 'true';
    redoBtn.addEventListener('click', () => redoDesigner());
  }

  // Save Design button
  const saveBtn = document.getElementById('designer-btn-save');
  if (saveBtn && !saveBtn.dataset.designerBound) {
    saveBtn.dataset.designerBound = 'true';
    saveBtn.addEventListener('click', async () => {
      const design = collectDesignerDesignFromForm();
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        const res = await ApiService.savePrintCenterIdCardDesign(design);
        window.schoolIdCardDesign = res.design || design;
        isDesignerDirty = false;
        document.getElementById('designer-dirty-pill')?.classList.add('hidden');
        alert('ID Card design saved successfully!');
        renderDesignerLivePreview();
        updateBatchViewBanner();
      } catch (err) {
        console.error('Failed to save design:', err);
        alert('Failed to save: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Design';
      }
    });
  }

  // Test Print button
  const testPrintBtn = document.getElementById('designer-btn-test-print');
  if (testPrintBtn && !testPrintBtn.dataset.designerBound) {
    testPrintBtn.dataset.designerBound = 'true';
    testPrintBtn.addEventListener('click', async () => {
      const previewCard = document.querySelector('#designer-card-preview-card .gjv-id-v5');
      if (!previewCard) return alert('No card visible to print.');
      exportStudentIdCards({ format: 'print', button: testPrintBtn });
    });
  }

  // Download Preview PNG button
  const dlPngBtn = document.getElementById('designer-btn-download-preview-png');
  if (dlPngBtn && !dlPngBtn.dataset.designerBound) {
    dlPngBtn.dataset.designerBound = 'true';
    dlPngBtn.addEventListener('click', async () => {
      const card = document.querySelector('#designer-card-preview-card .gjv-id-v5');
      if (!card) return alert('Preview card is unavailable.');
      try {
        dlPngBtn.disabled = true;
        dlPngBtn.textContent = 'Generating...';
        const canvas = await renderIdCardCanvas(card);
        const blob = await idCardCanvasToBlob(canvas);
        const fileName = `id-card-${idCardSafeFileName(card.dataset.admissionNo || 'sample')}-${designerCurrentSide}.png`;
        downloadIdCardBlob(blob, fileName);
      } catch (err) {
        console.error('Failed to generate PNG:', err);
        alert('Failed to download PNG: ' + err.message);
      } finally {
        dlPngBtn.disabled = false;
        dlPngBtn.textContent = '📥 PNG';
      }
    });
  }

  // Safe Margin Checkbox
  const marginChk = document.getElementById('designer-chk-margins');
  if (marginChk && !marginChk.dataset.designerBound) {
    marginChk.dataset.designerBound = 'true';
    marginChk.addEventListener('change', () => {
      renderDesignerLivePreview();
    });
  }

  // Sample Student Selector
  const sampleStudentSel = document.getElementById('designer-sample-student');
  if (sampleStudentSel && !sampleStudentSel.dataset.designerBound) {
    sampleStudentSel.dataset.designerBound = 'true';
    sampleStudentSel.addEventListener('change', () => {
      renderDesignerLivePreview();
    });
  }

  // Side buttons
  const frontBtn = document.getElementById('designer-btn-side-front');
  if (frontBtn && !frontBtn.dataset.designerBound) {
    frontBtn.dataset.designerBound = 'true';
    frontBtn.addEventListener('click', () => setDesignerSide('front'));
  }

  const backBtn = document.getElementById('designer-btn-side-back');
  if (backBtn && !backBtn.dataset.designerBound) {
    backBtn.dataset.designerBound = 'true';
    backBtn.addEventListener('click', () => setDesignerSide('back'));
  }

  // Drag and drop initializer
  initDesignerDragAndDrop();

  // Keyboard shortcut listener for Undo/Redo inside designer
  window.addEventListener('keydown', e => {
    if (!document.getElementById('idcard-subview-designer')?.classList.contains('hidden')) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoDesigner();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redoDesigner();
      }
    }
  });

  // Prevent accidental loss of unsaved changes
  window.addEventListener('beforeunload', event => {
    if (isDesignerDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

// Automatically bind Designer on script execution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initIdCardDesigner(), { once: true });
} else {
  initIdCardDesigner();
}


// =========================================================================
// TEACHER MANAGEMENT MODULE CONTROLLER
// =========================================================================

let teacherState = {
  activeSubtab: 'directory',
  teachers: [],
  selectedTeacherForPortal: null,
  currentAttendanceDate: new Date().toISOString().split('T')[0]
};

// Bind subtab button clicks
function bindTeacherSubtabs() {
  const subtabs = ['directory', 'add', 'assignments', 'attendance', 'leaves', 'salaries', 'reports', 'portal'];
  subtabs.forEach(sub => {
    const btn = document.getElementById(`tch-subtab-btn-${sub}`);
    if (btn) {
      btn.onclick = () => switchTeacherSubtab(sub);
    }
  });
}

function switchTeacherSubtab(targetSub) {
  teacherState.activeSubtab = targetSub;
  const subtabs = ['directory', 'add', 'assignments', 'attendance', 'leaves', 'salaries', 'reports', 'portal'];
  
  subtabs.forEach(sub => {
    const btn = document.getElementById(`tch-subtab-btn-${sub}`);
    const el = document.getElementById(`tch-subtab-${sub}`);
    if (btn && el) {
      if (sub === targetSub) {
        btn.classList.add('border-amber-500', 'text-slate-900', 'dark:text-white', 'font-extrabold');
        btn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        el.classList.remove('hidden');
      } else {
        btn.classList.remove('border-amber-500', 'text-slate-900', 'dark:text-white', 'font-extrabold');
        btn.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        el.classList.add('hidden');
      }
    }
  });

  if (targetSub === 'directory') loadTeacherDirectory();
  else if (targetSub === 'add') setupAddTeacherForm();
  else if (targetSub === 'assignments') loadTeacherAssignments();
  else if (targetSub === 'attendance') loadTeacherAttendance();
  else if (targetSub === 'leaves') loadTeacherLeaves();
  else if (targetSub === 'salaries') loadTeacherSalaries();
  else if (targetSub === 'reports') loadTeacherReports();
  else if (targetSub === 'portal') loadTeacherPortalView();
}

async function loadTeachersTab() {
  bindTeacherSubtabs();
  await loadTeacherStats();
  await loadTeacherDirectory();
  populateTeacherDropdowns();
}

async function loadTeacherStats() {
  try {
    const stats = await ApiService.getTeacherStats();
    const t = document.getElementById('tch-stat-total');
    const a = document.getElementById('tch-stat-active');
    const p = document.getElementById('tch-stat-present');
    const ab = document.getElementById('tch-stat-absent');
    const l = document.getElementById('tch-stat-leave');
    const pl = document.getElementById('tch-stat-pending-leave');
    const s = document.getElementById('tch-stat-salary-expense');

    if (t) t.innerText = stats.totalTeachers || 0;
    if (a) a.innerText = stats.activeTeachers || 0;
    if (p) p.innerText = stats.presentToday || 0;
    if (ab) ab.innerText = stats.absentToday || 0;
    if (l) l.innerText = stats.onLeave || 0;
    if (pl) pl.innerText = stats.pendingLeaveRequests || 0;
    if (s) s.innerText = `₹${Number(stats.monthlySalaryExpense || 0).toLocaleString('en-IN')}`;
  } catch (err) {
    console.error('Error loading teacher stats:', err);
  }
}

function teacherDirectoryIcon(name, size = 17) {
  const paths = {
    view: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    login: '<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8-8M18 5l1 1M15 8l1 1"/>',
    permissions: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    salary: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10h.01M18 14h.01"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.8-2 5.2-2 6 0M14 10h4M14 14h4"/>',
    delete: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
    teacher: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  return `<svg aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none">${paths[name] || ''}</svg>`;
}
async function loadTeacherDirectory() {
  const tbody = document.getElementById('tch-directory-tbody');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-slate-400">Loading teacher directory...</td></tr>';
    const teachers = await ApiService.getTeachers();
    teacherState.teachers = teachers;

    const query = (document.getElementById('tch-dir-search')?.value || '').toLowerCase();
    const subjFilter = document.getElementById('tch-dir-filter-subject')?.value || '';
    const classFilter = document.getElementById('tch-dir-filter-class')?.value || '';
    const typeFilter = document.getElementById('tch-dir-filter-type')?.value || '';
    const statusFilter = document.getElementById('tch-dir-filter-status')?.value || '';

    let filtered = teachers.filter(t => {
      if (t.status === 'Deleted') return false;

      const matchQuery = !query || 
        (t.name || '').toLowerCase().includes(query) || 
        (t.empId || '').toLowerCase().includes(query) || 
        (t.mobile || '').includes(query);
      
      const matchSubj = !subjFilter || (t.subject || '').toLowerCase() === subjFilter.toLowerCase();
      const matchClass = !classFilter || (t.classTeacher || '').toLowerCase().includes(classFilter.toLowerCase());
      const matchType = !typeFilter || (t.employmentType || 'Permanent').toLowerCase() === typeFilter.toLowerCase();
      const matchStatus = !statusFilter || (t.status || 'Active').toLowerCase() === statusFilter.toLowerCase();

      return matchQuery && matchSubj && matchClass && matchType && matchStatus;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-10 text-slate-400">No matching active teacher records found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(t => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors" data-teacher-id="${t.empId}">
        <td class="px-5 py-3.5">
          ${t.photo ? `<img src="${t.photo}" class="w-10 h-10 rounded-full object-cover border border-amber-500/20">` : `<div class="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold text-base">${teacherDirectoryIcon('teacher', 20)}</div>`}
        </td>
        <td class="px-5 py-3.5 font-mono font-bold text-amber-500">${t.empId}</td>
        <td class="px-5 py-3.5">
          <span class="font-bold text-slate-900 dark:text-white block">${t.name}</span>
          <span class="text-[10px] text-slate-400 font-medium">${t.designation || (t.subject + ' Teacher')}</span>
        </td>
        <td class="px-5 py-3.5 font-medium">${t.subject || 'General'}</td>
        <td class="px-5 py-3.5">${t.classTeacher !== 'None' ? `<span class="bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-xl text-[10px] font-bold">${t.classTeacher}</span>` : '<span class="text-slate-400">-</span>'}</td>
        <td class="px-5 py-3.5 font-medium text-[11px]">${t.qualification}</td>
        <td class="px-5 py-3.5 font-mono text-[11px]">${t.mobile}</td>
        <td class="px-5 py-3.5 font-mono font-bold text-emerald-500">&#8377;${Number(t.salary || 25000).toLocaleString('en-IN')}</td>
        <td class="px-5 py-3.5">
          <span class="px-2 py-0.5 rounded-xl text-[10px] font-bold ${t.status === 'On Leave' ? 'bg-amber-500/10 text-amber-500' : (t.status === 'Inactive' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500')}">
            ${t.status || 'Active'}
          </span>
        </td>
        <td class="px-5 py-3.5 text-right no-print">
          <div class="flex items-center justify-end space-x-1">
            <button onclick="window.openTeacherProfileModal('${t.empId}')" data-teacher-id="${t.empId}" data-action="view-profile" class="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors" title="View Teacher Profile" aria-label="View Teacher Profile">${teacherDirectoryIcon('view')}</button>
            <button onclick="window.openTeacherLoginModal('${t.empId}')" data-teacher-id="${t.empId}" data-action="manage-login" class="p-1.5 hover:bg-purple-500/10 rounded-lg text-purple-500 transition-colors" title="Manage Login Control" aria-label="Manage Login Control">${teacherDirectoryIcon('login')}</button>
            <button onclick="window.openTeacherPermissionsModal('${t.empId}')" data-teacher-id="${t.empId}" data-action="manage-permissions" class="p-1.5 hover:bg-amber-500/10 rounded-lg text-amber-500 transition-colors" title="Manage Permissions" aria-label="Manage Permissions">${teacherDirectoryIcon('permissions')}</button>
            <button onclick="window.openTeacherSalaryModal('${t.empId}')" data-teacher-id="${t.empId}" data-action="salary-details" class="p-1.5 hover:bg-emerald-500/10 rounded-lg text-emerald-500 transition-colors" title="Salary Details & Payroll" aria-label="Salary Details and Payroll">${teacherDirectoryIcon('salary')}</button>
            <button onclick="window.editTeacherModal('${t.empId}')" data-teacher-id="${t.empId}" data-action="edit-teacher" class="p-1.5 hover:bg-blue-500/10 rounded-lg text-blue-500 transition-colors" title="Edit Teacher Profile" aria-label="Edit Teacher Profile">${teacherDirectoryIcon('edit')}</button>
            <button onclick="window.generateTeacherIdCard('${t.empId}')" data-teacher-id="${t.empId}" data-action="id-card" class="p-1.5 hover:bg-amber-500/10 rounded-lg text-amber-500 transition-colors" title="Generate / Download Teacher ID Card" aria-label="Generate or Download Teacher ID Card">${teacherDirectoryIcon('card')}</button>
            <button onclick="window.openDeleteTeacherModal('${t.empId}')" data-teacher-id="${t.empId}" data-action="delete-teacher" class="p-1.5 hover:bg-red-500/10 rounded-lg text-red-500 transition-colors" title="Delete Teacher Record" aria-label="Delete Teacher Record">${teacherDirectoryIcon('delete')}</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading teacher directory:', err);
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-red-500">Failed to load teacher directory.</td></tr>';
  }
}

// Bind search and filters
document.getElementById('tch-dir-search')?.addEventListener('input', loadTeacherDirectory);
document.getElementById('tch-dir-filter-subject')?.addEventListener('change', loadTeacherDirectory);
document.getElementById('tch-dir-filter-class')?.addEventListener('change', loadTeacherDirectory);

function setupAddTeacherForm() {
  const yearStr = new Date().getFullYear();
  let maxSeq = 0;
  (teacherState.teachers || []).forEach(t => {
    const match = (t.empId || '').match(/TCH-\d{4}-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxSeq) maxSeq = num;
    }
  });
  const nextNum = (maxSeq + 1).toString().padStart(4, '0');
  const preview = document.getElementById('tch-empid-preview');
  if (preview) preview.innerText = `TCH-${yearStr}-${nextNum}`;
}

// Photo file upload handler
const photoFileInput = document.getElementById('tch-photo-file');
if (photoFileInput) {
  photoFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const preview = document.getElementById('tch-photo-preview');
        const placeholder = document.getElementById('tch-photo-placeholder');
        if (preview && placeholder) {
          preview.src = evt.target.result;
          preview.classList.remove('hidden');
          placeholder.classList.add('hidden');
        }
      };
      reader.readAsDataURL(file);
    }
  };
}

// Submit New Teacher Form
const newTeacherForm = document.getElementById('new-teacher-form');
if (newTeacherForm) {
  newTeacherForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = newTeacherForm.querySelector('button[type="submit"]');
    const originalText = btn.innerText;

    const pwd = document.getElementById('tch-add-password')?.value || '';
    const confirmPwd = document.getElementById('tch-add-confirm-pwd')?.value || '';

    if (pwd && confirmPwd && pwd !== confirmPwd) {
      alert('❌ Temporary Password and Confirm Password do not match!');
      return;
    }

    try {
      btn.disabled = true;
      btn.innerText = 'Registering & Creating Account...';

      const photoPreview = document.getElementById('tch-photo-preview');
      const photoData = photoPreview && !photoPreview.classList.contains('hidden') ? photoPreview.src : '';

      const payload = {
        name: document.getElementById('tch-name').value,
        photo: photoData,
        gender: document.getElementById('tch-gender').value,
        dob: document.getElementById('tch-dob').value,
        mobile: document.getElementById('tch-mobile').value,
        email: document.getElementById('tch-email').value,
        aadhaar: document.getElementById('tch-aadhaar').value,
        qualification: document.getElementById('tch-qualification').value,
        experience: document.getElementById('tch-experience').value,
        subject: document.getElementById('tch-subject').value,
        classTeacher: document.getElementById('tch-classteacher').value,
        joiningDate: document.getElementById('tch-joiningdate').value,
        salary: Number(document.getElementById('tch-salary').value || 25000),
        address: document.getElementById('tch-address').value,
        emergencyContact: document.getElementById('tch-emergency').value,
        bankDetails: {
          bankName: document.getElementById('tch-bank-name').value,
          accountNo: document.getElementById('tch-bank-account').value,
          ifsc: document.getElementById('tch-bank-ifsc').value
        },
        loginUsername: document.getElementById('tch-add-username')?.value || '',
        loginPassword: pwd,
        loginStatus: document.getElementById('tch-add-login-status')?.value || 'Active',
        forcePasswordChange: document.getElementById('tch-add-force-change')?.value === 'true',
        sendChannel: document.getElementById('tch-add-send-channel')?.value || 'Email & SMS'
      };

      const result = await ApiService.createTeacher(payload);
      
      newTeacherForm.reset();
      const preview = document.getElementById('tch-photo-preview');
      const placeholder = document.getElementById('tch-photo-placeholder');
      if (preview && placeholder) {
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }

      // Show Registration Success Modal
      const acc = result.loginAccount || {};
      const nameEl = document.getElementById('tch-reg-res-name');
      const empIdEl = document.getElementById('tch-reg-res-empid');
      const userEl = document.getElementById('tch-reg-res-user');
      const passEl = document.getElementById('tch-reg-res-pass');
      const statusEl = document.getElementById('tch-reg-res-status');

      if (nameEl) nameEl.innerText = acc.name || result.name || '-';
      if (empIdEl) empIdEl.innerText = acc.empId || result.empId || '-';
      if (userEl) userEl.innerText = acc.username || '-';
      if (passEl) passEl.innerText = acc.tempPassword || '-';
      if (statusEl) statusEl.innerText = acc.loginStatus || 'Active';

      const successModal = document.getElementById('tch-reg-success-modal');
      if (successModal) successModal.classList.remove('hidden');

      await loadTeacherStats();
      await loadTeacherDirectory();
    } catch (err) {
      alert('❌ Registration Failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerText = originalText;
    }
  };
}

// Modal actions for Registration Success
document.getElementById('tch-reg-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-reg-success-modal')?.classList.add('hidden');
});

document.getElementById('tch-reg-copy-user')?.addEventListener('click', () => {
  const user = document.getElementById('tch-reg-res-user')?.innerText;
  if (user) {
    navigator.clipboard.writeText(user);
    alert('📋 Username copied to clipboard: ' + user);
  }
});

document.getElementById('tch-reg-copy-pass')?.addEventListener('click', () => {
  const pass = document.getElementById('tch-reg-res-pass')?.innerText;
  if (pass) {
    navigator.clipboard.writeText(pass);
    alert('🔑 Password copied to clipboard: ' + pass);
  }
});

document.getElementById('tch-reg-print-btn')?.addEventListener('click', () => {
  const name = document.getElementById('tch-reg-res-name')?.innerText;
  const empId = document.getElementById('tch-reg-res-empid')?.innerText;
  const user = document.getElementById('tch-reg-res-user')?.innerText;
  const pass = document.getElementById('tch-reg-res-pass')?.innerText;

  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head><title>Garumara Jatiya Vidyalaya - Teacher Login Credentials</title></head>
      <body onload="window.print()" style="font-family: Arial, sans-serif; padding: 30px;">
        <h2>GARUMARA JATIYA VIDYALAYA</h2>
        <h3>FACULTY LOGIN CREDENTIALS</h3>
        <hr>
        <p><strong>Teacher Name:</strong> ${name}</p>
        <p><strong>Teacher ID:</strong> ${empId}</p>
        <p><strong>Portal Login URL:</strong> ${window.location.origin}/teacher-login</p>
        <p><strong>Username:</strong> ${user}</p>
        <p><strong>Temporary Password:</strong> ${pass}</p>
        <p><em>Note: Please change your temporary password upon first login.</em></p>
      </body>
    </html>
  `);
  win.document.close();
});

document.getElementById('tch-reg-send-btn')?.addEventListener('click', () => {
  const name = document.getElementById('tch-reg-res-name')?.innerText;
  const user = document.getElementById('tch-reg-res-user')?.innerText;
  const pass = document.getElementById('tch-reg-res-pass')?.innerText;
  alert(`📲 CREDENTIALS SENT\n\nLogin credentials dispatched to ${name}.\nUsername: ${user}\nPassword: ${pass}`);
});

// Edit Teacher Modal
window.editTeacherModal = async function(empId) {
  let teacher = (teacherState.teachers || []).find(t => t.empId === empId || t.id === empId);
  if (!teacher) {
    try {
      const teachers = await ApiService.getTeachers();
      teacherState.teachers = teachers;
      teacher = teachers.find(t => t.empId === empId || t.id === empId);
    } catch (err) {
      console.error('Error fetching teachers:', err);
    }
  }
  if (!teacher) {
    alert('Teacher record not found.');
    return;
  }

  document.getElementById('tch-edit-empid').value = teacher.empId;
  document.getElementById('tch-edit-name').value = teacher.name || '';
  document.getElementById('tch-edit-subject').value = teacher.subject || '';
  document.getElementById('tch-edit-class').value = teacher.classTeacher || 'None';
  document.getElementById('tch-edit-mobile').value = teacher.mobile || '';
  document.getElementById('tch-edit-email').value = teacher.email || '';
  document.getElementById('tch-edit-salary').value = teacher.salary || 25000;
  document.getElementById('tch-edit-qualification').value = teacher.qualification || '';
  document.getElementById('tch-edit-status').value = teacher.status || 'Active';

  const userInp = document.getElementById('tch-edit-username');
  if (userInp) userInp.value = teacher.loginUsername || teacher.empId;

  const pwdInp = document.getElementById('tch-edit-password');
  if (pwdInp) pwdInp.value = '';

  const lastSeen = document.getElementById('tch-login-lastseen');
  if (lastSeen) {
    lastSeen.innerText = teacher.lastLogin ? `Last Login: ${new Date(teacher.lastLogin).toLocaleString('en-IN')}` : 'Last Login: Never';
  }

  const modal = document.getElementById('tch-edit-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
};

document.getElementById('tch-btn-save-login')?.addEventListener('click', async () => {
  const empId = document.getElementById('tch-edit-empid').value;
  const username = document.getElementById('tch-edit-username').value.trim();
  const password = document.getElementById('tch-edit-password').value.trim();
  const status = document.getElementById('tch-edit-status').value;

  if (!username || !password) return alert('Username and Password are required.');

  try {
    const res = await ApiService.authenticatedFetch('/api/admin/teachers/create-login', {
      method: 'POST',
      body: JSON.stringify({ empId, username, password, status })
    });
    alert('✅ Teacher login credentials updated successfully!');
  } catch (err) {
    alert('Failed to save login credentials: ' + err.message);
  }
});

document.getElementById('tch-btn-toggle-login-status')?.addEventListener('click', async () => {
  const empId = document.getElementById('tch-edit-empid').value;
  const curStatus = document.getElementById('tch-edit-status').value;
  const newStatus = curStatus === 'Active' ? 'Inactive' : 'Active';

  try {
    await ApiService.authenticatedFetch('/api/admin/teachers/login-control', {
      method: 'POST',
      body: JSON.stringify({ empId, action: 'update_status', status: newStatus })
    });
    document.getElementById('tch-edit-status').value = newStatus;
    alert(`✅ Teacher account status set to ${newStatus}`);
    await loadTeacherStats();
    await loadTeacherDirectory();
  } catch (err) {
    alert('Failed to toggle login status: ' + err.message);
  }
});

document.getElementById('tch-btn-send-credentials')?.addEventListener('click', () => {
  const empId = document.getElementById('tch-edit-empid').value;
  const name = document.getElementById('tch-edit-name').value;
  const username = document.getElementById('tch-edit-username').value;
  const password = document.getElementById('tch-edit-password').value;
  const mobile = document.getElementById('tch-edit-mobile').value;

  alert(`📲 LOGIN CREDENTIALS SENT\n\nRecipient: ${name} (${empId})\nMobile: ${mobile}\nPortal URL: ${window.location.origin}/teacher-login\nUsername: ${username}\nPassword: ${password}`);
});

// =========================================================================
// TEACHER PERMISSION CONTROL & ACTIVITY LOG CONTROLLER
// =========================================================================

const PERMISSION_LABELS = {
  view_own_profile: '👤 View Own Profile',
  edit_own_profile: '✏️ Edit Own Profile',
  view_assigned_classes: '🏫 View Assigned Classes',
  view_assigned_subjects: '📊 View Assigned Subjects',
  mark_student_attendance: '📋 Mark Student Attendance',
  edit_student_attendance: '📝 Edit Student Attendance',
  enter_exam_marks: '✍️ Enter Exam Marks',
  edit_exam_marks: '📑 Edit Exam Marks',
  view_timetable: '📅 View Timetable',
  apply_for_leave: '🏖️ Apply for Leave',
  view_own_attendance: '📜 View Own Attendance',
  view_own_salary_slip: '💵 View Own Salary Slip',
  download_salary_slip: '📥 Download Salary Slip',
  view_notices: '📢 View Notices',
  upload_homework: '📤 Upload Homework',
  view_student_list: '👥 View Student List',
  print_student_reports: '🖨️ Print Student Reports'
};

const PERMISSION_PRESETS = {
  'Class Teacher': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: true, edit_student_attendance: true, enter_exam_marks: true, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: true, view_student_list: true, print_student_reports: true
  },
  'Subject Teacher': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: false, edit_student_attendance: false, enter_exam_marks: true, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: true, view_student_list: true, print_student_reports: false
  },
  'Exam In-charge': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: false, edit_student_attendance: false, enter_exam_marks: true, edit_exam_marks: true,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: false, view_student_list: true, print_student_reports: true
  },
  'Attendance In-charge': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: true,
    mark_student_attendance: true, edit_student_attendance: true, enter_exam_marks: false, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: false, view_student_list: true, print_student_reports: false
  },
  'Office Teacher': {
    view_own_profile: true, edit_own_profile: true, view_assigned_classes: true, view_assigned_subjects: false,
    mark_student_attendance: false, edit_student_attendance: false, enter_exam_marks: false, edit_exam_marks: false,
    view_timetable: true, apply_for_leave: true, view_own_attendance: true, view_own_salary_slip: true,
    download_salary_slip: true, view_notices: true, upload_homework: false, view_student_list: true, print_student_reports: true
  }
};

let activePermissionEmpId = null;
let currentTeacherPermissions = {};

window.openTeacherPermissionsModal = async function(empId) {
  activePermissionEmpId = empId;
  const teacher = (teacherState.teachers || []).find(t => t.empId === empId || t.id === empId);
  const subtitle = document.getElementById('tch-perm-subtitle');
  if (subtitle && teacher) {
    subtitle.innerText = `Configure granular permissions for ${teacher.name} (${empId})`;
  }

  try {
    const res = await ApiService.authenticatedFetch(`/api/admin/teachers/permissions?empId=${empId}`);
    currentTeacherPermissions = res.permissions || {};
    renderPermissionToggles(currentTeacherPermissions);

    const modal = document.getElementById('tch-permissions-modal');
    if (modal) modal.classList.remove('hidden');
  } catch (err) {
    alert('Failed to load permissions: ' + err.message);
  }
};

function renderPermissionToggles(perms) {
  const grid = document.getElementById('tch-perm-toggles-grid');
  if (!grid) return;

  grid.innerHTML = Object.keys(PERMISSION_LABELS).map(key => {
    const checked = perms[key] !== false;
    return `
      <div class="flex items-center justify-between p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
        <span class="text-slate-800 dark:text-slate-200 text-xs font-bold">${PERMISSION_LABELS[key]}</span>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" data-perm-key="${key}" class="sr-only peer tch-perm-checkbox" ${checked ? 'checked' : ''}>
          <div class="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
        </label>
      </div>
    `;
  }).join('');
}

// Preset Buttons Event Handlers
document.querySelectorAll('.tch-perm-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.getAttribute('data-preset');
    if (preset && PERMISSION_PRESETS[preset]) {
      currentTeacherPermissions = { ...PERMISSION_PRESETS[preset] };
      renderPermissionToggles(currentTeacherPermissions);
    }
  });
});

document.getElementById('tch-perm-select-all')?.addEventListener('click', () => {
  Object.keys(PERMISSION_LABELS).forEach(k => currentTeacherPermissions[k] = true);
  renderPermissionToggles(currentTeacherPermissions);
});

document.getElementById('tch-perm-deselect-all')?.addEventListener('click', () => {
  Object.keys(PERMISSION_LABELS).forEach(k => currentTeacherPermissions[k] = false);
  renderPermissionToggles(currentTeacherPermissions);
});

document.getElementById('tch-perm-reset-btn')?.addEventListener('click', () => {
  Object.keys(PERMISSION_LABELS).forEach(k => currentTeacherPermissions[k] = true);
  renderPermissionToggles(currentTeacherPermissions);
});

document.getElementById('tch-perm-save-btn')?.addEventListener('click', async () => {
  if (!activePermissionEmpId) return;

  const toggles = document.querySelectorAll('.tch-perm-checkbox');
  toggles.forEach(t => {
    const key = t.getAttribute('data-perm-key');
    if (key) currentTeacherPermissions[key] = t.checked;
  });

  try {
    await ApiService.authenticatedFetch('/api/admin/teachers/permissions', {
      method: 'POST',
      body: JSON.stringify({ empId: activePermissionEmpId, permissions: currentTeacherPermissions })
    });
    alert('✅ Teacher permissions saved successfully!');
    document.getElementById('tch-permissions-modal')?.classList.add('hidden');
  } catch (err) {
    alert('Failed to save permissions: ' + err.message);
  }
});

document.getElementById('tch-perm-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-permissions-modal')?.classList.add('hidden');
});
document.getElementById('tch-perm-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('tch-permissions-modal')?.classList.add('hidden');
});

// Teacher Activity Log Modal Handler
window.openTeacherActivityLogsModal = async function(empId) {
  const teacher = (teacherState.teachers || []).find(t => t.empId === empId || t.id === empId);
  const subtitle = document.getElementById('tch-act-subtitle');
  if (subtitle && teacher) {
    subtitle.innerText = `Audit & activity history for ${teacher.name} (${empId})`;
  }

  const tbody = document.getElementById('tch-act-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-slate-400">Loading activity logs...</td></tr>';

  const modal = document.getElementById('tch-activity-modal');
  if (modal) modal.classList.remove('hidden');

  try {
    const logs = await ApiService.authenticatedFetch(`/api/admin/teachers/activity-logs?empId=${empId}`);
    if (!logs.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-slate-400">No activity recorded for this teacher.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = logs.map(l => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
          <td class="px-4 py-2.5 font-mono text-[11px] text-slate-400">${new Date(l.timestamp).toLocaleString('en-IN')}</td>
          <td class="px-4 py-2.5">
            <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${l.action.includes('FAILED') ? 'bg-red-500/10 text-red-500' : (l.action.includes('SUCCESS') ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500')}">
              ${l.action}
            </span>
          </td>
          <td class="px-4 py-2.5 text-slate-800 dark:text-slate-200">${l.description || '-'}</td>
          <td class="px-4 py-2.5 font-mono text-[10px] text-slate-400">${l.ip || '127.0.0.1'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-red-500">Failed to load activity logs.</td></tr>';
  }
};

document.getElementById('tch-act-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-activity-modal')?.classList.add('hidden');
});
document.getElementById('tch-act-close-btn')?.addEventListener('click', () => {
  document.getElementById('tch-activity-modal')?.classList.add('hidden');
});

// =========================================================================
// 1. VIEW TEACHER PROFILE MODAL CONTROLLER
// =========================================================================
window.openTeacherProfileModal = async function(empId) {
  const modal = document.getElementById('tch-profile-modal');
  if (modal) modal.classList.remove('hidden');

  try {
    const data = await ApiService.authenticatedFetch(`/api/teachers/${empId}`);
    
    document.getElementById('tch-view-name').innerText = data.name || 'Teacher Profile';
    document.getElementById('tch-view-empid').innerText = data.empId || empId;
    document.getElementById('tch-view-designation').innerText = data.designation || (data.subject ? `${data.subject} Teacher` : 'Faculty');
    document.getElementById('tch-view-subject').innerText = data.subject || 'General';
    document.getElementById('tch-view-class').innerText = data.classTeacher || 'None';
    document.getElementById('tch-view-mobile').innerText = data.mobile || 'N/A';
    document.getElementById('tch-view-email').innerText = data.email || 'N/A';
    document.getElementById('tch-view-qual').innerText = data.qualification || 'N/A';
    document.getElementById('tch-view-exp').innerText = data.experience || 'N/A';
    document.getElementById('tch-view-joining').innerText = data.joiningDate || 'N/A';
    document.getElementById('tch-view-salary').innerText = `₹${Number(data.salary || 25000).toLocaleString('en-IN')}`;
    document.getElementById('tch-view-username').innerText = data.loginAccount ? data.loginAccount.username : (data.loginUsername || empId);
    document.getElementById('tch-view-status').innerText = data.status || 'Active';
    document.getElementById('tch-view-lastlogin').innerText = data.loginAccount && data.loginAccount.last_login ? new Date(data.loginAccount.last_login).toLocaleString('en-IN') : 'Never';
    document.getElementById('tch-view-address').innerText = data.fullAddress || data.address || 'Garumara, West Bengal';

    const photoBox = document.getElementById('tch-view-photo-box');
    if (photoBox) {
      if (data.photo) {
        photoBox.innerHTML = `<img src="${data.photo}" class="w-full h-full object-cover rounded-2xl">`;
      } else {
        photoBox.innerHTML = '👩‍🏫';
      }
    }

    // Populate Attendance History
    const attTbody = document.getElementById('tch-view-att-tbody');
    if (attTbody) {
      const att = data.attendanceHistory || [];
      attTbody.innerHTML = att.length ? att.map(a => `
        <tr>
          <td class="p-2 font-mono">${a.date}</td>
          <td class="p-2 font-bold ${a.status === 'Present' ? 'text-emerald-500' : 'text-rose-500'}">${a.status}</td>
          <td class="p-2 font-mono">${a.checkIn || '09:00 AM'}</td>
          <td class="p-2 text-slate-400">${a.remarks || '-'}</td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="p-4 text-center text-slate-400">No attendance records found.</td></tr>';
    }

    // Populate Leave History
    const leaveTbody = document.getElementById('tch-view-leave-tbody');
    if (leaveTbody) {
      const leaves = data.leaveHistory || [];
      leaveTbody.innerHTML = leaves.length ? leaves.map(l => `
        <tr>
          <td class="p-2 font-bold">${l.type || 'Casual Leave'}</td>
          <td class="p-2 font-mono">${l.startDate} - ${l.endDate}</td>
          <td class="p-2 font-bold">${l.days || 1} day(s)</td>
          <td class="p-2 font-bold ${l.status === 'Approved' ? 'text-emerald-500' : 'text-amber-500'}">${l.status || 'Pending'}</td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="p-4 text-center text-slate-400">No leave records found.</td></tr>';
    }

    // Populate Salary History
    const salTbody = document.getElementById('tch-view-sal-tbody');
    if (salTbody) {
      const sals = data.salaryHistory || [];
      salTbody.innerHTML = sals.length ? sals.map(s => `
        <tr>
          <td class="p-2 font-bold">${s.month || 'Current'}</td>
          <td class="p-2 font-mono font-bold text-emerald-500">₹${Number(s.netSalary || data.salary || 25000).toLocaleString('en-IN')}</td>
          <td class="p-2 font-bold text-emerald-500">${s.status || 'Disbursed'}</td>
          <td class="p-2 font-mono text-slate-400">${s.paymentDate || 'Monthly'}</td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="p-4 text-center text-slate-400">No salary records found.</td></tr>';
    }

  } catch (err) {
    alert('Failed to load profile details: ' + err.message);
  }
};

// Profile Tab Switcher
['overview', 'attendance', 'leave', 'salary'].forEach(tab => {
  document.getElementById(`tch-view-tab-${tab}-btn`)?.addEventListener('click', () => {
    ['overview', 'attendance', 'leave', 'salary'].forEach(t => {
      const btn = document.getElementById(`tch-view-tab-${t}-btn`);
      const sec = document.getElementById(`tch-view-sec-${t}`);
      if (t === tab) {
        btn?.classList.add('border-amber-500', 'text-slate-900', 'dark:text-white');
        btn?.classList.remove('border-transparent', 'text-slate-400');
        sec?.classList.remove('hidden');
      } else {
        btn?.classList.remove('border-amber-500', 'text-slate-900', 'dark:text-white');
        btn?.classList.add('border-transparent', 'text-slate-400');
        sec?.classList.add('hidden');
      }
    });
  });
});

document.getElementById('tch-view-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-profile-modal')?.classList.add('hidden');
});
document.getElementById('tch-view-close-btn')?.addEventListener('click', () => {
  document.getElementById('tch-profile-modal')?.classList.add('hidden');
});

// =========================================================================
// 2. MANAGE LOGIN CONTROL MODAL CONTROLLER
// =========================================================================
window.openTeacherLoginModal = async function(empId) {
  await window.editTeacherModal(empId);
  const userInp = document.getElementById('tch-edit-username');
  if (userInp) {
    userInp.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => userInp.focus(), 300);
  }
};

// =========================================================================
// 3. SALARY DETAILS & PAYROLL MODAL CONTROLLER
// =========================================================================
window.openTeacherSalaryModal = async function(empId) {
  const modal = document.getElementById('tch-salary-details-modal');
  if (modal) modal.classList.remove('hidden');

  try {
    const data = await ApiService.authenticatedFetch(`/api/teachers/${empId}/payroll`);
    const p = data.payroll || {};

    const subtitle = document.getElementById('tch-sal-subtitle');
    if (subtitle) subtitle.innerText = `Salary structure, allowances, and deductions for ${data.name} (${data.empId})`;

    document.getElementById('tch-sal-basic').innerText = `₹${Number(p.basicSalary || 25000).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-hra').innerText = `₹${Number(p.hra || 2500).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-da').innerText = `₹${Number(p.da || 1250).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-ta').innerText = `₹${Number(p.ta || 1500).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-gross').innerText = `₹${Number(p.grossSalary || 30250).toLocaleString('en-IN')}`;
    
    document.getElementById('tch-sal-pf').innerText = `₹${Number(p.pf || 3000).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-ptax').innerText = `₹${Number(p.profTax || 200).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-deductions').innerText = `₹${Number(p.totalDeductions || 3200).toLocaleString('en-IN')}`;
    document.getElementById('tch-sal-net').innerText = `₹${Number(p.netSalary || 27050).toLocaleString('en-IN')}`;

    const histTbody = document.getElementById('tch-sal-history-tbody');
    if (histTbody) {
      const history = data.paymentHistory || [];
      histTbody.innerHTML = history.length ? history.map(h => `
        <tr>
          <td class="p-2.5 font-bold">${h.month || 'Current Month'}</td>
          <td class="p-2.5 font-mono">₹${Number(h.gross || p.grossSalary).toLocaleString('en-IN')}</td>
          <td class="p-2.5 font-mono font-bold text-emerald-500">₹${Number(h.netSalary || p.netSalary).toLocaleString('en-IN')}</td>
          <td class="p-2.5 font-bold text-emerald-500">${h.status || 'Paid'}</td>
          <td class="p-2.5">
            <button onclick="window.printSalarySlip('${empId}')" class="text-amber-500 font-bold hover:underline">📄 Payslip</button>
          </td>
        </tr>
      `).join('') : `
        <tr>
          <td class="p-2.5 font-bold">July 2026</td>
          <td class="p-2.5 font-mono">₹${Number(p.grossSalary || 30250).toLocaleString('en-IN')}</td>
          <td class="p-2.5 font-mono font-bold text-emerald-500">₹${Number(p.netSalary || 27050).toLocaleString('en-IN')}</td>
          <td class="p-2.5 font-bold text-emerald-500">Disbursed</td>
          <td class="p-2.5">
            <button onclick="window.printSalarySlip('${empId}')" class="text-amber-500 font-bold hover:underline text-[11px]">📄 Payslip</button>
          </td>
        </tr>
      `;
    }

  } catch (err) {
    alert('Failed to load salary details: ' + err.message);
  }
};

window.printSalarySlip = async function(empId) {
  try {
    const salaries = await ApiService.getTeacherSalaries();
    const teacherSalaries = salaries.filter(s => s.empId === empId);
    if (teacherSalaries.length) {
      window.openSalarySlipPreviewModal(teacherSalaries[teacherSalaries.length - 1]);
    } else {
      const teachers = teacherState.teachers.length ? teacherState.teachers : await ApiService.getTeachers();
      const teacher = teachers.find(t => t.empId === empId || t.id === empId) || {};
      window.openSalarySlipPreviewModal({
        slipNo: `SLIP-${new Date().getFullYear()}-0001`,
        empId: empId,
        teacherName: teacher.name || 'Faculty Member',
        designation: teacher.designation || (teacher.subject ? `${teacher.subject} Teacher` : 'Faculty Member'),
        month: new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        baseSalary: Number(teacher.salary || 25000),
        bonus: 0,
        deduction: 0,
        netSalary: Number(teacher.salary || 25000),
        paymentMode: 'Bank Transfer',
        paidDate: new Date().toISOString().split('T')[0]
      });
    }
  } catch (err) {
    alert('Failed to load salary slip preview: ' + err.message);
  }
};

document.getElementById('tch-sal-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-salary-details-modal')?.classList.add('hidden');
});
document.getElementById('tch-sal-close-btn')?.addEventListener('click', () => {
  document.getElementById('tch-salary-details-modal')?.classList.add('hidden');
});
document.getElementById('tch-sal-print-btn')?.addEventListener('click', () => {
  window.print();
});

// =========================================================================
// 4. SOFT DELETE TEACHER MODAL CONTROLLER
// =========================================================================
let pendingDeleteEmpId = null;

window.openDeleteTeacherModal = function(empId) {
  pendingDeleteEmpId = empId;
  const teacher = (teacherState.teachers || []).find(t => t.empId === empId || t.id === empId);

  document.getElementById('tch-del-name').innerText = teacher ? teacher.name : empId;
  document.getElementById('tch-del-empid').innerText = empId;

  const modal = document.getElementById('tch-delete-confirm-modal');
  if (modal) modal.classList.remove('hidden');
};

document.getElementById('tch-del-cancel-btn')?.addEventListener('click', () => {
  pendingDeleteEmpId = null;
  document.getElementById('tch-delete-confirm-modal')?.classList.add('hidden');
});

window.refreshAllTeacherModules = async function() {
  try {
    if (typeof loadTeacherStats === 'function') await loadTeacherStats();
    if (typeof loadTeacherDirectory === 'function') await loadTeacherDirectory();
    if (typeof loadTeacherAssignments === 'function') await loadTeacherAssignments();
    if (typeof loadTeacherAttendance === 'function') await loadTeacherAttendance();
  } catch (err) {
    console.error('Error refreshing teacher modules:', err);
  }
};

document.getElementById('tch-del-confirm-btn')?.addEventListener('click', async () => {
  if (!pendingDeleteEmpId) return;

  try {
    const res = await ApiService.authenticatedFetch(`/api/teachers/${pendingDeleteEmpId}`, {
      method: 'DELETE'
    });

    alert(res.message || `✅ Teacher record soft deleted successfully.`);
    document.getElementById('tch-delete-confirm-modal')?.classList.add('hidden');
    pendingDeleteEmpId = null;
    await window.refreshAllTeacherModules();
  } catch (err) {
    alert('Failed to soft delete teacher record: ' + err.message);
  }
});

document.getElementById('tch-edit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const empId = document.getElementById('tch-edit-empid').value;
  const payload = {
    name: document.getElementById('tch-edit-name').value,
    subject: document.getElementById('tch-edit-subject').value,
    classTeacher: document.getElementById('tch-edit-class').value,
    mobile: document.getElementById('tch-edit-mobile').value,
    email: document.getElementById('tch-edit-email').value,
    salary: Number(document.getElementById('tch-edit-salary').value),
    qualification: document.getElementById('tch-edit-qualification').value,
    status: document.getElementById('tch-edit-status').value
  };

  try {
    await ApiService.updateTeacher(empId, payload);
    alert('✅ Teacher profile updated successfully!');
    document.getElementById('tch-edit-modal').classList.add('hidden');
    await window.refreshAllTeacherModules();
  } catch (err) {
    alert('Failed to update teacher profile: ' + err.message);
  }
});

document.getElementById('tch-edit-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-edit-modal')?.classList.add('hidden');
});
document.getElementById('tch-edit-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('tch-edit-modal')?.classList.add('hidden');
});

window.deleteTeacherRecord = async function(empId) {
  if (!confirm(`Are you sure you want to remove teacher ${empId}?`)) return;
  try {
    await ApiService.deleteTeacher(empId);
    alert('Teacher record deleted.');
    await window.refreshAllTeacherModules();
  } catch (err) {
    alert('Failed to delete teacher: ' + err.message);
  }
};

// Teacher Attendance Radio Button Visual Toggle Handler
document.getElementById('tch-att-tbody')?.addEventListener('change', (e) => {
  if (e.target && e.target.type === 'radio') {
    const radioName = e.target.name;
    const allRadios = document.querySelectorAll(`input[name="${radioName}"]`);
    allRadios.forEach(r => {
      const label = r.closest('label');
      if (!label) return;
      if (r.checked) {
        if (r.value === 'Present') label.className = 'cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold bg-emerald-500 text-white border-emerald-600';
        else if (r.value === 'Absent') label.className = 'cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold bg-red-500 text-white border-red-600';
        else if (r.value === 'Half Day') label.className = 'cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold bg-amber-500 text-white border-amber-600';
        else if (r.value === 'Leave') label.className = 'cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold bg-blue-500 text-white border-blue-600';
      } else {
        label.className = 'cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
      }
    });
  }
});

// Teacher Attendance Marking
async function loadTeacherAttendance() {
  const dateInput = document.getElementById('tch-att-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = teacherState.currentAttendanceDate;
  }
  const date = dateInput ? dateInput.value : teacherState.currentAttendanceDate;
  const tbody = document.getElementById('tch-att-tbody');
  const saveBtn = document.getElementById('tch-att-save-btn');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400">Loading attendance data...</td></tr>';
    const teachers = await ApiService.getTeachers();
    teacherState.teachers = teachers;
    const existing = await ApiService.getTeacherAttendance(date);
    const existingRecords = existing.length ? (existing[0].records || []) : [];

    tbody.innerHTML = teachers.map(t => {
      const rec = existingRecords.find(r => r.empId === t.empId) || { status: 'Present', remarks: '' };
      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
          <td class="px-5 py-3 font-mono font-bold text-amber-500">${t.empId}</td>
          <td class="px-5 py-3 font-bold text-slate-900 dark:text-white">${t.name}</td>
          <td class="px-5 py-3">${t.subject}</td>
          <td class="px-5 py-3 text-center">
            <div class="inline-flex space-x-2">
              <label class="cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold ${rec.status === 'Present' ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}">
                <input type="radio" name="att_${t.empId}" value="Present" ${rec.status === 'Present' ? 'checked' : ''} class="hidden"> Present
              </label>
              <label class="cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold ${rec.status === 'Absent' ? 'bg-red-500 text-white border-red-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}">
                <input type="radio" name="att_${t.empId}" value="Absent" ${rec.status === 'Absent' ? 'checked' : ''} class="hidden"> Absent
              </label>
              <label class="cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold ${rec.status === 'Half Day' ? 'bg-amber-500 text-white border-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}">
                <input type="radio" name="att_${t.empId}" value="Half Day" ${rec.status === 'Half Day' ? 'checked' : ''} class="hidden"> Half Day
              </label>
              <label class="cursor-pointer border rounded-xl px-2.5 py-1 text-[11px] font-bold ${rec.status === 'Leave' ? 'bg-blue-500 text-white border-blue-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}">
                <input type="radio" name="att_${t.empId}" value="Leave" ${rec.status === 'Leave' ? 'checked' : ''} class="hidden"> Leave
              </label>
            </div>
          </td>
          <td class="px-5 py-3">
            <input type="text" id="att_rem_${t.empId}" value="${rec.remarks || ''}" placeholder="Remarks" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 text-xs">
          </td>
        </tr>
      `;
    }).join('');

    if (saveBtn) saveBtn.disabled = false;
  } catch (err) {
    console.error('Error loading teacher attendance:', err);
  }
}

document.getElementById('tch-att-load-btn')?.addEventListener('click', loadTeacherAttendance);

document.getElementById('tch-att-save-btn')?.addEventListener('click', async () => {
  const dateInput = document.getElementById('tch-att-date');
  const date = dateInput ? dateInput.value : teacherState.currentAttendanceDate;
  const saveBtn = document.getElementById('tch-att-save-btn');
  
  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerText = 'Saving...';
    }
    
    let teachers = teacherState.teachers;
    if (!teachers || teachers.length === 0) {
      teachers = await ApiService.getTeachers();
      teacherState.teachers = teachers;
    }

    const records = teachers.map(t => {
      const checkedRadio = document.querySelector(`input[name="att_${t.empId}"]:checked`);
      const remarksInput = document.getElementById(`att_rem_${t.empId}`);
      return {
        empId: t.empId,
        name: t.name,
        status: checkedRadio ? checkedRadio.value : 'Present',
        remarks: remarksInput ? remarksInput.value : ''
      };
    });

    await ApiService.saveTeacherAttendance({ date, records });
    alert('✅ Daily Teacher Attendance Saved Successfully!');
    await loadTeacherStats();
  } catch (err) {
    alert('Failed to save teacher attendance: ' + err.message);
  }
});

// Salary Management
function populateTeacherDropdowns() {
  const sel = document.getElementById('tch-sal-empid');
  const portalSel = document.getElementById('tch-portal-select-teacher');
  const teachers = teacherState.teachers;

  if (sel) {
    sel.innerHTML = '<option value="">Choose Teacher...</option>' + teachers.map(t => `<option value="${t.empId}">${t.empId} - ${t.name} (Basic ₹${t.salary})</option>`).join('');
  }
  if (portalSel) {
    portalSel.innerHTML = teachers.map(t => `<option value="${t.empId}">${t.name} (${t.empId})</option>`).join('');
  }
}

// Salary auto calculation
function updateSalaryNetDisplay() {
  const base = Number(document.getElementById('tch-sal-base')?.value || 0);
  const bonus = Number(document.getElementById('tch-sal-bonus')?.value || 0);
  const deduction = Number(document.getElementById('tch-sal-deduction')?.value || 0);
  const net = base + bonus - deduction;
  const display = document.getElementById('tch-sal-net-display');
  if (display) display.innerText = `₹${net.toLocaleString('en-IN')}`;
}

['tch-sal-base', 'tch-sal-bonus', 'tch-sal-deduction'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updateSalaryNetDisplay);
});

document.getElementById('tch-sal-empid')?.addEventListener('change', (e) => {
  const teacher = teacherState.teachers.find(t => t.empId === e.target.value);
  if (teacher) {
    const baseInput = document.getElementById('tch-sal-base');
    if (baseInput) baseInput.value = teacher.salary || 25000;
    updateSalaryNetDisplay();
  }
});

const salaryForm = document.getElementById('tch-salary-form');
if (salaryForm) {
  salaryForm.onsubmit = async (e) => {
    e.preventDefault();
    const empId = document.getElementById('tch-sal-empid').value;
    const month = document.getElementById('tch-sal-month').value;
    const base = Number(document.getElementById('tch-sal-base').value);
    const bonus = Number(document.getElementById('tch-sal-bonus').value || 0);
    const deduction = Number(document.getElementById('tch-sal-deduction').value || 0);
    const netSalary = base + bonus - deduction;
    const paymentMode = document.getElementById('tch-sal-mode').value;
    const referenceNo = document.getElementById('tch-sal-ref').value || 'N/A';

    try {
      const result = await ApiService.payTeacherSalary({
        empId,
        month,
        baseSalary: base,
        bonus,
        deduction,
        netSalary,
        paymentMode,
        referenceNo
      });

      alert(`✅ Salary Disbursed Successfully!\nSlip No: ${result.slipNo}`);
      await loadTeacherSalaries();
      window.openSalarySlipPreviewModal(result);
    } catch (err) {
      alert('Failed to process salary payment: ' + err.message);
    }
  };
}

window.openSalarySlipBySlipNo = async function(slipNo) {
  try {
    const salaries = await ApiService.getTeacherSalaries();
    const record = salaries.find(s => s.slipNo === slipNo);
    if (record) {
      window.openSalarySlipPreviewModal(record);
    } else {
      alert('Salary slip record not found.');
    }
  } catch (err) {
    alert('Error loading salary slip: ' + err.message);
  }
};

window.downloadSalarySlipPDFBySlipNo = async function(slipNo, btnElement) {
  let originalHtml = '';
  try {
    const salaries = await ApiService.getTeacherSalaries();
    let record = salaries.find(s => s.slipNo === slipNo);
    if (!record) {
      alert('Salary slip record not found.');
      return;
    }

    // Enrich missing fields from teacher profile database if needed
    let teachers = teacherState.teachers.length ? teacherState.teachers : [];
    if (!teachers.length) {
      try { teachers = await ApiService.getTeachers(); teacherState.teachers = teachers; } catch (e) {}
    }
    const teacher = teachers.find(t => t.empId === record.empId);

    const baseSalary = Number(record.baseSalary || (teacher ? teacher.salary : 25000));
    const bonus = Number(record.bonus || 0);
    const deduction = Number(record.deduction || 0);
    const netSalary = Number(record.netSalary || (baseSalary + bonus - deduction));

    record = {
      ...record,
      teacherName: record.teacherName || (teacher ? teacher.name : 'Faculty Member'),
      designation: record.designation || (teacher ? `${teacher.subject} Teacher` : 'Faculty Member'),
      baseSalary,
      bonus,
      deduction,
      netSalary
    };

    if (btnElement) {
      originalHtml = btnElement.innerHTML;
      btnElement.disabled = true;
      btnElement.innerHTML = `<span>⏳</span> <span>Downloading...</span>`;
    }

    window.openSalarySlipPreviewModal(record);

    // DOM paint guard delay to ensure 100% canvas rendering before export
    await new Promise(r => setTimeout(r, 300));

    const renderBox = document.getElementById('tch-salary-slip-render-box');
    if (renderBox && typeof html2pdf !== 'undefined') {
      const opt = {
        margin:       [15, 15, 15, 15],
        filename:     `Salary_Slip_${record.slipNo}_${(record.teacherName || 'Teacher').replace(/\s+/g, '_')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, allowTaint: true, logging: false },
        jsPDF:        { unit: 'mm', format: [210, 297], orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
      };
      await html2pdf().set(opt).from(renderBox).save();
    }
  } catch (err) {
    console.error('Error downloading salary slip PDF:', err);
    alert('Failed to download salary slip PDF: ' + err.message);
  } finally {
    if (btnElement && originalHtml) {
      btnElement.disabled = false;
      btnElement.innerHTML = originalHtml;
    }
  }
};

async function loadTeacherSalaries() {
  const tbody = document.getElementById('tch-salaries-tbody');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-slate-400">Loading salary disbursement history...</td></tr>';
    const salaries = await ApiService.getTeacherSalaries();

    if (salaries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-slate-400">No salary disbursement records found.</td></tr>';
      return;
    }

    tbody.innerHTML = salaries.map(s => {
      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
          <td class="px-4 py-3 font-mono font-bold text-amber-500">${s.slipNo}</td>
          <td class="px-4 py-3 font-mono">${s.empId}</td>
          <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${s.teacherName}</td>
          <td class="px-4 py-3 font-medium">${s.month}</td>
          <td class="px-4 py-3 font-mono font-bold text-emerald-500">₹${Number(s.netSalary).toLocaleString('en-IN')}</td>
          <td class="px-4 py-3">${s.paymentMode}</td>
          <td class="px-4 py-3 font-mono text-[11px]">${s.paidDate}</td>
          <td class="px-4 py-3 text-right">
            <button onclick="window.downloadSalarySlipPDFBySlipNo('${s.slipNo}', this)" class="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-xl font-bold text-[11px] shadow-sm transition-all inline-flex items-center space-x-1.5" title="Download Salary Slip PDF">
              <span>📥</span> <span>Download PDF</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading teacher salaries:', err);
  }
}

function numberToWordsINR(num) {
  if (!num || isNaN(num)) return 'Zero Rupees Only';
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  function inWords(n) {
    if ((n = n.toString()).length > 9) return 'overflow';
    let n_array = ('000000000' + n).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n_array) return '';
    let str = '';
    str += (n_array[1] != 0) ? (a[Number(n_array[1])] || (b[n_array[1][0]] + ' ' + a[n_array[1][1]])) + 'Crore ' : '';
    str += (n_array[2] != 0) ? (a[Number(n_array[2])] || (b[n_array[2][0]] + ' ' + a[n_array[2][1]])) + 'Lakh ' : '';
    str += (n_array[3] != 0) ? (a[Number(n_array[3])] || (b[n_array[3][0]] + ' ' + a[n_array[3][1]])) + 'Thousand ' : '';
    str += (n_array[4] != 0) ? (a[Number(n_array[4])] || (b[n_array[4][0]] + ' ' + a[n_array[4][1]])) + 'Hundred ' : '';
    str += (n_array[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n_array[5])] || (b[n_array[5][0]] + ' ' + a[n_array[5][1]])) : '';
    return str.trim();
  }
  
  const words = inWords(Math.floor(num));
  return words ? words + ' Rupees Only' : 'Zero Rupees Only';
}

// Salary Slip Preview Modal & PDF Generation State
let activePreviewSalaryRecord = null;

window.openSalarySlipPreviewModal = function(s) {
  activePreviewSalaryRecord = s;
  const modal = document.getElementById('tch-salary-preview-modal');
  const renderBox = document.getElementById('tch-salary-slip-render-box');
  if (!modal || !renderBox) return;

  const teacher = (teacherState.teachers || []).find(t => t.empId === s.empId) || {};
  const photoUrl = s.photo || teacher.photo || '';
  const bankAccount = s.accountNo || (teacher.bankDetails ? teacher.bankDetails.accountNo : '') || 'A/C ********4921';
  const bankName = s.bankName || (teacher.bankDetails ? teacher.bankDetails.bankName : '') || 'State Bank of India';

  const baseSalary = Number(s.baseSalary || teacher.salary || 25000);
  const bonus = Number(s.bonus || 0);
  const deduction = Number(s.deduction || 0);
  const grossSalary = baseSalary + bonus;
  const netSalary = Number(s.netSalary || (grossSalary - deduction));
  const amountWords = numberToWordsINR(netSalary);
  const generatedDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  renderBox.innerHTML = `
    <div style="border: 2px solid #1e293b; padding: 22px; box-sizing: border-box; background: #ffffff; color: #0f172a; font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; line-height: 1.4;">
      
      <!-- Top Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; space-x: 12px;">
          <img src="${window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg')}" style="width: 70px; height: 70px; object-fit: contain; border-radius: 4px; margin-right: 14px;">
          <div>
            <h2 style="font-size: 21px; font-weight: 900; color: #1e3a8a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">${(window.currentSchool?.name || 'Garumara Jatiya Vidyalaya').toUpperCase()}</h2>
            <p style="font-size: 10.5px; color: #475569; margin: 3px 0; font-weight: 600;">${window.currentSchool ? (window.currentSchool.establishedYear ? 'ESTD ' + window.currentSchool.establishedYear + ' | ' : '') + (window.currentSchool.address || '') + (window.currentSchool.phone ? ' | Helpline: ' + window.currentSchool.phone : '') : 'ESTD 2023 | Nagaon, Assam - 782140 | Helpline: +91 8099456097'}</p>
            <p style="font-size: 10px; color: #64748b; margin: 0;">${window.currentSchool ? 'Email: ' + (window.currentSchool.email || 'N/A') : 'Email: info@garumarajatiyavidyalaya.in'}</p>
          </div>
        </div>
        <div style="text-align: right; min-width: 140px;">
          <div style="display: inline-block; background: #10b981; color: #ffffff; font-weight: 900; font-size: 11px; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">✓ PAID</div>
          <p style="margin: 2px 0; font-size: 10.5px; color: #334155;"><strong>Slip No:</strong> <span style="font-family: monospace; font-size: 11.5px; font-weight: bold; color: #1e293b;">${s.slipNo}</span></p>
          <p style="margin: 2px 0; font-size: 10.5px; color: #334155;"><strong>Paid Date:</strong> ${s.paidDate || '2026-07-20'}</p>
        </div>
      </div>

      <!-- Prominent Title Bar -->
      <div style="background: #1e293b; color: #ffffff; text-align: center; padding: 7px 0; font-weight: 900; font-size: 12.5px; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 14px; border-radius: 4px;">
        FACULTY MONTHLY SALARY PAYSLIP
      </div>

      <!-- Teacher Metadata Grid with Photo -->
      <div style="display: flex; gap: 16px; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-bottom: 16px; background: #f8fafc; align-items: center;">
        ${photoUrl ? `<img src="${photoUrl}" style="width: 75px; height: 75px; object-fit: cover; border-radius: 8px; border: 2px solid #cbd5e1; flex-shrink: 0;">` : `<div style="width: 75px; height: 75px; border-radius: 8px; background: #e2e8f0; color: #475569; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; flex-shrink: 0;">👩‍🏫</div>`}
        
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; color: #0f172a;">
          <tr>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569; width: 18%;">Teacher Name:</td>
            <td style="padding: 4px 6px; font-weight: 800; color: #0f172a; width: 32%; font-size: 12px;">${s.teacherName}</td>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569; width: 18%;">Employee ID:</td>
            <td style="padding: 4px 6px; font-weight: 800; font-family: monospace; color: #d97706; width: 32%;">${s.empId}</td>
          </tr>
          <tr>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569;">Designation:</td>
            <td style="padding: 4px 6px; font-weight: 700;">${s.designation || (teacher.subject ? `${teacher.subject} Teacher` : 'Faculty Member')}</td>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569;">Department:</td>
            <td style="padding: 4px 6px; font-weight: 700;">Academic & Pedagogy</td>
          </tr>
          <tr>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569;">Salary Month:</td>
            <td style="padding: 4px 6px; font-weight: 800; color: #1e3a8a;">${s.month}</td>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569;">Payment Mode:</td>
            <td style="padding: 4px 6px; font-weight: 700;">${s.paymentMode}</td>
          </tr>
          <tr>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569;">Bank & Account:</td>
            <td style="padding: 4px 6px; font-family: monospace;">${bankName} (${bankAccount})</td>
            <td style="padding: 4px 6px; font-weight: bold; color: #475569;">Ref / Txn No:</td>
            <td style="padding: 4px 6px; font-family: monospace; font-weight: bold;">${s.referenceNo || 'N/A'}</td>
          </tr>
        </table>
      </div>

      <!-- Earnings & Deductions Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; color: #0f172a;">
        <thead>
          <tr style="background: #1e293b; color: #ffffff; font-weight: 800;">
            <th style="padding: 8px 10px; border: 1px solid #1e293b; text-align: left; width: 36%;">EARNINGS HEADS</th>
            <th style="padding: 8px 10px; border: 1px solid #1e293b; text-align: right; width: 14%;">AMOUNT (₹)</th>
            <th style="padding: 8px 10px; border: 1px solid #1e293b; text-align: left; width: 36%;">DEDUCTIONS HEADS</th>
            <th style="padding: 8px 10px; border: 1px solid #1e293b; text-align: right; width: 14%;">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: 600;">Basic Monthly Salary</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold;">₹${baseSalary.toLocaleString('en-IN')}</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: 600;">Provident Fund (PF / ESI)</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold;">₹${deduction.toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: 600;">Performance Allowance / Bonus</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold;">₹${bonus.toLocaleString('en-IN')}</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: 600;">Professional Tax / Other Deductions</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold;">₹0</td>
          </tr>
          <tr>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: 600;">House Rent & Conveyance Allowance</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold;">₹0</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: 600;">Leave / Unpaid Absences</td>
            <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: right; font-family: monospace; font-weight: bold;">₹0</td>
          </tr>
          <tr style="font-weight: bold; background: #f1f5f9;">
            <td style="padding: 8px 10px; border: 1px solid #94a3b8; font-weight: 800;">Total Gross Earnings</td>
            <td style="padding: 8px 10px; border: 1px solid #94a3b8; text-align: right; font-family: monospace; font-weight: 900; color: #1e3a8a;">₹${grossSalary.toLocaleString('en-IN')}</td>
            <td style="padding: 8px 10px; border: 1px solid #94a3b8; font-weight: 800;">Total Deductions</td>
            <td style="padding: 8px 10px; border: 1px solid #94a3b8; text-align: right; font-family: monospace; font-weight: 900; color: #dc2626;">₹${deduction.toLocaleString('en-IN')}</td>
          </tr>
        </tbody>
      </table>

      <!-- Net Disbursed Box & Amount in Words -->
      <div style="border: 2px solid #10b981; background: #ecfdf5; padding: 12px 18px; border-radius: 6px; margin-bottom: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 13px; font-weight: 900; color: #065f46; letter-spacing: 0.5px;">NET SALARY DISBURSED:</span>
          <span style="font-size: 20px; font-weight: 900; color: #047857; font-family: monospace;">₹${netSalary.toLocaleString('en-IN')}</span>
        </div>
        <div style="font-size: 11px; color: #1e293b; margin-top: 5px; font-weight: 700; border-top: 1px dashed #a7f3d0; padding-top: 5px;">
          Amount in Words: <span style="font-weight: 800; color: #047857; text-decoration: underline;">${amountWords}</span>
        </div>
      </div>

      <!-- Signatures & Official Stamp -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 45px; font-size: 11px; font-weight: 700; color: #0f172a;">
        <div style="text-align: center; width: 150px;">
          <p style="border-top: 1.5px solid #0f172a; width: 130px; margin: 0 auto 5px auto;"></p>
          <p style="margin: 0; color: #334155;">Teacher Signature</p>
        </div>
        <div style="text-align: center; width: 150px;">
          <p style="border-top: 1.5px solid #0f172a; width: 130px; margin: 0 auto 5px auto;"></p>
          <p style="margin: 0; color: #334155;">Accounts Officer</p>
        </div>
        <div style="text-align: center; width: 150px;">
          <p style="border-top: 1.5px solid #0f172a; width: 130px; margin: 0 auto 5px auto;"></p>
          <p style="margin: 0; color: #334155;">Principal & School Seal</p>
        </div>
      </div>

      <!-- Computer-Generated Footer Note -->
      <div style="border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 30px; display: flex; justify-content: space-between; font-size: 9.5px; color: #64748b;">
        <span>Note: This is a computer-generated salary slip and does not require a physical signature for digital verification.</span>
        <span>Generated on: ${generatedDate} | Page 1 of 1</span>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

// Modal Event Bindings for Salary Preview & Download
document.getElementById('tch-salary-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-salary-preview-modal')?.classList.add('hidden');
  document.getElementById('tch-salary-preview-modal')?.classList.remove('flex');
});

document.getElementById('tch-salary-modal-close-top')?.addEventListener('click', () => {
  document.getElementById('tch-salary-preview-modal')?.classList.add('hidden');
  document.getElementById('tch-salary-preview-modal')?.classList.remove('flex');
});

document.getElementById('tch-salary-preview-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'tch-salary-preview-modal') {
    document.getElementById('tch-salary-preview-modal').classList.add('hidden');
    document.getElementById('tch-salary-preview-modal').classList.remove('flex');
  }
});

// Download PDF from Preview Box
document.getElementById('tch-salary-modal-download-btn')?.addEventListener('click', async () => {
  if (!activePreviewSalaryRecord) return;
  const s = activePreviewSalaryRecord;
  const renderBox = document.getElementById('tch-salary-slip-render-box');
  const btn = document.getElementById('tch-salary-modal-download-btn');

  if (!renderBox || typeof html2pdf === 'undefined') {
    alert('PDF Generator is initializing. Please try again.');
    return;
  }

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> <span>Generating PDF...</span>`;

  const opt = {
    margin:       [15, 15, 15, 15],
    filename:     `Salary_Slip_${s.slipNo}_${(s.teacherName || 'Teacher').replace(/\s+/g, '_')}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, allowTaint: true, logging: false },
    jsPDF:        { unit: 'mm', format: [210, 297], orientation: 'portrait' },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
  };

  try {
    await html2pdf().set(opt).from(renderBox).save();
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('PDF export failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

// Teacher Portal View
async function loadTeacherPortalView() {
  const portalSel = document.getElementById('tch-portal-select-teacher');
  const empId = portalSel ? portalSel.value : (teacherState.teachers[0]?.empId || '');
  const teacher = teacherState.teachers.find(t => t.empId === empId) || teacherState.teachers[0];

  if (!teacher) return;

  const classEl = document.getElementById('tch-portal-class');
  const subjEl = document.getElementById('tch-portal-subject');
  const salEl = document.getElementById('tch-portal-salary');

  if (salEl) salEl.innerText = `₹${Number(teacher.salary || 25000).toLocaleString('en-IN')}`;

  const rosterTbody = document.getElementById('tch-portal-roster-tbody');
  if (!rosterTbody) return;

  try {
    rosterTbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400">Loading student roster...</td></tr>';
    
    const [students, myAsns] = await Promise.all([
      ApiService.getStudents(),
      ApiService.getTeacherAssignments(empId)
    ]);

    if (myAsns && myAsns.length) {
      const assignedClassesStr = [...new Set(myAsns.map(a => `${a.class_name}-${a.section}`))].join(', ');
      const assignedSubjsStr = [...new Set(myAsns.map(a => a.subject_name))].join(', ');
      if (classEl) classEl.innerText = assignedClassesStr;
      if (subjEl) subjEl.innerText = assignedSubjsStr;
    } else {
      if (classEl) classEl.innerText = teacher.classTeacher || 'None';
      if (subjEl) subjEl.innerText = teacher.subject || 'General';
    }

    const assignedClassNames = myAsns.length ? [...new Set(myAsns.map(a => a.class_name.toLowerCase()))] : [(teacher.classTeacher || '').replace('-A', '').replace('-B', '').trim().toLowerCase()];
    
    const roster = students.filter(st => assignedClassNames.includes((st.className || '').toLowerCase()));

    if (roster.length === 0) {
      rosterTbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400">No students assigned to this faculty member.</td></tr>';
      return;
    }

    rosterTbody.innerHTML = roster.map(st => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="px-4 py-2.5 font-mono font-bold text-amber-500">${st.admissionNo}</td>
        <td class="px-4 py-2.5 font-bold text-slate-900 dark:text-white">${st.name}</td>
        <td class="px-4 py-2.5 font-mono">${st.className} - ${st.section} (Roll: ${st.rollNo || '-'})</td>
        <td class="px-4 py-2.5">${st.fatherName || '-'}</td>
        <td class="px-4 py-2.5 font-mono">${st.contactNumber || '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading teacher portal roster:', err);
  }
}

document.getElementById('tch-portal-select-teacher')?.addEventListener('change', loadTeacherPortalView);

// ==============================================
// TEACHER WORKLOAD & MULTI-ASSIGNMENT MANAGEMENT
// ==============================================
let activeTeacherAssignments = [];

function renderAssignmentChips() {
  const container = document.getElementById('tch-asn-chips-container');
  if (!container) return;

  if (!activeTeacherAssignments.length) {
    container.innerHTML = '<span class="text-slate-400 text-xs italic py-1">No workload assignments added yet. Use the controls above to add tags.</span>';
    return;
  }

  container.innerHTML = activeTeacherAssignments.map((a, idx) => `
    <div class="inline-flex items-center space-x-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-900 dark:text-white shadow-sm transition-all hover:border-amber-500">
      <span>📊 ${a.class_name} - Sec ${a.section} : <span class="text-amber-500 font-extrabold">${a.subject_name}</span> ${a.is_class_teacher ? '<span class="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded-md ml-1 font-black uppercase">Class Teacher</span>' : ''}</span>
      <button type="button" onclick="window.removeAssignmentChip(${idx})" class="text-red-500 hover:text-red-700 font-black text-sm ml-1.5 focus:outline-none" title="Remove Assignment Tag">
        ✕
      </button>
    </div>
  `).join('');
}

window.removeAssignmentChip = function(index) {
  if (index >= 0 && index < activeTeacherAssignments.length) {
    activeTeacherAssignments.splice(index, 1);
    renderAssignmentChips();
  }
};

async function loadTeacherAssignmentsForSelectedEmp(empId) {
  if (!empId) {
    activeTeacherAssignments = [];
    renderAssignmentChips();
    return;
  }
  try {
    const list = await ApiService.getTeacherAssignments(empId);
    activeTeacherAssignments = list || [];
    renderAssignmentChips();
  } catch (err) {
    console.error('Error fetching teacher assignments for empId:', empId, err);
  }
}

// Add Tag Button Handler
document.getElementById('tch-asn-add-chip-btn')?.addEventListener('click', () => {
  const empId = document.getElementById('tch-asn-empid')?.value;
  if (!empId) return alert('❌ Please select a Teacher first.');

  const className = document.getElementById('tch-asn-class')?.value;
  const section = document.getElementById('tch-asn-sec')?.value;
  const subjectName = document.getElementById('tch-asn-subject')?.value;
  const session = document.getElementById('tch-asn-session')?.value || getCurrentAcademicSession();
  const isClassTeacher = document.getElementById('tch-asn-is-classteacher')?.checked || false;

  if (!className || !section || !subjectName) {
    return alert('❌ Please select Class, Section, and Subject.');
  }

  // Duplicate check in active local state
  const isDup = activeTeacherAssignments.some(a =>
    a.class_name.toLowerCase().trim() === className.toLowerCase().trim() &&
    a.section.toLowerCase().trim() === section.toLowerCase().trim() &&
    a.subject_name.toLowerCase().trim() === subjectName.toLowerCase().trim() &&
    (a.academic_session || getCurrentAcademicSession()) === session
  );

  if (isDup) {
    return alert(`❌ Duplicate Assignment: ${className} - Section ${section} (${subjectName}) is already added for this teacher.`);
  }

  activeTeacherAssignments.push({
    teacher_id: empId,
    class_name: className,
    section: section,
    subject_name: subjectName,
    academic_session: session,
    is_class_teacher: isClassTeacher
  });

  renderAssignmentChips();
});

// Teacher Dropdown Change Handler
document.getElementById('tch-asn-empid')?.addEventListener('change', (e) => {
  loadTeacherAssignmentsForSelectedEmp(e.target.value);
});

async function loadTeacherAssignments() {
  const tbody = document.getElementById('tch-assignments-tbody');
  const sel = document.getElementById('tch-asn-empid');
  const subjSel = document.getElementById('tch-asn-subject');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400">Loading faculty workload roster...</td></tr>';
    const teachers = await ApiService.getTeachers();
    teacherState.teachers = teachers;

    const allAssignments = await ApiService.getTeacherAssignments();

    if (sel) {
      sel.innerHTML = '<option value="">Choose Teacher...</option>' + teachers.map(t => `<option value="${t.id}">${t.empId} - ${t.name}</option>`).join('');
    }

    // Populate dynamic subjects dropdown
    if (subjSel) {
      try {
        const subjects = await ApiService.getSubjects();
        if (subjects && subjects.length) {
          const uniqueNames = [...new Set(subjects.map(s => s.name))];
          subjSel.innerHTML = uniqueNames.map(s => `<option value="${s}">${s}</option>`).join('');
        } else {
          subjSel.innerHTML = '<option value="">No subject found. Please add a subject.</option>';
        }
      } catch (err) {
        subjSel.innerHTML = '<option value="">No subject found. Please add a subject.</option>';
      }
    }

    if (!teachers.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400">No teachers found.</td></tr>';
      return;
    }

    tbody.innerHTML = teachers.map(t => {
      const myAsns = allAssignments.filter(a => a.teacher_id === t.empId);
      const ctAsn = myAsns.find(a => a.is_class_teacher);
      const ctDisplay = ctAsn ? `${ctAsn.class_name}-${ctAsn.section}` : (t.classTeacher !== 'None' ? t.classTeacher : 'None');

      const tagsHtml = myAsns.length ? myAsns.map(a => `
        <span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mr-1 mb-1">
          ${a.class_name}-${a.section}: ${a.subject_name} ${a.is_class_teacher ? '⭐' : ''}
        </span>
      `).join('') : '<span class="text-slate-400 text-xs italic">No subjects assigned</span>';

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/60 transition-colors">
          <td class="px-4 py-3 font-mono font-bold text-amber-500">${t.empId}</td>
          <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${t.name}</td>
          <td class="px-4 py-3">${tagsHtml}</td>
          <td class="px-4 py-3">${ctDisplay !== 'None' ? `<span class="bg-blue-500/10 text-blue-500 px-2.5 py-1 rounded-xl text-[10px] font-bold">${ctDisplay}</span>` : '<span class="text-slate-400">Subject Teacher Only</span>'}</td>
          <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-xl text-[10px] font-bold bg-emerald-500/10 text-emerald-500">${t.status || 'Active'}</span></td>
          <td class="px-4 py-3 text-right">
            <button onclick="window.reassignTeacher('${t.empId}')" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold px-3 py-1.5 rounded-xl text-xs shadow-sm transition-all">
              ✏️ Reassign
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading teacher assignments:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-red-500">Failed to load workload roster.</td></tr>';
  }
}

// Reassign Teacher function
window.reassignTeacher = async function(empId) {
  let teachers = teacherState.teachers || [];
  if (!teachers.length) {
    try {
      teachers = await ApiService.getTeachers();
      teacherState.teachers = teachers;
    } catch (e) {}
  }
  
  const teacher = teachers.find(t => t.empId === empId || t.id === empId);
  if (!teacher) return alert('Teacher record not found.');

  // Ensure assignments subtab is active
  switchTeacherSubtab('assignments');

  const empSel = document.getElementById('tch-asn-empid');
  if (empSel) {
    empSel.value = empId;
    await loadTeacherAssignmentsForSelectedEmp(empId);
  }

  // Scroll to form
  const form = document.getElementById('tch-assign-form');
  if (form) {
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

// Form Save All Assignments Handler
document.getElementById('tch-assign-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const empId = document.getElementById('tch-asn-empid').value;
  if (!empId) return alert('Please select a teacher.');

  const submitBtn = document.getElementById('tch-asn-save-all-btn');
  const originalText = submitBtn ? submitBtn.innerText : '';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = '💾 Saving Assignments...'; }

  try {
    const teacher = (teacherState.teachers || []).find(t => t.empId === empId || t.id === empId);
    const teacherName = teacher ? teacher.name : empId;

    await ApiService.replaceTeacherAssignments(empId, activeTeacherAssignments);
    alert(`✅ ${activeTeacherAssignments.length} class, section & subject workload assignment(s) saved successfully for ${teacherName} (${empId})!`);

    await loadTeacherAssignments();
    await loadTeacherDirectory();
    await loadTeacherPortalView();
  } catch (err) {
    alert('❌ Failed to update assignments: ' + err.message);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = originalText; }
  }
});

// ==============================================
// TEACHER LEAVE MANAGEMENT MODULE
// ==============================================
async function loadTeacherLeaves() {
  const tbody = document.getElementById('tch-leaves-tbody');
  const sel = document.getElementById('tch-lv-empid');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-slate-400">Loading leave requests...</td></tr>';
    const teachers = await ApiService.getTeachers();
    teacherState.teachers = teachers;

    if (sel) {
      sel.innerHTML = '<option value="">Select Teacher...</option>' + teachers.map(t => `<option value="${t.id}">${t.empId} - ${t.name}</option>`).join('');
    }

    const leaves = await ApiService.getTeacherLeaves();

    if (!leaves.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-slate-400">No leave applications recorded.</td></tr>';
      return;
    }

    tbody.innerHTML = leaves.map(l => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">${l.teacher_name} <span class="text-[10px] text-slate-400 block font-mono">${l.employee_code}</span></td>
        <td class="px-4 py-3 font-bold text-amber-500">${l.leave_type}</td>
        <td class="px-4 py-3 font-mono text-[11px]">${l.from_date} to ${l.to_date}</td>
        <td class="px-4 py-3 font-bold">${l.number_of_days || 1} Days</td>
        <td class="px-4 py-3 text-slate-600 dark:text-slate-300">${l.reason}</td>
        <td class="px-4 py-3 text-center">
          <span class="px-2.5 py-1 rounded-xl text-[10px] font-bold ${l.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-500' : (l.status === 'Rejected' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500')}">
            ${l.status}
          </span>
        </td>
        <td class="px-4 py-3 text-right">
          ${l.status === 'Pending' ? `
            <div class="flex items-center justify-end space-x-1">
              <button onclick="window.processTeacherLeave('${l.leave_request_id}', 'Approved', this)" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-xs font-bold transition-all">
                Approve
              </button>
              <button onclick="window.processTeacherLeave('${l.leave_request_id}', 'Rejected', this)" class="bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 rounded-lg text-xs font-bold transition-all">
                Reject
              </button>
            </div>
          ` : `<span class="text-[10px] text-slate-400 font-medium">Processed</span>`}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading teacher leaves:', err);
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500">Failed to load leave requests.</td></tr>';
  }
}

document.getElementById('tch-leave-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const teacherId = document.getElementById('tch-lv-empid').value;
  const leaveType = document.getElementById('tch-lv-type').value;
  const fromDate = document.getElementById('tch-lv-from').value;
  const toDate = document.getElementById('tch-lv-to').value;
  const reason = document.getElementById('tch-lv-reason').value;

  const d1 = new Date(fromDate);
  const d2 = new Date(toDate);
  const diffTime = Math.abs(d2 - d1);
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  try {
    await ApiService.submitTeacherLeave({ teacher_id: teacherId, leave_type: leaveType, from_date: fromDate, to_date: toDate, reason });
    alert('✅ Leave request submitted successfully!');
    document.getElementById('tch-leave-form').reset();
    await loadTeacherLeaves();
    await loadTeacherStats();
  } catch (err) {
    alert('Failed to submit leave request: ' + err.message);
  }
});

window.processTeacherLeave = async function(leaveRequestId, status, button) {
  const remarks = prompt(`Enter admin remarks for ${status} action:`, status === 'Approved' ? 'Approved by Admin' : 'Rejected by Admin');
  if (remarks === null) return;

  try {
    if (button) button.disabled = true;
    await ApiService.processTeacherLeave(leaveRequestId, status, remarks);
    alert(`✅ Leave request ${status} successfully!`);
    await loadTeacherLeaves();
    await loadTeacherStats();
    await loadTeacherDirectory();
  } catch (err) {
    console.error('Teacher leave decision failed:', { leaveRequestId, status, error: err });
    alert('Failed to process leave request: ' + err.message);
  } finally {
    if (button) button.disabled = false;
  }
};

// ==============================================
// TEACHER REPORTS MODULE
// ==============================================
async function loadTeacherReports() {
  const outputBox = document.getElementById('tch-report-output-box');
  if (!outputBox) return;

  const rptType = document.getElementById('tch-rpt-type')?.value || 'directory';
  const empType = document.getElementById('tch-rpt-emp-type')?.value || '';
  const statusFilter = document.getElementById('tch-rpt-status')?.value || '';

  try {
    const teachers = await ApiService.getTeachers();
    let filtered = teachers.filter(t => {
      const matchType = !empType || (t.employmentType || 'Permanent').toLowerCase() === empType.toLowerCase();
      const matchStatus = !statusFilter || (t.status || 'Active').toLowerCase() === statusFilter.toLowerCase();
      return matchType && matchStatus;
    });

    if (rptType === 'directory') {
      outputBox.innerHTML = `
        <table class="w-full text-left text-xs font-semibold text-slate-700 dark:text-slate-200 border-collapse border border-slate-200 dark:border-slate-800">
          <thead class="bg-slate-100 dark:bg-slate-900 font-bold border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Emp ID</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Teacher Name</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Designation</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Subject</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Class Teacher</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Mobile</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Qualification</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Salary</th>
              <th class="p-3 border border-slate-200 dark:border-slate-800">Status</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(t => `
              <tr class="border-b border-slate-200 dark:border-slate-800">
                <td class="p-3 font-mono font-bold text-amber-500 border border-slate-200 dark:border-slate-800">${t.empId}</td>
                <td class="p-3 font-bold border border-slate-200 dark:border-slate-800">${t.name}</td>
                <td class="p-3 border border-slate-200 dark:border-slate-800">${t.designation || (t.subject + ' Teacher')}</td>
                <td class="p-3 border border-slate-200 dark:border-slate-800">${t.subject || 'General'}</td>
                <td class="p-3 border border-slate-200 dark:border-slate-800">${t.classTeacher || 'None'}</td>
                <td class="p-3 font-mono border border-slate-200 dark:border-slate-800">${t.mobile}</td>
                <td class="p-3 border border-slate-200 dark:border-slate-800">${t.qualification}</td>
                <td class="p-3 font-mono font-bold text-emerald-500 border border-slate-200 dark:border-slate-800">₹${Number(t.salary || 25000).toLocaleString('en-IN')}</td>
                <td class="p-3 font-bold border border-slate-200 dark:border-slate-800">${t.status || 'Active'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      outputBox.innerHTML = `
        <div class="p-6 text-center text-slate-500 font-bold">
          Report type "${rptType}" generated with ${filtered.length} faculty records. Use "Print / PDF Report" to export.
        </div>
      `;
    }
  } catch (err) {
    console.error('Error generating report:', err);
    outputBox.innerHTML = '<p class="text-center py-6 text-rose-500">Failed to generate report.</p>';
  }
}

document.getElementById('tch-rpt-generate-btn')?.addEventListener('click', loadTeacherReports);

document.getElementById('tch-rpt-export-pdf')?.addEventListener('click', () => {
  const content = document.getElementById('tch-report-output-box')?.innerHTML;
  if (!content) return alert('Generate report first.');
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head>
        <title>Garumara Jatiya Vidyalaya - Faculty Report</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #000; }
          h2 { margin-bottom: 4px; }
          p { margin-top: 0; color: #64748b; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          th { background: #0f172a; color: #ffffff; }
        </style>
      </head>
      <body onload="window.print()">
        <h2>GARUMARA JATIYA VIDYALAYA - FACULTY REPORT</h2>
        <p>Generated Date: ${new Date().toLocaleDateString('en-IN')}</p>
        ${content}
      </body>
    </html>
  `);
  win.document.close();
});

// ==============================================
// TEACHER ID CARD & STATUS ACTIONS
// ==============================================
window.generateTeacherIdCard = function(empId) {
  const teacher = (teacherState.teachers || []).find(t => t.empId === empId);
  if (!teacher) return alert('Teacher details not found.');

  const renderBox = document.getElementById('tch-idcard-render-box');
  if (!renderBox) return;

  renderBox.innerHTML = `
    <div style="width: 250px; border-radius: 16px; overflow: hidden; background: #ffffff; color: #0f172a; font-family: 'Segoe UI', sans-serif; border: 2px solid #0f172a; box-shadow: 0 10px 25px rgba(0,0,0,0.15); margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 12px 10px; text-align: center; border-bottom: 3px solid #d97706;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px;">
          <img src="${window.currentSchool?.logo || (window.currentSchool?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg')}" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid #d97706; object-fit: contain;">
          <span style="font-size: 11px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">${(window.currentSchool?.name || 'Garumara Jatiya Vidyalaya').toUpperCase()}</span>
        </div>
        <div style="font-size: 9px; color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">FACULTY IDENTITY CARD</div>
      </div>

      <div style="padding: 14px 12px; text-align: center;">
        <div style="width: 80px; height: 80px; margin: 0 auto 10px auto; border-radius: 50%; overflow: hidden; border: 3px solid #d97706; background: #f1f5f9; display: flex; align-items: center; justify-content: center;">
          ${teacher.photo ? `<img src="${teacher.photo}" style="width: 100%; height: 100%; object-fit: cover;">` : `<span style="font-size: 32px;">👩‍🏫</span>`}
        </div>

        <h3 style="font-size: 14px; font-weight: 900; color: #0f172a; margin: 0 0 2px 0;">${teacher.name}</h3>
        <p style="font-size: 10px; font-weight: 800; color: #d97706; margin: 0 0 8px 0; text-transform: uppercase;">${teacher.designation || (teacher.subject + ' Teacher')}</p>
        
        <div style="font-size: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; text-align: left; line-height: 1.6;">
          <div><strong>EMP ID:</strong> <span style="font-family: monospace; font-weight: 800; color: #0f172a;">${teacher.empId}</span></div>
          <div><strong>Class Teacher:</strong> ${teacher.classTeacher || 'None'}</div>
          <div><strong>Subject:</strong> ${teacher.subject || 'General'}</div>
          <div><strong>Mobile:</strong> ${teacher.mobile}</div>
          <div><strong>Blood Group:</strong> ${teacher.bloodGroup || 'O+'}</div>
          <div><strong>Joining Date:</strong> ${teacher.joiningDate}</div>
        </div>

        <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; color: #475569;">
          <div>
            <span style="display: block; font-weight: 800; color: #16a34a;">● ACTIVE FACULTY</span>
          </div>
          <div style="text-align: center;">
            <div style="font-family: 'Great Vibes', cursive, sans-serif; font-size: 14px; color: #d97706; font-weight: bold;">Anarul Hussain</div>
            <span style="font-size: 8px; border-top: 1px solid #94a3b8; display: block; padding-top: 2px;">Principal Signature</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById('tch-idcard-modal');
  if (modal) modal.classList.remove('hidden');
};

window.toggleTeacherStatus = async function(empId) {
  const teacher = (teacherState.teachers || []).find(t => t.empId === empId);
  if (!teacher) return;

  const newStatus = teacher.status === 'Active' ? 'Inactive' : 'Active';
  if (!confirm(`Change status of teacher ${teacher.name} (${empId}) to ${newStatus}?`)) return;

  try {
    await ApiService.updateTeacher(empId, { status: newStatus });
    alert(`✅ Teacher status updated to ${newStatus}`);
    await loadTeacherStats();
    await loadTeacherDirectory();
  } catch (err) {
    alert('Failed to update status: ' + err.message);
  }
};

document.getElementById('tch-idcard-modal-close')?.addEventListener('click', () => {
  document.getElementById('tch-idcard-modal')?.classList.add('hidden');
});
document.getElementById('tch-idcard-close-btn')?.addEventListener('click', () => {
  document.getElementById('tch-idcard-modal')?.classList.add('hidden');
});
document.getElementById('tch-idcard-print-btn')?.addEventListener('click', () => {
  const content = document.getElementById('tch-idcard-render-box')?.innerHTML;
  if (!content) return;
  const win = window.open('', '_blank');
  win.document.write(`<html><head><meta charset="UTF-8"><script src="/js/icon-runtime.js" defer></script><title>Print Teacher ID Card</title></head><body onload="window.print()">${content}</body></html>`);
  win.document.close();
});

// Export CSV
document.getElementById('tch-export-csv-btn')?.addEventListener('click', () => {
  const list = teacherState.teachers;
  if (!list.length) return alert('No teacher records to export.');
  
  let csv = 'Emp ID,Full Name,Gender,Mobile,Email,Subject,Class Teacher,Qualification,Experience,Joining Date,Salary,Status\n';
  list.forEach(t => {
    csv += `"${t.empId}","${t.name}","${t.gender}","${t.mobile}","${t.email}","${t.subject}","${t.classTeacher}","${t.qualification}","${t.experience}","${t.joiningDate}","${t.salary}","${t.status}"\n`;
  });

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GJV_Teacher_Directory_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
});

// Export PDF
document.getElementById('tch-export-pdf-btn')?.addEventListener('click', () => {
  window.print();
});


// ================= ONLINE ADMISSION APPLICATIONS =================
let admissionApplicationsCache = [];
let admissionApplicationsRefreshTimer = null;
const admissionEscape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const admissionStatusClass = status => ({ New:'bg-cyan-100 text-cyan-700', 'Pending Review':'bg-amber-100 text-amber-700', Approved:'bg-green-100 text-green-700', Rejected:'bg-red-100 text-red-700', 'Waiting List':'bg-violet-100 text-violet-700' }[status] || 'bg-slate-100 text-slate-700');

async function loadAdmissionApplications() {
  const table = document.getElementById('admission-applications-table');
  if (!table) return;
  table.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-500">Loading applications...</td></tr>';
  try {
    const response = await ApiService.getAdmissionApplications({
      search: document.getElementById('admission-app-search')?.value.trim() || '',
      status: document.getElementById('admission-app-status')?.value || 'All',
      session: document.getElementById('admission-app-session')?.value.trim() || '',
      classApplied: document.getElementById('admission-app-class')?.value || '',
      date: document.getElementById('admission-app-date')?.value || ''
    });
    admissionApplicationsCache = response.applications || [];
    const counts = response.summary || {};
    ['total','new','pendingReview','approved','rejected'].forEach(key => {
      const element = document.getElementById('admission-count-' + key);
      if (element) element.textContent = counts[key] || 0;
    });
    if (!admissionApplicationsCache.length) {
      table.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-500">No online admission applications found.</td></tr>';
    } else {
      table.innerHTML = admissionApplicationsCache.map(application => {
        const id = admissionEscape(application.id);
        const canReview = !application.convertedStudentAdmissionNo && !['Approved','Rejected'].includes(application.applicationStatus);
        const photo = application.studentPhoto ? '<img src="' + admissionEscape(application.studentPhoto) + '" alt="' + admissionEscape(application.studentName) + '" class="w-10 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700">' : '<span class="text-[10px] text-slate-400">No photo</span>';
        return '<tr class="border-t border-slate-100 dark:border-slate-800 align-top"><td class="p-3 font-bold whitespace-nowrap">' + admissionEscape(application.applicationNumber) + '</td><td class="p-3">' + photo + '</td><td class="p-3 font-semibold text-slate-900 dark:text-white">' + admissionEscape(application.studentName) + '</td><td class="p-3 whitespace-nowrap">' + admissionEscape(application.classApplied) + '</td><td class="p-3 whitespace-nowrap">' + admissionEscape(application.academicSession) + '</td><td class="p-3">' + admissionEscape(application.fatherName || '?') + '</td><td class="p-3">' + admissionEscape(application.motherName || '?') + '</td><td class="p-3 whitespace-nowrap">' + admissionEscape(application.mobileNumber) + '</td><td class="p-3 whitespace-nowrap">' + admissionEscape(application.applicationDate) + '</td><td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-bold whitespace-nowrap ' + admissionStatusClass(application.applicationStatus) + '">' + admissionEscape(application.applicationStatus) + '</span></td><td class="p-3"><div class="flex justify-end flex-wrap gap-1 min-w-[190px]"><button data-admission-action="view" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">View</button><button data-admission-action="edit" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-blue-100 text-blue-700">Edit</button>' + (canReview ? '<button data-admission-action="approve" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-green-100 text-green-700">Approve</button><button data-admission-action="reject" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-red-100 text-red-700">Reject</button>' : '') + '<button data-admission-action="print" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700">Print</button><button data-admission-action="pdf" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-violet-100 text-violet-700">PDF</button>' + (!application.convertedStudentAdmissionNo ? '<button data-admission-action="delete" data-id="' + id + '" class="px-2 py-1 rounded-lg bg-slate-100 text-slate-600">Delete</button>' : '') + '</div></td></tr>';
      }).join('');
    }
    bindAdmissionApplicationControls();
    if (!admissionApplicationsRefreshTimer) admissionApplicationsRefreshTimer = setInterval(() => { if (state.currentTab === 'online-admissions') loadAdmissionApplications(); }, 10000);
  } catch (error) {
    console.error('[ONLINE ADMISSION APPLICATION LIST]', error);
    table.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-red-600">' + admissionEscape(error.message || 'Failed to load applications.') + '</td></tr>';
  }
}

function bindAdmissionApplicationControls() {
  const panel = document.getElementById('admission-applications-panel');
  if (!panel || panel.dataset.bound === 'true') return;
  panel.dataset.bound = 'true';
  document.getElementById('refresh-admission-applications')?.addEventListener('click', loadAdmissionApplications);
  ['admission-app-status','admission-app-class','admission-app-date'].forEach(id => document.getElementById(id)?.addEventListener('change', loadAdmissionApplications));
  let timer;
  ['admission-app-search','admission-app-session'].forEach(id => document.getElementById(id)?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadAdmissionApplications, 300); }));
  panel.addEventListener('click', async event => {
    const button = event.target.closest('[data-admission-action]');
    if (!button) return;
    const application = admissionApplicationsCache.find(item => item.id === button.dataset.id);
    if (!application) return alert('Application is no longer available. Refresh the list.');
    const action = button.dataset.admissionAction;
    try {
      if (action === 'view') return showAdmissionApplication(application);
      if (action === 'edit') return showEditAdmissionApplication(application);
      if (action === 'print') return printAdmissionApplication(application);
      if (action === 'pdf') return downloadAdmissionApplicationPdf(application);
      if (action === 'approve') {
        if (!confirm('Approve this application and create the student in Student Directory?')) return;
        button.disabled = true;
        const result = await ApiService.processAdmissionApplication(application.id, 'approve');
        alert('Application approved. Student ID: ' + result.student.admissionNo);
      } else if (action === 'reject') {
        const remarks = prompt('Enter the rejection reason:');
        if (remarks === null) return;
        if (!remarks.trim()) return alert('A rejection reason is required.');
        button.disabled = true;
        await ApiService.processAdmissionApplication(application.id, 'reject', { remarks });
        alert('Application rejected.');
      } else if (action === 'delete') {
        if (!confirm('Delete this application? This cannot delete a converted student.')) return;
        button.disabled = true;
        await ApiService.deleteAdmissionApplication(application.id);
        alert('Application deleted.');
      }
      await loadAdmissionApplications();
    } catch (error) {
      console.error('[ONLINE ADMISSION APPLICATION ACTION]', error);
      alert(error.message || 'Unable to process the application.');
      button.disabled = false;
    }
  });
}

function admissionApplicationDocument(application) {
  const fields = [['Application Number', application.applicationNumber], ['Status', application.applicationStatus], ['Student Name', application.studentName], ['Date of Birth', application.dateOfBirth], ['Gender', application.gender], ['Applied Class', application.classApplied], ['Academic Session', application.academicSession], ["Father's Name", application.fatherName], ["Mother's Name", application.motherName], ['Mobile', application.mobileNumber], ['Alternate Mobile', application.alternateMobile], ['Email', application.email], ['Address', application.address], ['Student Aadhaar', application.studentAadhaar], ['Father Aadhaar', application.fatherAadhaar], ['Previous School', application.previousSchool], ['Submission Date', application.applicationDate], ['Remarks', application.message]];
  const documents = (application.uploadedDocuments || []).map((document, index) => '<a href="' + admissionEscape(document.data) + '" download="' + admissionEscape(document.name || 'document-' + (index + 1)) + '" style="color:#2563eb">' + admissionEscape(document.name || 'Document ' + (index + 1)) + '</a>').join(', ') || 'None';
  const schoolName = window.currentSchool?.name || (window.currentSchool?.id === 'school_gjv_default' ? 'Garumara Jatiya Vidyalaya' : 'School ERP');
  const fallbackLogo = window.currentSchool?.id === 'school_gjv_default' ? '/logo.jpg' : '/neutral-school-logo.svg';
  const schoolLogo = window.currentSchool?.logo || fallbackLogo;
  const logoHtml = '<img src="' + admissionEscape(schoolLogo) + '" alt="School Logo" style="width:48px;height:48px;object-fit:contain;float:left;margin-right:12px;border-radius:50%;border:1px solid #cbd5e1">';
  return '<div id="admission-application-print" style="font-family:Arial,sans-serif;background:#fff;color:#0f172a;padding:32px;max-width:800px;margin:auto"><div style="overflow:hidden;margin-bottom:20px;border-bottom:2px solid #0f172a;padding-bottom:12px">' + logoHtml + '<div style="float:left"><h1 style="font-size:22px;margin:0 0 4px;text-transform:uppercase">' + admissionEscape(schoolName) + '</h1><h2 style="font-size:15px;margin:0;color:#64748b">Online Admission Application</h2></div>' + (application.studentPhoto ? '<img src="' + admissionEscape(application.studentPhoto) + '" alt="Student photo" style="width:96px;height:120px;object-fit:cover;float:right;border:1px solid #cbd5e1">' : '') + '</div><table style="width:100%;border-collapse:collapse">' + fields.map(field => '<tr><th style="text-align:left;width:34%;padding:8px;border:1px solid #e2e8f0;background:#f8fafc">' + admissionEscape(field[0]) + '</th><td style="padding:8px;border:1px solid #e2e8f0">' + admissionEscape(field[1] || '—') + '</td></tr>').join('') + '<tr><th style="text-align:left;padding:8px;border:1px solid #e2e8f0;background:#f8fafc">Uploaded Documents</th><td style="padding:8px;border:1px solid #e2e8f0">' + documents + '</td></tr></table></div>';
}

function showAdmissionApplication(application) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4';
  modal.innerHTML = '<div class="bg-white dark:bg-slate-950 rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-auto p-4"><div class="flex justify-end"><button type="button" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800">Close</button></div>' + admissionApplicationDocument(application) + '</div>';
  modal.querySelector('button').addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

function showEditAdmissionApplication(application) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4';
  const input = (name, label, type='text') => '<label class="space-y-1"><span class="block text-xs text-slate-500">' + label + '</span><input name="' + name + '" type="' + type + '" value="' + admissionEscape(application[name] || '') + '" class="w-full rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900" required></label>';
  const locked = !!application.convertedStudentAdmissionNo;
  modal.innerHTML = '<div class="bg-white dark:bg-slate-950 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6"><h3 class="text-xl font-bold mb-4">Edit Online Admission Application</h3><form class="grid grid-cols-1 md:grid-cols-2 gap-4">' + input('studentName','Student Name') + input('dateOfBirth','Date of Birth','date') + input('classApplied','Applied Class') + input('academicSession','Academic Session') + input('fatherName','Father Name') + input('motherName','Mother Name') + input('mobileNumber','Mobile Number','tel') + input('alternateMobile','Alternate Mobile','tel') + input('email','Email','email') + input('previousSchool','Previous School') + '<label class="space-y-1"><span class="block text-xs text-slate-500">Status</span><select name="applicationStatus" class="w-full rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900" ' + (locked ? 'disabled' : '') + '><option>New</option><option>Pending Review</option><option>Waiting List</option><option>Rejected</option>' + (application.applicationStatus === 'Approved' ? '<option>Approved</option>' : '') + '</select></label><label class="space-y-1"><span class="block text-xs text-slate-500">Admin Remarks</span><input name="adminRemarks" value="' + admissionEscape(application.adminRemarks || '') + '" class="w-full rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"></label><label class="md:col-span-2 space-y-1"><span class="block text-xs text-slate-500">Address</span><textarea name="address" class="w-full rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">' + admissionEscape(application.address || '') + '</textarea></label><div class="md:col-span-2 flex justify-end gap-3 pt-3"><button type="button" data-close class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800">Cancel</button><button type="submit" class="px-5 py-2 rounded-xl bg-amber-500 text-slate-900 font-bold">Save Changes</button></div></form></div>';
  const form = modal.querySelector('form');
  form.elements.applicationStatus.value = application.applicationStatus;
  modal.querySelector('[data-close]').addEventListener('click', () => modal.remove());
  form.addEventListener('submit', async event => {
    event.preventDefault(); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { const data = Object.fromEntries(new FormData(form).entries()); if (locked) data.applicationStatus = 'Approved'; await ApiService.updateAdmissionApplication(application.id, data); modal.remove(); await loadAdmissionApplications(); alert('Application updated successfully.'); }
    catch (error) { console.error('[EDIT ONLINE ADMISSION]', error); alert(error.message || 'Unable to update application.'); submit.disabled = false; }
  });
  document.body.appendChild(modal);
}

function printAdmissionApplication(application) {
  const popup = window.open('', '_blank', 'width=900,height=900');
  if (!popup) return alert('Please allow pop-ups to print the application.');
  popup.document.write('<!doctype html><html><head><meta charset="UTF-8"><title>' + admissionEscape(application.applicationNumber) + '</title></head><body>' + admissionApplicationDocument(application) + '<script>window.onload=()=>window.print()<\/script></body></html>');
  popup.document.close();
}

async function downloadAdmissionApplicationPdf(application) {
  if (typeof html2pdf === 'undefined') throw new Error('PDF library is unavailable. Please reload and try again.');
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;background:white;z-index:-1';
  wrapper.innerHTML = admissionApplicationDocument(application);
  document.body.appendChild(wrapper);
  try {
    await Promise.all(Array.from(wrapper.querySelectorAll('img')).map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = image.onerror = resolve; })));
    await html2pdf().set({ margin:8, filename:application.applicationNumber + '.pdf', image:{ type:'jpeg', quality:0.98 }, html2canvas:{ scale:2, useCORS:true }, jsPDF:{ unit:'mm', format:'a4', orientation:'portrait' } }).from(wrapper.firstElementChild).save();
  } finally { wrapper.remove(); }
}



document.getElementById('academic-session-cancel')?.addEventListener('click', resetAcademicSessionForm);
document.getElementById('academic-session-form')?.addEventListener('submit', async event => { event.preventDefault(); const id=document.getElementById('academic-session-id').value, button=document.getElementById('academic-session-save'); const payload={session_name:document.getElementById('academic-session-name').value,start_date:document.getElementById('academic-session-start').value,end_date:document.getElementById('academic-session-end').value,status:document.getElementById('academic-session-status').value,is_active:document.getElementById('academic-session-active').checked}; button.disabled=true; try { if(id) { await ApiService.updateAcademicSession(id,payload); if(payload.is_active) await ApiService.activateAcademicSession(id); } else await ApiService.createAcademicSession(payload); resetAcademicSessionForm(); await loadAcademicSessions(); showAcademicSessionMessage(id?'Academic session updated successfully.':'Academic session created successfully.'); } catch(error){ console.error('Academic session save failed:',error); showAcademicSessionMessage(error.message,true); } finally { button.disabled=false; } });
document.getElementById('academic-sessions-tbody')?.addEventListener('click', async event => { const button=event.target.closest('[data-session-action]'); if(!button)return; const row=academicSessionsCache.find(item=>item.id===button.dataset.id); if(!row)return; try { if(button.dataset.sessionAction==='edit'){ document.getElementById('academic-session-id').value=row.id; document.getElementById('academic-session-name').value=row.session_name; document.getElementById('academic-session-start').value=row.start_date; document.getElementById('academic-session-end').value=row.end_date; document.getElementById('academic-session-status').value=row.status==='Active'?'Closed':row.status; document.getElementById('academic-session-active').checked=row.is_active; document.getElementById('academic-session-cancel').classList.remove('hidden'); document.getElementById('academic-session-save').textContent='Update Session'; return; } if(button.dataset.sessionAction==='activate'){ const old=getCurrentAcademicSession(); if(!confirm('Change Active Academic Session from '+old+' to '+row.session_name+'?'))return; await ApiService.activateAcademicSession(row.id); await loadAcademicSessions(); showAcademicSessionMessage('Active academic session changed to '+row.session_name+'.'); document.dispatchEvent(new CustomEvent('academic-session-changed',{detail:{session:row.session_name}})); } if(button.dataset.sessionAction==='delete'){ if(!confirm('Delete '+row.session_name+'? Sessions containing records will be archived instead.'))return; await ApiService.deleteAcademicSession(row.id); await loadAcademicSessions(); showAcademicSessionMessage('Unused academic session deleted.'); } } catch(error){ console.error('Academic session action failed:',error); showAcademicSessionMessage(error.message,true); } });
loadAcademicSessions().catch(error => console.error('Initial academic session load failed:', error));

document.getElementById('dashboard-session-filter')?.addEventListener('change', loadDashboard);
document.getElementById('fee-structure-session')?.addEventListener('change', loadFeeStructureConfigurator);
document.getElementById('fee-rpt-session')?.addEventListener('change', loadFeeReportsAndAudit);
document.addEventListener('academic-session-changed', async () => { hydrateAcademicSessionControls(); await Promise.allSettled([loadDashboard(), loadFeeDashboardMetrics()]); });

document.getElementById('notice-session-filter')?.addEventListener('change', loadNoticesTab);

document.getElementById('legacy-filter-session')?.addEventListener('change', loadLegacyDueManagement);


const WA_TEMPLATE_KEYS=['admission_confirmation','fee_payment_confirmation','fee_due_reminder','fee_overdue_reminder','hello_world','student_absent_alert','exam_notice','school_notice'];
const WA_AUTOMATION={admissionConfirmation:'Admission Confirmation',feePaymentConfirmation:'Fee Payment Confirmation',feeDueReminder:'Fee Due Reminder',overdueReminder:'Overdue Reminder',absentAlert:'Absent Alert',examNotification:'Exam Notification',schoolNotices:'School Notices'};
let whatsappSettingsState=null;
function waMessage(text,error=false){const el=document.getElementById('wa-message');if(el){el.textContent=text;el.className='text-xs '+(error?'text-rose-600':'text-emerald-600')}}
function renderWhatsAppSettings(s){whatsappSettingsState=s;document.getElementById('wa-enabled').checked=!!s.enabled;document.getElementById('wa-mode').value=s.mode||'TEST';document.getElementById('wa-phone-id').value=s.phoneNumberId||'';document.getElementById('wa-waba-id').value=s.wabaId||'';document.getElementById('wa-version').value=s.graphApiVersion||'v23.0';document.getElementById('wa-token').value='';document.getElementById('wa-token').placeholder=s.accessTokenConfigured?'Saved securely '+(s.accessTokenHint||''):'Enter Meta Access Token';document.getElementById('wa-verify-token').value='';document.getElementById('wa-verify-token').placeholder=s.verifyTokenConfigured?'Saved securely':'Enter webhook verify token';const t=document.getElementById('wa-templates');t.innerHTML=WA_TEMPLATE_KEYS.map(k=>'<div class="grid grid-cols-[1fr_7rem] gap-2 items-end"><label>'+k.replaceAll('_',' ')+'<input class="wa-field wa-template" data-key="'+k+'" value="'+subjectHtmlEscape(s.templates?.[k]||'')+'" placeholder="Meta-approved template name"></label><label>Language<input class="wa-field wa-template-language" data-key="'+k+'" value="'+subjectHtmlEscape(s.templateLanguages?.[k]||'')+'" placeholder="en or en_US"></label></div>').join('');const a=document.getElementById('wa-automation');a.innerHTML=Object.entries(WA_AUTOMATION).map(([k,v])=>'<label class="flex items-center gap-2"><input type="checkbox" class="wa-auto" data-key="'+k+'" '+(s.automation?.[k]?'checked':'')+'> '+v+'</label>').join('');const testSelect=document.getElementById('wa-test-template');testSelect.innerHTML='<option value="">Plain text (requires open 24-hour conversation)</option>'+WA_TEMPLATE_KEYS.map(k=>'<option value="'+k+'">'+(k==='hello_world'?'hello_world (Public test number only)':k)+'</option>').join('');if(s.templates?.fee_due_reminder)testSelect.value='fee_due_reminder';renderWhatsAppTestParams()}
const WA_TEST_PARAM_LABELS={fee_due_reminder:['Fee Month','Student Name','Class','Fee Amount','Due Date'],fee_overdue_reminder:['Fee Month','Student Name','Class','Pending Amount','Due Date']};
function renderWhatsAppTestParams(){const key=document.getElementById('wa-test-template')?.value||'',box=document.getElementById('wa-test-template-params'),labels=WA_TEST_PARAM_LABELS[key];if(!box)return;if(!labels){box.innerHTML='';box.classList.add('hidden');return}box.classList.remove('hidden');box.innerHTML=labels.map((label,index)=>'<label class="text-xs">'+label+'<input class="wa-field wa-test-param" data-index="'+index+'" placeholder="'+label+'" required></label>').join('')}
function collectWhatsAppTestParams(){return [...document.querySelectorAll('.wa-test-param')].sort((a,b)=>Number(a.dataset.index)-Number(b.dataset.index)).map(input=>input.value.trim())}
async function loadWhatsAppLogs(){const body=document.getElementById('wa-logs');if(!body)return;body.innerHTML='<tr><td colspan="8" class="p-6 text-center">Loading...</td></tr>';try{const rows=await ApiService.getWhatsAppLogs();body.innerHTML=rows.length?rows.map(x=>'<tr class="border-t border-slate-100 dark:border-slate-800"><td class="p-3">'+subjectHtmlEscape(x.studentName||x.studentId||'?')+'</td><td class="p-3 font-mono">'+subjectHtmlEscape(x.mobileNumber)+'</td><td class="p-3">'+subjectHtmlEscape(x.messageType)+'</td><td class="p-3">'+subjectHtmlEscape(x.templateName||'?')+'</td><td class="p-3 font-mono max-w-40 truncate">'+subjectHtmlEscape(x.metaMessageId||'?')+'</td><td class="p-3 font-bold">'+subjectHtmlEscape(x.status)+'</td><td class="p-3">'+subjectHtmlEscape(x.readTime||x.deliveredTime||x.sentTime||x.updatedAt||'?')+'</td><td class="p-3 text-rose-600">'+subjectHtmlEscape(x.errorMessage||'')+'</td></tr>').join(''):'<tr><td colspan="8" class="p-6 text-center text-slate-500">No WhatsApp messages have been sent.</td></tr>'}catch(e){body.innerHTML='<tr><td colspan="8" class="p-6 text-center text-rose-600">'+subjectHtmlEscape(e.message)+'</td></tr>'}}
async function loadWhatsAppTab(){try{const s=await ApiService.getWhatsAppSettings();renderWhatsAppSettings(s);await loadWhatsAppLogs();waMessage('Configuration loaded.')}catch(e){console.error('WhatsApp settings load failed:',e);waMessage(e.message,true)}}
function collectWhatsAppSettings(){const templates={},templateLanguages={},automation={};document.querySelectorAll('.wa-template').forEach(x=>templates[x.dataset.key]=x.value.trim());document.querySelectorAll('.wa-template-language').forEach(x=>templateLanguages[x.dataset.key]=x.value.trim());document.querySelectorAll('.wa-auto').forEach(x=>automation[x.dataset.key]=x.checked);return{enabled:document.getElementById('wa-enabled').checked,mode:document.getElementById('wa-mode').value,accessToken:document.getElementById('wa-token').value.trim(),phoneNumberId:document.getElementById('wa-phone-id').value.trim(),wabaId:document.getElementById('wa-waba-id').value.trim(),graphApiVersion:document.getElementById('wa-version').value.trim(),verifyToken:document.getElementById('wa-verify-token').value.trim(),templates,templateLanguages,automation}}
document.getElementById('wa-save')?.addEventListener('click',async function(){this.disabled=true;waMessage('Saving configuration...');try{renderWhatsAppSettings(await ApiService.saveWhatsAppSettings(collectWhatsAppSettings()));waMessage('WhatsApp configuration saved securely.')}catch(e){waMessage(e.message,true)}finally{this.disabled=false}});
document.getElementById('wa-save-templates')?.addEventListener('click',async function(){this.disabled=true;try{const templates={},templateLanguages={};document.querySelectorAll('.wa-template').forEach(x=>templates[x.dataset.key]=x.value.trim());document.querySelectorAll('.wa-template-language').forEach(x=>templateLanguages[x.dataset.key]=x.value.trim());await ApiService.saveWhatsAppTemplates({templates,templateLanguages});waMessage('Template mappings saved.')}catch(e){waMessage(e.message,true)}finally{this.disabled=false}});
document.getElementById('wa-test-connection')?.addEventListener('click',async function(){this.disabled=true;waMessage('Testing Meta connection...');try{const s=await ApiService.getWhatsAppStatus(),el=document.getElementById('wa-status');el.textContent=s.status;el.className='px-3 py-1 rounded-full text-xs font-bold '+(s.status==='Connected'?'bg-emerald-100 text-emerald-700':s.status==='Error'?'bg-rose-100 text-rose-700':'bg-slate-100');waMessage(s.status==='Connected'?'Connected to '+(s.verifiedName||s.phone||'Meta WhatsApp'):(s.error||s.status),s.status!=='Connected')}catch(e){waMessage(e.message,true)}finally{this.disabled=false}});
document.getElementById('wa-test-template')?.addEventListener('change',renderWhatsAppTestParams);
document.getElementById('wa-test-send')?.addEventListener('click',async function(){this.disabled=true;this.textContent='Sending...';try{const templateKey=document.getElementById('wa-test-template').value,testValues=collectWhatsAppTestParams();await ApiService.sendWhatsAppTest({mobileNumber:document.getElementById('wa-recipient').value,templateKey,testValues});waMessage('Sent successfully.');await loadWhatsAppLogs()}catch(e){waMessage(e.message,true)}finally{this.disabled=false;this.textContent='Send Test Message'}});
document.getElementById('wa-refresh-logs')?.addEventListener('click',loadWhatsAppLogs);


document.getElementById('swd-bulk-overdue-reminder-btn')?.addEventListener('click',async function(){const rows=(swdState.allDues||[]).filter(x=>swdState.selectedIds.has(x.admissionNo)&&String(x.dueStatus).toLowerCase()==='overdue');if(!rows.length)return alert('Select at least one overdue student.');if(!confirm('Send WhatsApp overdue reminders to '+rows.length+' selected students?'))return;this.disabled=true;this.textContent='Sending...';try{const out=await ApiService.sendFeeReminders(rows.map(x=>x.admissionNo),document.getElementById('swd-filter-month')?.value||'','overdue',(academicSessionsCache.find(row=>row.session_name===(document.getElementById('swd-filter-session')?.value||getSelectedFeeAcademicSession(true).name))||getSelectedFeeAcademicSession(true)).id);if(out.failed)throw new Error(out.error||out.failed+' reminder(s) failed.');alert(feeReminderResultMessage(out, 'Overdue reminders'))}catch(e){alert(e.message)}finally{this.disabled=false;this.textContent='Send Overdue Reminder'}});
