// ============================================================
// js/ui.js — Shared UI utilities
// ============================================================

const UIModule = (() => {
  const COLORS = {
    safe:     { primary: '#4ade80', bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.3)' },
    warning:  { primary: '#fabd00', bg: 'rgba(250,189,0,0.15)',  border: 'rgba(250,189,0,0.3)'  },
    critical: { primary: '#ff5545', bg: 'rgba(255,85,69,0.15)',  border: 'rgba(255,85,69,0.3)'  },
    primary:  { primary: '#adc6ff', bg: 'rgba(173,198,255,0.1)', border: 'rgba(173,198,255,0.2)' },
  };

  const SUBJECT_COLORS = [
    '#adc6ff', '#fabd00', '#4ade80', '#c084fc',
    '#fb923c', '#38bdf8', '#f472b6', '#a3e635',
  ];

  // ─── Page Navigation ──────────────────────────────────────

  function showPage(pageId) {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    const page = document.getElementById(`page-${pageId}`);
    if (page) {
      page.classList.remove('hidden');
      // Update bottom nav active state
      document.querySelectorAll('[data-nav]').forEach(link => {
        link.classList.remove('text-primary', 'bg-primary/10');
        link.classList.add('text-on-surface-variant');
        if (link.dataset.nav === pageId) {
          link.classList.add('text-primary', 'bg-primary/10');
          link.classList.remove('text-on-surface-variant');
        }
      });
    }
  }

  function showLoader(show = true) {
    const loader = document.getElementById('app-loader');
    if (loader) loader.classList.toggle('hidden', !show);
  }

  // ─── Toast Notifications ─────────────────────────────────

  let _toastTimer = null;
  function toast(message, type = 'info', duration = 3000) {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();
    if (_toastTimer) clearTimeout(_toastTimer);

    const colors = {
      info:    'bg-surface-container border-primary/30 text-on-surface',
      success: 'bg-green-900/80 border-green-500/30 text-green-100',
      error:   'bg-red-900/80 border-red-500/30 text-red-100',
      warning: 'bg-yellow-900/80 border-yellow-500/30 text-yellow-100',
    };
    const icons = { info: 'info', success: 'check_circle', error: 'error', warning: 'warning' };

    const el = document.createElement('div');
    el.id = 'app-toast';
    el.className = `fixed top-20 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-5 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl font-body-sm text-body-sm animate-in fade-in slide-in-from-top-4 duration-300 max-w-[90vw] ${colors[type]}`;
    el.innerHTML = `<span class="material-symbols-outlined text-[18px]">${icons[type]}</span><span>${message}</span>`;
    document.body.appendChild(el);

    _toastTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -10px)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ─── Progress Ring (SVG arc) ─────────────────────────────

  function updateRing(svgId, percentage, color) {
    const svg  = document.getElementById(svgId);
    if (!svg) return;
    const circle = svg.querySelector('.ring-fill');
    if (!circle) return;

    const r           = parseFloat(circle.getAttribute('r'));
    const circumference = 2 * Math.PI * r;
    const offset      = circumference * (1 - Math.min(100, Math.max(0, percentage)) / 100);

    circle.style.strokeDasharray  = `${circumference}`;
    circle.style.strokeDashoffset = `${offset}`;
    circle.style.stroke            = color;
  }

  function getAttendanceColor(pct) {
    if (pct >= 85) return COLORS.safe.primary;
    if (pct >= 75) return COLORS.warning.primary;
    return COLORS.critical.primary;
  }

  function getAttendanceBadge(pct) {
    if (pct >= 85) return { label: 'SAFE',     color: COLORS.safe.primary,     bg: COLORS.safe.bg,     border: COLORS.safe.border     };
    if (pct >= 75) return { label: 'ON TRACK', color: COLORS.warning.primary,  bg: COLORS.warning.bg,  border: COLORS.warning.border  };
    return             { label: 'CRITICAL',  color: COLORS.critical.primary, bg: COLORS.critical.bg, border: COLORS.critical.border };
  }

  // ─── Loading Skeleton ─────────────────────────────────────

  function skeleton(lines = 3) {
    return Array.from({ length: lines }, (_, i) =>
      `<div class="h-4 bg-white/5 rounded-lg animate-pulse mb-2 ${i === 0 ? 'w-3/4' : i % 2 === 0 ? 'w-full' : 'w-1/2'}"></div>`
    ).join('');
  }

  // ─── User Avatar ─────────────────────────────────────────

  function updateUserAvatar() {
    const user = AuthModule.getUser();
    if (!user) return;
    const imgEls = document.querySelectorAll('.user-avatar-img');
    const nameEls = document.querySelectorAll('.user-display-name');
    const emailEls = document.querySelectorAll('.user-email');

    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
    const name = user.user_metadata?.full_name || user.user_metadata?.name || 'User';
    const email = user.email || '';

    imgEls.forEach(el => {
      if (avatarUrl) {
        el.src = avatarUrl;
        el.alt = name;
      }
    });
    nameEls.forEach(el => el.textContent = name);
    emailEls.forEach(el => el.textContent = email);
  }

  // ─── Micro-interactions ──────────────────────────────────

  function addHaptic(el) {
    if (!el) return;
    el.addEventListener('click', () => {
      if ('vibrate' in navigator) navigator.vibrate(30);
    });
  }

  function formatDate(dateStr) {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function parseLocalDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
  }

  function toLocalDateStr(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function todayStr() {
    return toLocalDateStr(new Date());
  }

  function addDays(d, days) {
    const res = new Date(d);
    res.setDate(res.getDate() + days);
    return res;
  }

  function todayDayName() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }

  function getSubjectColor(index) {
    return SUBJECT_COLORS[index % SUBJECT_COLORS.length];
  }

  // ─── Confirmation Dialog ─────────────────────────────────

  function confirm(message, onConfirm) {
    const existing = document.getElementById('confirm-dialog');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'confirm-dialog';
    el.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4';
    el.innerHTML = `
      <div class="glass-card rounded-2xl p-6 w-full max-w-sm space-y-4 animate-in fade-in zoom-in duration-200">
        <p class="font-body-lg text-on-surface">${message}</p>
        <div class="flex gap-3">
          <button id="confirm-cancel" class="flex-1 py-3 rounded-xl bg-white/5 text-on-surface-variant font-label-caps text-label-caps uppercase">Cancel</button>
          <button id="confirm-ok" class="flex-1 py-3 rounded-xl bg-error text-white font-label-caps text-label-caps uppercase">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    el.querySelector('#confirm-cancel').onclick = () => el.remove();
    el.querySelector('#confirm-ok').onclick = () => { el.remove(); onConfirm(); };
  }

  return {
    showPage,
    showLoader,
    toast,
    updateRing,
    getAttendanceColor,
    getAttendanceBadge,
    skeleton,
    updateUserAvatar,
    addHaptic,
    formatDate,
    parseLocalDate,
    toLocalDateStr,
    todayStr,
    addDays,
    todayDayName,
    getSubjectColor,
    confirm,
    COLORS,
    SUBJECT_COLORS,
  };
})();
