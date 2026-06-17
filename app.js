// ============================================================
// app.js — Main Router & Application Bootstrap
// ============================================================

const AppRouter = (() => {
  let _currentPage = null;
  let _routingInProgress = false; // Guard against double-routing race condition

  // ─── Bootstrap ────────────────────────────────────────────

  async function boot() {
    window.bootLog?.("App boot started");

    // Safety timeout: if boot takes >10 seconds, force-show login to avoid infinite loader
    const loaderTimeout = setTimeout(() => {
      if (document.getElementById('app-loader')?.style.display !== 'none'
          && !_currentPage) {
        console.warn('[Boot] Timeout reached — forcing login page.');
        UIModule.showLoader(false);
        navigate('login');
      }
    }, 10000);

    // Register Service Worker (non-blocking)
    if ('serviceWorker' in navigator) {
      window.bootLog?.("Registering Service Worker...");
      navigator.serviceWorker.register('/sw.js').then(() => {
        window.bootLog?.("Service Worker registered.");
      }).catch(err => {
        console.warn('[SW] Registration failed:', err);
      });
    }

    // Initialize auth
    window.bootLog?.("Initializing Supabase client...");
    AuthModule.init();
    window.bootLog?.("Supabase client initialized.");

    // Listen for auth state changes
    // NOTE: Supabase fires INITIAL_SESSION immediately on init, which can race with
    // the explicit getSession() check below. The _routingInProgress guard prevents
    // double-routing which would leave the loader stuck.
    AuthModule.onAuthChange(async (event, session) => {
      window.bootLog?.(`Auth event triggered: ${event}`);
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (session?.user) {
          window.bootLog?.(`Session confirmed for ${session.user.email}`);
          UIModule.updateUserAvatar();
          if (!_routingInProgress) {
            _routingInProgress = true;
            await _routeAfterAuth();
            clearTimeout(loaderTimeout);
            _routingInProgress = false;
          }
        } else {
          window.bootLog?.("No user in session, navigating to login");
          if (!_routingInProgress) {
            clearTimeout(loaderTimeout);
            navigate('login');
          }
        }
      } else if (event === 'SIGNED_OUT') {
        window.bootLog?.("User signed out, navigating to login");
        _routingInProgress = false;
        navigate('login');
      }
    });

    // Hash-based navigation
    window.addEventListener('hashchange', _handleHashChange);

    // Initialize Push (non-blocking)
    window.bootLog?.("Initializing Push manager...");
    PushModule.init();
    window.bootLog?.("Push manager initialized.");

    // Set today's label on dashboard
    const todayLabel = document.getElementById('today-label');
    if (todayLabel) todayLabel.textContent = UIModule.todayDayName();

    // Profile button
    document.getElementById('profile-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('profile-popup')?.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      document.getElementById('profile-popup')?.classList.add('hidden');
    });

    // Explicit session check as fallback — only routes if onAuthStateChange
    // hasn't already handled it (INITIAL_SESSION fires ~instantly on Supabase v2).
    window.bootLog?.("Checking current auth session...");
    const session = await AuthModule.getSession();
    window.bootLog?.("Auth session check finished.");
    if (!_routingInProgress && !_currentPage) {
      if (session?.user) {
        window.bootLog?.(`Routing active session for ${session.user.email}...`);
        UIModule.updateUserAvatar();
        _routingInProgress = true;
        await _routeAfterAuth();
        clearTimeout(loaderTimeout);
        _routingInProgress = false;
      } else {
        window.bootLog?.("No active session found, showing login page...");
        clearTimeout(loaderTimeout);
        UIModule.showLoader(false);
        navigate('login');
      }
    }
  }

  async function _routeAfterAuth() {
    window.bootLog?.("Querying user subjects in database...");
    const hasSubj = await ApiModule.hasSubjects();
    window.bootLog?.(`Subject query finished. hasSubjects = ${hasSubj}`);
    const hash = window.location.hash.replace('#', '');
    const validPages = ['dashboard', 'holidays', 'classes'];

    if (!hasSubj) {
      window.bootLog?.("No subjects configured. Routing to setup wizard.");
      navigate('setup');
    } else if (validPages.includes(hash)) {
      window.bootLog?.(`Routing to cached hash page: #${hash}`);
      navigate(hash);
    } else {
      window.bootLog?.("Routing to dashboard.");
      navigate('dashboard');
    }

    // Start class reminder checker (every 60 seconds)
    PushModule.checkCurrentClass();
    setInterval(PushModule.checkCurrentClass, 60_000);
  }

  // ─── Navigation ───────────────────────────────────────────

  function navigate(page) {
    if (_currentPage === page) return;
    _currentPage = page;

    const mainPages = ['dashboard', 'holidays', 'classes'];
    const showMainShell = mainPages.includes(page);

    // Update hash
    if (page !== 'login') {
      window.history.replaceState(null, '', `#${page}`);
    } else {
      window.history.replaceState(null, '', '/');
    }

    // Toggle header + nav
    document.getElementById('main-header')?.classList.toggle('hidden', !showMainShell);
    document.getElementById('main-nav')?.classList.toggle('hidden', !showMainShell);

    // Show page
    UIModule.showPage(page);
    UIModule.showLoader(false);

    // Trigger page-specific load
    if (page === 'dashboard') {
      DashboardModule.load().then(() => DashboardModule.initWhatIf());
    } else if (page === 'holidays') {
      HolidaysModule.load();
    } else if (page === 'classes') {
      ClassesModule.load();
    } else if (page === 'setup') {
      SetupModule.init();
    }
  }

  function _handleHashChange() {
    const page = window.location.hash.replace('#', '');
    if (['dashboard', 'holidays', 'classes'].includes(page)) {
      navigate(page);
    }
  }

  // ─── Auth Actions ─────────────────────────────────────────

  async function signOut() {
    document.getElementById('profile-popup')?.classList.add('hidden');
    UIModule.showLoader(true);
    try {
      await AuthModule.signOut();
    } catch (_) {
      navigate('login');
    }
  }

  async function requestPushPermission() {
    document.getElementById('profile-popup')?.classList.add('hidden');
    const granted = await PushModule.requestPermission();
    if (granted) await PushModule.subscribe();
  }

  // ─── Global Error Boundary ────────────────────────────────

  window.addEventListener('error', (event) => {
    ApiModule.logError(event.message, event.error?.stack || '');
  });

  window.addEventListener('unhandledrejection', (event) => {
    ApiModule.logError(
      event.reason?.message || 'Unhandled promise rejection',
      event.reason?.stack || ''
    );
  });

  // ─── PWA Install Prompt ───────────────────────────────────

  let _installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _installPrompt = e;
    // Show install banner after 3 seconds if on login page
    setTimeout(() => {
      if (_currentPage === 'login' || !_currentPage) _showInstallBanner();
    }, 3000);
  });

  function _showInstallBanner() {
    if (!_installPrompt) return;
    const existing = document.getElementById('install-banner');
    if (existing) return;

    const banner = document.createElement('div');
    banner.id = 'install-banner';
    banner.className = 'fixed bottom-4 left-4 right-4 z-[400] glass-card rounded-2xl p-4 flex items-center gap-4 border border-primary/20 animate-in fade-in slide-in-from-bottom-4 duration-300';
    banner.innerHTML = `
      <span class="material-symbols-outlined text-primary text-[28px] shrink-0">install_mobile</span>
      <div class="flex-1">
        <p class="font-headline-md text-[15px] text-on-surface">Install AttendCount</p>
        <p class="font-body-sm text-on-surface-variant">Add to home screen for the full app experience</p>
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button id="install-yes" class="px-4 py-2 rounded-xl bg-primary text-on-primary font-label-caps text-[11px] font-bold">INSTALL</button>
        <button id="install-no" class="px-4 py-2 text-on-surface-variant font-label-caps text-[11px]">NOT NOW</button>
      </div>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#install-yes').onclick = async () => {
      banner.remove();
      if (_installPrompt) {
        _installPrompt.prompt();
        const { outcome } = await _installPrompt.userChoice;
        if (outcome === 'accepted') UIModule.toast('AttendCount installed!', 'success');
        _installPrompt = null;
      }
    };
    banner.querySelector('#install-no').onclick = () => banner.remove();
  }

  // Start the app
  document.addEventListener('DOMContentLoaded', boot);

  const routerObj = { navigate, signOut, requestPushPermission };
  window.AppRouter = routerObj;
  return routerObj;
})();
