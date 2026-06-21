# Health OS

A local-first longitudinal health system for people and the family members helping manage care. It parses medical records, normalizes biomarkers, stores a structured health history, tracks interventions and follow-ups, and answers questions using the complete stored record.

> **AIBoomi Startup Weekend submission:** One shared health memory, two purpose-built experiences—simple daily support for an older adult and actionable context for their caregiver.

## Submission links

- **Repository:** https://github.com/mz-hassan/HealthOS
- **Product demo:** Add hosted URL or screen recording before portal submission
- **Pitch deck:** [`submission/Health-OS-Pitch-Deck.pdf`](submission/Health-OS-Pitch-Deck.pdf)
- **AI Impact Statement:** [`submission/AI-IMPACT-STATEMENT.md`](submission/AI-IMPACT-STATEMENT.md)
- **Three-minute demo script:** [`submission/DEMO-SCRIPT.md`](submission/DEMO-SCRIPT.md)

## The problem

Health records arrive as scattered PDFs, prescriptions, lab reports, and photos. Older adults are then expected to remember medicines and appointments, while family caregivers reconstruct what changed from chats and files. The result is fragmented context rather than a usable history.

Health OS turns each upload into a longitudinal, source-linked care graph. The elder sees only what matters today; the caregiver sees trends, open actions, missed doses, care tracks, meal patterns, and a grounded doctor brief. It supports—not replaces—clinical judgment.

## Demo in 90 seconds

1. Run `npm run dev`, then `npm run demo:care` in another terminal.
2. Open the caregiver URL printed by the script and show **What changed**, care tracks, source documents, and the doctor brief.
3. Open the elder URL and log a scheduled medicine, view the next appointment, or add a meal photo.
4. Return to the caregiver view: both experiences operate on the same SQLite-backed patient record.

## Technical approach

| Layer | What we use | Why |
| --- | --- | --- |
| Document understanding | LlamaIndex LiteParse | Local, layout-preserving parsing and OCR fallback |
| AI reasoning/extraction | Gemma 4 26B via Neysa's OpenAI-compatible API | Structured medical extraction, care-track assignment, grounded Q&A and briefs |
| Validation | Zod schemas + SQLite transactions | Reject malformed model output and persist linked facts atomically |
| Product | React 19, TypeScript, Vite, Recharts | Fast, accessible caregiver and elder interfaces |
| API/data | Express 5, SQLite | Local-first prototype with source binaries and structured history together |

## Evidence, not a victory lap

The reproducible synthetic evaluation ingests nine fictional, watermarked documents through the real pipeline. On this controlled corpus it recovered **72/72 expected biomarker measurements**, classified **9/9 document types**, clustered both longitudinal episodes, and passed grounded assistant and doctor-brief checks. These results are not a claim of clinical or universal document accuracy; see [`TESTING_REPORT.md`](TESTING_REPORT.md) for scope and limitations.

## Build disclosure and attribution

Core product features were built during the AIBoomi sprint. The project uses the open-source packages listed in `package.json`; generated test records are original, fictional, and marked **SYNTHETIC TEST DATA**. No real patient data is included. Gemma inference is provided through Neysa. Code is released under the [MIT License](LICENSE).

## What is connected

- **Linked care experiences:** The same patient record opens in a detailed caregiver dashboard or a fixed-screen elder portal with upload, appointments, time-slot medicines, meal capture, and embedded chat.
- **Persistent theme toggle:** Light and dark modes are available in both caregiver and elder views, and the preference is stored locally for future sessions.
- **Document parsing:** LiteParse runs locally and converts supported files to layout-preserving Markdown.
- **Medical extraction:** Gemma through the Neysa OpenAI-compatible API turns parsed text into validated structured facts.
- **Persistent health store:** SQLite stores documents, normalized biomarkers, timeline events, interventions, and follow-ups.
- **Health assistant:** Each answer is grounded in a fresh database-derived context, not hardcoded sample data.
- **Doctor brief:** Gemma produces an appointment summary from the same structured health database.
- **Episode graph:** A context-aware Gemma pass assigns each new document to an existing health episode or creates a new one. Injury consultations, prescriptions, and rehabilitation notes can therefore stay connected automatically.
- **Intervention adherence:** Supplements, medications, and routines support planned weekly frequency and daily taken/missed logs with rolling consistency.
- **Adaptive event tracking:** Each health event gets a custom daily marker set, so injuries can track pain/function while nutrient or general-health monitoring can track energy, sleep, tiredness, and other more relevant signals.
- **Prescription routines:** Extracted prescription medicines automatically become trackable routines with dose, frequency, and source linkage.
- **Mobile-friendly medication agenda:** Active medications and supplements are grouped into morning, midday, evening, bedtime, weekly, or flexible slots for a phone-first routine view.
- **Document memory:** Original uploads are retained locally for inline viewing, individual download, and event-specific ZIP export.
- **Tailored doctor prep:** Appointment briefs can be scoped to an event, guided by a patient prompt, and bundled with suggested source documents.
- **Document-to-action memory:** Ingestion stores diagnoses, instructions, action items, appointments, medicines, biomarkers, and track assignment in one transaction. Caregivers see open actions instead of only a file history.
- **Appointment system:** Explicit future visits are separated from repeat tests, linked to care tracks, and shown across caregiver and elder experiences with clean empty states.
- **Missed-dose escalation:** Dose logs are keyed by medicine, date, and schedule slot. The dashboard derives overdue/unlogged doses and emits a notification-ready in-app alert payload.
- **Caregiver digest and risk observations:** A seven-day digest combines new records, abnormal labs, missed medicines, appointments, meal patterns, and worsening check-ins. Cross-track flags are deliberately non-diagnostic.
- **Meal photo timeline:** Both experiences use the configured multimodal model to assess visible macro balance, fiber, processing/sugar signals, and hydration cues without calorie counting. Entries share the same profile timeline and can link to a care track.
- **Track-native context:** Track cards expose their documents, appointments, actions, medicines, biomarkers, check-ins, assistant context, and doctor prep. Uploads can be pre-assigned or reassigned later.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5180`. The API runs at `http://localhost:8788`.

