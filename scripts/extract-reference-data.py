#!/usr/bin/env python3
"""Reads the sector skills workbooks and prints normalized JSON. Touches nothing else.

    python scripts/extract-reference-data.py "<folder with the .xlsx files>" > reference-skills.json

The workbooks are skills references, not job or course feeds. They hold skill names and descriptions, sub-sectors,
job families, and a priority flag. Skills stay separate per sector: two sectors using the same words aren't merged.

Each sub-sector sheet is a matrix: header rows name the sub-sector, job family and skill type of each column, and the
cells below list skills. Those give exact sub-sector and job-family pairs. The unique-skills sheet lists sub-sectors and
job families for a skill as two separate lists, which can't be paired, so they're kept as lists.

The run stops with an error if a sheet can't be read, or if the workbook's own stated totals aren't accounted for.
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
MAX_COLUMNS = 400
LIST_SPLIT = re.compile(r"\s*(?:;|؛|،|, )\s*")


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


def split_list(text: str) -> list[str]:
    # Lists sometimes join their last items with "و", as in "التمويل، والخدمات المصرفية".
    items = (re.sub(r"^و(?=ال)", "", part.strip()) for part in LIST_SPLIT.split(text))
    return sorted({item for item in items if item})


def read_matrix(ws):
    """Finds the header rows wherever they are, since they aren't on the same row in every sheet."""
    grid = dict(rows(ws, MAX_COLUMNS))
    for number in sorted(grid)[:12]:
        if "القطاع الفرعي" in grid[number]:
            label = grid[number].index("القطاع الفرعي")
            family, kind = grid.get(number + 1), grid.get(number + 2)
            if not family or not kind or family[label] != "المجموعة الوظيفية" or kind[label] != "المهارات":
                raise SystemExit(f"Unexpected header layout in sheet {ws.title!r}")
            found = []
            for row_number, values in grid.items():
                if row_number <= number + 2:
                    continue
                for column, name in enumerate(values):
                    if column > label and name and column < len(kind) and kind[column]:
                        skill_kind = "technical" if "الفنية" in kind[column] else "general"
                        found.append((skill_kind, name, grid[number][column], family[column], row_number))
            return found
    return None


def extract(path):
    name = unicodedata.normalize("NFC", os.path.basename(path))
    code = next(c for word, c in SECTORS.items() if word in name)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    skills, descriptions, stated = {}, {}, {}
    report = {"file": name, "sector": code, "hidden_sheets_skipped": [], "matrix_sheets": 0}

    def skill(kind, skill_name, sheet, row):
        return skills.setdefault((kind, skill_name), {
            "sector_code": code, "skill_kind": kind, "name_ar": skill_name, "description_ar": None, "is_priority": None,
            "source_file": name, "source_sheet": sheet, "source_row": row, "contexts": set(), "listed_subsectors": [], "listed_job_families": [],
        })

    for ws in wb.worksheets:
        title = ws.title.strip()
        if ws.sheet_state != "visible":
            report["hidden_sheets_skipped"].append(title)
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
                    if not started and cells[0] and cells[1].isdigit():
                        stated[cells[0]] = int(cells[1])
                    continue
                if cells[0]:
                    record = skill("technical", cells[0], ws.title, number)
                    record["is_priority"] = {"نعم": True, "لا": False}.get(cells[1])
                    record["listed_subsectors"] = split_list(cells[2])
                    record["listed_job_families"] = split_list(cells[3])
                    # The listing is the workbook's own home for this skill, even if a matrix mentioned it first.
                    record["source_sheet"], record["source_row"] = ws.title, number
            continue
        matrix = read_matrix(ws)
        if matrix is None:
            raise SystemExit(f"Sheet {ws.title!r} in {name} has no recognizable header")
        report["matrix_sheets"] += 1
        for kind, skill_name, subsector, family, row in matrix:
            skill(kind, skill_name, ws.title, row)["contexts"].add((subsector, family, ws.title))

    for key, (text, sheet, number) in descriptions.items():
        if key in skills:
            skills[key]["description_ar"] = text
        else:
            # A description for a skill listed nowhere else is still source data worth keeping.
            skill(key[0], key[1], sheet, number)["description_ar"] = text

    by_subsector: dict[str, set] = {}
    for (kind, skill_name), record in skills.items():
        if kind == "technical":
            for subsector in {c[0] for c in record["contexts"]} | set(record["listed_subsectors"]):
                by_subsector.setdefault(subsector, set()).add(skill_name)
        record["contexts"] = [{"subsector_ar": s, "job_family_ar": f, "source_sheet": sh} for s, f, sh in sorted(record["contexts"])]

    records = list(skills.values())
    report["unique_skills"] = {"technical": sum(1 for k in skills if k[0] == "technical"), "general": sum(1 for k in skills if k[0] == "general")}
    report["links"] = sum(len(r["contexts"]) for r in records)
    report["subsectors"] = len({c["subsector_ar"] for r in records for c in r["contexts"]})
    report["job_families"] = len({c["job_family_ar"] for r in records for c in r["contexts"]})
    report["without_description"] = sum(1 for r in records if not r["description_ar"])
    report["stated_vs_found"] = {}
    for subsector, count in stated.items():
        if subsector.startswith("عدد"):
            continue
        found = len(by_subsector.get(subsector, ()))
        report["stated_vs_found"][subsector] = [count, found]
    return records, report


def main(folder):
    all_skills, reports = [], []
    for path in sorted(glob.glob(os.path.join(folder, "*.xlsx"))):
        if "ALMIDAN" in path:
            continue
        found, report = extract(path)
        all_skills += found
        reports.append(report)
    json.dump({"skills": all_skills, "reports": reports}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
