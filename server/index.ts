import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import * as archiverModule from "archiver";
import OpenAI from "openai";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const ZipArchive = (archiverModule as any).ZipArchive as new (
  options: { zlib: { level: number } },
) => archiverModule.Archiver;
const app = express();
const port = Number(process.env.PORT || 8788);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(root, "data");
await mkdir(dataDir, { recursive: true });
const dbPath = process.env.HEALTHOS_DB_PATH || join(dataDir, "healthos.sqlite");
const db = new DatabaseSync(dbPath);
await chmod(dbPath, 0o600).catch(() => undefined);
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
);
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    profile_type TEXT NOT NULL DEFAULT 'independent',
    caregiver_name TEXT,
    relationship_label TEXT,
    preferred_experience TEXT NOT NULL DEFAULT 'caregiver',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY, filename TEXT NOT NULL, document_type TEXT NOT NULL DEFAULT 'Medical document',
    document_date TEXT, provider TEXT, summary TEXT, confidence REAL, status TEXT NOT NULL,
    parsed_text TEXT NOT NULL, extracted_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    profile_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS biomarkers (
    id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    name TEXT NOT NULL, normalized_name TEXT NOT NULL, value REAL NOT NULL, unit TEXT,
    reference_range TEXT, status TEXT NOT NULL DEFAULT 'unknown', measured_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS biomarkers_name_date ON biomarkers(normalized_name, measured_at);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, event_date TEXT NOT NULL, title TEXT NOT NULL, meta TEXT, detail TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
    profile_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS events_date ON events(event_date DESC);
  CREATE TABLE IF NOT EXISTS interventions (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, intervention_type TEXT NOT NULL, start_date TEXT NOT NULL,
    end_date TEXT, status TEXT NOT NULL DEFAULT 'active', dose TEXT, frequency TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    profile_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    title TEXT NOT NULL, due_date TEXT, reason TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, episode_type TEXT NOT NULL, start_date TEXT NOT NULL,
    end_date TEXT, status TEXT NOT NULL DEFAULT 'active', summary TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    profile_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS document_episodes (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    confidence REAL NOT NULL, rationale TEXT, PRIMARY KEY(document_id,episode_id)
  );
  CREATE TABLE IF NOT EXISTS adherence_logs (
    id INTEGER PRIMARY KEY, intervention_id INTEGER NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL, taken INTEGER NOT NULL CHECK(taken IN (0,1)), dose TEXT, notes TEXT,
    UNIQUE(intervention_id,log_date)
  );
  CREATE TABLE IF NOT EXISTS episode_checkins (
    id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL, pain INTEGER, stiffness INTEGER, swelling INTEGER, function_score INTEGER,
    notes TEXT, flagged INTEGER NOT NULL DEFAULT 0, flag_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(episode_id,log_date)
  );
  CREATE TABLE IF NOT EXISTS document_actions (
    id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL, action_type TEXT NOT NULL,
    title TEXT NOT NULL, detail TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS medication_dose_logs (
    id INTEGER PRIMARY KEY, intervention_id INTEGER NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL, slot_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('taken','missed','skipped')),
    logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT,
    UNIQUE(intervention_id,log_date,slot_key)
  );
  CREATE TABLE IF NOT EXISTS food_entries (
    id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
    eaten_at TEXT NOT NULL, meal_type TEXT, image_blob BLOB NOT NULL, mime_type TEXT NOT NULL,
    summary TEXT NOT NULL, assessment_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const documentColumns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
const profileColumns = db.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>;
const defaultProfileExisting = db.prepare("SELECT id FROM profiles WHERE is_default=1 LIMIT 1").get() as any;
if (!defaultProfileExisting) {
  db.prepare("INSERT INTO profiles(name,is_default) VALUES(?,1)").run("Personal workspace");
}
const defaultProfileId = Number(
  (
    db.prepare("SELECT id FROM profiles WHERE is_default=1 ORDER BY id ASC LIMIT 1").get() as any
  ).id,
);
if (!profileColumns.some((c) => c.name === "profile_type"))
  db.exec("ALTER TABLE profiles ADD COLUMN profile_type TEXT NOT NULL DEFAULT 'independent'");
if (!profileColumns.some((c) => c.name === "caregiver_name"))
  db.exec("ALTER TABLE profiles ADD COLUMN caregiver_name TEXT");
if (!profileColumns.some((c) => c.name === "relationship_label"))
  db.exec("ALTER TABLE profiles ADD COLUMN relationship_label TEXT");
if (!profileColumns.some((c) => c.name === "preferred_experience"))
  db.exec(
    "ALTER TABLE profiles ADD COLUMN preferred_experience TEXT NOT NULL DEFAULT 'caregiver'",
  );
if (!documentColumns.some((c) => c.name === "profile_id"))
  db.exec(`ALTER TABLE documents ADD COLUMN profile_id INTEGER NOT NULL DEFAULT ${defaultProfileId}`);
if (!documentColumns.some((c) => c.name === "file_blob")) db.exec("ALTER TABLE documents ADD COLUMN file_blob BLOB");
if (!documentColumns.some((c) => c.name === "mime_type")) db.exec("ALTER TABLE documents ADD COLUMN mime_type TEXT");
if (!documentColumns.some((c) => c.name === "instructions_json")) db.exec("ALTER TABLE documents ADD COLUMN instructions_json TEXT NOT NULL DEFAULT '[]'");
if (!documentColumns.some((c) => c.name === "action_items_json")) db.exec("ALTER TABLE documents ADD COLUMN action_items_json TEXT NOT NULL DEFAULT '[]'");
const interventionColumns = db
  .prepare("PRAGMA table_info(interventions)")
  .all() as Array<{ name: string }>;
if (!interventionColumns.some((c) => c.name === "profile_id"))
  db.exec(`ALTER TABLE interventions ADD COLUMN profile_id INTEGER NOT NULL DEFAULT ${defaultProfileId}`);
if (!interventionColumns.some((c) => c.name === "schedule_per_week"))
  db.exec(
    "ALTER TABLE interventions ADD COLUMN schedule_per_week INTEGER NOT NULL DEFAULT 7",
  );
if (!interventionColumns.some((c) => c.name === "source_document_id"))
  db.exec("ALTER TABLE interventions ADD COLUMN source_document_id INTEGER REFERENCES documents(id)");
if (!interventionColumns.some((c) => c.name === "schedule_json"))
  db.exec("ALTER TABLE interventions ADD COLUMN schedule_json TEXT");
const episodeColumns = db.prepare("PRAGMA table_info(episodes)").all() as Array<{ name: string }>;
if (!episodeColumns.some((c) => c.name === "profile_id"))
  db.exec(`ALTER TABLE episodes ADD COLUMN profile_id INTEGER NOT NULL DEFAULT ${defaultProfileId}`);
if (!episodeColumns.some((c) => c.name === "marker_schema_json"))
  db.exec("ALTER TABLE episodes ADD COLUMN marker_schema_json TEXT");
const eventColumns = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
if (!eventColumns.some((c) => c.name === "profile_id"))
  db.exec(`ALTER TABLE events ADD COLUMN profile_id INTEGER NOT NULL DEFAULT ${defaultProfileId}`);
const checkinColumns = db
  .prepare("PRAGMA table_info(episode_checkins)")
  .all() as Array<{ name: string }>;
if (!checkinColumns.some((c) => c.name === "metrics_json"))
  db.exec("ALTER TABLE episode_checkins ADD COLUMN metrics_json TEXT");

const allowed = new Set([".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) =>
    allowed.has(extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error("Unsupported file type.")),
});

app.disable("x-powered-by");
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? false
        : ["http://localhost:5180", "http://127.0.0.1:5180"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

function aiClient() {
  if (!process.env.NEYSA_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.NEYSA_API_KEY,
    baseURL:
      process.env.NEYSA_BASE_URL ||
      "https://neysa-gemma-26b-a4b.pipeshift.com/v1",
  });
}

async function liteParse(file: Express.Multer.File) {
  const dir = await mkdtemp(join(tmpdir(), "healthos-"));
  const input = join(
    dir,
    `document${extname(file.originalname).toLowerCase()}`,
  );
  try {
    await writeFile(input, file.buffer, { mode: 0o600 });
    const bin = join(root, "node_modules", ".bin", "lit");
    const { stdout } = await execFileAsync(
      bin,
      [
        "parse",
        input,
        "--format",
        "markdown",
        "--image-mode",
        "off",
        "--max-pages",
        "100",
        "--quiet",
      ],
      { maxBuffer: 12 * 1024 * 1024, timeout: 120000 },
    );
    if (!stdout.trim()) throw new Error("LiteParse returned no readable text.");
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function imageFilesToPdf(files: Express.Multer.File[]) {
  return await new Promise<Buffer>(async (resolvePromise, rejectPromise) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", rejectPromise);
    try {
      for (const file of files) {
        const meta = await sharp(file.buffer).metadata();
        const width = Math.max(1, meta.width || 1240);
        const height = Math.max(1, meta.height || 1754);
        doc.addPage({ size: [width, height], margin: 0 });
        doc.image(file.buffer, 0, 0, {
          fit: [width, height],
          align: "center",
          valign: "center",
        });
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      rejectPromise(error);
    }
  });
}

const extractionSchema = z.object({
  documentType: z.string().default("Medical document"),
  date: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  summary: z.string().default(""),
  confidence: z.coerce.number().min(0).max(1).default(0.7),
  biomarkers: z
    .array(
      z.object({
        name: z.string(),
        value: z.coerce.number(),
        unit: z.string().nullable().optional(),
        referenceRange: z.string().nullable().optional(),
        status: z
          .enum(["low", "normal", "high", "critical", "unknown"])
          .default("unknown"),
      }),
    )
    .default([]),
  diagnoses: z
    .array(
      z.object({
        name: z.string(),
        date: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
      }),
    )
    .default([]),
  medications: z
    .array(
      z.object({
        name: z.string(),
        dose: z.string().nullable().optional(),
        frequency: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
      }),
    )
    .default([]),
  followUps: z
    .array(
      z.object({
        title: z.string(),
        dueDate: z.string().nullable().optional(),
        reason: z.string().nullable().optional(),
      }),
    )
    .default([]),
  observations: z
    .array(
      z.object({
        name: z.string(),
        value: z.coerce.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        severity: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .default([]),
  instructions: z.array(z.string().trim().min(2)).default([]),
  actionItems: z
    .array(
      z.object({
        title: z.string().trim().min(2),
        detail: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        type: z.enum(["appointment", "test", "medication", "monitoring", "lifestyle", "other"]).default("other"),
      }),
    )
    .default([]),
});

const extractionPrompt = `You extract medical facts from parsed documents. Return ONLY valid JSON matching:
{"documentType":"Blood report|Prescription|Consultation note|Imaging|Discharge summary|Referral|Vaccination record|Medical document","date":"YYYY-MM-DD or null","provider":"string or null","summary":"concise factual summary","confidence":0.0,"biomarkers":[{"name":"canonical laboratory analyte name","value":0,"unit":"string or null","referenceRange":"string or null","status":"low|normal|high|critical|unknown"}],"diagnoses":[{"name":"string","date":"YYYY-MM-DD or null","status":"string or null"}],"medications":[{"name":"string","dose":"string or null","frequency":"string or null","status":"active|stopped|unknown"}],"followUps":[{"title":"explicit future test, review, referral, or monitoring task","dueDate":"YYYY-MM-DD or null","reason":"string or null"}],"observations":[{"name":"symptom, functional measure, or patient-reported outcome","value":0,"unit":"string or null","severity":"string or null","notes":"string or null"}],"instructions":["explicit care instruction"],"actionItems":[{"title":"concise action","detail":"why/how or null","dueDate":"YYYY-MM-DD or null","type":"appointment|test|medication|monitoring|lifestyle|other"}]}
Never infer facts that are absent. Biomarkers are ONLY laboratory analytes from laboratory results; pain scores, range of motion, balance time, weight, symptoms, and physical-exam measurements belong in observations. Follow-ups are explicit future actions, not current treatment instructions. Look carefully for the next scheduled appointment, clinic review, specialist visit, referral booking, or repeat test date, especially when a document says "follow up", "review", "return", "see again", or "repeat in X weeks". If a future visit is tied to a diagnosis or care stream, preserve that context in the follow-up title or reason. Normalize dates and biomarker names. Numeric biomarker values must be numbers.`;

const episodeMarkerSchema = z.object({
  key: z.string().min(2).max(40),
  label: z.string().min(2).max(40),
  question: z.string().min(3).max(160),
  direction: z.enum(["higher_worse", "higher_better"]),
  lowAnchor: z.string().min(2).max(40),
  highAnchor: z.string().min(2).max(40),
});
const episodeMarkerListSchema = z.object({
  markers: z.array(episodeMarkerSchema).min(3).max(4),
});
type EpisodeMarker = z.infer<typeof episodeMarkerSchema>;

const scheduleSlotSchema = z.object({
  key: z.string().min(2).max(24),
  label: z.string().min(2).max(40),
  period: z.enum([
    "morning",
    "midday",
    "evening",
    "bedtime",
    "weekly",
    "anytime",
  ]),
  timeLabel: z.string().min(2).max(30),
});
type ScheduleSlot = z.infer<typeof scheduleSlotSchema>;

function slugKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function allProfiles() {
  return db
    .prepare(
      "SELECT id,name,is_default as isDefault,profile_type as profileType,caregiver_name as caregiverName,relationship_label as relationshipLabel,preferred_experience as preferredExperience,created_at as createdAt FROM profiles ORDER BY is_default DESC, created_at ASC, id ASC",
    )
    .all();
}

function resolveProfileId(raw: unknown) {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    const exists = db.prepare("SELECT id FROM profiles WHERE id=?").get(parsed) as any;
    if (exists) return parsed;
  }
  return defaultProfileId;
}

function normalizeMarkerSet(markers: EpisodeMarker[]) {
  const used = new Set<string>();
  return markers
    .slice(0, 4)
    .map((marker, index) => {
      let key = slugKey(marker.key || marker.label || `marker_${index + 1}`);
      while (!key || used.has(key)) key = `${key || "marker"}_${used.size + 1}`;
      used.add(key);
      return {
        key,
        label: marker.label.trim(),
        question: marker.question.trim(),
        direction: marker.direction,
        lowAnchor: marker.lowAnchor.trim(),
        highAnchor: marker.highAnchor.trim(),
      };
    })
    .slice(0, 3);
}

function fallbackEpisodeMarkers(
  title: string,
  type: string,
  summary: string,
): EpisodeMarker[] {
  const text = `${title} ${type} ${summary}`.toLowerCase();
  if (
    type === "injury" ||
    /(sprain|strain|tear|fracture|ankle|knee|shoulder|swelling|ligament|back pain|injury)/i.test(
      text,
    )
  ) {
    return [
      {
        key: "pain",
        label: "Pain",
        question: "How intense is the pain today?",
        direction: "higher_worse",
        lowAnchor: "None",
        highAnchor: "Severe",
      },
      {
        key: "stiffness",
        label: "Stiffness",
        question: "How stiff or restricted does it feel today?",
        direction: "higher_worse",
        lowAnchor: "Loose",
        highAnchor: "Very stiff",
      },
      {
        key: "function_score",
        label: "Function",
        question: "How well can you use the affected area today?",
        direction: "higher_better",
        lowAnchor: "Very limited",
        highAnchor: "Normal",
      },
    ];
  }
  if (
    /(sleep|insomnia|fatigue|tired|stress|burnout|energy)/i.test(text) &&
    !/(vitamin|mineral|iron|ferritin|b12|nutrient)/i.test(text)
  ) {
    return [
      {
        key: "sleep_quality",
        label: "Sleep quality",
        question: "How restorative did your sleep feel?",
        direction: "higher_better",
        lowAnchor: "Poor",
        highAnchor: "Excellent",
      },
      {
        key: "energy",
        label: "Energy",
        question: "How much usable energy did you have today?",
        direction: "higher_better",
        lowAnchor: "Drained",
        highAnchor: "Strong",
      },
      {
        key: "stress",
        label: "Stress",
        question: "How high did stress or overwhelm feel today?",
        direction: "higher_worse",
        lowAnchor: "Calm",
        highAnchor: "High stress",
      },
    ];
  }
  if (
    type === "monitoring" ||
    /(vitamin|mineral|nutrient|supplement|general health|wellness|ferritin|b12|iron|magnesium)/i.test(
      text,
    )
  ) {
    return [
      {
        key: "energy",
        label: "Energy",
        question: "How has your energy felt today?",
        direction: "higher_better",
        lowAnchor: "Low",
        highAnchor: "Excellent",
      },
      {
        key: "sleep_quality",
        label: "Sleep quality",
        question: "How good was your sleep or recovery?",
        direction: "higher_better",
        lowAnchor: "Poor",
        highAnchor: "Great",
      },
      {
        key: "tiredness",
        label: "Tiredness",
        question: "How heavy or tired did you feel through the day?",
        direction: "higher_worse",
        lowAnchor: "Fresh",
        highAnchor: "Exhausted",
      },
    ];
  }
  if (/(gut|stomach|digestion|bloat|reflux|bowel)/i.test(text)) {
    return [
      {
        key: "symptom_load",
        label: "Symptom load",
        question: "How bothersome were your symptoms overall today?",
        direction: "higher_worse",
        lowAnchor: "Minimal",
        highAnchor: "Severe",
      },
      {
        key: "appetite",
        label: "Appetite",
        question: "How normal did your appetite feel today?",
        direction: "higher_better",
        lowAnchor: "Poor",
        highAnchor: "Normal",
      },
      {
        key: "function_score",
        label: "Daily function",
        question: "How much did this affect your day?",
        direction: "higher_better",
        lowAnchor: "Disruptive",
        highAnchor: "No impact",
      },
    ];
  }
  return [
    {
      key: "overall_feeling",
      label: "Overall feeling",
      question: "How are you feeling overall today?",
      direction: "higher_better",
      lowAnchor: "Poor",
      highAnchor: "Great",
    },
    {
      key: "energy",
      label: "Energy",
      question: "How has your energy been today?",
      direction: "higher_better",
      lowAnchor: "Low",
      highAnchor: "High",
    },
    {
      key: "symptom_load",
      label: "Symptom load",
      question: "How troublesome were symptoms today?",
      direction: "higher_worse",
      lowAnchor: "Minimal",
      highAnchor: "Severe",
    },
  ];
}

async function suggestEpisodeMarkers(
  ai: OpenAI | null,
  {
    title,
    type,
    summary,
  }: {
    title: string;
    type: string;
    summary: string;
  },
) {
  if (!ai) return fallbackEpisodeMarkers(title, type, summary);
  try {
    const response = await ai.chat.completions.create({
      model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            'Choose the top 3 daily self-tracking markers for a health event. Return ONLY JSON matching {"markers":[{"key":"short_snake_case","label":"string","question":"string","direction":"higher_worse|higher_better","lowAnchor":"string","highAnchor":"string"}]}. Prefer simple patient-reported markers scored from 1 to 5. Avoid lab analytes. Avoid duplicates. Use higher_better for function, sleep quality, energy, appetite, mood, and higher_worse for pain, swelling, stiffness, stress, tiredness, symptom burden.',
        },
        {
          role: "user",
          content: JSON.stringify({ title, type, summary }),
        },
      ],
    });
    const raw = response.choices[0]?.message?.content || "{}";
    const block = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    const parsed = episodeMarkerListSchema.parse(JSON.parse(block));
    return normalizeMarkerSet(parsed.markers);
  } catch {
    return fallbackEpisodeMarkers(title, type, summary);
  }
}

function deriveScheduleSlots(
  frequency: string | null | undefined,
  type = "Medication",
): ScheduleSlot[] {
  const text = (frequency || "").toLowerCase();
  const build = (
    key: string,
    label: string,
    period: ScheduleSlot["period"],
    timeLabel: string,
  ) => ({ key, label, period, timeLabel });
  if (/once weekly|weekly|every week/.test(text))
    return [build("weekly", "Weekly", "weekly", "Any day")];
  if (/bedtime|night/.test(text))
    return [build("bedtime", "Bedtime", "bedtime", "10 PM")];
  if (
    /(morning).*(evening)|(evening).*(morning)|twice|2\s*x|two times|bid/.test(
      text,
    )
  )
    return [
      build("morning", "Morning", "morning", "8 AM"),
      build("evening", "Evening", "evening", "8 PM"),
    ];
  if (/three|3\s*x|tid|thrice/.test(text))
    return [
      build("morning", "Morning", "morning", "8 AM"),
      build("midday", "Midday", "midday", "1 PM"),
      build("evening", "Evening", "evening", "8 PM"),
    ];
  if (/four|4\s*x|qid/.test(text))
    return [
      build("morning", "Morning", "morning", "8 AM"),
      build("midday", "Midday", "midday", "1 PM"),
      build("evening", "Evening", "evening", "6 PM"),
      build("bedtime", "Bedtime", "bedtime", "10 PM"),
    ];
  if (/midday|lunch|afternoon|noon/.test(text))
    return [build("midday", "Midday", "midday", "1 PM")];
  if (/evening|dinner/.test(text))
    return [build("evening", "Evening", "evening", "8 PM")];
  if (/morning|breakfast/.test(text))
    return [build("morning", "Morning", "morning", "8 AM")];
  if (type.toLowerCase() === "supplement")
    return [build("morning", "Morning", "morning", "8 AM")];
  return [build("anytime", "Anytime", "anytime", "Flexible")];
}

function schedulePerWeekForSlots(slots: ScheduleSlot[]) {
  if (!slots.length) return 7;
  if (slots.length === 1 && slots[0].period === "weekly") return 1;
  return Math.min(21, slots.length * 7);
}

function metricsFromLegacyRow(row: any, markers: EpisodeMarker[]) {
  const metrics: Record<string, number> = {};
  const legacyMap: Record<string, number | null | undefined> = {
    pain: row.pain,
    stiffness: row.stiffness,
    swelling: row.swelling,
    function_score: row.functionScore ?? row.function_score,
    functionscore: row.functionScore ?? row.function_score,
    function: row.functionScore ?? row.function_score,
  };
  for (const marker of markers) {
    const value = legacyMap[marker.key] ?? legacyMap[marker.key.replaceAll("_", "")];
    if (typeof value === "number") metrics[marker.key] = value;
  }
  return metrics;
}

function parseMetrics(raw: unknown, row: any, markers: EpisodeMarker[]) {
  const stored = safeJson<Record<string, number>>(raw, {});
  const merged = { ...metricsFromLegacyRow(row, markers), ...stored };
  return markers.reduce(
    (acc, marker) => ({
      ...acc,
      [marker.key]:
        typeof merged[marker.key] === "number"
          ? Number(merged[marker.key])
          : 3,
    }),
    {} as Record<string, number>,
  );
}

function markerScoreLabel(marker: EpisodeMarker, score: number) {
  return score === 1
    ? marker.lowAnchor
    : score === 5
      ? marker.highAnchor
      : `${score}/5`;
}

function markerConcerning(marker: EpisodeMarker, score: number) {
  return marker.direction === "higher_worse" ? score >= 4 : score <= 2;
}

function markerSevere(marker: EpisodeMarker, score: number) {
  return marker.direction === "higher_worse" ? score >= 5 : score <= 1;
}

function worseDelta(marker: EpisodeMarker, current: number, previous: number) {
  return marker.direction === "higher_worse"
    ? current - previous
    : previous - current;
}

function evaluateCheckin(
  markers: EpisodeMarker[],
  metrics: Record<string, number>,
  previous: Array<Record<string, number>>,
) {
  const severe = markers.find((marker) => markerSevere(marker, metrics[marker.key]));
  if (severe)
    return {
      flagged: true,
      flagReason: `${severe.label} reached a concerning level (${markerScoreLabel(severe, metrics[severe.key])}). Consider checking in with a clinician, especially if this is new or escalating.`,
    };
  const worsening = markers.find((marker) => {
    if (previous.length < 2) return false;
    const current = metrics[marker.key];
    const recent = previous[0]?.[marker.key];
    const older = previous[1]?.[marker.key];
    return (
      typeof recent === "number" &&
      typeof older === "number" &&
      worseDelta(marker, current, recent) > 0 &&
      worseDelta(marker, recent, older) >= 0
    );
  });
  if (worsening)
    return {
      flagged: true,
      flagReason: `${worsening.label} has been moving the wrong way across three check-ins. A clinician review would be sensible if this continues.`,
    };
  const clustered = markers.filter((marker) => markerConcerning(marker, metrics[marker.key]));
  if (clustered.length >= 2)
    return {
      flagged: true,
      flagReason: `${clustered.map((marker) => marker.label).join(" and ")} are both outside the reassuring range today. Consider medical review if that is unusual for you.`,
    };
  return { flagged: false, flagReason: null as string | null };
}

function checkinSummary(
  markers: EpisodeMarker[],
  metrics: Record<string, number> | undefined,
) {
  if (!metrics) return "No recent check-in recorded.";
  return markers
    .map((marker) => `${marker.label} ${metrics[marker.key]}/5`)
    .join(", ");
}

function relativePriority(dueDate: string | null) {
  if (!dueDate) return "watch";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T12:00:00`);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.valueOf() - today.valueOf()) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays <= 7) return "soon";
  return "watch";
}

function isAppointmentFollowup(task: {
  title?: string | null;
  reason?: string | null;
}) {
  const text = `${task.title || ""} ${task.reason || ""}`.toLowerCase();
  const appointmentSignal =
    /appointment|clinic|visit|consult|follow-up|follow up|review/.test(text);
  const testOnlySignal =
    /repeat|recheck|blood test|lab|panel|urine|creatinine|potassium|ac1|hba1c|imaging|scan|ultrasound|mri|x-ray/.test(
      text,
    );
  return appointmentSignal && !testOnlySignal;
}

const episodeDecisionSchema = z.object({
  action: z.enum(["existing", "new", "none"]),
  episodeId: z.coerce.number().nullable().optional(),
  title: z.string().nullable().optional(),
  type: z
    .enum([
      "monitoring",
      "injury",
      "condition",
      "medication",
      "preventive",
      "other",
    ])
    .nullable()
    .optional(),
  confidence: z.coerce.number().min(0).max(1).default(0.7),
  rationale: z.string().default(""),
});
type EpisodeDecision = z.infer<typeof episodeDecisionSchema>;

async function classifyEpisode(
  extraction: z.infer<typeof extractionSchema>,
  ai: OpenAI,
  profileId: number,
): Promise<EpisodeDecision> {
  const existing = db
    .prepare(
      "SELECT id,title,episode_type as type,start_date as startDate,status,summary FROM episodes WHERE profile_id=? ORDER BY start_date DESC",
    )
    .all(profileId);
  const recent = db
    .prepare(
      "SELECT event_date as date,event_type as type,title,detail FROM events WHERE profile_id=? ORDER BY event_date DESC LIMIT 25",
    )
    .all(profileId);
  const response = await ai.chat.completions.create({
    model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You organize a longitudinal personal health record. Decide whether the new document belongs to an existing health episode, starts a new episode, or needs no episode. Lab panels and supplement reviews about the same metabolic/nutrient goals should share one monitoring episode. A consultation, prescription, imaging, and physiotherapy follow-up for the same injury should share one injury episode. Prefer an existing episode whenever dates, diagnoses, body site, medications, or purpose clearly connect. Return ONLY JSON: {"action":"existing|new|none","episodeId":number|null,"title":"concise episode title|null","type":"monitoring|injury|condition|medication|preventive|other|null","confidence":0.0,"rationale":"short factual reason"}. Never use an episodeId not listed.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          existingEpisodes: existing,
          recentEvents: recent,
          newDocument: extraction,
        }),
      },
    ],
  });
  const raw = response.choices[0]?.message?.content || "{}";
  const block = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  const decision = episodeDecisionSchema.parse(JSON.parse(block));
  if (
    decision.action === "existing" &&
    !existing.some((x: any) => Number(x.id) === decision.episodeId)
  )
    return {
      ...decision,
      action: "new",
      episodeId: null,
      title: decision.title || `${extraction.documentType} episode`,
    };
  return decision;
}

function normalizeName(name: string) {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("vitamin") && n.includes("d")) return "vitamin d";
  if (
    n.includes("hba1c") ||
    n.includes("hemoglobina1c") ||
    n.includes("glycatedhemoglobin")
  )
    return "hba1c";
  if (n.includes("fastingglucose") || n.includes("glucosefasting"))
    return "fasting glucose";
  if (n.includes("totalcholesterol")) return "total cholesterol";
  if (n.includes("ldl")) return "ldl cholesterol";
  if (n.includes("hdl")) return "hdl cholesterol";
  if (n.includes("triglycer")) return "triglycerides";
  if (n.includes("ferritin")) return "ferritin";
  if (
    n.includes("thyrotropin") ||
    n === "tsh" ||
    n.includes("tshultrasensitive")
  )
    return "tsh";
  if (
    n.includes("alanineaminotransferase") ||
    n.includes("sgpt") ||
    n === "alt"
  )
    return "alt";
  if (
    n.includes("aspartateaminotransferase") ||
    n.includes("sgot") ||
    n === "ast"
  )
    return "ast";
  if (n.includes("creatinekinase") || n === "ck") return "creatine kinase";
  if (n.includes("creatinine")) return "creatinine";
  if (
    n.includes("estimatedgfr") ||
    n.includes("egfr") ||
    n.includes("glomerularfiltrationrate")
  )
    return "egfr";
  if (
    n.includes("highsensitivitycrp") ||
    n.includes("hscrp") ||
    (n.includes("creactiveprotein") && n.includes("sensitivity"))
  )
    return "hs-crp";
  if (n.includes("vitaminb12") || n === "b12") return "vitamin b12";
  if (n.includes("zinc")) return "zinc";
  if (n.includes("magnesium")) return "magnesium";
  if (n === "hemoglobin") return "hemoglobin";
  if (n.includes("wbc") || n.includes("whitebloodcell")) return "wbc count";
  if (n.includes("platelet")) return "platelet count";
  return name.trim().toLowerCase();
}

function parseModelJson(raw: string) {
  const block =
    raw.match(/\{[\s\S]*\}/)?.[0] || raw.replace(/^```json\s*|\s*```$/g, "");
  return extractionSchema.parse(JSON.parse(block));
}

function similarTask(a: string, b: string) {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word &&
          !["the", "a", "an", "further", "weekly", "supervised"].includes(word),
      );
  const left = clean(a);
  const right = clean(b);
  const leftText = left.join(" ");
  const rightText = right.join(" ");
  if (leftText.includes(rightText) || rightText.includes(leftText)) return true;
  const shared = left.filter((word) => right.includes(word)).length;
  return shared / Math.max(1, Math.min(left.length, right.length)) >= 0.75;
}

function persistExtraction(
  profileId: number,
  filename: string,
  mimeType: string,
  fileBuffer: Buffer,
  text: string,
  extraction: z.infer<typeof extractionSchema>,
  episode: EpisodeDecision,
  markerSchema?: EpisodeMarker[],
) {
  const date = extraction.date || new Date().toISOString().slice(0, 10);
  db.exec("BEGIN IMMEDIATE");
  try {
    const doc = db
      .prepare(
        "INSERT INTO documents(profile_id,filename,document_type,document_date,provider,summary,confidence,status,parsed_text,extracted_json,mime_type,file_blob,instructions_json,action_items_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        profileId,
        filename,
        extraction.documentType,
        date,
        extraction.provider || null,
        extraction.summary,
        extraction.confidence,
        "organized",
        text,
        JSON.stringify(extraction),
        mimeType,
        fileBuffer,
        JSON.stringify(extraction.instructions),
        JSON.stringify(extraction.actionItems),
      );
    const documentId = Number(doc.lastInsertRowid);
    let episodeId: number | null = null;
    if (episode.action === "existing" && episode.episodeId)
      episodeId = episode.episodeId;
    if (episode.action === "new" && episode.title) {
      const created = db
        .prepare(
          "INSERT INTO episodes(profile_id,title,episode_type,start_date,summary,marker_schema_json) VALUES(?,?,?,?,?,?)",
        )
        .run(
          profileId,
          episode.title,
          episode.type || "other",
          date,
          episode.rationale,
          JSON.stringify(
            normalizeMarkerSet(
              markerSchema ||
                fallbackEpisodeMarkers(
                  episode.title,
                  episode.type || "other",
                  extraction.summary,
                ),
            ),
          ),
        );
      episodeId = Number(created.lastInsertRowid);
    }
    if (episodeId)
      db.prepare(
        "INSERT INTO document_episodes(document_id,episode_id,confidence,rationale) VALUES(?,?,?,?)",
      ).run(documentId, episodeId, episode.confidence, episode.rationale);
    const markerInsert = db.prepare(
      "INSERT INTO biomarkers(document_id,name,normalized_name,value,unit,reference_range,status,measured_at) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (const b of extraction.biomarkers)
      markerInsert.run(
        documentId,
        b.name,
        normalizeName(b.name),
        b.value,
        b.unit || null,
        b.referenceRange || null,
        b.status,
        date,
      );
    const eventInsert = db.prepare(
      "INSERT INTO events(profile_id,document_id,event_type,event_date,title,meta,detail,tags_json) VALUES(?,?,?,?,?,?,?,?)",
    );
    const documentKind = extraction.documentType.toLowerCase();
    const eventType = documentKind.includes("prescription")
      ? "medication"
      : documentKind.includes("doctor") ||
          documentKind.includes("consultation") ||
          documentKind.includes("discharge")
        ? "visit"
        : documentKind.includes("vaccination")
          ? "intervention"
          : "lab";
    eventInsert.run(
      profileId,
      documentId,
      eventType,
      date,
      extraction.documentType,
      extraction.provider || filename,
      extraction.summary,
      JSON.stringify(
        extraction.biomarkers
          .slice(0, 4)
          .map((b) => `${b.name} ${b.value}${b.unit || ""}`),
      ),
    );
    for (const diagnosis of extraction.diagnoses)
      eventInsert.run(
        profileId,
        documentId,
        "diagnosis",
        diagnosis.date || date,
        diagnosis.name,
        extraction.provider || "",
        diagnosis.status || "",
        "[]",
      );
    for (const med of extraction.medications)
      eventInsert.run(
        profileId,
        documentId,
        "medication",
        date,
        med.name,
        [med.dose, med.frequency].filter(Boolean).join(" · "),
        med.status || "",
        "[]",
      );
    const interventionInsert = db.prepare(
      "INSERT INTO interventions(profile_id,name,intervention_type,start_date,status,dose,frequency,notes,schedule_per_week,source_document_id,schedule_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const med of extraction.medications) {
      const existing = db.prepare(
        "SELECT id FROM interventions WHERE profile_id=? AND lower(name)=lower(?) AND status='active' LIMIT 1",
      ).get(profileId, med.name);
      if (med.status === "stopped") {
        db.prepare("UPDATE interventions SET status='stopped',end_date=? WHERE profile_id=? AND lower(name)=lower(?) AND status='active'")
          .run(date, profileId, med.name);
        continue;
      }
      if (existing) {
        db.prepare("UPDATE interventions SET dose=COALESCE(?,dose),frequency=COALESCE(?,frequency) WHERE id=?")
          .run(med.dose || null, med.frequency || null, (existing as any).id);
        continue;
      }
      const frequency = med.frequency || "As prescribed";
      const scheduleSlots = deriveScheduleSlots(frequency, "Medication");
      const schedule = /twice|2\s*x|bid/i.test(frequency)
        ? 14
        : /three|3\s*x|tid/i.test(frequency)
          ? 21
          : /weekly/i.test(frequency)
            ? 1
            : schedulePerWeekForSlots(scheduleSlots);
      interventionInsert.run(
        profileId,
        med.name,
        "Medication",
        date,
        med.status === "unknown" ? "active" : med.status || "active",
        med.dose || null,
        frequency,
        `Created automatically from ${filename}`,
        schedule,
        documentId,
        JSON.stringify(scheduleSlots),
      );
    }
    for (const observation of extraction.observations)
      eventInsert.run(
        profileId,
        documentId,
        "symptom",
        date,
        observation.name,
        [observation.value, observation.unit]
          .filter((x) => x !== null && x !== undefined)
          .join(" "),
        observation.notes || observation.severity || "",
        "[]",
      );
    const followInsert = db.prepare(
      "INSERT INTO followups(document_id,title,due_date,reason) VALUES(?,?,?,?)",
    );
    for (const f of extraction.followUps) {
      const episodeTasks = episodeId
        ? (db
            .prepare(
              "SELECT f.title FROM followups f JOIN document_episodes de ON de.document_id=f.document_id WHERE de.episode_id=? AND f.status='open'",
            )
            .all(episodeId) as Array<{ title: string }>)
        : [];
      if (episodeTasks.some((task) => similarTask(task.title, f.title)))
        continue;
      followInsert.run(
        documentId,
        f.title,
        f.dueDate || null,
        f.reason || null,
      );
    }
    const actionInsert = db.prepare(
      "INSERT INTO document_actions(document_id,episode_id,action_type,title,detail,due_date) VALUES(?,?,?,?,?,?)",
    );
    const extractedActions = [
      ...extraction.actionItems,
      ...extraction.instructions.map((instruction) => ({
        title: instruction, detail: null, dueDate: null, type: "other" as const,
      })),
    ];
    for (const action of extractedActions) {
      if (extraction.followUps.some((followup) => similarTask(followup.title, action.title))) continue;
      actionInsert.run(documentId, episodeId, action.type, action.title, action.detail || null, action.dueDate || null);
    }
    db.exec("COMMIT");
    return documentId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// One-time compatibility backfill: older ingested prescriptions predate automatic routines.
for (const row of db.prepare("SELECT id,profile_id as profileId,filename,document_date as date,extracted_json as json FROM documents WHERE extracted_json IS NOT NULL").all() as any[]) {
  try {
    const extracted = JSON.parse(row.json);
    for (const med of extracted.medications || []) {
      if (med.status === "stopped" || db.prepare("SELECT id FROM interventions WHERE profile_id=? AND lower(name)=lower(?) LIMIT 1").get(row.profileId, med.name)) continue;
      const frequency = med.frequency || "As prescribed";
      const scheduleSlots = deriveScheduleSlots(frequency, "Medication");
      const schedule = /twice|2\s*x|bid/i.test(frequency) ? 14 : /three|3\s*x|tid/i.test(frequency) ? 21 : /weekly/i.test(frequency) ? 1 : schedulePerWeekForSlots(scheduleSlots);
      db.prepare("INSERT INTO interventions(profile_id,name,intervention_type,start_date,status,dose,frequency,notes,schedule_per_week,source_document_id,schedule_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(row.profileId, med.name, "Medication", row.date || new Date().toISOString().slice(0, 10), "active", med.dose || null, frequency, `Created automatically from ${row.filename}`, schedule, row.id, JSON.stringify(scheduleSlots));
    }
  } catch {
    // Keep legacy records readable even if their historic extraction JSON is malformed.
  }
}

for (const episode of db
  .prepare(
    "SELECT id,title,episode_type as type,summary FROM episodes WHERE marker_schema_json IS NULL OR trim(marker_schema_json)=''",
  )
  .all() as any[]) {
  const markers = normalizeMarkerSet(
    fallbackEpisodeMarkers(episode.title, episode.type, episode.summary || ""),
  );
  db.prepare("UPDATE episodes SET marker_schema_json=? WHERE id=?").run(
    JSON.stringify(markers),
    episode.id,
  );
}

for (const row of db
  .prepare(
    "SELECT c.id,c.episode_id as episodeId,c.pain,c.stiffness,c.swelling,c.function_score as functionScore,c.metrics_json as metricsJson,e.marker_schema_json as markerSchemaJson FROM episode_checkins c JOIN episodes e ON e.id=c.episode_id WHERE c.metrics_json IS NULL OR trim(c.metrics_json)=''",
  )
  .all() as any[]) {
  const markers = normalizeMarkerSet(
    safeJson<EpisodeMarker[]>(
      row.markerSchemaJson,
      fallbackEpisodeMarkers("", "other", ""),
    ),
  );
  const metrics = metricsFromLegacyRow(row, markers);
  db.prepare("UPDATE episode_checkins SET metrics_json=? WHERE id=?").run(
    JSON.stringify(metrics),
    row.id,
  );
}

for (const intervention of db
  .prepare(
    "SELECT id,frequency,intervention_type as type FROM interventions WHERE schedule_json IS NULL OR trim(schedule_json)=''",
  )
  .all() as any[]) {
  const schedule = deriveScheduleSlots(intervention.frequency, intervention.type);
  db.prepare("UPDATE interventions SET schedule_json=? WHERE id=?").run(
    JSON.stringify(schedule),
    intervention.id,
  );
}

function dashboardData(profileId: number) {
  const profile = db
    .prepare(
      "SELECT id,name,is_default as isDefault,profile_type as profileType,caregiver_name as caregiverName,relationship_label as relationshipLabel,preferred_experience as preferredExperience,created_at as createdAt FROM profiles WHERE id=?",
    )
    .get(profileId) as any;
  const docs = db
    .prepare(
      "SELECT d.id,d.filename,d.document_type as documentType,d.document_date as date,d.provider,d.summary,d.status,d.confidence,d.created_at as createdAt,d.mime_type as mimeType,(d.file_blob IS NOT NULL) as hasFile,d.instructions_json as instructionsJson,d.action_items_json as actionItemsJson,e.id as episodeId,e.title as episodeTitle,de.confidence as episodeConfidence FROM documents d LEFT JOIN document_episodes de ON de.document_id=d.id LEFT JOIN episodes e ON e.id=de.episode_id WHERE d.profile_id=? AND d.status!='archived' ORDER BY COALESCE(d.document_date,d.created_at) DESC",
    )
    .all(profileId).map((document: any) => ({
      ...document,
      instructions: safeJson<string[]>(document.instructionsJson, []),
      actionItems: safeJson<any[]>(document.actionItemsJson, []),
    }));
  const rawMarkers = db
    .prepare(
      "SELECT b.name,b.normalized_name as normalizedName,b.value,b.unit,b.reference_range as referenceRange,b.status,b.measured_at as date,e.id as episodeId,e.title as episodeTitle FROM biomarkers b JOIN documents d ON d.id=b.document_id LEFT JOIN document_episodes de ON de.document_id=d.id LEFT JOIN episodes e ON e.id=de.episode_id WHERE d.profile_id=? ORDER BY b.measured_at ASC",
    )
    .all(profileId) as Array<Record<string, unknown>>;
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rawMarkers) {
    const key = String(row.normalizedName);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const biomarkers = [...groups.values()]
    .map((rows) => {
      const latest = rows.at(-1)!;
      const first = rows[0];
      const delta =
        rows.length > 1 ? Number(latest.value) - Number(first.value) : null;
      return {
        name: latest.name,
        value: latest.value,
        unit: latest.unit || "",
        status:
          latest.status === "normal"
            ? "good"
            : latest.status === "unknown"
              ? "watch"
              : latest.status,
        range: latest.referenceRange || "Not provided",
        delta,
        points: rows.map((r: Record<string, unknown>) => ({
          date: r.date,
          value: r.value,
          status:
            r.status === "normal"
              ? "good"
              : r.status === "unknown"
                ? "watch"
                : r.status,
          range: r.referenceRange || "Not provided",
          episodeId: r.episodeId || null,
          episodeTitle: r.episodeTitle || null,
        })),
        episodeId: latest.episodeId || null,
        episodeTitle: latest.episodeTitle || null,
      };
    })
    .sort((a, b) => String(a.status).localeCompare(String(b.status)));
  const events = db
    .prepare(
      "SELECT ev.id,ev.event_type as type,ev.event_date as date,ev.title,ev.meta,ev.detail,ev.tags_json as tags,ep.id as episodeId,ep.title as episodeTitle FROM events ev LEFT JOIN documents d ON d.id=ev.document_id LEFT JOIN document_episodes de ON de.document_id=d.id LEFT JOIN episodes ep ON ep.id=de.episode_id WHERE ev.profile_id=? ORDER BY ev.event_date DESC,ev.id DESC LIMIT 100",
    )
    .all(profileId)
    .map((e: any) => ({ ...e, tags: JSON.parse(e.tags) }));
  const followups = db
    .prepare(
      "SELECT f.id,f.title,f.due_date as dueDate,f.reason,f.status,e.title as episodeTitle FROM followups f JOIN documents d ON d.id=f.document_id LEFT JOIN document_episodes de ON de.document_id=d.id LEFT JOIN episodes e ON e.id=de.episode_id WHERE d.profile_id=? AND f.status='open' ORDER BY f.due_date IS NULL,f.due_date ASC",
    )
    .all(profileId)
    .map((followup: any) => ({
      ...followup,
      kind: isAppointmentFollowup(followup) ? "appointment" : "followup",
    }));
  const interventions = (
    db
      .prepare(
        "SELECT i.id,i.name,i.intervention_type as type,i.start_date as startDate,i.end_date as endDate,i.status,i.dose,i.frequency,i.notes,i.schedule_per_week as schedulePerWeek,i.source_document_id as sourceDocumentId,i.schedule_json as scheduleJson,e.id as episodeId,e.title as episodeTitle,e.episode_type as episodeType FROM interventions i LEFT JOIN documents d ON d.id=i.source_document_id LEFT JOIN document_episodes de ON de.document_id=d.id LEFT JOIN episodes e ON e.id=de.episode_id WHERE i.profile_id=? ORDER BY CASE i.status WHEN 'active' THEN 0 ELSE 1 END,i.start_date DESC",
      )
      .all(profileId) as any[]
  ).map((i) => {
    const latest = (
      db
        .prepare(
          "SELECT MAX(log_date) as date FROM (SELECT log_date FROM adherence_logs WHERE intervention_id=? UNION ALL SELECT log_date FROM medication_dose_logs WHERE intervention_id=?)",
        )
        .get(i.id, i.id) as any
    )?.date;
    let adherence7d: null | number = i.status === "active" ? 0 : null;
    if (latest) {
      const start = new Date(`${latest}T12:00:00`);
      start.setDate(start.getDate() - 6);
      const legacyTaken = Number(
        (
          db
            .prepare(
              "SELECT COALESCE(SUM(taken),0) as n FROM adherence_logs WHERE intervention_id=? AND log_date BETWEEN ? AND ?",
            )
            .get(i.id, start.toISOString().slice(0, 10), latest) as any
        ).n,
      );
      const slotTaken = Number((db.prepare(
        "SELECT COUNT(*) as n FROM medication_dose_logs WHERE intervention_id=? AND status='taken' AND log_date BETWEEN ? AND ?",
      ).get(i.id, start.toISOString().slice(0, 10), latest) as any).n);
      const taken = Math.max(legacyTaken, slotTaken);
      adherence7d = Math.min(
        100,
        Math.round((taken / Math.max(1, i.schedulePerWeek)) * 100),
      );
    }
    const scheduleSlots = safeJson<ScheduleSlot[]>(
      i.scheduleJson,
      deriveScheduleSlots(i.frequency, i.type),
    );
    const today = new Date().toISOString().slice(0, 10);
    const takenSlots = (db.prepare(
      "SELECT slot_key as slotKey FROM medication_dose_logs WHERE intervention_id=? AND log_date=? AND status='taken'",
    ).all(i.id, today) as any[]).map((row) => row.slotKey);
    const legacyTaken = Boolean((db.prepare(
      "SELECT taken FROM adherence_logs WHERE intervention_id=? AND log_date=? ORDER BY id DESC LIMIT 1",
    ).get(i.id, today) as any)?.taken);
    return { ...i, adherence7d, scheduleSlots, takenSlots, todaysTaken: legacyTaken || takenSlots.length >= scheduleSlots.length };
  });
  const episodes = (db
    .prepare(
      "SELECT id,title,episode_type as type,start_date as startDate,end_date as endDate,status,summary,marker_schema_json as markerSchemaJson,(SELECT COUNT(*) FROM document_episodes de WHERE de.episode_id=episodes.id) as documentCount FROM episodes WHERE profile_id=? ORDER BY start_date DESC",
    )
    .all(profileId) as any[]).map((episode) => {
      const markerSchema = normalizeMarkerSet(
        safeJson<EpisodeMarker[]>(
          episode.markerSchemaJson,
          fallbackEpisodeMarkers(episode.title, episode.type, episode.summary || ""),
        ),
      );
      const checkins = db.prepare(
        "SELECT id,log_date as date,pain,stiffness,swelling,function_score as functionScore,metrics_json as metricsJson,notes,flagged,flag_reason as flagReason FROM episode_checkins WHERE episode_id=? ORDER BY log_date ASC",
      ).all(episode.id).map((row: any) => ({
        id: row.id,
        date: row.date,
        metrics: parseMetrics(row.metricsJson, row, markerSchema),
        notes: row.notes,
        flagged: row.flagged,
        flagReason: row.flagReason,
      }));
      const linkedDocuments = db.prepare(
        "SELECT d.id,d.filename,d.document_type as documentType,d.summary,(d.file_blob IS NOT NULL) as hasFile FROM documents d JOIN document_episodes de ON de.document_id=d.id WHERE de.episode_id=? ORDER BY d.document_date DESC",
      ).all(episode.id);
      return {
        ...episode,
        markerSchema,
        checkins,
        linkedDocuments,
        appointments: followups.filter((item: any) => item.episodeTitle === episode.title && item.kind === "appointment"),
        actions: db.prepare("SELECT id,action_type as type,title,detail,due_date as dueDate,status FROM document_actions WHERE episode_id=? AND status='open' ORDER BY due_date IS NULL,due_date ASC").all(episode.id),
        medicines: interventions.filter((item: any) => Number(item.episodeId) === Number(episode.id)),
        biomarkers: biomarkers.filter((item: any) => Number(item.episodeId) === Number(episode.id)),
      };
    });
  const actions = db.prepare(
    "SELECT a.id,a.action_type as type,a.title,a.detail,a.due_date as dueDate,a.status,a.document_id as documentId,d.filename,e.id as episodeId,e.title as episodeTitle FROM document_actions a JOIN documents d ON d.id=a.document_id LEFT JOIN episodes e ON e.id=a.episode_id WHERE d.profile_id=? AND a.status='open' ORDER BY a.due_date IS NULL,a.due_date ASC,a.id DESC",
  ).all(profileId);
  const foodEntries = (db.prepare(
    "SELECT f.id,f.eaten_at as eatenAt,f.meal_type as mealType,f.summary,f.assessment_json as assessmentJson,f.episode_id as episodeId,e.title as episodeTitle FROM food_entries f LEFT JOIN episodes e ON e.id=f.episode_id WHERE f.profile_id=? ORDER BY f.eaten_at DESC LIMIT 60",
  ).all(profileId) as any[]).map((entry) => ({ ...entry, assessment: safeJson(entry.assessmentJson, {}) }));
  const now = new Date();
  const slotDueHour: Record<string, number> = { morning: 12, midday: 17, evening: 22, bedtime: 24, weekly: 24, anytime: 24 };
  const missedDoses: any[] = [];
  for (const intervention of interventions.filter((item: any) => item.status === "active" && /medication|medicine/i.test(item.type))) {
    for (let daysAgo = 1; daysAgo >= 0; daysAgo--) {
      const day = new Date(now); day.setDate(day.getDate() - daysAgo);
      const date = day.toISOString().slice(0, 10);
      for (const slot of intervention.scheduleSlots) {
        if (daysAgo === 0 && now.getHours() < (slotDueHour[slot.period] ?? 24)) continue;
        const log = db.prepare("SELECT status FROM medication_dose_logs WHERE intervention_id=? AND log_date=? AND slot_key=?").get(intervention.id, date, slot.key) as any;
        const legacy = db.prepare("SELECT taken FROM adherence_logs WHERE intervention_id=? AND log_date=?").get(intervention.id, date) as any;
        if (log?.status === "taken" || (legacy?.taken && intervention.scheduleSlots.length === 1)) continue;
        missedDoses.push({
          id: `dose-${intervention.id}-${date}-${slot.key}`,
          interventionId: intervention.id, medicine: intervention.name, dose: intervention.dose,
          date, slotKey: slot.key, slotLabel: slot.label, timeLabel: slot.timeLabel,
          episodeId: intervention.episodeId, episodeTitle: intervention.episodeTitle,
          status: log?.status || "unlogged", severity: daysAgo > 0 ? "missed" : "due",
          notification: { type: "medication_missed", channel: "in_app", actionable: true },
        });
      }
    }
  }
  const insights = biomarkers
    .filter((b) => b.points.length > 1)
    .slice(0, 3)
    .map((b) => ({
      tone: ["high", "low", "critical"].includes(String(b.status))
        ? "warning"
        : Number(b.delta) > 0
          ? "positive"
          : "neutral",
      eyebrow: "LONGITUDINAL TREND",
      title: `${b.name} ${Number(b.delta) > 0 ? "increased" : "decreased"}`,
      text: `Changed by ${Math.abs(Number(b.delta)).toFixed(1)} ${b.unit} across ${b.points.length} recorded measurements.`,
    }));
  const relationshipRules: Array<[string, string[]]> = [
    ["vitamin d", ["vitamin d"]],
    ["omega", ["triglycer", "ldl"]],
    ["creatine", ["creatinine", "creatine kinase"]],
    ["zinc", ["zinc"]],
    ["magnesium", ["magnesium"]],
  ];
  for (const intervention of interventions) {
    const rule = relationshipRules.find(([needle]) =>
      intervention.name.toLowerCase().includes(needle),
    );
    if (!rule) continue;
    const marker = biomarkers.find((item) =>
      rule[1].some((needle) =>
        String(item.name).toLowerCase().includes(needle),
      ),
    );
    if (!marker || marker.points.length < 2) continue;
    const before = marker.points
      .filter((point) => String(point.date) <= intervention.startDate)
      .at(-1);
    const after = marker.points
      .filter((point) => String(point.date) > intervention.startDate)
      .at(-1);
    if (!before || !after) continue;
    const change = Number(after.value) - Number(before.value);
    insights.push({
      tone: "neutral",
      eyebrow: "POSSIBLE RELATIONSHIP",
      title: `${marker.name} changed after ${intervention.name} started`,
      text: `${before.value} to ${after.value} ${marker.unit} after ${prettyIso(intervention.startDate)}. Timing is suggestive, but does not establish that the intervention caused the change.`,
    });
  }
  for (const intervention of interventions.filter(
    (item) => item.adherence7d !== null && item.adherence7d < 80,
  )) {
    insights.push({
      tone: "warning",
      eyebrow: "ADHERENCE PATTERN",
      title: `${intervention.name} consistency is ${intervention.adherence7d}%`,
      text: `Below the planned ${intervention.schedulePerWeek} doses per week in the latest logged week. Interpret outcome trends with adherence in mind.`,
    });
  }
  for (const episode of episodes) {
    const flagged = episode.checkins.filter((item: any) => item.flagged).at(-1);
    if (!flagged) continue;
    insights.unshift({
      tone: "warning",
      eyebrow: "EVENT CHECK-IN FLAG",
      title: `${episode.title} may need clinical review`,
      text: flagged.flagReason || "Recent symptom tracking is outside the expected recovery pattern.",
    });
  }
  const latestBiomarkerDate = biomarkers
    .flatMap((marker) => marker.points.map((point) => String(point.date)))
    .sort()
    .at(-1);
  const biomarkerInsights = latestBiomarkerDate
    ? biomarkers
        .filter((marker) => marker.points.at(-1)?.date === latestBiomarkerDate)
        .map((marker) => {
          const current = marker.points.at(-1);
          const previous = marker.points.at(-2);
          if (!current || !previous) return null;
          const currentValue = Number(current.value);
          const previousValue = Number(previous.value);
          const currentStatus = String(current.status || marker.status);
          const previousStatus = String(previous.status || currentStatus);
          const percentChange =
            previousValue === 0
              ? null
              : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
          const meaningful =
            currentStatus !== "good" ||
            (percentChange !== null && Math.abs(percentChange) >= 10);
          if (!meaningful) return null;
          const isImprovingDirection =
            (["high", "critical"].includes(currentStatus) &&
              currentValue < previousValue) ||
            (currentStatus === "low" && currentValue > previousValue);
          const movedIntoRange =
            previousStatus !== "good" && currentStatus === "good";
          const category =
            currentStatus === "good"
              ? movedIntoRange
                ? "good"
                : "watch"
              : isImprovingDirection
                ? "improving"
                : "bad";
          return {
            name: marker.name,
            category,
            currentValue,
            previousValue,
            unit: marker.unit,
            status: currentStatus,
            percentChange,
            summary:
              category === "bad"
                ? `${marker.name} moved further away from range since the previous result.`
                : category === "good"
                  ? `${marker.name} moved back into range versus the previous result.`
                : category === "improving"
                  ? `${marker.name} improved versus the previous result, but still deserves monitoring.`
                  : `${marker.name} changed meaningfully but remains in range.`,
          };
        })
        .filter(Boolean)
    : [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const reminders = followups
    .filter(
      (followup: any) =>
        followup.kind === "appointment" &&
        Boolean(followup.dueDate) &&
        String(followup.dueDate) >= todayIso,
    )
    .map((followup: any) => ({
      id: `followup-${followup.id}`,
      kind: "appointment",
      title: followup.title,
      dueDate: followup.dueDate,
      detail: followup.reason || "Appointment from the care plan.",
      priority: relativePriority(followup.dueDate),
      episodeTitle: followup.episodeTitle || null,
    }))
    .sort((a, b) => {
      const order = { today: 0, soon: 1, watch: 2 } as Record<string, number>;
      return order[a.priority] - order[b.priority];
    })
    .slice(0, 8);
  const recentMeals = foodEntries.filter((entry: any) => Date.now() - new Date(entry.eatenAt).valueOf() <= 14 * 86400000);
  const patternCount = (key: string, value: string) => recentMeals.filter((entry: any) => String(entry.assessment?.[key] || "").toLowerCase() === value).length;
  const foodTrends = [
    patternCount("carbBalance", "heavy") >= 3 ? `High-carbohydrate meals appeared ${patternCount("carbBalance", "heavy")} times in the last 14 days.` : null,
    patternCount("protein", "low") >= 3 ? `Low-protein meals appeared ${patternCount("protein", "low")} times in the last 14 days.` : null,
    recentMeals.filter((entry: any) => entry.assessment?.processedOrSugary).length >= 3 ? "Processed or sugary meal signals appeared repeatedly in the last 14 days." : null,
  ].filter(Boolean);
  const riskFlags: Array<{ id: string; title: string; observation: string; episodeTitles: string[]; severity: string }> = [];
  const worsening = (name: RegExp) => biomarkers.find((marker: any) => name.test(marker.name) && marker.points.length > 1 && Number(marker.points.at(-1).value) > Number(marker.points.at(-2).value));
  const renalMarker = worsening(/creatinine/i) || biomarkers.find((marker: any) => /egfr/i.test(marker.name) && marker.points.length > 1 && Number(marker.points.at(-1).value) < Number(marker.points.at(-2).value));
  const renalMeds = interventions.filter((item: any) => item.status === "active" && /creatine|nsaid|ibuprofen|lithium|diuretic|supplement/i.test(`${item.name} ${item.type}`));
  if (renalMarker && renalMeds.length) riskFlags.push({ id: "renal-active-routines", severity: "watch", title: "Renal trend alongside active routines", observation: `${renalMarker.name} changed in a concerning direction while ${renalMeds.map((item: any) => item.name).join(", ")} is active. This is an observation to review, not a clinical conclusion.`, episodeTitles: [...new Set(renalMeds.map((item: any) => item.episodeTitle).filter(Boolean))] as string[] });
  const glucoseMarker = worsening(/hba1c|glucose/i);
  if (glucoseMarker && patternCount("carbBalance", "heavy") >= 3) riskFlags.push({ id: "glucose-meal-pattern", severity: "watch", title: "Glucose trend and repeated carb-heavy meals", observation: `${glucoseMarker.name} worsened while several recent meals were assessed as carbohydrate-heavy. The timing may be useful to discuss; it does not establish cause.`, episodeTitles: [glucoseMarker.episodeTitle].filter(Boolean) as string[] });
  for (const episode of episodes) {
    const flagged = episode.checkins.filter((item: any) => item.flagged).at(-1);
    const recentChange = episode.medicines?.find((item: any) => Date.now() - new Date(item.startDate).valueOf() <= 30 * 86400000);
    if (flagged && recentChange && /mental|psychi|mood|sleep/i.test(`${episode.title} ${episode.type}`)) riskFlags.push({ id: `mood-med-${episode.id}`, severity: "attention", title: "Check-in change after a medicine change", observation: `${episode.title} has a worsening check-in after ${recentChange.name} was started or adjusted. Review the sequence with the clinician; this is not a causal finding.`, episodeTitles: [episode.title] });
  }
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const digest = {
    period: "Last 7 days",
    newDocuments: docs.filter((document: any) => new Date(document.createdAt).valueOf() >= sevenDaysAgo),
    abnormalLabs: biomarkers.filter((marker: any) => !["good", "normal"].includes(marker.status)),
    missedMedicines: missedDoses,
    upcomingAppointments: reminders,
    foodPatterns: foodTrends,
    worseningCheckins: episodes.flatMap((episode: any) => episode.checkins.filter((checkin: any) => checkin.flagged).slice(-1).map((checkin: any) => ({ episodeId: episode.id, episodeTitle: episode.title, ...checkin }))),
  };
  return {
    profiles: allProfiles(),
    currentProfileId: profileId,
    currentProfile: profile,
    documents: docs,
    biomarkers,
    biomarkerInsights,
    events,
    followups,
    interventions,
    episodes,
    insights,
    actions,
    foodEntries,
    foodTrends,
    riskFlags,
    missedDoses,
    digest,
    reminders,
    nextReminder: reminders[0] || null,
    counts: {
      documents: docs.length,
      biomarkers: groups.size,
      interventions: interventions.length,
      followups: followups.length,
    },
  };
}

function prettyIso(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildHealthContext(profileId: number) {
  const data = dashboardData(profileId);
  return JSON.stringify(
    {
      biomarkers: data.biomarkers,
      biomarkerInsights: data.biomarkerInsights,
      events: data.events.slice(0, 40),
      followups: data.followups,
      interventions: data.interventions,
      episodes: data.episodes,
      documents: data.documents.slice(0, 20),
      actions: data.actions,
      meals: data.foodEntries.slice(0, 20),
      foodTrends: data.foodTrends,
      missedDoses: data.missedDoses,
      riskFlags: data.riskFlags,
    },
    null,
    2,
  ).slice(0, 70000);
}

app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    profileId: resolveProfileId(req.query.profileId),
    profiles: allProfiles(),
    parser: "LiteParse",
    llmConfigured: Boolean(process.env.NEYSA_API_KEY),
    model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
    database: true,
  }),
);
app.get("/api/profiles", (_req, res) => res.json({ profiles: allProfiles() }));
app.post("/api/profiles", (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      profileType: z.enum(["independent", "caregiver-linked"]).default("independent"),
      caregiverName: z.string().trim().max(80).optional().default(""),
      relationshipLabel: z.string().trim().max(40).optional().default(""),
      preferredExperience: z.enum(["caregiver", "elder"]).default("caregiver"),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Add a useful profile name." });
  const result = db
    .prepare(
      "INSERT INTO profiles(name,is_default,profile_type,caregiver_name,relationship_label,preferred_experience) VALUES(?,0,?,?,?,?)",
    )
    .run(
      parsed.data.name,
      parsed.data.profileType,
      parsed.data.caregiverName || null,
      parsed.data.relationshipLabel || null,
      parsed.data.preferredExperience,
    );
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    profiles: allProfiles(),
  });
});
app.get("/api/dashboard", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  res.json(dashboardData(profileId));
});

app.get("/api/documents/:id/file", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const row = db.prepare("SELECT filename,mime_type as mimeType,file_blob as file FROM documents WHERE id=? AND profile_id=?").get(Number(req.params.id), profileId) as any;
  if (!row?.file) return res.status(404).json({ error: "Original file is not available for this record." });
  const safe = String(row.filename).replace(/[\r\n"]/g, "_");
  res.setHeader("Content-Type", row.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${safe}"`);
  res.send(row.file);
});

app.get("/api/episodes/:id/documents.zip", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const episode = db.prepare("SELECT title FROM episodes WHERE id=? AND profile_id=?").get(Number(req.params.id), profileId) as any;
  if (!episode) return res.status(404).json({ error: "Event not found." });
  const files = db.prepare(
    "SELECT d.filename,d.file_blob as file FROM documents d JOIN document_episodes de ON de.document_id=d.id WHERE de.episode_id=? AND d.file_blob IS NOT NULL",
  ).all(Number(req.params.id)) as any[];
  if (!files.length) return res.status(404).json({ error: "No stored files are linked to this event." });
  const safeTitle = String(episode.title).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "health-event";
  res.attachment(`${safeTitle}-documents.zip`);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (error: Error) => res.destroy(error));
  archive.pipe(res);
  files.forEach((file, index) => archive.append(Buffer.from(file.file), {
    name: `${index + 1}-${String(file.filename).replace(/[\\/]/g, "_")}`,
  }));
  void archive.finalize();
});

const episodeSchema = z.object({
  title: z.string().trim().min(2).max(120),
  type: z.enum(["injury", "condition", "monitoring", "medication", "preventive", "other"]),
  startDate: z.string(),
  status: z.enum(["active", "monitoring", "closed"]).default("active"),
  summary: z.string().trim().min(3).max(2000),
});
app.post("/api/episodes", async (req, res) => {
  const p = episodeSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Add a title, date, and useful event summary." });
  const d = p.data;
  const profileId = resolveProfileId(req.query.profileId);
  const markers = await suggestEpisodeMarkers(aiClient(), {
    title: d.title,
    type: d.type,
    summary: d.summary,
  });
  const result = db.prepare(
    "INSERT INTO episodes(profile_id,title,episode_type,start_date,status,summary,marker_schema_json) VALUES(?,?,?,?,?,?,?)",
  ).run(
    profileId,
    d.title,
    d.type,
    d.startDate,
    d.status,
    d.summary,
    JSON.stringify(markers),
  );
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO events(profile_id,event_type,event_date,title,meta,detail,tags_json) VALUES(?,?,?,?,?,?,?)")
    .run(profileId, d.type === "injury" ? "diagnosis" : "symptom", d.startDate, d.title, `${d.type} · ${d.status}`, d.summary, JSON.stringify(["Manual event"]));
  res.status(201).json({ id, ...d, markerSchema: markers });
});

app.patch("/api/episodes/:id", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const status = z.enum(["active", "monitoring", "closed"]).safeParse(req.body.status);
  if (!status.success) return res.status(400).json({ error: "Invalid event state." });
  const endDate = status.data === "closed" ? new Date().toISOString().slice(0, 10) : null;
  const result = db.prepare("UPDATE episodes SET status=?,end_date=? WHERE id=? AND profile_id=?")
    .run(status.data, endDate, Number(req.params.id), profileId);
  if (!result.changes) return res.status(404).json({ error: "Event not found." });
  res.json({ ok: true });
});

