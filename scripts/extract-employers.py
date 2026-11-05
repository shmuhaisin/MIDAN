#!/usr/bin/env python3
"""Reads the employer registry workbook and prints JSON. Only the identity sheets are read.

    python scripts/extract-employers.py ALMIDAN_Employer_Database_10_Entities.xlsx > employers.json

An entry is an identity record. It doesn't make an organization a partner or give it vacancies on Midan.
Brand fields stay empty because the workbook marks them unverified.
"""

import json
import os
import sys

import openpyxl


def table(wb, name):
    rows = wb[name].iter_rows(values_only=True)
    head = [str(c).strip() if c else None for c in next(rows)]
    return [{h: (None if v is None else str(v).strip()) for h, v in zip(head, row) if h} for row in rows if any(row)]


def main(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    brand = {r["company_id"]: r for r in table(wb, "Brand Profiles")}
    aliases, sources = table(wb, "Employer Aliases"), table(wb, "Sources")
    out = []
    for e in table(wb, "Employers"):
        out.append({
            **e,
            "identity_status": brand.get(e["company_id"], {}).get("identity_status"),
            "usage_permission": brand.get(e["company_id"], {}).get("usage_permission"),
            "source_file": os.path.basename(path),
            "aliases": [a for a in aliases if a["company_id"] == e["company_id"]],
            "sources": [s for s in sources if s["company_id"] == e["company_id"]],
        })
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
