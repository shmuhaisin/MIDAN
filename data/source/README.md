# Official source data

These files are the authoritative sources for MIDAN's employer registry and sector skills reference. **They aren't in the
repository:** there is no permission to publish them. Get them from the project owner and place them here, under these exact
names. Git ignores them. Keep them exactly as supplied: never edit, re-save or replace them. `SHA256SUMS` lets anyone confirm that.

```bash
cd data/source && sha256sum -c SHA256SUMS
```

| File | What it is |
| --- | --- |
| `ALMIDAN_Employer_Database_10_Entities.xlsx` | The employer registry: 10 entities (ALM-001 to ALM-010). Sheets: Employers, Brand Profiles, Employer Aliases, Sources, a job sheet that isn't read, README. |
| `بيانات القطاعات.zip` | The seven sector skills workbooks, as supplied (the archive also holds macOS `__MACOSX` metadata, which isn't data). |
| `sector-skills/*.xlsx` | The same seven workbooks, extracted byte for byte from the archive, under their original names (one name has a double space, kept as is). |

The seven workbooks: الصناعة التحويلية (manufacturing), السياحة والضيافة (tourism and hospitality), التشييد والأنشطة العقارية
(construction and real estate), الخدمات المالية والتأمين (financial services and insurance), القطاع الرقمي (digital),
الثقافة والترفيه (culture and entertainment), تجارة الجملة والتجزئة (wholesale and retail).

## What the files hold, and don't

- **Employers:** 10 records, all `not_partner`. Four are `verified_official`, six `pending_live_verification`.
- **Brand Profiles:** 10 rows with no logo, colour or font, all `not_verified` and `permission_not_verified`. MIDAN therefore
  shows its neutral identity for every employer.
- **Employer Aliases:** 11 rows; two are marked for manual review (ALM-004 «بوابة الدرعية», ALM-008 «هيئة البحر الأحمر»).
- **Sources:** 10 rows, checked 2026-11-05.
- **The job sheet:** out of scope and not read. Job listings come only from authorized sources, through `--listings`.
- **Sector workbooks:** 5,074 skills (4,917 technical, 157 general) and 39,438 sub-sector and job-family links. No proficiency
  levels, skill identifiers or English names.

## Importing

```bash
node scripts/import-data.mjs --sectors "data/source/بيانات القطاعات.zip" --employers data/source/ALMIDAN_Employer_Database_10_Entities.xlsx
```

The import is an upsert keyed by the workbook's company ID and by sector, kind and exact skill name. Running it again changes
nothing and duplicates nothing. See docs/database/README.md.
