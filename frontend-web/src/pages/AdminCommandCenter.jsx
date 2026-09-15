import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Globe2,
  Languages,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Siren,
  UserCheck,
  Users,
  Volume2,
  X,
  Wifi,
  WifiOff,
  Plus,
  Eye,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL = "http://localhost:8000/api";
const REPORTS_API_URL = `${API_BASE_URL}/hazard-reports`;
const REGIONS_API_URL = `${API_BASE_URL}/regions`;
const ADMIN_BASE_URL = `${API_BASE_URL}/admin`;

const STATUS_OPTIONS = [
  ["new", "New"],
  ["verifying", "Verifying"],
  ["prioritized", "Prioritized"],
  ["assigned", "Assigned"],
  ["responding", "Responding"],
  ["resolved", "Resolved"],
];

const PENDING_REJECT_REASONS = [
  ["false_positive", "False positive"],
  ["sensor_fault", "Sensor fault"],
  ["already_resolved", "Already resolved"],
  ["duplicate", "Duplicate"],
  ["other", "Other"],
];

function getToken() {
  return localStorage.getItem("afrishield_admin_token");
}

async function parseResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your admin session has expired. Please log in again.");
    }
    const detail = Array.isArray(data?.detail)
      ? data.detail.map((item) => item?.msg || "Invalid request").join(", ")
      : data?.detail || data?.message;
    throw new Error(detail || `Request failed with status ${response.status}.`);
  }
  return data;
}

