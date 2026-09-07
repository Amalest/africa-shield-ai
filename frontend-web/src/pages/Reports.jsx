import {
  Accessibility,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Globe2,
  Image,
  Languages,
  MapPin,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Users,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const REGIONS_API_URL = "http://localhost:8000/api/regions";
const REPORTS_API_URL = "http://localhost:8000/api/hazard-reports";

function Reports() {
  // ============================================================
  // REGIONAL DATA
  // ============================================================

  const [regions, setRegions] = useState([]);
  const [loadingRegions, setLoadingRegions] = useState(true);
  const [regionError, setRegionError] = useState("");

  // ============================================================
  // FORM STATE
  // ============================================================

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [form, setForm] = useState({
    region: "",
    incidentType: "",
    severity: "",
    peopleAffected: "",
    description: "",
  });

  // ============================================================
  // PHOTO STATE
  // ============================================================

  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoError, setPhotoError] = useState("");

  // ============================================================
  // FETCH REGIONS
  // ============================================================

  const fetchRegions = useCallback(async () => {
    try {
      setLoadingRegions(true);
      setRegionError("");

      const response = await fetch(REGIONS_API_URL);

      if (!response.ok) {
        throw new Error(
          `Regional API returned status ${response.status}`
        );
      }

      const data = await response.json();

      setRegions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching regional data:", error);

      setRegionError(
        error.message || "Unable to load regional data."
      );
    } finally {
      setLoadingRegions(false);
    }
  }, []);

  // ============================================================
  // LOAD REGIONAL DATA WHEN PAGE OPENS
  // ============================================================

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // ============================================================
  // CLEAN UP PHOTO PREVIEW URL
  // ============================================================

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  // ============================================================
  // RISK SUMMARY
  // ============================================================

  const riskSummary = useMemo(() => {
    const high = regions.filter(
      (region) =>
        region.risk_level?.toLowerCase() === "high"
    ).length;

    const medium = regions.filter(
      (region) =>
        region.risk_level?.toLowerCase() === "medium"
    ).length;

    const low = regions.filter(
      (region) =>
        region.risk_level?.toLowerCase() === "low"
    ).length;

    return {
      high,
      medium,
      low,
      total: regions.length,
    };
  }, [regions]);

  // ============================================================
  // HIGH-RISK REGIONS
  // ============================================================

  const highRiskRegions = useMemo(() => {
    return regions
      .filter(
        (region) =>
          region.risk_level?.toLowerCase() === "high"
      )
      .sort((a, b) => {
        const scoreA = Number(
          a.risk_score ??
            a.risk_score_breakdown?.risk_score ??
            0
        );

        const scoreB = Number(
          b.risk_score ??
            b.risk_score_breakdown?.risk_score ??
            0
        );

        return scoreB - scoreA;
      });
  }, [regions]);

  // ============================================================
  // HELPER: REGION NAME
  // ============================================================

  const getRegionName = (locationName, country) => {
    if (!locationName) {
      return "Unknown region";
    }

    if (
      country &&
      locationName.endsWith(`, ${country}`)
    ) {
      return locationName.replace(`, ${country}`, "");
    }

    return locationName.split(",")[0].trim();
  };

  // ============================================================
  // HELPER: RISK SCORE
  // ============================================================

  const getRiskScore = (region) => {
    const rawScore =
      region.risk_score ??
      region.risk_score_breakdown?.risk_score ??
      0;

    const score = Number(rawScore);

    if (Number.isNaN(score)) {
      return 0;
    }

    return score <= 1
      ? Math.round(score * 100)
      : Math.round(score);
  };

  // ============================================================
  // FORM CHANGE
  // ============================================================

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setSubmitted(false);
    setSubmitError("");
  };

  // ============================================================
  // PHOTO CHANGE
  // ============================================================

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0] || null;

    setPhotoError("");
    setSubmitError("");
    setSubmitted(false);

    if (!file) {
      setSelectedPhoto(null);
      setPhotoPreview("");
      return;
    }

    // Backend maximum: 8 MB
    if (file.size > 8 * 1024 * 1024) {
      setSelectedPhoto(null);
      setPhotoPreview("");
      setPhotoError("Photo must be smaller than 8 MB.");
      event.target.value = "";
      return;
    }

    // Backend-supported image types
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setSelectedPhoto(null);
      setPhotoPreview("");
      setPhotoError(
        "Please upload a JPEG, PNG, or WebP image."
      );
      event.target.value = "";
      return;
    }

    setSelectedPhoto(file);

    const previewUrl = URL.createObjectURL(file);
    setPhotoPreview(previewUrl);
  };

  // ============================================================
  // REMOVE SELECTED PHOTO
  // ============================================================

  const removeSelectedPhoto = () => {
    setSelectedPhoto(null);
    setPhotoPreview("");
    setPhotoError("");

    const photoInput =
      document.getElementById("hazardPhoto");

    if (photoInput) {
      photoInput.value = "";
    }
  };

  // ============================================================
  // SUBMIT COMMUNITY REPORT
  // ============================================================

  const handleSubmit = async (event) => {
    event.preventDefault();

    setSubmitting(true);
    setSubmitted(false);
    setSubmitError("");

    try {
      // --------------------------------------------------------
      // VALIDATION
      // --------------------------------------------------------

      if (!form.region) {
        throw new Error(
          "Please select an affected region."
        );
      }

      if (!form.incidentType) {
        throw new Error(
          "Please select an incident type."
        );
      }

      if (!form.severity) {
        throw new Error(
          "Please select the severity."
        );
      }

      if (!form.description.trim()) {
        throw new Error(
          "Please describe what is happening."
        );
      }

      // --------------------------------------------------------
      // BUILD DESCRIPTION
      // --------------------------------------------------------

      const reportDescription = [
        form.description.trim(),
        `Severity: ${form.severity}`,
        form.peopleAffected
          ? `Estimated people affected: ${form.peopleAffected}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      // --------------------------------------------------------
      // ASSISTANCE FLAG
      // --------------------------------------------------------

      const needsAssistance =
        form.severity === "Critical" ||
        form.incidentType === "Evacuation needed";

      // --------------------------------------------------------
      // BACKEND PAYLOAD
      // --------------------------------------------------------

      const payload = {
        category: form.incidentType,
        description: reportDescription,
        location_name: form.region,
        needs_assistance: needsAssistance,
        latitude: null,
        longitude: null,
      };

      console.log(
        "Submitting hazard report:",
        payload
      );

      // --------------------------------------------------------
      // CREATE REPORT
      // --------------------------------------------------------

      const response = await fetch(
        REPORTS_API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      // --------------------------------------------------------
      // READ RESPONSE
      // --------------------------------------------------------

      let responseData = null;

      try {
        responseData = await response.json();
      } catch {
        responseData = null;
      }

      // --------------------------------------------------------
      // HANDLE REPORT ERROR
      // --------------------------------------------------------

      if (!response.ok) {
        const backendMessage =
          responseData?.detail ||
          `Server returned status ${response.status}`;

        if (Array.isArray(backendMessage)) {
          throw new Error(
            backendMessage
              .map(
                (item) =>
                  item.msg || "Validation error"
              )
              .join(", ")
          );
        }

        throw new Error(
          String(backendMessage)
        );
      }

      console.log(
        "Hazard report created:",
        responseData
      );

      // --------------------------------------------------------
      // UPLOAD PHOTO
      // --------------------------------------------------------

      if (selectedPhoto && responseData?.id) {
        const photoFormData = new FormData();

        photoFormData.append(
          "photo",
          selectedPhoto
        );

        console.log(
          "Uploading hazard report photo..."
        );

        const photoResponse = await fetch(
          `${REPORTS_API_URL}/${responseData.id}/photo`,
          {
            method: "POST",
            body: photoFormData,
          }
        );

        let photoResponseData = null;

        try {
          photoResponseData =
            await photoResponse.json();
        } catch {
          photoResponseData = null;
        }

        if (!photoResponse.ok) {
          const photoBackendMessage =
            photoResponseData?.detail ||
            `Photo upload failed with status ${photoResponse.status}`;

          throw new Error(
            `Report was submitted, but the photo could not be uploaded: ${photoBackendMessage}`
          );
        }

        console.log(
          "Hazard report photo uploaded:",
          photoResponseData
        );
      }

      // ========================================================
      // SUCCESS
      // ========================================================

      setSubmitted(true);

      // Clear form
      setForm({
        region: "",
        incidentType: "",
        severity: "",
        peopleAffected: "",
        description: "",
      });

      // Clear photo
      setSelectedPhoto(null);
      setPhotoPreview("");
      setPhotoError("");

      const photoInput =
        document.getElementById("hazardPhoto");

      if (photoInput) {
        photoInput.value = "";
      }
    } catch (error) {
      console.error(
        "Error submitting hazard report:",
        error
      );

      setSubmitError(
        error.message ||
          "Report could not be submitted. Please make sure the FastAPI backend is running on port 8000."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // REFRESH REGIONAL DATA
  // ============================================================

  const refreshAllData = async () => {
    await fetchRegions();
  };

  return (
    <main className="min-h-full bg-slate-50/70 px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">

        {/* ======================================================
            PAGE HEADER
        ====================================================== */}

        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-600" />

              <p className="text-[10px] font-extrabold uppercase tracking-[1.7px] text-blue-600">
                COMMUNITY SAFETY
              </p>
            </div>

            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Reports & Community Response
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Connect ground-level community information
              with AfriShield flood intelligence to support
              faster, more inclusive response.
            </p>
          </div>

          <button
            type="button"
            onClick={refreshAllData}
            disabled={loadingRegions}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 lg:self-auto"
          >
            <RefreshCw
              size={15}
              className={
                loadingRegions
                  ? "animate-spin"
                  : ""
              }
            />

            Refresh data
          </button>
        </div>

        {/* ======================================================
            COMMUNITY IMPACT BANNER
        ====================================================== */}

        <div className="mt-7 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 p-6 text-white shadow-lg shadow-blue-100">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                  <Globe2 size={19} />
                </div>

                <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-blue-100">
                  LAST-MILE FLOOD INTELLIGENCE
                </p>
              </div>

              <h2 className="mt-4 text-xl font-extrabold sm:text-2xl">
                The community can become part of the
                warning system.
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
                AI and environmental monitoring can identify
                flood risk, while people on the ground provide
                valuable information about what is actually
                happening in their communities.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[420px]">
              <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <Radio size={17} />

                <p className="mt-2 text-[10px] font-bold text-blue-100">
                  Radio
                </p>
              </div>

              <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <BellRing size={17} />

                <p className="mt-2 text-[10px] font-bold text-blue-100">
                  SMS
                </p>
              </div>

              <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <Volume2 size={17} />

                <p className="mt-2 text-[10px] font-bold text-blue-100">
                  Voice
                </p>
              </div>

              <div className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <Users size={17} />

                <p className="mt-2 text-[10px] font-bold text-blue-100">
                  Community
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ======================================================
            MAIN GRID
        ====================================================== */}

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">

          {/* ====================================================
              REPORT FORM
          ==================================================== */}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <ClipboardList size={19} />
                </div>

                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
                    COMMUNITY REPORTING
                  </p>

                  <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                    Report a Flood Incident
                  </h2>

                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Share information from the ground to
                    support faster assessment and response.
                  </p>
                </div>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-5 p-6"
            >
              {/* REGION */}

              <div>
                <label
                  htmlFor="region"
                  className="mb-2 block text-xs font-bold text-slate-700"
                >
                  Affected region
                </label>

                <select
                  id="region"
                  name="region"
                  value={form.region}
                  onChange={handleChange}
                  required
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                >
                  <option value="">
                    Select a monitored region
                  </option>

                  {regions.map(
                    (region, index) => (
                      <option
                        key={`${region.location_name}-${index}`}
                        value={region.location_name}
                      >
                        {getRegionName(
                          region.location_name,
                          region.country
                        )}{" "}
                        — {region.country}
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* INCIDENT + SEVERITY */}

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="incidentType"
                    className="mb-2 block text-xs font-bold text-slate-700"
                  >
                    Incident type
                  </label>

                  <select
                    id="incidentType"
                    name="incidentType"
                    value={form.incidentType}
                    onChange={handleChange}
                    required
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  >
                    <option value="">
                      Select incident
                    </option>

                    <option value="Flooding">
                      Flooding
                    </option>

                    <option value="Rising water">
                      Rising water
                    </option>

                    <option value="Blocked road">
                      Blocked road
                    </option>

                    <option value="Damaged infrastructure">
                      Damaged infrastructure
                    </option>

                    <option value="Evacuation needed">
                      People need evacuation
                    </option>

                    <option value="Other">
                      Other
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="severity"
                    className="mb-2 block text-xs font-bold text-slate-700"
                  >
                    Severity
                  </label>

                  <select
                    id="severity"
                    name="severity"
                    value={form.severity}
                    onChange={handleChange}
                    required
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  >
                    <option value="">
                      Select severity
                    </option>

                    <option value="Low">
                      Low
                    </option>

                    <option value="Medium">
                      Medium
                    </option>

                    <option value="High">
                      High
                    </option>

                    <option value="Critical">
                      Critical
                    </option>
                  </select>
                </div>
              </div>

              {/* PEOPLE AFFECTED */}

              <div>
                <label
                  htmlFor="peopleAffected"
                  className="mb-2 block text-xs font-bold text-slate-700"
                >
                  Estimated people affected
                </label>

                <input
                  id="peopleAffected"
                  name="peopleAffected"
                  type="number"
                  min="0"
                  value={form.peopleAffected}
                  onChange={handleChange}
                  placeholder="e.g. 150"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              {/* DESCRIPTION */}

              <div>
                <label
                  htmlFor="description"
                  className="mb-2 block text-xs font-bold text-slate-700"
                >
                  What is happening?
                </label>

                <textarea
                  id="description"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  required
                  rows={5}
                  placeholder="Describe the situation, affected roads, rising water, people needing assistance, or other important information..."
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              {/* ==================================================
                  PHOTO UPLOAD
              ================================================== */}

              <div>
                <label
                  htmlFor="hazardPhoto"
                  className="mb-2 block text-xs font-bold text-slate-700"
                >
                  Add a photo
                  <span className="ml-1 font-normal text-slate-400">
                    (optional)
                  </span>
                </label>

                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-blue-400 hover:bg-blue-50/40">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
                        <Image size={18} />
                      </div>

                      <div>
                        <p className="text-xs font-bold text-slate-700">
                          Upload evidence
                        </p>

                        <p className="mt-1 text-[10px] text-slate-400">
                          JPEG, PNG or WebP • Maximum 8 MB
                        </p>
                      </div>
                    </div>

                    <label
                      htmlFor="hazardPhoto"
                      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 text-xs font-bold text-blue-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-blue-50"
                    >
                      <Image size={14} />
                      Choose photo
                    </label>

                    <input
                      id="hazardPhoto"
                      name="hazardPhoto"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoChange}
                      className="hidden"
                    />
                  </div>

                  {/* PHOTO PREVIEW */}

                  {selectedPhoto && photoPreview && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="relative">
                        <img
                          src={photoPreview}
                          alt="Selected hazard evidence"
                          className="max-h-72 w-full object-cover"
                        />

                        <button
                          type="button"
                          onClick={removeSelectedPhoto}
                          disabled={submitting}
                          className="absolute right-3 top-3 rounded-lg bg-black/70 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-3 p-3">
                        <p className="min-w-0 truncate text-xs font-bold text-slate-700">
                          {selectedPhoto.name}
                        </p>

                        <p className="shrink-0 text-[10px] text-slate-400">
                          {(
                            selectedPhoto.size /
                            (1024 * 1024)
                          ).toFixed(2)}{" "}
                          MB
                        </p>
                      </div>
                    </div>
                  )}

                  {/* PHOTO ERROR */}

                  {photoError && (
                    <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
                      <p className="text-[10px] font-semibold text-red-600">
                        {photoError}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* SUBMIT */}

              <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2 text-[10px] leading-5 text-slate-400">
                  <ShieldAlert
                    size={14}
                    className="mt-0.5 shrink-0 text-blue-500"
                  />

                  <span>
                    Community information can complement
                    automated flood monitoring and help
                    identify situations requiring attention.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-xs font-extrabold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <RefreshCw
                        size={15}
                        className="animate-spin"
                      />

                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send size={15} />

                      Submit report
                    </>
                  )}
                </button>
              </div>

              {/* SUCCESS */}

              {submitted && (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <CheckCircle2
                    size={18}
                    className="mt-0.5 shrink-0 text-emerald-600"
                  />

                  <div>
                    <p className="text-sm font-bold text-emerald-700">
                      Report submitted successfully
                    </p>

                    <p className="mt-1 text-xs leading-5 text-emerald-600">
                      Your hazard report has been received
                      and sent to the response team for
                      review. Thank you for helping protect
                      your community.
                    </p>
                  </div>
                </div>
              )}

              {/* ERROR */}

              {submitError && (
                <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4">
                  <AlertTriangle
                    size={18}
                    className="mt-0.5 shrink-0 text-red-600"
                  />

                  <div>
                    <p className="text-sm font-bold text-red-700">
                      Report could not be submitted
                    </p>

                    <p className="mt-1 text-xs leading-5 text-red-600">
                      {submitError}
                    </p>
                  </div>
                </div>
              )}
            </form>
          </section>

          {/* ====================================================
              HIGH RISK REGIONS
          ==================================================== */}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5">
              <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-red-500">
                PRIORITY AREAS
              </p>

              <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                Regions Requiring Attention
              </h2>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                Current high-risk locations from the live
                monitoring network.
              </p>
            </div>

            {loadingRegions && (
              <div className="flex min-h-[300px] items-center justify-center">
                <RefreshCw
                  size={22}
                  className="animate-spin text-blue-500"
                />
              </div>
            )}

            {!loadingRegions && regionError && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
                <AlertTriangle
                  size={22}
                  className="text-red-500"
                />

                <p className="mt-3 text-sm font-bold text-slate-700">
                  Regional data unavailable
                </p>

                <button
                  type="button"
                  onClick={fetchRegions}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                  Try again
                </button>
              </div>
            )}

            {!loadingRegions && !regionError && (
              <div className="divide-y divide-slate-100">
                {highRiskRegions.map(
                  (region, index) => (
                    <div
                      key={`${region.location_name}-${index}`}
                      className="p-5 transition hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500">
                            <MapPin size={16} />
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold text-slate-800">
                              {getRegionName(
                                region.location_name,
                                region.country
                              )}
                            </p>

                            <p className="mt-0.5 text-[10px] text-slate-400">
                              {region.country}
                            </p>
                          </div>
                        </div>

                        <span className="rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-extrabold uppercase text-red-600">
                          HIGH
                        </span>
                      </div>

                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400">
                            Risk score
                          </p>

                          <p className="mt-1 text-xl font-extrabold text-slate-900">
                            {getRiskScore(region)}

                            <span className="ml-1 text-[10px] font-semibold text-slate-400">
                              /100
                            </span>
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-[10px] font-semibold text-slate-400">
                            Rainfall
                          </p>

                          <p className="mt-1 text-sm font-extrabold text-slate-700">
                            {region.rainfall_mm_24h ?? 0}{" "}
                            mm
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-red-500"
                          style={{
                            width: `${Math.min(
                              getRiskScore(region),
                              100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )
                )}

                {highRiskRegions.length === 0 && (
                  <div className="flex min-h-[250px] flex-col items-center justify-center px-6 text-center">
                    <CheckCircle2
                      size={24}
                      className="text-emerald-500"
                    />

                    <p className="mt-3 text-sm font-bold text-slate-700">
                      No high-risk regions
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      The monitored network currently has
                      no regions classified as high risk.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!loadingRegions && !regionError && (
              <div className="border-t border-slate-100 bg-slate-50/60 p-5">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-red-50 p-3 text-center">
                    <p className="text-lg font-extrabold text-red-600">
                      {riskSummary.high}
                    </p>

                    <p className="text-[9px] font-bold uppercase tracking-wide text-red-400">
                      High
                    </p>
                  </div>

                  <div className="rounded-xl bg-orange-50 p-3 text-center">
                    <p className="text-lg font-extrabold text-orange-600">
                      {riskSummary.medium}
                    </p>

                    <p className="text-[9px] font-bold uppercase tracking-wide text-orange-400">
                      Medium
                    </p>
                  </div>

                  <div className="rounded-xl bg-emerald-50 p-3 text-center">
                    <p className="text-lg font-extrabold text-emerald-600">
                      {riskSummary.low}
                    </p>

                    <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                      Low
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ======================================================
            ACCESSIBILITY
        ====================================================== */}

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Accessibility size={19} />
              </div>

              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-indigo-600">
                  INCLUSIVE EARLY WARNING
                </p>

                <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                  Designed to reach people, not just devices
                </h2>

                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                  Flood warnings should remain useful for
                  people who may have limited internet access,
                  disabilities, language barriers, or limited
                  access to smartphones.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-0 md:grid-cols-3">
            <div className="border-b border-slate-100 p-6 md:border-b-0 md:border-r">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Volume2 size={18} />
              </div>

              <h3 className="mt-4 text-sm font-extrabold text-slate-800">
                Accessible communication
              </h3>

              <p className="mt-2 text-xs leading-5 text-slate-400">
                Voice alerts and audio communication can help
                people who have difficulty reading text-based
                warnings.
              </p>
            </div>

            <div className="border-b border-slate-100 p-6 md:border-b-0 md:border-r">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Languages size={18} />
              </div>

              <h3 className="mt-4 text-sm font-extrabold text-slate-800">
                Local languages
              </h3>

              <p className="mt-2 text-xs leading-5 text-slate-400">
                Alerts can be adapted into languages understood
                by local communities instead of relying only
                on technical or national-level messaging.
              </p>
            </div>

            <div className="p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Users size={18} />
              </div>

              <h3 className="mt-4 text-sm font-extrabold text-slate-800">
                Community-led response
              </h3>

              <p className="mt-2 text-xs leading-5 text-slate-400">
                Community leaders, local responders, radio
                networks and other trusted channels can help
                reach people who are difficult to reach through
                digital platforms.
              </p>
            </div>
          </div>
        </section>

        {/* ======================================================
            DETECTION TO COMMUNITY WARNING
        ====================================================== */}

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-blue-600">
              LAST-MILE RESPONSE
            </p>

            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              From Detection to Community Warning
            </h2>

            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
              AfriShield connects automated intelligence
              with information from people on the ground and
              multiple communication pathways.
            </p>
          </div>

          <div className="grid gap-0 md:grid-cols-4">
            {[
              {
                icon: ShieldAlert,
                title: "Detect",
                text: "AI models and environmental indicators identify changing flood risk.",
              },
              {
                icon: ClipboardList,
                title: "Verify",
                text: "Community reports provide ground-level information about actual conditions.",
              },
              {
                icon: BellRing,
                title: "Alert",
                text: "Warnings can be prepared for different audiences, needs and languages.",
              },
              {
                icon: Radio,
                title: "Reach",
                text: "SMS, radio, voice, community leaders and other channels extend warnings beyond smartphones.",
              },
            ].map((item, index) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="relative border-b border-slate-100 p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Icon size={18} />
                  </div>

                  <p className="mt-4 text-sm font-extrabold text-slate-800">
                    {item.title}
                  </p>

                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    {item.text}
                  </p>

                  {index < 3 && (
                    <ChevronRight
                      size={16}
                      className="absolute right-3 top-1/2 hidden -translate-y-1/2 text-slate-300 md:block"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ======================================================
            FOOTER
        ====================================================== */}

        <div className="flex flex-col gap-2 px-1 py-6 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            AfriShield Community Response • Live regional
            intelligence
          </span>

          <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />

            Monitoring network active
          </span>
        </div>
      </section>
    </main>
  );
}

export default Reports;