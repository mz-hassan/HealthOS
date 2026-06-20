import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bell,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardPlus,
  Download,
  Eye,
  FileHeart,
  FileText,
  FlaskConical,
  HeartPulse,
  Package,
  Pill,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  Menu,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  Sun,
  Moon,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { nav } from "./data";

const validPageSet = new Set(nav);
const overlaySet = new Set([
  "upload",
  "intervention",
  "event",
  "assistant",
  "profile",
  "menu",
  "checkin",
] as const);
const elderPanelSet = new Set(["medications", "appointments", "chat"] as const);

type OverlayState =
  | "upload"
  | "intervention"
  | "event"
  | "assistant"
  | "profile"
  | "menu"
  | "checkin"
  | null;
type ElderPanelState = "medications" | "appointments" | "chat" | null;
type ThemeMode = "light" | "dark";

type Marker = {
  name: string;
  value: number;
  unit: string;
  status: string;
  range: string;
  delta: number | null;
  points: { date: string; value: number; status?: string; range?: string }[];
};
type BiomarkerInsight = {
  name: string;
  category: "bad" | "improving" | "watch" | "good";
  currentValue: number;
  previousValue: number;
  unit: string;
  status: string;
  percentChange: number | null;
  summary: string;
};
type Profile = {
  id: number;
  name: string;
  isDefault?: number;
  profileType?: "independent" | "caregiver-linked";
  caregiverName?: string | null;
  relationshipLabel?: string | null;
  preferredExperience?: "caregiver" | "elder";
  createdAt?: string;
};
type Reminder = {
  id: string;
  kind: "appointment" | "followup" | "medication";
  title: string;
  dueDate: string | null;
  detail: string;
  priority: "today" | "soon" | "watch";
  episodeTitle?: string | null;
};
type EventItem = {
  id: number;
  type: string;
  date: string;
  title: string;
  meta: string;
  detail: string;
  tags: string[];
  episodeId?: number;
  episodeTitle?: string;
};
type Followup = {
  id: number;
  title: string;
  dueDate: string | null;
  reason: string | null;
  status: string;
  episodeTitle?: string | null;
  kind?: "appointment" | "followup";
};
type DocumentItem = {
  id: number;
  filename: string;
  documentType: string;
  date: string;
  provider: string | null;
  summary: string;
  status: string;
  confidence: number;
  episodeId?: number;
  episodeTitle?: string;
  episodeConfidence?: number;
  hasFile?: number;
  mimeType?: string;
};
type Intervention = {
  id: number;
  name: string;
  type: string;
  startDate: string;
  endDate: string | null;
  status: string;
  dose: string | null;
  frequency: string | null;
  notes: string | null;
  schedulePerWeek: number;
  adherence7d: number | null;
  sourceDocumentId?: number;
  episodeId?: number | null;
  episodeTitle?: string | null;
  episodeType?: string | null;
  scheduleSlots: Array<{
    key: string;
    label: string;
    period:
      | "morning"
      | "midday"
      | "evening"
      | "bedtime"
      | "weekly"
      | "anytime";
    timeLabel: string;
  }>;
  todaysTaken?: boolean;
};
type Checkin = {
  id: number;
  date: string;
  metrics: Record<string, number>;
  notes?: string;
  flagged: number;
  flagReason?: string;
};
type EpisodeMarkerDef = {
  key: string;
  label: string;
  question: string;
  direction: "higher_worse" | "higher_better";
  lowAnchor: string;
  highAnchor: string;
};
type Episode = {
  id: number; title: string; type: string; startDate: string; endDate?: string;
  status: "active" | "monitoring" | "closed"; summary: string; documentCount: number;
  markerSchema: EpisodeMarkerDef[];
  checkins: Checkin[]; linkedDocuments: Array<Pick<DocumentItem, "id" | "filename" | "documentType" | "summary" | "hasFile">>;
};
type Insight = { tone: string; eyebrow: string; title: string; text: string };
type Dashboard = {
  profiles: Profile[];
  currentProfileId: number;
  currentProfile?: Profile;
  documents: DocumentItem[];
  biomarkers: Marker[];
  biomarkerInsights: BiomarkerInsight[];
  events: EventItem[];
  followups: Followup[];
  interventions: Intervention[];
  episodes: Episode[];
  insights: Insight[];
  reminders: Reminder[];
  nextReminder: Reminder | null;
  counts: {
    documents: number;
    biomarkers: number;
    interventions: number;
    followups: number;
  };
};
const emptyData: Dashboard = {
  profiles: [],
  currentProfileId: 0,
  documents: [],
  biomarkers: [],
  biomarkerInsights: [],
  events: [],
  followups: [],
  interventions: [],
  insights: [],
  reminders: [],
  nextReminder: null,
  counts: { documents: 0, biomarkers: 0, interventions: 0, followups: 0 },
  episodes: [],
};
const iconMap: Record<string, typeof Activity> = {
  lab: FlaskConical,
  symptom: Activity,
  visit: Stethoscope,
  intervention: Zap,
  medication: ClipboardPlus,
  diagnosis: HeartPulse,
};