const checkinSchema = z.object({
  date: z.string(),
  metrics: z.record(z.string(), z.coerce.number().int().min(1).max(5)).refine(
    (value) => Object.keys(value).length >= 1,
    "At least one check-in marker is required.",
  ),
  notes: z.string().max(1000).optional().default(""),
});
app.post("/api/episodes/:id/checkins", (req, res) => {
  const p = checkinSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Rate each marker from 1 to 5." });
  const episodeId = Number(req.params.id);
  const profileId = resolveProfileId(req.query.profileId);
  const episode = db
    .prepare(
      "SELECT title,episode_type as type,summary,marker_schema_json as markerSchemaJson FROM episodes WHERE id=? AND profile_id=?",
    )
    .get(episodeId, profileId) as any;
  if (!episode) return res.status(404).json({ error: "Event not found." });
  const d = p.data;
  const markers = normalizeMarkerSet(
    safeJson<EpisodeMarker[]>(
      episode.markerSchemaJson,
      fallbackEpisodeMarkers(episode.title, episode.type, episode.summary || ""),
    ),
  );
  const metrics = markers.reduce(
    (acc, marker) => ({
      ...acc,
      [marker.key]: Number(d.metrics[marker.key] ?? 3),
    }),
    {} as Record<string, number>,
  );
  const previous = db.prepare(
    "SELECT pain,stiffness,swelling,function_score as functionScore,metrics_json as metricsJson FROM episode_checkins WHERE episode_id=? ORDER BY log_date DESC LIMIT 2",
  ).all(episodeId) as any[];
  const previousMetrics = previous.map((row) => parseMetrics(row.metricsJson, row, markers));
  const evaluation = evaluateCheckin(markers, metrics, previousMetrics);
  const pain = metrics.pain ?? null;
  const stiffness = metrics.stiffness ?? null;
  const swelling = metrics.swelling ?? null;
  const functionScore = metrics.function_score ?? metrics.functionScore ?? null;
  db.prepare(
    "INSERT INTO episode_checkins(episode_id,log_date,pain,stiffness,swelling,function_score,metrics_json,notes,flagged,flag_reason) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(episode_id,log_date) DO UPDATE SET pain=excluded.pain,stiffness=excluded.stiffness,swelling=excluded.swelling,function_score=excluded.function_score,metrics_json=excluded.metrics_json,notes=excluded.notes,flagged=excluded.flagged,flag_reason=excluded.flag_reason",
  ).run(
    episodeId,
    d.date,
    pain,
    stiffness,
    swelling,
    functionScore,
    JSON.stringify(metrics),
    d.notes || null,
    evaluation.flagged ? 1 : 0,
    evaluation.flagReason,
  );
  res.json({ ok: true, flagged: evaluation.flagged, flagReason: evaluation.flagReason });
});

