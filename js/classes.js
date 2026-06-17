// ============================================================
// js/classes.js — Manage Classes: Per-Subject Summary View
// ============================================================

const ClassesModule = (() => {
  let _subjects = [];
  let _semesterEndDate = null;
  let _futureHolidays = [];

  async function load() {
    UIModule.showLoader(true);
    try {
      const [subjects, endDate] = await Promise.all([
        ApiModule.getDashboard(),
        ApiModule.getSemesterEndDate()
      ]);
      _subjects = subjects;
      _semesterEndDate = endDate;
      _futureHolidays = [];

      if (_semesterEndDate) {
        const todayStr = UIModule.todayStr();
        _futureHolidays = await ApiModule.getFutureHolidays(todayStr, _semesterEndDate);
      }

      _renderSummaryHeader();
      _renderSubjectCards();
    } catch (err) {
      UIModule.toast('Failed to load classes: ' + err.message, 'error');
      ApiModule.logError(err.message, err.stack);
    } finally {
      UIModule.showLoader(false);
    }
  }

  function _getRemainingPeriods(subject) {
    if (!_semesterEndDate) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = UIModule.parseLocalDate(_semesterEndDate);

    if (endDate < today) return 0;

    const holidaySet = new Set(_futureHolidays.map(h => h.date));
    let remainingPeriods = 0;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const current = new Date(today);
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

  function _renderSummaryHeader() {
    const el = document.getElementById('classes-summary-header');
    if (!el) return;

    let totalHeld = 0, totalAttended = 0;
    _subjects.forEach(s => {
      const st = ApiModule.calculateStats(s);
      totalHeld     += st.totalHeld;
      totalAttended += st.totalAttended;
    });

    el.innerHTML = `
      <div class="glass-card rounded-2xl p-5 mb-5 flex justify-between items-center border-primary/20">
        <div class="flex flex-col items-start">
          <span class="font-label-caps text-outline text-[10px] uppercase tracking-widest mb-1">Total Held</span>
          <span class="font-display-stat text-[32px] text-primary font-extrabold">${totalHeld}</span>
        </div>
        <div class="h-12 w-px bg-white/10"></div>
        <div class="flex flex-col items-end">
          <span class="font-label-caps text-outline text-[10px] uppercase tracking-widest mb-1">Total Attended</span>
          <span class="font-display-stat text-[32px] text-on-surface font-extrabold">${totalAttended}</span>
        </div>
        <div class="h-12 w-px bg-white/10"></div>
        <div class="flex flex-col items-end">
          <span class="font-label-caps text-outline text-[10px] uppercase tracking-widest mb-1">Overall</span>
          <span class="font-display-stat text-[32px] font-extrabold" style="color:${UIModule.getAttendanceColor(totalHeld > 0 ? totalAttended/totalHeld*100 : 0)}">
            ${totalHeld > 0 ? (totalAttended/totalHeld*100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>
    `;
  }

  function _renderSubjectCards() {
    const list = document.getElementById('classes-list');
    if (!list) return;

    if (!_subjects.length) {
      list.innerHTML = `
        <div class="glass-card rounded-2xl p-8 text-center">
          <span class="material-symbols-outlined text-[40px] text-primary/30 block mb-3">school</span>
          <p class="font-body-lg text-on-surface-variant">No subjects yet.</p>
          <p class="font-body-sm text-outline mt-1">Complete the setup wizard to add your subjects.</p>
        </div>`;
      return;
    }

    list.innerHTML = _subjects.map((s, idx) => {
      const stats   = ApiModule.calculateStats(s);
      const color   = s.color || UIModule.getSubjectColor(idx);
      const badge   = UIModule.getAttendanceBadge(stats.percentage);
      const r = 15.9155, c = 2 * Math.PI * r;
      const offset  = c * (1 - stats.percentage / 100);

      return `
        <div class="glass-card rounded-2xl p-5 flex items-center justify-between group active:scale-[0.98] transition-transform cursor-pointer"
          onclick="ClassesModule.openSubjectDetail('${s.subject_id}')">
          <div class="flex-1 min-w-0 mr-4">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-2 h-2 rounded-full shrink-0" style="background:${color}"></div>
              <h3 class="font-headline-md text-headline-md text-on-surface truncate">${s.subject_name}</h3>
              ${s.subject_type === 'lab' ? '<span class="font-label-caps text-[9px] px-2 py-0.5 rounded bg-secondary/20 text-secondary shrink-0">LAB</span>' : ''}
            </div>
            <div class="flex items-center gap-4 text-outline mb-3">
              <div class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[14px]">history</span>
                <span class="font-body-sm">Held: ${stats.totalHeld}</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[14px]" style="color:${color}">check_circle</span>
                <span class="font-body-sm text-on-surface">Attended: ${stats.totalAttended}</span>
              </div>
            </div>
            <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-700" style="width:${Math.min(100,stats.percentage)}%; background:${badge.color}"></div>
            </div>
            ${stats.safeToMiss < 0
              ? `<p class="font-label-caps text-[10px] text-error mt-1.5">Need ${Math.abs(stats.safeToMiss)} more to reach 75%</p>`
              : stats.safeToMiss > 0
              ? `<p class="font-label-caps text-[10px] text-green-400/60 mt-1.5">Can skip ${stats.safeToMiss} more</p>`
              : `<p class="font-label-caps text-[10px] text-yellow-400/60 mt-1.5">At 75% threshold</p>`
            }
          </div>
          <!-- Mini ring -->
          <div class="relative w-14 h-14 flex items-center justify-center shrink-0">
            <svg class="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="3"/>
              <circle cx="18" cy="18" r="${r}" fill="none" stroke="${badge.color}" stroke-width="3"
                stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
                class="progress-ring-circle"/>
            </svg>
            <span class="absolute font-label-caps text-on-surface text-[10px]">${stats.percentage.toFixed(0)}%</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function openSubjectDetail(subjectId) {
    const s = _subjects.find(x => x.subject_id === subjectId);
    if (!s) return;
    const stats = ApiModule.calculateStats(s);
    const color = s.color || '#adc6ff';
    const badge = UIModule.getAttendanceBadge(stats.percentage);

    const modal = document.getElementById('subject-detail-modal');
    const content = document.getElementById('subject-detail-content');
    if (!modal || !content) return;

    // Semester projection calculations
    const remClasses = _getRemainingPeriods(s);
    const totalSem = stats.totalHeld + remClasses;
    const reqSemAttended = Math.ceil(0.75 * totalSem);
    const maxSemAttended = stats.totalAttended + remClasses;
    const isImpossible = maxSemAttended < reqSemAttended;
    const projectedMaxPct = totalSem > 0 ? (maxSemAttended / totalSem) * 100 : 0;
    const minFuture = Math.max(0, reqSemAttended - stats.totalAttended);
    const skipsLeft = Math.max(0, remClasses - minFuture);

    content.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center gap-3">
          <div class="w-3 h-3 rounded-full" style="background:${color}"></div>
          <h3 class="font-headline-lg text-headline-lg text-on-surface">${s.subject_name}</h3>
          <span class="font-label-caps text-[10px] px-2 py-0.5 rounded" style="background:${color}20; color:${color}">${s.subject_type.toUpperCase()} · Wt ${s.weight}</span>
        </div>
        <div class="grid grid-cols-3 gap-3">
          ${[
            { label: 'Held', value: stats.totalHeld, color: '#adc6ff' },
            { label: 'Attended', value: stats.totalAttended, color: color },
            { label: 'Attendance', value: stats.percentage.toFixed(1) + '%', color: badge.color },
          ].map(item => `
            <div class="glass-card rounded-xl p-4 text-center">
              <p class="font-display-stat text-2xl font-extrabold" style="color:${item.color}">${item.value}</p>
              <p class="font-label-caps text-[10px] text-outline mt-1">${item.label}</p>
            </div>
          `).join('')}
        </div>
        
        <!-- Semester end projection section -->
        ${_semesterEndDate ? `
        <div class="glass-card rounded-xl p-4 border border-white/5 space-y-2">
          <p class="font-label-caps text-[10px] text-primary uppercase tracking-widest">Semester End Projection</p>
          <div class="flex justify-between font-body-sm">
            <span class="text-on-surface-variant">Remaining Scheduled Periods</span>
            <span class="text-on-surface font-semibold">${remClasses}</span>
          </div>
          <div class="flex justify-between font-body-sm">
            <span class="text-on-surface-variant">Projected Max Attendance</span>
            <span class="text-on-surface font-semibold" style="color: ${projectedMaxPct >= 75 ? '#4ade80' : '#ff5545'}">${projectedMaxPct.toFixed(1)}%</span>
          </div>
          <div class="flex justify-between font-body-sm">
            <span class="text-on-surface-variant">Skips Left (Rest of Sem)</span>
            <span class="font-bold" style="color: ${isImpossible ? '#ff5545' : minFuture > 0 ? '#fabd00' : '#4ade80'}">
              ${isImpossible ? 'IMPOSSIBLE (Below 75%)' : skipsLeft}
            </span>
          </div>
        </div>
        ` : `
        <div class="glass-card rounded-xl p-4 border border-dashed border-white/10 text-center">
          <p class="font-body-sm text-on-surface-variant">Configure a Semester End Date in the Dashboard to see detailed remaining class and skip projections here.</p>
        </div>
        `}

        <div class="glass-card rounded-xl p-4">
          <p class="font-label-caps text-[10px] text-outline uppercase mb-2">Portal Baseline</p>
          <div class="flex justify-between font-body-sm">
            <span class="text-on-surface-variant">Official Held</span>
            <span class="text-on-surface">${s.official_held}</span>
          </div>
          <div class="flex justify-between font-body-sm mt-1">
            <span class="text-on-surface-variant">Official Attended</span>
            <span class="text-on-surface">${s.official_attended}</span>
          </div>
          ${s.last_sync_date ? `<p class="font-body-sm text-outline mt-2">Last sync: ${UIModule.formatDate(s.last_sync_date)}</p>` : ''}
        </div>
        <button onclick="ClassesModule.openPortalSync('${subjectId}')" class="w-full py-4 rounded-xl glass-card font-label-caps text-label-caps text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-[18px]">sync</span> SYNC PORTAL DATA
        </button>
        <button onclick="ClassesModule.deleteSubjectConfirm('${subjectId}', '${s.subject_name}')" class="w-full py-3 rounded-xl border border-error/30 font-label-caps text-label-caps text-error hover:bg-error/5 transition-colors flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-[16px]">delete</span> REMOVE SUBJECT
        </button>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeSubjectDetail() {
    const modal = document.getElementById('subject-detail-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
  }

  function openPortalSync(subjectId) {
    closeSubjectDetail();
    DashboardModule.openSyncModal(subjectId);
  }

  function deleteSubjectConfirm(subjectId, name) {
    UIModule.confirm(`Remove "${name}" and all its attendance data? This cannot be undone.`, async () => {
      try {
        await ApiModule.deleteSubject(subjectId);
        UIModule.toast(`"${name}" removed.`, 'success');
        closeSubjectDetail();
        await load();
      } catch (err) {
        UIModule.toast('Failed to remove: ' + err.message, 'error');
      }
    });
  }

  return { load, openSubjectDetail, closeSubjectDetail, openPortalSync, deleteSubjectConfirm };
})();
