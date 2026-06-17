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
      }
    });

    // Listen for auth state changes
    _supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        _currentUser = session.user;
        await _upsertUserRecord(session.user);
      } else {
        _currentUser = null;
      }
      _authChangeCallbacks.forEach(cb => cb(event, session));
    });

    return _supabase;
  }

  async function _upsertUserRecord(user) {
    if (!_supabase) return;
    const { email, user_metadata } = user;
    await _supabase.from('users').upsert({
      email,
      name: user_metadata?.full_name || user_metadata?.name || '',
      avatar_url: user_metadata?.avatar_url || user_metadata?.picture || '',
    }, { onConflict: 'email', ignoreDuplicates: false });
  }

  async function signInWithGoogle() {
    if (!_supabase) init();
    const { error } = await _supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Request calendar.readonly so we can sync Google Calendar events
        scopes: 'email profile https://www.googleapis.com/auth/calendar.readonly',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        redirectTo: window.location.origin + '/',
      },
    });
    if (error) throw error;
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
    return _currentUser;
  }

  function getUserEmail() {
    return _currentUser?.email || null;
  }

  function getGoogleAccessToken() {
    // The Google access token is stored in the session's provider_token
    // We need to re-fetch the session to get the latest token
    return _supabase?.auth.getSession().then(({ data: { session } }) => {
      return session?.provider_token || null;
    });
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
    getGoogleAccessToken,
    onAuthChange,
    getClient,
  };
})();
