// ============================================================
// js/push.js — Push Notification Registration & Class Reminders
// ============================================================

const PushModule = (() => {
  let _registration = null;

  async function init() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      _registration = await navigator.serviceWorker.ready;
    } catch (_) {}
  }

  async function requestPermission() {
    if (!('Notification' in window)) {
      UIModule.toast('Push notifications not supported in this browser.', 'warning');
      return false;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      UIModule.toast('Notification permission denied.', 'warning');
      return false;
    }
    UIModule.toast('Notifications enabled!', 'success');
    return true;
  }

  async function subscribe() {
    if (!_registration) await init();
    if (!_registration) return;

    const { VAPID_PUBLIC_KEY } = window.APP_CONFIG;
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY') {
      console.warn('[Push] VAPID_PUBLIC_KEY not configured. Push notifications disabled.');
      return;
    }

    try {
      const existing = await _registration.pushManager.getSubscription();
      if (existing) return existing;

      const sub = await _registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      return sub;
    } catch (err) {
      console.warn('[Push] Subscribe failed:', err);
    }
  }

  /**
   * Client-side class reminder: checks current time against timetable,
   * fires a local notification if a class is starting soon.
   * Called on every app load and can be run on a requestAnimationFrame loop.
   */
  async function checkCurrentClass() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      const subjects   = await ApiModule.getSubjects();
      const slotTimes  = await ApiModule.getSlotTimings();
      const today      = UIModule.todayDayName();
      const now        = new Date();
      const nowMins    = now.getHours() * 60 + now.getMinutes();

      for (const subj of subjects) {
        const timetable = subj.timetable || {};
        const todaySlots = timetable[today] || [];

        for (const slotIdx of todaySlots) {
          const slot = slotTimes[slotIdx];
          if (!slot) continue;
          const [h, m] = slot.start.split(':').map(Number);
          const slotMins = h * 60 + m;

          // Notify at the start of the class slot
          if (Math.abs(slotMins - nowMins) < 1) {
            const key = `notified-${UIModule.todayStr()}-${subj.id}-${slotIdx}`;
            if (localStorage.getItem(key)) continue;
            localStorage.setItem(key, '1');

            if (_registration) {
              _registration.showNotification(`Class Starting: ${subj.name}`, {
                body: `${slot.start} – ${slot.end} · ${subj.type === 'lab' ? 'Lab' : 'Theory'}\nTap to log attendance.`,
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                tag: `class-${subj.id}-${slotIdx}`,
                data: { url: '/#dashboard', subjectId: subj.id, date: UIModule.todayStr() },
                actions: [
                  { action: 'present', title: '✓ Present' },
                  { action: 'absent',  title: '✗ Absent'  },
                ],
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Push] checkCurrentClass error:', err);
    }
  }

  // Handle notification action messages from service worker
  async function handleServiceWorkerMessage(event) {
    if (event.data?.type === 'NOTIFICATION_ACTION') {
      const { action, notificationData } = event.data;
      if ((action === 'present' || action === 'absent') && notificationData?.subjectId) {
        try {
          UIModule.showLoader(true);
          await ApiModule.markAttendance(notificationData.subjectId, notificationData.date || UIModule.todayStr(), action);
          UIModule.toast(`Marked as ${action.toUpperCase()} from notification!`, action === 'present' ? 'success' : 'info');
          
          // Force cache clear so the UI updates
          ApiModule.clearCache();
          
          if (window.AppRouter) {
            window.AppRouter.navigate('dashboard');
            // If already on dashboard, trigger load to update states
            if (window.DashboardModule) window.DashboardModule.load();
          }
        } catch (err) {
          UIModule.toast('Failed to mark attendance from notification.', 'error');
        } finally {
          UIModule.showLoader(false);
        }
      }
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  }

  function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  return { init, requestPermission, subscribe, checkCurrentClass };
})();
