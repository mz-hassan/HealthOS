import PDFDocument from "pdfkit";
import sharp from "sharp";

const base = process.env.HEALTHOS_URL || "http://localhost:5180";
const profileId = Number(process.env.HEALTHOS_PROFILE_ID || 1);
const profileQuery = `?profileId=${profileId}`;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  let body = {};
  try { body = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function pdfBuffer({ title, type, date, provider, sections }) {
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: `SYNTHETIC SHOWCASE - ${title}` } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#a33d32").text("SYNTHETIC TEST DATA — NOT A REAL MEDICAL RECORD", { align: "center" });
    doc.moveDown().fontSize(19).fillColor("#173f35").text(provider);
    doc.font("Helvetica").fontSize(10).fillColor("#3f4c46").text(`${type} · ${title}`);
    doc.moveDown(.5).fontSize(9).text(`Patient profile: Health OS showcase · Document date: ${date}`);
    doc.moveDown();
    for (const [heading, text] of sections) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#203229").text(heading);
      doc.moveDown(.25).font("Helvetica").fontSize(9.5).fillColor("#44514b").text(text, { lineGap: 2 });
      doc.moveDown(.8);
    }
    doc.end();
  });
}

async function ingest(filename, document, episodeId) {
  const form = new FormData();
  form.append("documents", new Blob([document], { type: "application/pdf" }), filename);
  form.append("episodeId", String(episodeId));
  const result = await request(`/api/documents/ingest${profileQuery}`, { method: "POST", body: form });
  return result.results?.[0];
}

