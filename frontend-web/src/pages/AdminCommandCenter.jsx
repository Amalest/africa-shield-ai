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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const REPORTS_API_URL =
  "http://localhost:8000/api/hazard-reports";

const REGIONS_API_URL =
  "http://localhost:8000/api/regions";

const ADMIN_STATS_API_URL =
  "http://localhost:8000/api/admin/dashboard/stats";

const ADMIN_PRIORITY_API_URL =
  "http://localhost:8000/api/admin/incidents/prioritized";

const ADMIN_MAP_API_URL =
  "http://localhost:8000/api/admin/incidents/map";

const ADMIN_INCIDENTS_API_URL =
  "http://localhost:8000/api/admin/incidents";

const ADMIN_ASSISTANCE_API_URL =
  "http://localhost:8000/api/admin/assistance-requests";


/*
|--------------------------------------------------------------------------
| ADMIN COMMAND CENTER
|--------------------------------------------------------------------------
|
| Live emergency operations center.
|
| Current live backend data:
| - Community hazard reports
| - Uploaded evidence photos
| - Report severity
| - Assistance requests
| - Location
| - Submission time
| - Regional flood risk
|
| Live backend integrations:
| - Dashboard statistics
| - AI incident prioritization
| - Incident map
| - Verification and status workflow
| - Incident assignment
| - Last-mile response logging
|
|--------------------------------------------------------------------------
*/

