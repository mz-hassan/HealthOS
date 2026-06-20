import PDFDocument from "pdfkit";
import sharp from "sharp";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "test-data", "synthetic-patient");
mkdirSync(out, { recursive: true });
const patient = {
  name: "Alex Morgan",
  dob: "1991-08-14",
  sex: "Male",
  patientId: "SYN-2025-001",
};

const panels = [
  {
    file: "01-baseline-lab-grid.pdf",
    date: "2025-01-10",
    provider: "Northstar Reference Laboratory",
    type: "Blood report",
    format: "classic-grid",
    values: [
      ["Vitamin D, 25-OH", 18, "ng/mL", "30–100", "low"],
      ["HbA1c", 5.8, "%", "4.0–5.6", "high"],
      ["Fasting Glucose", 104, "mg/dL", "70–99", "high"],
      ["Total Cholesterol", 219, "mg/dL", "<200", "high"],
      ["LDL Cholesterol", 142, "mg/dL", "<100", "high"],
      ["HDL Cholesterol", 41, "mg/dL", ">40", "normal"],
      ["Triglycerides", 180, "mg/dL", "<150", "high"],
      ["Ferritin", 48, "ng/mL", "30–400", "normal"],
      ["TSH", 2.1, "µIU/mL", "0.4–4.5", "normal"],
      ["ALT", 38, "U/L", "9–46", "normal"],
      ["AST", 29, "U/L", "10–40", "normal"],
      ["Creatinine", 0.96, "mg/dL", "0.60–1.29", "normal"],
      ["eGFR", 104, "mL/min/1.73m²", ">60", "normal"],
      ["hs-CRP", 3.2, "mg/L", "<1.0", "high"],
      ["Vitamin B12", 310, "pg/mL", "200–1100", "normal"],
      ["Zinc", 67, "µg/dL", "60–130", "normal"],
      ["Magnesium", 1.9, "mg/dL", "1.5–2.5", "normal"],
    ],
  },
  {
    file: "02-april-lab-two-column.pdf",
    date: "2025-04-15",
    provider: "CityCare Pathology Services",
    type: "Blood report",
    format: "two-column",
    values: [
      ["Vitamin D, 25-Hydroxy", 29, "ng/mL", "30–100", "low"],
      ["HbA1c", 5.6, "%", "4.0–5.6", "normal"],
      ["Fasting Glucose", 98, "mg/dL", "70–99", "normal"],
      ["LDL-C", 128, "mg/dL", "<100", "high"],
      ["HDL-C", 44, "mg/dL", ">40", "normal"],
      ["Triglycerides", 145, "mg/dL", "<150", "normal"],
      ["ALT (SGPT)", 35, "U/L", "7–45", "normal"],
      ["Creatinine", 1.02, "mg/dL", "0.70–1.30", "normal"],
      ["eGFR CKD-EPI", 97, "mL/min/1.73m²", ">60", "normal"],
      ["High Sensitivity CRP", 1.8, "mg/L", "<1.0", "high"],
      ["Serum Zinc", 78, "µg/dL", "60–120", "normal"],
      ["Serum Magnesium", 2.0, "mg/dL", "1.7–2.4", "normal"],
    ],
  },
  {
    file: "06-august-lab-dense.pdf",
    date: "2025-08-20",
    provider: "Apex Advanced Diagnostics",
    type: "Blood report",
    format: "dense",
    values: [
      ["25-OH Vitamin D", 42, "ng/mL", "30–100", "normal"],
      ["Glycated Hemoglobin (HbA1c)", 5.4, "%", "4.0–5.6", "normal"],
      ["Glucose, Fasting", 92, "mg/dL", "70–99", "normal"],
      ["Total Cholesterol", 183, "mg/dL", "<200", "normal"],
      ["LDL-C Calculated", 112, "mg/dL", "<100", "high"],
      ["HDL-C", 48, "mg/dL", ">40", "normal"],
      ["Triglyceride", 101, "mg/dL", "<150", "normal"],
      ["Ferritin", 44, "ng/mL", "30–400", "normal"],
      ["Thyrotropin (TSH)", 2.3, "µIU/mL", "0.4–4.5", "normal"],
      ["Alanine Aminotransferase", 47, "U/L", "9–46", "high"],
      ["Aspartate Aminotransferase", 36, "U/L", "10–40", "normal"],
      ["Serum Creatinine", 1.16, "mg/dL", "0.60–1.29", "normal"],
      ["Estimated GFR", 82, "mL/min/1.73m²", ">60", "normal"],
      ["Creatine Kinase", 420, "U/L", "44–196", "high"],
      ["hsCRP", 0.9, "mg/L", "<1.0", "normal"],
      ["Zinc, Plasma", 92, "µg/dL", "60–130", "normal"],
      ["Magnesium, Serum", 2.1, "mg/dL", "1.5–2.5", "normal"],
      ["Vitamin B12", 485, "pg/mL", "200–1100", "normal"],
      ["Hemoglobin", 15.1, "g/dL", "13.2–17.1", "normal"],
      ["WBC Count", 6.4, "10³/µL", "3.8–10.8", "normal"],
      ["Platelet Count", 248, "10³/µL", "140–400", "normal"],
    ],
  },
  {
    file: "08-december-lab-compact.pdf",
    date: "2025-12-05",
    provider: "Northstar Reference Laboratory",
    type: "Blood report",
    format: "compact",
    values: [
      ["Vitamin D 25-OH", 46, "ng/mL", "30–100", "normal"],
      ["Hb A1c", 5.3, "%", "4.0–5.6", "normal"],
      ["Fasting Glucose", 89, "mg/dL", "70–99", "normal"],
      ["LDL Cholesterol", 108, "mg/dL", "<100", "high"],
      ["HDL Cholesterol", 51, "mg/dL", ">40", "normal"],
      ["Triglycerides", 88, "mg/dL", "<150", "normal"],
      ["ALT", 34, "U/L", "9–46", "normal"],
      ["Creatinine", 1.12, "mg/dL", "0.60–1.29", "normal"],
      ["eGFR", 86, "mL/min/1.73m²", ">60", "normal"],
      ["Creatine Kinase", 190, "U/L", "44–196", "normal"],
      ["hs-CRP", 0.7, "mg/L", "<1.0", "normal"],
      ["Zinc", 95, "µg/dL", "60–130", "normal"],
      ["Magnesium", 2.2, "mg/dL", "1.5–2.5", "normal"],
    ],
  },
  {
    file: "09-march-lab-scanned-image.pdf",
    date: "2026-03-12",
    provider: "Community Health Lab",
    type: "Blood report",
    format: "scanned-image",
    values: [
      ["25-Hydroxy Vitamin D", 44, "ng/mL", "30–100", "normal"],
      ["Hemoglobin A1c", 5.2, "%", "4.0–5.6", "normal"],
      ["LDL Cholesterol", 105, "mg/dL", "<100", "high"],
      ["HDL Cholesterol", 53, "mg/dL", ">40", "normal"],
      ["Triglycerides", 82, "mg/dL", "<150", "normal"],
      ["Ferritin", 39, "ng/mL", "30–400", "normal"],
      ["Creatinine", 1.05, "mg/dL", "0.60–1.29", "normal"],
      ["eGFR", 94, "mL/min/1.73m²", ">60", "normal"],
      ["hs-CRP", 0.6, "mg/L", "<1.0", "normal"],
    ],
  },
];