let activeProfileId: number | null = null;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("/api/")
    ? (() => {
        const next = new URL(path, window.location.origin);
        if (activeProfileId) next.searchParams.set("profileId", String(activeProfileId));
        return `${next.pathname}${next.search}`;
      })()
    : path;
  const response = await fetch(url, options);
  let body: any = {};
  try {
    body = await response.json();
  } catch {
    /**/
  }
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}
function prettyDate(value: string) {
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.valueOf())
    ? value
    : d.toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function reminderLabel(reminder: Reminder) {
  if (!reminder.dueDate) return "No date";
  const due = new Date(`${reminder.dueDate}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.valueOf() - today.valueOf()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return `In ${diffDays} days`;
  return prettyDate(reminder.dueDate);
}

function currentMedicationPeriod() {
  const hour = new Date().getHours();
  if (hour < 11) return "morning";
  if (hour < 16) return "midday";
  if (hour < 21) return "evening";
  return "bedtime";
}

const scheduleOrder = [
  "morning",
  "midday",
  "evening",
  "bedtime",
  "weekly",
  "anytime",
] as const;

function metricTone(marker: EpisodeMarkerDef, value: number) {
  if (marker.direction === "higher_worse") return value >= 4 ? "alert" : "steady";
  return value <= 2 ? "alert" : "steady";
}

function scoreLabel(marker: EpisodeMarkerDef, value?: number) {
  if (!value) return "—";
  if (value === 1) return marker.lowAnchor;
  if (value === 5) return marker.highAnchor;
  return `${value}/5`;
}

function metricDelta(marker: EpisodeMarkerDef, current?: number, previous?: number) {
  if (!current || !previous) return null;
  return marker.direction === "higher_worse"
    ? current - previous
    : previous - current;
}

function accentForIntervention(intervention: Intervention) {
  if (!intervention.episodeTitle) return "general";
  const palette = ["event-amber", "event-violet", "event-gold", "event-coral"];
  let hash = 0;
  for (const char of intervention.episodeTitle) hash += char.charCodeAt(0);
  return palette[hash % palette.length];
}
function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">
        <HeartPulse size={19} />
      </span>
      <span>Health <b>OS</b></span>
    </div>
  );
}

function Sparkline({
  marker,
  large = false,
}: {
  marker: Marker;
  large?: boolean;
}) {
  const color = markerSpectrumColor(marker.value, marker.range, marker.status);
  const points = marker.points.map((p) => ({
    ...p,
    label: new Date(`${p.date}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    }),
  }));
  return (
    <ResponsiveContainer width="100%" height={large ? 215 : 58}>
      <AreaChart
        data={points}
        margin={{ top: 8, right: 2, bottom: 0, left: 2 }}
      >
        <defs>
          <linearGradient
            id={`g-${marker.name.replaceAll(" ", "")}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={color} stopOpacity={0.24} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {large && (
          <>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#8f918b" }}
            />
            <YAxis hide domain={["dataMin - 3", "dataMax + 3"]} />
            <Tooltip
              contentStyle={{ border: "1px solid #e6e4dc", borderRadius: 10 }}
            />
          </>
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={large ? 2.5 : 2}
          fill={`url(#g-${marker.name.replaceAll(" ", "")})`}
          dot={large ? { r: 3, fill: color, strokeWidth: 0 } : false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function markerSeverityClass(status: string) {
  if (status === "good" || status === "normal") return "good";
  if (status === "watch" || status === "unknown") return "watch";
  if (status === "low") return "low";
  if (status === "critical") return "critical";
  return "high";
}

function markerSeverityRank(status: string) {
  const tone = markerSeverityClass(status);
  return (
    {
      critical: 0,
      high: 1,
      low: 2,
      watch: 3,
      good: 4,
    }[tone] ?? 5
  );
}

function markerSeverityColor(status: string) {
  const tone = markerSeverityClass(status);
  return (
    {
      good: "#237f69",
      watch: "#b88937",
      low: "#d17a34",
      high: "#c95d43",
      critical: "#8f2f2a",
    }[tone] || "#c95d43"
  );
}

function parseMarkerRange(range: string) {
  const normalized = range.replace(/,/g, "").replace(/\s+/g, "");
  const between = normalized.match(/(-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)/);
  if (between) {
    return {
      kind: "between" as const,
      min: Number(between[1]),
      max: Number(between[2]),
    };
  }
  const lower = normalized.match(/^(>=|>)\s*(-?\d+(?:\.\d+)?)/);
  if (lower) {
    return {
      kind: "min" as const,
      min: Number(lower[2]),
    };
  }
  const upper = normalized.match(/^(<=|<)\s*(-?\d+(?:\.\d+)?)/);
  if (upper) {
    return {
      kind: "max" as const,
      max: Number(upper[2]),
    };
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function markerSpectrumScore(value: number, range: string, status: string) {
  const parsed = parseMarkerRange(range);
  if (!parsed) {
    return (
      {
        good: 0.08,
        watch: 0.42,
        low: 0.62,
        high: 0.78,
        critical: 0.96,
      }[markerSeverityClass(status)] ?? 0.5
    );
  }
  if (parsed.kind === "between") {
    const span = Math.max(parsed.max - parsed.min, 1);
    if (value < parsed.min) return clamp(0.58 + ((parsed.min - value) / span) * 0.28, 0.58, 0.96);
    if (value > parsed.max) return clamp(0.58 + ((value - parsed.max) / span) * 0.28, 0.58, 0.96);
    const center = (parsed.min + parsed.max) / 2;
    const halfSpan = span / 2;
    const centerOffset = Math.abs(value - center) / Math.max(halfSpan, 1);
    return clamp(0.06 + centerOffset * 0.26, 0.06, 0.34);
  }
  if (parsed.kind === "min") {
    const buffer = Math.max(parsed.min * 0.25, 1);
    if (value < parsed.min) return clamp(0.6 + ((parsed.min - value) / buffer) * 0.3, 0.6, 0.96);
    const normalized = clamp((value - parsed.min) / buffer, 0, 1);
    return clamp(0.36 - normalized * 0.28, 0.08, 0.36);
  }
  const buffer = Math.max(parsed.max * 0.25, 1);
  if (value > parsed.max) return clamp(0.6 + ((value - parsed.max) / buffer) * 0.3, 0.6, 0.96);
  const normalized = clamp((parsed.max - value) / buffer, 0, 1);
  return clamp(0.36 - normalized * 0.28, 0.08, 0.36);
}

function markerSpectrumColor(value: number, range: string, status: string) {
  const score = markerSpectrumScore(value, range, status);
  const hue = 145 - score * 139;
  const saturation = 62 - score * 4;
  const lightness = 39 + (1 - score) * 8;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function markerStatusLabel(status: string) {
  const tone = markerSeverityClass(status);
  return (
    {
      good: "In range",
      watch: "Watch",
      low: "Low",
      high: "High",
      critical: "Critical",
    }[tone] || "Watch"
  );
}

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("healthos-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function sortMarkersForDisplay(markers: Marker[]) {
  return [...markers].sort((left, right) => {
    const severityDelta =
      markerSeverityRank(left.status) - markerSeverityRank(right.status);
    if (severityDelta !== 0) return severityDelta;
    const magnitudeDelta = Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0);
    if (magnitudeDelta !== 0) return magnitudeDelta;
    return left.name.localeCompare(right.name);
  });
}

function parsePageParam(value: string | null) {
  return value && validPageSet.has(value) ? value : "Overview";
}

function parseOverlayParam(value: string | null): OverlayState {
  return value && overlaySet.has(value as NonNullable<OverlayState>)
    ? (value as NonNullable<OverlayState>)
    : null;
}

function parseElderPanelParam(value: string | null): ElderPanelState {
  return value && elderPanelSet.has(value as NonNullable<ElderPanelState>)
    ? (value as NonNullable<ElderPanelState>)
    : null;
}

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Activity;
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="btn primary" onClick={action}>
          <Plus size={16} /> Add your first record
        </button>
      )}
    </div>
  );
}

function UploadModal({
  close,
  onComplete,
  simpleFlow = false,
}: {
  close: () => void;
  onComplete: () => Promise<void>;
  simpleFlow?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "processing" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const add = (list: FileList | null) =>
    list &&
    setFiles((current) => [...current, ...Array.from(list)]);
  const process = async () => {
    setState("processing");
    setMessage("LiteParse is reading layout and tables…");
    const body = new FormData();
    files.forEach((f) => body.append("documents", f));
    if (simpleFlow && files.length > 1 && files.every((file) => file.type.startsWith("image/")))
      body.append("mergePages", "1");
    try {
      const result = await api<{
        success: number;
        failed: number;
        results: any[];
      }>("/api/documents/ingest", { method: "POST", body });
      await onComplete();
      if (result.failed) {
        setState("error");
        setMessage(
          `${result.failed} file(s) failed: ${result.results
            .filter((x) => x.status === "error")
            .map((x) => x.error)
            .join("; ")}`,
        );
      } else {
        setState("done");
        setMessage(
          `${result.success} document(s) added to your health memory.`,
        );
      }
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Upload failed");
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal">
        <button
          aria-label="Close upload"
          className="icon-btn modal-x"
          onClick={close}
        >
          <X size={18} />
        </button>
        <div className="modal-icon">
          <Upload size={23} />
        </div>
        <h2>{simpleFlow ? "Upload or take a photo" : "Add health records"}</h2>
        <p>
          {simpleFlow
            ? "Take one page at a time, then submit the full stack together as one report. Files are parsed locally with LiteParse and structured with Gemma."
            : "Files are parsed locally with LiteParse. Extracted text is sent securely to Gemma for medical structuring."}
        </p>
        {state === "done" ? (
          <div className="success-state">
            <span>
              <Check size={28} />
            </span>
            <h3>Health memory updated</h3>
            <p>{message}</p>
          </div>
        ) : (
          <>
            <div
              className="dropzone"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                add(e.dataTransfer.files);
              }}
            >
              <FileHeart size={28} />
              <strong>Drop reports here or browse</strong>
              <small>PDF, DOCX, JPG, PNG · up to 20 MB each</small>
              <input
                ref={input}
                hidden
                multiple
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => add(e.target.files)}
              />
              <input
                ref={cameraInput}
                hidden
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => add(e.target.files)}
              />
            </div>
            <div className="upload-actions-row">
              <button className="btn ghost" type="button" onClick={() => cameraInput.current?.click()}>
                <FileHeart size={15} /> {simpleFlow ? (files.length ? "Take next page" : "Take first page") : "Take photo"}
              </button>
              <button className="btn ghost" type="button" onClick={() => input.current?.click()}>
                <Paperclip size={15} /> {simpleFlow ? "Upload from device" : "Browse device"}
              </button>
            </div>
            {files.map((f, index) => (
              <div className="file-row" key={f.name}>
                <FileText size={18} />
                <span>
                  <b>{simpleFlow ? `Page ${index + 1}` : f.name}</b>
                  {simpleFlow && <small>{f.name}</small>}
                  <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                </span>
                <Check size={16} />
              </div>
            ))}
            {simpleFlow && !!files.length && (
              <div className="upload-actions-row">
                <button className="btn ghost" type="button" onClick={() => setFiles([])}>
                  <X size={15} /> Clear pages
                </button>
              </div>
            )}
            {state === "error" && (
              <div className="form-error">
                <AlertCircle size={16} />
                {message}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={close}>
            {state === "done" ? "Close" : "Cancel"}
          </button>
          {state !== "done" && (
            <button
              className="btn primary"
              disabled={!files.length || state === "processing"}
              onClick={process}
            >
              {state === "processing" ? (
                <>
                  <span className="spinner" />
                  {message}
                </>
              ) : (
                <>
                  {simpleFlow ? "Submit" : "Analyze"} {files.length || ""}{" "}
                  {files.length === 1 ? (simpleFlow ? "page" : "document") : (simpleFlow ? "pages" : "documents")}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InterventionModal({
  close,
  onComplete,
}: {
  close: () => void;
  onComplete: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    type: "Supplement",
    startDate: new Date().toISOString().slice(0, 10),
    dose: "",
    frequency: "Daily",
    schedulePerWeek: 7,
    scheduleSlots: ["morning"],
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const scheduleSlots = form.scheduleSlots.length
        ? form.scheduleSlots.map((slot) => ({
            key: slot,
            label: slot[0].toUpperCase() + slot.slice(1),
            period: slot,
            timeLabel:
              slot === "morning"
                ? "8 AM"
                : slot === "midday"
                  ? "1 PM"
                  : slot === "evening"
                    ? "8 PM"
                    : "10 PM",
          }))
        : [{ key: "anytime", label: "Anytime", period: "anytime", timeLabel: "Flexible" }];
      await api("/api/interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, scheduleSlots }),
      });
      await onComplete();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <button
          aria-label="Close intervention"
          className="icon-btn modal-x"
          onClick={close}
        >
          <X size={18} />
        </button>
        <div className="modal-icon">
          <Zap size={23} />
        </div>
        <h2>Add an intervention</h2>
        <p>
          Track a supplement, medication, routine, diet, or health experiment
          against future outcomes.
        </p>
        <div className="template-row">
          {["morning", "midday", "evening", "bedtime"].map((slot) => (
            <button
              key={slot}
              className={`template-chip ${form.scheduleSlots.includes(slot) ? "active" : ""}`}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  scheduleSlots: current.scheduleSlots.includes(slot)
                    ? current.scheduleSlots.filter((item) => item !== slot)
                    : [...current.scheduleSlots, slot],
                }))
              }
            >
              {slot}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label>
            <span>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Vitamin D3"
            />
          </label>
          <label>
            <span>Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option>Supplement</option>
              <option>Medication</option>
              <option>Exercise</option>
              <option>Diet</option>
              <option>Sleep</option>
              <option>Skincare</option>
              <option>Lifestyle</option>
            </select>
          </label>
          <label>
            <span>Start date</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label>
            <span>Dose</span>
            <input
              value={form.dose}
              onChange={(e) => setForm({ ...form, dose: e.target.value })}
              placeholder="e.g. 2,000 IU"
            />
          </label>
          <label>
            <span>Frequency</span>
            <input
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              placeholder="e.g. Twice daily after food"
            />
          </label>
          <label>
            <span>Planned doses / week</span>
            <input
              type="number"
              min="1"
              max="21"
              value={form.schedulePerWeek}
              onChange={(e) =>
                setForm({ ...form, schedulePerWeek: Number(e.target.value) })
              }
            />
          </label>
          <label className="wide">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Why are you trying this?"
            />
          </label>
        </div>
        <div className="schedule-note">Selected slots shape the mobile medication agenda. You can still describe exact instructions in the frequency field.</div>
        {error && (
          <div className="form-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || form.name.length < 2}
            onClick={save}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            Save intervention
          </button>
        </div>
      </div>
    </div>
  );
}

function EventModal({ close, onComplete }: { close: () => void; onComplete: () => Promise<void> }) {
  const [form, setForm] = useState({
    title: "General health",
    type: "monitoring",
    startDate: new Date().toISOString().slice(0, 10),
    status: "active",
    summary: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const templates = [
    {
      label: "General health",
      title: "General health",
      type: "monitoring",
      summary: "Ongoing general health tracking focused on sleep, energy, recovery, and how I feel day to day.",
    },
    {
      label: "Nutrient tracking",
      title: "Nutrient monitoring",
      type: "monitoring",
      summary: "Monitoring symptoms and day-to-day changes while tracking nutrients, supplements, or blood markers over time.",
    },
    {
      label: "Injury recovery",
      title: "New injury recovery",
      type: "injury",
      summary: "Track the body area involved, what happened, early symptoms, activity limits, and any treatment already started.",
    },
  ];
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/episodes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      await onComplete(); close();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save care track"); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><div className="modal event-modal">
    <button aria-label="Close event" className="icon-btn modal-x" onClick={close}><X size={18}/></button>
    <div className="modal-icon"><HeartPulse size={23}/></div>
    <h2>Add a care track</h2>
    <p>Capture the starting point clearly. Health OS will use this summary to connect future documents, questions, and a custom set of daily check-in markers.</p>
    <div className="template-row">{templates.map((template)=><button key={template.label} className={`template-chip ${form.title===template.title?"active":""}`} onClick={()=>setForm({...form,title:template.title,type:template.type,status:"active",summary:template.summary})}>{template.label}</button>)}</div>
    <div className="form-grid">
      <label><span>Care track name</span><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Type 2 diabetes and kidney care"/></label>
      <label><span>Care track type</span><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
        <option value="injury">Injury</option><option value="condition">Condition</option><option value="monitoring">Monitoring</option><option value="medication">Medication course</option><option value="preventive">Preventive care</option><option value="other">Other</option>
      </select></label>
      <label><span>When did it begin?</span><input type="date" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></label>
      <label><span>Initial state</span><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="active">Active treatment</option><option value="monitoring">Monitoring</option><option value="closed">Closed</option></select></label>
      <label className="wide"><span>What happened and what did you notice first?</span><textarea value={form.summary} onChange={e=>setForm({...form,summary:e.target.value})} placeholder="Include timing, body area, early symptoms, severity, suspected cause, and care already received."/></label>
    </div>
    {error && <div className="form-error"><AlertCircle size={16}/>{error}</div>}
    <div className="modal-actions"><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={busy || form.title.length<2 || form.summary.length<3} onClick={save}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>}Create care track</button></div>
  </div></div>;
}

function CheckinModal({ episode, close, onComplete }: { episode: Episode; close: () => void; onComplete: () => Promise<void> }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0,10),
    metrics: episode.markerSchema.reduce((acc, marker) => ({ ...acc, [marker.key]: 3 }), {} as Record<string, number>),
    notes: "",
  });
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const save=async()=>{ setBusy(true); setError(""); try { const result=await api<{flagged:boolean;flagReason?:string}>(`/api/episodes/${episode.id}/checkins`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)}); await onComplete(); if(result.flagged && result.flagReason) setError(result.flagReason); else close(); } catch(e){setError(e instanceof Error?e.message:"Could not save check-in");} finally{setBusy(false);} };
  const ratings = episode.markerSchema;
  return <div className="modal-backdrop"><div className="modal"><button aria-label="Close check-in" className="icon-btn modal-x" onClick={close}><X size={18}/></button><div className="modal-icon"><Activity size={23}/></div><h2>How is {episode.title} today?</h2><p>These repeat markers make recovery visible and help flag patterns worth discussing with a clinician.</p>
    <div className="rating-grid">{ratings.map(r=><label key={r.key}><span><b>{r.label}</b><small>{r.lowAnchor} · {r.highAnchor}</small></span><p>{r.question}</p><div>{[1,2,3,4,5].map(n=><button key={n} type="button" className={form.metrics[r.key]===n?"active":""} onClick={()=>setForm({...form,metrics:{...form.metrics,[r.key]:n}})}>{n}</button>)}</div></label>)}</div>
    <div className="form-grid checkin-notes"><label><span>Date</span><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label className="wide"><span>Anything else?</span><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="What changed? Any new symptoms or activity?"/></label></div>
    {error&&<div className="form-error"><AlertCircle size={16}/><span>{error}<br/><b>Your check-in was saved.</b></span></div>}
    <div className="modal-actions"><button className="btn ghost" onClick={close}>{error?"Close":"Cancel"}</button>{!error&&<button className="btn primary" disabled={busy} onClick={save}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>}Save check-in</button>}</div>
  </div></div>;
}

function AddProfileModal({
  close,
  onComplete,
}: {
  close: () => void;
  onComplete: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    profileType: "independent" as "independent" | "caregiver-linked",
    caregiverName: "",
    relationshipLabel: "",
    preferredExperience: "caregiver" as "caregiver" | "elder",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await onComplete();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create profile");
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop"><div className="modal">
    <button aria-label="Close profile" className="icon-btn modal-x" onClick={close}><X size={18}/></button>
    <div className="modal-icon"><HeartPulse size={23}/></div>
    <h2>Add a profile</h2>
    <p>Each profile keeps documents, care tracks, medications, biomarkers, and doctor prep completely separate. Linked care records can also show who manages the account and which interface should open first.</p>
    <div className="form-grid">
      <label><span>Profile name</span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Mom, Dad, Alex"/></label>
      <label><span>Record type</span><select value={form.profileType} onChange={e=>setForm({...form,profileType:e.target.value as "independent" | "caregiver-linked"})}><option value="independent">Independent health record</option><option value="caregiver-linked">Linked family care record</option></select></label>
      {form.profileType === "caregiver-linked" && (
        <>
          <label><span>Managed by</span><input value={form.caregiverName} onChange={e=>setForm({...form,caregiverName:e.target.value})} placeholder="e.g. Anita Mehta"/></label>
          <label><span>Relationship</span><input value={form.relationshipLabel} onChange={e=>setForm({...form,relationshipLabel:e.target.value})} placeholder="e.g. Daughter"/></label>
          <label><span>Default interface</span><select value={form.preferredExperience} onChange={e=>setForm({...form,preferredExperience:e.target.value as "caregiver" | "elder"})}><option value="elder">Simple elder view</option><option value="caregiver">Detailed caregiver view</option></select></label>
        </>
      )}
    </div>
    {error && <div className="form-error"><AlertCircle size={16}/>{error}</div>}
    <div className="modal-actions"><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={busy || form.name.trim().length < 2} onClick={save}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>}Create profile</button></div>
  </div></div>;
}

function Assistant({
  close,
  hasData,
}: {
  close: () => void;
  hasData: boolean;
}) {
  const [messages, setMessages] = useState([
    {
      role: "ai",
      text: hasData
        ? "I’m connected to your stored records, biomarkers, interventions, and follow-ups. What should we explore?"
        : "Your health memory is empty. Upload a record or add an intervention, then I can reason across it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (preset?: string) => {
    const q = (preset ?? input).trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const d = await api<{ answer: string }>("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      setMessages((m) => [...m, { role: "ai", text: d.answer }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: `I couldn’t complete that request: ${e instanceof Error ? e.message : "unknown error"}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="assistant-panel">
      <header>
        <div>
          <span className="assistant-avatar">
            <Sparkles size={17} />
          </span>
          <span>
            <b>Health assistant</b>
            <small>Gemma · grounded in your database</small>
          </span>
        </div>
        <button
          aria-label="Close assistant"
          className="icon-btn"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <div className="messages">
        {messages.map((m, i) => (
          <div className={`message ${m.role}`} key={i}>
            {m.role === "ai" && (
              <span className="mini-ai">
                <Sparkles size={12} />
              </span>
            )}
            <div className="message-markdown">
              <ReactMarkdown>{m.text}</ReactMarkdown>
            </div>
          </div>
        ))}
        {busy && (
          <div className="message ai">
            <span className="mini-ai">
              <Sparkles size={12} />
            </span>
            <p className="typing">
              <i />
              <i />
              <i />
            </p>
          </div>
        )}
      </div>
      {messages.length === 1 && hasData && (
        <div className="suggestions">
          {[
            "What changed recently?",
            "Which biomarkers are worsening?",
            "What follow-ups are due?",
          ].map((x) => (
            <button key={x} onClick={() => send(x)}>
              {x}
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      )}
      <div className="chat-input">
        <button aria-label="Attach">
          <Paperclip size={17} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about your health…"
        />
        <button aria-label="Send" className="send" onClick={() => send()}>
          <Send size={16} />
        </button>
      </div>
      <small className="disclaimer">
        Not medical advice. Verify important decisions with your clinician.
      </small>
    </aside>
  );
}

function EmbeddedAssistant({
  hasData,
  title,
  intro,
  open,
  onOpen,
  onClose,
}: {
  hasData: boolean;
  title: string;
  intro: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState([
    {
      role: "ai",
      text: hasData
        ? intro
        : "There are no records yet. Add a document or medicine first, then I can help using that history.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (preset?: string) => {
    const q = (preset ?? input).trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const d = await api<{ answer: string }>("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      setMessages((m) => [...m, { role: "ai", text: d.answer }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: `I couldn’t complete that request: ${e instanceof Error ? e.message : "unknown error"}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!open && (
        <button
          className="elder-chat-fab"
          aria-label="Open health chat"
          onClick={onOpen}
        >
          <Sparkles size={20} />
        </button>
      )}
      {open && (
        <section className="elder-chat-panel card">
          <div className="elder-chat-head">
            <div>
              <p className="eyebrow">HEALTH CHAT</p>
              <h2>{title}</h2>
            </div>
            <button
              aria-label="Close health chat"
              className="icon-btn elder-chat-close"
              onClick={onClose}
            >
              <Minimize2 size={16} />
            </button>
          </div>
          <div className="elder-chat-meta">
            <span className="chat-status">
              <Sparkles size={14} /> Connected to stored records
            </span>
          </div>
          <div className="elder-chat-body">
            {messages.map((message, index) => (
              <div className={`message ${message.role}`} key={index}>
                {message.role === "ai" && (
                  <span className="mini-ai">
                    <Sparkles size={12} />
                  </span>
                )}
                <div className="message-markdown">
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                </div>
              </div>
            ))}
            {busy && (
              <div className="message ai">
                <span className="mini-ai">
                  <Sparkles size={12} />
                </span>
                <p className="typing">
                  <i />
                  <i />
                  <i />
                </p>
              </div>
            )}
          </div>
          {messages.length === 1 && hasData && (
            <div className="suggestions elder-suggestions">
              {[
                "How am I doing today?",
                "What is my next appointment?",
                "Which medicines should I take now?",
              ].map((question) => (
                <button key={question} onClick={() => send(question)}>
                  {question}
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          )}
          <div className="chat-input elder-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Tell me how you feel or ask a question"
            />
            <button aria-label="Send" className="send" onClick={() => send()}>
              <Send size={16} />
            </button>
          </div>
          <small className="disclaimer">
            Information only. For urgent or severe symptoms, contact a clinician or local emergency services.
          </small>
        </section>
      )}
    </>
  );
}

function ElderDashboard({
  data,
  currentProfile,
  openUpload,
  logTaken,
  activePanel,
  onPanelChange,
  theme,
  toggleTheme,
}: {
  data: Dashboard;
  currentProfile?: Profile;
  openUpload: () => void;
  logTaken: (intervention: Intervention) => Promise<void>;
  activePanel: ElderPanelState;
  onPanelChange: (panel: ElderPanelState) => void;
  theme: ThemeMode;
  toggleTheme: () => void;
}) {
  const period = currentMedicationPeriod();
  const activeMedications = data.interventions.filter(
    (item) => item.status === "active",
  );
  const dueNow = data.interventions.filter(
    (item) =>
      item.status === "active" &&
      !item.todaysTaken &&
      item.scheduleSlots?.some(
        (slot) => slot.period === period || slot.period === "anytime",
      ),
  );
  const upcoming = data.interventions.filter(
    (item) => item.status === "active" && !item.todaysTaken && !dueNow.includes(item),
  );
  const compactMedications = [
    ...dueNow,
    ...activeMedications.filter((item) => !dueNow.includes(item)),
  ];
  const upcomingAppointments = data.reminders;
  const visibleAppointments = upcomingAppointments.slice(0, 2);
  const medicationGroups = scheduleOrder.map((slot) => ({
    slot,
    items: activeMedications.filter((item) =>
      item.scheduleSlots?.some((entry) => entry.period === slot),
    ),
  })).filter((group) => group.items.length);
  return (
    <div className="elder-dashboard">
      <section className="elder-app-bar">
        <span className="elder-app-name">Health OS</span>
        <div className="elder-app-meta">
          <button
            className="icon-btn theme-toggle elder-theme-toggle"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            onClick={toggleTheme}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <span className="elder-managed-mini">
            Managed by {currentProfile?.caregiverName || "Caregiver"}
            {currentProfile?.relationshipLabel
              ? ` · ${currentProfile.relationshipLabel}`
              : ""}
          </span>
        </div>
      </section>
      <section className="elder-stage">
        {activePanel === "medications" || activePanel === "appointments" ? (
          <section className="elder-expanded-panel">
            <article className="elder-widget elder-meds elder-meds-expanded card">
              <div className="elder-expanded-head">
                <div>
                  <p className="eyebrow">
                    {activePanel === "medications" ? "MEDICINES" : "WHAT'S NEXT"}
                  </p>
                  <h2>
                    {activePanel === "medications"
                      ? "Today and later"
                      : "Upcoming appointments"}
                  </h2>
                </div>
                <button
                  className="btn ghost elder-collapse-btn"
                  onClick={() => onPanelChange(null)}
                >
                  <Minimize2 size={16} /> Back
                </button>
              </div>
              {activePanel === "medications" ? (
                <div className="elder-expanded-groups">
                  {medicationGroups.length ? (
                    medicationGroups.map((group) => (
                      <section key={group.slot} className="elder-expanded-group">
                        <header>
                          <b>{group.slot[0].toUpperCase() + group.slot.slice(1)}</b>
                          <small>
                            {group.items.filter((item) => !item.todaysTaken).length} left
                          </small>
                        </header>
                        {group.items.map((item) => (
                          <div className="elder-med-row detailed" key={`${group.slot}-${item.id}`}>
                            <div>
                              <b>{item.name}</b>
                              <small>
                                {item.dose || "Dose not captured"} ·{" "}
                                {item.frequency || "Today"}
                              </small>
                              <small>
                                {item.todaysTaken ? "Taken today" : "Still needs to be taken"}
                              </small>
                            </div>
                            <button
                              className={`btn ${item.todaysTaken ? "ghost" : "primary"} elder-med-check`}
                              onClick={() => logTaken(item)}
                              disabled={item.todaysTaken}
                            >
                              <Check size={16} />
                            </button>
                          </div>
                        ))}
                      </section>
                    ))
                  ) : (
                    <p className="elder-empty-copy">
                      No active medicines are listed yet.
                    </p>
                  )}
                </div>
              ) : (
                <div className="elder-expanded-groups elder-appointment-groups">
                  {upcomingAppointments.length ? (
                    upcomingAppointments.map((item) => (
                      <section key={item.id} className="elder-expanded-group elder-appointment-group">
                        <header>
                          <b>{item.title}</b>
                          <small>{reminderLabel(item)}</small>
                        </header>
                        <p className="elder-appointment-group-track">
                          {item.episodeTitle || "General health"}
                        </p>
                        <p className="elder-appointment-group-detail">
                          {item.detail || "Appointment extracted from the most recent uploaded record."}
                        </p>
                      </section>
                    ))
                  ) : (
                    <p className="elder-empty-copy">No upcoming appointments.</p>
                  )}
                </div>
              )}
            </article>
          </section>
        ) : (
          <section className="elder-widget-grid">
            <article className="elder-widget elder-upload card">
              <p className="eyebrow">DOCUMENTS</p>
              <h2>Upload or take a photo</h2>
              <p>Add a report, prescription, or lab sheet without leaving this screen.</p>
              <button className="btn primary elder-widget-btn" onClick={openUpload}>
                <Upload size={18} /> Upload or take a photo
              </button>
            </article>
            <article className="elder-widget elder-next card">
              <div className="elder-widget-head">
                <p className="eyebrow">WHAT'S NEXT</p>
                <button
                  className="icon-btn elder-widget-toggle"
                  aria-label="Expand upcoming appointments"
                  onClick={() => onPanelChange("appointments")}
                >
                  <Maximize2 size={15} />
                </button>
              </div>
              <h2>{visibleAppointments.length ? "Next appointments" : "No upcoming appointments"}</h2>
              {visibleAppointments.length ? (
                <>
                  <div className="elder-appointment-preview">
                    {visibleAppointments.map((appointment) => (
                      <div className="elder-appointment-row compact" key={appointment.id}>
                        <b>{appointment.title}</b>
                        <small>{reminderLabel(appointment)}</small>
                        <small className="elder-appointment-track">
                          {appointment.episodeTitle || "General health"}
                        </small>
                      </div>
                    ))}
                  </div>
                  {upcomingAppointments.length > visibleAppointments.length ? (
                    <span className="elder-more-chip">
                      +{Math.max(upcomingAppointments.length - visibleAppointments.length, 0)} more appointments
                    </span>
                  ) : null}
                </>
              ) : (
                <p>No upcoming appointments.</p>
              )}
            </article>
            <article className="elder-widget elder-meds card">
              <div className="elder-widget-head">
                <p className="eyebrow">MEDICINES</p>
                <button
                  className="icon-btn elder-widget-toggle"
                  aria-label="Expand medicines"
                  onClick={() => onPanelChange("medications")}
                >
                  <Maximize2 size={15} />
                </button>
              </div>
              <h2>{compactMedications.length ? "Mark what you took" : "Nothing due right now"}</h2>
              <div className="elder-med-list">
                {compactMedications.length ? (
                  compactMedications.map((item) => (
                    <div className="elder-med-row" key={item.id}>
                      <div>
                        <b>{item.name}</b>
                        <small>
                          {item.dose || "Dose not captured"} ·{" "}
                          {item.scheduleSlots?.map((slot) => slot.label).join(" · ") ||
                            item.frequency ||
                            "Today"}
                        </small>
                      </div>
                      <button
                        className={`btn ${item.todaysTaken ? "ghost" : "primary"} elder-med-check`}
                        onClick={() => logTaken(item)}
                        disabled={item.todaysTaken}
                      >
                        <Check size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="elder-empty-copy">
                    {upcoming[0]
                      ? `Next up: ${upcoming[0].name}`
                      : "Today's tracked routine is already complete."}
                  </p>
                )}
              </div>
            </article>
            <article className="elder-widget elder-food card">
              <p className="eyebrow">FOOD</p>
              <h2>Capture food</h2>
              {/* TODO: Replace this placeholder with meal-photo ingestion and nutrition tracking. */}
              <p>Take a meal photo for diet tracking. This is a placeholder for the next build.</p>
              <button className="btn ghost elder-widget-btn" disabled>
                <FileHeart size={18} /> Coming soon
              </button>
            </article>
          </section>
        )}
        <EmbeddedAssistant
          hasData={data.counts.documents + data.counts.interventions > 0}
          title="How are you feeling?"
          intro="Tell me how you feel, ask what medicine comes next, or ask for simple explanations of your health records."
          open={activePanel === "chat"}
          onOpen={() => onPanelChange("chat")}
          onClose={() => onPanelChange(null)}
        />
      </section>
    </div>
  );
}

function Overview({
  data,
  openUpload,
  completeFollowup,
}: {
  data: Dashboard;
  openUpload: () => void;
  completeFollowup: (id: number) => void;
}) {
  const [selectedName, setSelectedName] = useState("");
  const sortedBiomarkers = useMemo(
    () => sortMarkersForDisplay(data.biomarkers),
    [data.biomarkers],
  );
  const selected =
    sortedBiomarkers.find((x) => x.name === selectedName) || sortedBiomarkers[0];
  const abnormal = sortedBiomarkers.find(
    (x) => !["good", "normal"].includes(x.status),
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const appointmentFollowups = data.followups.filter(
    (item) =>
      item.kind === "appointment" &&
      Boolean(item.dueDate) &&
      String(item.dueDate) >= todayIso,
  );
  return (
    <>
      <section className="hero-row">
        <div>
          <p className="eyebrow">
            {new Date()
              .toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
              .toUpperCase()}
          </p>
          <h1>Health for you and your loved ones.</h1>
          <p>
            {data.counts.documents
              ? `${data.counts.documents} records organized into one longitudinal history.`
              : "Start by adding a report or intervention."}
          </p>
        </div>
        <div className="hero-actions">
          <button className="btn primary" onClick={openUpload}>
            <Plus size={17} /> Add health data
          </button>
        </div>
      </section>
      {!data.counts.documents && !data.counts.interventions ? (
        <div className="card onboarding">
          <span>
            <Brain size={25} />
          </span>
          <div>
            <p className="eyebrow">GET STARTED</p>
            <h2>Build your health memory</h2>
            <p>
              Upload a report. LiteParse reads it locally, Gemma extracts the
              clinical facts, and Health OS connects them across time.
            </p>
          </div>
          <button className="btn primary" onClick={openUpload}>
            <Upload size={16} /> Upload a record
          </button>
        </div>
      ) : (
        <section className="health-brief">
          <div className="brief-heading">
            <span>
              <Brain size={20} />
            </span>
            <div>
              <p className="eyebrow">YOUR HEALTH BRIEF</p>
              <h2>
                {abnormal || appointmentFollowups.length
                  ? "Worth your attention"
                  : "Your latest health picture"}
              </h2>
            </div>
            <small>Live from your records</small>
          </div>
          <div className="brief-grid">
            {abnormal && (
              <div className="brief-item warning">
                <span className="status-dot" />
                <div>
                  <b>
                    {abnormal.name} is marked {abnormal.status}
                  </b>
                  <p>
                    Latest value: {abnormal.value} {abnormal.unit}. Reference:{" "}
                    {abnormal.range}.
                  </p>
                </div>
              </div>
            )}
            {appointmentFollowups[0] && (
              <div className="brief-item warning">
                <span className="status-dot" />
                <div>
                  <b>{appointmentFollowups[0].title}</b>
                  <p>
                    {appointmentFollowups[0].dueDate
                      ? `Due ${prettyDate(appointmentFollowups[0].dueDate)}.`
                      : "No due date captured."}{" "}
                    {[appointmentFollowups[0].episodeTitle, appointmentFollowups[0].reason]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <div className="section-title">
        <div>
          <p className="eyebrow">BIOMARKERS</p>
          <h2>Your health at a glance</h2>
        </div>
        <span className="tag">{data.counts.biomarkers} tracked</span>
      </div>
      {sortedBiomarkers.length ? (
        <>
          <section className="metric-grid">
            {sortedBiomarkers.slice(0, 4).map((m) => (
              <button
                onClick={() => setSelectedName(m.name)}
                key={m.name}
                className={`metric-card ${markerSeverityClass(m.status)} ${
                  selected?.name === m.name ? "selected" : ""
                }`}
              >
                <div className="metric-top">
                  <span>{m.name}</span>
                  <span className={`metric-status ${markerSeverityClass(m.status)}`}>
                    {markerStatusLabel(m.status)}
                  </span>
                </div>
                <div className="metric-value">
                  {m.value}
                  <small>{m.unit}</small>
                </div>
                <div className="metric-foot">
                  <span>
                    {m.delta === null
                      ? "First result"
                      : `${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)} ${m.unit}`}
                  </span>
                </div>
                <Sparkline marker={m} />
              </button>
            ))}
          </section>
          {selected && (
            <section className="detail-grid">
              <div
                className={`chart-card card biomarker-overview-focus ${markerSeverityClass(
                  selected.status,
                )}`}
              >
                <header>
                  <div>
                    <p className="eyebrow">LONGITUDINAL TREND</p>
                    <h3>{selected.name}</h3>
                  </div>
                  <div className="range-pill">Reference: {selected.range}</div>
                </header>
                <Sparkline marker={selected} large />
              </div>
              <FollowupCard
                items={appointmentFollowups.slice(0, 3)}
                complete={completeFollowup}
              />
            </section>
          )}
        </>
      ) : (
        <EmptyState
          icon={FlaskConical}
          title="No biomarkers yet"
          text="Upload a lab report to build normalized, provider-independent trends."
          action={openUpload}
        />
      )}
      <div className="section-title insight-title">
        <div>
          <p className="eyebrow">HEALTH INTELLIGENCE</p>
          <h2>Patterns found</h2>
        </div>
      </div>
      {data.insights.length ? (
        <section className="insight-grid">
          {data.insights.map((x, i) => (
            <article className={`insight-card ${x.tone}`} key={x.title}>
              <span className="insight-icon">
                {i === 0 ? <Activity /> : i === 1 ? <FlaskConical /> : <Zap />}
              </span>
              <p className="eyebrow">{x.eyebrow}</p>
              <h3>{x.title}</h3>
              <p>{x.text}</p>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="Patterns need history"
          text="Insights appear after multiple measurements or interventions create longitudinal context."
        />
      )}
    </>
  );
}

function FollowupCard({
  items,
  complete,
}: {
  items: Followup[];
  complete: (id: number) => void;
}) {
  return (
    <div className="follow-card card">
      <div className="follow-head">
        <span>
          <CalendarClock size={19} />
        </span>
        <div>
          <p className="eyebrow">UPCOMING</p>
          <h3>Appointments</h3>
        </div>
      </div>
      {items.length ? (
        items.map((f) => (
          <div className="follow-item" key={f.id}>
            <span className="date-box">
              <b>
                {f.dueDate ? new Date(`${f.dueDate}T12:00:00`).getDate() : "—"}
              </b>
              <small>
                {f.dueDate
                  ? new Date(`${f.dueDate}T12:00:00`)
                      .toLocaleDateString("en-US", { month: "short" })
                      .toUpperCase()
                  : "OPEN"}
              </small>
            </span>
            <div>
              <b>{f.title}</b>
              <p>
                {[f.episodeTitle, f.reason].filter(Boolean).join(" · ") ||
                  "Appointment from your records"}
              </p>
              <button className="tiny-action" onClick={() => complete(f.id)}>
                <Check size={12} /> Mark complete
              </button>
            </div>
          </div>
        ))
      ) : (
        <p className="muted-copy">No upcoming appointments.</p>
      )}
    </div>
  );
}

function TimelinePage({ events }: { events: EventItem[] }) {
  const [filter, setFilter] = useState("All events");
  const filtered = useMemo(
    () =>
      filter === "All events"
        ? events
        : events.filter((x) => x.type === filter.toLowerCase()),
    [filter, events],
  );
  return (
    <div className="page-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">YOUR HEALTH STORY</p>
          <h1>Timeline</h1>
          <p>Every extracted and recorded change, connected chronologically.</p>
        </div>
      </div>
      <div className="timeline-controls">
        <div className="filter-pills">
          {["All events", "Lab", "Diagnosis", "Medication", "Intervention"].map(
            (x) => (
              <button
                className={filter === x ? "active" : ""}
                onClick={() => setFilter(x)}
                key={x}
              >
                {x}
              </button>
            ),
          )}
        </div>
        <button className="btn ghost">
          <CalendarClock size={16} /> All time <ChevronDown size={15} />
        </button>
      </div>
      {filtered.length ? (
        <div className="timeline-list">
          {filtered.map((event, i) => {
            const I = iconMap[event.type] || Activity;
            return (
              <article className="timeline-row" key={event.id}>
                <div className="timeline-date">
                  <b>{prettyDate(event.date).replace(/, \d{4}/, "")}</b>
                  <span>{event.date.slice(0, 4)}</span>
                </div>
                <div className={`timeline-node ${event.type}`}>
                  <I size={17} />
                </div>
                {i < filtered.length - 1 && <span className="timeline-line" />}
                <div className="timeline-content">
                  <span className="type-label">{event.type}</span>
                  <h3>{event.title}</h3>
                  <small>{event.meta}</small>
                  {event.episodeTitle && (
                    <span className="episode-chip">↳ {event.episodeTitle}</span>
                  )}
                  <p>{event.detail}</p>
                  <div>
                    {event.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Activity}
          title="No timeline events"
          text="Events appear after you upload a report or add an intervention."
        />
      )}
    </div>
  );
}

function EventsPage({ episodes, openEvent, openCheckin, refresh, prepare }: {
  episodes: Episode[]; openEvent: () => void; openCheckin: (episode: Episode) => void;
  refresh: () => Promise<void>; prepare: (episode: Episode) => void;
}) {
  const [filter,setFilter]=useState("active");
  const visible=episodes.filter(e=>filter==="all"||e.status===filter);
  const changeState=async(episode:Episode,status:Episode["status"])=>{
    await api(`/api/episodes/${episode.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}); await refresh();
  };
  return <div className="page-view events-page">
    <div className="page-head"><div><p className="eyebrow">CONNECTED CARE TIMELINES</p><h1>Care tracks</h1><p>Track a diagnosis, monitoring stream, or care journey from first note to ongoing follow-up.</p></div><button className="btn primary" onClick={openEvent}><Plus size={17}/>Add care track</button></div>
    <div className="event-summary-strip"><span><b>{episodes.filter(e=>e.status==="active").length}</b> active</span><span><b>{episodes.filter(e=>e.status==="monitoring").length}</b> monitoring</span><span><b>{episodes.reduce((n,e)=>n+e.checkins.length,0)}</b> check-ins</span><span><b>{episodes.reduce((n,e)=>n+e.documentCount,0)}</b> linked records</span></div>
    <div className="filter-pills event-filters">{["active","monitoring","closed","all"].map(x=><button key={x} className={filter===x?"active":""} onClick={()=>setFilter(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
    {visible.length?<div className="event-grid">{visible.map(episode=>{
      const latest=episode.checkins.at(-1); const flagged=[...episode.checkins].reverse().find(x=>x.flagged);
      const previous = episode.checkins.length > 1 ? episode.checkins[episode.checkins.length - 2] : undefined;
      return <article className={`event-card card ${flagged?"flagged":""}`} key={episode.id}>
        <header><div><span className={`state-pill ${episode.status}`}>{episode.status}</span><span className="event-type">{episode.type}</span></div><select aria-label={`State for ${episode.title}`} value={episode.status} onChange={e=>changeState(episode,e.target.value as Episode["status"])}><option value="active">Active</option><option value="monitoring">Monitoring</option><option value="closed">Closed</option></select></header>
        <h2>{episode.title}</h2><p className="event-date">Since {prettyDate(episode.startDate)}</p><p className="event-summary">{episode.summary}</p>
        <div className="marker-chip-row">{episode.markerSchema.map(marker=><span className="marker-chip" key={marker.key}>{marker.label}</span>)}</div>
        {flagged&&<div className="event-alert"><AlertCircle size={17}/><div><b>Recovery pattern needs attention</b><p>{flagged.flagReason}</p></div></div>}
        {episode.checkins.length?<div className="symptom-trends">
          {episode.markerSchema.map(marker=>{
            const current = latest?.metrics?.[marker.key];
            const delta = metricDelta(marker, current, previous?.metrics?.[marker.key]);
            return <div key={marker.key} className={metricTone(marker, current || 3)}>
              <span>{marker.label}</span>
              <div className="mini-bars">{episode.checkins.slice(-10).map(c=><i key={`${marker.key}-${c.id}`} className={metricTone(marker,c.metrics?.[marker.key] || 3)} style={{height:`${(c.metrics?.[marker.key] || 0)*20}%`}} title={`${c.date}: ${c.metrics?.[marker.key]}/5`}/>)}</div>
              <b>{current}/5 {delta!==null&&delta>0?"↑":delta!==null&&delta<0?"↓":""}</b>
            </div>;
          })}
        </div>:<div className="first-checkin"><Activity size={18}/><span><b>No check-ins yet</b><small>Start a baseline to make recovery measurable.</small></span></div>}
        <div className="event-meta"><span><FileText size={14}/>{episode.documentCount} documents</span><span><Activity size={14}/>{episode.checkins.length} check-ins</span></div>
        <footer><button className="btn primary" onClick={()=>openCheckin(episode)} disabled={episode.status==="closed"}><Plus size={15}/>Today’s check-in</button><button className="btn ghost" onClick={()=>prepare(episode)}><Stethoscope size={15}/>Doctor prep</button></footer>
      </article>;
    })}</div>:<EmptyState icon={HeartPulse} title={episodes.length?`No ${filter} care tracks`:"Add your first care track"} text="Create a care track for a diagnosis, medication course, mental health plan, or anything you want to monitor over time." action={openEvent}/>} 
  </div>;
}

function BiomarkerTimelinePage({
  biomarkers,
  insights,
}: {
  biomarkers: Marker[];
  insights: BiomarkerInsight[];
}) {
  const [selectedName, setSelectedName] = useState("");
  const sortedBiomarkers = useMemo(
    () => sortMarkersForDisplay(biomarkers),
    [biomarkers],
  );
  const selected =
    sortedBiomarkers.find((marker) => marker.name === selectedName) ||
    sortedBiomarkers[0];
  const grouped = {
    bad: insights.filter((item) => item.category === "bad"),
    improving: insights.filter((item) => item.category === "improving"),
    good: insights.filter((item) => item.category === "good"),
    watch: insights.filter((item) => item.category === "watch"),
  };
  return (
    <div className="bio-layout">
      <div className="bio-alert-grid">
        <section className="bio-alert-card danger">
          <div>
            <p className="eyebrow">PAY ATTENTION</p>
            <h3>{grouped.bad.length ? `${grouped.bad.length} markers need attention` : "No clearly worsening markers"}</h3>
          </div>
          {grouped.bad.length ? grouped.bad.slice(0, 3).map((item) => (
            <button key={`bad-${item.name}`} className="bio-alert-row" onClick={() => setSelectedName(item.name)}>
              <b>{item.name}</b>
              <small>{item.summary}</small>
            </button>
          )) : <p className="muted-copy">Nothing in the latest report looks clearly worse versus the prior result.</p>}
        </section>
        <section className="bio-alert-card good">
          <div>
            <p className="eyebrow">GOING WELL</p>
            <h3>{grouped.good.length ? `${grouped.good.length} markers look reassuring` : "No standout wins yet"}</h3>
          </div>
          {grouped.good.length ? grouped.good.slice(0, 3).map((item) => (
            <button key={`good-${item.name}`} className="bio-alert-row" onClick={() => setSelectedName(item.name)}>
              <b>{item.name}</b>
              <small>{item.summary}</small>
            </button>
          )) : <p className="muted-copy">We’ll surface positive movement here once the latest report shows meaningful improvement.</p>}
        </section>
        <section className="bio-alert-card watch">
          <div>
            <p className="eyebrow">WATCH LIST</p>
            <h3>
              {grouped.improving.length + grouped.watch.length
                ? `${grouped.improving.length + grouped.watch.length} markers worth a closer look`
                : "No ambiguous shifts right now"}
            </h3>
          </div>
          {[...grouped.improving, ...grouped.watch].slice(0, 4).map((item) => (
            <button key={`watch-${item.name}`} className="bio-alert-row" onClick={() => setSelectedName(item.name)}>
              <b>{item.name}</b>
              <small>{item.summary}</small>
            </button>
          ))}
          {!grouped.improving.length && !grouped.watch.length && <p className="muted-copy">No mixed or borderline changes stood out in the latest report.</p>}
        </section>
      </div>
      <div className="bio-mini-stats">
        <span>{sortedBiomarkers.length} tracked</span>
        <span>{sortedBiomarkers.filter((marker) => marker.points.length > 1).length} with trends</span>
        <span>{sortedBiomarkers.reduce((count, marker) => count + marker.points.length, 0)} total results</span>
      </div>
      <div className="bio-picker">
        {sortedBiomarkers.map((marker) => (
          <button
            key={marker.name}
            className={`bio-pill ${markerSeverityClass(marker.status)} ${
              selected?.name === marker.name ? "active" : ""
            }`}
            onClick={() => setSelectedName(marker.name)}
          >
            <span>{marker.name}</span>
            <b>
              {marker.value} {marker.unit}
            </b>
          </button>
        ))}
      </div>
      {selected && (
        <div className="bio-main">
          <section
            className={`chart-card card biomarker-focus ${markerSeverityClass(selected.status)}`}
          >
            <header>
              <div>
                <p className="eyebrow">MATCHED ACROSS REPORTS</p>
                <h3>{selected.name}</h3>
              </div>
              <div className="range-pill">Reference: {selected.range}</div>
            </header>
            <Sparkline marker={selected} large />
            <div className="bio-focus-foot">
              <span className={`metric-status ${markerSeverityClass(selected.status)}`}>
                {markerStatusLabel(selected.status)}
              </span>
              <small>
                {selected.points.length} recorded result{selected.points.length === 1 ? "" : "s"}
              </small>
            </div>
          </section>
          <section className="bio-history card">
            <div className="section-label">
              <p className="eyebrow">TIMELINE</p>
              <h3>Result history</h3>
            </div>
            {selected.points
              .slice()
              .reverse()
              .map((point, index, rows) => {
                const previous = rows[index + 1];
                const delta =
                  previous !== undefined ? Number(point.value) - Number(previous.value) : null;
                const pointSeverity = markerSeverityClass(point.status || selected.status);
                return (
                  <article
                    className={`bio-history-row ${pointSeverity}`}
                    key={`${selected.name}-${point.date}`}
                  >
                    <div>
                      <b>{prettyDate(point.date)}</b>
                      <small>
                        {point.value} {selected.unit}
                      </small>
                    </div>
                    <div className="bio-history-meta">
                      <span className={`metric-status ${pointSeverity}`}>
                        {markerStatusLabel(point.status || selected.status)}
                      </span>
                      <small>
                        {delta === null
                          ? "Baseline result"
                          : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} ${selected.unit} vs prior`}
                      </small>
                    </div>
                  </article>
                );
              })}
          </section>
        </div>
      )}
    </div>
  );
}

function DocumentsPage({
  documents,
  openUpload,
  currentProfileId,
}: {
  documents: DocumentItem[];
  openUpload: () => void;
  currentProfileId: number;
}) {
  const missing = documents.filter((doc) => !Boolean(doc.hasFile)).length;
  const profileQuery = currentProfileId ? `?profileId=${currentProfileId}` : "";
  return documents.length ? (
    <div className="document-page">
      {missing > 0 && (
        <div className="document-banner card">
          <AlertCircle size={18} />
          <div>
            <b>{missing} older record{missing === 1 ? "" : "s"} only have extracted summaries</b>
            <p>
              Those were ingested before raw PDF/image retention was enabled, so the original files are no longer stored locally. Re-uploading recreates view and download access.
            </p>
          </div>
          <button className="btn ghost" onClick={openUpload}>
            <Upload size={15} />
            Re-upload record
          </button>
        </div>
      )}
      <div className="document-library">
        {documents.map((d) => (
          <article className="document-card card" key={d.id}>
            <div className="document-icon"><FileText size={21}/></div>
            <div className="document-copy">
              <div>
                <span className="type-label">{d.documentType}</span>
                {d.episodeTitle&&<span className="episode-chip">{d.episodeTitle}</span>}
                <span className={`storage-chip ${d.hasFile ? "stored" : "summary"}`}>
                  {d.hasFile ? "Stored file" : "Summary only"}
                </span>
              </div>
              <h3>{d.filename}</h3>
              <p>{d.summary || "No description was extracted for this record."}</p>
              <small>{prettyDate(d.date)} · {d.provider || "Provider not captured"} · {Math.round((d.confidence||0)*100)}% extraction confidence</small>
            </div>
            <div className="document-actions">{d.hasFile?<><a className="icon-btn" aria-label={`View ${d.filename}`} href={`/api/documents/${d.id}/file${profileQuery}`} target="_blank" rel="noreferrer"><Eye size={16}/></a><a className="icon-btn" aria-label={`Download ${d.filename}`} href={`/api/documents/${d.id}/file${profileQuery ? `${profileQuery}&download=1` : "?download=1"}`}><Download size={16}/></a></>:<span className="stored-legacy">Earlier version</span>}</div>
          </article>
        ))}
      </div>
    </div>
  ) : (
    <EmptyState
      icon={FileText}
      title="No documents"
      text="Upload PDFs, reports, prescriptions, or clinical notes."
      action={openUpload}
    />
  );
}

function MedicationsPage({
  interventions,
  logTaken,
  openIntervention,
}: {
  interventions: Intervention[];
  logTaken: (intervention: Intervention) => Promise<void>;
  openIntervention: () => void;
}) {
  const active = interventions.filter((item) => item.status === "active");
  const generalActive = active.filter((item) => !item.episodeTitle);
  const eventLinkedActive = active.filter((item) => Boolean(item.episodeTitle));
  const grouped = scheduleOrder.map((period) => ({
    period,
    items: active.filter((item) =>
      item.scheduleSlots?.some((slot) => slot.period === period),
    ),
  }));
  const archived = interventions.filter((item) => item.status !== "active");
  return interventions.length ? (
    <div className="medications-page">
      <div className="med-agenda card">
        <div className="section-label">
          <p className="eyebrow">TODAY'S ROUTINE</p>
          <h2>Medication schedule</h2>
        </div>
        <div className="med-agenda-grid">
          {grouped.map((group) => (
            <section className="med-slot" key={group.period}>
              <header>
                <span>{group.period}</span>
                <small>{group.items.length ? `${group.items.length} item${group.items.length === 1 ? "" : "s"}` : "Clear"}</small>
              </header>
              {group.items.length ? (
                group.items.map((item) => {
                  const slot = item.scheduleSlots.find((entry) => entry.period === group.period);
                  const accent = accentForIntervention(item);
                  return (
                    <article className={`med-slot-card ${accent} ${item.todaysTaken ? "done" : ""}`} key={`${group.period}-${item.id}`}>
                      <div>
                        <b>{item.name}</b>
                        <small>{slot?.timeLabel || item.frequency || "Flexible"} · {item.dose || "Dose not captured"}</small>
                        <small className="slot-context">{item.episodeTitle || "General routine"}</small>
                      </div>
                      <button
                        className={`slot-check ${item.todaysTaken ? "done" : ""}`}
                        onClick={() => logTaken(item)}
                        disabled={item.todaysTaken}
                      >
                        <Check size={14} />
                      </button>
                    </article>
                  );
                })
              ) : (
                <p className="slot-empty">Nothing scheduled here.</p>
              )}
            </section>
          ))}
        </div>
      </div>
      <div className="med-reference card">
        <div className="section-label">
          <p className="eyebrow">REFERENCE LIST</p>
          <h2>All active medications</h2>
        </div>
        {!!generalActive.length && (
          <section className="med-list-section">
            <header>
              <h3>General supplements and routines</h3>
              <small>{generalActive.length} active</small>
            </header>
            <div className="med-compact-list">
              {generalActive.map((item) => (
                <article className={`med-compact-row ${accentForIntervention(item)}`} key={`general-${item.id}`}>
                  <div className="med-compact-main">
                    <b>{item.name}</b>
                    <small>{item.dose || "Dose not captured"} · {item.frequency || "Schedule not captured"}</small>
                  </div>
                  <div className="med-compact-meta">
                    <span>{item.scheduleSlots?.map((slot) => slot.label).join(" · ") || "Flexible"}</span>
                    <span>{item.adherence7d===null?"No logs yet":`${item.adherence7d}% week`}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {!!eventLinkedActive.length && (
          <section className="med-list-section">
            <header>
              <h3>Event-linked treatments</h3>
              <small>{eventLinkedActive.length} active</small>
            </header>
            <div className="med-compact-list">
              {eventLinkedActive.map((item) => (
                <article className={`med-compact-row ${accentForIntervention(item)}`} key={`event-${item.id}`}>
                  <div className="med-compact-main">
                    <b>{item.name}</b>
                    <small>{item.dose || "Dose not captured"} · {item.frequency || "Schedule not captured"}</small>
                  </div>
                  <div className="med-compact-meta">
                    <span>{item.episodeTitle || "Linked care track"}</span>
                    <span>{item.sourceDocumentId ? "From prescription" : "Active plan"}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
      {archived.length > 0 && (
        <div className="med-archive card">
          <p className="eyebrow">PAST ROUTINES</p>
          <div className="archive-chips">
            {archived.map((item) => (
              <span key={`archived-${item.id}`} className="slot-chip">
                {item.name} · {item.status}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : (
    <EmptyState
      icon={Pill}
      title="No medications or supplements"
      text="Upload a prescription to create routines automatically, or add one manually."
      action={openIntervention}
    />
  );
}

function DataPage({
  page,
  data,
  openUpload,
  openIntervention,
  refresh,
  logTaken,
  doctorEpisodeId,
  currentProfileId,
}: {
  page: string;
  data: Dashboard;
  openUpload: () => void;
  openIntervention: () => void;
  refresh: () => Promise<void>;
  logTaken: (intervention: Intervention) => Promise<void>;
  doctorEpisodeId?: number | null;
  currentProfileId: number;
}) {
  const [brief, setBrief] = useState("");
  const [briefDocuments, setBriefDocuments] = useState<Array<Pick<DocumentItem,"id"|"filename"|"documentType"|"summary"|"hasFile">>>([]);
  const [episodeId,setEpisodeId]=useState<number|null>(doctorEpisodeId||null);
  const [tailor,setTailor]=useState("");
  const [busy, setBusy] = useState(false);
  useEffect(()=>{ if(doctorEpisodeId){ setEpisodeId(doctorEpisodeId); setBrief(""); } },[doctorEpisodeId]);
  const generate = async () => {
    setBusy(true);
    try {
      const x = await api<{ brief: string; documents: typeof briefDocuments }>("/api/doctor-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId, prompt: tailor }),
      });
      setBrief(x.brief);
      setBriefDocuments(x.documents || []);
    } catch (e) {
      setBrief(
        `Could not generate brief: ${e instanceof Error ? e.message : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const action =
    page === "Documents"
      ? openUpload
      : page === "Medications"
        ? openIntervention
        : undefined;
  return (
    <div className="page-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">HEALTH OS</p>
          <h1>{page}</h1>
          <p>
            {page === "Documents"
              ? "Source records parsed and organized locally."
              : page === "Biomarkers"
                ? "Provider-independent longitudinal laboratory history."
              : page === "Medications"
                  ? "Current prescriptions and supplements, with an easy daily routine."
                  : "A concise, evidence-grounded appointment summary."}
          </p>
        </div>
        {action && (
          <button className="btn primary" onClick={action} disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={17} />
            )}{" "}
            {page === "Documents"
              ? "Upload record"
              : page === "Medications"
                ? "Add medication"
                : "Generate brief"}
          </button>
        )}
      </div>
      {page === "Biomarkers" &&
        (data.biomarkers.length ? (
          <BiomarkerTimelinePage
            biomarkers={data.biomarkers}
            insights={data.biomarkerInsights}
          />
        ) : (
          <EmptyState
            icon={FlaskConical}
            title="No biomarker history"
            text="Upload your first laboratory report."
            action={openUpload}
          />
        ))}
      {page === "Documents" && (
        <DocumentsPage documents={data.documents} openUpload={openUpload} currentProfileId={currentProfileId} />
      )}
      {page === "Medications" && (
        <MedicationsPage
          interventions={data.interventions}
          logTaken={logTaken}
          openIntervention={openIntervention}
        />
      )}
      {page === "Doctor prep" &&
          <div className="doctor-prep-layout"><aside className="prep-controls card"><div className="modal-icon"><Stethoscope size={22}/></div><h2>Shape the appointment</h2><p>Choose a care track so the brief, timeline, and documents stay focused.</p><label><span>Care track</span><select value={episodeId||""} onChange={e=>{setEpisodeId(e.target.value?Number(e.target.value):null);setBrief("");}}><option value="">General health overview</option>{data.episodes.map(e=><option value={e.id} key={e.id}>{e.title}</option>)}</select></label><label><span>What should the doctor know?</span><textarea value={tailor} onChange={e=>setTailor(e.target.value)} placeholder="e.g. Focus on whether I can return to running and mention my recent swelling."/></label><button className="btn primary" onClick={generate} disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>}Generate tailored prep</button></aside><section className="prep-output">{brief?<><div className="doctor-brief card"><div className="brief-markdown"><ReactMarkdown>{brief}</ReactMarkdown></div></div><div className="carry-docs card"><header><div><p className="eyebrow">SUGGESTED TO CARRY</p><h3>Relevant documents</h3></div>{episodeId&&briefDocuments.some(d=>Boolean(d.hasFile))&&<a className="btn primary" href={`/api/episodes/${episodeId}/documents.zip?profileId=${currentProfileId}`}><Package size={15}/>Download all</a>}</header>{briefDocuments.length?briefDocuments.map(d=><div key={d.id}><FileText size={17}/><span><b>{d.filename}</b><small>{d.summary}</small></span>{Boolean(d.hasFile)&&<><a className="icon-btn" href={`/api/documents/${d.id}/file?profileId=${currentProfileId}`} target="_blank" rel="noreferrer" aria-label={`View ${d.filename}`}><Eye size={14}/></a><a className="icon-btn" href={`/api/documents/${d.id}/file?profileId=${currentProfileId}&download=1`} aria-label={`Download ${d.filename}`}><Download size={14}/></a></>}</div>):<p className="muted-copy">No linked documents were found for this prep.</p>}</div></>:<EmptyState icon={Stethoscope} title="Your appointment, prepared" text="Generate a concise brief with care-track history, symptom trends, medications, questions, and the records worth carrying."/>}</section></div>}
    </div>
  );
}

export default function App() {
  const initialPath =
    typeof window === "undefined" ? "/" : window.location.pathname;
  const initialSearch =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const initialProfileId = Number(initialSearch.get("profileId"));
  const portal =
    initialPath.startsWith("/elder") || initialSearch.get("experience") === "elder"
      ? "elder"
      : "caregiver";
  const initialOverlay = parseOverlayParam(initialSearch.get("overlay"));
  const initialElderPanel = parseElderPanelParam(initialSearch.get("panel"));
  const initialCheckinEpisodeId = Number(initialSearch.get("checkinEpisodeId"));
  const [page, setPage] = useState(
    portal === "caregiver" ? parsePageParam(initialSearch.get("page")) : "Overview",
  );
  const [data, setData] = useState<Dashboard>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    Number.isFinite(initialProfileId) && initialProfileId > 0
      ? initialProfileId
      : null,
  );
  const [overlay, setOverlay] = useState<OverlayState>(initialOverlay);
  const [checkinEpisodeId, setCheckinEpisodeId] = useState<number | null>(
    initialOverlay === "checkin" &&
      Number.isFinite(initialCheckinEpisodeId) &&
      initialCheckinEpisodeId > 0
      ? initialCheckinEpisodeId
      : null,
  );
  const [doctorEpisodeId, setDoctorEpisodeId] = useState<number | null>(null);
  const [elderPanel, setElderPanel] = useState<ElderPanelState>(
    portal === "elder" ? initialElderPanel : null,
  );
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);
  const [query, setQuery] = useState("");
  const mobile = overlay === "menu";
  const checkin =
    overlay === "checkin"
      ? data.episodes.find((episode) => episode.id === checkinEpisodeId) || null
      : null;
  const buildUrl = ({
    nextPage = page,
    nextProfileId = selectedProfileId,
    nextOverlay = overlay,
    nextCheckinEpisodeId = checkinEpisodeId,
    nextElderPanel = elderPanel,
  }: {
    nextPage?: string;
    nextProfileId?: number | null;
    nextOverlay?: OverlayState;
    nextCheckinEpisodeId?: number | null;
    nextElderPanel?: ElderPanelState;
  }) => {
    const next = new URL(window.location.href);
    next.pathname = portal === "elder" ? "/elder" : "/";
    if (nextProfileId) next.searchParams.set("profileId", String(nextProfileId));
    else next.searchParams.delete("profileId");
    if (portal === "caregiver") next.searchParams.set("experience", "caregiver");
    else next.searchParams.delete("experience");
    if (portal === "caregiver" && nextPage !== "Overview")
      next.searchParams.set("page", nextPage);
    else next.searchParams.delete("page");
    if (nextOverlay) next.searchParams.set("overlay", nextOverlay);
    else next.searchParams.delete("overlay");
    if (nextOverlay === "checkin" && nextCheckinEpisodeId)
      next.searchParams.set("checkinEpisodeId", String(nextCheckinEpisodeId));
    else next.searchParams.delete("checkinEpisodeId");
    if (portal === "elder" && nextElderPanel)
      next.searchParams.set("panel", nextElderPanel);
    else next.searchParams.delete("panel");
    return `${next.pathname}${next.search}`;
  };
  const applyUiState = (
    nextState: Partial<{
      nextPage: string;
      nextProfileId: number | null;
      nextOverlay: OverlayState;
      nextCheckinEpisodeId: number | null;
      nextElderPanel: ElderPanelState;
    }>,
    mode: "push" | "replace" = "push",
  ) => {
    const resolvedPage = nextState.nextPage ?? page;
    const resolvedProfileId = nextState.nextProfileId ?? selectedProfileId;
    const resolvedOverlay =
      nextState.nextOverlay === undefined ? overlay : nextState.nextOverlay;
    const resolvedElderPanel =
      nextState.nextElderPanel === undefined ? elderPanel : nextState.nextElderPanel;
    const resolvedCheckinEpisodeId =
      resolvedOverlay === "checkin"
        ? nextState.nextCheckinEpisodeId ?? checkinEpisodeId
        : null;
    setPage(resolvedPage);
    setSelectedProfileId(resolvedProfileId);
    setOverlay(resolvedOverlay);
    setCheckinEpisodeId(resolvedCheckinEpisodeId);
    setElderPanel(resolvedElderPanel);
    const targetUrl = buildUrl({
      nextPage: resolvedPage,
      nextProfileId: resolvedProfileId,
      nextOverlay: resolvedOverlay,
      nextCheckinEpisodeId: resolvedCheckinEpisodeId,
      nextElderPanel: resolvedElderPanel,
    });
    window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", targetUrl);
  };
  const refresh = async () => {
    try {
      setError("");
      activeProfileId = selectedProfileId;
      const next = await api<Dashboard>("/api/dashboard");
      setData(next);
      activeProfileId = next.currentProfileId || selectedProfileId;
      if (selectedProfileId === null && next.currentProfileId) {
        setSelectedProfileId(next.currentProfileId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load health data");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, [selectedProfileId]);
  useEffect(() => {
    if (portal !== "elder" || selectedProfileId !== null || !data.profiles.length)
      return;
    const linkedProfile =
      data.profiles.find((profile) => profile.profileType === "caregiver-linked") ||
      data.profiles[0];
    if (linkedProfile?.id) setSelectedProfileId(linkedProfile.id);
  }, [portal, selectedProfileId, data.profiles]);
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextProfileId = Number(params.get("profileId"));
      setPage(portal === "caregiver" ? parsePageParam(params.get("page")) : "Overview");
      const nextOverlay = parseOverlayParam(params.get("overlay"));
      setOverlay(nextOverlay);
      setElderPanel(portal === "elder" ? parseElderPanelParam(params.get("panel")) : null);
      setCheckinEpisodeId(
        nextOverlay === "checkin" &&
          Number.isFinite(Number(params.get("checkinEpisodeId"))) &&
          Number(params.get("checkinEpisodeId")) > 0
          ? Number(params.get("checkinEpisodeId"))
          : null,
      );
      if (Number.isFinite(nextProfileId) && nextProfileId > 0) {
        setSelectedProfileId(nextProfileId);
      }
      setQuery("");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [portal]);
  useEffect(() => {
    if (!selectedProfileId) return;
    window.history.replaceState(
      {},
      "",
      buildUrl({
        nextPage: page,
        nextProfileId: selectedProfileId,
        nextOverlay: overlay,
        nextCheckinEpisodeId: checkinEpisodeId,
        nextElderPanel: elderPanel,
      }),
    );
  }, [selectedProfileId]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("healthos-theme", theme);
  }, [theme]);
  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  const currentProfile =
    data.profiles.find((profile) => profile.id === (selectedProfileId || data.currentProfileId)) ||
    data.profiles[0];
  const searchResults = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return [
      ...data.documents.map((x) => ({
        type: "Document",
        title: x.filename,
        detail: x.summary,
      })),
      ...data.events.map((x) => ({
        type: "Event",
        title: x.title,
        detail: x.detail,
      })),
      ...data.episodes.map((x) => ({ type: "Care track", title: x.title, detail: x.summary })),
      ...data.biomarkers.map((x) => ({
        type: "Biomarker",
        title: x.name,
        detail: `${x.value} ${x.unit}`,
      })),
    ]
      .filter((x) => `${x.title} ${x.detail}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, data]);
  const complete = async (id: number) => {
    await api(`/api/followups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    await refresh();
  };
  const logTaken = async (intervention: Intervention) => {
    await api(`/api/interventions/${intervention.id}/adherence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        taken: true,
        dose: intervention.dose,
      }),
    });
    await refresh();
  };
  if (portal === "elder") {
    return (
      <div className="elder-app-shell">
        <main className="elder-main">
          {loading ? (
            <div className="page-loader">
              <LoaderCircle className="spin" />
              <p>Loading your health memory…</p>
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load Health OS"
              text={error}
            />
          ) : (
            <ElderDashboard
              data={data}
              currentProfile={currentProfile}
              openUpload={() => applyUiState({ nextOverlay: "upload" }, "push")}
              logTaken={logTaken}
              activePanel={elderPanel}
              onPanelChange={(panel) =>
                applyUiState({ nextElderPanel: panel }, panel ? "push" : "replace")
              }
              theme={theme}
              toggleTheme={toggleTheme}
            />
          )}
        </main>
        {overlay === "upload" && (
          <UploadModal
            close={() => applyUiState({ nextOverlay: null }, "replace")}
            onComplete={refresh}
            simpleFlow
          />
        )}
        {overlay === "profile" && (
          <AddProfileModal
            close={() => applyUiState({ nextOverlay: null }, "replace")}
            onComplete={refresh}
          />
        )}
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Logo />
        <button
          aria-label="Close menu"
          className="mobile-close"
          onClick={() => applyUiState({ nextOverlay: null }, "replace")}
        >
          <X />
        </button>
        <nav>
          {nav.map((item) => {
            const icons:Record<string,typeof Activity> = { Overview:LayoutDashboard, "Care tracks":HeartPulse, Medications:Pill, Biomarkers:FlaskConical, Timeline:Activity, Documents:FileText, "Doctor prep":Stethoscope };
            const I = icons[item];
            return (
              <button
                key={item}
                className={page === item ? "active" : ""}
                onClick={() => {
                  applyUiState(
                    { nextPage: item, nextOverlay: null, nextCheckinEpisodeId: null },
                    "push",
                  );
                }}
              >
                <I size={18} />
                {item}
                {item === "Documents" && (
                  <span className="nav-count">{data.counts.documents}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span>
              <Check size={14} />
            </span>
            <div>
              <b>Local by design</b>
              <p>
                Original files and structured health history stay stored on
                this machine.
              </p>
            </div>
          </div>
          <div className="profile-panel">
            <div className="profile current">
              <span>{(currentProfile?.name || "PH").slice(0,2).toUpperCase()}</span>
              <div>
                <b>{currentProfile?.name || "Personal workspace"}</b>
                <small>
                  {currentProfile?.profileType === "caregiver-linked"
                    ? `Managed by ${currentProfile.caregiverName || "caregiver"}`
                    : `${data.counts.documents} connected records`}
                </small>
              </div>
              <MoreHorizontal size={17} />
            </div>
            <div className="profile-list">
              {data.profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={`profile-switch ${currentProfile?.id === profile.id ? "active" : ""}`}
                  onClick={() => {
                    activeProfileId = profile.id;
                    applyUiState(
                      {
                        nextProfileId: profile.id,
                        nextOverlay: null,
                        nextCheckinEpisodeId: null,
                      },
                      "push",
                    );
                  }}
                >
                  <span>{profile.name}</span>
                  {currentProfile?.id === profile.id && <small>Active</small>}
                </button>
              ))}
            </div>
            <button
              className="btn ghost profile-add"
              onClick={() => applyUiState({ nextOverlay: "profile" }, "push")}
            >
              <Plus size={15} /> Add profile
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            aria-label="Open menu"
            className="mobile-menu"
            onClick={() => applyUiState({ nextOverlay: "menu" }, "push")}
          >
            <Menu />
          </button>
          <div className="mobile-logo">
            <Logo />
          </div>
          <div className="search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your health history"
            />
            <kbd>⌘ K</kbd>
            {query.trim() && (
              <div className="search-results">
                {searchResults.length ? (
                  searchResults.map((r, i) => (
                    <button
                      key={`${r.title}-${i}`}
                      onClick={() => {
                        setQuery("");
                        applyUiState(
                          {
                            nextPage:
                              r.type === "Document"
                                ? "Documents"
                                : r.type === "Biomarker"
                                  ? "Biomarkers"
                                  : r.type === "Care track"
                                    ? "Care tracks"
                                  : "Timeline",
                          },
                          "push",
                        );
                      }}
                    >
                      <span>{r.type}</span>
                      <b>{r.title}</b>
                      <small>{r.detail}</small>
                    </button>
                  ))
                ) : (
                  <p>No matches in your health memory.</p>
                )}
              </div>
            )}
          </div>
          {currentProfile?.profileType === "caregiver-linked" && (
            <div className="profile-context-banner">
              <b>Viewing {currentProfile.name}</b>
              <small>
                Managed by {currentProfile.caregiverName || "caregiver"}
                {currentProfile.relationshipLabel
                  ? ` · ${currentProfile.relationshipLabel}`
                  : ""}
              </small>
            </div>
          )}
          <button
            className="icon-btn theme-toggle"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            onClick={toggleTheme}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button className="icon-btn" aria-label="Notifications">
            <Bell size={18} />
            {data.counts.followups > 0 && <i />}
          </button>
        </header>
        <div className="content">
          {loading ? (
            <div className="page-loader">
              <LoaderCircle className="spin" />
              <p>Loading your health memory…</p>
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load Health OS"
              text={error}
            />
          ) : page === "Overview" ? (
            <Overview
              data={data}
              openUpload={() => applyUiState({ nextOverlay: "upload" }, "push")}
              completeFollowup={complete}
            />
          ) : page === "Timeline" ? (
            <TimelinePage events={data.events} />
          ) : page === "Care tracks" ? (
            <EventsPage
              episodes={data.episodes}
              openEvent={() => applyUiState({ nextOverlay: "event" }, "push")}
              openCheckin={(episode) =>
                applyUiState(
                  {
                    nextOverlay: "checkin",
                    nextCheckinEpisodeId: episode.id,
                  },
                  "push",
                )
              }
              refresh={refresh}
              prepare={(episode) => {
                setDoctorEpisodeId(episode.id);
                applyUiState({ nextPage: "Doctor prep" }, "push");
              }}
            />
          ) : (
            <DataPage
              page={page}
              data={data}
              openUpload={() => applyUiState({ nextOverlay: "upload" }, "push")}
              openIntervention={() =>
                applyUiState({ nextOverlay: "intervention" }, "push")
              }
              refresh={refresh}
              logTaken={logTaken}
              doctorEpisodeId={doctorEpisodeId}
              currentProfileId={selectedProfileId || data.currentProfileId}
            />
          )}
          <footer>
            <span>Health OS</span>
            <p>Care that stays connected across generations.</p>
            <small>
              Information only — not a substitute for professional medical
              advice.
            </small>
          </footer>
        </div>
      </main>
      <button
        className="floating-ai"
        onClick={() => applyUiState({ nextOverlay: "assistant" }, "push")}
      >
        <Sparkles size={18} />
        <span>Ask about your health</span>
      </button>
      {overlay === "upload" && (
        <UploadModal
          close={() => applyUiState({ nextOverlay: null }, "replace")}
          onComplete={refresh}
        />
      )}{" "}
      {overlay === "intervention" && (
        <InterventionModal
          close={() => applyUiState({ nextOverlay: null }, "replace")}
          onComplete={refresh}
        />
      )}{" "}
      {overlay === "event" && (
        <EventModal
          close={() => applyUiState({ nextOverlay: null }, "replace")}
          onComplete={refresh}
        />
      )}{" "}
      {checkin && (
        <CheckinModal
          episode={checkin}
          close={() =>
            applyUiState(
              { nextOverlay: null, nextCheckinEpisodeId: null },
              "replace",
            )
          }
          onComplete={refresh}
        />
      )}{" "}
      {overlay === "assistant" && (
        <Assistant
          close={() => applyUiState({ nextOverlay: null }, "replace")}
          hasData={data.counts.documents + data.counts.interventions > 0}
        />
      )}{" "}
      {overlay === "profile" && (
        <AddProfileModal
          close={() => applyUiState({ nextOverlay: null }, "replace")}
          onComplete={refresh}
        />
      )}{" "}
      {mobile && (
        <div
          className="mobile-shade"
          onClick={() => applyUiState({ nextOverlay: null }, "replace")}
        />
      )}
    </div>
  );
}
