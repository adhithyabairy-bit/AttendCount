import WidgetKit
import SwiftUI
import AppIntents

// MARK: - App Intent for Interactive Clicks (iOS 17+)
@available(iOS 16.0, *)
public struct MarkAttendanceIntent: AppIntent {
    public static var title: LocalizedStringResource = "Mark Attendance"
    public static var description = IntentDescription("Marks attendance for the current class in the background.")
    
    @Parameter(title: "Subject ID")
    var subjectId: String
    
    @Parameter(title: "Status")
    var status: String
    
    public init() {}
    
    public init(subjectId: String, status: String) {
        self.subjectId = subjectId
        self.status = status
    }
    
    public func perform() async throws -> some IntentResult {
        let prefs = UserDefaults(suiteName: "group.app.attendcount")
        guard let url = prefs?.string(forKey: "supabase_url"),
              let anonKey = prefs?.string(forKey: "supabase_anon_key"),
              let email = prefs?.string(forKey: "user_email") else {
            return .result()
        }
        
        let accessToken = prefs?.string(forKey: "access_token") ?? ""
        let refreshToken = prefs?.string(forKey: "refresh_token") ?? ""
        let todayYmd = getTodayYmd()
        
        // 1. Attempt to post
        var success = await postAttendance(supabaseUrl: url, anonKey: anonKey, token: accessToken, email: email, subjectId: subjectId, date: todayYmd, status: status)
        
        // 2. If unauthorized/expired, refresh token and retry
        if !success && !refreshToken.isEmpty {
            if let newTokens = await refreshSession(supabaseUrl: url, anonKey: anonKey, refreshToken: refreshToken) {
                prefs?.set(newTokens.access, forKey: "access_token")
                prefs?.set(newTokens.refresh, forKey: "refresh_token")
                
                // Retry post
                success = await postAttendance(supabaseUrl: url, anonKey: anonKey, token: newTokens.access, email: email, subjectId: subjectId, date: todayYmd, status: status)
            }
        }
        
        if success {
            // Update local preference cache so widget updates instantly
            if let logsStr = prefs?.string(forKey: "today_logs"),
               var logsObj = try? JSONSerialization.jsonObject(with: logsStr.data(using: .utf8)!, options: []) as? [String: String] {
                logsObj[subjectId] = status
                if let newLogsData = try? JSONSerialization.data(withJSONObject: logsObj),
                   let newLogsStr = String(data: newLogsData, encoding: .utf8) {
                    prefs?.set(newLogsStr, forKey: "today_logs")
                }
            } else {
                let initialLogs = [subjectId: status]
                if let newLogsData = try? JSONSerialization.data(withJSONObject: initialLogs),
                   let newLogsStr = String(data: newLogsData, encoding: .utf8) {
                    prefs?.set(newLogsStr, forKey: "today_logs")
                }
            }
            
            // Increment local realtime stats
            if let subStr = prefs?.string(forKey: "subjects"),
               var subList = try? JSONSerialization.jsonObject(with: subStr.data(using: .utf8)!, options: []) as? [[String: Any]] {
                for i in 0..<subList.count {
                    var sub = subList[i]
                    let subId = (sub["subject_id"] as? String) ?? (sub["id"] as? String) ?? ""
                    if subId == subjectId {
                        let weight = (sub["weight"] as? Int) ?? 1
                        let rtHeld = (sub["realtime_held"] as? Int) ?? 0
                        let rtAtt = (sub["realtime_attended"] as? Int) ?? 0
                        
                        sub["realtime_held"] = rtHeld + weight
                        if status.lowercased() == "present" {
                            sub["realtime_attended"] = rtAtt + weight
                        }
                        subList[i] = sub
                        break
                    }
                }
                if let newSubData = try? JSONSerialization.data(withJSONObject: subList),
                   let newSubStr = String(data: newSubData, encoding: .utf8) {
                    prefs?.set(newSubStr, forKey: "subjects")
                }
            }
            
            WidgetCenter.shared.reloadAllTimelines()
        }
        
        return .result()
    }
    
    private func getTodayYmd() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
    