app.post("/api/testing/reset", (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    req.header("x-healthos-test") !== "synthetic-corpus"
  )
    return res.status(404).end();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "DELETE FROM medication_dose_logs; DELETE FROM adherence_logs; DELETE FROM food_entries; DELETE FROM document_actions; DELETE FROM interventions; DELETE FROM documents; DELETE FROM episodes; DELETE FROM events; DELETE FROM followups; DELETE FROM biomarkers;",
    );
    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

app.post(
  "/api/documents/ingest",
  upload.array("documents", 8),
  async (req, res) => {
    const files = (req.files || []) as Express.Multer.File[];
    if (!files.length)
      return res
        .status(400)
        .json({ error: "No supported documents supplied." });
    const ai = aiClient();
    const profileId = resolveProfileId(req.query.profileId);
    const requestedEpisodeId = Number(req.body?.episodeId);
    const manualEpisode = Number.isFinite(requestedEpisodeId) && requestedEpisodeId > 0
      ? db.prepare("SELECT id,title FROM episodes WHERE id=? AND profile_id=?").get(requestedEpisodeId, profileId) as any
      : null;
    if (!ai)
      return res.status(503).json({
        error:
          "Neysa is not configured. Add NEYSA_API_KEY to the server environment.",
      });
    const results = [];
    const mergePages =
      req.body?.mergePages === "1" &&
      files.length > 1 &&
      files.every((file) => file.mimetype.startsWith("image/"));
    if (mergePages) {
      try {
        const firstName = files[0]?.originalname.replace(/\.[^.]+$/, "") || "captured-document";
        const mergedFilename = `${firstName}-bundle.pdf`;
        const mergedPdf = await imageFilesToPdf(files);
        const text = await liteParse({
          ...files[0],
          originalname: mergedFilename,
          mimetype: "application/pdf",
          buffer: mergedPdf,
          size: mergedPdf.byteLength,
        } as Express.Multer.File);
        const response = await ai.chat.completions.create({
          model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
          temperature: 0,
          messages: [
            { role: "system", content: extractionPrompt },
            {
              role: "user",
              content: `Filename: ${mergedFilename}\n\n${text.slice(0, 70000)}`,
            },
          ],
        });
        const extraction = parseModelJson(
          response.choices[0]?.message?.content || "{}",
        );
        const episode: EpisodeDecision = manualEpisode
          ? { action: "existing", episodeId: manualEpisode.id, title: manualEpisode.title, type: null, confidence: 1, rationale: "Care track selected before upload." }
          : await classifyEpisode(extraction, ai, profileId);
        const markerSchema =
          episode.action === "new" && episode.title
            ? await suggestEpisodeMarkers(ai, {
                title: episode.title,
                type: episode.type || "other",
                summary: extraction.summary,
              })
            : undefined;
        const id = persistExtraction(
          profileId,
          mergedFilename,
          "application/pdf",
          mergedPdf,
          text,
          extraction,
          episode,
          markerSchema,
        );
        results.push({
          id,
          filename: mergedFilename,
          status: "organized",
          mergedPages: files.length,
          extracted: {
            documentType: extraction.documentType,
            date: extraction.date,
            biomarkers: extraction.biomarkers.length,
            followUps: extraction.followUps.length,
            episode,
          },
        });
      } catch (error) {
        results.push({
          filename: files.map((file) => file.originalname).join(", "),
          status: "error",
          error: error instanceof Error ? error.message : "Processing failed",
        });
      }
    } else for (const file of files) {
      try {
        const text = await liteParse(file);
        const response = await ai.chat.completions.create({
          model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
          temperature: 0,
          messages: [
            { role: "system", content: extractionPrompt },
            {
              role: "user",
              content: `Filename: ${file.originalname}\n\n${text.slice(0, 70000)}`,
            },
          ],
        });
        const extraction = parseModelJson(
          response.choices[0]?.message?.content || "{}",
        );
        const episode: EpisodeDecision = manualEpisode
          ? { action: "existing", episodeId: manualEpisode.id, title: manualEpisode.title, type: null, confidence: 1, rationale: "Care track selected before upload." }
          : await classifyEpisode(extraction, ai, profileId);
        const markerSchema =
          episode.action === "new" && episode.title
            ? await suggestEpisodeMarkers(ai, {
                title: episode.title,
                type: episode.type || "other",
                summary: extraction.summary,
              })
            : undefined;
        const id = persistExtraction(
          profileId,
          file.originalname,
          file.mimetype,
          file.buffer,
          text,
          extraction,
          episode,
          markerSchema,
        );
        results.push({
          id,
          filename: file.originalname,
          status: "organized",
          extracted: {
            documentType: extraction.documentType,
            date: extraction.date,
            biomarkers: extraction.biomarkers.length,
            followUps: extraction.followUps.length,
            episode,
          },
        });
      } catch (error) {
        results.push({
          filename: file.originalname,
          status: "error",
          error: error instanceof Error ? error.message : "Processing failed",
        });
      }
    }
    const success = results.filter((r) => r.status === "organized").length;
    res
      .status(success ? 201 : 422)
      .json({ results, success, failed: results.length - success });
  },
);

