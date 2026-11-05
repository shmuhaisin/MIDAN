#!/usr/bin/env python3
"""Reads the sector skills workbooks and prints normalized JSON. Touches nothing else.

    python scripts/extract-reference-data.py "<folder with the .xlsx files>" > reference-skills.json

The workbooks are skills references, not job or course feeds. They hold skill names and descriptions, sub-sectors,
job families, and a priority flag. Skills stay separate per sector: two sectors using the same words aren't merged.
"""

import glob
import json
import os
import re
import sys
import unicodedata

import openpyxl

SECTORS = {
    "الرقمي": "digital",
    "الثقافة": "culture_entertainment",
    "السياحة": "tourism_hospitality",
    "الصناعة": "manufacturing",
    "التشييد": "construction_real_estate",
    "المالية": "financial_services",
    "الجملة": "wholesale_retail",
}
NOT_SKILL_SHEETS = {"الغلاف", "الفهرس", "المقدمة", "المهارات ذات الأولوية"}
UNIQUE_SHEETS = {"المهارات الفنية الفريدة", "المهارات", "المهارات الفريدة"}
SCALE_WORDS = re.compile(r"مستوى|مستويات|الكفاءة|proficiency|level", re.I)


def clean(value) -> str:
    return "" if value is None else re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value))).strip()


def rows(ws, max_col):
    # Formatting in some sheets runs to a million rows, so stop after a long empty stretch.
    empty = 0
    for number, row in enumerate(ws.iter_rows(max_col=max_col, values_only=True), 1):
        values = [clean(v) for v in row]
        empty = 0 if any(values) else empty + 1
        if empty > 200:
            return
        if any(values):
            yield number, values


def extract(path):
    name = os.path.basename(path)
    code = next(c for word, c in SECTORS.items() if word in name)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    skills, descriptions, report = {}, {}, {"file": name, "sector": code, "scale_mentions": [], "hidden_skipped": []}

    def skill(kind, skill_name, sheet, row):
        return skills.setdefault((kind, skill_name), {
            "sector_code": code, "skill_kind": kind, "name_ar": skill_name, "description_ar": None, "is_priority": None,
            "source_file": name, "source_sheet": sheet, "source_row": row, "contexts": set(),
        })

    for ws in wb.worksheets:
        title = ws.title.strip()
        if ws.sheet_state != "visible":
            report["hidden_skipped"].append(title)
            continue
        if title in NOT_SKILL_SHEETS:
            continue
        if title.startswith("وصف المهارات"):
            kind = "technical" if "الفنية" in title else "general"
            for number, values in rows(ws, 4):
                cells = [v for v in values if v]
                if len(cells) >= 2 and not cells[0].startswith(("المهارات ال", "وصف")):
                    descriptions[(kind, cells[0])] = (cells[1], ws.title, number)
            continue
        if title in UNIQUE_SHEETS:
            started = False
            for number, values in rows(ws, 6):
                cells = values[1:]
                if not started:
                    started = "مهارة ذات أولوية" in cells
                    continue
                if cells[0]:
                    skill("technical", cells[0], ws.title, number)["is_priority"] = {"نعم": True, "لا": False}.get(cells[1])
            continue
        # Otherwise a sub-sector sheet: rows 2 to 4 name the sub-sector, job family and skill type of each column.
        grid = dict(rows(ws, 60))
        if clean((grid.get(2) or ["", ""])[1]) != "القطاع الفرعي":
            continue
        subsector_row, family_row, kind_row = grid[2], grid[3], grid[4]
        for text in family_row + kind_row:
            if SCALE_WORDS.search(text):
                report["scale_mentions"].append([ws.title, text])
        for number, values in grid.items():
            if number < 5:
                continue
            for column, skill_name in enumerate(values):
                if column < 2 or not skill_name or column >= len(kind_row) or not kind_row[column]:
                    continue
                kind = "technical" if "الفنية" in kind_row[column] else "general"
                skill(kind, skill_name, ws.title, number)["contexts"].add((subsector_row[column], family_row[column], ws.title))

    missing_description = 0
    for key, record in skills.items():
        found = descriptions.get(key)
        if found:
            record["description_ar"] = found[0]
        else:
            missing_description += 1
        record["contexts"] = [{"subsector_ar": s, "job_family_ar": f, "source_sheet": sh} for s, f, sh in sorted(record["contexts"])]
    report.update(
        technical=sum(1 for k in skills if k[0] == "technical"), general=sum(1 for k in skills if k[0] == "general"),
        contexts=sum(len(r["contexts"]) for r in skills.values()), without_description=missing_description,
        descriptions_without_skill=sum(1 for k in descriptions if k not in skills),
    )
    # Descriptions for a skill listed nowhere else are still source data worth keeping.
    for key, (text, sheet, number) in descriptions.items():
        if key not in skills:
            skills[key] = {
                "sector_code": code, "skill_kind": key[0], "name_ar": key[1], "description_ar": text, "is_priority": None,
                "source_file": name, "source_sheet": sheet, "source_row": number, "contexts": [],
            }
    return list(skills.values()), report


def main(folder):
    all_skills, reports = [], []
    for path in sorted(glob.glob(os.path.join(folder, "*.xlsx"))):
        found, report = extract(path)
        all_skills += found
        reports.append(report)
    json.dump({"skills": all_skills, "reports": reports}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
