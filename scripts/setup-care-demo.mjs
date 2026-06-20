import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { generateSyntheticElderCorpus } from "./generate-synthetic-elder-corpus.mjs";

const base = process.env.HEALTHOS_URL || "http://localhost:5180";
const elderCorpus = join(process.cwd(), "test-data", "synthetic-elder");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dbPath =
  process.env.HEALTHOS_DB_PATH || join(root, "data", "healthos.sqlite");
const db = new DatabaseSync(dbPath);

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    // ignore non-json
  }
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function resetProfileData(profileId) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "DELETE FROM adherence_logs WHERE intervention_id IN (SELECT id FROM interventions WHERE profile_id=?)",
    ).run(profileId);
    db.prepare(
      "DELETE FROM episode_checkins WHERE episode_id IN (SELECT id FROM episodes WHERE profile_id=?)",
    ).run(profileId);
    db.prepare(
      "DELETE FROM document_episodes WHERE episode_id IN (SELECT id FROM episodes WHERE profile_id=?) OR document_id IN (SELECT id FROM documents WHERE profile_id=?)",
    ).run(profileId, profileId);
    db.prepare(
      "DELETE FROM followups WHERE document_id IN (SELECT id FROM documents WHERE profile_id=?)",
    ).run(profileId);
    db.prepare(
      "DELETE FROM biomarkers WHERE document_id IN (SELECT id FROM documents WHERE profile_id=?)",
    ).run(profileId);
    db.prepare("DELETE FROM events WHERE profile_id=?").run(profileId);
    db.prepare("DELETE FROM interventions WHERE profile_id=?").run(profileId);
    db.prepare("DELETE FROM documents WHERE profile_id=?").run(profileId);
    db.prepare("DELETE FROM episodes WHERE profile_id=?").run(profileId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const profiles = await request("/api/profiles");
const existing = profiles.profiles?.find((profile) => profile.name === "Ramesh Mehta");
const profileId = existing?.id
  ? existing.id
  : (
      await request("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ramesh Mehta",
          profileType: "caregiver-linked",
          caregiverName: "Anita Mehta",
          relationshipLabel: "Daughter",
          preferredExperience: "elder",
        }),
      })
    ).id;
const profileQuery = `?profileId=${profileId}`;
await generateSyntheticElderCorpus(elderCorpus);
resetProfileData(profileId);

const elderCapture = new FormData();
for (const filename of [
  "01-home-lab-capture-page-1.jpg",
  "01-home-lab-capture-page-2.jpg",
]) {
  elderCapture.append(
    "documents",
    new Blob([await readFile(join(elderCorpus, filename))], {
      type: "image/jpeg",
    }),
    filename,
  );
}
elderCapture.append("mergePages", "1");
const elderUpload = await request(`/api/documents/ingest${profileQuery}`, {
  method: "POST",
  body: elderCapture,
});
process.stdout.write(
  `elder multi-page upload: ${elderUpload.results?.[0]?.status || "done"}\n`,
);

for (const filename of [
  "02-diabetes-renal-panel-q3-2025.pdf",
  "03-diabetes-renal-panel-q4-2025.pdf",
  "04-annual-wellness-panel-2026.pdf",
  "05-mood-sleep-monitoring-panel.pdf",
  "06-renal-lipid-followup.pdf",
  "07-endocrinology-followup.pdf",
  "08-primary-care-prescription.pdf",
  "09-retina-referral.pdf",
  "10-psychiatry-sleep-consult.pdf",
  "11-podiatry-foot-care.pdf",
  "12-general-wellness-review.pdf",
]) {
  const form = new FormData();
  form.append(
    "documents",
    new Blob([await readFile(join(elderCorpus, filename))], {
      type: "application/pdf",
    }),
    filename,
  );
  const result = await request(`/api/documents/ingest${profileQuery}`, {
    method: "POST",
    body: form,
  });
  process.stdout.write(`${filename}: ${result.results?.[0]?.status || "done"}\n`);
}

const manualRoutine = await request(`/api/interventions${profileQuery}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "After-dinner walk",
    type: "Routine",
    startDate: "2026-02-20",
    dose: "20 minutes",
    frequency: "Every evening",
    schedulePerWeek: 5,
    notes: "Caregiver-added daily movement routine",
  }),
});

const dashboard = await request(`/api/dashboard${profileQuery}`);
const today = new Date().toISOString().slice(0, 10);
const morningMedication = dashboard.interventions.find(
  (item) =>
    item.status === "active" &&
    item.scheduleSlots?.some((slot) => slot.period === "morning"),
);
if (morningMedication)
  await request(`/api/interventions/${morningMedication.id}/adherence${profileQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: today,
      taken: true,
      dose: morningMedication.dose,
      notes: "Simulated caregiver confirmation from shared dashboard",
    }),
  });

console.log(
  JSON.stringify(
    {
      profileId,
      elderCorpus,
      manualRoutineId: manualRoutine.id,
      caregiverUrl: `${base}/caregiver?profileId=${profileId}`,
      elderUrl: `${base}/elder?profileId=${profileId}`,
    },
    null,
    2,
  ),
);
