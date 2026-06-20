# Personal Health OS — Synthetic Pipeline Test Report

Test date: 2026-06-20

## Scope

This pass exercised the complete local workflow: PDF generation, LiteParse parsing, OCR fallback, Gemma extraction, canonical biomarker matching, episode assignment, timeline creation, intervention adherence, insight generation, search, assistant answers, and doctor preparation.

All records are fictional and every generated document is marked **SYNTHETIC TEST DATA**.

## Corpus

The corpus in `test-data/synthetic-patient/` contains nine realistic documents across different layouts:

1. Baseline laboratory grid
2. Two-column follow-up laboratory report
3. Ankle injury consultation note
4. Ankle injury prescription
5. Physiotherapy follow-up
6. Dense multi-panel laboratory report
7. Supplement review note
8. Compact laboratory report
9. Image-only scanned laboratory PDF

The fictional history spans January 2025 to March 2026. It includes vitamin D3, omega-3, magnesium, zinc, creatine, strength training, serial blood tests, and a grade II right lateral ankle sprain.

## Final results

| Check | Result |
| --- | ---: |
| Documents ingested and organized | 9 / 9 |
| Expected laboratory measurements extracted | 72 / 72 (100%) |
| Document category accuracy | 9 / 9 (100%) |
| Laboratory episode assignment | 6 / 6 (100%) |
| Ankle injury episode assignment | 3 / 3 (100%) |
| Image-only OCR measurements | 9 / 9 (100%) |
| Functional observations captured | 8 |
| Functional observations incorrectly stored as biomarkers | 0 |
| Unified biomarkers | 21 |
| Timeline events | 35 |
| Interventions | 6 |
| Prescription-created medication routines | 3 |
| Open, deduplicated follow-ups | 6 |
| Generated insights | 11 |
| Relationship insights | 5 |
| Mean ingestion time | about 5.1 seconds/document |

The 100% extraction result describes this controlled synthetic corpus only; it is not a claim of universal clinical-document accuracy.

## Defects found and corrected

- The dashboard API silently truncated extracted biomarkers to 12. It now returns the complete set.
- Provider naming differences created duplicate biomarker series. Canonical aliases now unify the tested vitamin, lipid, metabolic, thyroid, liver, kidney, inflammatory, hematology, and mineral markers.
- Pain scores, range of motion, and balance tests were initially treated as laboratory biomarkers. They now become symptom or functional-observation timeline events.
- Related documents were disconnected. A context-aware Gemma episode classifier now links laboratory monitoring together and groups the consultation, prescription, and physiotherapy note into one ankle-injury episode.
- Follow-up extraction produced duplicate reminders. Similar tasks are now deduplicated with episode and due-date context.
- Search could match everything for whitespace-only input. Queries are now trimmed.
- Assistant and doctor-preparation Markdown was displayed as raw text. It is now rendered safely as Markdown.
- Interventions had no day-to-day completion model. Scheduled frequency, daily check-ins, seven-day consistency, and low-adherence insights are now supported.
- Original uploads were discarded after parsing. New uploads now retain the source binary, MIME type, description, inline view, download, and event-specific ZIP export.
- Episodes had no direct creation or recovery UI. Manual events now support active, monitoring, and closed states plus daily pain, stiffness, swelling, and function check-ins.
- Doctor preparation was global. It can now be scoped to an event, tailored with a patient prompt, and paired with suggested source records.

## Event and document feature validation

The 2026-06-20 feature pass also verified:

- Manual injury creation and persistence through the live UI.
- Daily 1–5 symptom and function logging, including same-day update behavior.
- Deterministic worsening detection across three check-ins and flag surfacing on both the event card and overview.
- Automatic medication routine creation from the synthetic ankle prescription, including dose, frequency, planned weekly doses, and source-document linkage.
- Original PDF retrieval with the correct inline content headers and byte-identical PDF format.
- Event document packaging as a valid ZIP containing the stored prescription.
- Event-specific, user-tailored doctor prep with linked document recommendations.
- Desktop and 390 px mobile navigation/layout checks with no browser console errors.
- Production TypeScript/Vite build and the grounded assistant/doctor-prep feature suite.

## Automated checks

Run the complete reproducible suite with:

```bash
npm run test:corpus:generate
npm run test:corpus
npm run test:features
npm run build
```

`test:corpus` resets only the development database, uploads the PDFs through the real API, evaluates extracted facts against `ground-truth.json`, populates intervention adherence, and writes the evaluation reports.

`test:features` verifies grounded supplement analysis, injury-episode synthesis, follow-up answering, and doctor-brief generation. It also checks that the assistant distinguishes temporal association from proof of causation.

Machine-readable details are in `evaluation-report.json` and `feature-test-report.json`; the concise result is in `evaluation-report.md`.

## Remaining limits before hosted clinical use

- Extraction is probabilistic. The interface should retain a human review/edit flow for every imported fact before it is relied upon clinically.
- This corpus does not yet cover handwriting, severely skewed phone photos, non-English records, very long hospital packets, DICOM, or unit conversion between incompatible provider conventions.
- Relationship insights are observational and must not be presented as diagnosis, causality, or treatment advice.
- Adherence is self-reported unless a future device or pharmacy integration supplies it.
- The current product is a local single-user build. Internet deployment still requires identity and tenant isolation, encryption/key management, audit logging, backups and deletion controls, consent handling, rate limits, malware scanning, and the appropriate healthcare/privacy compliance review.
