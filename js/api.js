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
    try {
      const email = _email();
      if (email) {
        localStorage.removeItem(`attendcount_cache_${email}`);
      }
    } catch (_) {}
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
    } catch (_) {}
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
    clearCache();
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
  };
})();
