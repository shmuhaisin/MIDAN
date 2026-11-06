#!/usr/bin/env python3
"""Reads the employer registry workbook and prints JSON: records, plus a report of every sheet and every problem found.

    python scripts/extract-employers.py ALMIDAN_Employer_Database_10_Entities.xlsx > employers.json

An entry is an identity record. It doesn't make an organization a partner or give it vacancies on Midan.
Verification of identity (verification_status) and partnership (partnership_status) are separate fields and stay as
the workbook states them. Brand fields are read, but the workbook marks usage permission unverified, so screens use
Midan's neutral identity until permission is established.

The "Jadarat Jobs" sheet is a jobs dataset, not employer data. Its rows (none, today) go to "job_listings", to be
imported by scripts/import-data.mjs as external listings. An empty sheet means no rows were supplied, not that no
jobs exist.
"""

import hashlib
import json
import os
import re
import sys
import unicodedata

import openpyxl

REQUIRED = {"Employers": ["company_id", "name_ar", "name_en", "verification_status", "partnership_status"],
            "Brand Profiles": ["company_id"], "Employer Aliases": ["company_id", "name_variant", "language", "alias_status"],
            "Sources": ["company_id", "source_url", "source_type"], "Jadarat Jobs": [], "README": []}
URL = re.compile(r"^https?://[^\s]+$")


def clean(value):
    return None if value is None else (re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value))).strip() or None)


def table(wb, name, report):
    ws = wb[name]
    rows = ws.iter_rows(values_only=True)
    head = [clean(c) for c in next(rows)]
    missing = [c for c in REQUIRED.get(name, []) if c not in head]
    if missing:
        raise SystemExit(f"Sheet {name!r} is missing columns {missing}")
    out = []
    for number, row in enumerate(rows, 2):
        if not any(v is not None and str(v).strip() for v in row):
            continue
        record = {h: clean(v) for h, v in zip(head, row) if h}
        record["_row"] = number
        record["_raw"] = {h: (None if v is None else str(v)) for h, v in zip(head, row) if h}
        out.append(record)
    report["sheets"].append({"sheet": name, "columns": [h for h in head if h], "rows": len(out)})
    return out


def main(path, display_name=None):
    name = display_name or os.path.basename(path)
    with open(path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    report = {"file": name, "sha256": digest, "sheets": [], "issues": [], "readme": []}

    def issue(kind, sheet, row, value, detail=None):
        report["issues"].append({"kind": kind, "source_file": name, "source_sheet": sheet, "source_row": row, "value": value, "detail": detail})

    unknown = [ws.title for ws in wb.worksheets if ws.title not in REQUIRED]
    for title in unknown:
        report["sheets"].append({"sheet": title, "handling": "not_recognized_not_read"})
        issue("unrecognized_sheet", title, None, title, "not read; review the workbook")

    employers = table(wb, "Employers", report)
    brand = table(wb, "Brand Profiles", report)
    aliases = table(wb, "Employer Aliases", report)
    sources = table(wb, "Sources", report)
    jobs = table(wb, "Jadarat Jobs", report)

    # README rows repeat in the workbook; keep each distinct note once, with its first row.
    seen = set()
    for r in wb["README"].iter_rows(values_only=True):
        cells = tuple(clean(c) for c in r if clean(c))
        if cells and cells not in seen:
            seen.add(cells)
            report["readme"].append(list(cells))
    report["sheets"].append({"sheet": "README", "handling": "notes_kept_in_report", "rows": len(report["readme"])})

    ids = {}
    for e in employers:
        if e.get("company_id") in ids:
            issue("duplicate_company_id", "Employers", e["_row"], e.get("company_id"), f"also at row {ids[e['company_id']]}")
        ids.setdefault(e.get("company_id"), e["_row"])
        for column in ("official_website", "career_url", "verification_source"):
            if e.get(column) and not URL.match(e[column]):
                issue("invalid_url", "Employers", e["_row"], e[column], column)

    brand_by_id = {}
    for b in brand:
        if b.get("company_id") not in ids:
            issue("unknown_company_id", "Brand Profiles", b["_row"], b.get("company_id"), "row rejected")
            continue
        brand_by_id[b["company_id"]] = b
    for sheet, rows in (("Employer Aliases", aliases), ("Sources", sources)):
        for r in rows:
            if r.get("company_id") not in ids:
                issue("unknown_company_id", sheet, r["_row"], r.get("company_id"), "row rejected")
            if sheet == "Sources" and r.get("source_url") and not URL.match(r["source_url"]):
                issue("invalid_url", sheet, r["_row"], r["source_url"], "source_url")

    out = []
    for e in employers:
        b = brand_by_id.get(e["company_id"], {})
        if not b:
            issue("missing_brand_profile", "Employers", e["_row"], e["company_id"], "brand fields left empty")
        out.append({
            **{k: v for k, v in e.items() if not k.startswith("_")},
            "identity_status": b.get("identity_status"),
            "usage_permission": b.get("usage_permission"),
            "brand": {k: b.get(k) for k in ("logo_asset_url", "primary_hex", "secondary_hex", "official_font", "notes")},
            "source_file": name,
            "source_sheet": "Employers",
            "source_row": e["_row"],
            "source_value": e["_raw"],
            "brand_source_row": b.get("_row"),
            "aliases": [{k: v for k, v in a.items() if not k.startswith("_raw")} for a in aliases if a["company_id"] == e["company_id"]],
            "sources": [{k: v for k, v in s.items() if not k.startswith("_raw")} for s in sources if s["company_id"] == e["company_id"]],
        })
    job_listings = [{**{k: v for k, v in j.items() if not k.startswith("_")}, "source_row": j["_row"], "source_value": j["_raw"]} for j in jobs]
    report["job_rows"] = len(job_listings)
    json.dump({"employers": out, "job_listings": job_listings, "report": report}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