async function mealImage(title, subtitle, palette) {
  const svg = `<svg width="1000" height="760" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="760" fill="${palette[0]}"/>
    <ellipse cx="500" cy="410" rx="360" ry="255" fill="#f8f4ea" stroke="${palette[1]}" stroke-width="18"/>
    <circle cx="380" cy="390" r="125" fill="${palette[2]}"/><circle cx="590" cy="370" r="105" fill="${palette[3]}"/>
    <rect x="430" y="480" width="235" height="92" rx="28" fill="${palette[4]}"/>
    <text x="500" y="92" text-anchor="middle" font-family="Arial" font-size="42" font-weight="700" fill="#203229">SYNTHETIC MEAL PHOTO</text>
    <text x="500" y="650" text-anchor="middle" font-family="Arial" font-size="37" font-weight="700" fill="#203229">${title}</text>
    <text x="500" y="704" text-anchor="middle" font-family="Arial" font-size="26" fill="#4d5a54">${subtitle}</text>
  </svg>`;
  return await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function addMeal(filename, image, episodeId, eatenAt) {
  const form = new FormData();
  form.append("photo", new Blob([image], { type: "image/jpeg" }), filename);
  form.append("episodeId", String(episodeId));
  form.append("eatenAt", eatenAt);
  return await request(`/api/food${profileQuery}`, { method: "POST", body: form });
}

let dashboard = await request(`/api/dashboard${profileQuery}`);
const metabolic = dashboard.episodes.find((episode) => /metabolic|diabet|renal|nutrient/i.test(episode.title)) || dashboard.episodes[0];
if (!metabolic) throw new Error("Profile needs at least one care track before showcase setup.");
let mental = dashboard.episodes.find((episode) => /mental|mood|sleep|anxiety/i.test(episode.title));
if (!mental) {
  mental = await request(`/api/episodes${profileQuery}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Mental health and sleep", type: "condition", startDate: "2026-05-12", status: "active", summary: "Anxiety, mood, sleep quality, and response to medication changes." }),
  });
}

const documents = [
  {
    filename: "showcase-2026-06-metabolic-renal-lab.pdf", episodeId: metabolic.id,
    spec: { title: "Metabolic and renal monitoring panel", type: "Blood report", date: "2026-06-18", provider: "Health OS Demonstration Laboratory", sections: [
      ["Laboratory results", "HbA1c 7.4% (reference 4.0–5.6, HIGH). Fasting glucose 162 mg/dL (reference 70–99, HIGH). Creatinine 1.32 mg/dL (reference 0.67–1.17, HIGH). eGFR 56 mL/min/1.73m2 (reference above 60, LOW). Urine albumin-creatinine ratio 82 mg/g (reference below 30, HIGH). LDL cholesterol 132 mg/dL (reference below 100, HIGH). Triglycerides 190 mg/dL (reference below 150, HIGH). Potassium 4.8 mmol/L (reference 3.5–5.1, NORMAL)."],
      ["Interpretive note", "Glycemic markers have worsened since the prior panel. Renal markers remain outside range. Review medicines, supplements, hydration, meal routine, and home readings with the treating clinicians."],
      ["Action items", "Repeat renal panel and urine ACR in 6 weeks. Bring fasting glucose log. Book endocrinology follow-up. Review creatine supplement use with the clinician; do not change treatment without medical advice."],
    ] },
  },
  {
    filename: "showcase-diabetes-consultation-note.pdf", episodeId: metabolic.id,
    spec: { title: "Diabetes and kidney care consultation", type: "Consultation note", date: "2026-06-20", provider: "Sunrise Endocrine Clinic", sections: [
      ["Diagnoses", "Type 2 diabetes mellitus with hyperglycemia. Diabetic kidney disease with albuminuria. Hypertension. Mixed dyslipidemia."],
      ["Recent changes", "Fasting sugars have risen during the last month. Breakfast is frequently cereal, toast, or sweetened tea. Patient reports mild fatigue and intermittent burning in both feet."],
      ["Instructions", "Continue home fasting glucose and blood-pressure logs. Check feet every day. Favor protein and fiber at breakfast and reduce sweetened drinks. Maintain hydration unless a clinician has given a fluid restriction."],
      ["Next appointment", "Endocrinology follow-up appointment booked for 2026-07-15 at 10:30 AM to review diabetes control, kidney markers, medicines, and meal patterns. Bring medicine packets, glucose log, and blood-pressure log."],
      ["Notable actions", "Complete renal panel, HbA1c, fasting lipids, potassium, and urine ACR before the visit. Arrange dietitian review. Seek prompt clinical advice for worsening dizziness, swelling, reduced urine output, or persistent high glucose readings."],
    ] },
  },
  {
    filename: "showcase-primary-care-prescription.pdf", episodeId: metabolic.id,
    spec: { title: "Primary care prescription and medication adjustment", type: "Prescription", date: "2026-06-20", provider: "Lakeview Family Medicine", sections: [
      ["Active medicines", "Metformin XR 500 mg: two tablets with breakfast and one tablet with dinner, active. Sitagliptin 100 mg: one tablet after lunch, active. Telmisartan 40 mg: one tablet every morning, active. Rosuvastatin 10 mg: one tablet at bedtime, active. Methylcobalamin 1500 mcg: one tablet after breakfast, active."],
      ["Adjustment", "Metformin XR evening dose increased from one 500 mg tablet to two 500 mg tablets with dinner because fasting glucose is above goal."],
      ["Instructions", "Caregiver to use the simple morning, lunch, dinner, and bedtime logging slots. Do not double a dose after a missed dose. Contact the prescribing clinician for repeated dizziness or gastrointestinal symptoms."],
      ["Follow-up appointment", "Primary care medication review appointment scheduled for 2026-07-03 at 4:00 PM. Bring the updated dose list and seven-day medicine log."],
    ] },
  },
  {
    filename: "showcase-renal-referral.pdf", episodeId: metabolic.id,
    spec: { title: "Nephrology referral", type: "Referral", date: "2026-06-21", provider: "Community Renal Care Network", sections: [
      ["Referral reason", "Persistent albuminuria, eGFR below 60, and recent creatinine rise in a patient with diabetes and hypertension. Active supplements include creatine monohydrate."],
      ["Scheduled appointment", "Nephrology consultation confirmed for 2026-06-30 at 11:15 AM for kidney risk review and medicine/supplement reconciliation."],
      ["Preparation instructions", "Bring all medicines and supplements, three recent blood-pressure readings, the latest renal panels, and urine ACR reports. Maintain usual prescribed medicines unless the treating clinician advises otherwise."],
    ] },
  },
  {
    filename: "showcase-psychiatry-medication-review.pdf", episodeId: mental.id,
    spec: { title: "Psychiatry medication and sleep review", type: "Consultation note", date: "2026-06-19", provider: "MindWell Psychiatry Centre", sections: [
      ["Symptoms", "Anxiety has increased over the last two weeks. Sleep has fallen from about 6.5 hours to 4.5–5 hours, with early-morning waking, low motivation, and daytime fatigue. No suicidality, psychosis, or substance use was reported."],
      ["Medication change", "Sertraline 25 mg every morning stopped. Sertraline adjusted to 50 mg every morning starting 2026-06-19. Melatonin 2 mg at bedtime started as needed for up to 14 days."],
      ["Instructions", "Track sleep quality, anxiety, mood, and daytime function daily. Maintain a consistent wake time and reduce evening screen exposure. Contact the clinician promptly for marked agitation, worsening mood, suicidal thoughts, or severe side effects."],
      ["Next appointment", "Psychiatry follow-up appointment booked for 2026-07-07 at 2:30 PM to review symptoms after the medication adjustment."],
    ] },
  },
];

for (const item of documents) {
  if (dashboard.documents.some((document) => document.filename === item.filename)) {
    process.stdout.write(`${item.filename}: already present\n`); continue;
  }
  const result = await ingest(item.filename, await pdfBuffer(item.spec), item.episodeId);
  process.stdout.write(`${item.filename}: ${result?.status || "complete"}\n`);
}

dashboard = await request(`/api/dashboard${profileQuery}`);
mental = dashboard.episodes.find((episode) => Number(episode.id) === Number(mental.id));
if (mental) {
  const checkinDates = ["2026-06-19", "2026-06-20", "2026-06-21"];
  for (let index = 0; index < checkinDates.length; index++) {
    const metrics = Object.fromEntries(mental.markerSchema.map((marker) => [marker.key, marker.direction === "higher_worse" ? [2, 4, 5][index] : [4, 2, 1][index]]));
    await request(`/api/episodes/${mental.id}/checkins${profileQuery}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: checkinDates[index], metrics, notes: ["Baseline after medication review.", "Sleep and anxiety were worse overnight.", "Third worsening check-in; caregiver plans to raise this at follow-up."][index] }),
    });
  }
}

