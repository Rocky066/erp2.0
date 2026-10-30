// API Service Wrapper for Garumara Jatiya Vidyalaya
const API_BASE = '/api';

const ApiService = {
  isPrintContext(endpoint = '') {
    return String(endpoint).startsWith('/print-center/') || location.pathname.startsWith('/print-center') || location.pathname.includes('admin-65121315super');
  },

  getToken(printContext = this.isPrintContext()) {
    return localStorage.getItem(printContext ? 'gv_print_token' : 'gv_admin_token');
  },

  setToken(token, printContext = false) {
    localStorage.setItem(printContext ? 'gv_print_token' : 'gv_admin_token', token);
  },

  clearAuth(printContext = this.isPrintContext()) {
    const prefix = printContext ? 'gv_print_' : 'gv_admin_';
    localStorage.removeItem(prefix + 'token');
    localStorage.removeItem(prefix + 'user');
    localStorage.removeItem(prefix + 'role');
    localStorage.removeItem('gv_current_academic_session');
    localStorage.removeItem('gv_school_id');
    localStorage.removeItem('gv_school_code');
  },

  isAuthenticated() { return !!this.getToken(false); },
  isPrintAuthenticated() { return !!this.getToken(true); },
  getRole(printContext = this.isPrintContext()) { return localStorage.getItem(printContext ? 'gv_print_role' : 'gv_admin_role') || ''; },
  getUser(printContext = this.isPrintContext()) { return localStorage.getItem(printContext ? 'gv_print_user' : 'gv_admin_user') || (printContext ? 'Print Operator' : 'Admin'); },
  async request(endpoint, options = {}) {
    const printContext = this.isPrintContext(endpoint);
    const token = this.getToken(printContext);
    const skipAuthRedirect = options.skipAuthRedirect === true;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const requestTimeoutMs = Math.max(500, Number(options.timeoutMs) || 15000);
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    const config = {
      ...options,
      headers,
      signal: controller.signal
    };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, config);
      clearTimeout(timeoutId);
      
      // Handle Token Expiry
      if (response.status === 401 && !skipAuthRedirect && !endpoint.includes('/auth/login') && !endpoint.includes('/print-center/login')) {
        this.clearAuth(printContext);
        window.location.href = printContext ? '/print-center/login' : '/admin/login.html';
        throw new Error('Session expired. Please login again.');
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Server returned invalid response (HTTP ${response.status}).`);
      }

      if (!response.ok) {
        throw new Error((data && data.error) || `Request failed with status ${response.status}.`);
      }
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Server request timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
      }
      if (err.message && err.message.includes('Failed to fetch')) {
        throw new Error('Unable to connect to backend server. Please verify network connection and server status.');
      }
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  // Backwards-compatible authenticated request helper used by teacher
  // management screens. Accepts either "/api/..." or service-relative paths.
  async authenticatedFetch(endpoint, options = {}) {
    const normalizedEndpoint = String(endpoint || '')
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/api(?=\/|$)/, '') || '/';
    return this.request(normalizedEndpoint, options);
  },

  // 1. PUBLIC ENDPOINTS
  async getPublicNotices(session = '') {
    return this.request('/notices' + (session ? '?session=' + encodeURIComponent(session) : ''));
  },

  async getPublicGallery() {
    return this.request('/gallery');
  },

  async getWebsiteInfo() {
    return this.request('/website-info');
  },

  async submitAdmissionApplication(applicationData) {
    return this.request('/admission-applications', { method: 'POST', body: JSON.stringify(applicationData) });
  },

  async getAdmissionApplications(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
    return this.request('/admission-applications' + (query.toString() ? '?' + query : ''));
  },

  async updateAdmissionApplication(id, applicationData) {
    return this.request(`/admission-applications/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(applicationData) });
  },

  async processAdmissionApplication(id, action, data = {}) {
    return this.request(`/admission-applications/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(data) });
  },

  async deleteAdmissionApplication(id) {
    return this.request(`/admission-applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // 2. AUTHENTICATION
  async login(username, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    this.setToken(data.token);
    localStorage.setItem('gv_admin_user', data.username);
    localStorage.setItem('gv_admin_role', data.role || 'Admin');
    return data;
  },
  async printLogin(username, password) {
    const data = await this.request('/print-center/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.setToken(data.token, true);
    localStorage.setItem('gv_print_user', data.username);
    localStorage.setItem('gv_print_role', data.role);
    return data;
  },
  async printLogout() {
    return this.request('/print-center/logout', { method: 'POST' });
  },
  async getPrintSession() {
    return this.request('/print-center/session', { skipAuthRedirect: true, timeoutMs: 2500 });
  },
  async getMe() {
    return this.request('/auth/me');
  },

  // 3. STUDENTS
  async getStudents(filters = {}) {
    const params = new URLSearchParams(); Object.entries(filters).forEach(([key,value]) => { if (value) params.set(key,value); });
    return this.request('/students' + (params.toString() ? '?' + params.toString() : ''));
  },

  async addStudent(studentData) {
    return this.request('/students', {
      method: 'POST',
      body: JSON.stringify(studentData)
    });
  },

  async updateStudent(admissionNo, studentData) {
    return this.request(`/students/${admissionNo}`, {
      method: 'PUT',
      body: JSON.stringify(studentData)
    });
  },

  async deleteStudent(admissionNo) {
    return this.request(`/students/${admissionNo}`, {
      method: 'DELETE'
    });
  },

  // 4. ATTENDANCE
  async getAttendance(date, className, section, session = '', academicSessionId = '') {
    let query = [];
    if (date) query.push(`date=${date}`);
    if (className) query.push(`className=${encodeURIComponent(className)}`);
    if (section) query.push(`section=${encodeURIComponent(section)}`);
    if (session) query.push(`academic_session=${encodeURIComponent(session)}`);
    if (academicSessionId) query.push(`academic_session_id=${encodeURIComponent(academicSessionId)}`);
    const queryString = query.length ? `?${query.join('&')}` : '';
    return this.request(`/attendance${queryString}`);
  },

  async saveAttendance(attendanceData) {
    return this.request('/attendance', {
      method: 'POST',
      body: JSON.stringify(attendanceData)
    });
  },

  // 5. FEES
  async searchFeeStudents(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== '' && value != null) params.set(key, value); });
    return this.request('/fee/students/search?' + params.toString());
  },

  async getFees(studentId = '', session = '', academicSessionId = '') {
    const params = new URLSearchParams(); if (studentId) params.set('studentId', studentId); if (session) params.set('session', session); if (academicSessionId) params.set('academic_session_id', academicSessionId);
    return this.request('/fees' + (params.toString() ? '?' + params.toString() : ''));
  },

  async getStudentFeeProfile(studentId, filters = {}) {
    const params = new URLSearchParams({ studentId });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    return this.request(`/fees/student-profile?${params.toString()}`);
  },

  async getStudentAnnualFeeProfile(studentId, session = '', academicSessionId = '') {
    if (!studentId) throw new Error('Student ID or admission number is required.');
    const params = new URLSearchParams({ studentId });
    if (session) params.set('session', session);
    if (academicSessionId) params.set('academic_session_id', academicSessionId);
    return this.request(`/fees/student-fee-profile?${params.toString()}`);
  },

  async getFeeDashboardStats(session = '', academicSessionId = '') {
    const params = new URLSearchParams(); if (session) params.set('session', session); if (academicSessionId) params.set('academic_session_id', academicSessionId);
    return this.request('/fees/dashboard-stats?' + params.toString());
  },

  async getFeeDueList(className = '', section = '', month = '', session = '', academicSessionId = '') {
    let query = [];
    if (className) query.push(`className=${encodeURIComponent(className)}`);
    if (section) query.push(`section=${encodeURIComponent(section)}`);
    if (month) query.push(`month=${encodeURIComponent(month)}`);
    if (session) query.push(`session=${encodeURIComponent(session)}`);
    if (academicSessionId) query.push(`academic_session_id=${encodeURIComponent(academicSessionId)}`);
    const qStr = query.length ? `?${query.join('&')}` : '';
    return this.request(`/fees/due-list${qStr}`);
  },

  async getStudentWiseDueList(filters = {}) {
    const params = new URLSearchParams();
    Object.keys(filters).forEach(k => {
      if (filters[k]) params.append(k, filters[k]);
    });
    const qStr = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/fees/student-wise-dues${qStr}`);
  },

  async sendFeeReminders(studentIds, month = '', reminderType = 'due', academicSessionId = '') {
    return this.request('/fees/reminders', {
      method: 'POST',
      body: JSON.stringify({ studentIds, month, reminderType, academic_session_id: academicSessionId }),
      timeoutMs: Math.min(300000, Math.max(30000, (Array.isArray(studentIds) ? studentIds.length : 1) * 20000))
    });
  },
  async getLegacyFeeDues(filters = {}) {
    const params = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); return this.request('/fees/legacy-dues' + (params.toString() ? '?' + params.toString() : ''));
  },
  async createLegacyFeeDue(data) { return this.request('/fees/legacy-dues', { method: 'POST', body: JSON.stringify(data) }); },
  async updateLegacyFeeDue(data) { return this.request('/fees/legacy-dues', { method: 'PUT', body: JSON.stringify(data) }); },
  async deleteLegacyFeeDue(id) { return this.request('/fees/legacy-dues?id=' + encodeURIComponent(id), { method: 'DELETE' }); },
  async importLegacyFeeDues(records, batchId = '') { return this.request('/fees/legacy-dues/import', { method: 'POST', body: JSON.stringify({ records, batchId }) }); },
  async getFeeAuditLog() {
    return this.request('/fees/audit-log');
  },

  async getFeeStructures(session = '') {
    return this.request('/fee-structures' + (session ? '?session=' + encodeURIComponent(session) : ''));
  },

  async saveFeeStructures(structureData, session = '') {
    return this.request('/fee-structures' + (session ? '?session=' + encodeURIComponent(session) : ''), {
      method: 'POST',
      body: JSON.stringify(structureData)
    });
  },

  async collectFeeOldestFirst(feeData) {
    return this.request('/fees/allocate-oldest', { method: 'POST', body: JSON.stringify(feeData), timeoutMs: 25000 });
  },

  async collectFee(feeData) {
    return this.request('/fees', {
      method: 'POST',
      body: JSON.stringify(feeData),
      timeoutMs: 25000
    });
  },

  async updateFee(feeData) {
    return this.request('/fees', {
      method: 'PUT',
      body: JSON.stringify(feeData),
      timeoutMs: 25000
    });
  },

  async refundFee(feeId, receiptNo, reason) {
    return this.request('/fees/refunds', {
      method: 'POST',
      body: JSON.stringify({ feeId, receiptNo, reason })
    });
  },
  async deleteFee(id, receiptNo) {
    let query = [];
    if (id) query.push(`id=${encodeURIComponent(id)}`);
    if (receiptNo) query.push(`receiptNo=${encodeURIComponent(receiptNo)}`);
    if (!query.length) {
      throw new Error('Fee ID or receipt number is required.');
    }
    return this.request(`/fees?${query.join('&')}`, {
      method: 'DELETE'
    });
  },

  async getDashboardOverview(session = '') {
    return this.request('/dashboard/overview' + (session ? '?academic_session=' + encodeURIComponent(session) : ''));
  },

  // 6. EXAMS
  async getExams(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return this.request('/exams' + (params.toString() ? '?' + params.toString() : ''));
  },

  async getExamResults(filters = {}) {
    const params = new URLSearchParams();
    Object.keys(filters).forEach(key => {
      if (filters[key]) params.append(key, filters[key]);
    });
    const query = params.toString();
    return this.request(`/exam-results${query ? `?${query}` : ''}`);
  },

  async saveExams(examData) {
    return this.request('/exams', {
      method: 'POST',
      body: JSON.stringify(examData)
    });
  },

  // 7. NOTICES
  async createNotice(noticeData) {
    return this.request('/notices', {
      method: 'POST',
      body: JSON.stringify(noticeData)
    });
  },

  async deleteNotice(id) {
    return this.request(`/notices/${id}`, {
      method: 'DELETE'
    });
  },

  // 8. GALLERY
  async uploadGalleryPhoto(photoData) {
    return this.request('/gallery', {
      method: 'POST',
      body: JSON.stringify(photoData)
    });
  },

  async deleteGalleryPhoto(id) {
    return this.request(`/gallery/${id}`, {
      method: 'DELETE'
    });
  },

  // 9. SETTINGS
  async getAcademicSessions() {
    return this.request('/academic-sessions', { skipAuthRedirect: true });
  },

  async createAcademicSession(data) {
    return this.request('/academic-sessions', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateAcademicSession(id, data) {
    return this.request('/academic-sessions/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(data) });
  },

  async activateAcademicSession(id) {
    return this.request('/academic-sessions/' + encodeURIComponent(id) + '/activate', { method: 'POST' });
  },

  async deleteAcademicSession(id) {
    return this.request('/academic-sessions/' + encodeURIComponent(id), { method: 'DELETE' });
  },

  async getWhatsAppSettings() { return this.request('/whatsapp/settings'); },
  async saveWhatsAppSettings(data) { return this.request('/whatsapp/settings', { method: 'PUT', body: JSON.stringify(data) }); },
  async getWhatsAppStatus() { return this.request('/whatsapp/status'); },
  async sendWhatsAppTest(data) { return this.request('/whatsapp/test', { method: 'POST', body: JSON.stringify(data) }); },
  async sendWhatsApp(data) { return this.request('/whatsapp/send', { method: 'POST', body: JSON.stringify(data) }); },
  async getWhatsAppLogs(limit = 100) { return this.request('/whatsapp/logs?limit=' + encodeURIComponent(limit)); },
  async getWhatsAppTemplates() { return this.request('/whatsapp/templates'); },
  async saveWhatsAppTemplates(data) { return this.request('/whatsapp/templates', { method: 'PUT', body: JSON.stringify(data) }); },

  async getSettings() {
    return this.request('/settings');
  },

  async saveSettings(settingsData) {
    return this.request('/settings', {
      method: 'POST',
      body: JSON.stringify(settingsData)
    });
  },

  async uploadIdCardSignature(signatureData) {
    return this.request('/settings/id-card-signature', {
      method: 'POST',
      body: JSON.stringify(signatureData)
    });
  },

  async deleteIdCardSignature() {
    return this.request('/settings/id-card-signature', {
      method: 'DELETE'
    });
  },
  async uploadAdmitCardSignature(file) {
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error('Please select a Principal signature image to upload.');
    }
    const formData = new FormData();
    formData.append('principalSignature', file, file.name);
    return this.request('/admit-card/signature', {
      method: 'POST',
      body: formData
    });
  },

  async deleteAdmitCardSignature() {
    return this.request('/admit-card/signature', { method: 'DELETE' });
  },
  // 10. NOTIFICATIONS LOGS
  async getNotifications() {
    return this.request('/notifications');
  },

  async triggerTestNotification(testData) {
    return this.request('/notifications/test', {
      method: 'POST',
      body: JSON.stringify(testData)
    });
  },

  // 11. REPORTS
  async getReports() {
    return this.request('/reports');
  },

  // 12. TEACHER MANAGEMENT
  async getTeacherStats() {
    return this.request('/teachers/stats');
  },

  async getTeachers(query = {}) {
    let q = [];
    if (query.subject) q.push(`subject=${encodeURIComponent(query.subject)}`);
    if (query.classTeacher) q.push(`classTeacher=${encodeURIComponent(query.classTeacher)}`);
    return this.request(`/teachers${q.length ? '?' + q.join('&') : ''}`);
  },

  async createTeacher(teacherData) {
    return this.request('/teachers', {
      method: 'POST',
      body: JSON.stringify(teacherData)
    });
  },

  async updateTeacher(id, teacherData) {
    return this.request(`/teachers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(teacherData)
    });
  },

  async updateTeacherPermissions(id, permissions) {
    return this.request(`/teachers/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(permissions)
    });
  },

  // 14. SUBJECT MANAGEMENT
  async getSubjects(query = {}) {
    let q = [];
    if (query.className) q.push(`className=${encodeURIComponent(query.className)}`);
    if (query.section) q.push(`section=${encodeURIComponent(query.section)}`);
    if (query.examType) q.push(`examType=${encodeURIComponent(query.examType)}`);
    if (query.session) q.push(`session=${encodeURIComponent(query.session)}`);
    return this.request(`/subjects${q.length ? '?' + q.join('&') : ''}`);
  },

  async getSubject(id) {
    return this.request(`/subjects/${encodeURIComponent(id)}`);
  },

  async createSubject(subjectData) {
    return this.request('/subjects', {
      method: 'POST',
      body: JSON.stringify(subjectData)
    });
  },

  async updateSubject(id, subjectData) {
    return this.request(`/subjects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(subjectData)
    });
  },

  async deleteSubject(id) {
    return this.request(`/subjects/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  // 15. TEACHER WORKLOAD ASSIGNMENTS
  async getTeacherAssignments(teacherId = '') {
    const query = teacherId ? `?teacher_id=${encodeURIComponent(teacherId)}` : '';
    return this.request(`/teacher-assignments${query}`);
  },

  async createTeacherAssignment(assignmentData) {
    return this.request('/teacher-assignments', {
      method: 'POST',
      body: JSON.stringify(assignmentData)
    });
  },

  async replaceTeacherAssignments(teacherId, assignments) {
    return this.request(`/teacher-assignments/teacher/${encodeURIComponent(teacherId)}`, {
      method: 'PUT',
      body: JSON.stringify({ assignments })
    });
  },

  async deleteTeacherAssignment(id) {
    return this.request(`/teacher-assignments/${id}`, {
      method: 'DELETE'
    });
  },

  async deleteTeacher(id) {
    return this.request(`/teachers/${id}`, {
      method: 'DELETE'
    });
  },

  async getTeacherAttendance(date = '', month = '') {
    let q = [];
    if (date) q.push(`date=${encodeURIComponent(date)}`);
    if (month) q.push(`month=${encodeURIComponent(month)}`);
    return this.request(`/teachers/attendance${q.length ? '?' + q.join('&') : ''}`);
  },

  async saveTeacherAttendance(attendanceData) {
    return this.request('/teachers/attendance', {
      method: 'POST',
      body: JSON.stringify(attendanceData)
    });
  },

  async getTeacherSalaries(empId = '', month = '') {
    let q = [];
    if (empId) q.push(`empId=${encodeURIComponent(empId)}`);
    if (month) q.push(`month=${encodeURIComponent(month)}`);
    return this.request(`/teachers/salaries${q.length ? '?' + q.join('&') : ''}`);
  },

  async payTeacherSalary(salaryData) {
    return this.request('/teachers/salaries', {
      method: 'POST',
      body: JSON.stringify(salaryData)
    });
  },

  async getTeacherLeaves(teacherId = '', status = '') {
    const q = [];
    if (teacherId) q.push(`teacher_id=${encodeURIComponent(teacherId)}`);
    if (status) q.push(`status=${encodeURIComponent(status)}`);
    return this.request(`/teachers/leaves${q.length ? '?' + q.join('&') : ''}`);
  },

  async submitTeacherLeave(leaveData) {
    return this.request('/teachers/leaves', {
      method: 'POST',
      body: JSON.stringify(leaveData)
    });
  },

  async approveTeacherLeave(leaveRequestId, adminRemarks = '') {
    return this.request(`/teacher-leaves/${encodeURIComponent(leaveRequestId)}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ admin_remarks: adminRemarks })
    });
  },

  async rejectTeacherLeave(leaveRequestId, rejectionReason = '') {
    return this.request(`/teacher-leaves/${encodeURIComponent(leaveRequestId)}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ admin_remarks: rejectionReason })
    });
  },

  async processTeacherLeave(leaveRequestId, status, adminRemarks = '') {
    return status === 'Approved'
      ? this.approveTeacherLeave(leaveRequestId, adminRemarks)
      : this.rejectTeacherLeave(leaveRequestId, adminRemarks);
  },
  async getTeacherAuditLogs() {
    return this.request('/teachers/audit-logs');
  },

  async teacherLogin(username, password) {
    return this.request('/teacher/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  // 13. LEADERSHIP
  async getLeadership() {
    return this.request('/leadership');
  },

  async updateLeader(id, leaderData) {
    return this.request(`/leadership/${id}`, {
      method: 'PUT',
      body: JSON.stringify(leaderData)
    });
  },

  // 12. BACKUP & RESTORE
  getBackupUrl() {
    const token = this.getToken();
    return `/api/backup?token=${token}`; // backup route supports direct download if authorized
  },

  async restoreDatabase(backupJson) {
    return this.request('/backup/restore', {
      method: 'POST',
      body: JSON.stringify(backupJson)
    });
  },

  // 14. PRINT CENTER ID CARD DESIGN
  async getPrintCenterIdCardDesign() {
    return this.request('/print-center/id-card-design');
  },

  async getPrintCenterIdCardTemplates() {
    return this.request('/print-center/id-card-templates');
  },

  async savePrintCenterIdCardDesign(design) {
    return this.request('/print-center/id-card-design', {
      method: 'PUT',
      body: JSON.stringify({ design })
    });
  },

  async resetPrintCenterIdCardDesign(templateId = null) {
    return this.request('/print-center/id-card-design/reset', {
      method: 'POST',
      body: JSON.stringify({ templateId })
    });
  },

  async setDefaultPrintCenterIdCardTemplate(templateId) {
    return this.request('/print-center/id-card-design/default-template', {
      method: 'POST',
      body: JSON.stringify({ templateId })
    });
  },

  async savePrintCenterIdCardPreset(name, design) {
    return this.request('/print-center/id-card-design/presets', {
      method: 'POST',
      body: JSON.stringify({ name, design })
    });
  },

  async duplicatePrintCenterIdCardPreset(presetId) {
    return this.request(`/print-center/id-card-design/presets/${encodeURIComponent(presetId)}/duplicate`, {
      method: 'POST'
    });
  },

  async updatePrintCenterIdCardPreset(presetId, data) {
    return this.request(`/print-center/id-card-design/presets/${encodeURIComponent(presetId)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async deletePrintCenterIdCardPreset(presetId) {
    return this.request(`/print-center/id-card-design/presets/${encodeURIComponent(presetId)}`, {
      method: 'DELETE'
    });
  }
};

