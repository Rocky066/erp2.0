(() => {
  'use strict';
  const paths = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    document: '<path d="M6 2h9l5 5v15H6Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10h.01M18 14h.01"/>',
    school: '<path d="m3 10 9-6 9 6M5 9v11h14V9M9 20v-6h6v6M2 20h20"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
    announce: '<path d="m3 11 15-5v12L3 14Z"/><path d="M11.6 16.1 13 21H7l-1.5-6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.33.7.6 1 .3.27.68.4 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    warning: '<path d="m12 3 10 18H2Z"/><path d="M12 9v4M12 17h.01"/>',
    save: '<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/>',
    bolt: '<path d="m13 2-9 12h8l-1 8 9-12h-8Z"/>',
    ticket: '<path d="M2 9a3 3 0 0 0 0 6v4h20v-4a3 3 0 0 0 0-6V5H2ZM13 5v14"/>',
    star: '<path d="m12 2 3 6 7 .9-5 4.8 1.2 6.8L12 17l-6.2 3.5L7 13.7 2 8.9 9 8Z"/>',
    cake: '<path d="M4 12h16v9H4ZM3 12h18M8 8v4M12 8v4M16 8v4M8 5h.01M12 5h.01M16 5h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m5 5 14 14"/>',
    vacation: '<path d="M3 21h18M6 18l4-8M10 10c-3-4-6-2-7 0 3-1 5 0 7 2M10 10c3-4 7-2 8 0-4-1-6 0-8 2M10 10c0-4 3-6 5-6-1 3-2 5-5 6"/>',
    hourglass: '<path d="M6 2h12M6 22h12M7 2c0 5 2 7 5 10-3 3-5 5-5 10M17 2c0 5-2 7-5 10 3 3 5 5 5 10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5ZM4 19.5V5.5M8 7h8"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8-8M18 5l1 1M15 8l1 1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 9A7 7 0 0 1 18 6l2 6M17.9 15A7 7 0 0 1 6 18l-2-6"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6Z"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.12.9.34 1.8.65 2.65a2 2 0 0 1-.45 2.1L8 9.7a16 16 0 0 0 6.3 6.3l1.25-1.25a2 2 0 0 1 2.1-.45c.85.31 1.74.53 2.65.65A2 2 0 0 1 22 16.9Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    sort: '<path d="M8 7 5 4 2 7M5 4v16M16 17l3 3 3-3M19 20V4"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="10" r="1"/><path d="M12 21a3 3 0 0 1 0-6h2a2 2 0 0 0 2-2"/>',
    handshake: '<path d="m8 11 3 3a2 2 0 0 0 3 0l4-4M2 12l4-5 4 3M22 12l-4-5-4 3M7 15l2 2M10 18l1 1"/>',
    cut: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.7 8.3 12.3 7M8.7 15.7 21 9"/>'
  };
  const tokenToIcon = {
    '✓':'check','✅':'check','❌':'x','✕':'x','🚫':'ban','⚠️':'warning','⚡':'bolt','✨':'star','⭐':'star','🎉':'star','🎓':'school','👤':'user','👩‍🏫':'user','👥':'users','💼':'money','💵':'money','💰':'money','💸':'money','💳':'card','🪪':'card','🎫':'ticket','📊':'chart','📝':'edit','✏️':'edit','✍️':'edit','🖋️':'edit','📅':'calendar','📋':'clipboard','📜':'document','📄':'document','📑':'document','📚':'book','📢':'announce','🔔':'bell','🖼️':'image','🌐':'globe','💬':'message','⚙️':'settings','🚪':'logout','☰':'menu','💾':'save','🎂':'cake','🏖️':'vacation','⏳':'hourglass','➕':'plus','🔑':'key','🔒':'lock','📥':'download','📤':'upload','📩':'mail','✉️':'mail','🔄':'refresh','🖨️':'print','📲':'phone','📱':'phone','📞':'phone','🔍':'search','↕':'sort','🗑️':'trash','👁️':'eye','🙈':'eye','🏫':'school','🐣':'user','🎒':'book','🤝':'handshake','🎨':'palette','✂':'cut','🚀':'bolt'
  };
  function makeIcon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'gjv-ui-icon'); svg.innerHTML = paths[name] || paths.star;
    return svg;
  }
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  function segments(text) { return segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text); }
  function replaceTextNode(node) {
    if (!node.nodeValue || !Object.keys(tokenToIcon).some(token => node.nodeValue.includes(token))) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,textarea,svg,[data-preserve-emoji]')) return;
    const fragment = document.createDocumentFragment(); let changed = false; let text = '';
    const flush = () => { if (text) { fragment.appendChild(document.createTextNode(text)); text = ''; } };
    for (const part of segments(node.nodeValue)) {
      const iconName = tokenToIcon[part];
      if (!iconName) { text += part; continue; }
      flush(); fragment.appendChild(makeIcon(iconName)); changed = true;
    }
    flush(); if (changed) node.replaceWith(fragment);
  }
  function hydrate(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return replaceTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode); nodes.forEach(replaceTextNode);
  }
  const css = document.createElement('style');
  css.textContent = '.gjv-ui-icon{width:1em;height:1em;display:inline-block;vertical-align:-.14em;flex:0 0 auto}.gjv-ui-icon+span{margin-left:.15em}';
  document.head.appendChild(css);
  const start = () => {
    hydrate(document.body);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(hydrate))).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.GJVIconRuntime = { hydrate, supports: token => Boolean(tokenToIcon[token]) };
})();