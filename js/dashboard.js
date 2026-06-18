// ============================================================
// js/dashboard.js — Dashboard logic
// ============================================================

const DashboardModule = (() => {
  let _subjects = [];
  let _slotTimes = [];
  let _todayLogs = {};
  let _whatIfBound = false;
  let _semesterEndDate = null;
  let _futureHolidays = [];
  let _isEditingEndDate = false;
  let _widgetSelectedIndex = undefined;

  async function load() {
    // 1. Try to load from cache and render immediately
    const cached = ApiModule.getLocalCache();
    if (cached) {
      _subjects = cached.subjects || [];
      _slotTimes = cached.slotTimes || [];
      _semesterEndDate = cached.semesterEndDate || null;
      _futureHolidays = cached.futureHolidays || [];
      _todayLogs = cached.todayLogs || {};
      _renderPrompts();
      _renderQuickWidget();
      _renderGauges();
      _renderSafeToMiss();
      _renderDailySchedule();
      _renderTrend();
      UIModule.showLoader(false); // Hide loader immediately!
    } else {
      UIModule.showLoader(true); // No cache, show loader
    }

    try {
      const todayStr = UIModule.todayStr();
      // Fetch everything in parallel to reduce sequential network queries
      const [subjects, slotTimes, endDate, todayLogs] = await Promise.all([
        ApiModule.getDashboard(true), // forceRefresh
        ApiModule.getSlotTimings(),
        ApiModule.getSemesterEndDate(),
        ApiModule.getLogsForDate(todayStr),
      ]);
      _subjects = subjects;
      _slotTimes = slotTimes;
      _semesterEndDate = endDate;
      _todayLogs = {};
      todayLogs.forEach(l => { _todayLogs[l.subject_id] = l.status; });
      _futureHolidays = [];

      if (_semesterEndDate) {
        _futureHolidays = await ApiModule.getFutureHolidays(todayStr, _semesterEndDate);
      }

      // Save to local cache
      ApiModule.setLocalCache({
        subjects: _subjects,
        slotTimes: _slotTimes,
        semesterEndDate: _semesterEndDate,
        futureHolidays: _futureHolidays,
        todayLogs: _todayLogs
      });

      _renderPrompts();
      _renderQuickWidget();
      _renderGauges();
      _renderSafeToMiss();
      _renderDailySchedule();
      _renderTrend();
    } catch (err) {
      const isNetwork = !navigator.onLine || 
        (err.message && (
          err.message.toLowerCase().includes('fetch') || 
          err.message.toLowerCase().includes('network') || 
          err.message.toLowerCase().includes('typeerror') || 
          err.message.toLowerCase().includes('load failed')
        )) || 
        err.name === 'TypeError';

      if (isNetwork) {
        UIModule.toast('You are offline. Showing cached data.', 'info');
      } else {
        UIModule.toast('Failed to load dashboard: ' + err.message, 'error');
        ApiModule.logError(err.message, err.stack);
      }
    } finally {
      UIModule.showLoader(false);
    }
  }

  function _getRemainingPeriods(subject) {
    if (!_semesterEndDate) return 0;
    const today = new Date();
    const todayMidnight = new Date(today);
    todayMidnight.setHours(0, 0, 0, 0);
    const endDate = UIModule.parseLocalDate(_semesterEndDate);

    if (endDate < todayMidnight) return 0;

    const holidaySet = new Set(_futureHolidays.map(h => h.date));
    let remainingPeriods = 0;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayStr = UIModule.toLocalDateStr(today);

    // 1. Calculate remaining slots for TODAY (if today <= endDate and today is not a holiday)
    if (todayMidnight <= endDate && !holidaySet.has(todayStr)) {
      const dayName = dayNames[today.getDay()];
      const timetable = subject.timetable || {};
      const slots = timetable[dayName] || [];

      const currentMinutes = today.getHours() * 60 + today.getMinutes();
      const defaultSlotTimes = [
        { start: '09:00', end: '10:00' },
        { start: '10:00', end: '11:00' },
        { start: '11:00', end: '12:00' },
        { start: '13:00', end: '14:00' },
        { start: '14:00', end: '15:00' },
        { start: '15:00', end: '16:00' },
      ];

      function timeToMinutes(timeStr) {
        const [h, m] = (timeStr || '00:00').split(':').map(Number);
        return h * 60 + m;
      }

      slots.forEach(slotIdx => {
        const slotTiming = _slotTimes[slotIdx] || defaultSlotTimes[slotIdx];
        let endTimeStr = '23:59';
        if (slotTiming && slotTiming.end) {
          endTimeStr = slotTiming.end;
        } else {
          const startHour = 9 + slotIdx;
          endTimeStr = `${String(startHour + 1).padStart(2, '0')}:00`;
        }
        const slotEndMinutes = timeToMinutes(endTimeStr);
        if (currentMinutes < slotEndMinutes) {
          remainingPeriods++;
        }
      });
    }

    // 2. Calculate remaining slots from tomorrow onwards
    const current = new Date(todayMidnight);
    current.setDate(current.getDate() + 1); // Start counting from tomorrow

    const timetable = subject.timetable || {};

    while (current <= endDate) {
      const dateStr = UIModule.toLocalDateStr(current);
      if (!holidaySet.has(dateStr)) {
        const dayName = dayNames[current.getDay()];
        const slots = timetable[dayName] || [];
        remainingPeriods += slots.length;
      }
      current.setDate(current.getDate() + 1);
    }

    return remainingPeriods;
  }

  // ─── Gauges ───────────────────────────────────────────────

  function _renderGauges() {
    const gaugeSection = document.getElementById('dash-gauges');
    if (!gaugeSection) return;

    if (!_subjects.length) {
      gaugeSection.innerHTML = `
        <div class="glass-card rounded-2xl p-8 text-center col-span-2">
          <span class="material-symbols-outlined text-[48px] text-primary/30 mb-4 block">analytics</span>
          <p class="font-body-lg text-on-surface-variant">No subjects yet. Complete setup to see your stats.</p>
        </div>`;
      return;
    }

    // Aggregate across all subjects
    let totalHeld = 0, totalAttended = 0;
    let portalHeld = 0, portalAttended = 0;
    _subjects.forEach(s => {
      const stats = ApiModule.calculateStats(s);
      totalHeld     += stats.totalHeld;
      totalAttended += stats.totalAttended;
      portalHeld    += parseInt(s.official_held || 0);
      portalAttended += parseInt(s.official_attended || 0);
    });

    const realPct   = totalHeld > 0 ? (totalAttended / totalHeld) * 100 : 0;
    const portalPct = portalHeld > 0 ? (portalAttended / portalHeld) * 100 : 0;

    const realBadge   = UIModule.getAttendanceBadge(realPct);
    const portalBadge = UIModule.getAttendanceBadge(portalPct);

    gaugeSection.innerHTML = `
      ${_gaugeHtml('real-gauge', 'REAL-TIME', realPct, realBadge, totalAttended, totalHeld)}
    `;

    // Animate rings
    setTimeout(() => {
      UIModule.updateRing('real-gauge-svg', realPct, realBadge.color);
    }, 100);
  }

  function _gaugeHtml(id, label, pct, badge, attended, held) {
    const r = 44, c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);
    return `
      <div class="glass-card rounded-2xl p-8 flex flex-col items-center space-y-4 sm:flex-row sm:space-y-0 sm:gap-10 sm:justify-center"
        style="background: radial-gradient(circle at 50% 0%, ${badge.bg} 0%, rgba(255,255,255,0.02) 70%)">
        <div class="relative w-56 h-56 flex items-center justify-center">
          <div class="absolute inset-0 rounded-full blur-2xl" style="background:${badge.bg}"></div>
          <svg id="${id}-svg" class="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${r}" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="6"/>
            <circle class="ring-fill progress-ring-circle" cx="50" cy="50" r="${r}" fill="transparent"
              stroke="${badge.color}" stroke-width="6" stroke-linecap="round"
              stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="font-display-stat text-display-stat font-extrabold" style="color:${badge.color}">${pct.toFixed(1)}%</span>
            <span class="font-label-caps text-label-caps text-on-surface-variant tracking-[0.2em]">${label}</span>
          </div>
        </div>
        <div class="flex flex-col items-center sm:items-start gap-3">
          <div class="flex items-center gap-2 px-4 py-1.5 rounded-full backdrop-blur-md border"
            style="background:${badge.bg}; border-color:${badge.border}">
            <span class="material-symbols-outlined text-sm" style="color:${badge.color}">${badge.label === 'SAFE' ? 'check_circle' : badge.label === 'ON TRACK' ? 'info' : 'warning'}</span>
            <span class="font-label-caps text-label-caps font-bold" style="color:${badge.color}">${badge.label}</span>
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">${attended} attended / ${held} held</p>
        </div>
      </div>
    `;
  }


  // ─── Safe-to-Miss ─────────────────────────────────────────

  function _renderSafeToMiss() {
    const section = document.getElementById('dash-safe-to-miss');
    if (!section || !_subjects.length) return;

    let totalHeld = 0, totalAttended = 0, totalRemaining = 0;
    _subjects.forEach(s => {
      const stats = ApiModule.calculateStats(s);
      totalHeld     += stats.totalHeld;
      totalAttended += stats.totalAttended;
      totalRemaining += _getRemainingPeriods(s);
    });

    const percentageToday = totalHeld > 0 ? (totalAttended / totalHeld) * 100 : 0;
    const isDeficit = percentageToday < 75;

    // Default fallback color/icon
    let color = isDeficit ? '#ff5545' : '#4ade80';
    let icon = isDeficit ? 'warning' : 'check_circle';

    if (!_semesterEndDate || _isEditingEndDate) {
      // Semester End Date is missing or editing
      section.innerHTML = `
        <div class="glass-card rounded-2xl p-8 relative overflow-hidden"
          style="background: radial-gradient(circle at 50% 100%, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.02) 70%)">
          <div class="relative z-10 flex flex-col items-center text-center space-y-3 w-full">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-sm text-secondary">calendar_today</span>
              <span class="font-label-caps text-label-caps tracking-[0.2em] text-secondary">SEMESTER END DATE</span>
            </div>
            <p class="font-body-sm text-body-sm text-on-surface-variant max-w-xs mt-1">
              Select when your semester ends to calculate remaining classes and safe skips.
            </p>
            <div class="w-full max-w-xs flex flex-col gap-3 pt-2">
              <input type="date" id="dash-semester-end-input" value="${_semesterEndDate || ''}"
                class="w-full bg-surface-container-highest border border-outline-variant/30 rounded-xl text-on-surface px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none font-body-lg text-center" />
              <div class="flex gap-2">
                ${_semesterEndDate ? `
                  <button onclick="DashboardModule.cancelSemesterEdit()" class="flex-1 py-2.5 bg-surface-container-high hover:bg-white/10 text-on-surface font-label-caps text-xs rounded-xl font-bold uppercase transition-all active:scale-95">
                    Cancel
                  </button>
                ` : ''}
                <button onclick="DashboardModule.saveSemesterEndDateInline()" class="flex-1 py-2.5 bg-primary text-on-primary font-label-caps text-xs rounded-xl font-bold uppercase transition-all active:scale-95 shadow-md hover:bg-primary-container">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Semester End Calculations
    const totalSem = totalHeld + totalRemaining;
    const reqTotalAttended = Math.ceil(0.75 * totalSem);
    const maxPossibleAttended = totalAttended + totalRemaining;
    const isImpossible = maxPossibleAttended < reqTotalAttended;
    
    let minFutureAttend = 0;
    let maxSkipsInSemester = 0;
    let mainText = '';
    let subText = '';

    if (isImpossible) {
      color = '#ff5545';
      icon = 'dangerous';
      mainText = 'Critical Deficit';
      const maxPct = totalSem > 0 ? (maxPossibleAttended / totalSem) * 100 : 0;
      subText = `Even if you attend all ${totalRemaining} remaining periods, your max attendance will only reach ${maxPct.toFixed(1)}% (below 75%).`;
    } else {
      minFutureAttend = Math.max(0, reqTotalAttended - totalAttended);
      maxSkipsInSemester = Math.max(0, totalRemaining - minFutureAttend);
      
      if (minFutureAttend > 0) {
        color = '#fabd00';
        icon = 'warning';
        mainText = `Attend <span style="color:${color}">${minFutureAttend}</span> more`;
        subText = `To finish the semester with at least 75% attendance, you must attend at least ${minFutureAttend} out of the ${totalRemaining} remaining periods.`;
      } else {
        color = '#4ade80';
        icon = 'check_circle';
        mainText = `Skip <span style="color:${color}">${maxSkipsInSemester}</span> now`;
        subText = `You can skip up to ${maxSkipsInSemester} periods (labs count as 3 slots) in the remainder of the semester and still finish above 75%.`;
      }
    }

    section.innerHTML = `
      <div class="glass-card rounded-2xl p-8 relative overflow-hidden"
        style="background: radial-gradient(circle at 50% 100%, ${color}10 0%, rgba(255,255,255,0.02) 70%)">
        <div class="relative z-10 flex flex-col items-center text-center space-y-3">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-sm" style="color:${color}">${icon}</span>
            <span class="font-label-caps text-label-caps tracking-[0.2em]" style="color:${color}">SAFE-TO-MISS</span>
          </div>
          <h2 class="font-display-stat text-display-stat text-on-surface">
            ${mainText}
          </h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant max-w-xs">
            ${subText}
          </p>
          <div class="pt-3 flex items-center justify-center gap-2">
            <span class="font-body-sm text-outline text-xs">Ends: ${UIModule.formatDate(_semesterEndDate)}</span>
            <button onclick="DashboardModule.enableSemesterEdit()" class="px-2 py-1 text-primary hover:text-primary-container text-xs font-label-caps font-bold transition-all uppercase border border-primary/20 rounded-lg bg-primary/5 hover:bg-primary/10">Edit</button>
          </div>
        </div>
        <div class="absolute inset-0 pointer-events-none">
          <div class="absolute bottom-0 left-0 right-0 h-32 blur-[60px] opacity-20 rounded-full"
            style="background: ${color}"></div>
        </div>
      </div>
    `;
  }

  function enableSemesterEdit() {
    _isEditingEndDate = true;
    _renderSafeToMiss();
  }

  function cancelSemesterEdit() {
    _isEditingEndDate = false;
    _renderSafeToMiss();
  }

  function saveSemesterEndDateInline() {
    const input = document.getElementById('dash-semester-end-input');
    if (!input) return;
    const newDate = input.value;
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      UIModule.toast("Please select a valid date.", "warning");
      return;
    }

    UIModule.showLoader(true);
    ApiModule.setSemesterEndDate(newDate)
      .then(() => {
        _semesterEndDate = newDate;
        _isEditingEndDate = false;
        UIModule.toast("Semester End Date updated!", "success");
        return load();
      })
      .catch(err => {
        UIModule.toast("Failed to update: " + err.message, "error");
      })
      .finally(() => {
        UIModule.showLoader(false);
      });
  }


  // ─── What-If Predictor ────────────────────────────────────

  function initWhatIf() {
    if (_whatIfBound) return;
    _whatIfBound = true;

    const calcBtn  = document.getElementById('whatif-calc-btn');
    const result   = document.getElementById('whatif-result');
    const missInput = document.getElementById('whatif-miss-count');

    // Dropdown logic
    const trigger  = document.getElementById('whatif-type-trigger');
    const menu     = document.getElementById('whatif-type-menu');
    const selected = document.getElementById('whatif-type-selected');
    const icon     = document.getElementById('whatif-type-icon');

    if (trigger && menu) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
        icon.style.transform = menu.classList.contains('hidden') ? '' : 'rotate(180deg)';
      });
      menu.querySelectorAll('[data-wt]').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selected.textContent = item.textContent.trim();
          trigger.dataset.weight = item.dataset.wt;
          menu.querySelectorAll('[data-wt]').forEach(i => {
            i.classList.toggle('bg-primary', i === item);
            i.classList.toggle('text-on-primary', i === item);
          });
          menu.classList.add('hidden');
          icon.style.transform = '';
        });
      });
      document.addEventListener('click', () => menu.classList.add('hidden'));
    }

    calcBtn?.addEventListener('click', () => {
      const missCount = parseInt(missInput?.value) || 0;
      const weight    = parseInt(trigger?.dataset.weight || '1');

      if (!_subjects.length) { UIModule.toast('No subjects found.', 'warning'); return; }

      let totalHeld = 0, totalAttended = 0;
      _subjects.forEach(s => {
        const stats = ApiModule.calculateStats(s);
        totalHeld     += stats.totalHeld;
        totalAttended += stats.totalAttended;
      });

      const current  = totalHeld > 0 ? (totalAttended / totalHeld) * 100 : 0;
      const { newPct, delta } = ApiModule.predictWhatIf({ totalHeld, totalAttended }, missCount, weight);
      const badgeColor = UIModule.getAttendanceColor(newPct);

      if (result) {
        result.innerHTML = `
          <div class="glass-card rounded-xl p-5 mt-4 text-center space-y-2" style="border-color: ${badgeColor}40">
            <p class="font-label-caps text-label-caps text-on-surface-variant">PROJECTED ATTENDANCE</p>
            <p class="font-display-stat text-4xl font-extrabold" style="color:${badgeColor}">${Math.max(0, newPct).toFixed(1)}%</p>
            <p class="font-body-sm text-on-surface-variant">
              ${delta < 0 ? `↓ ${Math.abs(delta).toFixed(1)}% drop` : `→ No change`}
              from current ${current.toFixed(1)}%
            </p>
            ${newPct < 75 ? `<p class="font-label-caps text-error text-[11px] pt-1">⚠ Below 75% threshold!</p>` : ''}
          </div>`;
      }
    });
  }

  // ─── Daily Schedule ───────────────────────────────────────

  function _renderDailySchedule() {
    const section = document.getElementById('dash-schedule');
    if (!section) return;

    const today = UIModule.todayDayName();

    // Get subjects scheduled for today
    const todaySubjects = [];
    _subjects.forEach((s, idx) => {
      const timetable = s.timetable || {};
      const slots     = timetable[today] || [];
      if (slots.length > 0) {
        slots.forEach(slotIdx => {
          const slotTime = _slotTimes[slotIdx];
          todaySubjects.push({
            ...s,
            slotIndex: slotIdx,
            timeLabel: slotTime ? `${slotTime.start} – ${slotTime.end}` : `Slot ${slotIdx + 1}`,
            colorIdx: idx,
          });
        });
      }
    });

    // Sort by slot index
    todaySubjects.sort((a, b) => a.slotIndex - b.slotIndex);

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    function slotMinutes(timeStr) {
      const [h, m] = (timeStr || '00:00').split(':').map(Number);
      return h * 60 + m;
    }

    if (!todaySubjects.length) {
      section.innerHTML = `
        <div class="glass-card rounded-xl p-8 text-center">
          <span class="material-symbols-outlined text-[36px] text-primary/30 block mb-3">event_available</span>
          <p class="font-body-sm text-on-surface-variant">No classes scheduled for today (${today}).</p>
        </div>`;
      return;
    }

    section.innerHTML = todaySubjects.map(s => {
      const slotTime  = _slotTimes[s.slotIndex] || {};
      const startMins = slotMinutes(slotTime.start);
      const endMins   = slotMinutes(slotTime.end);
      const isNow     = currentMinutes >= startMins && currentMinutes < endMins;
      const isPast    = currentMinutes >= endMins;
      const logStatus = _todayLogs[s.subject_id];
      const color     = s.color || UIModule.getSubjectColor(s.colorIdx);

      let statusHtml = '';
      if (logStatus === 'present') {
        statusHtml = `<span class="px-3 py-1 rounded-full bg-green-500/20 text-green-400 font-label-caps text-[10px]">PRESENT</span>`;
      } else if (logStatus === 'absent') {
        statusHtml = `<span class="px-3 py-1 rounded-full bg-red-500/20 text-red-400 font-label-caps text-[10px]">ABSENT</span>`;
      } else if (isPast) {
        statusHtml = `
          <button onclick="DashboardModule.markToday('${s.subject_id}', 'present')" class="p-2.5 rounded-full bg-white/5 text-green-400 hover:bg-green-500/20 active:scale-90 transition-all border border-white/5">
            <span class="material-symbols-outlined text-[18px]">check</span>
          </button>
          <button onclick="DashboardModule.markToday('${s.subject_id}', 'absent')" class="p-2.5 rounded-full bg-white/5 text-red-400 hover:bg-red-500/20 active:scale-90 transition-all border border-white/5">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>`;
      } else if (isNow) {
        statusHtml = `<span class="font-label-caps text-[10px] text-primary animate-pulse">● IN PROGRESS</span>`;
      } else {
        statusHtml = `<span class="font-label-caps text-label-caps text-on-surface-variant italic">Upcoming</span>`;
      }

      return `
        <div class="glass-card rounded-xl p-5 flex items-center justify-between group ${isNow ? 'border-primary/30' : ''}"
          ${isNow ? `style="background: rgba(173,198,255,0.05)"` : ''}>
          <div class="flex gap-4 items-center">
            <div class="w-1.5 h-12 rounded-full shrink-0" style="background:${color}"></div>
            <div>
              <p class="font-headline-md text-headline-md leading-tight">${s.subject_name}</p>
              <p class="font-body-sm text-body-sm text-on-surface-variant">${s.timeLabel} · ${s.subject_type === 'lab' ? 'Lab' : 'Theory'}</p>
            </div>
          </div>
          <div class="flex gap-2 items-center">${statusHtml}</div>
        </div>
      `;
    }).join('');
  }

  function updateSubjectStatsLocally(subjectId, newStatus) {
    const subj = _subjects.find(s => s.subject_id === subjectId || s.id === subjectId);
    if (!subj) return;

    const oldStatus = _todayLogs[subjectId];
    if (oldStatus === newStatus) return;

    const weight = parseInt(subj.weight || 1);
    
    let rtHeld = parseInt(subj.realtime_held || 0);
    let rtAttended = parseInt(subj.realtime_attended || 0);

    // Remove old status impact
    if (oldStatus === 'present') {
      rtHeld -= weight;
      rtAttended -= weight;
    } else if (oldStatus === 'absent') {
      rtHeld -= weight;
    }

    // Add new status impact
    if (newStatus === 'present') {
      rtHeld += weight;
      rtAttended += weight;
    } else if (newStatus === 'absent') {
      rtHeld += weight;
    }

    subj.realtime_held = Math.max(0, rtHeld);
    subj.realtime_attended = Math.max(0, rtAttended);
    
    // Recalculate stats using ApiModule's helper
    const stats = ApiModule.calculateStats(subj);
    subj.percentage = stats.percentage;
    subj.safe_to_miss = stats.safeToMiss;
  }

  async function markToday(subjectId, status) {
    const oldStatus = _todayLogs[subjectId];
    // 1. Update stats and UI locally first
    updateSubjectStatsLocally(subjectId, status);
    if (status === null || status === undefined) {
      delete _todayLogs[subjectId];
    } else {
      _todayLogs[subjectId] = status;
    }

    _renderDailySchedule();
    _renderQuickWidget();
    _renderGauges();
    _renderSafeToMiss();
    _renderTrend();

    try {
      let res;
      if (status === null || status === undefined) {
        res = await ApiModule.clearAttendance(subjectId, UIModule.todayStr());
      } else {
        res = await ApiModule.markAttendance(subjectId, UIModule.todayStr(), status);
      }

      if (res && res.offline) {
        UIModule.toast('Saved offline (will sync when online).', 'info');
      } else {
        if (status === null || status === undefined) {
          UIModule.toast('Attendance cleared.', 'info');
        } else {
          UIModule.toast(`Marked as ${status}.`, status === 'present' ? 'success' : 'info');
        }
      }
      if ('vibrate' in navigator) navigator.vibrate(50);
    } catch (err) {
      // Rollback on failure
      updateSubjectStatsLocally(subjectId, oldStatus);
      if (oldStatus === null || oldStatus === undefined) {
        delete _todayLogs[subjectId];
      } else {
        _todayLogs[subjectId] = oldStatus;
      }
      _renderDailySchedule();
      _renderQuickWidget();
      _renderGauges();
      _renderSafeToMiss();
      _renderTrend();
      UIModule.toast('Failed to mark attendance.', 'error');
      ApiModule.logError(err.message, err.stack);
    }
  }

  function _getTodayClasses() {
    const today = UIModule.todayDayName();
    const todayClasses = [];
    _subjects.forEach((s, idx) => {
      const timetable = s.timetable || {};
      const slots     = timetable[today] || [];
      slots.forEach(slotIdx => {
        const slotTime = _slotTimes[slotIdx];
        todayClasses.push({
          ...s,
          slotIndex: slotIdx,
          timeLabel: slotTime ? `${slotTime.start} – ${slotTime.end}` : `Slot ${slotIdx + 1}`,
          colorIdx: idx,
          startTimeStr: slotTime ? slotTime.start : '00:00',
          endTimeStr: slotTime ? slotTime.end : '23:59',
        });
      });
    });
    todayClasses.sort((a, b) => a.slotIndex - b.slotIndex);
    return todayClasses;
  }

  function _renderQuickWidget() {
    const widgetSection = document.getElementById('dashboard-widget');
    if (!widgetSection) return;

    const todayClasses = _getTodayClasses();

    // If no classes today, show an offline-friendly empty card
    if (todayClasses.length === 0) {
      widgetSection.innerHTML = `
        <div class="glass-card rounded-2xl p-6 border border-white/5 text-center bg-surface-container/20">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-lg">widgets</span>
              <span class="font-label-caps text-label-caps tracking-widest text-primary">Attendance Widget</span>
            </div>
            ${_getWidgetOfflineBadge()}
          </div>
          <span class="material-symbols-outlined text-[36px] text-primary/30 block mb-2">calendar_today</span>
          <p class="font-body-sm text-on-surface-variant">No classes scheduled for today.</p>
        </div>
      `;
      return;
    }

    // Auto-select active or next unmarked class if _widgetSelectedIndex is not set or out of bounds
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    function toMinutes(timeStr) {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    }

    // Determine default class to show (active or first unmarked)
    let defaultIndex = 0;
    let foundActive = false;
    for (let i = 0; i < todayClasses.length; i++) {
      const c = todayClasses[i];
      const start = toMinutes(c.startTimeStr);
      const end = toMinutes(c.endTimeStr);
      // Active class
      if (currentMinutes >= start && currentMinutes < end) {
        defaultIndex = i;
        foundActive = true;
        break;
      }
    }

    if (!foundActive) {
      // Find first unmarked class
      for (let i = 0; i < todayClasses.length; i++) {
        if (!_todayLogs[todayClasses[i].subject_id]) {
          defaultIndex = i;
          break;
        }
      }
    }

    // If _widgetSelectedIndex is out of bounds or initialized to undefined, use defaultIndex
    if (_widgetSelectedIndex === undefined || _widgetSelectedIndex < 0 || _widgetSelectedIndex >= todayClasses.length) {
      _widgetSelectedIndex = defaultIndex;
    }

    const activeClass = todayClasses[_widgetSelectedIndex];
    const logStatus = _todayLogs[activeClass.subject_id];
    const color = activeClass.color || UIModule.getSubjectColor(activeClass.colorIdx);

    // Build cycle indicator: e.g. "1 of 3"
    const cycleHtml = todayClasses.length > 1 ? `
      <div class="flex items-center gap-2 bg-white/5 border border-white/5 px-2.5 py-1 rounded-xl">
        <button onclick="DashboardModule.widgetPrev()" class="p-1 hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none" ${_widgetSelectedIndex === 0 ? 'disabled' : ''}>
          <span class="material-symbols-outlined text-base leading-none">chevron_left</span>
        </button>
        <span class="font-label-caps text-[10px] text-on-surface-variant min-w-[32px] text-center">${_widgetSelectedIndex + 1} of ${todayClasses.length}</span>
        <button onclick="DashboardModule.widgetNext()" class="p-1 hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none" ${_widgetSelectedIndex === todayClasses.length - 1 ? 'disabled' : ''}>
          <span class="material-symbols-outlined text-base leading-none">chevron_right</span>
        </button>
      </div>
    ` : '';

    // Action buttons or current marked status
    let actionHtml = '';
    if (logStatus === 'present') {
      actionHtml = `
        <div class="flex flex-col gap-2 w-full">
          <div class="py-3 px-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-400 font-bold flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-[20px]">check_circle</span>
            MARKED PRESENT
          </div>
          <button onclick="DashboardModule.widgetMark(null)" class="text-center font-label-caps text-[10px] text-on-surface-variant hover:text-on-surface py-1 transition-colors uppercase">Change Status</button>
        </div>
      `;
    } else if (logStatus === 'absent') {
      actionHtml = `
        <div class="flex flex-col gap-2 w-full">
          <div class="py-3 px-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-[20px]">cancel</span>
            MARKED ABSENT
          </div>
          <button onclick="DashboardModule.widgetMark(null)" class="text-center font-label-caps text-[10px] text-on-surface-variant hover:text-on-surface py-1 transition-colors uppercase">Change Status</button>
        </div>
      `;
    } else {
      actionHtml = `
        <div class="grid grid-cols-2 gap-3 w-full">
          <button onclick="DashboardModule.widgetMark('present')" class="min-h-14 px-4 bg-green-500 text-black font-bold font-label-caps text-[12px] rounded-xl active:scale-95 transition-transform flex items-center justify-center gap-1.5 shadow-md shadow-green-500/10">
            <span class="material-symbols-outlined text-[18px]">check</span> PRESENT
          </button>
          <button onclick="DashboardModule.widgetMark('absent')" class="min-h-14 px-4 bg-red-500 text-white font-bold font-label-caps text-[12px] rounded-xl active:scale-95 transition-transform flex items-center justify-center gap-1.5 shadow-md shadow-red-500/10">
            <span class="material-symbols-outlined text-[18px]">close</span> ABSENT
          </button>
        </div>
      `;
    }

    widgetSection.innerHTML = `
      <div class="glass-card rounded-2xl p-4 border border-primary/10 relative overflow-hidden bg-surface-container/20">
        <!-- Glowing atmospheric background effect -->
        <div class="absolute -right-16 -top-16 w-36 h-36 rounded-full blur-[80px]" style="background: ${color}15"></div>

        <!-- Row 1: Title + Connectivity badge (never overflow) -->
        <div class="flex justify-between items-center mb-2 relative z-10">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="material-symbols-outlined text-primary text-[18px] shrink-0">widgets</span>
            <span class="font-label-caps text-[10px] tracking-widest text-primary truncate">Attendance Widget</span>
          </div>
          ${_getWidgetOfflineBadge()}
        </div>

        <!-- Row 2: Cycle controls (only if multiple classes) -->
        ${todayClasses.length > 1 ? `
        <div class="flex items-center justify-end mb-3 relative z-10">
          ${cycleHtml}
        </div>
        ` : '<div class="mb-3"></div>'}

        <!-- Subject info -->
        <div class="flex gap-3 items-center mb-4 relative z-10">
          <div class="w-1 h-10 rounded-full shrink-0" style="background:${color}"></div>
          <div class="min-w-0 flex-1">
            <h4 class="font-bold text-[17px] leading-tight text-on-surface truncate">${activeClass.subject_name}</h4>
            <p class="text-[12px] text-on-surface-variant mt-0.5 truncate">${activeClass.timeLabel} · ${activeClass.subject_type === 'lab' ? 'Lab · 3×' : 'Theory'}</p>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="relative z-10">
          ${actionHtml}
        </div>
      </div>
    `;
  }

  function _getWidgetOfflineBadge() {
    const queue = ApiModule.getOfflineQueue();
    const isOnline = navigator.onLine;

    if (!isOnline) {
      return `
        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 font-label-caps text-[9px] font-bold animate-pulse">
          <span class="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
          OFFLINE MODE
        </div>
      `;
    } else if (queue.length > 0) {
      return `
        <button onclick="ApiModule.syncOfflineQueue()" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-label-caps text-[9px] font-bold animate-pulse">
          <span class="material-symbols-outlined text-[10px] animate-spin">sync</span>
          ${queue.length} PENDING SYNC
        </button>
      `;
    } else {
      return `
        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 font-label-caps text-[9px] font-bold">
          <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
          CONNECTED
        </div>
      `;
    }
  }

  function widgetNext() {
    const todayClasses = _getTodayClasses();
    if (_widgetSelectedIndex < todayClasses.length - 1) {
      _widgetSelectedIndex++;
      _renderQuickWidget();
    }
  }

  function widgetPrev() {
    if (_widgetSelectedIndex > 0) {
      _widgetSelectedIndex--;
      _renderQuickWidget();
    }
  }

  async function widgetMark(status) {
    const todayClasses = _getTodayClasses();
    const activeClass = todayClasses[_widgetSelectedIndex];
    if (!activeClass) return;
    await markToday(activeClass.subject_id, status);
  }

  // ─── Attendance Trend ─────────────────────────────────────

  function _renderTrend() {
    const section = document.getElementById('dash-trend');
    if (!section) return;

    // Compute weekly average from subjects
    const weeklyPcts = _subjects.map(s => parseFloat(s.percentage || 0));
    const avg = weeklyPcts.length ? weeklyPcts.reduce((a, b) => a + b, 0) / weeklyPcts.length : 0;

    section.innerHTML = `
      <div class="h-44 glass-card rounded-2xl relative overflow-hidden p-5 flex flex-col justify-between">
        <div class="relative z-10">
          <h4 class="font-label-caps text-label-caps text-on-surface-variant">OVERALL AVERAGE</h4>
          <p class="font-headline-lg text-headline-lg">${avg.toFixed(1)}% across ${_subjects.length} subject${_subjects.length !== 1 ? 's' : ''}</p>
        </div>
        <div class="relative h-20 w-full flex items-end gap-1.5 z-10">
          ${_subjects.map((s, i) => {
            const pct = parseFloat(s.percentage || 0);
            const color = UIModule.getAttendanceColor(pct);
            const h = Math.max(10, pct);
            return `
              <div class="flex-1 flex flex-col items-center gap-1" title="${s.subject_name}: ${pct.toFixed(1)}%">
                <div class="w-full rounded-t-sm transition-all duration-700" style="height:${h}%; background:${color}22; border-top: 2px solid ${color}"></div>
              </div>`;
          }).join('')}
        </div>
        <div class="absolute inset-0 pointer-events-none opacity-10">
          <div class="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-primary/20 to-transparent"></div>
        </div>
      </div>
    `;
  }

  // ─── Portal Sync Modal ────────────────────────────────────

  function openSyncModal(subjectId) {
    // Simple prompt-based sync for now
    const subj = _subjects.find(s => s.subject_id === subjectId);
    if (!subj) return;
    const held     = prompt(`${subj.subject_name}\nEnter portal-held count:`);
    if (held === null) return;
    const attended = prompt(`Enter portal-attended count:`);
    if (attended === null) return;
    const date = prompt(`Enter sync date (YYYY-MM-DD):`, UIModule.todayStr());
    if (!date) return;

    ApiModule.syncPortal(subjectId, parseInt(held) || 0, parseInt(attended) || 0, date)
      .then(() => { UIModule.toast('Portal synced!', 'success'); load(); })
      .catch(err => UIModule.toast('Sync failed: ' + err.message, 'error'));
  }

  // ─── Prompts and Widget Installation Guide ────────────────

  function _renderPrompts() {
    const container = document.getElementById('dashboard-prompts');
    if (!container) return;

    container.innerHTML = '';

    // Check Notification status — show on all devices
    const showNotificationPrompt = ('Notification' in window) && Notification.permission !== 'granted'
      && Notification.permission !== 'denied'; // don't nag if user explicitly denied

    // Check Standalone status (not installed) — show on mobile only
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const showWidgetPrompt = !isStandalone && isMobile;

    if (showNotificationPrompt) {
      const card = document.createElement('div');
      card.className = "glass-card rounded-2xl p-5 border border-primary/20 bg-primary/5 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-300";
      card.innerHTML = `
        <div class="flex gap-4 items-center">
          <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-primary">
            <span class="material-symbols-outlined text-[24px]">notifications_active</span>
          </div>
          <div>
            <h4 class="font-headline-md text-[15px] leading-tight text-on-surface">Enable Class Alerts</h4>
            <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Get notified before every class to log attendance.</p>
          </div>
        </div>
        <button onclick="DashboardModule.enableNotificationsPrompt(this)" class="px-4 py-2 bg-primary text-on-primary font-label-caps text-[11px] font-bold rounded-xl active:scale-95 transition-transform shrink-0">ENABLE</button>
      `;
      container.appendChild(card);
    }

    if (showWidgetPrompt) {
      const card = document.createElement('div');
      card.className = "glass-card rounded-2xl p-5 border border-secondary/20 bg-secondary/5 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-300";
      card.innerHTML = `
        <div class="flex gap-4 items-center">
          <div class="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center shrink-0 text-secondary">
            <span class="material-symbols-outlined text-[24px]">widgets</span>
          </div>
          <div>
            <h4 class="font-headline-md text-[15px] leading-tight text-on-surface">Add Daily Widget</h4>
            <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Place a widget shortcut on your mobile home screen.</p>
          </div>
        </div>
        <button onclick="DashboardModule.showWidgetInstallGuide()" class="px-4 py-2 bg-secondary text-on-secondary font-label-caps text-[11px] font-bold rounded-xl active:scale-95 transition-transform shrink-0">ADD WIDGET</button>
      `;
      container.appendChild(card);
    }
  }

  async function enableNotificationsPrompt(btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enabling...';
    }
    const granted = await PushModule.requestPermission();
    if (granted) {
      await PushModule.subscribe();
      _renderPrompts();
    } else {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'ENABLE';
      }
    }
  }

  function showWidgetInstallGuide() {
    const modal = document.getElementById('widget-guide-modal');
    if (!modal) return;

    // Check if browser native install prompt is available
    const nativeBtn = document.getElementById('pwa-install-prompt-btn');
    if (nativeBtn) {
      const hasPrompt = !!window.AppRouter?.getInstallPrompt();
      nativeBtn.classList.toggle('hidden', !hasPrompt);
      nativeBtn.classList.toggle('block', hasPrompt);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeWidgetGuide() {
    const modal = document.getElementById('widget-guide-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  async function triggerNativeInstall() {
    closeWidgetGuide();
    if (window.AppRouter) {
      await window.AppRouter.triggerInstall();
      _renderPrompts();
    }
  }

  return { load, markToday, initWhatIf, openSyncModal, enableSemesterEdit, cancelSemesterEdit, saveSemesterEndDateInline, enableNotificationsPrompt, showWidgetInstallGuide, closeWidgetGuide, triggerNativeInstall, widgetNext, widgetPrev, widgetMark };
})();
