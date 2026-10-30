let teacherCurrentAcademicSession = '';
let teacherCurrentAcademicSessionId = '';
let teacherAcademicSessions = [];
function teacherAcademicSessionFallback(){ const now=new Date(), year=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1; return year+'-'+String(year+1).slice(-2); }
function getTeacherCurrentAcademicSession(){ return teacherCurrentAcademicSession || teacherAcademicSessionFallback(); }
const teacherAcademicSessionsReady=fetch('/api/academic-sessions').then(response=>response.ok?response.json():Promise.reject(new Error('Academic session request failed'))).then(data=>{teacherAcademicSessions=data.sessions||[];teacherCurrentAcademicSession=data.currentSession?.session_name||'';teacherCurrentAcademicSessionId=data.currentSession?.id||'';return data}).catch(error=>{console.error('Teacher academic session load failed:',error);return{sessions:[]}});
function getTeacherAcademicSessionId(name){return String(teacherAcademicSessions.find(row=>row.session_name===name)?.id||(name===teacherCurrentAcademicSession?teacherCurrentAcademicSessionId:'')||'')}

// Teacher Dashboard Logic
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('teacherToken');
  if (!token) {
    window.location.href = '/teacher-login';
    return;
  }

  await teacherAcademicSessionsReady;
  let teacherProfile = null;

  // Mobile Drawer Toggle Handlers
  const drawer = document.getElementById('tch-mobile-drawer');
  const toggleBtn = document.getElementById('tch-mobile-menu-toggle');
  const closeBtn = document.getElementById('tch-mobile-drawer-close');
  const backdrop = document.getElementById('tch-mobile-drawer-backdrop');

  function openMobileDrawer() {
    if (drawer) drawer.classList.remove('hidden');
  }
  function closeMobileDrawer() {
    if (drawer) drawer.classList.add('hidden');
  }

  toggleBtn?.addEventListener('click', openMobileDrawer);
  closeBtn?.addEventListener('click', closeMobileDrawer);
  backdrop?.addEventListener('click', closeMobileDrawer);

  // Logout Handlers (Desktop & Mobile)
  const handleLogout = () => {
    if (confirm('Are you sure you want to log out of Teacher Dashboard?')) {
      localStorage.removeItem('teacherToken');
      localStorage.removeItem('teacherUser');
      window.location.href = '/teacher-login';
    }
  };
  document.getElementById('tch-logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('tch-mob-logout-btn')?.addEventListener('click', handleLogout);

  // Fetch Teacher Profile
  try {
    const res = await fetch('/api/teacher/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        alert('Session expired or unauthorized. Please log in again.');
        localStorage.removeItem('teacherToken');
        window.location.href = '/teacher-login';
        return;
      }
      throw new Error('Failed to load profile.');
    }

    teacherProfile = await res.json();

    // Enforce subdomain and school tenant match on school subdomains
    const hostnameParts = window.location.hostname.split('.');
    if (hostnameParts.length > 1 && !['www', 'localhost', '127'].includes(hostnameParts[0].toLowerCase())) {
      const currentSubdomain = hostnameParts[0].toLowerCase();
      if (teacherProfile.school && teacherProfile.school.code && teacherProfile.school.code.toLowerCase() !== currentSubdomain) {
        alert('Your teacher account belongs to a different school domain. Redirecting to login.');
        localStorage.removeItem('teacherToken');
        window.location.href = '/teacher-login';
        return;
      }
    }

    renderHeaderAndProfile(teacherProfile);
    setupSubtabs(teacherProfile);
    window.addEventListener('storage', event => {
      if (event.key === 'gjv_subjects_updated_at') {
        loadTeacherSubjectsDropdown(teacherProfile);
      }
    });

  } catch (err) {
    console.error('Error initializing teacher dashboard:', err);
  }

  function renderHeaderAndProfile(t) {
    if (t.school) {
      const schLogo = document.getElementById('tch-school-logo');
      if (schLogo && t.school.logo) schLogo.src = t.school.logo;
      const schName = document.getElementById('tch-school-name');
      if (schName && t.school.name) schName.textContent = t.school.name;
      if (t.school.name) document.title = `${t.school.name} — Faculty Portal`;
      if (t.school.favicon) {
        let fav = document.querySelector("link[rel*='icon']");
        if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); }
        fav.href = t.school.favicon;
      }
    }

    const nameEls = [document.getElementById('tch-dash-name'), document.getElementById('tch-prof-name'), document.getElementById('tch-mob-dash-name')];
    nameEls.forEach(el => { if (el) el.innerText = t.name || 'Teacher'; });

    const empIdEls = [document.getElementById('tch-dash-empid'), document.getElementById('tch-prof-empid'), document.getElementById('tch-mob-dash-empid')];
    empIdEls.forEach(el => { if (el) el.innerText = t.empId ? `EMP ID: ${t.empId}` : ''; });

    const desigEl = document.getElementById('tch-prof-designation');
    if (desigEl) desigEl.innerText = t.designation || (t.subject ? `${t.subject} Teacher` : 'Senior Teacher');

    const statusEl = document.getElementById('tch-prof-status');
    if (statusEl) statusEl.innerText = `${t.status || 'Active'} Faculty`;

    const asns = t.assignments || [];
    const assignedSubjs = asns.length ? [...new Set(asns.map(a => a.subject_name))].join(', ') : (t.subject || 'General');
    const assignedClasses = (t.classContexts || []).length
      ? t.classContexts.map(context => `${context.class_name} — ${context.section}`).join(', ')
      : (t.classTeacher || 'None');

    const subjEl = document.getElementById('tch-prof-subject');
    if (subjEl) subjEl.innerText = assignedSubjs;

    const classEl = document.getElementById('tch-prof-classteacher');
    if (classEl) classEl.innerText = assignedClasses;

    const tagEl = document.getElementById('tch-roster-class-tag');
    if (tagEl) tagEl.innerText = assignedClasses;

    const typeEl = document.getElementById('tch-prof-type');
    if (typeEl) typeEl.innerText = t.employmentType || 'Permanent';

    const mobEl = document.getElementById('tch-prof-mobile');
    if (mobEl) mobEl.innerText = t.mobile || 'N/A';

    const emailEl = document.getElementById('tch-prof-email');
    if (emailEl) emailEl.innerText = t.email || 'N/A';

    const qualEl = document.getElementById('tch-prof-qualification');
    if (qualEl) qualEl.innerText = t.qualification || 'N/A';

    const joinEl = document.getElementById('tch-prof-joining');
    if (joinEl) joinEl.innerText = t.joiningDate || 'N/A';

    const salEl = document.getElementById('tch-prof-salary');
    if (salEl) salEl.innerText = `₹${Number(t.salary || 25000).toLocaleString('en-IN')}`;

    const addrEl = document.getElementById('tch-prof-address');
    if (addrEl) addrEl.innerText = t.address || 'N/A';

    const photoBox = document.getElementById('tch-prof-photo-box');
    if (photoBox && t.photo) {
      photoBox.innerHTML = `<img src="${t.photo}" class="w-full h-full object-cover rounded-2xl">`;
    }

    const marksSubj = document.getElementById('tch-marks-subject');
    if (marksSubj) marksSubj.value = t.subject || 'Mathematics';

    const attDateInp = document.getElementById('tch-att-mark-date');
    if (attDateInp) attDateInp.value = new Date().toISOString().split('T')[0];
  }

  // Subtab Navigation & Permission Enforcement
  function setupSubtabs(t) {
    const tabs = ['profile', 'roster', 'attendance', 'marks', 'timetable', 'leave', 'myattendance', 'salaries', 'notices', 'password'];
    
    let rawPerms = localStorage.getItem('teacherPermissions');
    let perms = {};
    try { perms = rawPerms ? JSON.parse(rawPerms) : {}; } catch (e) {}

    const tabPermMap = {
      profile: 'view_own_profile',
      roster: 'view_student_list',
      attendance: 'mark_student_attendance',
      marks: 'enter_exam_marks',
      timetable: 'view_timetable',
      leave: 'apply_for_leave',
      myattendance: 'view_own_attendance',
      salaries: 'view_own_salary_slip',
      notices: 'view_notices',
      password: true
    };

    function switchTab(tab) {
      const permKey = tabPermMap[tab];
      const isAllowed = permKey === true || perms[permKey] !== false;
      if (!isAllowed) {
        alert('🚫 Access Denied: You do not have permission to access this section.');
        return;
      }

      tabs.forEach(other => {
        const desktopBtn = document.getElementById(`tch-tab-btn-${other}`);
        const mobBtn = document.getElementById(`tch-mob-tab-btn-${other}`);
        const sec = document.getElementById(`tch-sec-${other}`);
        
        const isTarget = other === tab;
        
        [desktopBtn, mobBtn].forEach(b => {
          if (!b) return;
          if (isTarget) {
            b.classList.add('bg-amber-500/10', 'text-amber-400', 'border', 'border-amber-500/30');
            b.classList.remove('text-slate-400', 'hover:text-white', 'hover:bg-slate-900/60');
          } else {
            b.classList.remove('bg-amber-500/10', 'text-amber-400', 'border', 'border-amber-500/30');
            b.classList.add('text-slate-400', 'hover:text-white', 'hover:bg-slate-900/60');
          }
        });

        if (sec) {
          if (isTarget) sec.classList.remove('hidden');
          else sec.classList.add('hidden');
        }
      });

      closeMobileDrawer();

      // Lazy load data on subtab view
      if (tab === 'roster') loadClassRoster(t);
      else if (tab === 'attendance') loadAttendanceSheet(t);
      else if (tab === 'marks') loadTeacherSubjectsDropdown(t);
      else if (tab === 'leave') loadMyLeaves();
      else if (tab === 'myattendance') loadMyAttendanceHistory(t);
      else if (tab === 'salaries') loadMySalaries(t);
      else if (tab === 'notices') loadNotices();
    }

    tabs.forEach(tab => {
      const desktopBtn = document.getElementById(`tch-tab-btn-${tab}`);
      const mobBtn = document.getElementById(`tch-mob-tab-btn-${tab}`);
      const permKey = tabPermMap[tab];
      const isAllowed = permKey === true || perms[permKey] !== false;

      [desktopBtn, mobBtn].forEach(b => {
        if (!b) return;
        if (!isAllowed) {
          b.classList.add('hidden');
        } else {
          b.classList.remove('hidden');
        }
        b.onclick = () => switchTab(tab);
      });
    });

    // Pre-populate subjects dropdown
    loadTeacherSubjectsDropdown(t);
    initializeClassAssignmentSelectors(t);

    const forceChange = localStorage.getItem('forcePasswordChange');
    if (forceChange === 'true') {
      switchTab('password');
      alert('⚠️ Security Notice: You are logging in with a temporary password. Please update your password to continue.');
    }
  }

  function getTeacherContexts(t) {
    if (t && Array.isArray(t.classContexts) && t.classContexts.length) {
      return t.classContexts;
    }
    const rawClass = t?.classTeacher && t.classTeacher !== 'None' ? t.classTeacher : 'Class I-A';
    const className = rawClass.replace(/-[A-Za-z]+$/, '').trim();
    const section = rawClass.match(/-([A-Za-z]+)$/)?.[1] || 'A';
    return [{
      class_name: className,
      section: section,
      subject_name: t?.subject || 'General',
      academic_session: t?.academicSession || getTeacherCurrentAcademicSession(),
      academic_session_id: getTeacherAcademicSessionId(t?.academicSession || getTeacherCurrentAcademicSession()),
      is_class_teacher: true
    }];
  }

  function populateSelector(selectId, contexts) {
    const select = document.getElementById(selectId);
    if (!select) return;
    if (!contexts || !contexts.length) {
      select.innerHTML = '<option value="">No assigned class</option>';
      return;
    }
    select.innerHTML = contexts.map((context, index) => `
      <option value="${index}">
        ${escapeTeacherHtml(context.class_name)} — ${escapeTeacherHtml(context.section)} (${escapeTeacherHtml(context.academic_session || getTeacherCurrentAcademicSession())})
      </option>
    `).join('');
  }

  function selectedClassContext(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return null;
    const contexts = select._classContexts || [];
    const index = parseInt(select.value, 10);
    return contexts[index] || contexts[0] || null;
  }

  function initializeClassAssignmentSelectors(t) {
    const contexts = getTeacherContexts(t);
    ['tch-roster-assignment-select', 'tch-att-assignment-select'].forEach(id => {
      const select = document.getElementById(id);
      if (select) {
        select._classContexts = contexts;
        populateSelector(id, contexts);
        select.onchange = () => {
          if (id === 'tch-roster-assignment-select') loadClassRoster(t);
          if (id === 'tch-att-assignment-select') loadAttendanceSheet(t);
        };
      }
    });
  }

  async function fetchAssignedStudents(context) {
    if (!context) return [];
    const query = new URLSearchParams({
      className: context.class_name,
      section: context.section,
      academic_session: context.academic_session,
      academic_session_id: context.academic_session_id || getTeacherAcademicSessionId(context.academic_session)
    });
    const res = await fetch(`/api/teacher/students?${query.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Student roster failed (HTTP ${res.status}).`);
    }
    return data.students || [];
  }

  // Class Roster
  async function loadClassRoster(t) {
    const tbody = document.getElementById('tch-roster-tbody');
    if (!tbody) return;

    const context = selectedClassContext('tch-roster-assignment-select');
    if (!context) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-slate-500">No current-session class or section is assigned to this teacher.</td></tr>';
      return;
    }

    try {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-500">Loading active students for ${escapeTeacherHtml(context.class_name)} — ${escapeTeacherHtml(context.section)}...</td></tr>`;
      const students = await fetchAssignedStudents(context);

      if (!students || !students.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-slate-400 font-semibold">No active students found for this assigned class and section.</td></tr>';
        return;
      }

      tbody.innerHTML = students.map(s => `
        <tr class="hover:bg-slate-900/50">
          <td class="px-4 py-3 font-mono text-amber-400 font-bold">${escapeTeacherHtml(s.admissionNo)}</td>
          <td class="px-4 py-3 font-bold text-white">${escapeTeacherHtml(s.name)}</td>
          <td class="px-4 py-3 font-mono font-bold text-slate-400">${escapeTeacherHtml(s.rollNo || '-')}</td>
          <td class="px-4 py-3 text-slate-300">${escapeTeacherHtml(s.fatherName || '-')}</td>
          <td class="px-4 py-3">${escapeTeacherHtml(s.gender || '-')}</td>
          <td class="px-4 py-3 font-mono text-slate-300">${escapeTeacherHtml(s.mobile || '-')}</td>
          <td class="px-4 py-3 font-bold text-blue-400">${escapeTeacherHtml(s.className)}</td>
          <td class="px-4 py-3 font-bold text-amber-400">${escapeTeacherHtml(s.section)}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Error loading roster:', err);
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-rose-400 font-semibold">Unable to load student roster: ${escapeTeacherHtml(err.message)}</td></tr>`;
    }
  }

  // Attendance Sheet
  async function loadAttendanceSheet(t) {
    const tbody = document.getElementById('tch-att-mark-tbody');
    if (!tbody) return;

    const context = selectedClassContext('tch-att-assignment-select');
    if (!context) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-500">No current-session class or section is assigned to this teacher.</td></tr>';
      return;
    }

    try {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-500">Loading active students for ${escapeTeacherHtml(context.class_name)} — ${escapeTeacherHtml(context.section)}...</td></tr>`;
      const students = await fetchAssignedStudents(context);

      if (!students || !students.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400 font-semibold">No students found for this assigned class and section.</td></tr>';
        return;
      }

      const attendanceDate = document.getElementById('tch-att-mark-date')?.value;
      const savedMap = {};
      if (attendanceDate) {
        const attendanceQuery = new URLSearchParams({
          date: attendanceDate,
          className: context.class_name,
          section: context.section,
          academic_session: context.academic_session,
          academic_session_id: context.academic_session_id || getTeacherAcademicSessionId(context.academic_session)
        });
        const attendanceResponse = await fetch(`/api/attendance?${attendanceQuery}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const attendancePayload = await attendanceResponse.json();
        if (!attendanceResponse.ok) {
          throw new Error(attendancePayload.error || `Attendance service failed (HTTP ${attendanceResponse.status}).`);
        }
        attendancePayload.forEach(group => {
          (group.records || []).forEach(record => {
            savedMap[record.student_id || record.studentId || record.admissionNo] = record;
          });
        });
      }

      tbody.innerHTML = students.map(s => {
        const saved = savedMap[s.admissionNo] || {};
        const selectedStatus = saved.status || 'Present';
        const remark = saved.remarks || saved.remark || '';
        const attendanceStatuses = [
          { value: 'Present', color: 'emerald' },
          { value: 'Absent', color: 'rose' },
          { value: 'Late', color: 'amber' },
          { value: 'Half Day', color: 'purple' },
          { value: 'Leave', color: 'blue' }
        ];
        return `
        <tr class="hover:bg-slate-900/50" data-student-id="${escapeTeacherHtml(s.admissionNo)}">
          <td class="px-3 py-3 font-mono font-bold text-slate-400">${escapeTeacherHtml(s.rollNo || '-')}</td>
          <td class="px-3 py-3 font-mono text-amber-400 font-bold">${escapeTeacherHtml(s.admissionNo)}</td>
          <td class="px-3 py-3 font-bold text-white">${escapeTeacherHtml(s.name)}</td>
          <td class="px-3 py-3 text-center">
            <div class="flex flex-wrap items-center justify-center gap-1.5 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
              ${attendanceStatuses.map(item => `
                <label class="flex items-center space-x-1 cursor-pointer bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800/80 min-h-[36px] sm:min-h-[32px]">
                  <input type="radio" name="att_${escapeTeacherHtml(s.admissionNo)}" value="${item.value}" ${selectedStatus === item.value ? 'checked' : ''} class="text-${item.color}-500 focus:ring-${item.color}-500 bg-slate-950">
                  <span class="text-[11px] font-bold text-${item.color}-400">${item.value}</span>
                </label>
              `).join('')}
            </div>
          </td>
          <td class="px-3 py-3">
            <input type="text" id="rem_${escapeTeacherHtml(s.admissionNo)}" value="${escapeTeacherHtml(remark)}" placeholder="Optional remark" class="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white min-h-[38px]">
          </td>
        </tr>
      `}).join('');
    } catch (err) {
      console.error('Error loading attendance sheet:', err);
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-rose-400 font-semibold">Unable to load attendance sheet: ${escapeTeacherHtml(err.message)}</td></tr>`;
    }
  }

  // Save Attendance
  document.getElementById('tch-att-save-btn')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('tch-att-save-btn');
    const originalText = saveBtn ? saveBtn.innerText : 'Submit Attendance';

    const date = document.getElementById('tch-att-mark-date').value;
    if (!date) return alert('Please select attendance date.');

    const context = selectedClassContext('tch-att-assignment-select');
    if (!context) return alert('No assigned class and section is selected.');
    const className = context.class_name;
    const section = context.section;

    const tbody = document.getElementById('tch-att-mark-tbody');
    const rows = tbody.querySelectorAll('tr');
    const records = [];

    rows.forEach(row => {
      const rads = row.querySelectorAll('input[type="radio"]');
      if (rads.length) {
        const admNo = rads[0].name.replace('att_', '');
        let status = 'Present';
        rads.forEach(r => { if (r.checked) status = r.value; });
        const remarkInp = row.querySelector(`input[id="rem_${admNo}"]`);
        const remark = remarkInp ? remarkInp.value : '';

        records.push({
          student_id: admNo,
          status,
          remarks: remark
        });
      }
    });

    if (!records.length) return alert('No student records to save.');

    try {
      if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = '💾 Saving...'; }

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          date,
          className,
          section,
          academic_session: context.academic_session,
          academic_session_id: context.academic_session_id || getTeacherAcademicSessionId(context.academic_session),
          records
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save attendance.');

      alert(`✅ Attendance successfully saved for ${className}-${section} (${date})!`);
      loadAttendanceSheet(teacherProfile);
    } catch (err) {
      alert('Error saving attendance: ' + err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = originalText; }
    }
  });

  // Populate Subjects Dropdown for Exam Marks
  async function loadTeacherSubjectsDropdown(t) {
    const subjSelect = document.getElementById('tch-marks-subject');
    if (!subjSelect) return;

    try {
      const res = await fetch('/api/subjects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const subjects = await res.json();

      if (!subjects || !subjects.length) {
        subjSelect.innerHTML = '<option value="">No subject found. Please add a subject.</option>';
        return;
      }

      // Combine workload assignments with subjects assigned from Subject Master.
      const teacherEmpId = t ? t.empId : (teacherProfile ? teacherProfile.empId : null);
      const assignments = (t && Array.isArray(t.assignments)) ? t.assignments : (teacherProfile?.assignments || []);
      const assignedMasterSubjects = teacherEmpId
        ? subjects.filter(subject => subject.teacherId === teacherEmpId)
        : [];
      if (assignments.length || assignedMasterSubjects.length) {
        const assignmentNames = new Set(assignments.map(assignment => assignment.subject_name));
        const workloadOptions = assignments.map(a => {
          const config = subjects.find(subject =>
            subject.name.toLowerCase() === String(a.subject_name || '').toLowerCase()
          ) || {
            id: 'SBJ-' + (a.subject_name || 'GEN'),
            name: a.subject_name,
            maxMarks: 100,
            passMarks: 33
          };
          return `
          <option value="${escapeTeacherHtml(config.id)}" data-subject-name="${escapeTeacherHtml(a.subject_name)}" data-class="${escapeTeacherHtml(a.class_name)}" data-section="${escapeTeacherHtml(a.section)}" data-session="${escapeTeacherHtml(a.academic_session || t?.academicSession || getTeacherCurrentAcademicSession())}" data-max-marks="${config.maxMarks || 100}" data-pass-marks="${config.passMarks ?? 33}">
            ${a.subject_name} — ${a.class_name}-${a.section} (${a.academic_session || getTeacherCurrentAcademicSession()})
          </option>
        `});
        const masterOptions = assignedMasterSubjects
          .filter(subject => !assignmentNames.has(subject.name))
          .map(subject => {
            const defaultClass = teacherProfile?.classTeacher && teacherProfile.classTeacher !== 'None' ? teacherProfile.classTeacher.replace(/-[A-Za-z]+$/, '').trim() : 'Class I';
            const defaultSec = teacherProfile?.classTeacher && teacherProfile.classTeacher !== 'None' ? (teacherProfile.classTeacher.match(/-([A-Za-z]+)$/)?.[1] || 'A') : 'A';
            const targetClass = subject.className && subject.className !== 'All Classes' ? subject.className : defaultClass;
            const targetSec = subject.section && subject.section !== 'All Sections' ? subject.section : defaultSec;
            return `<option value="${escapeTeacherHtml(subject.id)}" data-subject-name="${escapeTeacherHtml(subject.name)}" data-class="${escapeTeacherHtml(targetClass)}" data-section="${escapeTeacherHtml(targetSec)}" data-session="${escapeTeacherHtml(subject.session || t?.academicSession || getTeacherCurrentAcademicSession())}" data-max-marks="${subject.maxMarks || 100}" data-pass-marks="${subject.passMarks ?? 33}">
              ${subject.name} — ${targetClass}-${targetSec}
            </option>`;
          });
        subjSelect.innerHTML = [...workloadOptions, ...masterOptions].join('');
        return;
      }

      // Legacy fallback for teachers without workload assignment records.
      let relevantSubjects = subjects;
      if (teacherEmpId) {
        const assigned = subjects.filter(s => s.teacherId === teacherEmpId || (teacherProfile && s.name === teacherProfile.subject));
        if (assigned.length) relevantSubjects = assigned;
      }

      const uniqueNames = [...new Set(relevantSubjects.map(s => s.name))];
      subjSelect.innerHTML = uniqueNames.map(name => {
        const config = subjects.find(subject => subject.name === name);
        return `<option value="${escapeTeacherHtml(config?.id || name)}" data-subject-name="${escapeTeacherHtml(name)}" data-session="${escapeTeacherHtml(config?.session || teacherProfile?.academicSession || getTeacherCurrentAcademicSession())}" data-max-marks="${config?.maxMarks || 100}" data-pass-marks="${config?.passMarks ?? 33}" ${teacherProfile && teacherProfile.subject === name ? 'selected' : ''}>${name}</option>`;
      }).join('');

    } catch (err) {
      console.error('Failed to load teacher subjects dropdown:', err);
      subjSelect.innerHTML = '<option value="">No subject found. Please add a subject.</option>';
    }
  }

  function getSelectedTeachingContext(subjectName) {
    const subjectSelect = document.getElementById('tch-marks-subject');
    const selectedOption = subjectSelect?.selectedOptions?.[0];
    if (selectedOption?.dataset?.class) {
      return {
        className: selectedOption.dataset.class,
        section: selectedOption.dataset.section || 'A',
        academicSession: selectedOption.dataset.session || teacherProfile?.academicSession || getTeacherCurrentAcademicSession()
      };
    }

    const assignment = (teacherProfile?.assignments || []).find(a => a.subject_name === subjectName);
    if (assignment) {
      return { className: assignment.class_name, section: assignment.section || 'A', academicSession: assignment.academic_session || teacherProfile?.academicSession || getTeacherCurrentAcademicSession() };
    }

    const rawClass = teacherProfile?.classTeacher && teacherProfile.classTeacher !== 'None'
      ? teacherProfile.classTeacher
      : 'Class I-A';
    return {
      className: rawClass.replace(/-[A-Za-z]+$/, '').trim(),
      section: rawClass.match(/-([A-Za-z]+)$/)?.[1] || 'A',
      academicSession: teacherProfile?.academicSession || getTeacherCurrentAcademicSession()
    };
  }

  function getSelectedSubjectConfig() {
    const selectedOption = document.getElementById('tch-marks-subject')?.selectedOptions?.[0];
    return {
      subjectId: selectedOption?.value || '',
      subjectName: selectedOption?.dataset?.subjectName || selectedOption?.textContent?.split('—')[0]?.trim() || '',
      maxMarks: Number(selectedOption?.dataset?.maxMarks || 100),
      passMarks: Number(selectedOption?.dataset?.passMarks ?? 33),
      academicSession: selectedOption?.dataset?.session || teacherProfile?.academicSession || getTeacherCurrentAcademicSession()
    };
  }

  // Exam marks helpers and central result synchronization
  function calculateGrade(marks, maxMarks = 100, isAbsent = false) {
    if (isAbsent) return { grade: 'ABSENT', color: 'text-rose-400' };
    const val = Number(marks);
    if (!Number.isFinite(val) || val < 0) return { grade: '-', color: 'text-slate-400' };
    const pct = maxMarks > 0 ? (val / maxMarks) * 100 : 0;
    if (pct >= 90) return { grade: 'A+', color: 'text-emerald-400' };
    if (pct >= 80) return { grade: 'A', color: 'text-emerald-400' };
    if (pct >= 70) return { grade: 'B+', color: 'text-amber-400' };
    if (pct >= 60) return { grade: 'B', color: 'text-amber-400' };
    if (pct >= 50) return { grade: 'C', color: 'text-blue-400' };
    if (pct >= 33) return { grade: 'D', color: 'text-amber-500' };
    return { grade: 'F', color: 'text-rose-400' };
  }
  function teacherResultStatus(marks, passMarks, isAbsent) {
    if (isAbsent) return 'ABSENT';
    return Number(marks) >= Number(passMarks) ? 'PASS' : 'FAIL';
  }
  function setTeacherMarksMessage(message, type = 'info') {
    const info = document.getElementById('tch-marks-info-text');
    if (!info) return;
    info.textContent = message;
    info.className = `text-[11px] ${type === 'error' ? 'text-rose-400' : type === 'success' ? 'text-emerald-400' : 'text-slate-400'}`;
  }

  let currentExamMarksSheet = null;
  let isExamMarksSaving = false;

  function updateTeacherMarksRow(row) {
    const absent = Boolean(row.querySelector('[data-marks-absent]')?.checked);
    const input = row.querySelector('[data-marks-input]');
    const gradeEl = row.querySelector('[data-marks-grade]');
    const resultEl = row.querySelector('[data-marks-result]');
    const locked = Boolean(currentExamMarksSheet?.status === 'Submitted' && !window._isExamMarksEditing);
    if (input) {
      input.disabled = absent || locked;
      input.readOnly = locked;
      if (absent) input.value = '';
    }
    const grade = calculateGrade(input?.value, Number(input?.max || 100), absent);
    if (gradeEl) { gradeEl.textContent = grade.grade; gradeEl.className = `px-4 py-3 font-bold ${grade.color}`; }
    if (resultEl) {
      const status = absent ? 'ABSENT' : (input?.value === '' ? '-' : teacherResultStatus(input.value, row.dataset.passMarks, false));
      resultEl.textContent = status;
      resultEl.className = `px-4 py-3 font-black ${status === 'PASS' ? 'text-emerald-400' : status === 'FAIL' || status === 'ABSENT' ? 'text-rose-400' : 'text-slate-400'}`;
    }
  }

  function validateMarksForm() {
    const draftBtn = document.getElementById('tch-marks-draft-btn');
    const submitBtn = document.getElementById('tch-marks-submit-btn');
    const rows = document.querySelectorAll('#tch-marks-tbody tr[data-student-id]');
    let valid = Boolean(document.getElementById('tch-marks-exam')?.value && document.getElementById('tch-marks-subject')?.value && rows.length);

    rows.forEach(row => {
      const absent = row.querySelector('[data-marks-absent]')?.checked;
      const val = row.querySelector('[data-marks-input]')?.value;
      if (!absent) {
        if (val === '' || val === null || val === undefined) valid = false;
        const num = Number(val);
        if (!Number.isFinite(num) || num < 0 || num > Number(row.querySelector('[data-marks-input]')?.max || 100)) valid = false;
      }
    });

    const isSubmitted = currentExamMarksSheet?.status === 'Submitted';
    const isEditing = Boolean(window._isExamMarksEditing);
    const disableControls = isExamMarksSaving || (isSubmitted && !isEditing);

    if (draftBtn) draftBtn.disabled = !valid || disableControls;
    if (submitBtn) submitBtn.disabled = !valid || disableControls;
    return valid;
  }

  document.getElementById('tch-marks-load-btn')?.addEventListener('click', async () => {
    window._isExamMarksEditing = false;
    const tbody = document.getElementById('tch-marks-tbody');
    const statusBadge = document.getElementById('tch-marks-status-badge');
    const editBtn = document.getElementById('tch-marks-edit-btn');
    if (editBtn) editBtn.classList.add('hidden');
    const examName = document.getElementById('tch-marks-exam')?.value || '';
    const { subjectId, subjectName, maxMarks, passMarks } = getSelectedSubjectConfig();
    if (!examName || !subjectId || !subjectName) {
      setTeacherMarksMessage('Please select an Exam Type and Subject first.', 'error');
      return;
    }
    try {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-500">Loading student roster for ${escapeTeacherHtml(subjectName)}...</td></tr>`;
      const { className, section, academicSession } = getSelectedTeachingContext(subjectName);
      const students = await fetchAssignedStudents({ class_name: className, section, academic_session: academicSession });
      if (!students?.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400 font-semibold">No active students found for this assigned class and section.</td></tr>`;
        currentExamMarksSheet = null; validateMarksForm(); return;
      }
      const params = new URLSearchParams({ examName, className, subjectId, session: academicSession });
      if (section !== 'All Sections') params.set('section', section);
      const resultResponse = await fetch(`/api/exam-results?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const savedResults = await resultResponse.json();
      if (!resultResponse.ok) throw new Error(savedResults.error || `Exam results service failed (HTTP ${resultResponse.status}).`);
      const relevant = Array.isArray(savedResults) ? savedResults : [];
      currentExamMarksSheet = relevant.length ? { status: relevant.some(row => row.status === 'Submitted') ? 'Submitted' : 'Draft', marks: relevant } : null;
      const isSubmitted = currentExamMarksSheet?.status === 'Submitted';
      if (statusBadge) {
        statusBadge.textContent = isSubmitted ? 'Submitted & Locked' : currentExamMarksSheet ? 'Saved as Draft' : 'Draft / Unsaved';
        statusBadge.className = isSubmitted ? 'px-3 py-1 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold' : currentExamMarksSheet ? 'px-3 py-1 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold' : 'px-3 py-1 rounded-xl bg-slate-800 text-slate-400 font-bold';
      }
      const canEdit = isSubmitted && (teacherProfile?.permissions?.edit_exam_marks === true || teacherProfile?.permissions?.all === true);
      if (canEdit) editBtn?.classList.remove('hidden');
      const savedMap = new Map(relevant.map(row => [String(row.student_id || row.studentId || row.admission_number || row.admissionNo), row]));
      tbody.innerHTML = students.map(student => {
        const id = student.admissionNo || student.studentId || student.id;
        const saved = savedMap.get(String(id)) || {};
        const absent = saved.attendance_status === 'Absent' || saved.isAbsent === true || saved.result_status === 'ABSENT';
        const savedMarks = saved.marks_obtained ?? saved.marksObtained ?? saved.score;
        const value = absent || savedMarks === null || savedMarks === undefined ? '' : savedMarks;
        const grade = calculateGrade(value, maxMarks, absent);
        const result = absent ? 'ABSENT' : (value === '' ? '-' : (saved.result_status || teacherResultStatus(value, passMarks, false)));
        const locked = isSubmitted ? 'disabled' : '';
        return `<tr class="hover:bg-slate-900/50" data-student-id="${escapeTeacherHtml(id)}" data-student-name="${escapeTeacherHtml(student.name || '')}" data-roll-no="${escapeTeacherHtml(student.rollNo || '')}" data-pass-marks="${passMarks}">
          <td class="px-3 py-3 font-mono text-amber-400 font-bold">${escapeTeacherHtml(id)}</td><td class="px-3 py-3 font-bold text-white">${escapeTeacherHtml(student.name || '')}</td><td class="px-3 py-3 font-mono">${escapeTeacherHtml(student.rollNo || '-')}</td>
          <td class="px-3 py-3 text-center"><input type="checkbox" data-marks-absent ${absent ? 'checked' : ''} ${locked} class="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"><span class="ml-1 text-[10px] text-rose-400">Absent</span></td>
          <td class="px-3 py-3"><input type="number" data-marks-input value="${escapeTeacherHtml(value)}" placeholder="0-${maxMarks}" min="0" max="${maxMarks}" inputmode="decimal" ${absent || isSubmitted ? 'disabled' : ''} class="w-24 sm:w-28 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 font-bold font-mono text-white focus:ring-2 focus:ring-amber-500 outline-none text-base sm:text-xs min-h-[40px]"></td>
          <td class="px-3 py-3 font-mono font-bold text-slate-400">${maxMarks}</td><td data-marks-grade class="px-3 py-3 font-bold ${grade.color}">${grade.grade}</td><td data-marks-result class="px-3 py-3 font-black ${result === 'PASS' ? 'text-emerald-400' : result === '-' ? 'text-slate-400' : 'text-rose-400'}">${escapeTeacherHtml(result)}</td>
          <td class="px-3 py-3"><input type="text" data-marks-remarks value="${escapeTeacherHtml(saved.remarks || saved.remark || '')}" ${locked} placeholder="Optional" class="w-36 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white min-h-[40px]"></td></tr>`;
      }).join('');
      tbody.querySelectorAll('tr[data-student-id]').forEach(row => {
        row.querySelector('[data-marks-input]')?.addEventListener('input', () => { updateTeacherMarksRow(row); validateMarksForm(); });
        row.querySelector('[data-marks-absent]')?.addEventListener('change', () => { updateTeacherMarksRow(row); validateMarksForm(); });
      });
      setTeacherMarksMessage(relevant.length ? `Loaded ${relevant.length} saved result record(s).` : `Loaded ${students.length} students.`, 'success');
      validateMarksForm();
    } catch (error) {
      console.error('Error loading marks sheet:', error);
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-rose-400 font-semibold">Failed to load marks sheet: ${escapeTeacherHtml(error.message)}</td></tr>`;
      setTeacherMarksMessage(error.message, 'error'); validateMarksForm();
    }
  });

  document.getElementById('tch-marks-edit-btn')?.addEventListener('click', () => {
    window._isExamMarksEditing = true;
    document.querySelectorAll('#tch-marks-tbody tr[data-student-id]').forEach(row => {
      row.querySelector('[data-marks-absent]')?.removeAttribute('disabled');
      row.querySelector('[data-marks-remarks]')?.removeAttribute('disabled');
      updateTeacherMarksRow(row);
    });
    const badge = document.getElementById('tch-marks-status-badge'); if (badge) badge.textContent = 'Editing Unlocked';
    setTeacherMarksMessage('Editing unlocked. Submit to synchronize the update.'); validateMarksForm();
  });

  async function saveExamMarks(targetStatus) {
    if (isExamMarksSaving) return;
    const examName = document.getElementById('tch-marks-exam')?.value || '';
    const subjectId = document.getElementById('tch-marks-subject')?.value || '';
    const { subjectName, maxMarks, passMarks } = getSelectedSubjectConfig();
    const rows = [...document.querySelectorAll('#tch-marks-tbody tr[data-student-id]')];
    if (!examName || !subjectId || !subjectName || !rows.length) return setTeacherMarksMessage('Select an exam and load the student roster first.', 'error');
    if (!validateMarksForm()) return setTeacherMarksMessage(`Marks must be between 0 and ${maxMarks}; blank marks require Absent.`, 'error');
    const { className, section, academicSession } = getSelectedTeachingContext(subjectName);
    const marks = rows.map(row => {
      const absent = Boolean(row.querySelector('[data-marks-absent]')?.checked);
      const value = row.querySelector('[data-marks-input]')?.value.trim() || '';
      const marksObtained = absent ? null : Number(value);
      return { studentId: row.dataset.studentId, admissionNo: row.dataset.studentId, name: row.dataset.studentName, rollNo: row.dataset.rollNo, marksObtained, score: marksObtained, maxMarks, passMarks, attendanceStatus: absent ? 'Absent' : 'Present', isAbsent: absent, grade: absent ? 'ABSENT' : calculateGrade(marksObtained, maxMarks).grade, resultStatus: absent ? 'ABSENT' : teacherResultStatus(marksObtained, passMarks, false), remarks: row.querySelector('[data-marks-remarks]')?.value.trim() || '' };
    });
    const draftBtn = document.getElementById('tch-marks-draft-btn'), submitBtn = document.getElementById('tch-marks-submit-btn');
    const activeButton = targetStatus === 'Draft' ? draftBtn : submitBtn;
    const oldText = activeButton?.textContent;
    isExamMarksSaving = true; validateMarksForm(); if (activeButton) activeButton.textContent = targetStatus === 'Draft' ? 'Saving...' : 'Submitting...'; setTeacherMarksMessage(targetStatus === 'Draft' ? 'Saving draft...' : 'Submitting exam marks...');
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ examName, subject: subjectName, subject_id: subjectId, className, class_id: className, section, section_id: section, academic_session: academicSession, session: academicSession, status: targetStatus, marks })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save exam marks.');
      window._isExamMarksEditing = false;
      document.getElementById('tch-marks-load-btn')?.click();
      alert(`✅ Exam marks successfully saved as ${targetStatus} for ${className}-${section} ${subjectName}!`);
    } catch (error) {
      console.error('Error saving exam marks:', error);
      setTeacherMarksMessage(error.message, 'error');
      alert(`❌ Exam Marks Save Error: ${error.message}`);
    } finally {
      isExamMarksSaving = false; if (activeButton && oldText) activeButton.textContent = oldText; validateMarksForm();
    }
  }

  document.getElementById('tch-marks-draft-btn')?.addEventListener('click', () => saveExamMarks('Draft'));
  document.getElementById('tch-marks-submit-btn')?.addEventListener('click', () => saveExamMarks('Submitted'));

  // Leave Application
  document.getElementById('tch-leave-app-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('tch-app-lv-type').value;
    const from = document.getElementById('tch-app-lv-from').value;
    const to = document.getElementById('tch-app-lv-to').value;
    const reason = document.getElementById('tch-app-lv-reason').value;

    if (new Date(to) < new Date(from)) {
      return alert('End date cannot be earlier than start date.');
    }

    try {
      const res = await fetch('/api/teachers/leaves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          leave_type: type,
          from_date: from,
          to_date: to,
          reason: reason
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit leave application.');

      alert('✅ Leave application submitted successfully to School Admin!');
      document.getElementById('tch-leave-app-form').reset();
      loadMyLeaves();
    } catch (err) {
      alert('Error applying for leave: ' + err.message);
    }
  });

  async function loadMyLeaves() {
    const tbody = document.getElementById('tch-my-leaves-tbody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/teachers/leaves', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch leave history.');

      const leaves = Array.isArray(data) ? data : (data.leaves || []);

      if (!leaves.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-500">No leave applications submitted yet.</td></tr>';
        return;
      }

      tbody.innerHTML = leaves.map(l => {
        const badgeColor = l.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                           l.status === 'Rejected' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                           'bg-amber-500/10 text-amber-400 border-amber-500/30';
        return `
        <tr class="hover:bg-slate-900/50">
          <td class="px-4 py-3 font-bold text-white">${escapeTeacherHtml(l.leave_type || l.type || 'Casual Leave')}</td>
          <td class="px-4 py-3 font-mono text-slate-300">${escapeTeacherHtml(l.from_date || l.fromDate)} to ${escapeTeacherHtml(l.to_date || l.toDate)}</td>
          <td class="px-4 py-3 font-mono font-bold text-amber-400">${escapeTeacherHtml(l.total_days || l.days || '-')}</td>
          <td class="px-4 py-3 text-slate-400">${escapeTeacherHtml(l.reason || '-')}</td>
          <td class="px-4 py-3 text-center">
            <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${escapeTeacherHtml(l.status || 'Pending')}</span>
          </td>
        </tr>
      `}).join('');
    } catch (err) {
      console.error('Error loading leave history:', err);
    }
  }

  // Attendance History
  async function loadMyAttendanceHistory(t) {
    const tbody = document.getElementById('tch-my-att-tbody');
    if (!tbody) return;

    try {
      const res = await fetch(`/api/teachers/attendance?empId=${t.empId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const records = await res.json();

      if (!records || !records.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-slate-500">No attendance history logged yet.</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        const badgeColor = r.status === 'Present' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                           r.status === 'Absent' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                           'bg-amber-500/10 text-amber-400 border-amber-500/30';
        return `
        <tr class="hover:bg-slate-900/50">
          <td class="px-4 py-3 font-mono font-bold text-slate-300">${r.date}</td>
          <td class="px-4 py-3 text-center">
            <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${r.status}</span>
          </td>
          <td class="px-4 py-3 text-slate-400">${r.remarks || '-'}</td>
        </tr>
      `;
      }).join('');
    } catch (err) {
      console.error('Error loading attendance history:', err);
    }
  }

  // Salary Slips
  async function loadMySalaries(t) {
    const tbody = document.getElementById('tch-my-salaries-tbody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/teachers/salaries', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const salaries = await res.json();

      const mySalaries = salaries.filter(s => s.empId === t.empId || s.teacherName === t.name);

      if (!mySalaries.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-500">No salary slips generated yet.</td></tr>';
        return;
      }

      tbody.innerHTML = mySalaries.map(s => `
        <tr class="hover:bg-slate-900/50">
          <td class="px-4 py-3 font-mono font-bold text-amber-400">${s.slipNo}</td>
          <td class="px-4 py-3 font-bold text-white">${s.month}</td>
          <td class="px-4 py-3 font-mono font-bold text-emerald-400">₹${Number(s.netSalary).toLocaleString('en-IN')}</td>
          <td class="px-4 py-3">${s.paymentMode}</td>
          <td class="px-4 py-3 font-mono text-slate-400">${s.paidDate}</td>
          <td class="px-4 py-3 text-right">
            <button onclick="window.viewSalarySlip('${s.slipNo}')" class="bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[36px]">
              📄 View Slip
            </button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Error loading salaries:', err);
    }
  }

  window.viewSalarySlip = async function(slipNo) {
    const modal = document.getElementById('tch-slip-modal');
    const renderBox = document.getElementById('tch-slip-render-box');
    if (!modal || !renderBox) return;

    try {
      const res = await fetch('/api/teachers/salaries', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const salaries = await res.json();
      const salary = (salaries || []).find(s => s.slipNo === slipNo);
      if (!salary) throw new Error('Salary slip record not found.');

      const base = Number(salary.baseSalary || teacherProfile?.salary || 0);
      const bonus = Number(salary.bonus || 0);
      const deduction = Number(salary.deduction || 0);
      const net = Number(salary.netSalary || (base + bonus - deduction));

      renderBox.innerHTML = `
        <div style="font-family:Arial,sans-serif;color:#111827;border:2px solid #0f172a;padding:16px;background:#fff;max-width:100%;box-sizing:border-box;">
          <div style="text-align:center;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:14px;">
            <h1 style="margin:0;font-size:20px;font-weight:800;">GARUMARA JATIYA VIDYALAYA</h1>
            <p style="margin:4px 0 0;font-size:11px;color:#4b5563;">Garumara, Nagaon, Assam – 782140</p>
            <h2 style="margin:10px 0 0;font-size:15px;font-weight:700;letter-spacing:0.5px;">FACULTY SALARY SLIP</h2>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">
            <tr><td style="padding:5px;"><strong>Slip No:</strong> ${salary.slipNo}</td><td style="padding:5px;"><strong>Salary Month:</strong> ${salary.month || '-'}</td></tr>
            <tr><td style="padding:5px;"><strong>Employee:</strong> ${salary.teacherName || teacherProfile?.name || '-'}</td><td style="padding:5px;"><strong>Employee ID:</strong> ${salary.empId || teacherProfile?.empId || '-'}</td></tr>
            <tr><td style="padding:5px;"><strong>Payment Mode:</strong> ${salary.paymentMode || '-'}</td><td style="padding:5px;"><strong>Paid Date:</strong> ${salary.paidDate || salary.paymentDate || '-'}</td></tr>
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f1f5f9;"><th style="border:1px solid #94a3b8;padding:8px;text-align:left;">Description</th><th style="border:1px solid #94a3b8;padding:8px;text-align:right;">Amount</th></tr></thead>
            <tbody>
              <tr><td style="border:1px solid #94a3b8;padding:8px;">Basic Salary</td><td style="border:1px solid #94a3b8;padding:8px;text-align:right;">₹${base.toLocaleString('en-IN')}</td></tr>
              <tr><td style="border:1px solid #94a3b8;padding:8px;">Bonus / Allowance</td><td style="border:1px solid #94a3b8;padding:8px;text-align:right;">₹${bonus.toLocaleString('en-IN')}</td></tr>
              <tr><td style="border:1px solid #94a3b8;padding:8px;">Deductions</td><td style="border:1px solid #94a3b8;padding:8px;text-align:right;">₹${deduction.toLocaleString('en-IN')}</td></tr>
              <tr style="font-weight:800;background:#fef3c7;"><td style="border:1px solid #94a3b8;padding:9px;">NET SALARY</td><td style="border:1px solid #94a3b8;padding:9px;text-align:right;">₹${net.toLocaleString('en-IN')}</td></tr>
            </tbody>
          </table>
          <div style="display:flex;justify-content:space-between;margin-top:50px;font-size:11px;font-weight:bold;">
            <span>Employee Signature</span><span>Authorized Signatory</span>
          </div>
        </div>
      `;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    } catch (err) {
      alert('Failed to open salary slip: ' + err.message);
    }
  };

  function closeSalarySlipModal() {
    const modal = document.getElementById('tch-slip-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
  }

  document.getElementById('tch-slip-close')?.addEventListener('click', closeSalarySlipModal);
  document.getElementById('tch-slip-close-btn')?.addEventListener('click', closeSalarySlipModal);
  document.getElementById('tch-slip-print-btn')?.addEventListener('click', () => {
    const element = document.getElementById('tch-slip-render-box');
    if (!element || !element.innerHTML) return alert('Open a salary slip first.');

    // If html2pdf is available and running on mobile, offer PDF download
    if (typeof html2pdf !== 'undefined') {
      const opt = {
        margin: 10,
        filename: `Salary_Slip_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save();
    } else {
      window.print();
    }
  });

  // Notices
  async function loadNotices() {
    const container = document.getElementById('tch-notices-container');
    if (!container) return;

    try {
      const res = await fetch('/api/notices', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const notices = await res.json();

      if (!notices || !notices.length) {
        container.innerHTML = '<p class="text-center py-6 text-slate-500 text-xs font-semibold">No active notices posted.</p>';
        return;
      }

      container.innerHTML = notices.map(n => `
        <div class="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-400">${n.title}</span>
            <span class="text-[10px] font-mono text-slate-400">${n.date || n.created_at?.split('T')[0] || ''}</span>
          </div>
          <p class="text-xs text-slate-300">${n.content || n.description || ''}</p>
        </div>
      `).join('');
    } catch (err) {
      console.error('Error loading notices:', err);
    }
  }

  // Change Password Form
  document.getElementById('tch-change-pwd-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('tch-pwd-current').value;
    const newPassword = document.getElementById('tch-pwd-new').value;
    const confirmPassword = document.getElementById('tch-pwd-confirm').value;

    if (newPassword !== confirmPassword) {
      return alert('New passwords do not match!');
    }

    try {
      const res = await fetch('/api/teacher/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          empId: teacherProfile?.empId,
          oldPassword: currentPassword,
          newPassword
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password.');

      alert('✅ Password updated successfully! Please log in again with your new password.');
      localStorage.removeItem('forcePasswordChange');
      localStorage.removeItem('teacherToken');
      window.location.href = '/teacher-login';
    } catch (err) {
      alert('Error changing password: ' + err.message);
    }
  });
});

function escapeTeacherHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