function baseDoc(file, title, date, provider) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 38,
    info: { Title: `SYNTHETIC TEST DATA — ${title}` },
  });
  doc.pipe(createWriteStream(join(out, file)));
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor("#b42318")
    .text("SYNTHETIC TEST DATA — NOT A REAL MEDICAL RECORD", {
      align: "center",
    });
  doc.moveDown(0.8).fillColor("#173f35").fontSize(17).text(provider);
  doc.font("Helvetica").fontSize(9).fillColor("#37433d").text(title);
  doc
    .moveDown(0.6)
    .fontSize(8)
    .text(
      `Patient: ${patient.name}    DOB: ${patient.dob}    Sex: ${patient.sex}    Patient ID: ${patient.patientId}`,
    );
  doc.text(`Collection / encounter date: ${date}`);
  doc.moveDown(0.8);
  return doc;
}

function row(doc, y, cells, widths, flag) {
  let x = 38;
  cells.forEach((c, i) => {
    doc
      .font(i === 1 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(7.5)
      .fillColor(flag && i === 4 ? "#a23b2a" : "#26352e")
      .text(String(c), x, y, { width: widths[i], lineBreak: false });
    x += widths[i];
  });
}
function labPdf(panel) {
  const doc = baseDoc(
    panel.file,
    "Comprehensive Laboratory Report",
    panel.date,
    panel.provider,
  );
  const widths = [190, 63, 77, 92, 56];
  let y = doc.y + 8;
  row(doc, y, ["TEST", "RESULT", "UNIT", "REFERENCE", "FLAG"], widths);
  y += 17;
  doc
    .moveTo(38, y - 4)
    .lineTo(557, y - 4)
    .strokeColor("#9aa79f")
    .stroke();
  for (const value of panel.values) {
    if (y > 760) {
      doc.addPage();
      y = 45;
    }
    row(
      doc,
      y,
      [value[0], value[1], value[2], value[3], String(value[4]).toUpperCase()],
      widths,
      value[4] !== "normal",
    );
    y += panel.format === "dense" ? 13 : 16;
    if (panel.format === "two-column" && y > 430) {
      y = doc.y + 8;
    }
  }
  doc.moveDown(2);
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#173f35")
    .text("Clinical comments", 38, Math.min(y + 10, 760));
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#47534c")
    .text(
      panel.date === "2025-08-20"
        ? "Mild ALT and CK elevation may be seen after strenuous exercise; correlate clinically and repeat after 5–7 days without intense training if indicated."
        : panel.date === "2025-01-10"
          ? "Low Vitamin D, dyslipidemia, borderline glycemic marker and elevated hs-CRP. Discuss lifestyle modification and follow-up testing with treating clinician."
          : "Compare with prior results and correlate with clinical history.",
      38,
      Math.min(y + 24, 775),
      { width: 510 },
    );
  doc.end();
}
panels.filter((p) => p.format !== "scanned-image").forEach(labPdf);

async function scannedLabPdf(panel) {
  const escape = (value) =>
    String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const rows = panel.values
    .map(
      (v, i) =>
        `<text x="75" y="${385 + i * 62}" font-size="23">${escape(v[0])}</text><text x="540" y="${385 + i * 62}" font-size="23" font-weight="700">${v[1]}</text><text x="690" y="${385 + i * 62}" font-size="21">${escape(v[2])}</text><text x="900" y="${385 + i * 62}" font-size="21">${escape(v[3])}</text><text x="1100" y="${385 + i * 62}" font-size="20" fill="${v[4] === "normal" ? "#1d4438" : "#a33a2c"}">${String(v[4]).toUpperCase()}</text><line x1="70" y1="${400 + i * 62}" x2="1170" y2="${400 + i * 62}" stroke="#c8ccc9"/>`,
    )
    .join("");
  const svg = `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f7f5ef"/><g transform="rotate(-0.35 620 877)" font-family="Arial" fill="#202925"><text x="620" y="70" text-anchor="middle" font-size="17" fill="#a33a2c" font-weight="700">SYNTHETIC TEST DATA — SCANNED IMAGE SIMULATION</text><text x="70" y="145" font-size="39" font-weight="700">${panel.provider}</text><text x="70" y="195" font-size="23">COMPREHENSIVE BLOOD PANEL</text><text x="70" y="245" font-size="20">Patient: ${patient.name}   DOB: ${patient.dob}   ID: ${patient.patientId}</text><text x="70" y="278" font-size="20">Collection date: ${panel.date}</text><line x1="70" y1="315" x2="1170" y2="315" stroke="#354a41" stroke-width="3"/><text x="75" y="350" font-size="20" font-weight="700">TEST</text><text x="540" y="350" font-size="20" font-weight="700">RESULT</text><text x="690" y="350" font-size="20" font-weight="700">UNIT</text><text x="900" y="350" font-size="20" font-weight="700">REFERENCE</text>${rows}<text x="70" y="1050" font-size="19">Digitally scanned copy. Correlate results with clinical history.</text></g></svg>`;
  const png = await sharp(Buffer.from(svg)).blur(0.3).png().toBuffer();
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    info: { Title: "SYNTHETIC image-only laboratory scan" },
  });
  doc.pipe(createWriteStream(join(out, panel.file)));
  doc.image(png, 0, 0, { fit: [595.28, 841.89] });
  doc.end();
}
await scannedLabPdf(panels.find((p) => p.format === "scanned-image"));