    private func postAttendance(supabaseUrl: String, anonKey: String, token: String, email: String, subjectId: String, date: String, status: String) async -> Bool {
        guard let url = URL(string: "\(supabaseUrl)/rest/v1/daily_logs") else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        
        let body: [String: String] = [
            "user_email": email,
            "subject_id": subjectId,
            "date": date,
            "status": status,
            "source": "manual"
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode >= 200 && httpResponse.statusCode < 300
            }
        } catch {
            print("HTTP post error: \(error)")
        }
        return false
    }
    
    private func refreshSession(supabaseUrl: String, anonKey: String, refreshToken: String) async -> (access: String, refresh: String)? {
        guard let url = URL(string: "\(supabaseUrl)/auth/v1/token?grant_type=refresh_token") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        
        let body: [String: String] = ["refresh_token": refreshToken]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 {
                if let res = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let access = res["access_token"] as? String,
                   let refresh = res["refresh_token"] as? String {
                    return (access, refresh)
                }
            }
        } catch {}
        return nil
    }
}

// MARK: - Timeline Provider & Configuration
public struct AttendanceEntry: TimelineEntry {
    public let date: Date
    public let userEmail: String
    public let overallStats: String
    public let currentClassTitle: String
    public let currentClassTime: String
    public let currentClassId: String
    public let isMarked: Bool
    public let markedStatus: String
}

public struct AttendanceProvider: TimelineProvider {
    public func placeholder(in context: Context) -> AttendanceEntry {
        AttendanceEntry(date: Date(), userEmail: "demo@example.com", overallStats: "Overall: --%", currentClassTitle: "Loading Schedule", currentClassTime: "-- : --", currentClassId: "", isMarked: false, markedStatus: "")
    }

    public func getSnapshot(in context: Context, completion: @escaping (AttendanceEntry) -> ()) {
        completion(placeholder(in: context))
    }

