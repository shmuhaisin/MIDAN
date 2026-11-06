# CV and candidate data: where it goes

This describes what the code does. It isn't a legal assessment, and redaction alone doesn't make Midan compliant with PDPL or any other law. A privacy review is still required before real candidates use this.

## The pipeline

Everything up to step 6 runs in the private AI service (`services/ai/midan_ai/cv.py`, `privacy.py`), which only the Core API can reach.

1. **Validate.** The API checks the declared type, the file's first bytes and a 10 MB limit (`apps/api/src/me/me.controller.ts`).
2. **Store privately.** The file goes to the private `candidate-documents` bucket under a random name. The original file name is never kept.
3. **Extract text locally.** `pypdf` for PDFs and direct XML reading for Word, including tables, headers and footers. Document metadata isn't read. Scanned PDFs are rendered with `pypdfium2` and read by a local `tesseract`. If OCR is missing or fails, the pipeline stops and the candidate can fill in the profile by hand.
4. **Set personal fields aside.** Name, email, phone, city and links are taken locally and returned separately. They are never part of an outbound payload.
5. **Redact.** Only allowlisted sections are kept: summary, experience, education, skills, projects, courses, certifications, languages. Contact and references sections are dropped. Each kept section is passed through layered detection: known names in spelling variants, labels, titles, patterns, organization names, and any long run of digits. Arabic-Indic digits are normalized first.
6. **Check again.** `assert_clean` runs the same detectors over the final payload. If anything remains, the request is blocked, nothing is sent, and the analysis is marked `blocked`. There is no fallback to the raw CV.
7. **External AI, if configured.** Only the redacted sections are sent, with no file, link, storage path, account id or request id. The system prompt treats the text as untrusted data, and no tools exist for it to trigger. The response must match a strict schema. Two invalid responses fail the analysis.
8. **Without a provider,** a plain local reading is produced and labeled as such. This is the current state: no AI key is configured.
9. **Candidate review.** Results wait in `cv_analyses`, readable only by the candidate. Nothing reaches the profile until they approve it on the review screen. Existing entries are never replaced, and fields they already filled in start unticked. Approved or dismissed proposals are erased.

## Who receives what

| Recipient | What | When |
| --- | --- | --- |
| Supabase (eu-central-1) | All account, profile, application and assessment data, and files | Always. Our database and storage |
| External AI provider (Gemini or OpenAI, once configured) | Redacted professional sections, and redacted assessment answers | Only after the second check passes |
| Daily.co (once configured) | Room name derived from the interview id, the participant's display name | When someone joins an interview |
| Google Calendar (once configured) | Job and organization name, time, and both attendees' email addresses | When an interview is scheduled or changed |
| Google Sign-In (once enabled) | Standard sign-in exchange | When someone chooses it |

Authentication, calendar and video data aren't forwarded to AI services.

## Assessment answers

`services/ai/midan_ai/evaluation.py` applies the same `redact` and `assert_clean` to written answers before a provider sees them. If a check fails, that criterion goes to the human reviewer with no AI proposal.

## Logs

The API logs an analysis id, its status and a count of removals, never content. The AI service doesn't log CV content, and its errors return a code only. Tests check that removed values don't appear in logs or outbound text.

## Retention

| Data | Kept until |
| --- | --- |
| Current CV | The candidate replaces or removes it |
| Copy attached to an application | The candidate withdraws. It stays after other outcomes, and **no retention period is set yet** |
| Application profile snapshot | Cleared on withdrawal |
| Analysis proposals | Approved or dismissed. A failed analysis stores no proposal |
| Assessment responses and evidence | **No retention period is set yet** |

## Known limits

- **No statistical name recognition.** A stranger's name in free text is caught only if a label, title or references section marks it, or if it's a name we already know. Allowlisting sections reduces this risk but doesn't remove it. A locally run Arabic and English entity model would be the next step.
- **Indirect identification.** A rare job title plus a project description can identify someone even without a name. Organization names are generalized where the patterns recognize them, not everywhere.
- **Arabic OCR** needs the `ara` language pack. English OCR was tested with a real scan. Arabic scans were not.
- **Analysis runs inside the API process** after the response is sent. A restart mid-run leaves it `pending`, and the candidate can retry after two minutes. Production should use a job queue.
- **The external provider's own terms**, including retention and training, need review before a key is configured.

## Still needed before real candidates

Privacy review under PDPL, a data residency decision, retention periods, an erasure process for candidates who have applied, a privacy policy and consent wording reviewed by counsel, and a data processing agreement with each recipient above.
