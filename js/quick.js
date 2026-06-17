// ============================================================
// js/quick.js — Quick Mark Page (PWA Shortcut / Home Screen)
// ============================================================

const QuickModule = (() => {
  let _subjects   = [];
  let _slotTimes  = [];
  let _todayLogs  = {};
  let _markingSet = new Set();

  // ─── Bootstrap ─────────────────────────────────────────────

  function load() {
    _loadFromCache();
    _render();
    _refreshFromNetwork();

    // Online → auto-sync then re-render
    window.addEventListener('online', () => {
      _updateBadge();
      ApiModule.syncOfflineQueue().then(() => {
        _loadFromCache();
        _render();
      }).catch(() => {});
    });
    window.addEventListener('offline', _updateBadge);
  }

  function _loadFromCache() {
    const c = ApiModule.getLocalCache();
    if (c) {
      _subjects  = c.subjects   || [];
      _slotTimes = c.slotTimes  || [];
      _todayLogs = c.todayLogs  || {};
    }
  }

  async function _refreshFromNetwork() {
    try {
      const todayStr = UIModule.todayStr();
      const [subjects, slotTimes, logs] = await Promise.all([
        ApiModule.getDashboard(true),
        ApiModule.getSlotTimings(),
        ApiModule.getLogsForDate(todayStr),
      ]);
      _subjects  = subjects;
      _slotTimes = slotTimes;
      _todayLogs = {};
      logs.forEach(l => { _todayLogs[l.subject_id] = l.status; });

      // Update shared cache
      const prev = ApiModule.getLocalCache() || {};
      ApiModule.setLocalCache({ ...prev, subjects: _subjects, slotTimes: _slotTimes, todayLogs: _todayLogs });
      _render();
    } catch (_) {
      // Silently fall back to cache
    }
  }

  // ─── Today's class computation ──────────────────────────────
  // Mirrors DashboardModule._getTodayClasses() exactly

  function _getTodayClasses() {
    const todayName = UIModule.todayDayName();
    const results = [];
    _subjects.forEach((s, idx) => {
      const timetable = s.timetable || {};
      const slots     = timetable[todayName] || [];
      slots.forEach(slotIdx => {
        const slotTime = _slotTimes[slotIdx];
        results.push({
          subject_id:   s.subject_id,
          subject_name: s.subject_name,
          subject_type: s.subject_type || 'theory',
          colorIdx:     idx,
          color:        UIModule.getSubjectColor(idx),
          slotIndex:    slotIdx,
          startTimeStr: slotTime ? slotTime.start : '00:00',
          endTimeStr:   slotTime ? slotTime.end   : '23:59',
          timeLabel:    slotTime
            ? `${_fmt12(slotTime.start)} – ${_fmt12(slotTime.end)}`
            : `Slot ${slotIdx + 1}`,
        });
      });
    });
    results.sort((a, b) => a.slotIndex - b.slotIndex);
    return results;
  }

  function _fmt12(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  function _isActive(start, end) {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return cur >= sh * 60 + sm && cur < eh * 60 + em;
  }

  // ─── Render ─────────────────────────────────────────────────

  function _render() {
    const container = document.getElementById('quick-classes-list');
    const emptyEl   = document.getElementById('quick-empty-state');
    const dateEl    = document.getElementById('quick-date-label');
    const dayEl     = document.getElementById('quick-day-label');
    if (!container) return;

    const now = new Date();
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    if (dayEl)  dayEl.textContent  = UIModule.todayDayName();
    _updateBadge();

    const classes = _getTodayClasses();

    if (classes.length === 0) {
      container.innerHTML = '';
      emptyEl?.classList.remove('hidden');
      return;
    }
    emptyEl?.classList.add('hidden');

    container.innerHTML = classes.map(cls => {
      const status  = _todayLogs[cls.subject_id];
      const active  = _isActive(cls.startTimeStr, cls.endTimeStr);
      const marking = _markingSet.has(cls.subject_id);
      const color   = cls.color;

      let actionHtml;
      if (marking) {
        actionHtml = `
          <div class="qw-action-row">
            <div class="qw-chip qw-chip-loading">
              <span class="material-symbols-outlined qw-spin">progress_activity</span>
              Marking...
            </div>
          </div>`;
      } else if (status === 'present') {
        actionHtml = `
          <div class="qw-action-row qw-action-marked">
            <div class="qw-chip qw-chip-present">
              <span class="material-symbols-outlined">check_circle</span> PRESENT
            </div>
            <button class="qw-change-btn" onclick="QuickModule.mark('${cls.subject_id}',null)">Change</button>
          </div>`;
      } else if (status === 'absent') {
        actionHtml = `
          <div class="qw-action-row qw-action-marked">
            <div class="qw-chip qw-chip-absent">
              <span class="material-symbols-outlined">cancel</span> ABSENT
            </div>
            <button class="qw-change-btn" onclick="QuickModule.mark('${cls.subject_id}',null)">Change</button>
          </div>`;
      } else {
        actionHtml = `
          <div class="qw-action-row qw-action-btns">
            <button class="qw-present-btn" onclick="QuickModule.mark('${cls.subject_id}','present')">
              <span class="material-symbols-outlined">check</span> PRESENT
            </button>
            <button class="qw-absent-btn" onclick="QuickModule.mark('${cls.subject_id}','absent')">
              <span class="material-symbols-outlined">close</span> ABSENT
            </button>
          </div>`;
      }

      return `
        <div class="qw-card ${active ? 'qw-card-active' : ''} ${status ? `qw-card-${status}` : ''}"
             style="--qc:${color}">
          <div class="qw-color-bar" style="background:${color}"></div>
          <div class="qw-card-inner">
            <div class="qw-card-top">
              ${active ? '<div class="qw-live"><span class="qw-live-dot"></span>LIVE</div>' : ''}
              <span class="qw-time">${cls.timeLabel}</span>
              <span class="qw-type">${cls.subject_type === 'lab' ? 'Lab · 3x' : 'Theory'}</span>
            </div>
            <h3 class="qw-name">${cls.subject_name}</h3>
            ${actionHtml}
          </div>
        </div>`;
    }).join('');
  }

  function _updateBadge() {
    const badge = document.getElementById('quick-sync-badge');
    if (!badge) return;
    const queue  = (typeof ApiModule !== 'undefined' && ApiModule.getOfflineQueue) ? ApiModule.getOfflineQueue() : [];
    const online = navigator.onLine;
    if (!online) {
      badge.className = 'qw-badge qw-badge-offline';
      badge.innerHTML = '<span class="qw-dot"></span>OFFLINE';
    } else if (queue.length > 0) {
      badge.className = 'qw-badge qw-badge-sync';
      badge.innerHTML = `<span class="material-symbols-outlined qw-spin" style="font-size:10px">sync</span>${queue.length} SYNCING`;
    } else {
      badge.className = 'qw-badge qw-badge-online';
      badge.innerHTML = '<span class="qw-dot"></span>SYNCED';
    }
  }

  // ─── Mark Attendance ────────────────────────────────────────

  async function mark(subjectId, status) {
    if (_markingSet.has(subjectId)) return;
    _markingSet.add(subjectId);

    const prev = _todayLogs[subjectId];
    // Optimistic update
    if (status === null || status === undefined) delete _todayLogs[subjectId];
    else _todayLogs[subjectId] = status;
    _render();

    try {
      await ApiModule.markAttendance(subjectId, UIModule.todayStr(), status);
      if (status) {
        UIModule.toast(
          status === 'present' ? '✓ Present marked!' : '✗ Absent marked',
          status === 'present' ? 'success' : 'info'
        );
      }
      // Persist merged todayLogs back to cache
      const c = ApiModule.getLocalCache() || {};
      ApiModule.setLocalCache({ ...c, todayLogs: _todayLogs });
      if ('vibrate' in navigator) navigator.vibrate(50);
    } catch (err) {
      // Rollback
      if (prev === undefined) delete _todayLogs[subjectId];
      else _todayLogs[subjectId] = prev;
      UIModule.toast('Failed: ' + err.message, 'error');
    } finally {
      _markingSet.delete(subjectId);
      _render();
      _updateBadge();
    }
  }

  return { load, mark };
})();
