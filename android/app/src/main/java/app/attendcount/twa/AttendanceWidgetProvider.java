package app.attendcount.twa;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;

public class AttendanceWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "AttendanceWidget";
    private static final String PREFS_NAME = "group.app.attendcount";

    public static final String ACTION_MARK_ATTENDANCE = "app.attendcount.twa.ACTION_MARK_ATTENDANCE";
    public static final String EXTRA_SUBJECT_ID = "extra_subject_id";
    public static final String EXTRA_STATUS = "extra_status";
    public static final String EXTRA_DATE = "extra_date";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        if (ACTION_MARK_ATTENDANCE.equals(intent.getAction())) {
            String subjectId = intent.getStringExtra(EXTRA_SUBJECT_ID);
            String status = intent.getStringExtra(EXTRA_STATUS);
            String date = intent.getStringExtra(EXTRA_DATE);

            if (subjectId != null && status != null && date != null) {
                markAttendanceInBackground(context, subjectId, date, status);
            }
        }
    }

    private static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.attendance_widget_layout);

        // 1. Set Date
        SimpleDateFormat dateFormat = new SimpleDateFormat("EEEE, MMM d", Locale.getDefault());
        views.setTextViewText(R.id.widget_date, dateFormat.format(new Date()));

        // 2. Read SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String userEmail = prefs.getString("user_email", null);
        String subjectsStr = prefs.getString("subjects", null);
        String slotsStr = prefs.getString("slot_timings", null);
        String todayLogsStr = prefs.getString("today_logs", null);

        if (userEmail == null || subjectsStr == null) {
            views.setTextViewText(R.id.widget_stats, "Not Logged In");
            views.setTextViewText(R.id.widget_status_sub, "Please open AttendCount");
            views.setTextViewText(R.id.widget_class_title, "No Data Available");
            views.setTextViewText(R.id.widget_class_time, "Log in to view classes");
            views.setViewVisibility(R.id.widget_button_container, View.GONE);
            views.setViewVisibility(R.id.widget_marked_status, View.GONE);
            appWidgetManager.updateAppWidget(appWidgetId, views);
            return;
        }

        try {
            JSONArray subjects = new JSONArray(subjectsStr);
            JSONArray slots = new JSONArray(slotsStr != null ? slotsStr : "[]");
            JSONObject todayLogs = new JSONObject(todayLogsStr != null ? todayLogsStr : "{}");

            // 3. Compute Stats
            int totalHeld = 0;
            int totalAttended = 0;
            for (int i = 0; i < subjects.length(); i++) {
                JSONObject sub = subjects.getJSONObject(i);
                int offHeld = sub.optInt("official_held", 0);
                int offAtt = sub.optInt("official_attended", 0);
                int rtHeld = sub.optInt("realtime_held", 0);
                int rtAtt = sub.optInt("realtime_attended", 0);

                totalHeld += (offHeld + rtHeld);
                totalAttended += (offAtt + rtAtt);
            }

            if (totalHeld > 0) {
                double pct = ((double) totalAttended / totalHeld) * 100.0;
                views.setTextViewText(R.id.widget_stats, String.format(Locale.getDefault(), "Overall: %.1f%%", pct));
            } else {
                views.setTextViewText(R.id.widget_stats, "No Attendance");
            }
            views.setTextViewText(R.id.widget_status_sub, userEmail);

            // 4. Find Current / Next Class
            Calendar cal = Calendar.getInstance();
            String dayOfWeek = cal.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.LONG, Locale.US);
            SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
            String currentTime = timeFormat.format(new Date());

            JSONObject currentOrNextClass = null;
            String classTimeStr = "";
            boolean isCurrent = false;

            // Find classes scheduled for today
            int bestNextSlotIndex = Integer.MAX_VALUE;
            JSONObject nextClass = null;
            String nextClassTime = "";

            int currentSlotIndex = -1;
            JSONObject currentClass = null;
            String currentClassTime = "";

            for (int i = 0; i < subjects.length(); i++) {
                JSONObject sub = subjects.getJSONObject(i);
                JSONObject timetable = sub.optJSONObject("timetable");
                if (timetable != null && timetable.has(dayOfWeek)) {
                    JSONArray daySlots = timetable.getJSONArray(dayOfWeek);
                    for (int j = 0; j < daySlots.length(); j++) {
                        int slotIdx = daySlots.getInt(j);
                        if (slotIdx >= 0 && slotIdx < slots.length()) {
                            JSONObject slot = slots.getJSONObject(slotIdx);
                            String start = slot.getString("start");
                            String end = slot.getString("end");

                            // Check if current class
                            if (currentTime.compareTo(start) >= 0 && currentTime.compareTo(end) <= 0) {
                                currentClass = sub;
                                currentSlotIndex = slotIdx;
                                currentClassTime = start + " - " + end;
                            }
                            // Check if next class
                            else if (currentTime.compareTo(start) < 0 && slotIdx < bestNextSlotIndex) {
                                bestNextSlotIndex = slotIdx;
                                nextClass = sub;
                                nextClassTime = start + " - " + end;
                            }
                        }
                    }
                }
            }

            if (currentClass != null) {
                currentOrNextClass = currentClass;
                classTimeStr = currentClassTime;
                isCurrent = true;
            } else if (nextClass != null) {
                currentOrNextClass = nextClass;
                classTimeStr = "Next: " + nextClassTime;
                isCurrent = false;
            }

            if (currentOrNextClass != null) {
                String subId = currentOrNextClass.getString("subject_id");
                if (subId == null || subId.isEmpty()) {
                    subId = currentOrNextClass.optString("id");
                }
                String subName = currentOrNextClass.getString("subject_name");
                if (subName == null || subName.isEmpty()) {
                    subName = currentOrNextClass.optString("name");
                }
                String subType = currentOrNextClass.optString("subject_type", currentOrNextClass.optString("type", ""));
                
                String displayName = subName + (subType.equalsIgnoreCase("lab") ? " (Lab)" : "");
                views.setTextViewText(R.id.widget_class_title, displayName);
                views.setTextViewText(R.id.widget_class_time, classTimeStr);

                // Check marked status
                String markedStatus = todayLogs.optString(subId, "");
                SimpleDateFormat ymdFormat = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                String todayYmd = ymdFormat.format(new Date());

                if (!markedStatus.isEmpty()) {
                    views.setViewVisibility(R.id.widget_button_container, View.GONE);
                    views.setViewVisibility(R.id.widget_marked_status, View.VISIBLE);
                    
                    if (markedStatus.equalsIgnoreCase("present")) {
                        views.setTextViewText(R.id.widget_marked_status, "Marked Present");
                        views.setTextColor(R.id.widget_marked_status, 0xFF22C55E); // Green
                    } else if (markedStatus.equalsIgnoreCase("absent")) {
                        views.setTextViewText(R.id.widget_marked_status, "Marked Absent");
                        views.setTextColor(R.id.widget_marked_status, 0xFFEF4444); // Red
                    } else {
                        views.setTextViewText(R.id.widget_marked_status, "Holiday");
                        views.setTextColor(R.id.widget_marked_status, 0xFF3B82F6); // Blue
                    }
                } else {
                    views.setViewVisibility(R.id.widget_button_container, View.VISIBLE);
                    views.setViewVisibility(R.id.widget_marked_status, View.GONE);

                    // Setup Button Clicks
                    Intent presentIntent = new Intent(context, AttendanceWidgetProvider.class);
                    presentIntent.setAction(ACTION_MARK_ATTENDANCE);
                    presentIntent.putExtra(EXTRA_SUBJECT_ID, subId);
                    presentIntent.putExtra(EXTRA_STATUS, "present");
                    presentIntent.putExtra(EXTRA_DATE, todayYmd);
                    // Ensure unique intent Uri so Android system distinguishes extra payloads
                    presentIntent.setData(Uri.parse(presentIntent.toUri(Intent.URI_INTENT_SCHEME)));
                    
                    PendingIntent presentPending = PendingIntent.getBroadcast(
                            context,
                            0,
                            presentIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | 
                            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE)
                    );
                    views.setOnClickPendingIntent(R.id.widget_btn_present, presentPending);

                    Intent absentIntent = new Intent(context, AttendanceWidgetProvider.class);
                    absentIntent.setAction(ACTION_MARK_ATTENDANCE);
                    absentIntent.putExtra(EXTRA_SUBJECT_ID, subId);
                    absentIntent.putExtra(EXTRA_STATUS, "absent");
                    absentIntent.putExtra(EXTRA_DATE, todayYmd);
                    absentIntent.setData(Uri.parse(absentIntent.toUri(Intent.URI_INTENT_SCHEME)));

                    PendingIntent absentPending = PendingIntent.getBroadcast(
                            context,
                            1,
                            absentIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | 
                            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE)
                    );
                    views.setOnClickPendingIntent(R.id.widget_btn_absent, absentPending);
                }

            } else {
                views.setTextViewText(R.id.widget_class_title, "No Classes Today");
                views.setTextViewText(R.id.widget_class_time, "Enjoy your day! 🎉");
                views.setViewVisibility(R.id.widget_button_container, View.GONE);
                views.setViewVisibility(R.id.widget_marked_status, View.GONE);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error rendering widget: ", e);
            views.setTextViewText(R.id.widget_class_title, "Error Loading Widget");
            views.setTextViewText(R.id.widget_class_time, "Open app to resolve");
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private void markAttendanceInBackground(final Context context, final String subjectId, final String date, final String status) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String supabaseUrl = prefs.getString("supabase_url", "");
                String anonKey = prefs.getString("supabase_anon_key", "");
                String userEmail = prefs.getString("user_email", "");
                String accessToken = prefs.getString("access_token", "");
                String refreshToken = prefs.getString("refresh_token", "");

                if (supabaseUrl.isEmpty() || anonKey.isEmpty() || userEmail.isEmpty()) {
                    showToast(context, "Authentication error. Open app.");
                    return;
                }

                // 1. Attempt to post
                boolean success = postAttendance(supabaseUrl, anonKey, accessToken, userEmail, subjectId, date, status);

                // 2. If unauthorized, refresh session and retry
                if (!success && !accessToken.isEmpty() && !refreshToken.isEmpty()) {
                    Log.d(TAG, "Access token may be expired. Refreshing token...");
                    String[] newTokens = refreshSupabaseSession(supabaseUrl, anonKey, refreshToken);
                    if (newTokens != null) {
                        String newAccess = newTokens[0];
                        String newRefresh = newTokens[1];

                        // Save new tokens back to preferences
                        prefs.edit()
                                .putString("access_token", newAccess)
                                .putString("refresh_token", newRefresh)
                                .apply();

                        Log.d(TAG, "Token refresh succeeded. Retrying attendance post...");
                        // Retry original request
                        success = postAttendance(supabaseUrl, anonKey, newAccess, userEmail, subjectId, date, status);
                    }
                }

                if (success) {
                    // Update local storage so widget updates instantly
                    try {
                        String todayLogsStr = prefs.getString("today_logs", "{}");
                        JSONObject todayLogs = new JSONObject(todayLogsStr);
                        todayLogs.put(subjectId, status);
                        
                        // Increment local realtime stats in subjects list
                        String subjectsStr = prefs.getString("subjects", "[]");
                        JSONArray subjects = new JSONArray(subjectsStr);
                        for (int i = 0; i < subjects.length(); i++) {
                            JSONObject sub = subjects.getJSONObject(i);
                            String subId = sub.optString("subject_id", sub.optString("id", ""));
                            if (subId.equals(subjectId)) {
                                int weight = sub.optInt("weight", 1);
                                int currentRtHeld = sub.optInt("realtime_held", 0);
                                int currentRtAttended = sub.optInt("realtime_attended", 0);

                                sub.put("realtime_held", currentRtHeld + weight);
                                if (status.equalsIgnoreCase("present")) {
                                    sub.put("realtime_attended", currentRtAttended + weight);
                                }
                                break;
                            }
                        }

                        prefs.edit()
                                .putString("today_logs", todayLogs.toString())
                                .putString("subjects", subjects.toString())
                                .apply();

                        showToast(context, "Attendance marked successfully!");

                        // Trigger widget update
                        new Handler(Looper.getMainLooper()).post(new Runnable() {
                            @Override
                            public void run() {
                                AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
                                int[] ids = appWidgetManager.getAppWidgetIds(new ComponentName(context, AttendanceWidgetProvider.class));
                                onUpdate(context, appWidgetManager, ids);
                            }
                        });

                    } catch (Exception e) {
                        Log.e(TAG, "Error updating local widget state: ", e);
                    }
                } else {
                    showToast(context, "Failed to mark attendance. Check internet.");
                }
            }
        }).start();
    }

    private boolean postAttendance(String supabaseUrl, String anonKey, String token, String email, String subjectId, String date, String status) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(supabaseUrl + "/rest/v1/daily_logs");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", anonKey);
            if (!token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            JSONObject body = new JSONObject();
            body.put("user_email", email);
            body.put("subject_id", subjectId);
            body.put("date", date);
            body.put("status", status);
            body.put("source", "manual");

            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            Log.d(TAG, "Post attendance status code: " + code);
            return (code >= 200 && code < 300);

        } catch (Exception e) {
            Log.e(TAG, "Network error posting attendance: ", e);
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String[] refreshSupabaseSession(String supabaseUrl, String anonKey, String refreshToken) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(supabaseUrl + "/auth/v1/token?grant_type=refresh_token");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", anonKey);
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            JSONObject body = new JSONObject();
            body.put("refresh_token", refreshToken);

            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            Log.d(TAG, "Token refresh response code: " + code);
            if (code >= 200 && code < 300) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
                br.close();

                JSONObject res = new JSONObject(sb.toString());
                String newAccess = res.getString("access_token");
                String newRefresh = res.getString("refresh_token");
                return new String[]{newAccess, newRefresh};
            }
            return null;

        } catch (Exception e) {
            Log.e(TAG, "Network error refreshing session: ", e);
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void showToast(final Context context, final String message) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
