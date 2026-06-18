// ============================================================
// js/auth.js — Supabase Auth + Google OAuth
// ============================================================

const AuthModule = (() => {
  let _supabase = null;
  let _currentUser = null;
  let _authChangeCallbacks = [];

  function init() {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Explicitly pin to localStorage so sessions survive PWA standalone
        // restarts and service worker cache bumps across all Android/iOS contexts.
        storage: window.localStorage,
        // Use the default Supabase key so existing sessions are preserved.
        // DO NOT change storageKey — it would force every user to re-login.
      }
    });

    // Migrate any legacy session stored under our old custom key
    _migrateLegacySession();

    // Listen for auth state changes
    _supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        _currentUser = session.user;
        // Run database upsert asynchronously to avoid blocking the event loop
        _upsertUserRecord(session.user).catch(err => {
          console.warn('[Auth] Failed to upsert user record:', err);
        });
      } else {
        _currentUser = null;
      }
      _authChangeCallbacks.forEach(cb => cb(event, session));
    });

    return _supabase;
  }

  function _migrateLegacySession() {
    // Move session stored under our old custom key (from a previous buggy commit)
    // to the Supabase default key so it is found on next open.
    try {
      const LEGACY_KEY = 'attendcount-session';
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return;
      const { SUPABASE_URL: url } = window.APP_CONFIG || {};
      const ref = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
      if (!ref) return;
      const defaultKey = `sb-${ref}-auth-token`;
      if (!localStorage.getItem(defaultKey)) {
        // Only migrate if the default key is empty to avoid overwriting a newer session
        localStorage.setItem(defaultKey, legacy);
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
  }

  function hasStoredSession() {
    // Returns true if ANY Supabase session is persisted in localStorage.
    // Used by the boot flow to avoid showing the login page when the network
    // is unavailable and the token refresh fails (the session is still valid).
    try {
      const { SUPABASE_URL: url } = window.APP_CONFIG || {};
      const ref = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
      const defaultKey = ref ? `sb-${ref}-auth-token` : null;
      const legacyKey  = 'attendcount-session';

      const raw = (defaultKey ? localStorage.getItem(defaultKey) : null)
                || localStorage.getItem(legacyKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      // Must have at least a refresh_token to be considered a valid stored session
      return !!(parsed?.refresh_token);
    } catch (_) {
      return false;
    }
  }

  async function _upsertUserRecord(user) {
    if (!_supabase) return;
    const { email, user_metadata } = user;
    try {
      await _supabase.from('users').upsert({
        email,
        name: user_metadata?.full_name || user_metadata?.name || '',
        avatar_url: user_metadata?.avatar_url || user_metadata?.picture || '',
      }, { onConflict: 'email', ignoreDuplicates: false });
    } catch (err) {
      console.warn('[Auth] _upsertUserRecord database error:', err);
    }
  }

  async function signInWithGoogle() {
    try {
      if (!_supabase) init();

      // Always redirect back to wherever the user opened the app from.
      // On Vercel this will be https://attend-count.vercel.app/
      // On localhost this will be http://localhost:3000/
      const redirectTo = window.location.origin + '/';

      const { error } = await _supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          scopes: 'email profile',
        },
      });
      if (error) throw error;
    } catch (err) {
      if (window.UIModule && typeof window.UIModule.toast === 'function') {
        window.UIModule.toast('Sign in failed: ' + err.message, 'error');
      }
      throw err;
    }
  }

  async function signOut() {
    if (!_supabase) return;
    const { error } = await _supabase.auth.signOut();
    if (error) throw error;
    _currentUser = null;
  }

  async function getSession() {
    if (!_supabase) return null;
    const { data: { session } } = await _supabase.auth.getSession();
    return session;
  }

  function getUser() {
    if (_currentUser) return _currentUser;
    try {
      const { SUPABASE_URL: url } = window.APP_CONFIG || {};
      const ref = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
      const defaultKey = ref ? `sb-${ref}-auth-token` : null;
      const legacyKey  = 'attendcount-session';

      const raw = (defaultKey ? localStorage.getItem(defaultKey) : null)
                || localStorage.getItem(legacyKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.user) {
          return parsed.user;
        }
      }
    } catch (_) {}
    return null;
  }

  function getUserEmail() {
    return getUser()?.email || null;
  }



  function onAuthChange(callback) {
    _authChangeCallbacks.push(callback);
  }

  function getClient() {
    if (!_supabase) init();
    return _supabase;
  }

  return {
    init,
    signInWithGoogle,
    signOut,
    getSession,
    getUser,
    getUserEmail,
    onAuthChange,
    getClient,
    hasStoredSession,
  };
})();
