import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.HEALTHOS_URL || "http://localhost:5180";
const corpus = join(process.cwd(), "test-data", "synthetic-patient");
const truth = JSON.parse(
  await readFile(join(corpus, "ground-truth.json"), "utf8"),
);
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  let body = {};
  try {
    body = await response.json();
  } catch {}
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

await request("/api/testing/reset", {
  method: "POST",
  headers: { "x-healthos-test": "synthetic-corpus" },
});
const specs = [
  ["Vitamin D3", "Supplement", "2025-01-20", "2,000 IU", "Daily", 7],
  [
    "Omega-3 fish oil",
    "Supplement",
    "2025-01-20",
    "EPA+DHA 1,000 mg",
    "Daily",
    7,
  ],
  ["Magnesium glycinate", "Supplement", "2025-02-01", "200 mg", "Nightly", 7],
  [
    "Zinc picolinate",
    "Supplement",
    "2025-02-01",
    "15 mg",
    "Daily with food",
    7,
  ],
  ["Creatine monohydrate", "Supplement", "2025-04-01", "5 g", "Daily", 7],
  [
    "Strength training",
    "Exercise",
    "2025-04-01",
    "45–60 minutes",
    "3 sessions weekly",
    3,
  ],
];
const created = [];
for (const [name, type, startDate, dose, frequency, schedulePerWeek] of specs)
  created.push(
    await request("/api/interventions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type,
        startDate,
        dose,
        frequency,
        schedulePerWeek,
        notes: "Synthetic longitudinal test intervention",
      }),
    }),
  );
const targets = [7, 6, 5, 4, 6, 3],
  end = new Date("2025-12-05T12:00:00");