Copy `.env.example` to `.env` and add a Neysa API key before using AI-powered ingestion, chat, meal assessment, or doctor prep. Never commit the `.env` file.

## Linked care demo

Populate a parent-facing linked-care profile with the synthetic record set:

```bash
npm run demo:care
```

That script creates a caregiver-linked record for `Ramesh Mehta`, seeds medicines plus the synthetic PDFs, and prints two localhost URLs:

- caregiver view: `http://localhost:5180/?profileId=2&experience=caregiver`
- elder view: `http://localhost:5180/elder?profileId=2`

The server reads these variables from the git-ignored `.env`:

```env
NEYSA_API_KEY=...
NEYSA_BASE_URL=https://neysa-gemma-26b-a4b.pipeshift.com/v1
NEYSA_MODEL=gemma-4-26b-a4b-it
PORT=8788
```

## Ingestion pipeline

1. Multer validates up to eight PDF, DOC/DOCX, JPG, JPEG, or PNG files (20 MB each).
2. Each file is written with owner-only permissions to a temporary directory.
3. LiteParse produces Markdown from an owner-only temporary copy; that temporary copy is deleted in a `finally` block.
4. At most 70,000 characters are sent server-side to Gemma with a strict extraction schema.
5. Zod validates the model response; invalid extraction cannot enter the database.
6. A SQLite transaction writes the original source binary, document description, biomarkers, events, diagnoses, medication routines, follow-ups, instructions, and generated actions together.
7. The dashboard refreshes from SQLite; the assistant rebuilds its context from those same stored facts.

## UI and navigation notes

- The caregiver workspace and elder workspace are two interfaces on top of the same underlying linked profile.
- Elder widgets for appointments, medicines, and chat keep a simple fixed layout and can expand into a focused panel.
- UI overlays and expanded panels are mirrored into the URL so browser back closes the in-app state before leaving the site.
- Biomarker overview cards are sorted by severity first, so the most important markers surface before reassuring ones.
- Caregiver uploads optionally select a care track; leaving it blank retains model assignment. Documents can be reassigned from the filtered library.
- Document filters cover care track, normalized document type, and date. Track document counts open a source-record drawer.
- Meal images are retained locally in SQLite; only the image submitted for assessment is sent to the configured multimodal endpoint.

## Feature architecture

- `documents`, `biomarkers`, `events`, `interventions`, `followups`, and `document_episodes` remain the core ingestion graph.
- `document_actions` stores open/completed instructions and notable actions derived from source records.
- `medication_dose_logs` stores one status per scheduled slot and is the basis for missed-dose alerts; its returned `notification` object is the seam for future push delivery.
- `food_entries` stores the original meal image, model assessment JSON, profile, optional care track, and timeline date.
- `/api/dashboard` derives track threads, upcoming appointment reminders, caregiver digest, food trends, missed doses, and observational cross-track flags from persisted data.
- `/api/doctor-brief` and `/api/assistant` accept care-track context; whole-profile mode remains available.

## Data and security

- Credentials exist only in `.env` and are never included in browser code or API responses.
- The SQLite file is stored at `data/healthos.sqlite`, excluded from Git, and set to owner-only file permissions.
- Original uploads are retained as SQLite BLOBs on the local machine; no public file directory is created.
- Model context contains structured health facts and document summaries, not full parsed document text.
- This configuration is intended for a trusted, single-user machine. Add authentication, encrypted backups, database encryption, consent/audit controls, and a formal privacy review before hosting it for multiple users.

## Authentication direction for caregiver linking

For a hosted multi-user version, the cleanest setup is:

1. A caregiver account signs in with passkey or email OTP.
2. The caregiver creates a patient record and invites family members or clinicians with role-based access.
3. The elder account can use a simpler login path such as magic link, phone OTP, or device-bound passkey with a locked-down interface.
4. Every linked user should be scoped to a patient record with explicit permissions like `upload`, `chat`, `medications`, `appointments`, and `admin`.

For this local prototype, linked care is modeled at the profile level so both views share one underlying record without introducing a full auth system yet.

## Full feature showcase

Populate profile 1 through the real document, meal-photo, check-in, and dose-log APIs:

```bash
npm run demo:showcase
```

The command is repeat-safe for its named documents and creates future appointments, generated document actions, abnormal metabolic/renal trends, medication changes, worsening mental-health check-ins, assessed meal photos and food patterns, missed-dose alerts, caregiver digest content, and non-diagnostic cross-track observations.

## Production build

```bash
npm run build
npm start
```

## Synthetic evaluation corpus

The repository includes a clearly watermarked fictional patient corpus under `test-data/synthetic-patient/`: five blood-panel layouts (including an image-only OCR scan), an ankle-injury consultation, a separate prescription, a physiotherapy follow-up, and a supplement review.

```bash
npm run test:corpus:generate
npm run test:corpus
npm run test:features
```

`test:corpus` resets the development-only database, populates interventions and adherence history, ingests every PDF, and writes quantitative results to `evaluation-report.json` and `evaluation-report.md`. The reset endpoint is unavailable when `NODE_ENV=production` and requires a test-only header.
