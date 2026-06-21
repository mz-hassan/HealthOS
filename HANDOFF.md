# Health OS handoff

## Current architecture

The caregiver and elder routes are two React surfaces over the same profile-scoped SQLite graph in `server/index.ts`. No feature in this release uses seeded UI state. Documents and meal photos enter through API ingestion, are persisted, and are returned by `/api/dashboard`.

### New persisted data

- `document_actions`: instructions and notable work generated during medical document extraction.
- `medication_dose_logs`: date + schedule-slot medicine statuses. This coexists with legacy `adherence_logs`; new UI writes slot logs.
- `food_entries`: local image blob, multimodal assessment, optional care track, and shared timeline date.
- `documents.instructions_json` and `documents.action_items_json`: source extraction provenance shown in the document library.

### Derived dashboard state

`dashboardData(profileId)` is the single composition point for appointments, missed doses, digest, nutrition trends, cross-track risk flags, and enriched care-track threads. Risk flags are observational and should keep explicit uncertainty language.

### Key API seams

- `POST /api/documents/ingest`: accepts optional multipart `episodeId`; model assignment remains fallback.
- `PATCH /api/documents/:id/care-track`: caregiver correction of model assignment.
- `POST /api/interventions/:id/doses`: slot-level logging and notification state.
- `POST /api/food`: multimodal meal assessment; no calorie estimate is requested or stored.
- `GET /api/food/:id/image`: profile-scoped local image rendering.
- `POST /api/assistant`: optional `episodeId` puts track context first.
- `POST /api/doctor-brief`: optional `episodeId` produces track prep; null produces whole-profile prep.

## Follow-on work

Push delivery should consume the existing missed-dose `notification` payload rather than recomputing adherence. For hosted use, move local blobs to encrypted object storage and add auth, caregiver permissions, audit logs, consent, retention controls, and timezone preferences. The meal endpoint depends on the configured model accepting OpenAI-compatible image content; keep a capability check if additional providers are introduced.

## Verification

Run `npm run build`, then the server-backed `npm run test:features`. The feature script now checks action, appointment, missed-dose, digest, nutrition, and risk-flag response contracts in addition to the existing corpus assertions.
