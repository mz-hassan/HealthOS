# Health OS

A local-first longitudinal health system for people and the family members helping manage care. It parses medical records, normalizes biomarkers, stores a structured health history, tracks interventions and follow-ups, and answers questions using the complete stored record.

## What is connected

- **Linked care experiences:** The same patient record can open in a detailed caregiver dashboard or a fixed-screen elder portal with upload, what's next, medicines, food capture placeholder, and embedded chat.
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

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5180`. The API runs at `http://localhost:8788`.

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
6. A SQLite transaction writes the original source binary, document description, biomarkers, events, diagnoses, medication routines, and follow-ups together.
7. The dashboard refreshes from SQLite; the assistant rebuilds its context from those same stored facts.

## UI and navigation notes

- The caregiver workspace and elder workspace are two interfaces on top of the same underlying linked profile.
- Elder widgets for appointments, medicines, and chat keep a simple fixed layout and can expand into a focused panel.
- UI overlays and expanded panels are mirrored into the URL so browser back closes the in-app state before leaving the site.
- Biomarker overview cards are sorted by severity first, so the most important markers surface before reassuring ones.

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