function AdminCommandCenter() {
  const [reports, setReports] = useState([]);
  const [regions, setRegions] = useState([]);

  const [loading, setLoading] = useState(true);
  const [regionsLoading, setRegionsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  const [dashboardStats, setDashboardStats] = useState({
    total_reports: 0,
    critical_or_high_priority: 0,
    assistance_needed: 0,
    resolved: 0,
    by_status: {},
  });

  const [error, setError] = useState("");
  const [regionsError, setRegionsError] = useState("");

  const [selectedReport, setSelectedReport] =
    useState(null);

  const [activePanel, setActivePanel] =
    useState("overview");

  const [searchQuery, setSearchQuery] =
    useState("");

  const [severityFilter, setSeverityFilter] =
    useState("All");

  const [priorityFilter, setPriorityFilter] =
    useState("All");

  /*
   * Frontend workflow state.
   *
   * Backend incident status and assignment now take precedence;
   * local state is retained only for immediate UI continuity.
   */
  const [incidentStatuses, setIncidentStatuses] =
    useState({});

  const [assignedTeams, setAssignedTeams] =
    useState({});

  /*
   * Response Center state
   */
  const [responseMessage, setResponseMessage] =
    useState("");

  const [responseLanguage, setResponseLanguage] =
    useState("English");

  const [responseChannels, setResponseChannels] =
    useState({
      sms: true,
      voice: false,
      radio: false,
      community: true,
    });

  const [responseSent, setResponseSent] =
    useState(false);

  const [priorityLoading, setPriorityLoading] =
    useState(true);

  const [priorityError, setPriorityError] =
    useState("");

  const [priorityIncidents, setPriorityIncidents] =
    useState([]);

  const [mapLoading, setMapLoading] =
    useState(true);

  const [mapError, setMapError] =
    useState("");

  const [mapIncidents, setMapIncidents] =
    useState([]);

  const [actionLoading, setActionLoading] =
    useState(false);

  const [actionError, setActionError] =
    useState("");

  /*
   * ============================================================
   * FETCH REPORTS
   * ============================================================
   */

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        REPORTS_API_URL
      );

      if (!response.ok) {
        throw new Error(
          `Hazard reports API returned status ${response.status}`
        );
      }

      const data = await response.json();

      setReports(
        Array.isArray(data) ? data : []
      );
    } catch (error) {
      console.error(
        "Error fetching admin reports:",
        error
      );

      setError(
        error.message ||
          "Unable to load community reports."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * ============================================================
   * FETCH REGIONAL INTELLIGENCE
   * ============================================================
   */

  const fetchRegions = useCallback(async () => {
    try {
      setRegionsLoading(true);
      setRegionsError("");

      const response = await fetch(
        REGIONS_API_URL
      );

      if (!response.ok) {
        throw new Error(
          `Regional API returned status ${response.status}`
        );
      }

      const data = await response.json();

      setRegions(
        Array.isArray(data) ? data : []
      );
    } catch (error) {
      console.error(
        "Error fetching regional intelligence:",
        error
      );

      setRegionsError(
        error.message ||
          "Unable to load regional intelligence."
      );
    } finally {
      setRegionsLoading(false);
    }
  }, []);

  /*
   * ============================================================
   * FETCH DASHBOARD STATISTICS
   * ============================================================
   */

  const fetchDashboardStats = useCallback(async () => {
    try {
      setStatsLoading(true);

      const token = localStorage.getItem("afrishield_admin_token");

      if (!token) {
        throw new Error("Admin authentication token is missing.");
      }

      const response = await fetch(ADMIN_STATS_API_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Your admin session has expired. Please log in again."
          );
        }

        throw new Error(
          data?.detail ||
            `Dashboard statistics API returned status ${response.status}`
        );
      }

      setDashboardStats({
        total_reports: Number(data?.total_reports) || 0,
        critical_or_high_priority:
          Number(data?.critical_or_high_priority) || 0,
        assistance_needed: Number(data?.assistance_needed) || 0,
        resolved: Number(data?.resolved) || 0,
        by_status: data?.by_status || {},
      });
    } catch (error) {
      console.error(
        "Error fetching admin dashboard statistics:",
        error
      );
    } finally {
      setStatsLoading(false);
    }
  }, []);

  /*
   * ============================================================
   * FETCH AI PRIORITIZED INCIDENTS
   * ============================================================
   */

  const fetchPrioritizedIncidents = useCallback(async () => {
    try {
      setPriorityLoading(true);
      setPriorityError("");

      const token = localStorage.getItem(
        "afrishield_admin_token"
      );

      if (!token) {
        throw new Error(
          "Admin authentication token is missing."
        );
      }

      const response = await fetch(
        ADMIN_PRIORITY_API_URL,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Your admin session has expired. Please log in again."
          );
        }

        throw new Error(
          data?.detail ||
            `AI priority API returned status ${response.status}`
        );
      }

      setPriorityIncidents(
        Array.isArray(data) ? data : []
      );
    } catch (error) {
      console.error(
        "Error fetching AI-prioritized incidents:",
        error
      );

      setPriorityError(
        error.message ||
          "Unable to load AI priority intelligence."
      );
    } finally {
      setPriorityLoading(false);
    }
  }, []);

  /*
   * ============================================================
   * FETCH ADMIN INCIDENT MAP
   * ============================================================
   */

  const fetchMapIncidents = useCallback(async () => {
    try {
      setMapLoading(true);
      setMapError("");

      const token = localStorage.getItem(
        "afrishield_admin_token"
      );

      if (!token) {
        throw new Error(
          "Admin authentication token is missing."
        );
      }

      const response = await fetch(
        ADMIN_MAP_API_URL,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Your admin session has expired. Please log in again."
          );
        }

        throw new Error(
          data?.detail ||
            `Incident map API returned status ${response.status}`
        );
      }

      setMapIncidents(
        Array.isArray(data) ? data : []
      );
    } catch (error) {
      console.error(
        "Error fetching incident map:",
        error
      );

      setMapError(
        error.message ||
          "Unable to load incident map intelligence."
      );
    } finally {
      setMapLoading(false);
    }
  }, []);

  /*
   * ============================================================
   * INITIAL LOAD
   * ============================================================
   */

  useEffect(() => {
    fetchReports();
    fetchRegions();
    fetchDashboardStats();
    fetchPrioritizedIncidents();
    fetchMapIncidents();
  }, [
    fetchReports,
    fetchRegions,
    fetchDashboardStats,
    fetchPrioritizedIncidents,
    fetchMapIncidents,
  ]);

  /*
   * ============================================================
   * HELPERS
   * ============================================================
   */

  const formatDate = (dateString) => {
    if (!dateString) {
      return "Unknown time";
    }

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
      return "Unknown time";
    }

    return date.toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const getSeverity = (report) => {
    const description =
      report?.description || "";

    const match = description.match(
      /Severity:\s*(Low|Medium|High|Critical)/i
    );

    return match
      ? match[1]
      : "Unknown";
  };

  const getPeopleAffected = (report) => {
    const description =
      report?.description || "";

    const match = description.match(
      /Estimated people affected:\s*(\d+)/i
    );

    if (!match) {
      return 0;
    }

    return Number(match[1]) || 0;
  };

  const getRegionForReport = (report) => {
    if (!report?.location_name) {
      return null;
    }

    const reportLocation =
      report.location_name
        .toLowerCase()
        .trim();

    return (
      regions.find((region) => {
        const regionLocation =
          region.location_name
            ?.toLowerCase()
            .trim();

        if (!regionLocation) {
          return false;
        }

        return (
          regionLocation === reportLocation ||
          regionLocation.startsWith(
            `${reportLocation},`
          ) ||
          reportLocation.startsWith(
            `${regionLocation},`
          )
        );
      }) || null
    );
  };

  const getRegionRisk = (report) => {
    const region =
      getRegionForReport(report);

    if (!region) {
      return {
        level: "Unknown",
        score: 0,
      };
    }

    const rawScore =
      region.risk_score ??
      region.risk_score_breakdown
        ?.risk_score ??
      0;

    const numericScore =
      Number(rawScore);

    let score = Number.isNaN(
      numericScore
    )
      ? 0
      : numericScore;

    if (score <= 1) {
      score = score * 100;
    }

    return {
      level:
        region.risk_level ||
        "Unknown",
      score: Math.round(score),
    };
  };

  /*
   * ============================================================
   * AI-ASSISTED PRIORITY / TRIAGE
   * ============================================================
   *
   * This remains as a safe fallback if the backend AI triage
   * endpoint is temporarily unavailable.
   *
   * Maximum score = 100
   *
   * Factors:
   * - Severity
   * - People affected
   * - Assistance request
   * - Regional flood risk
   * - Photo evidence
   * - Recency
   */

  const calculatePriority = (report) => {
    let score = 0;

    const severity =
      getSeverity(report).toLowerCase();

    const severityPoints = {
      critical: 40,
      high: 30,
      medium: 20,
      low: 10,
      unknown: 5,
    };

    score +=
      severityPoints[severity] || 5;

    /*
     * People affected
     */
    const people =
      getPeopleAffected(report);

    if (people >= 500) {
      score += 20;
    } else if (people >= 200) {
      score += 16;
    } else if (people >= 100) {
      score += 12;
    } else if (people >= 50) {
      score += 8;
    } else if (people > 0) {
      score += 4;
    }

    /*
     * Assistance
     */
    if (report.needs_assistance) {
      score += 15;
    }

    /*
     * Regional risk
     */
    const regionalRisk =
      getRegionRisk(report);

    if (
      regionalRisk.level
        .toLowerCase() === "high"
    ) {
      score += 15;
    } else if (
      regionalRisk.level
        .toLowerCase() === "medium"
    ) {
      score += 9;
    } else if (
      regionalRisk.level
        .toLowerCase() === "low"
    ) {
      score += 3;
    }

    /*
     * Evidence
     */
    if (report.has_photo) {
      score += 5;
    }

    /*
     * Recency
     */
    if (report.submitted_at) {
      const submitted =
        new Date(
          report.submitted_at
        ).getTime();

      const now = Date.now();

      const ageHours =
        (now - submitted) /
        (1000 * 60 * 60);

      if (ageHours <= 1) {
        score += 5;
      } else if (ageHours <= 6) {
        score += 4;
      } else if (ageHours <= 24) {
        score += 2;
      }
    }

    return Math.min(
      Math.round(score),
      100
    );
  };

  const getPriorityLevel = (score) => {
    if (score >= 85) {
      return "Critical";
    }

    if (score >= 70) {
      return "High";
    }

    if (score >= 45) {
      return "Medium";
    }

    return "Low";
  };

  const getPriorityStyles = (level) => {
    switch (level.toLowerCase()) {
      case "critical":
        return {
          badge:
            "bg-red-50 text-red-700 border-red-100",
          dot:
            "bg-red-500",
          bar:
            "bg-red-500",
          icon:
            "bg-red-50 text-red-600",
        };

      case "high":
        return {
          badge:
            "bg-orange-50 text-orange-700 border-orange-100",
          dot:
            "bg-orange-500",
          bar:
            "bg-orange-500",
          icon:
            "bg-orange-50 text-orange-600",
        };

      case "medium":
        return {
          badge:
            "bg-amber-50 text-amber-700 border-amber-100",
          dot:
            "bg-amber-500",
          bar:
            "bg-amber-500",
          icon:
            "bg-amber-50 text-amber-600",
        };

      default:
        return {
          badge:
            "bg-emerald-50 text-emerald-700 border-emerald-100",
          dot:
            "bg-emerald-500",
          bar:
            "bg-emerald-500",
          icon:
            "bg-emerald-50 text-emerald-600",
        };
    }
  };

  const priorityByReportId = useMemo(() => {
    return priorityIncidents.reduce(
      (accumulator, incident) => {
        if (incident?.id) {
          accumulator[incident.id] = incident;
        }

        return accumulator;
      },
      {}
    );
  }, [priorityIncidents]);

  const getAIIncident = (report) =>
    report?.id
      ? priorityByReportId[report.id] || null
      : null;

  const getPriorityScoreForReport = (report) => {
    const aiIncident = getAIIncident(report);
    const backendScore = Number(
      aiIncident?.priority_score
    );

    if (Number.isFinite(backendScore)) {
      return Math.max(
        0,
        Math.min(100, Math.round(backendScore * 100))
      );
    }

    return calculatePriority(report);
  };

  const getPriorityLevelForReport = (report) => {
    const aiIncident = getAIIncident(report);

    if (aiIncident?.priority_level) {
      return (
        String(aiIncident.priority_level).charAt(0).toUpperCase() +
        String(aiIncident.priority_level).slice(1).toLowerCase()
      );
    }

    return getPriorityLevel(
      calculatePriority(report)
    );
  };

  const formatFactorValue = (value) => {
    if (value === null || value === undefined) {
      return "Not available";
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  };

  /*
   * ============================================================
   * INCIDENT STATUS
   * ============================================================
   */

  const getIncidentStatus = (report) => {
    const localStatus = incidentStatuses[report.id];
    const backendStatus = report.status;

    if (localStatus) {
      return String(localStatus).toUpperCase();
    }

    if (backendStatus) {
      return String(backendStatus).toUpperCase();
    }

    return "NEW";
  };

  const getAssignedTeam = (report) =>
    assignedTeams[report.id] ||
    report.assigned_to ||
    "";

  const updateReportLocally = (updatedReport) => {
    if (!updatedReport?.id) {
      return;
    }

    setReports((previous) =>
      previous.map((report) =>
        report.id === updatedReport.id
          ? updatedReport
          : report
      )
    );

    setSelectedReport((previous) =>
      previous?.id === updatedReport.id
        ? updatedReport
        : previous
    );
  };

  const runAdminAction = async (request) => {
    try {
      setActionLoading(true);
      setActionError("");

      const token = localStorage.getItem(
        "afrishield_admin_token"
      );

      if (!token) {
        throw new Error(
          "Admin authentication token is missing."
        );
      }

      const response = await fetch(request.url, {
        method: request.method || "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(request.body
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(request.body
          ? { body: JSON.stringify(request.body) }
          : {}),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Your admin session has expired. Please log in again."
          );
        }

        throw new Error(
          data?.detail ||
            `Admin action failed with status ${response.status}`
        );
      }

      return data;
    } catch (error) {
      console.error("Admin action error:", error);
      setActionError(
        error.message ||
          "The requested admin action could not be completed."
      );
      return null;
    } finally {
      setActionLoading(false);
    }
  };

  const setIncidentStatus = async (
    reportId,
    status
  ) => {
    const backendStatus = String(status).toLowerCase();

    const updatedReport = await runAdminAction({
      url: `${ADMIN_INCIDENTS_API_URL}/${reportId}/status`,
      method: "PATCH",
      body: { status: backendStatus },
    });

    if (!updatedReport) {
      return false;
    }

    updateReportLocally(updatedReport);
    setIncidentStatuses((previous) => ({
      ...previous,
      [reportId]: String(
        updatedReport.status || backendStatus
      ).toUpperCase(),
    }));

    await Promise.all([
      fetchDashboardStats(),
      fetchPrioritizedIncidents(),
      fetchMapIncidents(),
    ]);

    return true;
  };

  const verifyIncident = async (
    reportId,
    verified,
    notes = ""
  ) => {
    const updatedReport = await runAdminAction({
      url: `${ADMIN_INCIDENTS_API_URL}/${reportId}/verify`,
      method: "POST",
      body: {
        verified,
        notes,
      },
    });

    if (!updatedReport) {
      return false;
    }

    updateReportLocally(updatedReport);
    setIncidentStatuses((previous) => ({
      ...previous,
      [reportId]: String(
        updatedReport.status ||
          (verified ? "verifying" : "new")
      ).toUpperCase(),
    }));

    await Promise.all([
      fetchDashboardStats(),
      fetchPrioritizedIncidents(),
      fetchMapIncidents(),
    ]);

    return true;
  };

  const assignTeam = async (
    reportId,
    team
  ) => {
    if (!team) {
      return false;
    }

    const updatedReport = await runAdminAction({
      url: `${ADMIN_ASSISTANCE_API_URL}/${reportId}/assign`,
      method: "POST",
      body: {
        assigned_to: team,
        team,
        notes: "Assigned from AfriShield Admin Command Center.",
      },
    });

    if (!updatedReport) {
      return false;
    }

    updateReportLocally(updatedReport);
    setAssignedTeams((previous) => ({
      ...previous,
      [reportId]:
        updatedReport.assigned_to || team,
    }));
    setIncidentStatuses((previous) => ({
      ...previous,
      [reportId]: String(
        updatedReport.status || "assigned"
      ).toUpperCase(),
    }));

    await Promise.all([
      fetchDashboardStats(),
      fetchPrioritizedIncidents(),
      fetchMapIncidents(),
    ]);

    return true;
  };

  /*
   * ============================================================
   * SEARCH + FILTER
   * ============================================================
   */

  const filteredReports = useMemo(() => {
    const query =
      searchQuery
        .trim()
        .toLowerCase();

    return reports
      .filter((report) => {
        if (
          severityFilter !== "All" &&
          getSeverity(report) !==
            severityFilter
        ) {
          return false;
        }

        if (
          priorityFilter !== "All"
        ) {
          const priority =
            getPriorityLevelForReport(report);

          if (
            priority !==
            priorityFilter
          ) {
            return false;
          }
        }

        if (!query) {
          return true;
        }

        return [
          report.category,
          report.location_name,
          report.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort(
        (a, b) =>
          getPriorityScoreForReport(b) -
          getPriorityScoreForReport(a)
      );
  }, [
    reports,
    searchQuery,
    severityFilter,
    priorityFilter,
    regions,
    priorityIncidents,
  ]);

  /*
   * ============================================================
   * STATISTICS
   * ============================================================
   */

  const statistics = {
    total: dashboardStats.total_reports,
    critical: dashboardStats.critical_or_high_priority,
    assistance: dashboardStats.assistance_needed,
    resolved: dashboardStats.resolved,
  };

  /*
   * ============================================================
   * ASSISTANCE REPORTS
   * ============================================================
   */

  const assistanceReports =
    useMemo(() => {
      return [...reports]
        .filter(
          (report) =>
            report.needs_assistance
        )
        .sort(
          (a, b) =>
            getPriorityScoreForReport(b) -
            getPriorityScoreForReport(a)
        );
    }, [reports, regions, priorityIncidents]);

  /*
   * ============================================================
   * MAP REPORTS
   * ============================================================
   */

  const mapReports = useMemo(() => {
    return mapIncidents
      .map((incident) => {
        const fullReport = reports.find(
          (report) => report.id === incident.id
        );

        return fullReport
          ? {
              ...fullReport,
              latitude: incident.latitude,
              longitude: incident.longitude,
              map_priority_score: incident.priority_score,
              map_priority_level: incident.priority_level,
              map_severity: incident.severity,
              map_status: incident.status,
            }
          : incident;
      })
      .filter(
        (report) =>
          Number.isFinite(Number(report.latitude)) &&
          Number.isFinite(Number(report.longitude))
      );
  }, [mapIncidents, reports]);

  /*
   * ============================================================
   * RESPONSE CENTER
   * ============================================================
   */

  const selectedPriority =
    selectedReport
      ? getPriorityScoreForReport(selectedReport)
      : 0;

  const selectedPriorityLevel =
    selectedReport
      ? getPriorityLevelForReport(selectedReport)
      : "Low";

  const selectedAIIncident =
    selectedReport
      ? getAIIncident(selectedReport)
      : null;

  const handleChannelToggle = (
    channel
  ) => {
    setResponseChannels(
      (previous) => ({
        ...previous,
        [channel]:
          !previous[channel],
      })
    );

    setResponseSent(false);
  };

  const getResponseRecipients = (report) => {
    const possible =
      report?.phone_number ||
      report?.phone ||
      report?.contact_phone ||
      report?.recipient_phone;

    if (Array.isArray(possible)) {
      return possible.filter(Boolean);
    }

    if (possible) {
      return [String(possible)];
    }

    return [];
  };

  const handleSendResponse = async () => {
    if (!selectedReport || !responseMessage.trim()) {
      return;
    }

    const selectedChannels = [
      responseChannels.sms ? "sms" : null,
      responseChannels.voice ? "voice" : null,
      responseChannels.radio ? "radio" : null,
      responseChannels.community
        ? "community_leader"
        : null,
    ].filter(Boolean);

    if (selectedChannels.length === 0) {
      return;
    }

    let completed = false;

    for (const channel of selectedChannels) {
      const result = await runAdminAction({
        url: `${ADMIN_INCIDENTS_API_URL}/${selectedReport.id}/response`,
        method: "POST",
        body: {
          channel,
          message: responseMessage.trim(),
          recipients: getResponseRecipients(
            selectedReport
          ),
        },
      });

      if (result) {
        completed = true;
      }
    }

    if (completed) {
      setResponseSent(true);

      await Promise.all([
        fetchReports(),
        fetchDashboardStats(),
        fetchPrioritizedIncidents(),
        fetchMapIncidents(),
      ]);
    }
  };

  /*
   * ============================================================
   * OPEN REPORT
   * ============================================================
   */

  const openReport = (report) => {
    setSelectedReport(report);
    setActivePanel("review");

    const defaultMessage =
      report.needs_assistance
        ? `Emergency assistance is required in ${report.location_name}. Please follow local responder instructions and move to a safe location if advised.`
        : `Flood risk has been reported in ${report.location_name}. Please avoid flooded roads and follow official safety instructions.`;

    setResponseMessage(
      defaultMessage
    );

    setResponseSent(false);
  };

  /*
   * ============================================================
   * REFRESH
   * ============================================================
   */

  const refreshEverything = async () => {
    await Promise.all([
      fetchReports(),
      fetchRegions(),
      fetchDashboardStats(),
      fetchPrioritizedIncidents(),
      fetchMapIncidents(),
    ]);
  };

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <main className="min-h-full bg-slate-50/70 px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">

        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />

              <p className="text-[10px] font-extrabold uppercase tracking-[1.7px] text-blue-600">
                AFRISHIELD OPERATIONS
              </p>
            </div>

            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Admin Command Center
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              A unified emergency operations view for
              community reports, AI-assisted prioritization,
              verification, assistance coordination and
              last-mile response.
            </p>
          </div>

          <button
            type="button"
            onClick={
              refreshEverything
            }
            disabled={
              loading ||
              regionsLoading ||
              statsLoading ||
              priorityLoading ||
              mapLoading
            }
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 lg:self-auto"
          >
            <RefreshCw
              size={15}
              className={
                loading ||
                regionsLoading ||
                statsLoading ||
                priorityLoading ||
                mapLoading
                  ? "animate-spin"
                  : ""
              }
            />

            Refresh command center
          </button>
        </div>

        {/* ====================================================
            SYSTEM STATUS
        ==================================================== */}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <StatusPill
            label="REPORTS API"
            active={!error}
          />

          <StatusPill
            label="REGIONAL INTELLIGENCE"
            active={!regionsError}
          />

          <StatusPill
            label="AI TRIAGE"
            active={!priorityError}
          />

          <StatusPill
            label="INCIDENT MAP"
            active={!mapError}
          />

          <StatusPill
            label="COMMAND CENTER"
            active
          />

          <span className="ml-auto text-[10px] font-semibold text-slate-400">
            {formatDate(
              new Date().toISOString()
            )}
          </span>
        </div>

        {/* ====================================================
            COMMAND BANNER
        ==================================================== */}

        <div className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 p-6 text-white shadow-lg shadow-blue-100">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <Siren size={18} />

                <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-blue-100">
                  EMERGENCY OPERATIONS
                </p>
              </div>

              <h2 className="mt-3 text-xl font-extrabold sm:text-2xl">
                From community signal to coordinated
                response.
              </h2>

              <p className="mt-2 text-sm leading-6 text-blue-100">
                AfriShield combines ground-level community
                information with regional flood intelligence
                to help response teams focus on the incidents
                that matter most.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <BannerMetric
                value={statistics.total}
                label="Reports"
              />

              <BannerMetric
                value={statistics.critical}
                label="Critical"
              />

              <BannerMetric
                value={statistics.assistance}
                label="Assistance"
              />

              <BannerMetric
                value={statistics.resolved}
                label="Resolved"
              />
            </div>
          </div>
        </div>

        {/* ====================================================
            STATISTICS
        ==================================================== */}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          <StatCard
            icon={
              <ClipboardList
                size={21}
              />
            }
            label="Total Reports"
            value={statistics.total}
            iconStyle="bg-blue-50 text-blue-600"
          />

          <StatCard
            icon={
              <ShieldAlert
                size={21}
              />
            }
            label="High/Critical Priority"
            value={statistics.critical}
            iconStyle="bg-red-50 text-red-600"
          />

          <StatCard
            icon={
              <Users size={21} />
            }
            label="Assistance Needed"
            value={statistics.assistance}
            iconStyle="bg-indigo-50 text-indigo-600"
          />

          <StatCard
            icon={
              <CheckCircle2
                size={21}
              />
            }
            label="Resolved"
            value={statistics.resolved}
            iconStyle="bg-emerald-50 text-emerald-600"
          />

        </div>

        {/* ====================================================
            NAVIGATION TABS
        ==================================================== */}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex min-w-max gap-1">

            <CommandTab
              active={
                activePanel ===
                "overview"
              }
              onClick={() =>
                setActivePanel(
                  "overview"
                )
              }
              icon={
                <ClipboardList
                  size={15}
                />
              }
              label="Priority Queue"
            />

            <CommandTab
              active={
                activePanel ===
                "map"
              }
              onClick={() =>
                setActivePanel("map")
              }
              icon={
                <Navigation
                  size={15}
                />
              }
              label="Incident Map"
            />

            <CommandTab
              active={
                activePanel ===
                "assistance"
              }
              onClick={() =>
                setActivePanel(
                  "assistance"
                )
              }
              icon={
                <Users size={15} />
              }
              label="Assistance"
            />

            <CommandTab
              active={
                activePanel ===
                "response"
              }
              onClick={() =>
                setActivePanel(
                  "response"
                )
              }
              icon={
                <BellRing
                  size={15}
                />
              }
              label="Response Center"
            />

          </div>
        </div>

        {/* ====================================================
            OVERVIEW / AI PRIORITY QUEUE
        ==================================================== */}

        {activePanel ===
          "overview" && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600">
                      <ShieldAlert
                        size={18}
                      />
                    </div>

                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-red-500">
                        AI-ASSISTED TRIAGE
                      </p>

                      <h2 className="mt-0.5 text-xl font-extrabold text-slate-900">
                        Priority Incident Queue
                      </h2>
                    </div>
                  </div>

                  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
                    Incidents are ranked using severity,
                    estimated impact, assistance needs,
                    regional flood risk, evidence and
                    recency.
                  </p>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">
                    PRIORITIZATION ENGINE
                  </p>

                  <p className="mt-1 text-xs font-bold text-blue-800">
                    Operational scoring active
                  </p>
                </div>

              </div>
            </div>

            {/* FILTERS */}

            <div className="border-b border-slate-100 bg-slate-50/60 p-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">

                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="text"
                    value={
                      searchQuery
                    }
                    onChange={(event) =>
                      setSearchQuery(
                        event.target
                          .value
                      )
                    }
                    placeholder="Search reports, locations or descriptions..."
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  />
                </div>

                <select
                  value={
                    severityFilter
                  }
                  onChange={(event) =>
                    setSeverityFilter(
                      event.target
                        .value
                    )
                  }
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-blue-500"
                >
                  <option value="All">
                    All severity
                  </option>

                  <option value="Critical">
                    Critical
                  </option>

                  <option value="High">
                    High
                  </option>

                  <option value="Medium">
                    Medium
                  </option>

                  <option value="Low">
                    Low
                  </option>
                </select>

                <select
                  value={
                    priorityFilter
                  }
                  onChange={(event) =>
                    setPriorityFilter(
                      event.target
                        .value
                    )
                  }
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-blue-500"
                >
                  <option value="All">
                    All priority
                  </option>

                  <option value="Critical">
                    Critical
                  </option>

                  <option value="High">
                    High
                  </option>

                  <option value="Medium">
                    Medium
                  </option>

                  <option value="Low">
                    Low
                  </option>
                </select>

              </div>
            </div>

            {/* ERROR */}

            {error && (
              <div className="m-5 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4">
                <AlertTriangle
                  size={18}
                  className="mt-0.5 shrink-0 text-red-600"
                />

                <div>
                  <p className="text-sm font-extrabold text-red-700">
                    Reports unavailable
                  </p>

                  <p className="mt-1 text-xs text-red-600">
                    {error}
                  </p>
                </div>
              </div>
            )}

            {/* AI PRIORITY STATUS */}

            {priorityLoading && !loading && (
              <div className="border-b border-blue-100 bg-blue-50 px-6 py-3">
                <div className="flex items-center gap-2 text-blue-700">
                  <RefreshCw size={13} className="animate-spin" />
                  <p className="text-[10px] font-extrabold">
                    Loading backend AI triage scores and explainable priority factors...
                  </p>
                </div>
              </div>
            )}

            {priorityError && !priorityLoading && (
              <div className="border-b border-amber-100 bg-amber-50 px-6 py-3">
                <p className="text-[10px] font-extrabold text-amber-700">
                  AI triage unavailable — using local fallback scoring until the backend responds.
                </p>
              </div>
            )}

            {/* LOADING */}

            {loading && (
              <div className="flex min-h-[300px] flex-col items-center justify-center">
                <RefreshCw
                  size={25}
                  className="animate-spin text-blue-500"
                />

                <p className="mt-3 text-xs font-semibold text-slate-400">
                  Loading emergency intelligence...
                </p>
              </div>
            )}

            {/* EMPTY */}

            {!loading &&
              !error &&
              filteredReports.length ===
                0 && (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <ClipboardList
                      size={25}
                    />
                  </div>

                  <p className="mt-4 text-sm font-bold text-slate-700">
                    No matching incidents
                  </p>

                  <p className="mt-1 max-w-md text-xs leading-5 text-slate-400">
                    Community reports matching your filters
                    will appear here.
                  </p>
                </div>
              )}

            {/* REPORTS */}

            {!loading &&
              !error &&
              filteredReports.length >
                0 && (
                <div className="divide-y divide-slate-100">

                  {filteredReports.map(
                    (report) => {
                      const score =
                        getPriorityScoreForReport(
                          report
                        );

                      const priority =
                        getPriorityLevelForReport(
                          report
                        );

                      const styles =
                        getPriorityStyles(
                          priority
                        );

                      const status =
                        getIncidentStatus(
                          report
                        );

                      const regionRisk =
                        getRegionRisk(
                          report
                        );

                      return (
                        <div
                          key={report.id}
                          className="p-5 transition hover:bg-slate-50 sm:p-6"
                        >
                          <div className="flex flex-col gap-5 xl:flex-row xl:items-center">

                            {/* LEFT */}

                            <div className="flex min-w-0 flex-1 gap-4">

                              <div
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}
                              >
                                <Siren
                                  size={19}
                                />
                              </div>

                              <div className="min-w-0 flex-1">

                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-base font-extrabold text-slate-800">
                                    {report.category ||
                                      "Hazard Report"}
                                  </h3>

                                  <span
                                    className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide ${styles.badge}`}
                                  >
                                    {priority}
                                  </span>

                                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
                                    {status}
                                  </span>

                                  {report.needs_assistance && (
                                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-red-600">
                                      Assistance
                                    </span>
                                  )}
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">

                                  <span className="inline-flex items-center gap-1">
                                    <MapPin
                                      size={12}
                                    />

                                    {report.location_name ||
                                      "Unknown location"}
                                  </span>

                                  <span className="inline-flex items-center gap-1">
                                    <Clock3
                                      size={12}
                                    />

                                    {formatDate(
                                      report.submitted_at
                                    )}
                                  </span>

                                  <span className="inline-flex items-center gap-1">
                                    <Users
                                      size={12}
                                    />

                                    {getPeopleAffected(
                                      report
                                    ) ||
                                      "Unknown"}{" "}
                                    affected
                                  </span>

                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-4">

                                  <MiniMetric
                                    label="AI Priority"
                                    value={`${score}/100`}
                                  />

                                  <MiniMetric
                                    label="Severity"
                                    value={getSeverity(
                                      report
                                    )}
                                  />

                                  <MiniMetric
                                    label="Regional Risk"
                                    value={`${regionRisk.level}`}
                                  />

                                  <MiniMetric
                                    label="Evidence"
                                    value={
                                      report.has_photo
                                        ? "Attached"
                                        : "None"
                                    }
                                  />

                                </div>

                                {/* PRIORITY BAR */}

                                <div className="mt-4">
                                  <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                                      Priority assessment
                                    </span>

                                    <span className="text-[9px] font-extrabold text-slate-500">
                                      {score}%
                                    </span>
                                  </div>

                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                    <div
                                      className={`h-full rounded-full ${styles.bar}`}
                                      style={{
                                        width: `${score}%`,
                                      }}
                                    />
                                  </div>
                                </div>

                              </div>
                            </div>

                            {/* RIGHT */}

                            <div className="flex shrink-0 flex-wrap items-center gap-2 xl:w-36 xl:flex-col xl:items-stretch">

                              {report.has_photo && (
                                <span className="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-50 px-3 py-2 text-[9px] font-extrabold text-indigo-600">
                                  Evidence
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  openReport(
                                    report
                                  )
                                }
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[10px] font-extrabold text-white transition hover:bg-blue-700"
                              >
                                Review
                                <ChevronRight
                                  size={13}
                                />
                              </button>

                            </div>

                          </div>
                        </div>
                      );
                    }
                  )}

                </div>
              )}

          </section>
        )}

        {/* ====================================================
            INCIDENT MAP
        ==================================================== */}

        {activePanel ===
          "map" && (
          <IncidentMap
            reports={mapReports}
            allReports={
              reports
            }
            onOpenReport={
              openReport
            }
            calculatePriority={
              calculatePriority
            }
            getPriorityLevel={
              getPriorityLevel
            }
            getPriorityLevelForReport={
              getPriorityLevelForReport
            }
            mapLoading={mapLoading}
            mapError={mapError}
          />
        )}

        {/* ====================================================
            ASSISTANCE COORDINATION
        ==================================================== */}

        {activePanel ===
          "assistance" && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <Users size={19} />
                </div>

                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-red-500">
                    HUMANITARIAN RESPONSE
                  </p>

                  <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                    Assistance Coordination
                  </h2>

                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Prioritize community reports where people
                    have explicitly requested assistance.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-3">

              <StatCard
                icon={
                  <Users size={20} />
                }
                label="Requests"
                value={
                  assistanceReports.length
                }
                iconStyle="bg-red-50 text-red-600"
              />

              <StatCard
                icon={
                  <ShieldAlert
                    size={20}
                  />
                }
                label="Critical"
                value={
                  assistanceReports.filter(
                    (report) =>
                      getPriorityLevelForReport(
                        report
                      ) ===
                      "Critical"
                  ).length
                }
                iconStyle="bg-orange-50 text-orange-600"
              />

              <StatCard
                icon={
                  <UserCheck
                    size={20}
                  />
                }
                label="Assigned"
                value={
                  assistanceReports.filter(
                    (report) =>
                      assignedTeams[
                        report.id
                      ]
                  ).length
                }
                iconStyle="bg-emerald-50 text-emerald-600"
              />

            </div>

            {assistanceReports.length ===
              0 && (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
                <CheckCircle2
                  size={27}
                  className="text-emerald-500"
                />

                <p className="mt-4 text-sm font-bold text-slate-700">
                  No assistance requests
                </p>

                <p className="mt-1 max-w-md text-xs leading-5 text-slate-400">
                  Reports requesting assistance will appear
                  here for coordination.
                </p>
              </div>
            )}

            <div className="divide-y divide-slate-100">

              {assistanceReports.map(
                (report) => {
                  const score =
                    getPriorityScoreForReport(
                      report
                    );

                  const priority =
                    getPriorityLevelForReport(
                      report
                    );

                  const team =
                    getAssignedTeam(report);

                  return (
                    <div
                      key={report.id}
                      className="p-5 sm:p-6"
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">

                        <div className="flex gap-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                            <ShieldAlert
                              size={19}
                            />
                          </div>

                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-extrabold text-slate-800">
                                {report.category ||
                                  "Emergency assistance"}
                              </h3>

                              <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-extrabold uppercase text-red-600">
                                {priority}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-slate-400">
                              <span className="inline-flex items-center gap-1">
                                <MapPin
                                  size={12}
                                />
                                {report.location_name ||
                                  "Unknown location"}
                              </span>

                              <span className="inline-flex items-center gap-1">
                                <Users
                                  size={12}
                                />
                                {getPeopleAffected(
                                  report
                                ) ||
                                  "Unknown"}{" "}
                                people affected
                              </span>
                            </div>

                            <p className="mt-3 max-w-2xl whitespace-pre-line text-xs leading-5 text-slate-500">
                              {report.description ||
                                "No description provided."}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row lg:w-64 lg:flex-col">
                          <select
                            value={
                              team ||
                              ""
                            }
                            onChange={(
                              event
                            ) => {
                              if (
                                event
                                  .target
                                  .value
                              ) {
                                assignTeam(
                                  report.id,
                                  event
                                    .target
                                    .value
                                );
                              }
                            }}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-blue-500"
                          >
                            <option value="">
                              Assign response team
                            </option>

                            <option value="Emergency Response Team">
                              Emergency Response Team
                            </option>

                            <option value="Medical Support">
                              Medical Support
                            </option>

                            <option value="Rescue & Evacuation">
                              Rescue & Evacuation
                            </option>

                            <option value="Community Volunteers">
                              Community Volunteers
                            </option>

                            <option value="Local Authorities">
                              Local Authorities
                            </option>
                          </select>

                          {team && (
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                              <CheckCircle2
                                size={14}
                                className="text-emerald-600"
                              />

                              <span className="text-[10px] font-bold text-emerald-700">
                                Assigned: {team}
                              </span>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              openReport(
                                report
                              )
                            }
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[10px] font-extrabold text-white hover:bg-blue-700"
                          >
                            Open incident
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                }
              )}

            </div>

          </section>
        )}

        {/* ====================================================
            RESPONSE CENTER
        ==================================================== */}

        {activePanel ===
          "response" && (
          <ResponseCenter
            selectedReport={
              selectedReport
            }
            responseMessage={
              responseMessage
            }
            setResponseMessage={
              setResponseMessage
            }
            responseLanguage={
              responseLanguage
            }
            setResponseLanguage={
              setResponseLanguage
            }
            responseChannels={
              responseChannels
            }
            handleChannelToggle={
              handleChannelToggle
            }
            responseSent={
              responseSent
            }
            handleSendResponse={
              handleSendResponse
            }
            onChooseIncident={() =>
              setActivePanel(
                "overview"
              )
            }
          />
        )}

        {/* ====================================================
            WORKFLOW
        ==================================================== */}

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
              INCIDENT LIFECYCLE
            </p>

            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              From Detection to Resolution
            </h2>

            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
              AfriShield creates an operational path from the
              first community signal to coordinated response.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">

            {[
              {
                number: "01",
                label: "NEW",
                icon: ClipboardList,
              },
              {
                number: "02",
                label: "VERIFIED",
                icon: ClipboardCheck,
              },
              {
                number: "03",
                label: "PRIORITIZED",
                icon: ShieldAlert,
              },
              {
                number: "04",
                label: "ASSIGNED",
                icon: UserCheck,
              },
              {
                number: "05",
                label: "RESPONDING",
                icon: BellRing,
              },
              {
                number: "06",
                label: "RESOLVED",
                icon: CheckCircle2,
              },
            ].map(
              (step, index) => {
                const Icon =
                  step.icon;

                return (
                  <div
                    key={
                      step.label
                    }
                    className="relative rounded-xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-[10px] font-extrabold text-white">
                      {step.number}
                    </div>

                    <Icon
                      size={16}
                      className="mt-4 text-blue-600"
                    />

                    <p className="mt-2 text-[10px] font-extrabold tracking-wide text-slate-700">
                      {step.label}
                    </p>

                    {index <
                      5 && (
                      <ChevronRight
                        size={14}
                        className="absolute right-2 top-1/2 hidden -translate-y-1/2 text-slate-300 lg:block"
                      />
                    )}
                  </div>
                );
              }
            )}

          </div>

        </section>

        {/* ====================================================
            FOOTER
        ==================================================== */}

        <div className="flex flex-col gap-2 px-1 py-6 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            AfriShield Emergency Operations • Community
            Intelligence Network
          </span>

          <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Operations system active
          </span>
        </div>

      </section>

      {/* ======================================================
          REVIEW MODAL
      ====================================================== */}

      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">

          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">

            {/* MODAL HEADER */}

            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
                    INCIDENT COMMAND
                  </p>

                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[8px] font-extrabold text-blue-600">
                    LIVE REPORT
                  </span>
                </div>

                <h2 className="mt-1 text-lg font-extrabold text-slate-900">
                  {selectedReport.category ||
                    "Hazard Report"}
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedReport(
                    null
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
              >
                <X size={18} />
              </button>

            </div>

            <div className="grid lg:grid-cols-[1fr_0.85fr]">

              {/* LEFT - INCIDENT */}

              <div className="space-y-5 p-6">

                {/* AI PRIORITY */}

                <div className="overflow-hidden rounded-2xl border border-red-100 bg-red-50">

                  <div className="p-5">
                    <div className="flex items-center justify-between gap-4">

                      <div>
                        <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-red-500">
                          AI-ASSISTED PRIORITY
                        </p>

                        <p className="mt-1 text-3xl font-extrabold text-red-700">
                          {selectedPriority}
                          <span className="ml-1 text-sm text-red-400">
                            /100
                          </span>
                        </p>
                      </div>

                      <span className="rounded-full bg-white px-3 py-2 text-[9px] font-extrabold uppercase text-red-600 shadow-sm">
                        {
                          selectedPriorityLevel
                        }
                      </span>

                    </div>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{
                          width: `${selectedPriority}%`,
                        }}
                      />
                    </div>

                    <p className="mt-3 text-[10px] leading-5 text-red-600">
                      Priority considers incident severity,
                      community impact, assistance needs,
                      regional flood risk, evidence and
                      recency.
                    </p>
                  </div>

                </div>

                {/* INCIDENT DETAILS */}

                <div className="grid gap-3 sm:grid-cols-2">

                  <DetailBox
                    icon={
                      <MapPin
                        size={16}
                      />
                    }
                    label="Location"
                    value={
                      selectedReport.location_name ||
                      "Unknown"
                    }
                  />

                  <DetailBox
                    icon={
                      <Clock3
                        size={16}
                      />
                    }
                    label="Submitted"
                    value={formatDate(
                      selectedReport.submitted_at
                    )}
                  />

                  <DetailBox
                    icon={
                      <AlertTriangle
                        size={16}
                      />
                    }
                    label="Severity"
                    value={getSeverity(
                      selectedReport
                    )}
                  />

                  <DetailBox
                    icon={
                      <Users size={16} />
                    }
                    label="People affected"
                    value={
                      getPeopleAffected(
                        selectedReport
                      ) ||
                      "Not specified"
                    }
                  />

                </div>

                {/* AI PRIORITY EXPLANATION */}

                <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-extrabold uppercase tracking-wide text-red-600">
                        AI TRIAGE EXPLANATION
                      </p>
                      <p className="mt-1 text-sm font-extrabold text-red-900">
                        {selectedPriorityLevel} priority · {selectedPriority}/100
                      </p>
                    </div>
                    {priorityLoading && (
                      <RefreshCw size={14} className="animate-spin text-red-500" />
                    )}
                  </div>

                  {selectedAIIncident?.factors && (
                    <div className="mt-3 space-y-2">
                      {Object.entries(selectedAIIncident.factors).map(
                        ([factor, value]) => (
                          <div
                            key={factor}
                            className="rounded-lg bg-white/80 px-3 py-2"
                          >
                            <p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
                              {factor.replace(/_/g, " ")}
                            </p>
                            <p className="mt-0.5 text-[10px] leading-5 text-slate-600">
                              {formatFactorValue(value)}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {!selectedAIIncident && (
                    <p className="mt-2 text-[10px] leading-5 text-red-700">
                      AI priority details are still loading. The command center will use the backend triage result when available.
                    </p>
                  )}
                </div>

                {/* REGIONAL INTELLIGENCE */}

                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex items-start gap-3">
                    <Globe2
                      size={18}
                      className="mt-0.5 shrink-0 text-blue-600"
                    />

                    <div>
                      <p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">
                        REGIONAL INTELLIGENCE
                      </p>

                      <p className="mt-1 text-sm font-extrabold text-blue-900">
                        {
                          getRegionRisk(
                            selectedReport
                          ).level
                        }{" "}
                        flood-risk region
                      </p>

                      <p className="mt-1 text-[10px] leading-5 text-blue-700">
                        Regional risk score:{" "}
                        {
                          getRegionRisk(
                            selectedReport
                          ).score
                        }
                        /100
                      </p>
                    </div>
                  </div>
                </div>

                {/* DESCRIPTION */}

                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                    COMMUNITY REPORT
                  </p>

                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
                    {selectedReport.description ||
                      "No description provided."}
                  </p>
                </div>

                {/* EVIDENCE */}

                {selectedReport.has_photo && (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <img
                      src={`${REPORTS_API_URL}/${selectedReport.id}/photo`}
                      alt="Community hazard evidence"
                      className="max-h-[450px] w-full object-cover"
                    />

                    <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-3">
                      <p className="text-[9px] font-extrabold uppercase tracking-wide text-indigo-600">
                        PHOTO EVIDENCE
                      </p>

                      <span className="text-[9px] font-bold text-slate-400">
                        Verified source: community
                      </span>
                    </div>
                  </div>
                )}

              </div>

              {/* RIGHT - COMMAND */}

              <div className="border-t border-slate-100 bg-slate-50/60 p-6 lg:border-l lg:border-t-0">

                {actionError && (
                  <div className="mb-5 rounded-xl border border-red-100 bg-red-50 p-4">
                    <p className="text-[10px] font-extrabold text-red-700">
                      COMMAND ACTION FAILED
                    </p>
                    <p className="mt-1 text-[10px] leading-5 text-red-600">
                      {actionError}
                    </p>
                  </div>
                )}

                {/* STATUS */}

                <div>
                  <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
                    INCIDENT STATUS
                  </p>

                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-700">
                        Current status
                      </span>

                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-extrabold text-blue-600">
                        {getIncidentStatus(
                          selectedReport
                        )}
                      </span>
                    </div>

                    <select
                      value={getIncidentStatus(
                        selectedReport
                      )}
                      onChange={(event) =>
                        setIncidentStatus(
                          selectedReport.id,
                          event.target.value
                        )
                      }
                      className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-blue-500"
                    >
                      <option value="NEW">
                        New
                      </option>

                      <option value="VERIFYING">
                        Verifying
                      </option>

                      <option value="PRIORITIZED">
                        Prioritized
                      </option>

                      <option value="ASSIGNED">
                        Assigned
                      </option>

                      <option value="RESPONDING">
                        Responding
                      </option>

                      <option value="RESOLVED">
                        Resolved
                      </option>
                    </select>
                  </div>
                </div>

                {/* VERIFICATION */}

                <div className="mt-5">
                  <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
                    VERIFICATION
                  </p>

                  <div className="mt-3 grid gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        verifyIncident(
                          selectedReport.id,
                          true,
                          "Evidence reviewed by admin."
                        );
                      }}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-[10px] font-extrabold text-white hover:bg-emerald-700"
                    >
                      <ClipboardCheck
                        size={15}
                      />
                      Verify report
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        verifyIncident(
                          selectedReport.id,
                          false,
                          "Flagged for further human review."
                        );
                      }}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[10px] font-extrabold text-slate-600 hover:bg-slate-50"
                    >
                      Flag for further review
                    </button>
                  </div>
                </div>

                {/* ASSIGN */}

                <div className="mt-5">
                  <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
                    RESPONSE ASSIGNMENT
                  </p>

                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">

                    <select
                      value={
                        getAssignedTeam(
                          selectedReport
                        )
                      }
                      onChange={(event) => {
                        if (
                          event.target
                            .value
                        ) {
                          assignTeam(
                            selectedReport.id,
                            event.target
                              .value
                          );
                        }
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-blue-500"
                    >
                      <option value="">
                        Select response team
                      </option>

                      <option value="Emergency Response Team">
                        Emergency Response Team
                      </option>

                      <option value="Medical Support">
                        Medical Support
                      </option>

                      <option value="Rescue & Evacuation">
                        Rescue & Evacuation
                      </option>

                      <option value="Community Volunteers">
                        Community Volunteers
                      </option>

                      <option value="Local Authorities">
                        Local Authorities
                      </option>
                    </select>

                    {assignedTeams[
                      selectedReport.id
                    ] && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3">
                        <CheckCircle2
                          size={14}
                          className="text-emerald-600"
                        />

                        <span className="text-[10px] font-bold text-emerald-700">
                          {
                            assignedTeams[
                              selectedReport.id
                            ]
                          }
                        </span>
                      </div>
                    )}

                  </div>
                </div>

                {/* RESPONSE */}

                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
                      RESPONSE CENTER
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setActivePanel(
                          "response"
                        );
                      }}
                      className="text-[9px] font-extrabold text-blue-600 hover:text-blue-700"
                    >
                      Expand
                    </button>
                  </div>

                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">

                    <textarea
                      value={
                        responseMessage
                      }
                      onChange={(event) => {
                        setResponseMessage(
                          event.target
                            .value
                        );
                        setResponseSent(
                          false
                        );
                      }}
                      rows={4}
                      placeholder="Write a community warning..."
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                    />

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <select
                        value={
                          responseLanguage
                        }
                        onChange={(
                          event
                        ) => {
                          setResponseLanguage(
                            event
                              .target
                              .value
                          );
                          setResponseSent(
                            false
                          );
                        }}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 outline-none"
                      >
                        <option>
                          English
                        </option>

                        <option>
                          Swahili
                        </option>

                        <option>
                          Somali
                        </option>

                        <option>
                          Arabic
                        </option>
                      </select>

                      <button
                        type="button"
                        onClick={
                          handleSendResponse
                        }
                        disabled={
                          !responseMessage.trim()
                        }
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-[10px] font-extrabold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send
                          size={13}
                        />
                        Prepare response
                      </button>
                    </div>

                    {responseSent && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3">
                        <CheckCircle2
                          size={14}
                          className="mt-0.5 text-emerald-600"
                        />

                        <p className="text-[10px] font-bold leading-5 text-emerald-700">
                          Response prepared for{" "}
                          {
                            responseLanguage
                          } channels. The notification endpoint can be connected here.
                        </p>
                      </div>
                    )}

                  </div>
                </div>

                {/* ASSISTANCE */}

                {selectedReport.needs_assistance && (
                  <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4">
                    <Users
                      size={17}
                      className="mt-0.5 shrink-0 text-red-600"
                    />

                    <div>
                      <p className="text-xs font-extrabold text-red-700">
                        Assistance requested
                      </p>

                      <p className="mt-1 text-[10px] leading-5 text-red-600">
                        This incident requires human
                        assistance coordination.
                      </p>
                    </div>
                  </div>
                )}

              </div>

            </div>

          </div>
        </div>
      )}

    </main>
  );
}

/*
|--------------------------------------------------------------------------
| INCIDENT MAP
|--------------------------------------------------------------------------
*/

function IncidentMap({
  reports,
  allReports,
  onOpenReport,
  calculatePriority,
  getPriorityLevel,
  getPriorityLevelForReport,
  mapLoading,
  mapError,
}) {
  /*
   * This is a lightweight frontend map visualization.
   *
   * It does NOT pretend to be a geographic map when coordinates
   * are unavailable.
   *
   * When we later add a mapping library/API, this component can
   * be replaced without changing the command center.
   */

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      <div className="border-b border-slate-100 px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
              SITUATIONAL AWARENESS
            </p>

            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              Live Community Incident Map
            </h2>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Geographic incidents with available coordinates
              are highlighted for operational awareness.
            </p>

            {mapLoading && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[9px] font-extrabold text-blue-600">
                <RefreshCw size={12} className="animate-spin" />
                Syncing live incident map...
              </div>
            )}

            {mapError && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[9px] font-bold leading-4 text-amber-700">
                {mapError}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-blue-50 px-4 py-3">
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-blue-600">
              MAPPED INCIDENTS
            </p>

            <p className="mt-1 text-xl font-extrabold text-blue-800">
              {reports.length}
            </p>
          </div>

        </div>
      </div>

      <div className="grid lg:grid-cols-[1.5fr_0.5fr]">

        {/* VISUAL MAP */}

        <div className="relative min-h-[520px] overflow-hidden bg-slate-100">

          {/* Grid */}

          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)",
              backgroundSize:
                "50px 50px",
            }}
          />

          {/* Water-like center */}

          <div className="absolute left-[38%] top-[10%] h-[80%] w-[24%] rounded-[50%] bg-blue-100/60 blur-2xl" />

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-white/80 bg-white/70 px-6 py-4 text-center shadow-sm backdrop-blur">
              <Globe2
                size={28}
                className="mx-auto text-blue-500"
              />

              <p className="mt-2 text-xs font-extrabold text-slate-700">
                AFRISHIELD INCIDENT FIELD
              </p>

              <p className="mt-1 text-[9px] leading-5 text-slate-400">
                Real coordinates appear as operational
                incident markers.
              </p>
            </div>
          </div>

          {/* MARKERS */}

          {reports.map(
            (report, index) => {
              const backendMapScore =
                Number(report.map_priority_score);

              const score =
                Number.isFinite(backendMapScore)
                  ? Math.round(backendMapScore * 100)
                  : calculatePriority(report);

              const level =
                report.map_priority_level
                  ? String(report.map_priority_level).charAt(0).toUpperCase() +
                    String(report.map_priority_level).slice(1).toLowerCase()
                  : getPriorityLevel(score);

              const position =
                getGeoMarkerPosition(
                  report,
                  reports
                );

              return (
                <button
                  key={report.id}
                  type="button"
                  onClick={() =>
                    onOpenReport(
                      report
                    )
                  }
                  title={`${report.category || "Incident"} — ${level}`}
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition hover:z-20 hover:scale-125"
                  style={{
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                  }}
                >
                  <span
                    className={`absolute inset-0 animate-ping rounded-full opacity-40 ${
                      level ===
                      "Critical"
                        ? "bg-red-500"
                        : level ===
                          "High"
                        ? "bg-orange-500"
                        : level ===
                          "Medium"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                  />

                  <span
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-lg ${
                      level ===
                      "Critical"
                        ? "bg-red-600 text-white"
                        : level ===
                          "High"
                        ? "bg-orange-500 text-white"
                        : level ===
                          "Medium"
                        ? "bg-amber-500 text-white"
                        : "bg-emerald-500 text-white"
                    }`}
                  >
                    <MapPin
                      size={15}
                    />
                  </span>

                  <span className="absolute left-1/2 top-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[8px] font-bold text-white group-hover:block">
                    {report.location_name}
                  </span>
                </button>
              );
            }
          )}

          {/* LEGEND */}

          <div className="absolute bottom-4 left-4 rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm backdrop-blur">
            <p className="mb-2 text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
              Priority
            </p>

            <MapLegend
              color="bg-red-600"
              label="Critical"
            />

            <MapLegend
              color="bg-orange-500"
              label="High"
            />

            <MapLegend
              color="bg-amber-500"
              label="Medium"
            />

            <MapLegend
              color="bg-emerald-500"
              label="Low"
            />
          </div>

        </div>

        {/* MAP SIDE PANEL */}

        <div className="border-t border-slate-100 p-5 lg:border-l lg:border-t-0">

          <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
            MAP INTELLIGENCE
          </p>

          <h3 className="mt-1 text-lg font-extrabold text-slate-900">
            Incident Overview
          </h3>

          <div className="mt-5 space-y-3">

            <MapSummary
              label="All reports"
              value={
                allReports.length
              }
            />

            <MapSummary
              label="With coordinates"
              value={
                reports.length
              }
            />

            <MapSummary
              label="Critical"
              value={
                allReports.filter(
                  (report) =>
                    getPriorityLevelForReport(
                      report
                    ) ===
                    "Critical"
                ).length
              }
            />

            <MapSummary
              label="Assistance"
              value={
                allReports.filter(
                  (report) =>
                    report.needs_assistance
                ).length
              }
            />

          </div>

          {reports.length ===
            0 && (
            <div className="mt-5 rounded-xl bg-amber-50 p-4">
              <p className="text-[10px] font-extrabold text-amber-700">
                Coordinate data unavailable
              </p>

              <p className="mt-1 text-[10px] leading-5 text-amber-600">
                Reports can still be reviewed, but the current
                submissions do not contain latitude and
                longitude values.
              </p>
            </div>
          )}

          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <Navigation
                size={16}
                className="mt-0.5 text-blue-600"
              />

              <p className="text-[10px] leading-5 text-blue-700">
                The live admin map endpoint returns only incidents
                with real latitude and longitude fixes, so the map
                stays operationally honest and never invents locations.
              </p>
            </div>
          </div>

        </div>

      </div>

    </section>
  );
}

/*
|--------------------------------------------------------------------------
| RESPONSE CENTER
|--------------------------------------------------------------------------
*/

function ResponseCenter({
  selectedReport,
  responseMessage,
  setResponseMessage,
  responseLanguage,
  setResponseLanguage,
  responseChannels,
  handleChannelToggle,
  responseSent,
  handleSendResponse,
  onChooseIncident,
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      <div className="border-b border-slate-100 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <BellRing
              size={19}
            />
          </div>

          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
              LAST-MILE RESPONSE
            </p>

            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              Response Center
            </h2>

            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
              Prepare localized emergency communication for
              the channels communities actually use.
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_0.75fr]">

        {/* COMPOSER */}

        <div className="space-y-5 p-6">

          {!selectedReport && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={17}
                  className="mt-0.5 text-amber-600"
                />

                <div>
                  <p className="text-xs font-extrabold text-amber-700">
                    Select an incident first
                  </p>

                  <p className="mt-1 text-[10px] leading-5 text-amber-600">
                    Open a report from the Priority Queue and
                    use the Response Center to prepare a
                    targeted warning.
                  </p>

                  <button
                    type="button"
                    onClick={
                      onChooseIncident
                    }
                    className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-extrabold text-white hover:bg-amber-700"
                  >
                    Open priority queue
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedReport && (
            <>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600">
                    <MapPin
                      size={16}
                    />
                  </div>

                  <div>
                    <p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                      TARGET INCIDENT
                    </p>

                    <p className="mt-1 text-sm font-extrabold text-slate-800">
                      {selectedReport.location_name}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="responseMessage"
                    className="text-xs font-extrabold text-slate-700"
                  >
                    Emergency message
                  </label>

                  <span className="text-[9px] font-bold text-slate-400">
                    {
                      responseMessage.length
                    }{" "}
                    characters
                  </span>
                </div>

                <textarea
                  id="responseMessage"
                  value={
                    responseMessage
                  }
                  onChange={(event) =>
                    setResponseMessage(
                      event.target
                        .value
                    )
                  }
                  rows={7}
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  placeholder="Write the warning that should reach the community..."
                />
              </div>

              <div>
                <p className="text-xs font-extrabold text-slate-700">
                  Alert language
                </p>

                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">

                  {[
                    "English",
                    "Swahili",
                    "Somali",
                    "Arabic",
                  ].map(
                    (language) => (
                      <button
                        key={
                          language
                        }
                        type="button"
                        onClick={() => {
                          setResponseLanguage(
                            language
                          );
                        }}
                        className={`rounded-lg border px-3 py-2.5 text-[10px] font-extrabold transition ${
                          responseLanguage ===
                          language
                            ? "border-blue-500 bg-blue-50 text-blue-600"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {language}
                      </button>
                    )
                  )}

                </div>
              </div>

              <div>
                <p className="text-xs font-extrabold text-slate-700">
                  Delivery channels
                </p>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">

                  <ChannelButton
                    active={
                      responseChannels.sms
                    }
                    onClick={() =>
                      handleChannelToggle(
                        "sms"
                      )
                    }
                    icon={
                      <MessageSquare
                        size={16}
                      />
                    }
                    label="SMS"
                    description="Mobile text alert"
                  />

                  <ChannelButton
                    active={
                      responseChannels.voice
                    }
                    onClick={() =>
                      handleChannelToggle(
                        "voice"
                      )
                    }
                    icon={
                      <Volume2
                        size={16}
                      />
                    }
                    label="Voice"
                    description="Accessible voice warning"
                  />

                  <ChannelButton
                    active={
                      responseChannels.radio
                    }
                    onClick={() =>
                      handleChannelToggle(
                        "radio"
                      )
                    }
                    icon={
                      <Radio size={16} />
                    }
                    label="Radio"
                    description="Local broadcast"
                  />

                  <ChannelButton
                    active={
                      responseChannels.community
                    }
                    onClick={() =>
                      handleChannelToggle(
                        "community"
                      )
                    }
                    icon={
                      <Users size={16} />
                    }
                    label="Community leaders"
                    description="Trusted local networks"
                  />

                </div>
              </div>

              <button
                type="button"
                onClick={
                  handleSendResponse
                }
                disabled={
                  !responseMessage.trim() ||
                  !Object.values(
                    responseChannels
                  ).some(
                    Boolean
                  )
                }
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-xs font-extrabold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={16} />
                Prepare Community Warning
              </button>

              {responseSent && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2
                      size={18}
                      className="mt-0.5 text-emerald-600"
                    />

                    <div>
                      <p className="text-sm font-extrabold text-emerald-700">
                        Response prepared
                      </p>

                      <p className="mt-1 text-xs leading-5 text-emerald-600">
                        The warning is prepared in{" "}
                        {
                          responseLanguage
                        } for the selected delivery channels.
                        Connect the notification endpoint when
                        the backend is ready.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* PREVIEW */}

        <div className="border-t border-slate-100 bg-slate-50/60 p-6 lg:border-l lg:border-t-0">

          <div className="flex items-center gap-2">
            <Languages
              size={16}
              className="text-indigo-600"
            />

            <p className="text-[9px] font-extrabold uppercase tracking-[1.4px] text-indigo-600">
              MESSAGE PREVIEW
            </p>
          </div>

          <h3 className="mt-2 text-lg font-extrabold text-slate-900">
            Last-mile warning
          </h3>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 bg-blue-600 px-4 py-3 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert
                    size={15}
                  />

                  <span className="text-[10px] font-extrabold">
                    AFRISHIELD ALERT
                  </span>
                </div>

                <span className="text-[9px] font-bold text-blue-100">
                  {responseLanguage}
                </span>
              </div>
            </div>

            <div
              className={`p-5 ${
                responseLanguage ===
                "Arabic"
                  ? "text-right"
                  : "text-left"
              }`}
              dir={
                responseLanguage ===
                "Arabic"
                  ? "rtl"
                  : "ltr"
              }
            >
              <p className="text-xs font-extrabold text-slate-800">
                {selectedReport
                  ? selectedReport.location_name
                  : "Select an incident"}
              </p>

              <p className="mt-3 text-xs leading-6 text-slate-600">
                {responseMessage ||
                  "Your emergency warning will appear here."}
              </p>

              <div className="mt-5 rounded-lg bg-red-50 p-3">
                <p className="text-[9px] font-extrabold text-red-600">
                  SAFETY INSTRUCTION
                </p>

                <p className="mt-1 text-[10px] leading-5 text-red-600">
                  Avoid flooded roads and follow instructions
                  from local authorities and emergency
                  responders.
                </p>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-bold text-slate-400">
                Delivery:
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {responseChannels.sms && (
                  <PreviewChannel
                    label="SMS"
                  />
                )}

                {responseChannels.voice && (
                  <PreviewChannel
                    label="Voice"
                  />
                )}

                {responseChannels.radio && (
                  <PreviewChannel
                    label="Radio"
                  />
                )}

                {responseChannels.community && (
                  <PreviewChannel
                    label="Community"
                  />
                )}
              </div>
            </div>

          </div>

          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <div className="flex items-start gap-3">
              <AccessibilityIcon />

              <p className="text-[10px] leading-5 text-indigo-700">
                Multi-channel communication helps warnings
                reach people who may have limited smartphone,
                internet, literacy or accessibility access.
              </p>
            </div>
          </div>

        </div>

      </div>

    </section>
  );
}

/*
|--------------------------------------------------------------------------
| COMPONENTS
|--------------------------------------------------------------------------
*/

function StatCard({
  icon,
  label,
  value,
  iconStyle,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconStyle}`}
        >
          {icon}
        </div>

        <span className="text-3xl font-extrabold text-slate-900">
          {value}
        </span>
      </div>

      <p className="mt-4 text-sm font-bold text-slate-500">
        {label}
      </p>
    </div>
  );
}

function BannerMetric({
  value,
  label,
}) {
  return (
    <div className="min-w-[80px] rounded-xl bg-white/10 p-3 backdrop-blur">
      <p className="text-xl font-extrabold">
        {value}
      </p>

      <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-blue-100">
        {label}
      </p>
    </div>
  );
}

function StatusPill({
  label,
  active,
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active
            ? "bg-emerald-500"
            : "bg-red-500"
        }`}
      />

      <span className="text-[9px] font-extrabold text-slate-500">
        {label}
      </span>

      <span
        className={`text-[8px] font-extrabold ${
          active
            ? "text-emerald-600"
            : "text-red-600"
        }`}
      >
        {active
          ? "ONLINE"
          : "ERROR"}
      </span>
    </div>
  );
}

function CommandTab({
  active,
  onClick,
  icon,
  label,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-extrabold transition ${
        active
          ? "bg-blue-600 text-white shadow-sm"
          : "text-slate-500 hover:bg-slate-50 hover:text-blue-600"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MiniMetric({
  label,
  value,
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 truncate text-[10px] font-extrabold text-slate-700">
        {value}
      </p>
    </div>
  );
}

function DetailBox({
  icon,
  label,
  value,
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-blue-600">
        {icon}

        <p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
          {label}
        </p>
      </div>

      <p className="mt-2 text-sm font-extrabold text-slate-800">
        {value}
      </p>
    </div>
  );
}

function ChannelButton({
  active,
  onClick,
  icon,
  label,
  description,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
        active
          ? "border-blue-200 bg-blue-50"
          : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
          active
            ? "bg-blue-600 text-white"
            : "bg-slate-100 text-slate-500"
        }`}
      >
        {icon}
      </div>

      <div className="min-w-0">
        <p
          className={`text-[10px] font-extrabold ${
            active
              ? "text-blue-700"
              : "text-slate-700"
          }`}
        >
          {label}
        </p>

        <p className="mt-0.5 text-[9px] text-slate-400">
          {description}
        </p>
      </div>
    </button>
  );
}

function PreviewChannel({
  label,
}) {
  return (
    <span className="rounded-full bg-white px-2.5 py-1 text-[8px] font-extrabold text-slate-500 ring-1 ring-slate-200">
      {label}
    </span>
  );
}

function MapLegend({
  color,
  label,
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${color}`}
      />

      <span className="text-[9px] font-bold text-slate-500">
        {label}
      </span>
    </div>
  );
}

function MapSummary({
  label,
  value,
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
      <span className="text-[10px] font-bold text-slate-500">
        {label}
      </span>

      <span className="text-sm font-extrabold text-slate-800">
        {value}
      </span>
    </div>
  );
}

function AccessibilityIcon() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
      <Volume2 size={15} />
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| MARKER POSITION
|--------------------------------------------------------------------------
|
| If coordinates exist, normalize them into the visual field.
| Otherwise distribute the markers safely so the UI still shows
| the incident queue.
|
*/

function getGeoMarkerPosition(report, reports) {
  const coordinates = reports
    .map((item) => ({
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.latitude) &&
        Number.isFinite(item.longitude)
    );

  if (!coordinates.length) {
    return { x: 50, y: 50 };
  }

  const latitudes = coordinates.map((item) => item.latitude);
  const longitudes = coordinates.map((item) => item.longitude);

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  const latRange = maxLat - minLat || 1;
  const lonRange = maxLon - minLon || 1;

  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);

  const x = 8 + ((longitude - minLon) / lonRange) * 84;
  const y = 88 - ((latitude - minLat) / latRange) * 76;

  return {
    x: Math.max(5, Math.min(95, x)),
    y: Math.max(8, Math.min(92, y)),
  };
}

function getMarkerPosition(
  report,
  index,
  total
) {
  const latitude =
    Number(report.latitude);

  const longitude =
    Number(report.longitude);

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    /*
     * Approximate East Africa / Africa operational bounds.
     *
     * This is only a visual fallback until a real map
     * library is connected.
     */

    const minLat = -20;
    const maxLat = 20;

    const minLng = 20;
    const maxLng = 55;

    const x =
      ((longitude - minLng) /
        (maxLng - minLng)) *
      100;

    const y =
      100 -
      ((latitude - minLat) /
        (maxLat - minLat)) *
        100;

    return {
      x: Math.max(
        5,
        Math.min(95, x)
      ),
      y: Math.max(
        5,
        Math.min(95, y)
      ),
    };
  }

  /*
   * No coordinates:
   * deterministic fallback positions.
   */

  const safeTotal =
    Math.max(total, 1);

  return {
    x:
      15 +
      ((index * 37) %
        Math.max(
          70,
          safeTotal * 10
        )),
    y:
      20 +
      ((index * 29) % 60),
  };
}

export default AdminCommandCenter;