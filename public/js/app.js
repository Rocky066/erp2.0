// Shared UI components & Dynamic content loading for Public Website
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initTheme();
  loadSharedHeaderFooter();
  fetch('/api/academic-sessions').then(r=>r.ok?r.json():null).then(data=>{const el=document.getElementById('public-current-session');if(el&&data?.currentSession)el.textContent='Admissions Open for Session '+data.currentSession.session_name;}).catch(error=>console.error('[PUBLIC SESSION INDICATOR]',error));
  
  // Page-specific dynamic loaders
  const path = window.location.pathname;
  if (path.endsWith('/') || path.endsWith('index.html') || path === '') {
    loadHomeData();
  } else if (path.endsWith('notices.html')) {
    loadNoticesPage();
  } else if (path.endsWith('gallery.html')) {
    loadGalleryPage();
  } else if (path.endsWith('admission.html')) {
    initAdmissionForm();
  } else if (path.endsWith('contact.html')) {
    initContactForm();
  }
});

// Load shared header and footer
function loadSharedHeaderFooter() {
  const headerContainer = document.getElementById('shared-header');
  const footerContainer = document.getElementById('shared-footer');
  
  const currentPath = window.location.pathname;
  const isLinkActive = (p) => {
    if (currentPath.endsWith(p)) return 'text-amber-500 font-bold border-b-2 border-amber-500';
    if (p === 'index.html' && (currentPath.endsWith('/') || currentPath === '')) return 'text-amber-500 font-bold border-b-2 border-amber-500';
    return 'text-slate-600 dark:text-slate-300 hover:text-amber-500 dark:hover:text-amber-400 transition-colors';
  };

  if (headerContainer) {
    headerContainer.innerHTML = `
      <nav class="container mx-auto px-6 py-4 flex items-center justify-between">
        <a href="index.html" class="flex items-center space-x-3">
          <img src="/logo.jpg" alt="Logo" id="nav-school-logo" class="w-10 h-10 object-contain rounded-full shadow-lg border border-amber-500/10">
          <div>
            <span id="nav-school-name" class="text-xl font-bold text-slate-900 dark:text-white tracking-wide block leading-tight">Garumara Jatiya Vidyalaya</span>
            <span id="nav-school-estd" class="text-xs text-slate-500 dark:text-slate-400 font-medium">ESTD. 2023</span>
          </div>
        </a>

        <!-- Desktop Menu -->
        <div class="hidden lg:flex items-center space-x-8">
          <a href="index.html" class="${isLinkActive('index.html')} py-1 text-sm font-semibold">Home</a>
          <a href="about.html" class="${isLinkActive('about.html')} py-1 text-sm font-semibold">About Us</a>
          <a href="message.html" class="${isLinkActive('message.html')} py-1 text-sm font-semibold">Leadership Team</a>
          <a href="admission.html" class="${isLinkActive('admission.html')} py-1 text-sm font-semibold">Admission</a>
          <a href="classes.html" class="${isLinkActive('classes.html')} py-1 text-sm font-semibold">Classes</a>
          <a href="gallery.html" class="${isLinkActive('gallery.html')} py-1 text-sm font-semibold">Gallery</a>
          <a href="notices.html" class="${isLinkActive('notices.html')} py-1 text-sm font-semibold">Notices</a>
          <a href="contact.html" class="${isLinkActive('contact.html')} py-1 text-sm font-semibold">Contact Us</a>
        </div>

        <div class="flex items-center space-x-4">
          <!-- Theme Toggle -->
          <button id="theme-toggle" class="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-all focus:outline-none" aria-label="Toggle Theme">
            <svg id="theme-toggle-dark-icon" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
            <svg id="theme-toggle-light-icon" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.46 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zm1.41 8.49a1 1 0 01-1.41 0l-.707-.707a1 1 0 011.414-1.414l.707.707a1 1 0 010 1.415zM7 9a1 1 0 100-2H6a1 1 0 100 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
          </button>

          <!-- Mobile Menu Toggle -->
          <button id="mobile-menu-toggle" class="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none" aria-label="Toggle Mobile Menu">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
          </button>
        </div>
      </nav>

      <!-- Mobile Menu Drawer -->
      <div id="mobile-menu" class="hidden lg:hidden glass border-t border-slate-200 dark:border-slate-800 px-6 py-4 space-y-3 shadow-lg">
        <a href="index.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Home</a>
        <a href="about.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">About Us</a>
        <a href="message.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Leadership Team</a>
        <a href="admission.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Admission</a>
        <a href="classes.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Classes</a>
        <a href="gallery.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Gallery</a>
        <a href="notices.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Notices</a>
        <a href="contact.html" class="block py-2 text-base font-semibold text-slate-800 dark:text-slate-200 hover:text-amber-500">Contact Us</a>
      </div>
    `;
    
    // Bind Mobile Toggle Event after insert
    const mobBtn = document.getElementById('mobile-menu-toggle');
    const mobMenu = document.getElementById('mobile-menu');
    if (mobBtn && mobMenu) {
      mobBtn.addEventListener('click', () => {
        mobMenu.classList.toggle('hidden');
      });
    }

    // Re-bind theme button click
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', toggleTheme);
    }
    updateThemeIcons();
  }

  if (footerContainer) {
    footerContainer.innerHTML = `
      <div class="container mx-auto px-6 py-12">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div class="space-y-4">
            <h3 id="footer-school-name" class="text-lg font-bold text-white">Garumara Jatiya Vidyalaya</h3>
            <p id="footer-school-desc" class="text-sm text-slate-400">A community institution built to nurture tomorrow's leaders with global education standards and local traditional values.</p>
            <p id="footer-school-copy" class="text-xs text-slate-500">&copy; ${new Date().getFullYear()} Garumara Jatiya Vidyalaya. All rights reserved.</p>
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Quick Links</h4>
            <ul class="space-y-2 text-sm text-slate-400">
              <li><a href="about.html" class="hover:text-amber-400">About the School</a></li>
              <li><a href="message.html" class="hover:text-amber-400">Leadership Team</a></li>
              <li><a href="admission.html" class="hover:text-amber-400">Admission Procedure</a></li>
              <li><a href="classes.html" class="hover:text-amber-400">Classes Offerings</a></li>
            </ul>
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Explore</h4>
            <ul class="space-y-2 text-sm text-slate-400">
              <li><a href="gallery.html" class="hover:text-amber-400">Photo Gallery</a></li>
              <li><a href="notices.html" class="hover:text-amber-400">Notices & Board</a></li>
            </ul>
          </div>
          <div>
            <h4 class="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Contact Info</h4>
            <ul class="space-y-2 text-sm text-slate-400">
              <li class="flex items-start space-x-2">
                <svg class="w-4 h-4 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                <span id="footer-school-address">Garumara, Nagaon, Assam – 782140</span>
              </li>
              <li class="flex items-center space-x-2">
                <svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                <span id="footer-school-phone">+91 8099456097</span>
              </li>
              <li class="flex items-center space-x-2">
                <svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                <span id="footer-school-email">info@garumarajv.org</span>
              </li>
            </ul>
          </div>
        </div>
        <div class="border-t border-slate-800 mt-12 pt-6 text-center text-xs text-slate-500">
          Developed for school community and parents.
        </div>
      </div>
    `;
  }

  // Populate dynamic branding from active school tenant
  fetch('/api/website-info')
    .then(r => r.ok ? r.json() : null)
    .then(info => {
      if (!info) return;
      const navLogo = document.getElementById('nav-school-logo');
      const navName = document.getElementById('nav-school-name');
      const navEstd = document.getElementById('nav-school-estd');
      if (navLogo && (info.websiteLogo || info.logo)) navLogo.src = info.websiteLogo || info.logo;
      if (navName && info.schoolName) navName.textContent = info.schoolName;
      if (navEstd && info.establishedYear) navEstd.textContent = `ESTD. ${info.establishedYear}`;

      const fName = document.getElementById('footer-school-name');
      const fDesc = document.getElementById('footer-school-desc');
      const fAddr = document.getElementById('footer-school-address');
      const fPhone = document.getElementById('footer-school-phone');
      const fEmail = document.getElementById('footer-school-email');
      const fCopy = document.getElementById('footer-school-copy');
      if (fName && info.schoolName) fName.textContent = info.schoolName;
      if (fDesc && (info.tagline || info.aboutText)) fDesc.textContent = info.tagline || info.aboutText;
      if (fAddr && info.address) fAddr.textContent = info.address;
      if (fPhone && info.phone) fPhone.textContent = info.phone;
      if (fEmail && info.email) fEmail.textContent = info.email;
      if (fCopy && info.schoolName) fCopy.textContent = `© ${new Date().getFullYear()} ${info.schoolName}. All rights reserved.`;

      if (info.schoolName && document.title && document.title.includes('Garumara Jatiya Vidyalaya')) {
        document.title = document.title.replace(/Garumara Jatiya Vidyalaya/g, info.schoolName);
      }
      const aboutTextEl = document.getElementById('about-school-text');
      if (aboutTextEl && info.aboutText) aboutTextEl.textContent = info.aboutText;

      const cPhone = document.getElementById('contact-page-phone');
      if (cPhone && info.phone) cPhone.textContent = info.phone;
      const cEmail = document.getElementById('contact-page-email');
      if (cEmail && info.email) cEmail.textContent = info.email;
      const cAddr = document.getElementById('contact-page-address');
      if (cAddr && info.address) cAddr.textContent = 'Address: ' + info.address;
      const cMap = document.getElementById('contact-page-map');
      if (cMap && info.mapEmbedUrl) cMap.src = info.mapEmbedUrl;

      const msgBadge = document.getElementById('message-school-badge');
      if (msgBadge && info.schoolName) msgBadge.textContent = info.schoolName + ' Leadership';

      const admBadge = document.getElementById('admission-school-badge');
      if (admBadge && info.schoolName) admBadge.textContent = 'Apply — ' + info.schoolName;

      if (info.favicon) {
        let fav = document.querySelector("link[rel*='icon']");
        if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); }
        fav.href = info.favicon;
      }
    })
    .catch(e => console.error('[WEBSITE INFO LOAD]', e));
}