if (dashboard.foodEntries.length < 4) {
  const meals = [
    ["pancakes-syrup-juice.jpg", "Pancakes, syrup and fruit juice", "Carbohydrate-heavy breakfast; little visible protein", ["#f0d6b5", "#d39b59", "#d8a44d", "#f0bc52", "#e6853b"], "2026-06-18T08:15:00.000Z"],
    ["cereal-toast-sweet-tea.jpg", "Sweet cereal, toast and sweet tea", "Processed high-carbohydrate breakfast; low visible protein", ["#e8d7bd", "#b88c5a", "#d6b06a", "#c88f4b", "#aa6840"], "2026-06-19T08:05:00.000Z"],
    ["white-rice-potato.jpg", "White rice and potato curry", "Carbohydrate-heavy lunch; modest vegetables", ["#dce0bd", "#a8a873", "#eee8c9", "#d9a24f", "#91a85d"], "2026-06-20T13:10:00.000Z"],
    ["lentils-eggs-salad-water.jpg", "Lentils, eggs, salad and water", "Protein and fiber-forward balanced dinner", ["#cfe0d2", "#76977e", "#c58e4f", "#e3d37c", "#69a06e"], "2026-06-20T19:35:00.000Z"],
  ];
  for (const [filename, title, subtitle, palette, eatenAt] of meals.slice(dashboard.foodEntries.length)) {
    const result = await addMeal(filename, await mealImage(title, subtitle, palette), metabolic.id, eatenAt);
    process.stdout.write(`${filename}: meal ${result.id}\n`);
  }
}

dashboard = await request(`/api/dashboard${profileQuery}`);
const firstMedicine = dashboard.interventions.find((item) => item.status === "active" && item.scheduleSlots?.length);
if (firstMedicine) {
  const slot = firstMedicine.scheduleSlots[0];
  await request(`/api/interventions/${firstMedicine.id}/doses${profileQuery}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: "2026-06-21", slotKey: slot.key, status: "taken", notes: "Synthetic showcase dose confirmation." }),
  });
}

dashboard = await request(`/api/dashboard${profileQuery}`);
console.log(JSON.stringify({
  profileId,
  caregiverUrl: `${base}/?profileId=${profileId}&experience=caregiver`,
  elderUrl: `${base}/elder?profileId=${profileId}`,
  counts: {
    documents: dashboard.documents.length, careTracks: dashboard.episodes.length,
    appointments: dashboard.reminders.length, actions: dashboard.actions.length,
    foodEntries: dashboard.foodEntries.length, foodTrends: dashboard.foodTrends.length,
    missedDoses: dashboard.missedDoses.length, riskFlags: dashboard.riskFlags.length,
    worseningCheckins: dashboard.digest.worseningCheckins.length,
  },
}, null, 2));
