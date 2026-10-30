// Teacher Login Client Script
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('tch-login-form');
  const loginBtn = document.getElementById('tch-login-btn');
  const spinner = document.getElementById('tch-login-spinner');
  const errorBox = document.getElementById('tch-login-error');
  const errorText = document.getElementById('tch-error-text');
  const togglePwdBtn = document.getElementById('tch-toggle-pwd');
  const pwdInput = document.getElementById('tch-password');
  const forgotBtn = document.getElementById('tch-forgot-btn');
  const forgotModal = document.getElementById('tch-forgot-modal');
  const forgotClose = document.getElementById('tch-forgot-close');
  const forgotForm = document.getElementById('tch-forgot-form');

  // Dynamically populate school branding on teacher login
  fetch('/api/website-info')
    .then(r => r.ok ? r.json() : null)
    .then(info => {
      if (!info) return;
      if (info.schoolName) {
        const nameEl = document.getElementById('tch-nav-school-name');
        if (nameEl) nameEl.textContent = info.schoolName.toUpperCase();
        document.title = `Teacher Portal Login - ${info.schoolName}`;
        const copyEl = document.getElementById('tch-footer-copy');
        if (copyEl) copyEl.textContent = `© ${new Date().getFullYear()} ${info.schoolName}. All rights reserved.`;
      }
      if (info.websiteLogo || info.logo) {
        const logoEl = document.getElementById('tch-nav-logo');
        if (logoEl) logoEl.src = info.websiteLogo || info.logo;
      }
      if (info.favicon) {
        let fav = document.querySelector("link[rel*='icon']");
        if (fav) fav.href = info.favicon;
      }
    }).catch(() => {});

  // Check if already logged in as teacher
  const token = localStorage.getItem('teacherToken');
  if (token) {
    window.location.href = '/teacher/index.html';
    return;
  }

  // Toggle Password Visibility
  if (togglePwdBtn && pwdInput) {
    togglePwdBtn.onclick = () => {
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        togglePwdBtn.innerText = '🙈';
      } else {
        pwdInput.type = 'password';
        togglePwdBtn.innerText = '👁️';
      }
    };
  }

  // Handle Login Submission with 15-second Timeout
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('tch-username').value.trim();
      const password = pwdInput.value;
      const remember = document.getElementById('tch-remember').checked;

      if (!username || !password) {
        showError('Please enter both Teacher ID / Username and Password.');
        return;
      }

      hideError();
      setLoading(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      try {
        const response = await fetch('/api/teacher/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to authenticate teacher.');
        }

        // Save auth state
        if (data.token) {
          localStorage.setItem('teacherToken', data.token);
          localStorage.setItem('teacherUser', JSON.stringify(data.teacher));
          if (data.permissions) {
            localStorage.setItem('teacherPermissions', JSON.stringify(data.permissions));
          }
          if (data.teacher && data.teacher.forcePasswordChange) {
            localStorage.setItem('forcePasswordChange', 'true');
          }
          if (remember) {
            localStorage.setItem('rememberTeacherUsername', username);
          } else {
            localStorage.removeItem('rememberTeacherUsername');
          }
          
          // Redirect to Teacher Dashboard
          window.location.href = '/teacher/index.html';
        } else {
          throw new Error('Invalid token received from server.');
        }

      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          showError('Connection timed out after 15 seconds. Please verify your network connection and server status.');
        } else {
          showError(err.message || 'Login failed. Please check your credentials.');
        }
      } finally {
        setLoading(false);
      }
    };
  }

  // Pre-fill remembered username
  const remembered = localStorage.getItem('rememberTeacherUsername');
  if (remembered) {
    const userInp = document.getElementById('tch-username');
    if (userInp) userInp.value = remembered;
    const remChk = document.getElementById('tch-remember');
    if (remChk) remChk.checked = true;
  }

  // Forgot Password Modal
  if (forgotBtn && forgotModal) {
    forgotBtn.onclick = () => forgotModal.classList.remove('hidden');
  }
  if (forgotClose && forgotModal) {
    forgotClose.onclick = () => forgotModal.classList.add('hidden');
  }

  if (forgotForm) {
    forgotForm.onsubmit = async (e) => {
      e.preventDefault();
      const username = document.getElementById('tch-forgot-username').value.trim();
      if (!username) return alert('Enter your Teacher ID or Username.');

      try {
        const res = await fetch('/api/teacher/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username })
        });
        const data = await res.json();
        alert(data.message || 'Password reset request generated. Please contact administrator.');
        forgotModal.classList.add('hidden');
      } catch (err) {
        alert('Failed to submit request: ' + err.message);
      }
    };
  }

  function showError(msg) {
    if (errorText && errorBox) {
      errorText.innerText = msg;
      errorBox.classList.remove('hidden');
    }
  }

  function hideError() {
    if (errorBox) errorBox.classList.add('hidden');
  }

  function setLoading(isLoading) {
    if (loginBtn) loginBtn.disabled = isLoading;
    if (spinner) {
      if (isLoading) spinner.classList.remove('hidden');
      else spinner.classList.add('hidden');
    }
  }
});
