// ============================================================
// AttendCount — Configuration
// ============================================================
// STEP 1: Replace these with your Supabase credentials
//         https://supabase.com/dashboard/project/_/settings/api
//
// STEP 2: Replace Google Client ID
//         https://console.cloud.google.com/apis/credentials
//
// STEP 3: Update ANDROID_PACKAGE with your chosen package name
// ============================================================

window.APP_CONFIG = {
  // --- Supabase ---
  SUPABASE_URL: 'https://kjjvpxtbiywbetxzslvb.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqanZweHRiaXl3YmV0eHpzbHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjE3OTUsImV4cCI6MjA5NzE5Nzc5NX0.MLveCeW7V8HahGyaaxrUeB8l4BhkFX2B74-ZsEvitTE',

  // --- Google OAuth (used by Supabase Auth) ---
  // This is set in Supabase dashboard → Auth → Providers → Google
  // You do NOT pass the client secret here (it lives in Supabase)
  GOOGLE_CLIENT_ID: '13312494605-q453m4bkce7d4psh6u4iptmf9q4c8v2q.apps.googleusercontent.com',

  // --- Attendance Rules ---
  ATTENDANCE_THRESHOLD: 0.75,         // 75% minimum
  LAB_WEIGHT: 3,                       // Lab session counts as 3 periods
  THEORY_WEIGHT: 1,

  // --- Calendar Sync ---
  CALENDAR_SYNC_INTERVAL_HOURS: 24,
  HOLIDAY_KEYWORDS: ['holiday', 'break', 'vacation', 'recess', 'no class'],

  // --- TWA / Play Store ---
  ANDROID_PACKAGE: 'com.yourname.attendcount',

  // --- Push Notifications (VAPID Public Key) ---
  // Generate at: https://vapidkeys.com/
  VAPID_PUBLIC_KEY: 'BMOJEZ2WJAtwltvbvnTds6phdck-Y5eOdWtF-7KCvwIUuKhG-KHZv3LBCugJVmsoAjbZtgb2KXzFDZ3JEycY6ds',

  // --- App Info ---
  APP_NAME: 'AttendCount',
  APP_VERSION: '1.0.0',
};