app.delete("/api/documents/:id", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  db.prepare("UPDATE documents SET status='archived' WHERE id=? AND profile_id=?").run(Number(req.params.id), profileId);
  res.json({ ok: true, preserved: true });
});
const reassignDocumentSchema = z.object({ episodeId: z.coerce.number().int().positive() });
app.patch("/api/documents/:id/care-track", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const parsed = reassignDocumentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid care track." });
  const documentId = Number(req.params.id);
  const document = db.prepare("SELECT id FROM documents WHERE id=? AND profile_id=?").get(documentId, profileId);
  const episode = db.prepare("SELECT id FROM episodes WHERE id=? AND profile_id=?").get(parsed.data.episodeId, profileId);
  if (!document || !episode) return res.status(404).json({ error: "Document or care track not found." });
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM document_episodes WHERE document_id=?").run(documentId);
    db.prepare("INSERT INTO document_episodes(document_id,episode_id,confidence,rationale) VALUES(?,?,1,?)").run(documentId, parsed.data.episodeId, "Care track reassigned by caregiver.");
    db.prepare("UPDATE document_actions SET episode_id=? WHERE document_id=?").run(parsed.data.episodeId, documentId);
    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (error) { db.exec("ROLLBACK"); throw error; }
});

app.patch("/api/actions/:id", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const status = z.enum(["open", "completed", "dismissed"]).safeParse(req.body.status);
  if (!status.success) return res.status(400).json({ error: "Invalid action status." });
  db.prepare("UPDATE document_actions SET status=? WHERE id IN (SELECT a.id FROM document_actions a JOIN documents d ON d.id=a.document_id WHERE a.id=? AND d.profile_id=?)")
    .run(status.data, Number(req.params.id), profileId);
  res.json({ ok: true });
});