function injuryNote() {
  const doc = baseDoc(
    "03-ankle-injury-consultation.pdf",
    "Orthopaedic Consultation Note",
    "2025-06-05",
    "Riverside Orthopaedic & Sports Clinic",
  );
  doc.font("Helvetica-Bold").fontSize(10).text("Chief complaint");
  doc
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Right ankle pain and swelling after inversion injury while playing badminton on 04 June 2025. Pain 7/10 on weight-bearing.",
    );
  doc.moveDown();
  doc.font("Helvetica-Bold").fontSize(10).text("Examination");
  doc
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Lateral ankle swelling and bruising; tenderness over ATFL and CFL. Anterior drawer mildly positive. Neurovascular examination intact. Able to bear weight for four steps with pain.",
    );
  doc.moveDown();
  doc.font("Helvetica-Bold").fontSize(10).text("Imaging");
  doc
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Right ankle X-ray AP/lateral/mortise: no acute fracture or dislocation. Mortise preserved.",
    );
  doc.moveDown();
  doc.font("Helvetica-Bold").fontSize(10).text("Assessment");
  doc
    .font("Helvetica")
    .fontSize(8)
    .text("Grade II right lateral ankle sprain.");
  doc.moveDown();
  doc.font("Helvetica-Bold").fontSize(10).text("Plan");
  doc
    .font("Helvetica")
    .fontSize(8)
    .list([
      "Relative rest, ice 15 minutes 3–4 times daily, compression and elevation.",
      "Lace-up ankle brace during ambulation for 2–3 weeks.",
      "Medications as per separate prescription.",
      "Begin range-of-motion exercises after 48–72 hours, then supervised physiotherapy.",
      "Review in 14 days; earlier for increasing pain, numbness or inability to bear weight.",
    ]);
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text("Dr. Priya Rao, MS Orthopaedics · Registration SYN-4471");
  doc.end();
}
function prescription() {
  const doc = baseDoc(
    "04-ankle-injury-prescription.pdf",
    "Outpatient Prescription",
    "2025-06-05",
    "Riverside Orthopaedic & Sports Clinic",
  );
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Diagnosis: Grade II right lateral ankle sprain");
  doc.moveDown();
  const meds = [
    ["Naproxen", "250 mg", "One tablet twice daily after food", "5 days"],
    [
      "Pantoprazole",
      "40 mg",
      "One tablet once daily, 30 minutes before breakfast",
      "5 days",
    ],
    [
      "Diclofenac gel",
      "1%",
      "Apply thin layer over painful area three times daily",
      "7 days",
    ],
  ];
  let y = doc.y + 10;
  row(
    doc,
    y,
    ["MEDICINE", "DOSE", "DIRECTIONS", "DURATION"],
    [130, 70, 230, 80],
  );
  y += 22;
  for (const m of meds) {
    row(doc, y, m, [130, 70, 230, 80]);
    y += 30;
  }
  doc
    .moveDown(5)
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Use ankle brace. Avoid running and court sports until reviewed. Physiotherapy referral attached.",
    );
  doc.end();
}
function followup() {
  const doc = baseDoc(
    "05-ankle-followup-physio.pdf",
    "Sports Physiotherapy Progress Note",
    "2025-06-19",
    "MotionWorks Physiotherapy",
  );
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Related episode: Right ankle inversion injury, 04 June 2025");
  doc
    .moveDown()
    .font("Helvetica")
    .fontSize(8)
    .text(
      "Pain reduced from 7/10 to 2/10. Swelling minimal. Walking without limp. Dorsiflexion remains 8 degrees less than left. Single-leg balance 18 seconds right versus 35 seconds left.",
    );
  doc.moveDown();
  doc.font("Helvetica-Bold").text("Plan");
  doc
    .font("Helvetica")
    .list([
      "Continue ankle mobility and calf stretching daily.",
      "Peroneal and calf strengthening three sessions weekly.",
      "Balance/proprioception progression.",
      "Gradual return-to-run protocol when single-leg hop is pain-free.",
      "Four further weekly sessions; orthopaedic review only if progress plateaus.",
    ]);
  doc.end();
}
function supplementReview() {
  const doc = baseDoc(
    "07-supplement-review-note.pdf",
    "Nutrition & Supplement Review",
    "2025-09-02",
    "Harbor Preventive Health",
  );
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Current regimen reported by patient");
  doc
    .font("Helvetica")
    .fontSize(8)
    .list([
      "Vitamin D3 2,000 IU daily — started 20 January 2025",
      "Omega-3 fish oil providing EPA+DHA 1,000 mg daily — started 20 January 2025",
      "Magnesium glycinate 200 mg nightly — started 01 February 2025",
      "Zinc picolinate 15 mg daily with food — started 01 February 2025",
      "Creatine monohydrate 5 g daily — started 01 April 2025",
    ]);
  doc.moveDown();
  doc.font("Helvetica-Bold").text("Review");
  doc
    .font("Helvetica")
    .text(
      "Vitamin D, triglycerides, hs-CRP and zinc improved versus January. Creatinine and CK rose after creatine initiation and intensive resistance training; this does not establish causation. Hydration and repeat CK/renal panel after 5–7 days without strenuous exercise discussed. Avoid exceeding 15 mg/day zinc long-term without copper monitoring.",
    );
  doc.moveDown();
  doc.font("Helvetica-Bold").text("Follow-up");
  doc
    .font("Helvetica")
    .text(
      "Repeat CMP, creatinine/eGFR, CK, fasting lipids, Vitamin D and zinc in approximately 12 weeks.",
    );
  doc.end();
}
injuryNote();
prescription();
followup();
supplementReview();

