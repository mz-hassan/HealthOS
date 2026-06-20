import PDFDocument from "pdfkit";
import sharp from "sharp";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultOut = join(process.cwd(), "test-data", "synthetic-elder");
const patient = {
  name: "Ramesh Mehta",
  dob: "1952-03-11",
  sex: "Male",
  patientId: "ELD-2026-014",
};

function createPdf(file, title, date, provider, outDir) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 38,
    info: { Title: `SYNTHETIC ELDER TEST DATA - ${title}` },
  });
  doc.pipe(createWriteStream(join(outDir, file)));
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#b42318")
    .text("SYNTHETIC TEST DATA - NOT A REAL MEDICAL RECORD", {
      align: "center",
    });
  doc.moveDown(0.7);
  doc
    .fillColor("#173f35")
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(provider);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#3b4741")
    .text(title);
  doc.moveDown(0.6);
  doc
    .fontSize(8)
    .text(
      `Patient: ${patient.name}    DOB: ${patient.dob}    Sex: ${patient.sex}    ID: ${patient.patientId}`,
    );
  doc.text(`Encounter date: ${date}`);
  doc.moveDown(0.8);
  return doc;
}

function writeParagraph(doc, heading, text) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#203229").text(heading);
  doc
    .moveDown(0.25)
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#44514b")
    .text(text, { lineGap: 2 });
  doc.moveDown(0.7);
}

function createLabPdf(file, title, date, provider, values, comment, outDir) {
  const doc = createPdf(file, title, date, provider, outDir);
  const widths = [210, 65, 70, 88, 58];
  let y = doc.y + 10;
  let x = 38;
  ["TEST", "RESULT", "UNIT", "REFERENCE", "FLAG"].forEach((cell, index) => {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#203229").text(cell, x, y, {
      width: widths[index],
      lineBreak: false,
    });
    x += widths[index];
  });
  y += 18;
  doc.moveTo(38, y - 4).lineTo(557, y - 4).strokeColor("#a7b1ab").stroke();
  for (const value of values) {
    let rowX = 38;
    const flagColor = value[4] === "normal" ? "#2c4037" : "#a05930";
    [value[0], value[1], value[2], value[3], String(value[4]).toUpperCase()].forEach(
      (cell, index) => {
        doc
          .font(index === 1 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7.5)
          .fillColor(index === 4 ? flagColor : "#2c4037")
          .text(String(cell), rowX, y, { width: widths[index], lineBreak: false });
        rowX += widths[index];
      },
    );
    y += 16;
  }
  writeParagraph(doc, "Clinical comments", comment);
  doc.end();
}

async function createImageCapturePages(outDir) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const pages = [
    {
      file: "01-home-lab-capture-page-1.jpg",
      title: "Home lab capture - page 1",
      encounterDate: "2025-07-18",
      body: [
        ["HbA1c", "8.8 %", "4.0-5.6", "HIGH"],
        ["Fasting Glucose", "182 mg/dL", "70-99", "HIGH"],
        ["Creatinine", "1.42 mg/dL", "0.67-1.17", "HIGH"],
        ["eGFR", "52 mL/min/1.73m2", ">60", "LOW"],
        ["Urine ACR", "98 mg/g", "<30", "HIGH"],
      ],
      footer:
        "Initial phone-capture upload for diabetes and kidney monitoring. Family planned specialist follow-up after this report.",
    },
    {
      file: "01-home-lab-capture-page-2.jpg",
      title: "Home lab capture - page 2",
      encounterDate: "2025-07-18",
      body: [
        ["LDL Cholesterol", "136 mg/dL", "<100", "HIGH"],
        ["Triglycerides", "228 mg/dL", "<150", "HIGH"],
        ["Vitamin B12", "228 pg/mL", "200-1100", "LOW-NORMAL"],
        ["Vitamin D", "18 ng/mL", "30-100", "LOW"],
        ["Potassium", "4.9 mmol/L", "3.5-5.1", "NORMAL"],
      ],
      footer:
        "Two-page phone capture simulation for elder upload flow.",
    },
  ];
  for (const page of pages) {
    const rows = page.body
      .map(
        (row, index) => `
          <text x="92" y="${360 + index * 120}" font-size="30">${escape(row[0])}</text>
          <text x="620" y="${360 + index * 120}" font-size="30" font-weight="700">${escape(row[1])}</text>
          <text x="865" y="${360 + index * 120}" font-size="26">${escape(row[2])}</text>
          <text x="1085" y="${360 + index * 120}" font-size="24" fill="${row[3] === "NORMAL" ? "#205a4a" : "#a05b32"}">${escape(row[3])}</text>
          <line x1="84" y1="${382 + index * 120}" x2="1150" y2="${382 + index * 120}" stroke="#c8cbc7"/>
        `,
      )
      .join("");
    const svg = `
      <svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f6f3eb"/>
        <g font-family="Arial" fill="#22352d">
          <text x="620" y="74" text-anchor="middle" font-size="19" fill="#a43f32" font-weight="700">SYNTHETIC PHONE CAPTURE - ELDER UPLOAD DEMO</text>
          <text x="84" y="152" font-size="42" font-weight="700">Community Diabetes Lab</text>
          <text x="84" y="205" font-size="24">${escape(page.title)}</text>
          <text x="84" y="248" font-size="22">Patient: ${escape(patient.name)} · DOB: ${escape(patient.dob)} · ID: ${escape(patient.patientId)}</text>
          <text x="84" y="282" font-size="22">Collected: ${escape(page.encounterDate)}</text>
          <line x1="84" y1="310" x2="1150" y2="310" stroke="#375147" stroke-width="3"/>
          <text x="92" y="344" font-size="24" font-weight="700">TEST</text>
          <text x="620" y="344" font-size="24" font-weight="700">RESULT</text>
          <text x="865" y="344" font-size="24" font-weight="700">REFERENCE</text>
          <text x="1085" y="344" font-size="24" font-weight="700">FLAG</text>
          ${rows}
          <text x="84" y="1090" font-size="24">${escape(page.footer)}</text>
        </g>
      </svg>
    `;
    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 94 }).toBuffer();
    writeFileSync(join(outDir, page.file), buffer);
  }
}

