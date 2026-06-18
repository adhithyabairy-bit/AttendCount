// ============================================================
// js/holidays.js — Holiday Calendar & Google Calendar Sync
// ============================================================

const HolidaysModule = (() => {
  let _currentYear  = new Date().getFullYear();
  let _currentMonth = new Date().getMonth() + 1;
  let _holidays     = [];   // [{ date, label, source }]
  let _selectedDate = null;

  async function load() {
    UIModule.showLoader(true);
    try {
      await _loadMonth(_currentYear, _currentMonth);
    } catch (err) {
      if (!navigator.onLine || err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        UIModule.toast('Holiday calendar is unavailable offline.', 'info');
      } else {
        UIModule.toast('Failed to load holidays: ' + err.message, 'error');
        ApiModule.logError(err.message, err.stack);
      }
    } finally {
      UIModule.showLoader(false);
    }
  }

  async function _loadMonth(year, month) {
    _holidays = await ApiModule.getHolidays(year, month);
    _renderCalendar(year, month);
    _renderHolidayList();
  }

  // ─── Calendar Rendering ───────────────────────────────────

  function _renderCalendar(year, month) {
    const monthLabel = document.getElementById('cal-month-label');
    const grid       = document.getElementById('cal-grid');
    if (!monthLabel || !grid) return;

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fullNames  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    monthLabel.textContent = `${fullNames[month - 1]} ${year}`;

    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    // Adjust for Monday-first grid (0=Sun → 6, 1=Mon → 0, ...)
    const offset = (firstDay === 0) ? 6 : firstDay - 1;

    const holidayDates = new Set(_holidays.map(h => h.date));
    const todayStr = UIModule.todayStr();

    let html = '';
    // Empty leading cells
    for (let i = 0; i < offset; i++) {
      html += `<div class="day-cell opacity-20 text-on-surface-variant">${new Date(year, month - 1, -offset + i + 1).getDate()}</div>`;
    }
    // Actual days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr  = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isHoliday = holidayDates.has(dateStr);
      const isToday   = dateStr === todayStr;
      const isSelected = dateStr === _selectedDate;

      const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay();
      const isSunday = dayOfWeek === 0;

      let cls = 'day-cell text-on-surface cursor-pointer hover:bg-primary/10 rounded-full transition-all';
      let style = '';
      let clickHandler = `onclick="HolidaysModule.handleDayClick('${dateStr}', ${isHoliday})"`;

      if (isHoliday) {
        cls = 'day-cell is-holiday text-outline line-through cursor-not-allowed';
        style = 'background: rgba(255,255,255,0.04)';
      } else if (isSunday) {
        cls = 'day-cell text-error/60 cursor-not-allowed font-medium';
        style = 'background: rgba(255, 85, 69, 0.08)';
        clickHandler = ''; // Sunday is not clickable
      } else if (isSelected) {
        cls = 'day-cell selected rounded-full font-bold';
        style = 'background: #adc6ff; color: #002e69';
      } else if (isToday) {
        cls = 'day-cell text-primary rounded-full font-bold ring-1 ring-primary/50';
      }

      html += `<div class="${cls}" style="${style}" data-date="${dateStr}" ${clickHandler}>${d}</div>`;
    }

    // Empty trailing cells to complete the last week row
    const totalRendered = offset + daysInMonth;
    const remainder = totalRendered % 7;
    const paddingNeeded = remainder === 0 ? 0 : 7 - remainder;
    for (let i = 1; i <= paddingNeeded; i++) {
      html += `<div class="day-cell opacity-20 text-on-surface-variant">${new Date(year, month, i).getDate()}</div>`;
    }

    grid.innerHTML = html;
  }

  function handleDayClick(dateStr, isHoliday) {
    if (isHoliday) {
      // Ask to remove
      UIModule.confirm(`Remove holiday on ${UIModule.formatDate(dateStr)}?`, async () => {
        try {
          await ApiModule.removeHoliday(dateStr);
          UIModule.toast('Holiday removed.', 'success');
          await _loadMonth(_currentYear, _currentMonth);
        } catch (err) {
          UIModule.toast('Failed to remove holiday: ' + err.message, 'error');
        }
      });
      return;
    }
    _selectedDate = dateStr;
    _renderCalendar(_currentYear, _currentMonth);
    _openNameModal(dateStr);
  }

  function _openNameModal(dateStr) {
    const modal = document.getElementById('holiday-name-modal');
    const input = document.getElementById('holiday-name-input');
    const dateDisplay = document.getElementById('holiday-modal-date');
    if (!modal) return;
    if (dateDisplay) dateDisplay.textContent = UIModule.formatDate(dateStr);
    if (input) input.value = '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => input?.focus(), 100);
  }

  function closeNameModal() {
    const modal = document.getElementById('holiday-name-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    _selectedDate = null;
    _renderCalendar(_currentYear, _currentMonth);
  }

  async function confirmHoliday() {
    if (!_selectedDate) return;
    const input = document.getElementById('holiday-name-input');
    const label = input?.value.trim() || 'Holiday';
    try {
      await ApiModule.markHoliday([_selectedDate], label);
      UIModule.toast(`"${label}" marked for ${UIModule.formatDate(_selectedDate)}.`, 'success');
      closeNameModal();
      await _loadMonth(_currentYear, _currentMonth);
    } catch (err) {
      UIModule.toast('Failed to mark holiday: ' + err.message, 'error');
      ApiModule.logError(err.message, err.stack);
    }
  }

  // ─── Month Navigation ─────────────────────────────────────

  async function prevMonth() {
    _currentMonth--;
    if (_currentMonth < 1) { _currentMonth = 12; _currentYear--; }
    await _loadMonth(_currentYear, _currentMonth);
  }

  async function nextMonth() {
    _currentMonth++;
    if (_currentMonth > 12) { _currentMonth = 1; _currentYear++; }
    await _loadMonth(_currentYear, _currentMonth);
  }

  // ─── Holiday List ─────────────────────────────────────────

  function _renderHolidayList() {
    const list  = document.getElementById('holiday-list');
    const count = document.getElementById('holiday-count');
    const empty = document.getElementById('holiday-empty-state');
    if (!list) return;

    const unique = {};
    _holidays.forEach(h => { if (!unique[h.date]) unique[h.date] = h; });
    const items = Object.values(unique).sort((a, b) => a.date.localeCompare(b.date));

    if (count) count.textContent = items.length;

    if (!items.length) {
      list.innerHTML = '';
      if (empty) { empty.classList.remove('hidden'); empty.classList.add('flex'); }
      return;
    }
    if (empty) { empty.classList.add('hidden'); empty.classList.remove('flex'); }

    list.innerHTML = items.map(h => {
      const icon = h.source === 'google_calendar' ? 'event' : 'celebration';
      const color = h.source === 'google_calendar' ? '#4ade80' : '#adc6ff';
      return `
        <div class="glass-card rounded-xl p-4 flex items-center gap-4 transition-all active:scale-[0.98]" data-holiday-date="${h.date}">
          <div class="h-11 w-11 rounded-lg flex items-center justify-center shrink-0" style="background:${color}18">
            <span class="material-symbols-outlined" style="color:${color}">${icon}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-headline-md text-[15px] text-on-surface truncate">${h.label || 'Holiday'}</p>
            <p class="font-body-sm text-body-sm text-on-surface-variant">${UIModule.formatDate(h.date)}</p>
            ${h.source === 'google_calendar' ? `<span class="text-[10px] text-green-400/60 font-label-caps">Google Calendar</span>` : ''}
          </div>
          <button onclick="HolidaysModule.removeHolidayItem('${h.date}')" class="p-2 text-on-surface-variant hover:text-error transition-colors shrink-0">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      `;
    }).join('');
  }

  async function removeHolidayItem(dateStr) {
    UIModule.confirm(`Remove holiday on ${UIModule.formatDate(dateStr)}?`, async () => {
      try {
        await ApiModule.removeHoliday(dateStr);
        UIModule.toast('Holiday removed.', 'success');
        await _loadMonth(_currentYear, _currentMonth);
      } catch (err) {
        UIModule.toast('Failed: ' + err.message, 'error');
      }
    });
  }

  return {
    load, handleDayClick, closeNameModal, confirmHoliday, prevMonth, nextMonth,
    removeHolidayItem,
  };
})();
