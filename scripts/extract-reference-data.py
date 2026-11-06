#!/usr/bin/env python3
"""Reads the sector skills workbooks and prints normalized JSON. Touches nothing else.

    python scripts/extract-reference-data.py "<folder with the .xlsx files>" > reference-skills.json

The workbooks are skills references, not job or course feeds. They hold skill names and descriptions, sub-sectors,
job families, and a priority flag. Skills stay separate per sector: two sectors using the same words aren't merged.

Each sub-sector sheet is a matrix: header rows name the sub-sector, job family and skill type of each column, and the
cells below list skills. Those give exact sub-sector and job-family pairs. The unique-skills sheet lists sub-sectors and
job families for a skill as two separate lists, which can't be paired, so they're kept as lists.

The run stops with an error if a sheet can't be read. Everything else that looks wrong is reported, not fixed:
every sheet is listed with how it was handled, and "issues" records duplicates, descriptions for skills listed
nowhere else, priority lists that disagree with the priority flag, and stated totals that differ from what was found.
Each skill keeps its raw cell text ("source_value") next to the cleaned name, and its workbook, sheet and row.
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
INFORMATIONAL_SHEETS = {"الغلاف", "الفهرس", "المقدمة"}
PRIORITY_SHEET = "المهارات ذات الأولوية"
UNIQUE_SHEETS = {"المهارات الفنية الفريدة", "المهارات", "المهارات الفريدة"}
MAX_COLUMNS = 400
LIST_SPLIT = re.compile(r"\s*(?:;|؛|،|, )\s*")


def clean(value) -> str:
    return "" if value is None else re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(value))).strip()


RAW: dict = {}


def rows(ws, max_col):
    # Formatting in some sheets runs to a million rows, so stop after a long empty stretch.
    empty = 0
    for number, row in enumerate(ws.iter_rows(max_col=max_col, values_only=True), 1):
        values = [clean(v) for v in row]
        empty = 0 if any(values) else empty + 1
        if empty > 200:
            return
        if any(values):
            # The raw text of each cell, before whitespace and Unicode cleanup, kept for lineage.
            for column, (value, raw) in enumerate(zip(values, row)):
                if value:
                    RAW[(ws.title, number, value)] = str(raw)
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
    report = {"file": name, "sector": code, "hidden_sheets_skipped": [], "matrix_sheets": 0, "sheets": [], "issues": []}
    priority = {"stated_total": None, "stated_by_subsector": {}, "listed": []}

    def issue(kind, sheet, row, value, detail=None):
        report["issues"].append({"kind": kind, "source_file": name, "source_sheet": sheet, "source_row": row, "value": value, "detail": detail})

    def skill(kind, skill_name, sheet, row):
        return skills.setdefault((kind, skill_name), {
            "sector_code": code, "skill_kind": kind, "name_ar": skill_name, "description_ar": None, "is_priority": None, "priority_listed": False,
            "source_file": name, "source_sheet": sheet, "source_row": row, "source_value": RAW.get((sheet, row, skill_name), skill_name),
            "contexts": set(), "listed_subsectors": [], "listed_job_families": [],
        })

    for ws in wb.worksheets:
        title = ws.title.strip()
        entry = {"sheet": ws.title, "state": ws.sheet_state}
        report["sheets"].append(entry)
        if ws.sheet_state != "visible":
            report["hidden_sheets_skipped"].append(title)
            entry["handling"] = "hidden_not_read"
            continue
        if title in INFORMATIONAL_SHEETS:
            entry["handling"] = "informational_not_imported"
            entry["rows"] = sum(1 for _ in rows(ws, 6))
            continue
        if title == PRIORITY_SHEET:
            # A summary block (stated counts), then a list: skill, sub-sectors, job families.
            entry["handling"] = "priority_list_cross_checked"
            listing = False
            for number, values in rows(ws, 6):
                cells = [v for v in values if v]
                if not cells:
                    continue
                if cells[0].startswith("المهارات الفريدة") and len(cells) >= 2:
                    listing = True
                    continue
                if listing:
                    priority["listed"].append((cells[0], number))
                elif len(cells) >= 2 and cells[1].isdigit():
                    if cells[0].startswith("عدد") and "الأولوية" in cells[0] or "الفريدة" in cells[0] and cells[0].startswith("عدد"):
                        priority["stated_total"] = int(cells[1])
                    elif not cells[0].startswith("عدد"):
                        priority["stated_by_subsector"][cells[0]] = int(cells[1])
            entry["rows"] = len(priority["listed"])
            continue
        if title.startswith("وصف المهارات"):
            entry["handling"] = "descriptions"
            kind = "technical" if "الفنية" in title else "general"
            for number, values in rows(ws, 4):
                cells = [v for v in values if v]
                if len(cells) >= 2 and not cells[0].startswith(("المهارات ال", "وصف")):
                    if (kind, cells[0]) in descriptions and descriptions[(kind, cells[0])][0] != cells[1]:
                        issue("conflicting_description", ws.title, number, cells[0], f"also described at row {descriptions[(kind, cells[0])][2]}; the later one is kept")
                    descriptions[(kind, cells[0])] = (cells[1], ws.title, number)
            entry["rows"] = sum(1 for k in descriptions if k[0] == kind)
            continue
        if title in UNIQUE_SHEETS:
            entry["handling"] = "unique_skill_list"
            listed_here: dict = {}
            started = False
            for number, values in rows(ws, 6):
                cells = values[1:]
                if not started:
                    started = "مهارة ذات أولوية" in cells
                    if not started and cells[0] and cells[1].isdigit():
                        stated[cells[0]] = int(cells[1])
                    continue
                if cells[0]:
                    if cells[0] in listed_here:
                        issue("duplicate_row", ws.title, number, cells[0], f"same skill as row {listed_here[cells[0]]}; one record kept")
                    listed_here.setdefault(cells[0], number)
                    record = skill("technical", cells[0], ws.title, number)
                    record["source_value"] = RAW.get((ws.title, number, cells[0]), cells[0])
                    record["is_priority"] = {"نعم": True, "لا": False}.get(cells[1])
                    record["listed_subsectors"] = split_list(cells[2])
                    record["listed_job_families"] = split_list(cells[3])
                    # The listing is the workbook's own home for this skill, even if a matrix mentioned it first.
                    record["source_sheet"], record["source_row"] = ws.title, number
            entry["rows"] = len(listed_here)
            continue
        matrix = read_matrix(ws)
        if matrix is None:
            raise SystemExit(f"Sheet {ws.title!r} in {name} has no recognizable header")
        report["matrix_sheets"] += 1
        entry["handling"] = "subsector_matrix"
        entry["rows"] = len(matrix)
        for kind, skill_name, subsector, family, row in matrix:
            skill(kind, skill_name, ws.title, row)["contexts"].add((subsector, family, ws.title))

    for key, (text, sheet, number) in descriptions.items():
        if key in skills:
            skills[key]["description_ar"] = text
        else:
            # A description for a skill listed nowhere else is still source data worth keeping.
            skill(key[0], key[1], sheet, number)["description_ar"] = text
            issue("description_without_listing", sheet, number, key[1], "kept as its own record")

    for skill_name, number in priority["listed"]:
        record = skills.get(("technical", skill_name))
        if record is None:
            issue("priority_skill_not_in_skill_list", PRIORITY_SHEET, number, skill_name, "kept as its own record, from the priority list")
            record = skill("technical", skill_name, PRIORITY_SHEET, number)
            record["is_priority"] = True
        elif record["is_priority"] is False:
            issue("priority_flag_disagrees", PRIORITY_SHEET, number, skill_name, "on the priority list, but its row in the skill list says no; both kept as stated")
        record["priority_listed"] = True
    listed_names = {n for n, _ in priority["listed"]}
    for (kind, skill_name), record in skills.items():
        if kind == "technical" and record["is_priority"] and skill_name not in listed_names:
            issue("priority_flag_not_on_priority_list", record["source_sheet"], record["source_row"], skill_name,
                  "the skill list marks it a priority, the priority list doesn't include it; kept as stated")
    report["priority"] = {
        "stated_total": priority["stated_total"],
        "listed": len(priority["listed"]),
        "flagged_in_skill_list": sum(1 for r in skills.values() if r["is_priority"]),
        "stated_by_subsector": priority["stated_by_subsector"],
    }
    if priority["stated_total"] is not None and priority["stated_total"] != len(priority["listed"]):
        issue("stated_count_mismatch", PRIORITY_SHEET, None, "priority skills", f"states {priority['stated_total']}, lists {len(priority['listed'])}")

    unique_titles = {ws.title for ws in wb.worksheets if ws.title.strip() in UNIQUE_SHEETS}
    for (kind, skill_name), record in skills.items():
        if kind == "technical" and record["source_sheet"] not in unique_titles and record["source_sheet"] != PRIORITY_SHEET and record["contexts"]:
            issue("matrix_only_skill", record["source_sheet"], record["source_row"], skill_name,
                  "appears in a sub-sector sheet but not in the skill list; often a spelling variant. Kept as written, not merged")

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
        if found != count:
            issue("stated_count_mismatch", None, None, subsector, f"workbook states {count} technical skills, {found} found")
    return records, report


def sha256(path):
    import hashlib
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main(folder):
    all_skills, reports = [], []
    paths = sorted(glob.glob(os.path.join(folder, "**", "*.xlsx"), recursive=True))
    # macOS archives carry "._" resource-fork files that aren't workbooks.
    paths = [p for p in paths if not os.path.basename(p).startswith("._") and "__MACOSX" not in p and "ALMIDAN" not in p]
    if not paths:
        raise SystemExit(f"No sector workbooks found in {folder}")
    for path in paths:
        found, report = extract(path)
        report["sha256"] = sha256(path)
        all_skills += found
        reports.append(report)
    json.dump({"skills": all_skills, "reports": reports}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