const mealAssessmentSchema = z.object({
  summary: z.string().min(3),
  mealType: z.string().nullable().optional(),
  protein: z.enum(["low", "present", "adequate", "unclear"]),
  carbBalance: z.enum(["light", "balanced", "heavy", "unclear"]),
  fatBalance: z.enum(["light", "balanced", "heavy", "unclear"]),
  fiber: z.enum(["low", "present", "good", "unclear"]),
  processedOrSugary: z.boolean(),
  hydrationCue: z.string().nullable().optional(),
  observations: z.array(z.string()).default([]),
});
app.post("/api/food", upload.single("photo"), async (req, res) => {
  const file = req.file;
  if (!file || !file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Add a meal photo." });
  const profileId = resolveProfileId(req.query.profileId);
  const episodeId = Number(req.body?.episodeId) || null;
  if (episodeId && !db.prepare("SELECT id FROM episodes WHERE id=? AND profile_id=?").get(episodeId, profileId)) return res.status(400).json({ error: "Care track not found." });
  const ai = aiClient();
  if (!ai) return res.status(503).json({ error: "Meal assessment model is not configured." });
  try {
    const response = await ai.chat.completions.create({
      model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it", temperature: 0.1,
      messages: [{ role: "system", content: "Assess the visible meal without calorie counting. Be cautious about ingredients that cannot be seen. Return only JSON: {\"summary\":\"brief meal description and quality\",\"mealType\":\"breakfast|lunch|dinner|snack|unknown\",\"protein\":\"low|present|adequate|unclear\",\"carbBalance\":\"light|balanced|heavy|unclear\",\"fatBalance\":\"light|balanced|heavy|unclear\",\"fiber\":\"low|present|good|unclear\",\"processedOrSugary\":false,\"hydrationCue\":\"visible beverage cue or null\",\"observations\":[\"useful non-diagnostic observation\"]}" }, { role: "user", content: [{ type: "text", text: "Assess this meal photo." }, { type: "image_url", image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` } }] as any }],
    });
    const raw = response.choices[0]?.message?.content || "{}";
    const assessment = mealAssessmentSchema.parse(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw));
    const eatenAt = z.string().datetime().catch(new Date().toISOString()).parse(req.body?.eatenAt);
    const inserted = db.prepare("INSERT INTO food_entries(profile_id,episode_id,eaten_at,meal_type,image_blob,mime_type,summary,assessment_json) VALUES(?,?,?,?,?,?,?,?)")
      .run(profileId, episodeId, eatenAt, assessment.mealType || null, file.buffer, file.mimetype, assessment.summary, JSON.stringify(assessment));
    db.prepare("INSERT INTO events(profile_id,event_type,event_date,title,meta,detail,tags_json) VALUES(?,?,?,?,?,?,?)")
      .run(profileId, "food", eatenAt.slice(0, 10), assessment.mealType ? `${assessment.mealType} meal` : "Meal photo", "Photo assessment", assessment.summary, JSON.stringify([`Protein: ${assessment.protein}`, `Carbs: ${assessment.carbBalance}`, `Fiber: ${assessment.fiber}`]));
    res.status(201).json({ id: Number(inserted.lastInsertRowid), assessment });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Could not assess the meal." }); }
});
app.get("/api/food/:id/image", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const row = db.prepare("SELECT image_blob as image,mime_type as mimeType FROM food_entries WHERE id=? AND profile_id=?").get(Number(req.params.id), profileId) as any;
  if (!row) return res.status(404).end();
  res.type(row.mimeType).send(Buffer.from(row.image));
});
const interventionSchema = z.object({
  name: z.string().min(2).max(100),
  type: z.string().min(2).max(50),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  status: z.enum(["active", "stopped", "completed"]).default("active"),
  dose: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  schedulePerWeek: z.coerce.number().int().min(1).max(21).default(7),
  scheduleSlots: z.array(scheduleSlotSchema).max(4).optional(),
});
app.post("/api/interventions", (req, res) => {
  const p = interventionSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Invalid intervention." });
  const d = p.data;
  const profileId = resolveProfileId(req.query.profileId);
  const scheduleSlots = (d.scheduleSlots?.length
    ? d.scheduleSlots
    : deriveScheduleSlots(d.frequency, d.type)
  ).slice(0, 4);
  const r = db
    .prepare(
      "INSERT INTO interventions(profile_id,name,intervention_type,start_date,end_date,status,dose,frequency,notes,schedule_per_week,schedule_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      profileId,
      d.name,
      d.type,
      d.startDate,
      d.endDate || null,
      d.status,
      d.dose || null,
      d.frequency || null,
      d.notes || null,
      d.schedulePerWeek,
      JSON.stringify(scheduleSlots),
    );
  db.prepare(
    "INSERT INTO events(profile_id,event_type,event_date,title,meta,detail,tags_json) VALUES(?,?,?,?,?,?,?)",
  ).run(
    profileId,
    "intervention",
    d.startDate,
    d.name,
    [d.dose, d.frequency].filter(Boolean).join(" · "),
    d.notes || d.status,
    "[]",
  );
  res.status(201).json({
    id: Number(r.lastInsertRowid),
    ...d,
    scheduleSlots,
  });
});
const adherenceSchema = z.object({
  date: z.string(),
  taken: z.boolean(),
  dose: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
app.post("/api/interventions/:id/adherence", (req, res) => {
  const p = adherenceSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Invalid adherence log." });
  const profileId = resolveProfileId(req.query.profileId);
  const i = db
    .prepare("SELECT id FROM interventions WHERE id=? AND profile_id=?")
    .get(Number(req.params.id), profileId);
  if (!i) return res.status(404).json({ error: "Intervention not found." });
  const d = p.data;
  db.prepare(
    "INSERT INTO adherence_logs(intervention_id,log_date,taken,dose,notes) VALUES(?,?,?,?,?) ON CONFLICT(intervention_id,log_date) DO UPDATE SET taken=excluded.taken,dose=excluded.dose,notes=excluded.notes",
  ).run(
    Number(req.params.id),
    d.date,
    d.taken ? 1 : 0,
    d.dose || null,
    d.notes || null,
  );
  res.json({ ok: true });
});
const doseLogSchema = z.object({
  date: z.string(), slotKey: z.string().min(1).max(24),
  status: z.enum(["taken", "missed", "skipped"]).default("taken"),
  notes: z.string().max(500).optional(),
});
app.post("/api/interventions/:id/doses", (req, res) => {
  const parsed = doseLogSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid medicine dose log." });
  const profileId = resolveProfileId(req.query.profileId);
  const intervention = db.prepare("SELECT id FROM interventions WHERE id=? AND profile_id=?").get(Number(req.params.id), profileId);
  if (!intervention) return res.status(404).json({ error: "Medicine not found." });
  const value = parsed.data;
  db.prepare("INSERT INTO medication_dose_logs(intervention_id,log_date,slot_key,status,notes) VALUES(?,?,?,?,?) ON CONFLICT(intervention_id,log_date,slot_key) DO UPDATE SET status=excluded.status,logged_at=CURRENT_TIMESTAMP,notes=excluded.notes")
    .run(Number(req.params.id), value.date, value.slotKey, value.status, value.notes || null);
  res.json({ ok: true, notificationState: value.status === "taken" ? "resolved" : "active" });
});
app.get("/api/interventions/:id/adherence", (req, res) =>
  {
    const profileId = resolveProfileId(req.query.profileId);
    const intervention = db.prepare("SELECT id FROM interventions WHERE id=? AND profile_id=?").get(Number(req.params.id), profileId);
    if (!intervention) return res.status(404).json({ error: "Intervention not found." });
    return res.json(
      db
        .prepare(
          "SELECT log_date as date,taken,dose,notes FROM adherence_logs WHERE intervention_id=? ORDER BY log_date DESC LIMIT 90",
        )
        .all(Number(req.params.id)),
    );
  }
);
app.patch("/api/followups/:id", (req, res) => {
  const profileId = resolveProfileId(req.query.profileId);
  const status = z
    .enum(["open", "completed", "dismissed"])
    .safeParse(req.body.status);
  if (!status.success)
    return res.status(400).json({ error: "Invalid status." });
  db.prepare("UPDATE followups SET status=? WHERE id IN (SELECT f.id FROM followups f JOIN documents d ON d.id=f.document_id WHERE f.id=? AND d.profile_id=?)").run(
    status.data,
    Number(req.params.id),
    profileId,
  );
  res.json({ ok: true });
});

const questionSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  episodeId: z.coerce.number().int().positive().nullable().optional(),
});
app.post("/api/assistant", async (req, res) => {
  const p = questionSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Ask a valid health question." });
  const ai = aiClient();
  if (!ai) return res.status(503).json({ error: "Neysa is not configured." });
  const profileId = resolveProfileId(req.query.profileId);
  const fullData = dashboardData(profileId);
  const selectedEpisode = p.data.episodeId ? fullData.episodes.find((episode: any) => Number(episode.id) === p.data.episodeId) : null;
  const context = selectedEpisode
    ? JSON.stringify({ careTrack: selectedEpisode, documents: fullData.documents.filter((item: any) => Number(item.episodeId) === selectedEpisode.id), actions: fullData.actions.filter((item: any) => Number(item.episodeId) === selectedEpisode.id), appointments: fullData.followups.filter((item: any) => item.episodeTitle === selectedEpisode.title), meals: fullData.foodEntries.filter((item: any) => Number(item.episodeId) === selectedEpisode.id), risks: fullData.riskFlags.filter((item: any) => item.episodeTitles.includes(selectedEpisode.title)) }, null, 2)
    : buildHealthContext(profileId);
  if (context.length < 100)
    return res.json({
      answer:
        "There are no health records yet. Upload a report or add an intervention, then I can answer using your history.",
    });
  try {
    const response = await ai.chat.completions.create({
      model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content: `You are Personal Health OS, a personal health history assistant. Use ONLY the supplied database context. Cite dates and values. Separate correlation from causation. Do not diagnose or prescribe. Mention urgent clinical review when appropriate. If the evidence is insufficient, say so.\n\nDATABASE CONTEXT:\n${context}`,
        },
        { role: "user", content: p.data.question },
      ],
    });
    res.json({
      answer: response.choices[0]?.message?.content || "No response generated.",
    });
  } catch (error) {
    res.status(502).json({
      error:
        error instanceof Error ? error.message : "The model is unavailable.",
    });
  }
});

const doctorBriefSchema = z.object({
  episodeId: z.coerce.number().int().positive().nullable().optional(),
  prompt: z.string().trim().max(1500).optional().default(""),
});
app.post("/api/doctor-brief", async (req, res) => {
  const parsed = doctorBriefSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid doctor prep request." });
  const ai = aiClient();
  const profileId = resolveProfileId(req.query.profileId);
  const data = dashboardData(profileId);
  const selected = parsed.data.episodeId
    ? data.episodes.find((item: any) => Number(item.id) === parsed.data.episodeId)
    : null;
  const context = (selected ? JSON.stringify({
    event: selected,
    appointmentPurpose: data.followups.find((item: any) => item.episodeTitle === selected.title && item.kind === "appointment") || selected.summary,
    medications: data.interventions.filter((item: any) => Number(item.episodeId) === selected.id),
    missedDoses: data.missedDoses.filter((item: any) => Number(item.episodeId) === selected.id),
    relatedTimeline: data.events.filter((item: any) => Number(item.episodeId) === selected.id),
    relevantBiomarkers: data.biomarkers.filter((item: any) => Number(item.episodeId) === selected.id),
    actions: data.actions.filter((item: any) => Number(item.episodeId) === selected.id),
    riskFlags: data.riskFlags.filter((item: any) => item.episodeTitles.includes(selected.title)),
    meals: data.foodEntries.filter((item: any) => Number(item.episodeId) === selected.id),
  }, null, 2) : buildHealthContext(profileId)).slice(0, 70000);
  const documents = selected?.linkedDocuments || data.documents.slice(0, 8).map((d: any) => ({
    id: d.id, filename: d.filename, documentType: d.documentType, summary: d.summary, hasFile: d.hasFile,
  }));
  if (!ai) {
    const title = selected ? selected.title : "Health overview";
    const latest = selected?.checkins?.at(-1);
    return res.json({
      brief: `# ${title}\n\n## Reason for visit\n${selected?.summary || "Review longitudinal health history and outstanding follow-ups."}\n\n## Current status\n${selected ? (latest ? `Latest check-in: ${checkinSummary(selected.markerSchema || [], latest.metrics)}.` : "No recent check-in recorded.") : "General longitudinal review."}\n\n## Active medications and supplements\n${data.interventions.filter((i: any) => i.status === "active").map((i: any) => `- ${i.name}${i.dose ? ` — ${i.dose}` : ""}${i.frequency ? `, ${i.frequency}` : ""}`).join("\n") || "- None recorded"}\n\n## Questions to discuss\n- Is the current trend following the expected timeline?\n- Do the symptom or function patterns suggest any need to change the plan?\n${parsed.data.prompt ? `\n## Patient priority\n${parsed.data.prompt}` : ""}`,
      documents,
      episodeId: selected?.id || null,
    });
  }
  try {
    const response = await ai.chat.completions.create({
      model: process.env.NEYSA_MODEL || "gemma-4-26b-a4b-it",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Create a concise clinician appointment brief with: appointment purpose; recent dated symptom/check-in changes; latest abnormal biomarkers; medicines started, stopped, missed, or adjusted; outstanding actions and follow-ups; non-diagnostic risk observations; and 4-6 focused suggested questions. Use only context; do not diagnose. Respect the patient's tailoring request without inventing facts.",
        },
        { role: "user", content: `${context}\n\nPATIENT TAILORING REQUEST:\n${parsed.data.prompt || "None"}` },
      ],
    });
    res.json({ brief: response.choices[0]?.message?.content || "", documents, episodeId: selected?.id || null });
  } catch {
    res.status(502).json({ error: "Could not generate the brief." });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(root, "dist")));
  app.get("/{*splat}", (_req, res) =>
    res.sendFile(join(root, "dist", "index.html")),
  );
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    res
      .status(message.includes("File too large") ? 413 : 500)
      .json({ error: message });
  },
);
app.listen(port, () =>
  console.log(`Personal Health OS API on http://localhost:${port}`),
);