// Navigation active indicators
function initNavigation() {
  const header = document.querySelector('header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('shadow-md', 'bg-white/90', 'dark:bg-slate-900/90');
      header.classList.remove('bg-transparent');
    } else {
      header.classList.remove('shadow-md', 'bg-white/90', 'dark:bg-slate-900/90');
      header.classList.add('bg-transparent');
    }
  });
}

// Theme Handling
function initTheme() {
  const prefersDark = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function toggleTheme() {
  if (document.documentElement.classList.contains('dark')) {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('color-theme', 'light');
  } else {
    document.documentElement.classList.add('dark');
    localStorage.setItem('color-theme', 'dark');
  }
  updateThemeIcons();
}

function updateThemeIcons() {
  const darkIcon = document.getElementById('theme-toggle-dark-icon');
  const lightIcon = document.getElementById('theme-toggle-light-icon');
  
  if (!darkIcon || !lightIcon) return;

  if (document.documentElement.classList.contains('dark')) {
    lightIcon.classList.remove('hidden');
    darkIcon.classList.add('hidden');
  } else {
    darkIcon.classList.remove('hidden');
    lightIcon.classList.add('hidden');
  }
}

// Home Data Loader
async function loadHomeData() {
  try {
    const notices = await ApiService.getPublicNotices();
    const info = await ApiService.getWebsiteInfo();
    
    // Update website Content if available
    if (info) {
      const schoolTitle = document.getElementById('hero-school-title');
      const schoolTag = document.getElementById('hero-school-tagline');
      if (schoolTitle) schoolTitle.innerText = info.schoolName || "Garumara Jatiya Vidyalaya";
      if (schoolTag) schoolTag.innerText = info.tagline || "";
    }

    // Populate Principal homepage address block from DB
    try {
      const leaders = await ApiService.getLeadership();
      const principal = leaders.find(l => l.id === 'principal');
      const pName = principal?.name || info?.principalName;
      const pDesig = principal?.designation || (info?.schoolName ? `Principal, ${info.schoolName}` : 'Principal');
      const pMsg = principal?.message || info?.principalMessage;
      
      const nameEl = document.getElementById('home-principal-name');
      const desigEl = document.getElementById('home-principal-designation');
      const msgEl = document.getElementById('home-principal-message');
      
      if (nameEl && pName) {
        nameEl.innerText = pName + (principal?.qualification ? `, ${principal.qualification}` : '');
      }
      if (desigEl && pDesig) {
        desigEl.innerText = pDesig;
      }
      if (msgEl && pMsg) {
        const truncated = pMsg.length > 280
          ? pMsg.substring(0, 280) + '...'
          : pMsg;
        msgEl.innerText = `"${truncated}"`;
      }
    } catch (err) {
      console.error('Failed to load Principal details on homepage:', err);
    }

    // Populate notice ticker
    const ticker = document.getElementById('notices-ticker');
    if (ticker && notices && notices.length > 0) {
      const activeNotices = notices.slice(0, 5);
      ticker.innerHTML = activeNotices.map((n, i) => `
        <div class="ticker-item py-1 ${i > 0 ? 'hidden' : ''} text-sm font-semibold text-slate-700 dark:text-slate-200">
          <span class="bg-red-500 text-white text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded mr-2 animate-pulse">New</span>
          <a href="notices.html" class="hover:underline">${n.title} (${n.date})</a>
        </div>
      `).join('');
      
      // Auto rotate ticker items
      let currentIdx = 0;
      const items = ticker.getElementsByClassName('ticker-item');
      if (items.length > 1) {
        setInterval(() => {
          items[currentIdx].classList.add('hidden');
          currentIdx = (currentIdx + 1) % items.length;
          items[currentIdx].classList.remove('hidden');
        }, 4000);
      }
    }

    // Load recent notices in home list
    const noticeList = document.getElementById('home-notices-list');
    if (noticeList && notices) {
      const recent = notices.slice(0, 3);
      if (recent.length === 0) {
        noticeList.innerHTML = `<p class="text-slate-500 text-sm">No notices currently published.</p>`;
      } else {
        noticeList.innerHTML = recent.map(n => `
          <div class="border-l-4 border-amber-500 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-r-xl shadow-sm transition-all hover:translate-x-1">
            <span class="text-xs text-slate-500 dark:text-slate-400 font-semibold block mb-1">${n.date}</span>
            <h4 class="font-bold text-slate-900 dark:text-white text-base mb-1">${n.title}</h4>
            <p class="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">${n.content}</p>
            <a href="notices.html" class="text-xs font-bold text-amber-500 hover:text-amber-400 block mt-2">Read Full Announcement &rarr;</a>
          </div>
        `).join('');
      }
    }
  } catch (e) {
    console.error('Error loading home data:', e);
  }
}

// Notices Page Loader
async function loadNoticesPage() {
  const container = document.getElementById('notices-page-container');
  if (!container) return;
  
  container.innerHTML = `<div class="text-center py-12"><div class="inline-block w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div><p class="mt-4 text-slate-500 font-medium">Fetching announcements...</p></div>`;

  try {
    const notices = await ApiService.getPublicNotices();
    if (!notices || notices.length === 0) {
      container.innerHTML = `
        <div class="text-center py-16 bg-slate-50 dark:bg-slate-800/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
          <p class="text-slate-500 font-medium">No announcements published at the moment.</p>
        </div>`;
      return;
    }

    container.innerHTML = notices.map(n => `
      <div class="glass border border-slate-200/60 dark:border-slate-800/60 p-6 sm:p-8 rounded-3xl shadow-sm flex flex-col md:flex-row md:items-start md:space-x-6 hover:shadow-md transition-shadow">
        <div class="md:w-40 shrink-0 mb-4 md:mb-0">
          <span class="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 px-3 py-1.5 rounded-full text-xs font-bold block text-center mb-2">
            ${n.date}
          </span>
          ${n.isUrgent ? `<span class="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400 px-3 py-1 rounded-full text-[10px] font-bold block text-center uppercase tracking-wide">Urgent</span>` : ''}
        </div>
        <div class="flex-1">
          <h3 class="text-xl font-bold text-slate-900 dark:text-white mb-2 leading-tight">${n.title}</h3>
          <p class="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-line leading-relaxed">${n.content}</p>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="text-center text-red-500 py-12 font-medium">Failed to load notices. Please refresh the page.</div>`;
  }
}

// Gallery Page Loader
async function loadGalleryPage() {
  const container = document.getElementById('gallery-page-container');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-12"><div class="inline-block w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div><p class="mt-4 text-slate-500 font-medium">Loading photos...</p></div>`;

  try {
    const photos = await ApiService.getPublicGallery();
    if (!photos || photos.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-16 bg-slate-50 dark:bg-slate-800/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
          <p class="text-slate-500 font-medium">Gallery is currently empty.</p>
        </div>`;
      return;
    }

    container.innerHTML = photos.map(p => `
      <div class="group relative overflow-hidden rounded-3xl bg-slate-100 dark:bg-slate-800 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer" onclick="openLightbox('${p.image}', '${encodeURIComponent(p.title)}')">
        <img src="${p.image}" alt="${p.title}" class="w-full h-64 object-cover transition-transform duration-500 group-hover:scale-110" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23eaeaea%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-family=%22sans-serif%22 fill=%22%23999%22>No Image</text></svg>'">
        <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
          <span class="text-xs text-slate-400 font-medium">${p.date}</span>
          <h4 class="text-base font-bold text-white mt-1">${p.title}</h4>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="col-span-full text-center text-red-500 py-12 font-medium">Failed to load gallery images.</div>`;
  }
}

// Lightbox modal handler
window.openLightbox = function(src, title) {
  const decodedTitle = decodeURIComponent(title);
  const modal = document.createElement('div');
  modal.id = 'lightbox-modal';
  modal.className = 'fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-fade-in';
  modal.innerHTML = `
    <button class="absolute top-6 right-6 text-white hover:text-amber-400 focus:outline-none" onclick="closeLightbox()">
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
    </button>
    <img src="${src}" class="max-w-full max-h-[80vh] rounded-xl shadow-2xl" alt="${decodedTitle}">
    <h3 class="text-white text-lg font-bold mt-6 text-center">${decodedTitle}</h3>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
};

window.closeLightbox = function() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) {
    modal.remove();
    document.body.style.overflow = '';
  }
};

// Admission inquiry form handler
function initAdmissionForm() {
  const form = document.getElementById('public-admission-inquiry');
  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';
  const sessionSelect = form.querySelector('[name="academicSession"]');
  if (sessionSelect) fetch('/api/academic-sessions').then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load academic sessions.'))).then(data => { sessionSelect.innerHTML = (data.sessions || []).filter(row => row.status !== 'Archived' || row.is_active).map(row => '<option value="' + String(row.session_name).replace(/"/g, '&quot;') + '" ' + (row.is_active ? 'selected' : '') + '>' + row.session_name + (row.is_active ? ' (Current)' : '') + '</option>').join(''); if (!sessionSelect.value && data.currentSession) sessionSelect.value = data.currentSession.session_name; }).catch(error => { console.error('[ACADEMIC SESSION LOAD]', error); sessionSelect.innerHTML = '<option value="">Academic sessions unavailable</option>'; });
  const status = document.getElementById('admission-form-status');
  const showStatus = (message, type) => {
    if (!status) return;
    status.textContent = message;
    status.className = 'rounded-xl px-4 py-3 ' + (type === 'error'
      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
      : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300');
  };
  const fileToData = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read ' + file.name + '.'));
    reader.readAsDataURL(file);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mr-2"></span>Submitting...';
    showStatus('Submitting application...', 'loading');
    try {
      const fields = Object.fromEntries(new FormData(form).entries());
      const photo = form.elements.studentPhoto.files[0];
      const documents = Array.from(form.elements.uploadedDocuments.files || []);
      if (photo && (!['image/png', 'image/jpeg'].includes(photo.type) || photo.size > 2 * 1024 * 1024)) {
        throw new Error('Student photo must be PNG or JPG and no larger than 2 MB.');
      }
      for (const file of documents) {
        if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          throw new Error('Each document must be PNG, JPG or PDF and no larger than 5 MB.');
        }
      }
      delete fields.uploadedDocuments;
      fields.studentPhoto = photo ? await fileToData(photo) : '';
      fields.uploadedDocuments = await Promise.all(documents.map(async file => ({ name: file.name, type: file.type, size: file.size, data: await fileToData(file) })));
      const result = await ApiService.submitAdmissionApplication(fields);
      form.reset();
      showStatus('Application submitted successfully. Application Number: ' + result.applicationNumber, 'success');
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4';
      modal.innerHTML = '<div class="bg-white dark:bg-slate-900 p-8 rounded-3xl max-w-md w-full shadow-2xl text-center space-y-4"><div class="bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold">&#10003;</div><h3 class="text-xl font-bold text-slate-900 dark:text-white">Application Submitted</h3><p class="text-sm text-slate-500 dark:text-slate-400">Your application number is <strong class="text-slate-900 dark:text-white">' + result.applicationNumber + '</strong>. Please keep it for reference.</p><button type="button" class="bg-amber-500 hover:bg-amber-400 text-slate-900 px-6 py-2.5 rounded-xl font-bold text-sm w-full">Close</button></div>';
      modal.querySelector('button').addEventListener('click', () => modal.remove());
      document.body.appendChild(modal);
    } catch (error) {
      console.error('[ONLINE ADMISSION SUBMIT]', error);
      showStatus(error.message || 'Unable to submit admission application.', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

// Contact form handler
function initContactForm() {
  const form = document.getElementById('public-contact-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<div class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div> Sending...`;
    btn.disabled = true;

    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
      form.reset();

      // Show alert or small modal
      alert("Your message has been sent to our administration team. We will get back to you soon!");
    }, 1200);
  });
}
