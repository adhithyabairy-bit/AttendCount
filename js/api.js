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

  // ─── Dashboard ─────────────────────────────────────────

  async function getDashboard() {
    const { data, error } = await _db().rpc('get_dashboard', { p_email: _email() });
    if (error) throw error;
    return data || [];
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
    const { data, error } = await _db()
      .from('subjects')
      .insert({ user_email: _email(), name, type, timetable, color })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateSubjectTimetable(subjectId, timetable) {
    const { error } = await _db()
      .from('subjects')
      .update({ timetable })
      .eq('id', subjectId)
      .eq('user_email', _email());
    if (error) throw error;
  }

  async function deleteSubject(subjectId) {
    const { error } = await _db()
      .from('subjects')
      .update({ is_active: false })
      .eq('id', subjectId)
      .eq('user_email', _email());
    if (error) throw error;
  }

  async function hasSubjects() {
    const { count, error } = await _db()
      .from('subjects')
      .select('id', { count: 'exact', head: true })
      .eq('user_email', _email())
      .eq('is_active', true);
    if (error) return false;
    return (count || 0) > 0;
  }

  // ─── Attendance Marking ─────────────────────────────────

  async function markAttendance(subjectId, date, status) {
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

  // ─── Google Calendar Sync ───────────────────────────────

  async function syncGoogleCalendar() {
    const config = window.APP_CONFIG;
    const { HOLIDAY_KEYWORDS, CALENDAR_SYNC_INTERVAL_HOURS } = config;

    // Check last sync time (24h throttle)
    const { data: syncState } = await _db()
      .from('calendar_sync')
      .select('last_synced, enabled')
      .eq('user_email', _email())
      .maybeSingle();

    if (syncState?.last_synced) {
      const lastSync = new Date(syncState.last_synced);
      const hoursSince = (Date.now() - lastSync.getTime()) / 3600000;
      if (hoursSince < CALENDAR_SYNC_INTERVAL_HOURS) {
        return { status: 'throttled', message: 'Synced recently. Try again in a few hours.' };
      }
    }

    const googleToken = await AuthModule.getGoogleAccessToken();
    if (!googleToken) {
      throw new Error('Google access token not available. Please sign out and sign in again.');
    }

    // Fetch events for the next 6 months
    const now = new Date();
    const sixMonths = new Date(now);
    sixMonths.setMonth(sixMonths.getMonth() + 6);

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: sixMonths.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const calendarsToSync = ['primary', 'en.indian#holiday@group.v.calendar.google.com'];

    // Try to list user's calendars to find additional holiday/regional calendars
    try {
      const listResponse = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );
      if (listResponse.ok) {
        const listData = await listResponse.json();
        const items = listData.items || [];
        items.forEach(cal => {
          const summary = (cal.summary || '').toLowerCase();
          const id = cal.id;
          if (summary.includes('holiday') || summary.includes('telangana') || summary.includes('indian')) {
            if (!calendarsToSync.includes(id)) {
              calendarsToSync.push(id);
            }
          }
        });
      }
    } catch (e) {
      console.warn('Failed to fetch calendar list, using default calendars:', e);
    }

    const holidayDates = [];

    for (const calId of calendarsToSync) {
      try {
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!response.ok) continue;

        const { items = [] } = await response.json();
        for (const event of items) {
          const title = (event.summary || '').toLowerCase();
          
          // If syncing a public holiday or regional calendar, import all events.
          // For primary calendar, only import events matching holiday keywords.
          const isHolidayCal = calId.includes('holiday') || calId.includes('indian') || calId.includes('telangana');
          const isMatch = isHolidayCal || HOLIDAY_KEYWORDS.some(kw => title.includes(kw.toLowerCase()));

          if (!isMatch) continue;

          const startStr = event.start?.date || event.start?.dateTime?.split('T')[0];
          const endStr   = event.end?.date   || event.end?.dateTime?.split('T')[0];
          if (!startStr) continue;

          // Expand date ranges using local dates
          const start = new Date(startStr + 'T00:00:00');
          let end     = endStr ? new Date(endStr + 'T00:00:00') : new Date(startStr + 'T00:00:00');

          const isAllDay = !!event.start?.date;
          if (isAllDay && endStr && startStr !== endStr) {
            end.setDate(end.getDate() - 1);
          }

          const cur = new Date(start);
          while (cur <= end) {
            holidayDates.push({
              date: UIModule.toLocalDateStr(cur),
              label: event.summary || 'Holiday',
            });
            cur.setDate(cur.getDate() + 1);
          }
        }
      } catch (err) {
        console.warn(`Failed to sync calendar ${calId}:`, err);
      }
    }

    // Bulk insert holidays
    const subjects = await getSubjects();
    const rows = [];
    for (const { date, label } of holidayDates) {
      for (const subject of subjects) {
        rows.push({
          user_email: _email(),
          subject_id: subject.id,
          date,
          status: 'holiday',
          label,
          source: 'google_calendar',
        });
      }
    }

    if (rows.length) {
      const { error } = await _db()
        .from('daily_logs')
        .upsert(rows, { onConflict: 'user_email,subject_id,date' });
      if (error) throw error;
    }

    // Update sync timestamp
    await _db().from('calendar_sync').upsert({
      user_email: _email(),
      enabled: true,
      last_synced: new Date().toISOString(),
    }, { onConflict: 'user_email' });

    return { status: 'success', count: holidayDates.length };
  }

  async function getCalendarSyncState() {
    const { data } = await _db()
      .from('calendar_sync')
      .select('*')
      .eq('user_email', _email())
      .maybeSingle();
    return data;
  }

  async function setCalendarSyncEnabled(enabled) {
    await _db().from('calendar_sync').upsert({
      user_email: _email(),
      enabled,
    }, { onConflict: 'user_email' });
  }

  // ─── Baseline / Portal Sync ─────────────────────────────

  async function setBaseline(subjectId, officialHeld, officialAttended) {
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
    const { data } = await _db()
      .from('slot_timings')
      .select('slots')
      .eq('user_email', _email())
      .maybeSingle();
    return data?.slots || [
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
      { start: '13:00', end: '14:00' },
      { start: '14:00', end: '15:00' },
      { start: '15:00', end: '16:00' },
    ];
  }

  async function saveSlotTimings(slots) {
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
    const { data, error } = await _db()
      .from('users')
      .select('semester_end_date')
      .eq('email', _email())
      .single();
    if (error) return null;
    return data?.semester_end_date || null;
  }

  async function setSemesterEndDate(date) {
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
    updateSubjectTimetable,
    deleteSubject,
    hasSubjects,
    markAttendance,
    getLogsForDate,
    getLogsForMonth,
    markHoliday,
    removeHoliday,
    getHolidays,
    syncGoogleCalendar,
    getCalendarSyncState,
    setCalendarSyncEnabled,
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
  };
})();