const groundTruth = {
  patient,
  panels: panels.map((p) => ({
    file: p.file,
    date: p.date,
    provider: p.provider,
    type: p.type,
    biomarkers: p.values.map((v) => ({
      name: v[0],
      value: v[1],
      unit: v[2],
      referenceRange: v[3],
      status: v[4],
    })),
  })),
  documents: [
    {
      file: "03-ankle-injury-consultation.pdf",
      type: "Doctor note",
      date: "2025-06-05",
      episode: "Right ankle sprain",
      diagnoses: ["Grade II right lateral ankle sprain"],
      followUps: ["Review in 14 days"],
    },
    {
      file: "04-ankle-injury-prescription.pdf",
      type: "Prescription",
      date: "2025-06-05",
      episode: "Right ankle sprain",
      medications: ["Naproxen", "Pantoprazole", "Diclofenac gel"],
    },
    {
      file: "05-ankle-followup-physio.pdf",
      type: "Consultation summary",
      date: "2025-06-19",
      episode: "Right ankle sprain",
      followUps: ["Four further weekly sessions"],
    },
    {
      file: "07-supplement-review-note.pdf",
      type: "Consultation summary",
      date: "2025-09-02",
      episode: "Metabolic and nutrient optimization",
      medications: [
        "Vitamin D3",
        "Omega-3 fish oil",
        "Magnesium glycinate",
        "Zinc picolinate",
        "Creatine monohydrate",
      ],
    },
  ],
};
writeFileSync(
  join(out, "ground-truth.json"),
  JSON.stringify(groundTruth, null, 2),
);
console.log(`Generated ${panels.length + 4} PDFs in ${out}`);
