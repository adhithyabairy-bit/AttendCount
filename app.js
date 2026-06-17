// ============================================================
// app.js — Main Router & Application Bootstrap
// ============================================================

const AppRouter = (() => {
  let _currentPage = null;
  let _routingInProgress = false; // Guard against double-routing race condition
  let _postOnboardingDest = null; // Where to go after onboarding finishes

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
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          window.bootLog?.(`Session confirmed for ${session.user.email}`);
          UIModule.updateUserAvatar();
          clearTimeout(loaderTimeout); // Clear early to prevent 10s login fallback
          if (!_routingInProgress) {
            _routingInProgress = true;
            try {
              await _routeAfterAuth();
            } catch (err) {
              console.error('[Boot] _routeAfterAuth error:', err);
              navigate('dashboard');
            } finally {
              _routingInProgress = false;
            }
          }
        } else if (event === 'SIGNED_IN') {
          // SIGNED_IN with no user is an error state — go to login
          window.bootLog?.("SIGNED_IN with no user — navigating to login");
          if (!_routingInProgress) {
            clearTimeout(loaderTimeout);
            navigate('login');
          }
        }
        // NOTE: INITIAL_SESSION with null session is normal on first tick before
        // Supabase has read the stored token. We let the getSession() fallback below
        // handle the "no session" case to avoid a false redirect to login.
      } else if (event === 'SIGNED_OUT') {
        window.bootLog?.("User signed out, navigating to login");
        ApiModule.clearCache();
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

    // ─── Offline-Resilient Session Check ───────────────────────
    // getSession() awaits the stored token read + possible network token refresh.
    // If the refresh is slow (e.g. poor network), we race it with a timeout to avoid
    // blocking the boot sequence.
    window.bootLog?.("Checking current auth session...");
    let session = null;
    try {
      const sessionPromise = AuthModule.getSession();
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 2500));
      const result = await Promise.race([sessionPromise, timeoutPromise]);
      if (result === 'timeout') {
        window.bootLog?.('getSession timed out after 2.5s — using fallback');
      } else {
        session = result;
      }
    } catch (err) {
      window.bootLog?.('getSession() threw: ' + err.message);
    }
    window.bootLog?.("Auth session check finished. user=" + (session?.user?.email || 'none'));

    if (_routingInProgress) {
      // onAuthStateChange already handled routing — nothing to do
      return;
    }

    async function _safeRoute() {
      clearTimeout(loaderTimeout); // Clear early to prevent 10s login fallback
      _routingInProgress = true;
      try {
        await _routeAfterAuth();
      } catch (err) {
        console.error('[Boot] _routeAfterAuth error:', err);
        navigate('dashboard');
      } finally {
        _routingInProgress = false;
      }
    }

    if (session?.user) {
      // Normal path: valid (possibly refreshed) session
      window.bootLog?.(`Routing active session for ${session.user.email}...`);
      UIModule.updateUserAvatar();
      await _safeRoute();
    } else if (AuthModule.hasStoredSession()) {
      // Offline/Slow path: token expired or refresh pending but session IS stored.
      // Route to dashboard — shows cached data immediately, updates when online.
      window.bootLog?.('getSession null or timeout but stored session found — routing to cached dashboard.');
      UIModule.updateUserAvatar();
      await _safeRoute();
    } else {
      // Truly no session — show login
      window.bootLog?.('No session found — showing login.');
      clearTimeout(loaderTimeout);
      UIModule.showLoader(false);
      navigate('login');
    }
  }

  async function _routeAfterAuth() {
    window.bootLog?.("Querying user subjects...");

    // Offline-resilient & Instant Boot: Check local cache first so routing is instantaneous (0ms blocking).
    // This prevents slow network requests from delaying the boot flow.
    let hasSubj = false;
    const cached = ApiModule.getLocalCache();
    if (cached?.subjects?.length) {
      hasSubj = true;
      window.bootLog?.('Cache-first subject check: has subjects. Routing immediately.');
    } else {
      try {
        hasSubj = await ApiModule.hasSubjects();
      } catch (err) {
        window.bootLog?.('hasSubjects() error: ' + err.message);
      }
    }

    window.bootLog?.(`Subject check finished. hasSubjects = ${hasSubj}`);
    const hash = window.location.hash.replace('#', '');
    const validPages = ['dashboard', 'holidays', 'classes', 'quick'];

    let dest;
    if (!hasSubj) {
      dest = 'setup';
    } else if (validPages.includes(hash)) {
      dest = hash;
    } else {
      dest = 'dashboard';
    }

    // Show onboarding once if needed (before going to real dest)
    if (OnboardingModule.shouldShow()) {
      window.bootLog?.("Showing onboarding screen.");
      _postOnboardingDest = dest;
      navigate('onboarding');
    } else {
      window.bootLog?.(`Routing to ${dest}.`);
      navigate(dest);
    }

    // Start class reminder checker (every 60 seconds)
    PushModule.checkCurrentClass();
    setInterval(PushModule.checkCurrentClass, 60_000);
  }

  function _continueAfterOnboarding() {
    const dest = _postOnboardingDest || 'dashboard';
    _postOnboardingDest = null;
    navigate(dest);
  }

  // ─── Navigation ───────────────────────────────────────────

  function navigate(page) {
    if (_currentPage === page) return;
    _currentPage = page;

    const mainPages   = ['dashboard', 'holidays', 'classes'];
    const showMainShell = mainPages.includes(page);

    // Update hash — don't pollute history for internal pages
    if (page === 'login' || page === 'onboarding') {
      window.history.replaceState(null, '', '/');
    } else {
      window.history.replaceState(null, '', `#${page}`);
    }

    // Toggle header + nav
    document.getElementById('main-header')?.classList.toggle('hidden', !showMainShell);
    document.getElementById('main-nav')?.classList.toggle('hidden', !showMainShell);

    // Show page
    UIModule.showLoader(true);
    UIModule.showPage(page);

    // Trigger page-specific load
    if (page === 'dashboard') {
      DashboardModule.load().then(() => DashboardModule.initWhatIf());
    } else if (page === 'holidays') {
      HolidaysModule.load();
    } else if (page === 'classes') {
      ClassesModule.load();
    } else if (page === 'setup') {
      SetupModule.init();
      UIModule.showLoader(false);
    } else if (page === 'onboarding') {
      // Refresh native install button in case beforeinstallprompt already fired
      const nativeBtn = document.getElementById('onboarding-native-install');
      const manualDiv = document.getElementById('onboarding-manual-install');
      if (nativeBtn && manualDiv) {
        const hasPrompt = !!_installPrompt;
        nativeBtn.classList.toggle('hidden', !hasPrompt);
        nativeBtn.classList.toggle('flex', hasPrompt);
        manualDiv.classList.toggle('hidden', hasPrompt);
      }
      UIModule.showLoader(false);
    } else if (page === 'quick') {
      QuickModule.load();
      UIModule.showLoader(false);
    } else {
      UIModule.showLoader(false);
    }
  }

  function _handleHashChange() {
    const page = window.location.hash.replace('#', '');
    if (['dashboard', 'holidays', 'classes', 'quick'].includes(page)) {
      navigate(page);
    }
  }

  // ─── Auth Actions ─────────────────────────────────────────

  async function signOut() {
    document.getElementById('profile-popup')?.classList.add('hidden');
    UIModule.showLoader(true);
    try {
      ApiModule.clearCache();
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

  async function triggerInstall() {
    if (!_installPrompt) return false;
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    if (outcome === 'accepted') {
      UIModule.toast('AttendCount installed!', 'success');
      _installPrompt = null;
      document.getElementById('install-banner')?.remove();
      return true;
    }
    return false;
  }

  function getInstallPrompt() {
    return _installPrompt;
  }

  // Start the app
  document.addEventListener('DOMContentLoaded', boot);

  const routerObj = { navigate, signOut, requestPushPermission, triggerInstall, getInstallPrompt, _continueAfterOnboarding };
  window.AppRouter = routerObj;
  return routerObj;
})();
