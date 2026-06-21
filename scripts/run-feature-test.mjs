import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.HEALTHOS_URL || "http://localhost:5180";
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const dashboard = await request("/api/dashboard");
const questions = [
  {
    name: "supplement-change",
    question:
      "What changed after I started Vitamin D, omega-3, zinc, magnesium and creatine? Be careful about causation.",
    mustInclude: ["Vitamin D", "triglycer", "caus"],
  },
  {
    name: "injury-episode",
    question:
      "Summarize my right ankle injury episode and recovery with dates and pain scores.",
    mustInclude: ["ankle", "2025", "7/10", "2/10"],
  },
  {
    name: "followups",
    question: "What follow-ups are still pending and which are most important?",
    mustInclude: ["follow", "CK", "creatin"],
  },
];
const assistant = [];
for (const test of questions) {
  const response = await request("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: test.question }),
  });
  const missing = test.mustInclude.filter(
    (term) => !response.answer.toLowerCase().includes(term.toLowerCase()),
  );
  assistant.push({
    ...test,
    answer: response.answer,
    pass: missing.length === 0,
    missing,
  });
}
const brief = await request("/api/doctor-brief", { method: "POST" });
const report = {
  generatedAt: new Date().toISOString(),
  database: {
    documents: dashboard.documents.length,
    events: dashboard.events.length,
    episodes: dashboard.episodes.length,
    biomarkers: dashboard.biomarkers.length,
    interventions: dashboard.interventions.length,
    followups: dashboard.followups.length,
  },
  dataQuality: {
    noFunctionalMetricsAsBiomarkers: !dashboard.biomarkers.some((x) =>
      /pain|dorsiflex|balance/i.test(x.name),
    ),
    adaptiveEpisodeMarkers: dashboard.episodes.every(
      (episode) => Array.isArray(episode.markerSchema) && episode.markerSchema.length >= 3,
    ),
    nonInjuryEpisodesAreDynamic: dashboard.episodes
      .filter((episode) => episode.type !== "injury")
      .every(
        (episode) =>
          !episode.markerSchema.some((marker) =>
            ["pain", "stiffness", "swelling"].includes(marker.key),
          ),
      ),
    observationsCaptured: dashboard.events.filter((x) => x.type === "symptom")
      .length,
    allDocumentsAssigned: dashboard.documents.every((x) => x.episodeId),
    medicationSchedulesAvailable: dashboard.interventions.every(
      (intervention) =>
        Array.isArray(intervention.scheduleSlots) &&
        intervention.scheduleSlots.length >= 1,
    ),
    adherenceAvailable: dashboard.interventions.every(
      (x) => x.adherence7d !== null,
    ),
    relationshipInsights: dashboard.insights.filter(
      (x) => x.eyebrow === "POSSIBLE RELATIONSHIP",
    ).length,
    documentActionsAvailable: Array.isArray(dashboard.actions),
    appointmentsTrackScoped: dashboard.followups.every(
      (item) => item.kind !== "appointment" || Boolean(item.episodeTitle),
    ),
    missedDoseAbstraction: Array.isArray(dashboard.missedDoses) && dashboard.missedDoses.every(
      (item) => item.interventionId && item.slotKey && item.notification?.type === "medication_missed",
    ),
    caregiverDigestComplete: ["newDocuments", "abnormalLabs", "missedMedicines", "upcomingAppointments", "foodPatterns", "worseningCheckins"].every(
      (key) => Array.isArray(dashboard.digest?.[key]),
    ),
    nutritionTimelineAvailable: Array.isArray(dashboard.foodEntries) && Array.isArray(dashboard.foodTrends),
    observationalRiskFlags: Array.isArray(dashboard.riskFlags) && dashboard.riskFlags.every(
      (flag) => /observation|does not|not a clinical|not establish|not causal/i.test(flag.observation),
    ),
  },
  assistant,
  doctorBrief: {
    pass:
      brief.brief.length > 300 && /LDL|Vitamin D|creatin/i.test(brief.brief),
    length: brief.brief.length,
    brief: brief.brief,
  },
};
await writeFile(
  join(
    process.cwd(),
    "test-data",
    "synthetic-patient",
    "feature-test-report.json",
  ),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (
  !report.dataQuality.noFunctionalMetricsAsBiomarkers ||
  !report.dataQuality.adaptiveEpisodeMarkers ||
  !report.dataQuality.nonInjuryEpisodesAreDynamic ||
  !report.dataQuality.allDocumentsAssigned ||
  !report.dataQuality.medicationSchedulesAvailable ||
  !report.dataQuality.documentActionsAvailable ||
  !report.dataQuality.appointmentsTrackScoped ||
  !report.dataQuality.missedDoseAbstraction ||
  !report.dataQuality.caregiverDigestComplete ||
  !report.dataQuality.nutritionTimelineAvailable ||
  !report.dataQuality.observationalRiskFlags ||
  assistant.some((x) => !x.pass) ||
  !report.doctorBrief.pass
)
  process.exitCode = 1;