for (let index = 0; index < created.length; index++)
  for (let offset = 0; offset < 28; offset++) {
    const d = new Date(end);
    d.setDate(d.getDate() - offset);
    const planned = index === 5 ? [1, 3, 5].includes(d.getDay()) : true;
    const taken =
      planned &&
      (index === 5 || offset % 7 < targets[index]) &&
      !((Math.floor(offset / 7) + index) % 5 === 0 && offset % 7 === 0);
    if (planned)
      await request(`/api/interventions/${created[index].id}/adherence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: d.toISOString().slice(0, 10),
          taken,
          dose: created[index].dose,
        }),
      });
  }

const files = [
    ...truth.panels.map((x) => x.file),
    ...truth.documents.map((x) => x.file),
  ].sort(),
  ingestion = [];
for (const filename of files) {
  const form = new FormData();
  form.append(
    "documents",
    new Blob([await readFile(join(corpus, filename))], {
      type: "application/pdf",
    }),
    filename,
  );
  const started = Date.now();
  const result = await request("/api/documents/ingest", {
    method: "POST",
    body: form,
  });
  ingestion.push({
    filename,
    durationMs: Date.now() - started,
    ...result.results[0],
  });
  process.stdout.write(
    `${filename}: ${result.results[0].status} (${Date.now() - started}ms)\n`,
  );
}
const dashboard = await request("/api/dashboard");
const simple = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const alias = (name) => {
  const n = simple(name);
  if (n.includes("vitamin") && n.includes("d")) return "vitamind";
  if (
    n.includes("hba1c") ||
    n.includes("hemoglobina1c") ||
    n.includes("glycatedhemoglobin")
  )
    return "hba1c";
  if (n.includes("fastingglucose") || n.includes("glucosefasting"))
    return "fastingglucose";
  if (n.includes("totalcholesterol")) return "totalcholesterol";
  if (n.includes("ldl")) return "ldl";
  if (n.includes("hdl")) return "hdl";
  if (n.includes("triglycer")) return "triglycerides";
  if (n.includes("creatinine") && !n.includes("kinase")) return "creatinine";
  if (
    n.includes("egfr") ||
    n.includes("estimatedgfr") ||
    n.includes("glomerularfiltrationrate")
  )
    return "egfr";
  if (
    n.includes("hscrp") ||
    n.includes("highsensitivitycrp") ||
    (n.includes("creactiveprotein") && n.includes("sensitivity"))
  )
    return "hscrp";
  if (n.includes("creatinekinase")) return "ck";
  if (n.includes("alanine") || n === "alt" || n.includes("sgpt")) return "alt";
  if (n.includes("aspartate") || n === "ast") return "ast";
  if (n.includes("thyrotropin") || n === "tsh") return "tsh";
  if (n.includes("vitaminb12") || n === "b12") return "b12";
  if (n.includes("zinc")) return "zinc";
  if (n.includes("magnesium")) return "magnesium";
  if (n.includes("whitebloodcell") || n.includes("wbc")) return "wbc";
  if (n.includes("platelet")) return "platelet";
  return n;
};
let expected = 0,
  matched = 0;
const misses = [];
for (const panel of truth.panels)
  for (const item of panel.biomarkers) {
    expected++;
    const marker = dashboard.biomarkers.find(
      (m) => alias(m.name) === alias(item.name),
    );
    const point = marker?.points.find(
      (p) =>
        p.date === panel.date &&
        Math.abs(Number(p.value) - Number(item.value)) < 0.001,
    );
    if (point) matched++;
    else
      misses.push({
        file: panel.file,
        date: panel.date,
        name: item.name,
        value: item.value,
      });
  }
const byFile = Object.fromEntries(
  dashboard.documents.map((d) => [d.filename, d]),
);
const typeChecks = [...truth.panels, ...truth.documents].map((t) => {
  const actual = byFile[t.file]?.documentType || "";
  const category = (value) => {
    const normalized = simple(value);
    if (normalized.includes("blood") || normalized.includes("lab"))
      return "lab";
    if (normalized.includes("doctor") || normalized.includes("consultation"))
      return "clinical-note";
    if (normalized.includes("prescription")) return "prescription";
    return normalized;
  };
  return {
    file: t.file,
    expected: t.type,
    actual,
    pass: category(actual) === category(t.type),
  };
});
const labIds = new Set(
  truth.panels.map((x) => byFile[x.file]?.episodeId).filter(Boolean),
);
const injuryFiles = truth.documents
  .filter((x) => x.episode === "Right ankle sprain")
  .map((x) => x.file);
const injuryIds = new Set(
  injuryFiles.map((f) => byFile[f]?.episodeId).filter(Boolean),
);
const report = {
  generatedAt: new Date().toISOString(),
  corpus: { pdfs: files.length, interventions: created.length },
  ingestion: {
    successful: ingestion.filter((x) => x.status === "organized").length,
    total: files.length,
    averageMs: Math.round(
      ingestion.reduce((a, b) => a + b.durationMs, 0) / ingestion.length,
    ),
    details: ingestion,
  },
  extraction: {
    measurementRecall: matched / expected,
    matchedMeasurements: matched,
    expectedMeasurements: expected,
    misses,
    typeAccuracy: typeChecks.filter((x) => x.pass).length / typeChecks.length,
    typeChecks,
  },
  episodes: {
    labDocumentsShareEpisode: labIds.size === 1,
    labEpisodeIds: [...labIds],
    injuryDocumentsShareEpisode: injuryIds.size === 1,
    injuryEpisodeIds: [...injuryIds],
    clusters: dashboard.episodes,
  },
  product: {
    documents: dashboard.counts.documents,
    biomarkers: dashboard.counts.biomarkers,
    events: dashboard.events.length,
    followups: dashboard.counts.followups,
    interventions: dashboard.counts.interventions,
    insights: dashboard.insights.length,
    adherence: dashboard.interventions.map((x) => ({
      name: x.name,
      adherence7d: x.adherence7d,
    })),
  },
};
await writeFile(
  join(corpus, "evaluation-report.json"),
  JSON.stringify(report, null, 2),
);
await writeFile(
  join(corpus, "evaluation-report.md"),
  `# Synthetic corpus evaluation\n\n- PDFs ingested: **${report.ingestion.successful}/${report.ingestion.total}**\n- Biomarker measurement recall: **${(report.extraction.measurementRecall * 100).toFixed(1)}%** (${matched}/${expected})\n- Document type accuracy: **${(report.extraction.typeAccuracy * 100).toFixed(1)}%**\n- Lab episode clustered: **${report.episodes.labDocumentsShareEpisode}**\n- Injury episode clustered: **${report.episodes.injuryDocumentsShareEpisode}**\n- Mean ingestion latency: **${report.ingestion.averageMs} ms/document**\n- Open follow-ups extracted: **${report.product.followups}**\n\n## Missed measurements\n${misses.length ? misses.map((x) => `- ${x.file}: ${x.name} ${x.value}`).join("\n") : "None"}\n`,
);
console.log(JSON.stringify(report, null, 2));