    public func getTimeline(in context: Context, completion: @escaping (Timeline<AttendanceEntry>) -> ()) {
        let prefs = UserDefaults(suiteName: "group.app.attendcount")
        let userEmail = prefs?.string(forKey: "user_email") ?? "Not Logged In"
        let subjectsStr = prefs?.string(forKey: "subjects") ?? "[]"
        let slotsStr = prefs?.string(forKey: "slot_timings") ?? "[]"
        let todayLogsStr = prefs?.string(forKey: "today_logs") ?? "{}"
        
        var overallStats = "No Data"
        var classTitle = "No Classes Today"
        var classTimeStr = "Enjoy your day! 🎉"
        var classId = ""
        var isMarked = false
        var markedStatus = ""
        
        if userEmail != "Not Logged In", let subData = subjectsStr.data(using: .utf8) {
            let subjects = (try? JSONSerialization.jsonObject(with: subData) as? [[String: Any]]) ?? []
            let slots = (try? JSONSerialization.jsonObject(with: (slotsStr.data(using: .utf8) ?? Data())) as? [[String: String]]) ?? []
            let logs = (try? JSONSerialization.jsonObject(with: (todayLogsStr.data(using: .utf8) ?? Data())) as? [String: String]) ?? [:]
            
            // Overall Stats calculation
            var totalHeld = 0
            var totalAtt = 0
            for sub in subjects {
                let offHeld = (sub["official_held"] as? Int) ?? 0
                let offAtt = (sub["official_attended"] as? Int) ?? 0
                let rtHeld = (sub["realtime_held"] as? Int) ?? 0
                let rtAtt = (sub["realtime_attended"] as? Int) ?? 0
                
                totalHeld += (offHeld + rtHeld)
                totalAtt += (offAtt + rtAtt)
            }
            if totalHeld > 0 {
                overallStats = String(format: "Overall: %.1f%%", (Double(totalAtt) / Double(totalHeld)) * 100.0)
            } else {
                overallStats = "No Classes Held"
            }
            
            // Get today day name & time
            let date = Date()
            let dayFormatter = DateFormatter()
            dayFormatter.locale = Locale(identifier: "en_US")
            dayFormatter.dateFormat = "EEEE"
            let dayName = dayFormatter.string(from: date)
            
            let timeFormatter = DateFormatter()
            timeFormatter.dateFormat = "HH:mm"
            let currentTime = timeFormatter.string(from: date)
            
            // Find current/next class
            var bestNextSlotIndex = Int.max
            var nextClass: [String: Any]? = nil
            var nextClassTime = ""
            
            var currentClass: [String: Any]? = nil
            var currentClassTime = ""
            
            for sub in subjects {
                if let timetable = sub["timetable"] as? [String: [Int]] {
                    if let daySlots = timetable[dayName] {
                        for slotIdx in daySlots {
                            if slotIdx >= 0 && slotIdx < slots.count {
                                let slot = slots[slotIdx]
                                if let start = slot["start"], let end = slot["end"] {
                                    if currentTime >= start && currentTime <= end {
                                        currentClass = sub
                                        currentClassTime = "\(start) - \(end)"
                                    } else if currentTime < start && slotIdx < bestNextSlotIndex {
                                        bestNextSlotIndex = slotIdx
                                        nextClass = sub
                                        nextClassTime = "\(start) - \(end)"
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            var matchedClass: [String: Any]? = nil
            if let current = currentClass {
                matchedClass = current
                classTimeStr = currentClassTime
            } else if let next = nextClass {
                matchedClass = next
                classTimeStr = "Next: \(nextClassTime)"
            }
            
            if let c = matchedClass {
                classId = (c["subject_id"] as? String) ?? (c["id"] as? String) ?? ""
                let name = (c["subject_name"] as? String) ?? (c["name"] as? String) ?? ""
                let type = (c["subject_type"] as? String) ?? (c["type"] as? String) ?? ""
                classTitle = name + (type.lowercased() == "lab" ? " (Lab)" : "")
                
                if !classId.isEmpty && !logs[classId]!.isEmpty {
                    isMarked = true
                    markedStatus = logs[classId] ?? ""
                }
            }
        }
        
        let entry = AttendanceEntry(
            date: Date(),
            userEmail: userEmail,
            overallStats: overallStats,
            currentClassTitle: classTitle,
            currentClassTime: classTimeStr,
            currentClassId: classId,
            isMarked: isMarked,
            markedStatus: markedStatus
        )
        
        let timeline = Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(900))) // Update every 15 mins
        completion(timeline)
    }
}

// MARK: - SwiftUI Widget View
struct AttendanceWidgetEntryView: View {
    var entry: AttendanceProvider.Entry
    
    var body: some View {
        HStack(spacing: 12) {
            // Left Panel
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.date, style: .date)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                
                Text(entry.overallStats)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                
                Text(entry.userEmail)
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            
            // Divider
            Divider()
                .background(Color.gray.opacity(0.3))
                .padding(.vertical, 4)
            
            // Right Panel
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.currentClassTitle)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                
                Text(entry.currentClassTime)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                
                if !entry.currentClassId.isEmpty {
                    if entry.isMarked {
                        Text(entry.markedStatus.uppercased())
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(entry.markedStatus.lowercased() == "present" ? .green : .red)
                            .padding(.top, 4)
                    } else if #available(iOS 17.0, *) {
                        HStack(spacing: 8) {
                            Button(intent: MarkAttendanceIntent(subjectId: entry.currentClassId, status: "present")) {
                                Text("Present")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                            .buttonStyle(.plain)
                            .frame(height: 28)
                            .background(Color.green)
                            .cornerRadius(6)
                            
                            Button(intent: MarkAttendanceIntent(subjectId: entry.currentClassId, status: "absent")) {
                                Text("Absent")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                            .buttonStyle(.plain)
                            .frame(height: 28)
                            .background(Color.red)
                            .cornerRadius(6)
                        }
                        .padding(.top, 4)
                    } else {
                        Text("Open App to Mark")
                            .font(.system(size: 10))
                            .foregroundColor(.orange)
                            .padding(.top, 4)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(Color(red: 0.1, green: 0.12, blue: 0.17)) // Slate Dark background matching widget style
    }
}

// MARK: - Widget Definition
@main
struct AttendanceWidget: Widget {
    let kind: String = "AttendanceWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AttendanceProvider()) { entry in
            AttendanceWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("AttendCount Widget")
        .description("Track and mark your attendance directly from your home screen.")
        .supportedFamilies([.systemMedium]) // 4x2 equivalent size
    }
}
