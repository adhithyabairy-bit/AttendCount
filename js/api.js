// ============================================================
// js/api.js — All Supabase API calls
// ============================================================

const ApiModule = (() => {
  function _db() {
    return AuthModule.getClient();
  }
  function _email() {
    return AuthModule.getUserEmail();
  }

  // ─── Caching ───────────────────────────────────────────
  let _cachedDashboard = null;
  let _cachedSemesterEndDate = undefined;
  let _cachedSlotTimings = null;

  function clearCache() {
    _cachedDashboard = null;
    _cachedSemesterEndDate = undefined;
    _cachedSlotTimings = null;
    clearNativeWidgetState();
  }

  // ─── Offline Queue ──────────────────────────────────────
  const OFFLINE_QUEUE_KEY = 'attendcount_offline_queue';

  function getOfflineQueue() {
    try {
      const q = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return q ? JSON.parse(q) : [];
    } catch (_) {
      return [];
    }
  }

  function setOfflineQueue(queue) {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (_) {}
  }

  function _queueOfflineAction(action) {
    const queue = getOfflineQueue();
    // Prevent duplicate entries for the same subject and date in the queue
    const filtered = queue.filter(item => !(item.subjectId === action.subjectId && item.date === action.date));
    filtered.push(action);
    setOfflineQueue(filtered);
  }

  async function syncOfflineQueue() {
    const queue = getOfflineQueue();
    if (!queue.length) return;
    if (!navigator.onLine) return;

    console.log(`[Offline Sync] Starting sync of ${queue.length} items...`);
    const remaining = [];
    let succeededCount = 0;

    for (const item of queue) {
      try {
        let error;
        if (item.status === null) {
          const res = await _db()
            .from('daily_logs')
            .delete()
            .eq('user_email', _email())
            .eq('subject_id', item.subjectId)
            .eq('date', item.date);
          error = res.error;
        } else {
          const res = await _db()
            .from('daily_logs')
            .upsert({
              user_email: _email(),
              subject_id: item.subjectId,
              date: item.date,
              status: item.status,
              source: 'manual',
            }, { onConflict: 'user_email,subject_id,date' });
          error = res.error;
        }
        if (error) throw error;
        succeededCount++;
      } catch (err) {
        console.warn(`[Offline Sync] Failed for ${item.subjectId}:`, err);
        remaining.push(item);
      }
    }

    setOfflineQueue(remaining);

    if (succeededCount > 0) {
      UIModule.toast(`Synced ${succeededCount} offline attendance logs!`, 'success');
      _cachedDashboard = null;
      if (window.DashboardModule && window.AppRouter && window.location.hash === '#dashboard') {
        window.DashboardModule.load();
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', syncOfflineQueue);
  }

  function getLocalCache() {
    try {
      const email = _email();
      if (!email) return null;
      const cached = localStorage.getItem(`attendcount_cache_${email}`);
      return cached ? JSON.parse(cached) : null;
    } catch (_) {
      return null;
    }
  }

  function setLocalCache(data) {
    try {
      const email = _email();
      if (!email) return;
      localStorage.setItem(`attendcount_cache_${email}`, JSON.stringify(data));
      // Sync state to native iOS/Android widgets
      syncToNativeWidget(email, data);
    } catch (_) {}
  }

  async function syncToNativeWidget(email, cacheData) {
    if (typeof window === 'undefined' || !window.Capacitor || !window.Capacitor.Plugins.WidgetBridge) {
      return;
    }
    try {
      const { WidgetBridge } = window.Capacitor.Plugins;
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
      const session = await AuthModule.getSession();
      
      const payload = {
        supabase_url: SUPABASE_URL || '',
        supabase_anon_key: SUPABASE_ANON_KEY || '',
        user_email: email,
        access_token: session?.access_token || '',
        refresh_token: session?.refresh_token || '',
        subjects: JSON.stringify(cacheData?.subjects || []),
        slot_timings: JSON.stringify(cacheData?.slotTimes || []),
        today_logs: JSON.stringify(cacheData?.todayLogs || {}),
        last_updated: new Date().toISOString()
      };

      for (const [key, val] of Object.entries(payload)) {
        await WidgetBridge.setItem({ key, value: String(val), group: 'group.app.attendcount' });
      }

      if (window.Capacitor.getPlatform() === 'android') {
        await WidgetBridge.setRegisteredWidgets({
          widgets: ['app.attendcount.twa.AttendanceWidgetProvider']
        });
      }

      await WidgetBridge.reloadAllTimelines();
      console.log('[WidgetSync] Successfully synced state to native widgets.');
    } catch (err) {
      console.warn('[WidgetSync] Failed to sync state to native widgets:', err);
    }
  }

  async function clearNativeWidgetState() {
    if (typeof window === 'undefined' || !window.Capacitor || !window.Capacitor.Plugins.WidgetBridge) {
      return;
    }
    try {
      const { WidgetBridge } = window.Capacitor.Plugins;
      const keys = ['supabase_url', 'supabase_anon_key', 'user_email', 'access_token', 'refresh_token', 'subjects', 'slot_timings', 'today_logs', 'last_updated'];
      for (const key of keys) {
        await WidgetBridge.removeItem({ key, group: 'group.app.attendcount' });
      }
      await WidgetBridge.reloadAllTimelines();
      console.log('[WidgetSync] Cleared native widget state.');
    } catch (err) {
      console.warn('[WidgetSync] Failed to clear native widget state:', err);
    }
  }

  // ─── Dashboard ─────────────────────────────────────────

  async function getDashboard(forceRefresh = false) {
    if (_cachedDashboard && !forceRefresh) {
      return _cachedDashboard;
    }
    const { data, error } = await _db().rpc('get_dashboard', { p_email: _email() });
    if (error) throw error;
    _cachedDashboard = data || [];
    return _cachedDashboard;
  }

  // ─── Subjects ───────────────────────────────────────────

  async function getSubjects() {
    const { data, error } = await _db()
      .from('subjects')
      .select('*')
      .eq('user_email', _email())
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function createSubject({ name, type, timetable = {}, color = '#adc6ff' }) {
    clearCache();
    const { data, error } = await _db()
      .from('subjects')
      .insert({ user_email: _email(), name, type, timetable, color })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateSubjectTimetable(subjectId, timetable) {
    clearCache();
    const { error } = await _db()
      .from('subjects')
      .update({ timetable })
      .eq('id', subjectId)
      .eq('user_email', _email());
    if (error) throw error;
  }

  async function updateSubject(subjectId, { name, type, timetable, color }) {
    clearCache();
    const { error } = await _db()
      .from('subjects')
      .update({ name, type, timetable, color })
      .eq('id', subjectId)
      .eq('user_email', _email());
    if (error) throw error;
  }

  async function deleteSubject(subjectId) {
    clearCache();
    const { error } = await _db()
      .from('subjects')
      .update({ is_active: false })
      .eq('id', subjectId)
      .eq('user_email', _email());
    if (error) throw error;
  }

  async function hasSubjects() {
    const data = await getDashboard();
    return data.length > 0;
  }


  // ─── Attendance Marking ─────────────────────────────────

  async function markAttendance(subjectId, date, status) {
    // 1. Update local cache and local storage cache immediately
    const cache = getLocalCache() || {};
    if (cache.todayLogs && date === UIModule.todayStr()) {
      cache.todayLogs[subjectId] = status;
    }
    if (cache.subjects) {
      const subj = cache.subjects.find(s => s.subject_id === subjectId || s.id === subjectId);
      if (subj) {
        const oldStatus = (cache.todayLogs && cache.todayLogs[subjectId]) || undefined;
        
        // Adjust subject stats in cache
        const weight = parseInt(subj.weight || 1);
        let rtHeld = parseInt(subj.realtime_held || 0);
        let rtAttended = parseInt(subj.realtime_attended || 0);

        if (oldStatus === 'present') {
          rtHeld -= weight;
          rtAttended -= weight;
        } else if (oldStatus === 'absent') {
          rtHeld -= weight;
        }

        if (status === 'present') {
          rtHeld += weight;
          rtAttended += weight;
        } else if (status === 'absent') {
          rtHeld += weight;
        }

        subj.realtime_held = Math.max(0, rtHeld);
        subj.realtime_attended = Math.max(0, rtAttended);
        const stats = calculateStats(subj);
        subj.percentage = stats.percentage;
        subj.safe_to_miss = stats.safeToMiss;
      }
    }
    setLocalCache(cache);

    // Clear memory cache so that the next online dashboard load gets fresh data
    _cachedDashboard = null;

    // 2. Perform or queue the write
    const isOnline = navigator.onLine;
    if (!isOnline) {
      _queueOfflineAction({ subjectId, date, status });
      return { success: true, offline: true };
    }

    try {
      const { error } = await _db()
        .from('daily_logs')
        .upsert({
          user_email: _email(),
          subject_id: subjectId,
          date,
          status,
          source: 'manual',
        }, { onConflict: 'user_email,subject_id,date' });
      if (error) throw error;
      return { success: true, offline: false };
    } catch (err) {
      if (err.message && (err.message.includes('Fetch') || err.message.includes('Network') || err.message.includes('Failed to fetch') || err.status === 0 || err.status === 503)) {
        _queueOfflineAction({ subjectId, date, status });
        return { success: true, offline: true };
      }
      throw err;
    }
  }

  async function clearAttendance(subjectId, date) {
    // 1. Update local cache and local storage cache immediately
    const cache = getLocalCache() || {};
    if (cache.todayLogs && date === UIModule.todayStr()) {
      delete cache.todayLogs[subjectId];
    }
    if (cache.subjects) {
      const subj = cache.subjects.find(s => s.subject_id === subjectId || s.id === subjectId);
      if (subj) {
        const oldStatus = (cache.todayLogs && cache.todayLogs[subjectId]) || undefined;
        
        // Adjust subject stats in cache
        const weight = parseInt(subj.weight || 1);
        let rtHeld = parseInt(subj.realtime_held || 0);
        let rtAttended = parseInt(subj.realtime_attended || 0);

        if (oldStatus === 'present') {
          rtHeld -= weight;
          rtAttended -= weight;
        } else if (oldStatus === 'absent') {
          rtHeld -= weight;
        }

        subj.realtime_held = Math.max(0, rtHeld);
        subj.realtime_attended = Math.max(0, rtAttended);
        const stats = calculateStats(subj);
        subj.percentage = stats.percentage;
        subj.safe_to_miss = stats.safeToMiss;
      }
    }
    setLocalCache(cache);

    // Clear memory cache so that the next online dashboard load gets fresh data
    _cachedDashboard = null;

    // 2. Perform or queue the write
    const isOnline = navigator.onLine;
    if (!isOnline) {
      _queueOfflineAction({ subjectId, date, status: null });
      return { success: true, offline: true };
    }

    try {
      const { error } = await _db()
        .from('daily_logs')
        .delete()
        .eq('user_email', _email())
        .eq('subject_id', subjectId)
        .eq('date', date);
      if (error) throw error;
      return { success: true, offline: false };
    } catch (err) {
      if (err.message && (err.message.includes('Fetch') || err.message.includes('Network') || err.message.includes('Failed to fetch') || err.status === 0 || err.status === 503)) {
        _queueOfflineAction({ subjectId, date, status: null });
        return { success: true, offline: true };
      }
      throw err;
    }
  }

  async function getLogsForDate(date) {
    const { data, error } = await _db()
      .from('daily_logs')
      .select('*, subjects(name, type, weight, color)')
      .eq('user_email', _email())
      .eq('date', date);
    if (error) throw error;
    return data || [];
  }

  async function getLogsForMonth(year, month) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end   = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    const { data, error } = await _db()
      .from('daily_logs')
      .select('date, status, label, subject_id')
      .eq('user_email', _email())
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // ─── Holidays ───────────────────────────────────────────

  /**
   * POST /mark_holiday equivalent
   * Marks a date range as holiday for ALL active subjects
   */
  async function markHoliday(dates, label = 'Holiday') {
    clearCache();
    const subjects = await getSubjects();
    const rows = [];
    for (const date of dates) {
      for (const subject of subjects) {
        rows.push({
          user_email: _email(),
          subject_id: subject.id,
          date,
          status: 'holiday',
          label,
          source: 'manual',
        });
      }
    }
    if (!rows.length) return;
    const { error } = await _db()
      .from('daily_logs')
      .upsert(rows, { onConflict: 'user_email,subject_id,date' });
    if (error) throw error;
  }

  async function removeHoliday(date) {
    clearCache();
    const { error } = await _db()
      .from('daily_logs')
      .delete()
      .eq('user_email', _email())
      .eq('date', date)
      .eq('status', 'holiday');
    if (error) throw error;
  }

  async function getHolidays(year, month) {
    const logs = await getLogsForMonth(year, month);
    // Deduplicate by date
    const seen = new Set();
    return logs.filter(l => {
      if (l.status === 'holiday' && !seen.has(l.date)) {
        seen.add(l.date);
        return true;
      }
      return false;
    });
  }



  // ─── Baseline / Portal Sync ─────────────────────────────

  async function setBaseline(subjectId, officialHeld, officialAttended) {
    clearCache();
    const { error } = await _db()
      .from('baseline')
      .upsert({
        user_email: _email(),
        subject_id: subjectId,
        official_held: officialHeld,
        official_attended: officialAttended,
        last_sync_date: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_email,subject_id' });
    if (error) throw error;
  }

  /**
   * POST /sync_portal equivalent
   * Updates baseline and purges daily_logs prior to sync date
   */
  async function syncPortal(subjectId, officialHeld, officialAttended, syncDate) {
    clearCache();
    // Update baseline
    const { error: bErr } = await _db()
      .from('baseline')
      .upsert({
        user_email: _email(),
        subject_id: subjectId,
        official_held: officialHeld,
        official_attended: officialAttended,
        last_sync_date: syncDate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_email,subject_id' });
    if (bErr) throw bErr;

    // Purge logs up to (and including) the sync date
    const { error: dErr } = await _db()
      .from('daily_logs')
      .delete()
      .eq('user_email', _email())
      .eq('subject_id', subjectId)
      .lte('date', syncDate);
    if (dErr) throw dErr;
  }

  // ─── Slot Timings ───────────────────────────────────────

  async function getSlotTimings() {
    if (_cachedSlotTimings) return _cachedSlotTimings;
    const { data } = await _db()
      .from('slot_timings')
      .select('slots')
      .eq('user_email', _email())
      .maybeSingle();
    _cachedSlotTimings = data?.slots || [
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
      { start: '13:00', end: '14:00' },
      { start: '14:00', end: '15:00' },
      { start: '15:00', end: '16:00' },
    ];
    return _cachedSlotTimings;
  }

  async function saveSlotTimings(slots) {
    _cachedSlotTimings = slots;
    clearCache();
    await _db().from('slot_timings').upsert({
      user_email: _email(),
      slots,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email' });
  }

  // ─── Error Logging ──────────────────────────────────────

  /**
   * POST /log_error — client-side crash reporting
   */
  async function logError(message, stack = '') {
    try {
      await _db().from('error_logs').insert({
        user_email: _email() || 'anonymous',
        message,
        stack,
        user_agent: navigator.userAgent,
        url: window.location.href,
      });
    } catch (_) {
      // Never throw from error logging
    }
  }

  // ─── Semester End Date ───────────────────────────────────

  async function getSemesterEndDate() {
    if (_cachedSemesterEndDate !== undefined) {
      return _cachedSemesterEndDate;
    }
    const { data, error } = await _db()
      .from('users')
      .select('semester_end_date')
      .eq('email', _email())
      .single();
    if (error) return null;
    _cachedSemesterEndDate = data?.semester_end_date || null;
    return _cachedSemesterEndDate;
  }

  async function setSemesterEndDate(date) {
    _cachedSemesterEndDate = date;
    clearCache();
    const { error } = await _db()
      .from('users')
      .update({ semester_end_date: date })
      .eq('email', _email());
    if (error) throw error;
  }

  async function getFutureHolidays(startDate, endDate) {
    const { data, error } = await _db()
      .from('daily_logs')
      .select('date, status, label')
      .eq('user_email', _email())
      .eq('status', 'holiday')
      .gte('date', startDate)
      .lte('date', endDate);
    if (error) throw error;
    return data || [];
  }

  // ─── Attendance Calculations (client-side) ──────────────

  function calculateStats(subject) {
    const {
      official_held = 0,
      official_attended = 0,
      realtime_held = 0,
      realtime_attended = 0,
    } = subject;

    const totalHeld     = parseInt(official_held) + parseInt(realtime_held);
    const totalAttended = parseInt(official_attended) + parseInt(realtime_attended);
    const percentage    = totalHeld > 0 ? (totalAttended / totalHeld) * 100 : 0;
    const safeToMiss    = totalHeld > 0 && percentage >= 75
      ? Math.floor((totalAttended - 0.75 * totalHeld) / 0.75)
      : 0;
    const needToAttend  = percentage < 75 && totalHeld > 0
      ? Math.ceil((0.75 * totalHeld - totalAttended) / 0.25)
      : 0;

    return { totalHeld, totalAttended, percentage, safeToMiss, needToAttend };
  }

  function predictWhatIf(currentStats, missCount, missWeight) {
    const { totalHeld, totalAttended } = currentStats;
    const newHeld = totalHeld + (missCount * missWeight);
    const newPct  = newHeld > 0 ? (totalAttended / newHeld) * 100 : 0;
    const delta   = newPct - (totalHeld > 0 ? (totalAttended / totalHeld) * 100 : 0);
    return { newPct, delta };
  }

  return {
    getDashboard,
    getSubjects,
    createSubject,
    updateSubject,
    updateSubjectTimetable,
    deleteSubject,
    hasSubjects,
    markAttendance,
    getLogsForDate,
    getLogsForMonth,
    markHoliday,
    removeHoliday,
    getHolidays,

    setBaseline,
    syncPortal,
    getSlotTimings,
    saveSlotTimings,
    logError,
    getSemesterEndDate,
    setSemesterEndDate,
    getFutureHolidays,
    calculateStats,
    predictWhatIf,
    clearCache,
    getLocalCache,
    setLocalCache,
    getOfflineQueue,
    syncOfflineQueue,
    clearAttendance,
  };
})();
