# MIDAN — demo scenarios

How to show MIDAN end to end at **http://localhost:3100**, started with `scripts/dev-all.sh --cloud` (Supabase Cloud) or
`scripts/dev-all.sh` (the local copy). Accounts: see `MIDAN_DEMO_DATA_GUIDE.md`. Everything shown is fictional; the demo
tenants are labelled DEMO and are not the named organizations.

Before presenting: open `/en` and `/ar` once (the first page load compiles nothing in a production build, but the AI service
loads the e5 model on the first match, about 10 s), and check `http://localhost:8000/health` says `"mode":"live"` and
`"matching":"e5-local"`. If Groq's daily quota is used up, the screens say so: assessments come from MIDAN's templates
("Demo mode"), CVs are read by MIDAN's own rules, and scoring leaves criteria for a person. Nothing is presented as AI work.

## 1. Candidate registration
Landing → "Get started" (candidate) → name, email, password → the verification email (cloud: the project's email sender,
which reaches only the project team's addresses unless custom SMTP is set; local: `http://localhost:54321/__mail`) → the
link signs you in → profile basics → save. Sign out, sign in again: the profile is still there.
Expected: the account is a candidate account; organization pages redirect it to its dashboard.

## 2. CV extraction
Profile → CV → upload a fictional PDF or Word CV → "We're reading your CV…" → "Review" → one card per position (title,
organization, years, responsibilities), one per qualification, skills, certifications, projects → edit a value, untick one
item, add a missing position → "Save what I chose" → the profile shows the approved data.
Expected: names are never job titles; wrapped sentences stay whole; the mode line says whether the external analysis
service or MIDAN's own rules read it. Fields the profile already has stay unticked.

## 3. Job creation (employer)
Sign in as a demo employer (or a fresh organization account after its review is approved) → Jobs → New job → title and
description → details (sector, level) → requirements → "Suggest skills with AI" → accept, set required/preferred and levels,
add your own skill → "Generate assessment with AI" → edit, add, remove or reorder a task → approve and publish → publish
the job.
Expected: the approved skills and requirements feed matching and the assessment; a live draft that fails the MIDAN
Assessment Standard can't be approved; template drafts say "Demo mode".

## 4. ATS matching
Candidate: Opportunities → "See demo jobs" (the DEMO tenants' jobs) → open one → apply.
Employer: Candidates → the applicant → "Requirements match".
Expected: per requirement, Shown / Partly shown / Needs review / Not shown, the line used and its similarity; the API's
provenance is `e5-local`, `intfloat/multilingual-e5-base`, no `fallback`.

## 5. Assessment
Candidate: My assessments → start → answer, upload a file → review → submit. Employer: the applicant → the submission.
Expected: answers and files are visible to the organization's staff only; the candidate sees "submitted".

## 6. Evaluation
Employer: the submission → "Prepare proposed scores" → each proposal shows its evidence; criteria without a proposal are
scored by the person → approve → release. Candidate: the application → the released report (no reviewer notes).

## 7. Hiring workflow
Employer: shortlist → schedule an interview (calendar invites only with calendar keys) → record the outcome.
Expected: an interview needs a shortlisted applicant; every status change is recorded; AI never decides.

## 8. Security (what to try)
- As a candidate, open `/en/organization/<any id>`: redirected away. As an employer of tenant A, open tenant B's applicant
  URL: not found.
- Apply twice to the same job: the same application comes back.
- A test organization's job by direct link, signed out: not found.

## 9. Localization and layout
Switch العربية/English (top bar), light/dark/system, and a phone-width window: layouts mirror, nothing overflows.

## 10. Failure recovery
- Groq quota used up: CV → local reading, labelled; assessment → templates, labelled; scoring → left for the person.
- AI service stopped: the screens say the analysis service isn't available; nothing pretends to have run.
- Upload a `.txt` as a CV: refused with a message. Re-click "Apply": no duplicate.
