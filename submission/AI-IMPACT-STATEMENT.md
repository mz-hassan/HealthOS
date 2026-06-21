# AI Impact Statement

Health OS uses AI to turn unstructured health records into a longitudinal, source-linked care graph; group related records into care tracks; assess visible meal composition; answer record-grounded questions; and draft appointment briefs. We use Gemma 4 26B through Neysa’s OpenAI-compatible endpoint because it supports structured extraction, long-context synthesis, and multimodal inputs in one integration. LiteParse performs local document parsing and OCR.

The repository contains only original, fictional, watermarked synthetic records created for testing; no real patient data is included. Runtime uploads remain in local SQLite, while only the minimum parsed context—or the selected meal image—is sent to the configured model provider. Open-source dependencies retain their respective licenses; project code is MIT-licensed.

Guardrails include strict Zod schemas, transactional writes, source-document links, bounded context, database-grounded answers, explicit uncertainty, non-diagnostic language, and escalation guidance for new or worsening symptoms. A reproducible synthetic evaluation checks extraction recall, document classification, episode grouping, causal overclaiming, assistant answers, and doctor briefs. Human review remains required because extraction is probabilistic and the current corpus is limited.

Expected outcomes are less caregiver coordination work, better medication and follow-up visibility, and more focused clinical conversations—without replacing a clinician or making treatment decisions.

**Word count: 192**