async function adminFetch(path, options = {}) {
  const token = getToken();
  if (!token) throw new Error("Admin authentication token is missing.");

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${ADMIN_BASE_URL}${path}`, {
    ...options,
    headers,
  });
  return parseResponse(response);
}

function AdminCommandCenter({ onLoggedOut }) {
  const [reports, setReports] = useState([]);
  const [regions, setRegions] = useState([]);
  const [priorityIncidents, setPriorityIncidents] = useState([]);
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [pendingHistory, setPendingHistory] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceFocusLocation, setDeviceFocusLocation] = useState("");
  const [admins, setAdmins] = useState([]);

  const [loading, setLoading] = useState(true);
  const [regionsLoading, setRegionsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [priorityLoading, setPriorityLoading] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");

  const [dashboardStats, setDashboardStats] = useState({
    total_reports: 0,
    critical_or_high_priority: 0,
    assistance_needed: 0,
    resolved: 0,
    pending_alerts: 0,
    by_status: {},
  });

  const [error, setError] = useState("");
  const [regionsError, setRegionsError] = useState("");
  const [priorityError, setPriorityError] = useState("");
  const [pendingError, setPendingError] = useState("");
  const [devicesError, setDevicesError] = useState("");
  const [adminsError, setAdminsError] = useState("");
  const [actionError, setActionError] = useState("");

  const [selectedReport, setSelectedReport] = useState(null);
  const [activePanel, setActivePanel] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");

  const [responseMessage, setResponseMessage] = useState("");
  const [responseChannels, setResponseChannels] = useState({
    sms: true,
    voice: false,
    radio: false,
    community: true,
  });
  const [responseResults, setResponseResults] = useState([]);
  const [responseSending, setResponseSending] = useState(false);

  const [verificationNotes, setVerificationNotes] = useState("");
  const [assignmentTarget, setAssignmentTarget] = useState("");
  const [assignmentTeam, setAssignmentTeam] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");

  const [pendingEdit, setPendingEdit] = useState(null);
  const [pendingReject, setPendingReject] = useState(null);
  const [pendingActionError, setPendingActionError] = useState("");

  const [adminForm, setAdminForm] = useState({
    name: "",
    email: "",
    password: "",
    phone_number: "",
  });
  const [adminCreateMessage, setAdminCreateMessage] = useState("");
  const [adminCreateError, setAdminCreateError] = useState("");
  const [showNewAdminPassword, setShowNewAdminPassword] = useState(false);

  const formatDate = (value) => {
    if (!value) return "Unknown time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };

  const getSeverity = (report) => {
    const match = (report?.description || "").match(
      /Severity:\s*(Low|Medium|High|Critical)/i
    );
    return match ? match[1] : "Unknown";
  };

  const getPeopleAffected = (report) => {
    const match = (report?.description || "").match(
      /Estimated people affected:\s*(\d+)/i
    );
    return match ? Number(match[1]) || 0 : 0;
  };

  const getRegionForReport = useCallback(
    (report) => {
      const location = report?.location_name?.toLowerCase().trim();
      if (!location) return null;
      return (
        regions.find((region) => {
          const candidate = region?.location_name?.toLowerCase().trim();
          return (
            candidate &&
            (candidate === location ||
              candidate.startsWith(`${location},`) ||
              location.startsWith(`${candidate},`))
          );
        }) || null
      );
    },
    [regions]
  );

  const getRegionRisk = useCallback(
    (report) => {
      const region = getRegionForReport(report);
      if (!region) return { level: "Unknown", score: 0 };
      let score = Number(
        region.risk_score ?? region.risk_score_breakdown?.risk_score ?? 0
      );
      if (!Number.isFinite(score)) score = 0;
      if (score <= 1) score *= 100;
      return { level: region.risk_level || "Unknown", score: Math.round(score) };
    },
    [getRegionForReport]
  );

  const calculatePriority = useCallback(
    (report) => {
      let score = 0;
      const severity = getSeverity(report).toLowerCase();
      const severityPoints = { critical: 40, high: 30, medium: 20, low: 10, unknown: 5 };
      score += severityPoints[severity] || 5;

      const people = getPeopleAffected(report);
      if (people >= 500) score += 20;
      else if (people >= 200) score += 16;
      else if (people >= 100) score += 12;
      else if (people >= 50) score += 8;
      else if (people > 0) score += 4;

      if (report?.needs_assistance) score += 15;

      const regionalRisk = getRegionRisk(report);
      if (regionalRisk.level.toLowerCase() === "high") score += 15;
      else if (regionalRisk.level.toLowerCase() === "medium") score += 9;
      else if (regionalRisk.level.toLowerCase() === "low") score += 3;

      if (report?.has_photo) score += 5;

      if (report?.submitted_at) {
        const ageHours = (Date.now() - new Date(report.submitted_at).getTime()) / 3600000;
        if (ageHours <= 1) score += 5;
        else if (ageHours <= 6) score += 4;
        else if (ageHours <= 24) score += 2;
      }
      return Math.min(Math.round(score), 100);
    },
    [getRegionRisk]
  );

  const getPriorityLevel = (score) => {
    if (score >= 85) return "Critical";
    if (score >= 70) return "High";
    if (score >= 45) return "Medium";
    return "Low";
  };

  const getBackendPriority = useCallback(
    (report) => {
      const item = priorityIncidents.find((entry) => entry.id === report?.id);
      if (item) {
        const raw = Number(item.priority_score);
        const score = Number.isFinite(raw) ? Math.round(raw * 100) : calculatePriority(report);
        return { score, level: item.priority_level ? titleCase(item.priority_level) : getPriorityLevel(score), factors: item.factors || {} };
      }
      const score = calculatePriority(report);
      return { score, level: getPriorityLevel(score), factors: {} };
    },
    [priorityIncidents, calculatePriority]
  );

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch(REPORTS_API_URL);
      const data = await parseResponse(response);
      setReports(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to load community reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRegions = useCallback(async () => {
    try {
      setRegionsLoading(true);
      setRegionsError("");
      const response = await fetch(REGIONS_API_URL);
      const data = await parseResponse(response);
      setRegions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setRegionsError(err.message || "Unable to load regional intelligence.");
    } finally {
      setRegionsLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const data = await adminFetch("/dashboard/stats");
      setDashboardStats({
        total_reports: Number(data?.total_reports) || 0,
        critical_or_high_priority: Number(data?.critical_or_high_priority) || 0,
        assistance_needed: Number(data?.assistance_needed) || 0,
        resolved: Number(data?.resolved) || 0,
        pending_alerts: Number(data?.pending_alerts) || 0,
        by_status: data?.by_status || {},
      });
    } catch (err) {
      console.error(err);
      setActionError(err.message || "Unable to load dashboard statistics.");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchPriority = useCallback(async () => {
    try {
      setPriorityLoading(true);
      setPriorityError("");
      const data = await adminFetch("/incidents/prioritized");
      setPriorityIncidents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setPriorityError(err.message || "AI priority service unavailable. Using local fallback.");
    } finally {
      setPriorityLoading(false);
    }
  }, []);

  const fetchPendingAlerts = useCallback(async () => {
    try {
      setPendingLoading(true);
      setPendingError("");
      const data = await adminFetch("/alerts/pending");
      setPendingAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setPendingError(err.message || "Unable to load pending alerts.");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchPendingHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const data = await adminFetch("/alerts/pending/history");
      setPendingHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setPendingError(err.message || "Unable to load pending alert history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      setDevicesLoading(true);
      setDevicesError("");
      const data = await adminFetch("/devices");
      setDevices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setDevicesError(err.message || "Unable to load devices.");
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const fetchAdmins = useCallback(async () => {
    try {
      setAdminsLoading(true);
      setAdminsError("");
      const data = await adminFetch("/admins");
      setAdmins(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setAdminsError(err.message || "Unable to load admin accounts.");
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  const refreshEverything = useCallback(async () => {
    await Promise.all([
      fetchReports(),
      fetchRegions(),
      fetchStats(),
      fetchPriority(),
      fetchPendingAlerts(),
    ]);
  }, [fetchReports, fetchRegions, fetchStats, fetchPriority, fetchPendingAlerts]);

  useEffect(() => {
    refreshEverything();
  }, [refreshEverything]);

  useEffect(() => {
    if (activePanel === "devices") fetchDevices();
    if (activePanel === "admins") fetchAdmins();
    if (activePanel === "pending") fetchPendingHistory();
  }, [activePanel, fetchDevices, fetchAdmins, fetchPendingHistory]);

  const filteredReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return reports
      .filter((report) => {
        if (severityFilter !== "All" && getSeverity(report) !== severityFilter) return false;
        const priority = getBackendPriority(report).level;
        if (priorityFilter !== "All" && priority !== priorityFilter) return false;
        if (!query) return true;
        return [report.category, report.location_name, report.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => getBackendPriority(b).score - getBackendPriority(a).score);
  }, [reports, searchQuery, severityFilter, priorityFilter, getBackendPriority]);

  const assistanceReports = useMemo(
    () => reports.filter((report) => report.needs_assistance).sort((a, b) => getBackendPriority(b).score - getBackendPriority(a).score),
    [reports, getBackendPriority]
  );

  const mapReports = useMemo(
    () => reports.filter((report) => Number.isFinite(Number(report.latitude)) && Number.isFinite(Number(report.longitude))),
    [reports]
  );

  const statistics = {
    total: dashboardStats.total_reports,
    critical: dashboardStats.critical_or_high_priority,
    assistance: dashboardStats.assistance_needed,
    resolved: dashboardStats.resolved,
    pending: dashboardStats.pending_alerts,
  };

  const selectedPriority = selectedReport ? getBackendPriority(selectedReport) : { score: 0, level: "Low", factors: {} };

  const openReport = (report) => {
    setSelectedReport(report);
    setActivePanel("review");
    setActionError("");
    setVerificationNotes(report.verification_notes || "");
    setAssignmentTarget(report.assigned_to || "");
    setAssignmentTeam("");
    setAssignmentNotes("");
    setResponseResults([]);
    setResponseMessage(
      report.needs_assistance
        ? `Emergency assistance is required in ${report.location_name}. Please follow local responder instructions and move to a safe location if advised.`
        : `Flood risk has been reported in ${report.location_name}. Please avoid flooded roads and follow official safety instructions.`
    );
  };

  const updateSelectedReport = (updated) => {
    if (!updated?.id) return;
    setReports((previous) => previous.map((report) => (report.id === updated.id ? { ...report, ...updated } : report)));
    setSelectedReport((previous) => (previous?.id === updated.id ? { ...previous, ...updated } : previous));
  };

  const changeStatus = async (reportId, status) => {
    try {
      setActionLoading(`status:${reportId}`);
      setActionError("");
      const updated = await adminFetch(`/incidents/${reportId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      updateSelectedReport(updated);
      await Promise.all([fetchReports(), fetchStats(), fetchPriority()]);
    } catch (err) {
      setActionError(err.message || "Unable to update incident status.");
    } finally {
      setActionLoading("");
    }
  };

  const verifyReport = async (verified) => {
    if (!selectedReport) return;
    try {
      setActionLoading(`verify:${selectedReport.id}`);
      setActionError("");
      const updated = await adminFetch(`/incidents/${selectedReport.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ verified, notes: verificationNotes.trim() || undefined }),
      });
      updateSelectedReport(updated);
      await Promise.all([fetchReports(), fetchStats(), fetchPriority()]);
    } catch (err) {
      setActionError(err.message || "Unable to update verification.");
    } finally {
      setActionLoading("");
    }
  };

  const assignIncident = async (reportId, fallbackTeam = "") => {
    const target = assignmentTarget.trim() || fallbackTeam.trim();
    if (!target) {
      setActionError("Enter the responder or team to assign.");
      return;
    }
    try {
      setActionLoading(`assign:${reportId}`);
      setActionError("");
      const updated = await adminFetch(`/assistance-requests/${reportId}/assign`, {
        method: "POST",
        body: JSON.stringify({
          assigned_to: target,
          ...(assignmentTeam.trim() ? { team: assignmentTeam.trim() } : {}),
          ...(assignmentNotes.trim() ? { notes: assignmentNotes.trim() } : {}),
        }),
      });
      updateSelectedReport(updated);
      await Promise.all([fetchReports(), fetchStats()]);
    } catch (err) {
      setActionError(err.message || "Unable to assign response team.");
    } finally {
      setActionLoading("");
    }
  };

  const deriveRecipients = (report) => {
    const candidates = [
      report?.phone_number,
      report?.phone,
      report?.reporter_phone,
      report?.recipient_phone,
    ].filter(Boolean);
    return [...new Set(candidates.map(String))];
  };

  const sendResponses = async () => {
    if (!selectedReport || !responseMessage.trim()) return;
    const channels = Object.entries(responseChannels).filter(([, active]) => active).map(([key]) => key);
    if (!channels.length) return;

    const channelMap = { sms: "sms", voice: "voice", radio: "radio", community: "community_leader" };
    const recipients = deriveRecipients(selectedReport);

    try {
      setResponseSending(true);
      setActionError("");
      setResponseResults([]);
      const results = [];
      for (const channel of channels) {
        try {
          const data = await adminFetch(`/incidents/${selectedReport.id}/response`, {
            method: "POST",
            body: JSON.stringify({
              channel: channelMap[channel],
              message: responseMessage.trim(),
              recipients,
            }),
          });
          results.push({ channel: channelMap[channel], status: data?.status || "completed", data });
        } catch (err) {
          results.push({ channel: channelMap[channel], status: "failed", error: err.message });
        }
      }
      setResponseResults(results);
      await Promise.all([fetchReports(), fetchStats()]);
    } catch (err) {
      setActionError(err.message || "Unable to send community response.");
    } finally {
      setResponseSending(false);
    }
  };

  const approvePending = async (alertId, notes = "") => {
    try {
      setActionLoading(`approve:${alertId}`);
      setPendingActionError("");
      await adminFetch(`/alerts/${alertId}/approve`, {
        method: "POST",
        body: JSON.stringify(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setPendingEdit(null);
      await Promise.all([fetchPendingAlerts(), fetchStats(), fetchPendingHistory()]);
    } catch (err) {
      setPendingActionError(err.message || "Unable to approve alert.");
    } finally {
      setActionLoading("");
    }
  };

  const editAndSendPending = async () => {
    if (!pendingEdit?.message?.trim()) return;
    try {
      setActionLoading(`edit:${pendingEdit.id}`);
      setPendingActionError("");
      await adminFetch(`/alerts/${pendingEdit.id}/edit-and-send`, {
        method: "POST",
        body: JSON.stringify({
          message: pendingEdit.message.trim(),
          ...(pendingEdit.notes?.trim() ? { notes: pendingEdit.notes.trim() } : {}),
        }),
      });
      setPendingEdit(null);
      await Promise.all([fetchPendingAlerts(), fetchStats(), fetchPendingHistory()]);
    } catch (err) {
      setPendingActionError(err.message || "Unable to edit and send alert.");
    } finally {
      setActionLoading("");
    }
  };

  const rejectPending = async () => {
    if (!pendingReject?.reason) return;
    try {
      setActionLoading(`reject:${pendingReject.id}`);
      setPendingActionError("");
      await adminFetch(`/alerts/${pendingReject.id}/reject`, {
        method: "POST",
        body: JSON.stringify({
          reason: pendingReject.reason,
          ...(pendingReject.notes?.trim() ? { notes: pendingReject.notes.trim() } : {}),
        }),
      });
      setPendingReject(null);
      await Promise.all([fetchPendingAlerts(), fetchStats(), fetchPendingHistory()]);
    } catch (err) {
      setPendingActionError(err.message || "Unable to reject alert.");
    } finally {
      setActionLoading("");
    }
  };

  const createAdmin = async (event) => {
    event.preventDefault();
    setAdminCreateError("");
    setAdminCreateMessage("");
    if (!adminForm.name.trim() || !adminForm.email.trim() || !adminForm.password) {
      setAdminCreateError("Name, email and password are required.");
      return;
    }
    if (adminForm.password.length < 8) {
      setAdminCreateError("Password must be at least 8 characters.");
      return;
    }
    try {
      setActionLoading("create-admin");
      await adminFetch("/admins", {
        method: "POST",
        body: JSON.stringify({
          name: adminForm.name.trim(),
          email: adminForm.email.trim(),
          password: adminForm.password,
          ...(adminForm.phone_number.trim() ? { phone_number: adminForm.phone_number.trim() } : {}),
        }),
      });
      setAdminForm({ name: "", email: "", password: "", phone_number: "" });
      setAdminCreateMessage("Admin account created. They must log in themselves; no session was created for them.");
      await fetchAdmins();
    } catch (err) {
      setAdminCreateError(err.message || "Unable to create admin account.");
    } finally {
      setActionLoading("");
    }
  };

  const logout = async () => {
    try {
      setActionLoading("logout");
      const token = getToken();
      if (token) {
        await fetch(`${ADMIN_BASE_URL}/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      localStorage.removeItem("afrishield_admin_token");
      localStorage.removeItem("afrishield_admin_user");
      localStorage.removeItem("afrishield_admin_logged_in");
      localStorage.removeItem("afrishield_admin_account");
      if (onLoggedOut) onLoggedOut();
    }
  };

  return (
    <main className="min-h-screen bg-slate-50/70 px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
              <p className="text-[10px] font-extrabold uppercase tracking-[1.7px] text-blue-600">AFRISHIELD OPERATIONS</p>
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Admin Command Center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">A unified emergency operations view for community reports, AI-assisted prioritization, operator-reviewed alerts, sensor intelligence and last-mile response.</p>
          </div>
          <div className="flex flex-wrap gap-2 self-start lg:self-auto">
            <button type="button" onClick={refreshEverything} disabled={loading || statsLoading || pendingLoading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50">
              <RefreshCw size={15} className={loading || statsLoading || pendingLoading ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={logout} disabled={actionLoading === "logout"} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-100 bg-white px-4 text-xs font-bold text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <StatusPill label="REPORTS API" active={!error} />
          <StatusPill label="REGIONAL INTELLIGENCE" active={!regionsError} />
          <StatusPill label="AI TRIAGE" active={!priorityError} />
          <StatusPill label="PENDING ALERTS" active={!pendingError} />
          <span className="ml-auto text-[10px] font-semibold text-slate-400">{formatDate(new Date().toISOString())}</span>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 p-6 text-white shadow-lg shadow-blue-100">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2"><Siren size={18} /><p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-blue-100">EMERGENCY OPERATIONS</p></div>
              <h2 className="mt-3 text-xl font-extrabold sm:text-2xl">From community signal to coordinated response.</h2>
              <p className="mt-2 text-sm leading-6 text-blue-100">AI proposes. Operators review. Response teams act. AfriShield keeps a clear operational trail from detection to resolution.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <BannerMetric value={statistics.total} label="Reports" />
              <BannerMetric value={statistics.critical} label="Critical" />
              <BannerMetric value={statistics.assistance} label="Assistance" />
              <BannerMetric value={statistics.pending} label="Pending" danger />
              <BannerMetric value={statistics.resolved} label="Resolved" />
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard icon={<ClipboardList size={21} />} label="Total Reports" value={statistics.total} iconStyle="bg-blue-50 text-blue-600" />
          <StatCard icon={<ShieldAlert size={21} />} label="High/Critical" value={statistics.critical} iconStyle="bg-red-50 text-red-600" />
          <StatCard icon={<Users size={21} />} label="Assistance" value={statistics.assistance} iconStyle="bg-indigo-50 text-indigo-600" />
          <StatCard icon={<BellRing size={21} />} label="Pending Alerts" value={statistics.pending} iconStyle="bg-orange-50 text-orange-600" />
          <StatCard icon={<CheckCircle2 size={21} />} label="Resolved" value={statistics.resolved} iconStyle="bg-emerald-50 text-emerald-600" />
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex min-w-max gap-1">
            <CommandTab active={activePanel === "overview"} onClick={() => setActivePanel("overview")} icon={<ClipboardList size={15} />} label="Priority Queue" />
            <CommandTab active={activePanel === "pending"} onClick={() => setActivePanel("pending")} icon={<BellRing size={15} />} label="Pending Alerts" badge={statistics.pending} />
            <CommandTab active={activePanel === "map"} onClick={() => setActivePanel("map")} icon={<Navigation size={15} />} label="Incident Map" />
            <CommandTab active={activePanel === "devices"} onClick={() => setActivePanel("devices")} icon={<Wifi size={15} />} label="Devices" />
            <CommandTab active={activePanel === "assistance"} onClick={() => setActivePanel("assistance")} icon={<Users size={15} />} label="Assistance" />
            <CommandTab active={activePanel === "response"} onClick={() => setActivePanel("response")} icon={<BellRing size={15} />} label="Response Center" />
            <CommandTab active={activePanel === "admins"} onClick={() => setActivePanel("admins")} icon={<UserCheck size={15} />} label="Manage Admins" />
          </div>
        </div>

        {activePanel === "pending" && (
          <PendingAlertsPanel
            alerts={pendingAlerts}
            history={pendingHistory}
            loading={pendingLoading}
            historyLoading={historyLoading}
            error={pendingError}
            actionError={pendingActionError}
            actionLoading={actionLoading}
            onApprove={approvePending}
            onEdit={(alert) => setPendingEdit({ ...alert, message: alert.message || `Flood warning for ${alert.location_name}. Please follow official safety instructions.`, notes: "" })}
            onReject={(alert) => setPendingReject({ ...alert, reason: "", notes: "" })}
            onRefresh={() => Promise.all([fetchPendingAlerts(), fetchPendingHistory(), fetchStats()])}
            onViewDevice={(alert) => {
              setDeviceFocusLocation(alert.location_name || "");
              setActivePanel("devices");
              fetchDevices();
            }}
          />
        )}

        {activePanel === "overview" && (
          <PriorityQueue
            reports={filteredReports}
            loading={loading}
            error={error}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            severityFilter={severityFilter}
            setSeverityFilter={setSeverityFilter}
            priorityFilter={priorityFilter}
            setPriorityFilter={setPriorityFilter}
            getBackendPriority={getBackendPriority}
            getRegionRisk={getRegionRisk}
            getSeverity={getSeverity}
            getPeopleAffected={getPeopleAffected}
            formatDate={formatDate}
            openReport={openReport}
            priorityLoading={priorityLoading}
          />
        )}

        {activePanel === "map" && <IncidentMap reports={mapReports} allReports={reports} onOpenReport={openReport} getBackendPriority={getBackendPriority} />}
        {activePanel === "devices" && <DevicesPanel devices={devices} loading={devicesLoading} error={devicesError} onRefresh={fetchDevices} focusLocation={deviceFocusLocation} />}
        {activePanel === "assistance" && <AssistancePanel reports={assistanceReports} getBackendPriority={getBackendPriority} getPeopleAffected={getPeopleAffected} onOpenReport={openReport} onAssign={(report) => { openReport(report); }} />}
        {activePanel === "response" && <ResponseCenter selectedReport={selectedReport} responseMessage={responseMessage} setResponseMessage={setResponseMessage} responseChannels={responseChannels} setResponseChannels={setResponseChannels} onSend={sendResponses} sending={responseSending} results={responseResults} onChooseIncident={() => setActivePanel("overview")} />}
        {activePanel === "admins" && <ManageAdminsPanel admins={admins} loading={adminsLoading} error={adminsError} form={adminForm} setForm={setAdminForm} onSubmit={createAdmin} createMessage={adminCreateMessage} createError={adminCreateError} loadingAction={actionLoading === "create-admin"} showPassword={showNewAdminPassword} setShowPassword={setShowNewAdminPassword} onRefresh={fetchAdmins} />}

        {activePanel !== "pending" && activePanel !== "review" && activePanel !== "devices" && activePanel !== "admins" && activePanel !== "response" && (
          <Workflow />
        )}

        {selectedReport && (
          <ReviewModal
            report={selectedReport}
            priority={selectedPriority}
            formatDate={formatDate}
            getSeverity={getSeverity}
            getPeopleAffected={getPeopleAffected}
            getRegionRisk={getRegionRisk}
            verificationNotes={verificationNotes}
            setVerificationNotes={setVerificationNotes}
            assignmentTarget={assignmentTarget}
            setAssignmentTarget={setAssignmentTarget}
            assignmentTeam={assignmentTeam}
            setAssignmentTeam={setAssignmentTeam}
            assignmentNotes={assignmentNotes}
            setAssignmentNotes={setAssignmentNotes}
            responseMessage={responseMessage}
            setResponseMessage={setResponseMessage}
            responseChannels={responseChannels}
            setResponseChannels={setResponseChannels}
            responseResults={responseResults}
            responseSending={responseSending}
            onSendResponse={sendResponses}
            onClose={() => setSelectedReport(null)}
            onStatusChange={changeStatus}
            onVerify={verifyReport}
            onAssign={assignIncident}
            actionLoading={actionLoading}
            actionError={actionError}
            onOpenResponse={() => setActivePanel("response")}
          />
        )}

        {pendingEdit && <EditPendingModal value={pendingEdit} setValue={setPendingEdit} onClose={() => setPendingEdit(null)} onSubmit={editAndSendPending} loading={actionLoading === `edit:${pendingEdit.id}`} />}
        {pendingReject && <RejectPendingModal value={pendingReject} setValue={setPendingReject} onClose={() => setPendingReject(null)} onSubmit={rejectPending} loading={actionLoading === `reject:${pendingReject.id}`} />}
      </section>
    </main>
  );
}

function PendingAlertsPanel({ alerts, history, loading, historyLoading, error, actionError, actionLoading, onApprove, onEdit, onReject, onRefresh, onViewDevice }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const countdown = (value) => {
    const remaining = Math.max(0, new Date(value).getTime() - now);
    const total = Math.floor(remaining / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  };

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
      <div className="border-b border-orange-100 bg-orange-50/70 px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><BellRing size={19} /></div>
            <div><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-orange-600">OPERATOR REVIEW GATE</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">Pending Alerts</h2><p className="mt-1 text-xs leading-5 text-slate-500">AI-generated alerts wait for human review before sending. If nobody acts, the backend fail-open timer sends them after 15 minutes.</p></div>
          </div>
          <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-extrabold text-slate-600 hover:bg-slate-50"><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      {(error || actionError) && <div className="m-5 rounded-xl border border-red-100 bg-red-50 p-4 text-xs font-semibold text-red-700">{error || actionError}</div>}

      {loading ? <LoadingState label="Loading pending alerts..." /> : alerts.length === 0 ? <EmptyState icon={<CheckCircle2 size={26} />} title="No alerts awaiting review" description="The operator review queue is clear." /> : (
        <div className="divide-y divide-slate-100">
          {alerts.map((alert) => (
            <div key={alert.id} className="p-5 sm:p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-extrabold text-slate-800">{alert.location_name}</h3><span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-extrabold uppercase text-red-600">{alert.risk_level || "risk"}</span><span className="rounded-full bg-orange-100 px-2.5 py-1 text-[9px] font-extrabold uppercase text-orange-700">PENDING</span></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4"><MiniMetric label="Risk score" value={`${Math.round(Number(alert.risk_score || 0) * 100)}%`} /><MiniMetric label="Rainfall / 24h" value={`${alert.rainfall_mm_24h ?? "—"} mm`} /><MiniMetric label="River level" value={`${alert.river_level_m ?? "—"} m`} /><MiniMetric label="Created" value={formatShortDate(alert.created_at)} /></div>
                  <div className="mt-4 flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[10px] font-extrabold text-red-700"><Clock3 size={13} /> Auto-sends in {countdown(alert.auto_send_at)}</span><span className="text-[9px] font-semibold text-slate-400">Auto-send: {formatShortDate(alert.auto_send_at)}</span></div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 xl:w-[390px]">
                  <button type="button" disabled={Boolean(actionLoading)} onClick={() => onApprove(alert.id)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-[10px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={14} /> Approve</button>
                  <button type="button" disabled={Boolean(actionLoading)} onClick={() => onEdit(alert)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-[10px] font-extrabold text-white hover:bg-blue-700 disabled:opacity-50"><Eye size={14} /> Edit & Send</button>
                  <button type="button" disabled={Boolean(actionLoading)} onClick={() => onReject(alert)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-[10px] font-extrabold text-red-600 hover:bg-red-50 disabled:opacity-50"><X size={14} /> Reject</button>
                  <button type="button" onClick={() => onViewDevice(alert)} className="sm:col-span-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-extrabold text-slate-600 hover:bg-slate-50"><Wifi size={13} /> View sensor / device status</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-slate-100 bg-slate-50/60 p-5 sm:p-6">
        <div className="flex items-center justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-slate-400">AUDIT TRAIL</p><h3 className="mt-1 text-lg font-extrabold text-slate-900">Pending Alert History</h3></div><span className="rounded-full bg-white px-3 py-1.5 text-[9px] font-extrabold text-slate-500 ring-1 ring-slate-200">{history.length} records</span></div>
        {historyLoading ? <div className="mt-4 text-xs font-semibold text-slate-400">Loading history...</div> : history.length === 0 ? <p className="mt-4 text-xs text-slate-400">No previous pending alerts are available.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead><tr className="border-b border-slate-200 text-[9px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2">Region</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reviewed by</th><th className="px-3 py-2">Reviewed at</th><th className="px-3 py-2">Reason</th></tr></thead><tbody>{history.map((item) => <tr key={item.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 text-xs font-bold text-slate-700">{item.location_name}</td><td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-extrabold uppercase text-slate-600">{item.status}</span></td><td className="px-3 py-3 text-[10px] text-slate-500">{item.reviewed_by || "Auto / system"}</td><td className="px-3 py-3 text-[10px] text-slate-500">{formatShortDate(item.reviewed_at)}</td><td className="px-3 py-3 text-[10px] text-slate-500">{item.reject_reason || item.review_notes || "—"}</td></tr>)}</tbody></table></div>}
      </div>
    </section>
  );
}

function PriorityQueue({ reports, loading, error, searchQuery, setSearchQuery, severityFilter, setSeverityFilter, priorityFilter, setPriorityFilter, getBackendPriority, getRegionRisk, getSeverity, getPeopleAffected, formatDate, openReport, priorityLoading }) {
  return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-6 py-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600"><ShieldAlert size={18} /></div><div><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-red-500">AI-ASSISTED TRIAGE</p><h2 className="mt-0.5 text-xl font-extrabold text-slate-900">Priority Incident Queue</h2></div></div><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">Backend priority scoring is the source of truth when available, with transparent frontend fallback when the service is unavailable.</p></div><div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3"><p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">PRIORITIZATION ENGINE</p><p className="mt-1 text-xs font-bold text-blue-800">{priorityLoading ? "Syncing AI triage..." : "Operational scoring active"}</p></div></div></div>
    <div className="border-b border-slate-100 bg-slate-50/60 p-4"><div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search reports, locations or descriptions..." className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"/></div><select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none"><option>All</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none"><option>All</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select></div></div>
    {error && <div className="m-5 rounded-xl border border-red-100 bg-red-50 p-4 text-xs font-semibold text-red-700">{error}</div>}
    {loading ? <LoadingState label="Loading emergency intelligence..." /> : reports.length === 0 ? <EmptyState icon={<ClipboardList size={26}/>} title="No matching incidents" description="Community reports matching your filters will appear here."/> : <div className="divide-y divide-slate-100">{reports.map((report) => { const p = getBackendPriority(report); const styles = getPriorityStyles(p.level); const risk = getRegionRisk(report); return <div key={report.id} className="p-5 transition hover:bg-slate-50 sm:p-6"><div className="flex flex-col gap-5 xl:flex-row xl:items-center"><div className="flex min-w-0 flex-1 gap-4"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}><Siren size={19}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-extrabold text-slate-800">{report.category || "Hazard Report"}</h3><span className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold uppercase ${styles.badge}`}>{p.level}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-extrabold uppercase text-slate-500">{titleCase(report.status || "new")}</span>{report.needs_assistance && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-extrabold uppercase text-red-600">Assistance</span>}</div><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400"><span className="inline-flex items-center gap-1"><MapPin size={12}/>{report.location_name || "Unknown location"}</span><span className="inline-flex items-center gap-1"><Clock3 size={12}/>{formatDate(report.submitted_at)}</span><span className="inline-flex items-center gap-1"><Users size={12}/>{getPeopleAffected(report) || "Unknown"} affected</span></div><div className="mt-4 grid gap-3 sm:grid-cols-4"><MiniMetric label="AI Priority" value={`${p.score}/100`}/><MiniMetric label="Severity" value={getSeverity(report)}/><MiniMetric label="Regional Risk" value={risk.level}/><MiniMetric label="Evidence" value={report.has_photo ? "Attached" : "None"}/></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${styles.bar}`} style={{width:`${p.score}%`}}/></div></div></div><button type="button" onClick={() => openReport(report)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[10px] font-extrabold text-white hover:bg-blue-700">Review <ChevronRight size={13}/></button></div></div>; })}</div>}
  </section>;
}

function AssistancePanel({ reports, getBackendPriority, getPeopleAffected, onOpenReport }) {
  return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-red-500">HUMANITARIAN RESPONSE</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">Assistance Coordination</h2><p className="mt-1 text-xs leading-5 text-slate-400">Community reports where people have explicitly requested assistance, ranked using backend priority when available.</p></div>{reports.length === 0 ? <EmptyState icon={<CheckCircle2 size={26}/>} title="No assistance requests" description="Reports requesting assistance will appear here."/> : <div className="divide-y divide-slate-100">{reports.map((report) => {const p=getBackendPriority(report); return <div key={report.id} className="p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><Users size={19}/></div><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-extrabold text-slate-800">{report.category || "Emergency assistance"}</h3><span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-extrabold uppercase text-red-600">{p.level}</span></div><div className="mt-2 flex flex-wrap gap-4 text-[10px] text-slate-400"><span className="inline-flex items-center gap-1"><MapPin size={12}/>{report.location_name}</span><span className="inline-flex items-center gap-1"><Users size={12}/>{getPeopleAffected(report) || "Unknown"} affected</span></div><p className="mt-3 max-w-2xl whitespace-pre-line text-xs leading-5 text-slate-500">{report.description || "No description provided."}</p></div></div><button type="button" onClick={()=>onOpenReport(report)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[10px] font-extrabold text-white hover:bg-blue-700">Open incident</button></div></div>})}</div>}</section>;
}

function DevicesPanel({ devices, loading, error, onRefresh, focusLocation }) {
  return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">LIVE SENSOR NETWORK</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">Devices & Sensors</h2><p className="mt-1 text-xs leading-5 text-slate-400">Inspect the live device behind a risk signal: status, latest rainfall, river level, risk and timestamp.</p></div><button type="button" onClick={onRefresh} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-extrabold text-slate-600 hover:bg-slate-50"><RefreshCw size={13}/> Refresh</button></div>{error && <div className="m-5 rounded-xl bg-red-50 p-4 text-xs font-semibold text-red-700">{error}</div>}{loading ? <LoadingState label="Loading registered sensors..."/> : devices.length===0 ? <EmptyState icon={<WifiOff size={26}/>} title="No registered devices" description="The backend returned no sensor records."/> : <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{devices.map((device)=><DeviceCard key={device.device_id} device={device} focused={Boolean(focusLocation && device.location_name?.toLowerCase().trim() === focusLocation.toLowerCase().trim())}/>)}</div>}</section>;
}

function DeviceCard({device,focused}) { const reading=device.last_reading; const online=device.status==="online"; return <article className={`rounded-2xl border bg-white p-5 shadow-sm ${focused ? "border-blue-500 ring-4 ring-blue-50" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">DEVICE</p><h3 className="mt-1 text-sm font-extrabold text-slate-800">{device.device_id}</h3></div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase ${online?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-500"}`}>{online?<Wifi size={11}/>:<WifiOff size={11}/>} {device.status}</span></div><div className="mt-4 flex items-start gap-2 text-xs font-bold text-slate-700"><MapPin size={14} className="mt-0.5 text-blue-600"/>{device.location_name}</div>{reading ? <div className="mt-4 grid grid-cols-2 gap-2"><MiniMetric label="Rainfall / 24h" value={`${reading.rainfall_mm_24h ?? "—"} mm`}/><MiniMetric label="River level" value={`${reading.river_level_m ?? "—"} m`}/><MiniMetric label="Risk" value={reading.risk_level || "Unknown"}/><MiniMetric label="Score" value={`${Math.round(Number(reading.risk_score||0)*100)}%`}/></div> : <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[10px] font-semibold text-slate-400">No reading has been reported yet.</div>}<p className="mt-4 text-[9px] font-semibold text-slate-400">Last reading: {formatShortDate(reading?.received_at)}</p></article>; }

function ResponseCenter({ selectedReport, responseMessage, setResponseMessage, responseChannels, setResponseChannels, onSend, sending, results, onChooseIncident }) {
  const toggle=(channel)=>setResponseChannels((prev)=>({...prev,[channel]:!prev[channel]}));
  return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><BellRing size={19}/></div><div><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">LAST-MILE RESPONSE</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">Response Center</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Send a real response through the backend. The dashboard reports the backend result honestly as sent, simulated, no recipients or failed.</p></div></div></div><div className="grid lg:grid-cols-[1fr_0.75fr]">{!selectedReport?<div className="p-6"><div className="rounded-xl border border-amber-100 bg-amber-50 p-4"><p className="text-xs font-extrabold text-amber-700">Select an incident first</p><p className="mt-1 text-[10px] leading-5 text-amber-600">Open an incident from the Priority Queue, then return here to send a targeted warning.</p><button type="button" onClick={onChooseIncident} className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-extrabold text-white">Open priority queue</button></div></div>:<div className="space-y-5 p-6"><div className="rounded-xl bg-slate-50 p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">TARGET INCIDENT</p><p className="mt-1 text-sm font-extrabold text-slate-800">{selectedReport.location_name}</p></div><div><div className="flex items-center justify-between"><label className="text-xs font-extrabold text-slate-700">Emergency message</label><span className="text-[9px] font-bold text-slate-400">{responseMessage.length} characters</span></div><textarea value={responseMessage} onChange={(e)=>setResponseMessage(e.target.value)} rows={7} className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" placeholder="Write the warning that should reach the community..."/></div><div><p className="text-xs font-extrabold text-slate-700">Delivery channels</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><ChannelButton active={responseChannels.sms} onClick={()=>toggle("sms")} icon={<MessageSquare size={16}/>} label="SMS" description="Mobile text alert"/><ChannelButton active={responseChannels.voice} onClick={()=>toggle("voice")} icon={<Volume2 size={16}/>} label="Voice" description="Accessible voice warning"/><ChannelButton active={responseChannels.radio} onClick={()=>toggle("radio")} icon={<Radio size={16}/>} label="Radio" description="Simulated local broadcast"/><ChannelButton active={responseChannels.community} onClick={()=>toggle("community")} icon={<Users size={16}/>} label="Community leaders" description="Simulated trusted local network"/></div></div><button type="button" onClick={onSend} disabled={sending || !responseMessage.trim() || !Object.values(responseChannels).some(Boolean)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50"><Send size={16}/>{sending?"Sending response...":"Send Community Warning"}</button>{results.length>0&&<div className="space-y-2">{results.map((result,index)=><div key={`${result.channel}-${index}`} className={`rounded-xl border p-3 ${result.status==="failed"?"border-red-100 bg-red-50":"border-emerald-100 bg-emerald-50"}`}><p className={`text-[10px] font-extrabold uppercase ${result.status==="failed"?"text-red-700":"text-emerald-700"}`}>{result.channel}: {result.status}</p>{result.error&&<p className="mt-1 text-[10px] text-red-600">{result.error}</p>}</div>)}</div>}</div>}<div className="border-t border-slate-100 bg-slate-50/60 p-6 lg:border-l lg:border-t-0"><div className="flex items-center gap-2"><Languages size={16} className="text-indigo-600"/><p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-indigo-600">MESSAGE PREVIEW</p></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="bg-blue-600 px-4 py-3 text-white"><span className="text-[10px] font-extrabold">AFRISHIELD ALERT</span></div><div className="p-5"><p className="text-xs font-extrabold text-slate-800">{selectedReport?.location_name || "Select an incident"}</p><p className="mt-3 text-xs leading-6 text-slate-600">{responseMessage||"Your emergency warning will appear here."}</p></div></div><div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4"><p className="text-[10px] leading-5 text-indigo-700">Language override is intentionally not shown here because the current backend response endpoint does not accept a language field. Type the message in the language you intend to send.</p></div></div></div></section>;
}

function ManageAdminsPanel({admins,loading,error,form,setForm,onSubmit,createMessage,createError,loadingAction,showPassword,setShowPassword,onRefresh}) { return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">ACCESS CONTROL</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">Manage Admins</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Public signup has been removed. Authenticated admins create additional accounts here; the invited admin logs in separately.</p></div><div className="grid lg:grid-cols-[0.9fr_1.1fr]"><form onSubmit={onSubmit} className="space-y-4 border-b border-slate-100 p-6 lg:border-b-0 lg:border-r"><h3 className="text-sm font-extrabold text-slate-800">Create administrator</h3><AdminInput label="Full name" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} placeholder="e.g. Amina Hassan"/><AdminInput label="Email address" type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} placeholder="admin@example.com"/><AdminInput label="Phone number" value={form.phone_number} onChange={(e)=>setForm({...form,phone_number:e.target.value})} placeholder="+254..."/><div><label className="mb-2 block text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Password</label><div className="relative"><input type={showPassword?"text":"password"} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} placeholder="Minimum 8 characters" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"/><button type="button" onClick={()=>setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><Eye size={16}/></button></div></div>{createError&&<div className="rounded-xl bg-red-50 p-3 text-[10px] font-semibold text-red-700">{createError}</div>}{createMessage&&<div className="rounded-xl bg-emerald-50 p-3 text-[10px] font-semibold leading-5 text-emerald-700">{createMessage}</div>}<button type="submit" disabled={loadingAction} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50"><Plus size={15}/>{loadingAction?"Creating...":"Create Admin"}</button></form><div className="p-6"><div className="flex items-center justify-between"><div><h3 className="text-sm font-extrabold text-slate-800">Existing administrators</h3><p className="mt-1 text-[10px] text-slate-400">Phone numbers are used for pending-alert SMS notifications.</p></div><button type="button" onClick={onRefresh} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><RefreshCw size={14}/></button></div>{error&&<div className="mt-4 rounded-xl bg-red-50 p-3 text-[10px] font-semibold text-red-700">{error}</div>}{loading?<LoadingState label="Loading admin accounts..."/>:admins.length===0?<EmptyState icon={<Users size={25}/>} title="No admin accounts returned" description="Check the authenticated admin API."/>:<div className="mt-5 space-y-2">{admins.map((admin)=><div key={admin.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-extrabold text-slate-800">{admin.name}</p><p className="mt-1 text-[10px] text-slate-500">{admin.email}</p></div><div className="text-left sm:text-right"><p className="text-[10px] font-bold text-slate-600">{admin.phone_number||"No phone on file"}</p><p className="mt-1 text-[9px] text-slate-400">Created {formatShortDate(admin.created_at)}</p></div></div>)}</div>}</div></div></section>; }

function ReviewModal({report,priority,formatDate,getSeverity,getPeopleAffected,getRegionRisk,verificationNotes,setVerificationNotes,assignmentTarget,setAssignmentTarget,assignmentTeam,setAssignmentTeam,assignmentNotes,setAssignmentNotes,responseMessage,setResponseMessage,responseChannels,setResponseChannels,responseResults,responseSending,onSendResponse,onClose,onStatusChange,onVerify,onAssign,actionLoading,actionError,onOpenResponse}) { const toggle=(key)=>setResponseChannels((prev)=>({...prev,[key]:!prev[key]})); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">INCIDENT COMMAND</p><h2 className="mt-1 text-lg font-extrabold text-slate-900">{report.category||"Hazard Report"}</h2></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"><X size={18}/></button></div><div className="grid lg:grid-cols-[1fr_0.9fr]"><div className="space-y-5 p-6"><div className="rounded-2xl border border-red-100 bg-red-50 p-5"><div className="flex items-center justify-between"><div><p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-red-500">BACKEND AI PRIORITY</p><p className="mt-1 text-3xl font-extrabold text-red-700">{priority.score}<span className="ml-1 text-sm text-red-400">/100</span></p></div><span className="rounded-full bg-white px-3 py-2 text-[9px] font-extrabold uppercase text-red-600">{priority.level}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-red-500" style={{width:`${priority.score}%`}}/></div>{Object.keys(priority.factors).length>0&&<div className="mt-4 space-y-1.5">{Object.entries(priority.factors).map(([key,value])=><div key={key} className="rounded-lg bg-white/70 p-2 text-[9px] text-red-700"><span className="font-extrabold">{titleCase(key)}:</span> {String(value)}</div>)}</div>}</div><div className="grid gap-3 sm:grid-cols-2"><DetailBox icon={<MapPin size={16}/>} label="Location" value={report.location_name||"Unknown"}/><DetailBox icon={<Clock3 size={16}/>} label="Submitted" value={formatDate(report.submitted_at)}/><DetailBox icon={<AlertTriangle size={16}/>} label="Severity" value={getSeverity(report)}/><DetailBox icon={<Users size={16}/>} label="People affected" value={getPeopleAffected(report)||"Not specified"}/></div><div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">REGIONAL INTELLIGENCE</p><p className="mt-1 text-sm font-extrabold text-blue-900">{getRegionRisk(report).level} flood-risk region</p><p className="mt-1 text-[10px] text-blue-700">Regional risk score: {getRegionRisk(report).score}/100</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">COMMUNITY REPORT</p><p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{report.description||"No description provided."}</p></div>{report.has_photo&&<div className="overflow-hidden rounded-xl border border-slate-200"><img src={`${REPORTS_API_URL}/${report.id}/photo`} alt="Community hazard evidence" className="max-h-[420px] w-full object-cover"/></div>}</div><div className="border-t border-slate-100 bg-slate-50/60 p-6 lg:border-l lg:border-t-0"><p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">OPERATOR ACTIONS</p>{actionError&&<div className="mt-3 rounded-xl bg-red-50 p-3 text-[10px] font-semibold text-red-700">{actionError}</div>}<div className="mt-3 rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-extrabold text-slate-700">Incident status</p><select value={report.status||"new"} onChange={(e)=>onStatusChange(report.id,e.target.value)} disabled={Boolean(actionLoading)} className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">{STATUS_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div className="mt-5 rounded-xl border border-slate-200 bg-white p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">VERIFICATION</p><textarea value={verificationNotes} onChange={(e)=>setVerificationNotes(e.target.value)} rows={3} placeholder="Optional verification notes" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500"/><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(actionLoading)} onClick={()=>onVerify(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-[10px] font-extrabold text-white hover:bg-emerald-700"><ClipboardCheck size={14}/> Verify</button><button type="button" disabled={Boolean(actionLoading)} onClick={()=>onVerify(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[10px] font-extrabold text-slate-600 hover:bg-slate-50">Reject evidence</button></div></div><div className="mt-5 rounded-xl border border-slate-200 bg-white p-4"><p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">RESPONSE ASSIGNMENT</p><input value={assignmentTarget} onChange={(e)=>setAssignmentTarget(e.target.value)} placeholder="Responder / team name" className="mt-3 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-blue-500"/><input value={assignmentTeam} onChange={(e)=>setAssignmentTeam(e.target.value)} placeholder="Team type (optional)" className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-blue-500"/><textarea value={assignmentNotes} onChange={(e)=>setAssignmentNotes(e.target.value)} rows={2} placeholder="Assignment notes (optional)" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500"/><button type="button" disabled={Boolean(actionLoading)} onClick={()=>onAssign(report.id)} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-[10px] font-extrabold text-white hover:bg-blue-700"><UserCheck size={14}/> Assign response</button></div><div className="mt-5 rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">RESPONSE CENTER</p><button type="button" onClick={onOpenResponse} className="text-[9px] font-extrabold text-blue-600">Expand</button></div><textarea value={responseMessage} onChange={(e)=>setResponseMessage(e.target.value)} rows={4} className="mt-3 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 outline-none focus:border-blue-500"/><div className="mt-2 grid grid-cols-2 gap-2"><MiniToggle active={responseChannels.sms} onClick={()=>toggle("sms")} label="SMS"/><MiniToggle active={responseChannels.voice} onClick={()=>toggle("voice")} label="Voice"/><MiniToggle active={responseChannels.radio} onClick={()=>toggle("radio")} label="Radio"/><MiniToggle active={responseChannels.community} onClick={()=>toggle("community")} label="Community"/></div><button type="button" disabled={responseSending || !responseMessage.trim()} onClick={onSendResponse} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-[10px] font-extrabold text-white hover:bg-blue-700 disabled:opacity-50"><Send size={14}/>{responseSending?"Sending...":"Send response"}</button>{responseResults.length>0&&<div className="mt-3 space-y-1.5">{responseResults.map((r,i)=><div key={i} className="rounded-lg bg-emerald-50 p-2 text-[9px] font-bold text-emerald-700">{r.channel}: {r.status}</div>)}</div>}</div></div></div></div></div>; }

function IncidentMap({reports,allReports,onOpenReport,getBackendPriority}) { return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-6 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">SITUATIONAL AWARENESS</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">Live Community Incident Map</h2><p className="mt-1 text-xs leading-5 text-slate-400">Actual GPS coordinates from community reports are projected into the operational field below.</p></div><div className="grid lg:grid-cols-[1.5fr_0.5fr]"><div className="relative min-h-[520px] overflow-hidden bg-slate-100"><div className="absolute inset-0 opacity-40" style={{backgroundImage:"linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)",backgroundSize:"50px 50px"}}/><div className="absolute left-[38%] top-[10%] h-[80%] w-[24%] rounded-[50%] bg-blue-100/60 blur-2xl"/><div className="absolute inset-0 flex items-center justify-center"><div className="rounded-2xl border border-white/80 bg-white/70 px-6 py-4 text-center shadow-sm backdrop-blur"><Globe2 size={28} className="mx-auto text-blue-500"/><p className="mt-2 text-xs font-extrabold text-slate-700">AFRISHIELD INCIDENT FIELD</p><p className="mt-1 text-[9px] leading-5 text-slate-400">GPS-backed reports appear as operational markers.</p></div></div>{reports.map((report,index)=>{const p=getBackendPriority(report);const pos=getMarkerPosition(report,index,reports.length);return <button key={report.id} type="button" onClick={()=>onOpenReport(report)} title={`${report.category||"Incident"} — ${p.level}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2 hover:z-20 hover:scale-125" style={{left:`${pos.x}%`,top:`${pos.y}%`}}><span className={`absolute inset-0 animate-ping rounded-full opacity-40 ${priorityColor(p.level)}`}/><span className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-lg ${priorityMarker(p.level)}`}><MapPin size={15}/></span></button>})}<div className="absolute bottom-4 left-4 rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm"><p className="mb-2 text-[9px] font-extrabold uppercase text-slate-500">Priority</p><MapLegend color="bg-red-600" label="Critical"/><MapLegend color="bg-orange-500" label="High"/><MapLegend color="bg-amber-500" label="Medium"/><MapLegend color="bg-emerald-500" label="Low"/></div></div><div className="border-t border-slate-100 p-5 lg:border-l lg:border-t-0"><p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">MAP INTELLIGENCE</p><h3 className="mt-1 text-lg font-extrabold text-slate-900">Incident Overview</h3><div className="mt-5 space-y-3"><MapSummary label="All reports" value={allReports.length}/><MapSummary label="With coordinates" value={reports.length}/><MapSummary label="Critical" value={allReports.filter((r)=>getBackendPriority(r).level==="Critical").length}/><MapSummary label="Assistance" value={allReports.filter((r)=>r.needs_assistance).length}/></div>{reports.length===0&&<div className="mt-5 rounded-xl bg-amber-50 p-4"><p className="text-[10px] font-extrabold text-amber-700">No GPS-backed reports</p><p className="mt-1 text-[10px] leading-5 text-amber-600">New community submissions with browser location can appear here. Existing reports without coordinates cannot be placed precisely.</p></div>}</div></div></section>; }

function Workflow(){return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">INCIDENT LIFECYCLE</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">From Detection to Resolution</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">A transparent operational path from the first signal to coordinated response.</p><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[["01","NEW",ClipboardList],["02","VERIFYING",ClipboardCheck],["03","PRIORITIZED",ShieldAlert],["04","ASSIGNED",UserCheck],["05","RESPONDING",BellRing],["06","RESOLVED",CheckCircle2]].map(([number,label,Icon],index)=><div key={label} className="relative rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-[10px] font-extrabold text-white">{number}</div><Icon size={16} className="mt-4 text-blue-600"/><p className="mt-2 text-[10px] font-extrabold tracking-wide text-slate-700">{label}</p>{index<5&&<ChevronRight size={14} className="absolute right-2 top-1/2 hidden -translate-y-1/2 text-slate-300 lg:block"/>}</div>)}</div></section>}

function StatCard({icon,label,value,iconStyle}){return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconStyle}`}>{icon}</div><span className="text-3xl font-extrabold text-slate-900">{value}</span></div><p className="mt-4 text-sm font-bold text-slate-500">{label}</p></div>}
function BannerMetric({value,label}){return <div className="min-w-[80px] rounded-xl bg-white/10 p-3"><p className="text-xl font-extrabold">{value}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-blue-100">{label}</p></div>}
function StatusPill({label,active}){return <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm"><span className={`h-1.5 w-1.5 rounded-full ${active?"bg-emerald-500":"bg-red-500"}`}/><span className="text-[9px] font-extrabold text-slate-500">{label}</span><span className={`text-[8px] font-extrabold ${active?"text-emerald-600":"text-red-600"}`}>{active?"ONLINE":"ERROR"}</span></div>}
function CommandTab({active,onClick,icon,label,badge}){return <button type="button" onClick={onClick} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-extrabold transition ${active?"bg-blue-600 text-white shadow-sm":"text-slate-500 hover:bg-slate-50 hover:text-blue-600"}`}>{icon}{label}{badge>0&&<span className={`rounded-full px-1.5 py-0.5 text-[8px] ${active?"bg-white/20 text-white":"bg-red-100 text-red-600"}`}>{badge}</span>}</button>}
function MiniMetric({label,value}){return <div className="rounded-lg border border-slate-100 bg-white px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 truncate text-[10px] font-extrabold text-slate-700">{value}</p></div>}
function DetailBox({icon,label,value}){return <div className="rounded-xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-blue-600">{icon}<p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{label}</p></div><p className="mt-2 text-sm font-extrabold text-slate-800">{value}</p></div>}
function ChannelButton({active,onClick,icon,label,description}){return <button type="button" onClick={onClick} className={`flex items-center gap-3 rounded-xl border p-3 text-left ${active?"border-blue-200 bg-blue-50":"border-slate-200 bg-white hover:bg-slate-50"}`}><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${active?"bg-blue-600 text-white":"bg-slate-100 text-slate-500"}`}>{icon}</div><div><p className={`text-[10px] font-extrabold ${active?"text-blue-700":"text-slate-700"}`}>{label}</p><p className="mt-0.5 text-[9px] text-slate-400">{description}</p></div></button>}
function MiniToggle({active,onClick,label}){return <button type="button" onClick={onClick} className={`rounded-lg border px-2 py-2 text-[9px] font-extrabold ${active?"border-blue-200 bg-blue-50 text-blue-700":"border-slate-200 bg-white text-slate-500"}`}>{label}</button>}
function MapLegend({color,label}){return <div className="mt-1.5 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${color}`}/><span className="text-[9px] font-bold text-slate-500">{label}</span></div>}
function MapSummary({label,value}){return <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-[10px] font-bold text-slate-500">{label}</span><span className="text-sm font-extrabold text-slate-800">{value}</span></div>}
function AdminInput({label,type="text",value,onChange,placeholder}){return <div><label className="mb-2 block text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{label}</label><input type={type} value={value} onChange={onChange} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"/></div>}
function LoadingState({label}){return <div className="flex min-h-[220px] flex-col items-center justify-center"><RefreshCw size={25} className="animate-spin text-blue-500"/><p className="mt-3 text-xs font-semibold text-slate-400">{label}</p></div>}
function EmptyState({icon,title,description}){return <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center"><div className="text-emerald-500">{icon}</div><p className="mt-4 text-sm font-bold text-slate-700">{title}</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-400">{description}</p></div>}
function EditPendingModal({value,setValue,onClose,onSubmit,loading}){return <Modal title="Edit & Send Alert" onClose={onClose}><p className="text-xs text-slate-500">{value.location_name}</p><textarea value={value.message||""} onChange={(e)=>setValue({...value,message:e.target.value})} rows={7} className="mt-4 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-blue-500" placeholder="Write the alert message..."/><textarea value={value.notes||""} onChange={(e)=>setValue({...value,notes:e.target.value})} rows={3} className="mt-3 w-full rounded-xl border border-slate-200 p-4 text-xs outline-none focus:border-blue-500" placeholder="Optional review notes"/><div className="mt-4 flex gap-2"><button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-slate-200 text-xs font-extrabold text-slate-600">Cancel</button><button type="button" disabled={loading||!value.message?.trim()} onClick={onSubmit} className="h-10 flex-1 rounded-lg bg-blue-600 text-xs font-extrabold text-white disabled:opacity-50">{loading?"Sending...":"Edit & Send"}</button></div></Modal>}
function RejectPendingModal({value,setValue,onClose,onSubmit,loading}){return <Modal title="Reject Pending Alert" onClose={onClose}><p className="text-xs text-slate-500">{value.location_name}</p><select value={value.reason} onChange={(e)=>setValue({...value,reason:e.target.value})} className="mt-4 h-11 w-full rounded-xl border border-slate-200 px-3 text-xs font-bold outline-none"><option value="">Select rejection reason</option>{PENDING_REJECT_REASONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><textarea value={value.notes||""} onChange={(e)=>setValue({...value,notes:e.target.value})} rows={4} className="mt-3 w-full rounded-xl border border-slate-200 p-4 text-xs outline-none focus:border-blue-500" placeholder="Optional notes"/><div className="mt-4 flex gap-2"><button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-slate-200 text-xs font-extrabold text-slate-600">Cancel</button><button type="button" disabled={loading||!value.reason} onClick={onSubmit} className="h-10 flex-1 rounded-lg bg-red-600 text-xs font-extrabold text-white disabled:opacity-50">{loading?"Rejecting...":"Reject Alert"}</button></div></Modal>}
function Modal({title,onClose,children}){return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold text-slate-900">{title}</h2><button type="button" onClick={onClose} className="rounded-lg bg-slate-100 p-2 text-slate-500"><X size={17}/></button></div>{children}</div></div>}
function getPriorityStyles(level){switch(String(level).toLowerCase()){case"critical":return{badge:"bg-red-50 text-red-700 border-red-100",bar:"bg-red-500",icon:"bg-red-50 text-red-600"};case"high":return{badge:"bg-orange-50 text-orange-700 border-orange-100",bar:"bg-orange-500",icon:"bg-orange-50 text-orange-600"};case"medium":return{badge:"bg-amber-50 text-amber-700 border-amber-100",bar:"bg-amber-500",icon:"bg-amber-50 text-amber-600"};default:return{badge:"bg-emerald-50 text-emerald-700 border-emerald-100",bar:"bg-emerald-500",icon:"bg-emerald-50 text-emerald-600"}}}
function priorityColor(level){return level==="Critical"?"bg-red-500":level==="High"?"bg-orange-500":level==="Medium"?"bg-amber-500":"bg-emerald-500"}
function priorityMarker(level){return level==="Critical"?"bg-red-600 text-white":level==="High"?"bg-orange-500 text-white":level==="Medium"?"bg-amber-500 text-white":"bg-emerald-500 text-white"}
function getMarkerPosition(report,index,total){const lat=Number(report.latitude),lng=Number(report.longitude);if(Number.isFinite(lat)&&Number.isFinite(lng)){const x=((lng-20)/35)*100;const y=100-((lat+20)/40)*100;return{x:Math.max(5,Math.min(95,x)),y:Math.max(5,Math.min(95,y))}}return{x:15+((index*37)%Math.max(70,total*10)),y:20+((index*29)%60)}}
function formatShortDate(value){if(!value)return"—";const d=new Date(value);if(Number.isNaN(d.getTime()))return"—";return d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}
function titleCase(value){return String(value||"").replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase())}

export default AdminCommandCenter;
