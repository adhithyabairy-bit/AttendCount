// ============================================================
// js/onboarding.js — First-login onboarding (notifications + install)
// ============================================================

const OnboardingModule = (() => {
  const ONBOARDING_DONE_KEY = 'attendcount_onboarding_done';

  /**
   * Call after login. Shows the onboarding page only once.
   * Returns true if onboarding was shown, false if it was skipped.
   */
  function shouldShow() {
    // Show if never completed onboarding AND notifications not yet granted/denied
    const done = localStorage.getItem(ONBOARDING_DONE_KEY);
    if (done) return false;

    // Also skip if already installed as standalone PWA (already onboarded)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      // Still show if notifications not granted
      if (('Notification' in window) && Notification.permission === 'default') return true;
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      return false;
    }

    return true;
  }

  function show() {
    // Refresh the native install button visibility
    _refreshInstallButton();
    AppRouter.navigate('onboarding');
  }

  function _refreshInstallButton() {
    const nativeBtn = document.getElementById('onboarding-native-install');
    const manualDiv = document.getElementById('onboarding-manual-install');
    if (!nativeBtn || !manualDiv) return;

    const hasPrompt = !!window.AppRouter?.getInstallPrompt();
    if (hasPrompt) {
      nativeBtn.classList.remove('hidden');
      nativeBtn.classList.add('flex');
      manualDiv.classList.add('hidden');
    } else {
      nativeBtn.classList.add('hidden');
      nativeBtn.classList.remove('flex');
      manualDiv.classList.remove('hidden');
    }
  }

  async function enableNotifications(btn) {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> Requesting...`;
    }

    const granted = await PushModule.requestPermission();
    if (granted) {
      await PushModule.subscribe();
      // Mark the card as done
      const card = document.getElementById('onboarding-notif-card');
      if (card) {
        card.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-green-400 shrink-0">
              <span class="material-symbols-outlined text-[22px]">check_circle</span>
            </div>
            <div>
              <h3 class="font-headline-md text-[15px] text-on-surface">Notifications Enabled!</h3>
              <p class="font-body-sm text-[12px] text-green-400/80 mt-0.5">You'll get a reminder at the start of every class.</p>
            </div>
          </div>
        `;
      }
    } else {
      // Reset button if denied
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined text-[16px]">notifications</span> ALLOW NOTIFICATIONS`;
      }
    }
  }

  function skipNotif() {
    const card = document.getElementById('onboarding-notif-card');
    if (card) {
      card.innerHTML = `
        <div class="flex items-center gap-3 opacity-50">
          <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-outline shrink-0">
            <span class="material-symbols-outlined text-[22px]">notifications_off</span>
          </div>
          <div>
            <h3 class="font-headline-md text-[15px] text-on-surface">Notifications Skipped</h3>
            <p class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">You can enable them later from your profile menu.</p>
          </div>
        </div>
      `;
    }
  }

  async function triggerInstall() {
    const success = await window.AppRouter?.triggerInstall();
    if (success) {
      const installDiv = document.getElementById('onboarding-install-options');
      if (installDiv) {
        installDiv.innerHTML = `
          <div class="flex items-center gap-2 text-green-400 font-body-sm">
            <span class="material-symbols-outlined text-[18px]">check_circle</span>
            App installed! You'll find it on your home screen.
          </div>
        `;
      }
    }
  }

  function finish() {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    // Navigate to appropriate destination
    AppRouter._continueAfterOnboarding();
  }

  return { shouldShow, show, enableNotifications, skipNotif, triggerInstall, finish };
})();
