# Health OS — 3-minute live demo

## Setup before judging

```bash
npm install
npm run dev
npm run demo:care
```

Keep the caregiver and elder URLs printed by `demo:care` open in separate tabs. Keep `submission/Health-OS-Pitch-Deck.pdf` and the README open as fallbacks.

## Script

**0:00–0:25 — Problem and promise**  
“My parent’s health history is not one record—it is a pile of lab PDFs, prescriptions, messages, and memories. Health OS turns that pile into one shared health memory, with a simple experience for the older adult and a richer one for the caregiver.”

**0:25–1:05 — Upload becomes action**  
In the caregiver view, open Documents or upload a synthetic record. Show that the record is classified, linked to a care track, and converted into biomarkers, medicines, appointments, and actions. Open its source preview.  
“The model can suggest structure, but malformed output is rejected by schemas and every fact remains linked to its source.”

**1:05–1:40 — Longitudinal caregiver context**  
Show the caregiver digest, an abnormal marker, a care track, and any missed-dose or follow-up card.  
“Instead of another file archive, the caregiver sees what changed and what may need attention. Cross-track patterns are observational, never diagnoses.”

**1:40–2:10 — Elder experience**  
Switch to the elder tab. Open medicines and log a scheduled dose; show the next appointment and chat tile.  
“This is the same underlying record, but with fewer choices and a calmer daily workflow.”

**2:10–2:40 — Grounded AI and doctor prep**  
Return to caregiver view. Ask a care-track question or generate doctor prep; show linked documents.  
“The answer is rebuilt from structured SQLite facts each time. It distinguishes association from causation and prepares questions, not treatment decisions.”

**2:40–3:00 — Proof and close**  
“Our synthetic evaluation ingested nine varied documents and recovered 72 of 72 expected measurements on that controlled set. Health OS makes family care more coherent: one memory, the right interface, and a human still in charge.”

## If the model or network fails

Use the pre-populated demo profile, open the committed evaluation report, and show the stored dashboard flow. Do not retry API calls on stage.

## Likely Q&A

**Is this a medical device?** No. It is a coordination and information-retrieval prototype. It does not diagnose, prescribe, or replace clinical review.

**How do you prevent hallucinations?** Schema validation, source links, database-grounded context, constrained prompts, explicit uncertainty, and a human-review requirement.

**Who pays?** Start with adult children coordinating care for a parent; expand through senior-living and home-health partners that need a shared family-facing record.

**What is the moat?** The longitudinal, corrected care graph and linked workflow—not a generic chat UI. Every new record improves the shared context while retaining provenance.

**What must happen before hosting?** Authentication, tenant isolation, encryption and key management, audit/consent/retention controls, malware scanning, broader evaluation, and formal privacy/clinical review.
