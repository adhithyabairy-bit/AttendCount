// ============================================================
// js/setup.js — 3-Step Setup Wizard
// Step 1: Define subjects (name + type)
// Step 2: Build timetable (assign subjects to slots)
// Step 3: Initialize baseline (held + attended from portal)
// ============================================================

const SetupModule = (() => {
  let _currentStep = 1;
  const _totalSteps = 3;
  let _subjects = [];      // [{ tempId, name, type, color }]
  let _timetable = {};     // { subjectTempId: { Monday: [0,1], Tuesday: [3] } }
  let _slotTimes = [
    { start: '09:00', end: '10:00' },
    { start: '10:00', end: '11:00' },
    { start: '11:00', end: '12:00' },
    { start: '13:00', end: '14:00' },
    { start: '14:00', end: '15:00' },
    { start: '15:00', end: '16:00' },
  ];
  let _selectedSlot = null; // { day, slotIndex }
  const _days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let _buttonsBound = false;
  let _semesterEndDate = ''; // YYYY-MM-DD

  function init() {
    _currentStep = 1;
    _subjects = [];
    _timetable = {};
    _semesterEndDate = '';

    // Load existing semester end date if it exists
    ApiModule.getSemesterEndDate().then(date => {
      if (date) {
        _semesterEndDate = date;
        const input = document.getElementById('setup-semester-end');
        if (input) input.value = date;
      }
    });

    _renderStep1();
    _updateProgress();
    _bindStepButtons();
  }

  function _updateProgress() {
    const pct = (_currentStep / _totalSteps) * 100;
    const bar = document.getElementById('setup-progress-bar');
    const ind = document.getElementById('setup-step-indicator');
    const title = document.getElementById('setup-step-title');
    if (bar) bar.style.width = `${pct}%`;
    if (ind) ind.textContent = `Step ${_currentStep} of ${_totalSteps}`;
    const titles = ['Subject Configuration', 'Timetable Builder', 'Attendance Init'];
    if (title) title.textContent = titles[_currentStep - 1] || '';

    // Show/hide back button
    const backBtn = document.getElementById('setup-back-btn');
    const nextBtn = document.getElementById('setup-next-btn');
    if (backBtn) backBtn.classList.toggle('hidden', _currentStep === 1);
    if (nextBtn) nextBtn.textContent = _currentStep === _totalSteps ? 'Complete Setup' : 'Next Step';
  }

  function _bindStepButtons() {
    if (_buttonsBound) return;
    document.getElementById('setup-next-btn')?.addEventListener('click', nextStep);
    document.getElementById('setup-back-btn')?.addEventListener('click', prevStep);
    _buttonsBound = true;
  }

  async function nextStep() {
    if (_currentStep === 1) {
      if (!_validateSubjects()) return;
      const endInput = document.getElementById('setup-semester-end');
      if (!endInput || !endInput.value) {
        UIModule.toast('Please select your semester end date.', 'warning');
        return;
      }
      _semesterEndDate = endInput.value;
      _currentStep = 2;
      _renderStep2();
    } else if (_currentStep === 2) {
      _currentStep = 3;
      _renderStep3();
    } else if (_currentStep === 3) {
      await _completeSetup();
      return;
    }
    _updateProgress();
    window.scrollTo(0, 0);
  }

  function prevStep() {
    if (_currentStep > 1) {
      _currentStep--;
      if (_currentStep === 1) {
        _renderStep1();
        setTimeout(() => {
          const input = document.getElementById('setup-semester-end');
          if (input) input.value = _semesterEndDate;
        }, 50);
      }
      else if (_currentStep === 2) _renderStep2();
      _updateProgress();
      window.scrollTo(0, 0);
    }
  }

  // ─── Step 1: Subjects ────────────────────────────────────

  function _renderStep1() {
    const container = document.getElementById('setup-content');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-6">
        <h2 class="font-headline-md text-headline-md text-on-surface mb-1">Define Your Courses</h2>
        <p class="font-body-sm text-body-sm text-on-surface-variant">Add the subjects you're tracking this semester.</p>
      </div>
      <!-- Semester End Date input -->
      <div class="glass-card p-5 rounded-2xl mb-6 border border-primary/20 bg-primary/5">
        <label class="font-label-caps text-label-caps text-primary uppercase block mb-1">When does your semester end?</label>
        <p class="text-[11px] text-on-surface-variant mb-3">Needed to compute how many classes are left and predict safe skips.</p>
        <input type="date" id="setup-semester-end" class="w-full bg-surface-container-highest border border-outline-variant/30 rounded-xl text-on-surface px-4 py-3 focus:ring-2 focus:ring-primary focus:outline-none font-body-lg" required>
      </div>
      <div class="space-y-4" id="subjects-list">
        ${_subjects.length === 0 ? _defaultSubjectHtml() : _subjects.map(_subjectCardHtml).join('')}
      </div>
      <button onclick="SetupModule.addSubject()" class="mt-4 w-full py-4 border-2 border-dashed border-primary/20 rounded-xl font-label-caps text-label-caps text-primary flex items-center justify-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all active:scale-95">
        <span class="material-symbols-outlined">add</span> ADD ANOTHER SUBJECT
      </button>
    `;

    if (_semesterEndDate) {
      setTimeout(() => {
        const input = document.getElementById('setup-semester-end');
        if (input) input.value = _semesterEndDate;
      }, 50);
    }
  }

  function _defaultSubjectHtml() {
    _subjects = [
      { tempId: 's1', name: '', type: 'theory', color: UIModule.getSubjectColor(0) },
    ];
    return _subjects.map(_subjectCardHtml).join('');
  }

  function _subjectCardHtml(subj, i) {
    return `
      <div class="glass-card p-5 rounded-2xl space-y-4 subject-card" data-temp-id="${subj.tempId}">
        <div class="flex justify-between items-start">
          <div class="flex-1 mr-3">
            <label class="font-label-caps text-label-caps text-primary uppercase opacity-70 block mb-1">Subject Name</label>
            <input type="text" class="subject-name w-full bg-transparent border-b-2 border-outline-variant focus:border-primary outline-none py-2 font-body-lg text-body-lg text-on-surface placeholder:text-outline/40 transition-colors"
              placeholder="e.g. Data Structures" value="${subj.name}" data-id="${subj.tempId}">
          </div>
          <button onclick="SetupModule.removeSubject('${subj.tempId}')" class="w-9 h-9 flex items-center justify-center rounded-full text-error/50 hover:text-error hover:bg-error/10 transition-colors mt-5 shrink-0">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
        <div>
          <label class="font-label-caps text-label-caps text-primary uppercase opacity-70 block mb-2">Type</label>
          <div class="flex gap-2">
            <button onclick="SetupModule.setType('${subj.tempId}', 'theory')" data-type-btn="${subj.tempId}-theory"
              class="flex-1 py-3 rounded-xl font-label-caps text-label-caps border transition-all ${subj.type === 'theory' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary/50'}">
              Theory <span class="opacity-60">(Wt 1)</span>
            </button>
            <button onclick="SetupModule.setType('${subj.tempId}', 'lab')" data-type-btn="${subj.tempId}-lab"
              class="flex-1 py-3 rounded-xl font-label-caps text-label-caps border transition-all ${subj.type === 'lab' ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary/50'}">
              Lab <span class="opacity-60">(Wt 3)</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function addSubject() {
    _collectSubjectNames();
    const tempId = `s${Date.now()}`;
    _subjects.push({ tempId, name: '', type: 'theory', color: UIModule.getSubjectColor(_subjects.length) });
    const list = document.getElementById('subjects-list');
    if (list) {
      const div = document.createElement('div');
      div.innerHTML = _subjectCardHtml(_subjects[_subjects.length - 1], _subjects.length - 1);
      list.appendChild(div.firstElementChild);
    }
  }

  function removeSubject(tempId) {
    _subjects = _subjects.filter(s => s.tempId !== tempId);
    const card = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (card) { card.style.opacity = '0'; card.style.transform = 'scale(0.95)'; card.style.transition = 'all 0.2s'; setTimeout(() => card.remove(), 200); }
  }

  function setType(tempId, type) {
    const subj = _subjects.find(s => s.tempId === tempId);
    if (subj) {
      subj.type = type;
      // Re-render type buttons
      ['theory', 'lab'].forEach(t => {
        const btn = document.querySelector(`[data-type-btn="${tempId}-${t}"]`);
        if (!btn) return;
        btn.className = btn.className.replace(/bg-\S+|text-on-\S+|border-(?!outline)\S+/g, '').trim();
        if (t === type && type === 'theory') btn.className += ' bg-primary text-on-primary border-primary';
        else if (t === type && type === 'lab') btn.className += ' bg-secondary text-on-secondary border-secondary';
        else btn.className += ' border-outline-variant text-on-surface-variant';
      });
    }
  }

  function _collectSubjectNames() {
    document.querySelectorAll('.subject-name').forEach(input => {
      const id = input.dataset.id;
      const subj = _subjects.find(s => s.tempId === id);
      if (subj) subj.name = input.value.trim();
    });
  }

  function _validateSubjects() {
    _collectSubjectNames();
    const valid = _subjects.filter(s => s.name);
    if (!valid.length) { UIModule.toast('Please add at least one subject.', 'warning'); return false; }
    _subjects = valid;
    return true;
  }

  // ─── Step 2: Timetable ───────────────────────────────────

  function _renderStep2() {
    const container = document.getElementById('setup-content');
    if (!container) return;

    container.innerHTML = `
      <div class="mb-6">
        <h2 class="font-headline-md text-headline-md text-on-surface mb-1">Build Your Schedule</h2>
        <p class="font-body-sm text-body-sm text-on-surface-variant">Tap any slot to assign a subject. This repeats weekly.</p>
      </div>
      <!-- Global Slot Timings -->
      <div class="glass-card p-5 rounded-2xl mb-6">
        <div class="flex items-center gap-2 mb-3">
          <span class="material-symbols-outlined text-primary text-sm">schedule</span>
          <h3 class="font-headline-md text-primary">Slot Timings</h3>
        </div>
        <div class="grid grid-cols-1 gap-3" id="slot-timing-rows"></div>
      </div>
      <!-- Weekly Grid -->
      <div class="space-y-6" id="timetable-grid"></div>
      <!-- Assignment Modal -->
      <div id="slot-modal" class="fixed inset-0 z-[100] hidden items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
        <div class="glass-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
          <div class="flex justify-between items-center">
            <div>
              <h3 class="font-headline-md text-on-surface">Assign Subject</h3>
              <p class="text-xs text-primary font-bold uppercase tracking-widest" id="modal-slot-label">Monday • Slot 1</p>
            </div>
            <button onclick="SetupModule.closeSlotModal()" class="p-2 rounded-full hover:bg-white/10"><span class="material-symbols-outlined">close</span></button>
          </div>
          <div class="space-y-2 max-h-[40vh] overflow-y-auto" id="modal-subject-options"></div>
          <button onclick="SetupModule.clearSlot()" class="w-full py-3 rounded-xl border border-error/30 text-error text-xs font-bold uppercase tracking-widest hover:bg-error/5 transition-colors">
            <span class="material-symbols-outlined text-sm align-middle mr-1">block</span> Clear Slot
          </button>
        </div>
      </div>
    `;

    _renderSlotTimings();
    _buildTimetableGrid();
  }

  function _renderSlotTimings() {
    const container = document.getElementById('slot-timing-rows');
    if (!container) return;
    container.innerHTML = _slotTimes.map((slot, i) => `
      <div class="flex items-center gap-4 p-3.5 bg-white/5 rounded-xl border border-white/5 hover:border-primary/20 transition-colors">
        <span class="font-label-caps text-label-caps text-on-surface-variant w-16 shrink-0 font-bold">Slot ${i + 1}</span>
        <div class="flex-1 flex items-center gap-2">
          <input type="time" value="${slot.start}" class="w-full min-w-0 bg-surface-container-highest border border-outline-variant/30 rounded-lg text-on-surface text-sm text-center py-1.5 px-2 outline-none focus:border-primary transition-colors" onchange="SetupModule.updateSlotTime(${i}, 'start', this.value)">
          <span class="text-outline/40 font-semibold">–</span>
          <input type="time" value="${slot.end}" class="w-full min-w-0 bg-surface-container-highest border border-outline-variant/30 rounded-lg text-on-surface text-sm text-center py-1.5 px-2 outline-none focus:border-primary transition-colors" onchange="SetupModule.updateSlotTime(${i}, 'end', this.value)">
        </div>
      </div>
    `).join('');
  }

  function updateSlotTime(index, part, value) {
    _slotTimes[index][part] = value;
    document.querySelectorAll(`.slot-time-${index}`).forEach(el => {
      el.textContent = `${_slotTimes[index].start}–${_slotTimes[index].end}`;
    });
  }

  function _buildTimetableGrid() {
    const grid = document.getElementById('timetable-grid');
    if (!grid) return;
    grid.innerHTML = '';
    _days.forEach(day => {
      const section = document.createElement('div');
      section.innerHTML = `
        <h3 class="font-label-caps text-on-surface-variant uppercase mb-2 border-l-2 border-primary/30 pl-3 tracking-widest">${day}</h3>
        <div class="grid grid-cols-3 gap-2" id="grid-${day}"></div>
      `;
      grid.appendChild(section);

      const dayGrid = section.querySelector(`#grid-${day}`);
      _slotTimes.forEach((slot, i) => {
        const div = document.createElement('div');
        div.id = `slot-${day}-${i}`;
        div.className = 'timetable-slot glass-card rounded-xl p-3 min-h-[80px] flex flex-col gap-1 cursor-pointer hover:border-primary/40 transition-all';
        div.onclick = () => openSlotModal(day, i);
        div.innerHTML = `
          <span class="text-[10px] text-outline/40 uppercase font-bold">S${i + 1}</span>
          <span class="slot-time-${i} text-[9px] text-primary/50 font-semibold">${slot.start}–${slot.end}</span>
          <span class="slot-subject text-[11px] text-outline/30 italic mt-auto">Empty</span>
        `;
        dayGrid.appendChild(div);
      });
    });
  }

  function openSlotModal(day, slotIndex) {
    _selectedSlot = { day, slotIndex };
    const modal = document.getElementById('slot-modal');
    const label = document.getElementById('modal-slot-label');
    const options = document.getElementById('modal-subject-options');
    if (!modal) return;
    label.textContent = `${day} • Slot ${slotIndex + 1}`;
    options.innerHTML = _subjects.map(s => `
      <button onclick="SetupModule.assignSlot('${s.tempId}')" class="w-full text-left p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-primary/20 hover:border-primary/50 transition-all flex justify-between items-center group">
        <div>
          <span class="block font-bold text-on-surface group-hover:text-primary transition-colors">${s.name}</span>
          <span class="text-[10px] text-primary/60 uppercase tracking-widest">${s.type} · Wt ${s.type === 'lab' ? 3 : 1}</span>
        </div>
        <span class="material-symbols-outlined text-primary/40 group-hover:text-primary text-sm">arrow_forward</span>
      </button>
    `).join('');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function assignSlot(tempId) {
    if (!_selectedSlot) return;
    const { day, slotIndex } = _selectedSlot;
    const subj = _subjects.find(s => s.tempId === tempId);
    if (!subj) return;

    // If lab, occupy 3 consecutive slots
    const slotsNeeded = subj.type === 'lab' ? 3 : 1;
    for (let i = slotIndex; i < slotIndex + slotsNeeded && i < _slotTimes.length; i++) {
      const slotEl = document.getElementById(`slot-${day}-${i}`);
      if (slotEl) {
        slotEl.querySelector('.slot-subject').textContent = subj.name;
        slotEl.querySelector('.slot-subject').style.color = subj.type === 'lab' ? '#fabd00' : '#adc6ff';
        slotEl.querySelector('.slot-subject').classList.remove('italic', 'text-outline/30');
        slotEl.classList.add('border-primary/30', 'bg-primary/5');
      }
      // Record in timetable
      if (!_timetable[tempId]) _timetable[tempId] = {};
      if (!_timetable[tempId][day]) _timetable[tempId][day] = [];
      if (!_timetable[tempId][day].includes(i)) _timetable[tempId][day].push(i);
    }
    closeSlotModal();
  }

  function clearSlot() {
    if (!_selectedSlot) return;
    const { day, slotIndex } = _selectedSlot;
    const slotEl = document.getElementById(`slot-${day}-${slotIndex}`);
    if (slotEl) {
      slotEl.querySelector('.slot-subject').textContent = 'Empty';
      slotEl.querySelector('.slot-subject').style.color = '';
      slotEl.querySelector('.slot-subject').classList.add('italic', 'text-outline/30');
      slotEl.classList.remove('border-primary/30', 'bg-primary/5');
    }
    // Remove from timetable
    for (const tempId in _timetable) {
      if (_timetable[tempId][day]) {
        _timetable[tempId][day] = _timetable[tempId][day].filter(s => s !== slotIndex);
      }
    }
    closeSlotModal();
  }

  function closeSlotModal() {
    const modal = document.getElementById('slot-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    _selectedSlot = null;
  }

  // ─── Step 3: Baseline Init ───────────────────────────────

  function _renderStep3() {
    const container = document.getElementById('setup-content');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-6">
        <h2 class="font-headline-md text-headline-md text-on-surface mb-1">Initial Attendance</h2>
        <p class="font-body-sm text-body-sm text-on-surface-variant italic">Starting fresh? Enter 0. Mid-semester? Enter your current held and attended counts from the portal.</p>
      </div>
      <div class="space-y-4" id="baseline-list">
        ${_subjects.map((s, i) => `
          <div class="glass-card p-5 rounded-2xl border-l-4" style="border-left-color: ${s.color}">
            <div class="flex items-center gap-3 mb-5">
              <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background: ${s.color}22">
                <span class="material-symbols-outlined text-sm" style="color: ${s.color}">${s.type === 'lab' ? 'science' : 'book'}</span>
              </div>
              <div>
                <p class="font-headline-md text-on-surface">${s.name}</p>
                <p class="font-label-caps text-label-caps text-outline uppercase">${s.type} · Weight ${s.type === 'lab' ? 3 : 1}</p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="font-label-caps text-label-caps text-outline uppercase block mb-1">Classes Held</label>
                <input type="number" min="0" class="baseline-held w-full bg-transparent border-b-2 border-outline-variant focus:border-primary outline-none py-2 font-display-stat text-3xl text-on-surface placeholder:text-outline/30 transition-colors text-center" placeholder="0" data-subject-temp="${s.tempId}">
              </div>
              <div>
                <label class="font-label-caps text-label-caps text-primary uppercase block mb-1">Attended</label>
                <input type="number" min="0" class="baseline-attended w-full bg-transparent border-b-2 border-primary/30 focus:border-primary outline-none py-2 font-display-stat text-3xl text-primary placeholder:text-outline/30 transition-colors text-center" placeholder="0" data-subject-temp="${s.tempId}">
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ─── Complete Setup ──────────────────────────────────────

  async function _completeSetup() {
    const nextBtn = document.getElementById('setup-next-btn');
    if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Setting up...'; }
    UIModule.showLoader(true);

    try {
      // Save semester end date first
      await ApiModule.setSemesterEndDate(_semesterEndDate);
      await ApiModule.saveSlotTimings(_slotTimes);

      // Create subjects + timetable
      const createdSubjects = {};
      for (const subj of _subjects) {
        // Convert tempId-based timetable to subject-level timetable
        const timetable = _timetable[subj.tempId] || {};
        const dbSubj = await ApiModule.createSubject({
          name: subj.name,
          type: subj.type,
          timetable,
          color: subj.color,
        });
        createdSubjects[subj.tempId] = dbSubj;
      }

      // Save baselines
      const heldInputs     = document.querySelectorAll('.baseline-held');
      const attendedInputs = document.querySelectorAll('.baseline-attended');

      for (let i = 0; i < heldInputs.length; i++) {
        const tempId  = heldInputs[i].dataset.subjectTemp;
        const held    = parseInt(heldInputs[i].value)     || 0;
        const attended = parseInt(attendedInputs[i].value) || 0;
        const dbSubj = createdSubjects[tempId];
        if (dbSubj) await ApiModule.setBaseline(dbSubj.id, held, attended);
      }

      UIModule.showLoader(false);
      UIModule.toast('Setup complete! Welcome to AttendCount.', 'success', 4000);
      setTimeout(() => window.AppRouter.navigate('dashboard'), 1500);
    } catch (err) {
      UIModule.showLoader(false);
      UIModule.toast('Setup failed: ' + err.message, 'error');
      if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Complete Setup'; }
      ApiModule.logError(err.message, err.stack);
    }
  }

  return { init, nextStep, prevStep, addSubject, removeSubject, setType, updateSlotTime, openSlotModal, assignSlot, clearSlot, closeSlotModal };
})();