function createNotes(outDir) {
  const noteSpecs = [
    {
      file: "07-endocrinology-followup.pdf",
      title: "Endocrinology follow-up note",
      date: "2026-06-02",
      provider: "Sunrise Endocrine Clinic",
      sections: [
        [
          "Reason for visit",
          "Quarterly diabetes review for type 2 diabetes, hypertension, diabetic kidney disease, and diabetic neuropathy monitoring.",
        ],
        [
          "Symptoms and home history",
          "Patient reports burning feet at night, numbness in toes, fasting sugars often between 142 and 168 mg/dL, and occasional dizziness when lunch is delayed. Daughter confirms the evening walk is now more consistent.",
        ],
        [
          "Assessment",
          "Type 2 diabetes is improving but remains above goal. Albuminuria persists. Kidney function is stable but still needs repeated monitoring. Neuropathy symptoms remain mild.",
        ],
        [
          "Plan",
          "Continue metformin XR, sitagliptin, telmisartan, rosuvastatin, and daily foot checks. Repeat HbA1c, creatinine, eGFR, urine ACR, and potassium in 8 weeks.",
        ],
        [
          "Next appointment",
          "Endocrinology follow-up appointment booked for 2026-07-18 for diabetes and kidney care. Bring sugar log, blood-pressure readings, and all medicine packets.",
        ],
      ],
    },
    {
      file: "08-primary-care-prescription.pdf",
      title: "Primary care medication update",
      date: "2026-06-05",
      provider: "Lakeview Family Medicine",
      sections: [
        [
          "Medication list",
          "Metformin XR 500 mg - 2 tablets with breakfast and 1 tablet with dinner. Sitagliptin 100 mg - 1 tablet after lunch. Telmisartan 40 mg - 1 tablet every morning. Rosuvastatin 10 mg - 1 tablet at bedtime. Methylcobalamin 1500 mcg - 1 tablet after breakfast.",
        ],
        [
          "Monitoring instructions",
          "Family caregiver should confirm the morning and bedtime tablets are taken daily. Keep a fasting sugar log and evening blood-pressure log three times per week.",
        ],
        [
          "Follow-up plan",
          "Primary care medication review appointment scheduled for 2026-07-01. Repeat renal panel before that visit and bring the updated home readings.",
        ],
      ],
    },
    {
      file: "09-retina-referral.pdf",
      title: "Ophthalmology referral",
      date: "2026-06-08",
      provider: "VisionCare Retina Centre",
      sections: [
        [
          "Referral reason",
          "Annual diabetic retina screening requested because of persistent hyperglycemia and a 12-year history of type 2 diabetes.",
        ],
        [
          "Symptoms",
          "Patient reports occasional blur while reading in the evening but denies acute vision loss or flashes.",
        ],
        [
          "Scheduled visit",
          "Retina clinic appointment confirmed for 2026-06-28 for diabetic eye screening. Seek urgent review if sudden visual symptoms occur before then.",
        ],
      ],
    },
    {
      file: "10-psychiatry-sleep-consult.pdf",
      title: "Psychiatry and sleep consultation",
      date: "2026-06-10",
      provider: "MindWell Psychiatry Centre",
      sections: [
        [
          "Reason for consultation",
          "Evaluation for persistent worry, light sleep, early-morning awakening, and reduced motivation over the last 6 months.",
        ],
        [
          "History",
          "Mood is more anxious in the evenings, sleep averages 5 to 5.5 hours, and fatigue is worse after poor sleep. No psychosis, no suicidality, and no substance use reported.",
        ],
        [
          "Assessment",
          "Generalized anxiety symptoms with insomnia pattern. Family support is strong and the daughter helps maintain routines.",
        ],
        [
          "Plan",
          "Begin sertraline 25 mg every morning for 1 week, then 50 mg every morning if tolerated. Start sleep-hygiene routine, evening screen reduction, and breathing practice before bed.",
        ],
        [
          "Next appointment",
          "Psychiatry follow-up appointment scheduled for 2026-07-09 for anxiety and sleep review.",
        ],
      ],
    },
    {
      file: "11-podiatry-foot-care.pdf",
      title: "Podiatry foot care review",
      date: "2026-06-12",
      provider: "Stride Foot Clinic",
      sections: [
        [
          "Visit summary",
          "Feet inspected because of diabetic neuropathy symptoms. Skin is intact. Callus under right great toe. Protective sensation mildly reduced at both forefeet.",
        ],
        [
          "Advice",
          "Wear cushioned footwear, avoid barefoot walking, and continue daily foot checks assisted by daughter if needed.",
        ],
        [
          "Next appointment",
          "Podiatry follow-up appointment booked for 2026-08-12 for diabetic foot surveillance or sooner if redness, skin breakdown, or new pain occurs.",
        ],
      ],
    },
    {
      file: "12-general-wellness-review.pdf",
      title: "General wellness and preventive care review",
      date: "2026-06-14",
      provider: "Preventive Health Clinic",
      sections: [
        [
          "Review focus",
          "Preventive care visit focused on fatigue, appetite, hydration, vaccination review, walking routine, and overall daily function rather than diabetes medication management.",
        ],
        [
          "Assessment",
          "Weight is stable, appetite is fair, walking tolerance has improved, and family support is helping with hydration prompts and meal timing.",
        ],
        [
          "Next appointment",
          "Preventive medicine appointment scheduled for 2026-09-15 for annual wellness review and vaccination planning.",
        ],
      ],
    },
  ];
  for (const note of noteSpecs) {
    const doc = createPdf(note.file, note.title, note.date, note.provider, outDir);
    for (const [heading, text] of note.sections) writeParagraph(doc, heading, text);
    doc.end();
  }
}

function createLabSeries(outDir) {
  const labs = [
    {
      file: "02-diabetes-renal-panel-q3-2025.pdf",
      title: "Diabetes and renal monitoring laboratory panel",
      date: "2025-09-18",
      provider: "Community Diabetes Lab",
      values: [
        ["HbA1c", 8.5, "%", "4.0-5.6", "high"],
        ["Fasting Glucose", 171, "mg/dL", "70-99", "high"],
        ["Creatinine", 1.38, "mg/dL", "0.67-1.17", "high"],
        ["eGFR", 54, "mL/min/1.73m2", ">60", "low"],
        ["Urine ACR", 92, "mg/g", "<30", "high"],
        ["LDL Cholesterol", 130, "mg/dL", "<100", "high"],
        ["Triglycerides", 219, "mg/dL", "<150", "high"],
        ["Vitamin D", 20, "ng/mL", "30-100", "low"],
      ],
      comment:
        "Diabetes and kidney markers remain above target. Continue family-supported medicine routine and arrange specialist diabetes follow-up.",
    },
    {
      file: "03-diabetes-renal-panel-q4-2025.pdf",
      title: "Diabetes and kidney follow-up laboratory panel",
      date: "2025-12-12",
      provider: "Metro Renal & Diagnostics",
      values: [
        ["HbA1c", 8.0, "%", "4.0-5.6", "high"],
        ["Fasting Glucose", 156, "mg/dL", "70-99", "high"],
        ["Creatinine", 1.32, "mg/dL", "0.67-1.17", "high"],
        ["eGFR", 57, "mL/min/1.73m2", ">60", "low"],
        ["Urine ACR", 81, "mg/g", "<30", "high"],
        ["LDL Cholesterol", 118, "mg/dL", "<100", "high"],
        ["Triglycerides", 188, "mg/dL", "<150", "high"],
        ["Vitamin B12", 246, "pg/mL", "200-1100", "low"],
      ],
      comment:
        "Glycemic control is improving but albuminuria persists. Kidney-protective treatment should continue with repeat endocrine review.",
    },
    {
      file: "04-annual-wellness-panel-2026.pdf",
      title: "General wellness and fatigue laboratory panel",
      date: "2026-02-08",
      provider: "Lakeview Diagnostics",
      values: [
        ["Hemoglobin", 12.7, "g/dL", "13.0-17.0", "low"],
        ["WBC Count", 6.8, "x10^3/uL", "4.0-11.0", "normal"],
        ["Platelet Count", 238, "x10^3/uL", "150-400", "normal"],
        ["TSH", 2.18, "mIU/L", "0.4-4.5", "normal"],
        ["Vitamin D", 24, "ng/mL", "30-100", "low"],
        ["Ferritin", 42, "ng/mL", "30-400", "normal"],
        ["Vitamin B12", 268, "pg/mL", "200-1100", "low"],
        ["Magnesium", 1.8, "mg/dL", "1.7-2.2", "normal"],
      ],
      comment:
        "General wellness monitoring shows mild anemia tendency, persistent low vitamin D, and fatigue-associated nutrient tracking. Keep preventive follow-up active.",
    },
    {
      file: "05-mood-sleep-monitoring-panel.pdf",
      title: "Mood and sleep monitoring laboratory panel",
      date: "2026-03-22",
      provider: "MindWell Diagnostics",
      values: [
        ["TSH", 2.11, "mIU/L", "0.4-4.5", "normal"],
        ["Vitamin B12", 255, "pg/mL", "200-1100", "low"],
        ["Vitamin D", 23, "ng/mL", "30-100", "low"],
        ["Fasting Glucose", 144, "mg/dL", "70-99", "high"],
        ["Hemoglobin", 12.9, "g/dL", "13.0-17.0", "low"],
        ["WBC Count", 6.4, "x10^3/uL", "4.0-11.0", "normal"],
      ],
      comment:
        "Fatigue and low mood review included screening labs. Thyroid is normal. Low vitamin D and borderline B12 may worsen low-energy symptoms alongside poor sleep.",
    },
    {
      file: "06-renal-lipid-followup.pdf",
      title: "Diabetes, renal, and lipid follow-up panel",
      date: "2026-05-30",
      provider: "Metro Renal & Diagnostics",
      values: [
        ["HbA1c", 7.1, "%", "4.0-5.6", "high"],
        ["Fasting Glucose", 132, "mg/dL", "70-99", "high"],
        ["Creatinine", 1.26, "mg/dL", "0.67-1.17", "high"],
        ["eGFR", 60, "mL/min/1.73m2", ">60", "normal"],
        ["Urine ACR", 62, "mg/g", "<30", "high"],
        ["LDL Cholesterol", 92, "mg/dL", "<100", "normal"],
        ["Triglycerides", 166, "mg/dL", "<150", "high"],
        ["Vitamin B12", 388, "pg/mL", "200-1100", "normal"],
        ["Potassium", 4.7, "mmol/L", "3.5-5.1", "normal"],
      ],
      comment:
        "Glycemic control is improving but remains above target. Albuminuria persists. Continue kidney-protective therapy and keep the next endocrine appointment.",
    },
  ];
  for (const lab of labs)
    createLabPdf(
      lab.file,
      lab.title,
      lab.date,
      lab.provider,
      lab.values,
      lab.comment,
      outDir,
    );
}

export async function generateSyntheticElderCorpus(outDir = defaultOut) {
  mkdirSync(outDir, { recursive: true });
  await createImageCapturePages(outDir);
  createLabSeries(outDir);
  createNotes(outDir);
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        patient,
        files: [
          "01-home-lab-capture-page-1.jpg",
          "01-home-lab-capture-page-2.jpg",
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
        ],
      },
      null,
      2,
    ),
  );
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = await generateSyntheticElderCorpus();
  console.log(`Generated elder corpus in ${outDir}`);
}
