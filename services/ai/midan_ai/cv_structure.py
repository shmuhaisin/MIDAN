"""Turns a CV's extracted text into structure, conservatively. Runs entirely inside this service.

PDF text arrives one visual line at a time: a sentence that wraps becomes two lines, and bullet glyphs are often missing.
This module rebuilds logical lines first (wrapped sentences joined, bullets kept as their own items), then reads each
section with rules that prefer leaving a field empty for the candidate to fill over guessing:

- a position is a header (title, organization, dates) with the responsibilities under it, never one entry per line;
- a person's name is only a short line of name-like words, never a line with job-title words in it;
- a skill is a short item from the skills section, never a sentence;
- dates are only what the text states.
"""

import re
import unicodedata
from dataclasses import dataclass, field

# --- Text normalization

# pypdf maps Arabic presentation forms to these Persian code points after NFKC.
_ARABIC_VARIANTS = str.maketrans({"ی": "ي", "ک": "ك", "ھ": "ه", "ە": "ه", "ﻻ": "لا"})
_AR = "؀-ۿ"


def normalize_text(text: str) -> str:
    """Standard Arabic letters instead of presentation forms, and a space where a word runs into a number or a Latin word."""
    text = unicodedata.normalize("NFKC", text).translate(_ARABIC_VARIANTS)
    text = re.sub(rf"([{_AR}])(?=[0-9A-Za-z])", r"\1 ", text)
    text = re.sub(rf"([0-9A-Za-z])(?=[{_AR}])", r"\1 ", text)
    return text


# --- Logical lines

_BULLET = re.compile(r"^\s*(?:[•●▪◦‣∙·■□➢➤►✓✔*]|[-–—](?=\s)|\(?\d{1,2}[.)](?=\s))\s*")
_TERMINAL = re.compile(r"[.!?؟:;؛]\s*$")
_JOINERS = {"and", "or", "of", "the", "to", "for", "with", "in", "on", "at", "by", "a", "an", "&", "و", "في", "من", "على", "إلى", "الى", "عن", "مع"}


@dataclass
class Line:
    text: str
    bullet: bool = False


def _starts_lower(text: str) -> bool:
    first = next((c for c in text if c.isalpha()), "")
    return bool(first) and first.isascii() and first.islower()


def line_width(lines: list[str]) -> int:
    """The usual length of a full line in this document: wrapped lines come close to it."""
    lengths = sorted(len(line) for line in lines if len(line) > 20)
    # Too few lines to tell a full line from a short one: only the other joining rules apply.
    return lengths[int(len(lengths) * 0.9) - 1] if len(lengths) >= 8 else 0


def logical_lines(raw: list[str], width: int, wrapped: bool) -> list[Line]:
    """Joins a sentence that a PDF wrapped onto several lines; keeps each bullet a separate item.

    `wrapped` is False for Word documents, where every paragraph is already one logical line."""
    out: list[Line] = []
    pending_bullet = False
    for original in raw:
        text = original.strip()
        if not text:
            continue
        bullet_match = _BULLET.match(text)
        if bullet_match:
            text = text[bullet_match.end():].strip()
            if not text:
                pending_bullet = True  # A glyph on its own line: the item is on the next one.
                continue
        is_bullet = bool(bullet_match) or pending_bullet
        pending_bullet = False
        if out and not is_bullet and wrapped and _continues(out[-1].text, text, width):
            prev = out[-1].text
            # "month-" + "end" is "month-end": the hyphen stays, without a space.
            out[-1].text = prev + text if re.search(r"[A-Za-z]-$", prev) and _starts_lower(text) else f"{prev} {text}"
            continue
        out.append(Line(text, is_bullet))
    return out


def _continues(prev: str, text: str, width: int) -> bool:
    if _TERMINAL.search(prev) or find_dates(text).years or _header_shape(text):
        return False
    if _header_shape(prev) or find_dates(prev).years or (len(prev.split()) <= 8 and _title_case(prev)):
        # A position's header, or a title line, doesn't run into the line below it unless that line starts mid-sentence.
        return _starts_lower(text)
    last_word = prev.split()[-1].lower() if prev.split() else ""
    if prev.endswith((",", "،", "-", "/")) or last_word in _JOINERS:
        return True
    if _starts_lower(text):
        return True
    return bool(width) and len(prev) >= 0.72 * width


# --- Dates

_MONTHS = (r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
           r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|إبريل|مايو|يونيو|يوليو|أغسطس|اغسطس|"
           r"سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|كانون الثاني|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين الأول|"
           r"تشرين الثاني|كانون الأول")
_YEAR = re.compile(r"(?<!\d)(19[5-9]\d|20\d\d)(?!\d)")
_PRESENT = re.compile(r"\b(?:present|current(?:ly)?|now|to date|today|ongoing)\b|حتى الآن|حتى تاريخه|الآن|حاليا|حاليًا|حالياً|الحالي|حتى اليوم", re.I)
_DATE_SPAN = re.compile(
    rf"(?:(?:\b(?:{_MONTHS})\.?|\d{{1,2}}\s*[/.\-])\s*)?(?:19[5-9]\d|20\d\d)"
    rf"(?:\s*(?:-|–|—|to|until|till|إلى|الى|حتى|~)\s*(?:(?:\b(?:{_MONTHS})\.?|\d{{1,2}}\s*[/.\-])\s*)?(?:19[5-9]\d|20\d\d))?"
    rf"|(?:\s*(?:-|–|—|to|until|إلى|الى|~)\s*)?(?:{_PRESENT.pattern})", re.I)


@dataclass
class Dates:
    years: list[int] = field(default_factory=list)
    current: bool = False

    @property
    def start(self) -> int | None:
        return min(self.years) if self.years else None

    @property
    def end(self) -> int | None:
        if self.current or len(self.years) < 2:
            return None
        return max(self.years)


def find_dates(text: str) -> Dates:
    years = [int(y) for y in _YEAR.findall(text)]
    return Dates(years=years, current=bool(years) and bool(_PRESENT.search(text)))


def strip_dates(text: str) -> str:
    return re.sub(r"\s{2,}", " ", _DATE_SPAN.sub(" ", text)).strip(" ,،-–—|()")


# --- Vocabulary

_TITLE_WORDS = {
    "specialist", "manager", "analyst", "engineer", "officer", "developer", "consultant", "director", "accountant",
    "executive", "associate", "coordinator", "assistant", "lead", "head", "intern", "administrator", "designer", "scientist",
    "representative", "supervisor", "auditor", "advisor", "adviser", "architect", "technician", "teacher", "lecturer",
    "researcher", "senior", "junior", "chief", "principal", "trainee", "agent", "clerk", "controller", "planner", "programmer",
    "banking", "credit", "risk", "finance", "financial", "marketing", "sales", "operations", "human", "resources", "hr",
    "data", "software", "project", "product", "business", "customer", "service", "corporate", "treasury", "compliance",
    "محلل", "محللة", "مهندس", "مهندسة", "مدير", "مديرة", "أخصائي", "أخصائية", "اخصائي", "اخصائية", "مطور", "مطورة", "مستشار",
    "مستشارة", "مشرف", "مشرفة", "محاسب", "محاسبة", "منسق", "منسقة", "مساعد", "مساعدة", "رئيس", "رئيسة", "مسؤول", "مسؤولة",
    "موظف", "موظفة", "مصمم", "مصممة", "فني", "فنية", "معلم", "معلمة", "باحث", "باحثة", "تنفيذي", "خبير", "خبيرة", "مراجع",
    "مدقق", "ممثل", "ممثلة", "أول", "متدرب", "متدربة", "موارد", "بشرية", "بيانات", "مبيعات", "تسويق", "مالي", "مالية",
}
_PLACES = {
    "riyadh", "jeddah", "jedda", "dammam", "khobar", "dhahran", "mecca", "makkah", "medina", "madinah", "taif", "tabuk",
    "abha", "qassim", "buraidah", "jubail", "yanbu", "hail", "saudi", "arabia", "ksa", "remote", "dubai", "uae", "bahrain",
    "kuwait", "qatar", "doha", "cairo", "الرياض", "جدة", "الدمام", "الخبر", "الظهران", "مكة", "المدينة", "الطائف", "تبوك",
    "أبها", "القصيم", "بريدة", "الجبيل", "ينبع", "حائل", "السعودية", "المملكة", "العربية", "دبي", "الإمارات", "البحرين",
    "الكويت", "قطر", "الدوحة", "القاهرة",
}
_SECTION_WORDS = {"curriculum", "vitae", "resume", "résumé", "cv", "profile", "السيرة", "الذاتية", "سيرة", "ذاتية"}
_ORG_WORDS = re.compile(r"\b(?:company|co\.|bank|group|ltd\.?|limited|inc\.?|llc|corp\.?|corporation|holding|university|college|"
                        r"institute|school|academy|ministry|authority|agency|solutions|analytics|house|partners|consulting)\b|"
                        r"شركة|بنك|مصرف|مؤسسة|مجموعة|هيئة|وزارة|جامعة|كلية|معهد|أكاديمية|مركز", re.I)
_DEGREE = re.compile(r"\b(?:bachelor'?s?|b\.?\s?sc\.?|bsc|b\.?\s?a\.?|b\.?\s?eng|b\.?\s?com|master'?s?|m\.?\s?sc\.?|msc|m\.?\s?a\.?|mba|emba|"
                     r"ph\.?\s?d\.?|doctorate|diploma|associate degree|high school|secondary school)\b|"
                     r"بكالوريوس|بكالوريس|ماجستير|ماجيستير|دكتوراه|دكتوراة|دبلوم|الثانوية|ثانوية|زمالة", re.I)
_INSTITUTION = re.compile(r"\b(?:university|college|institute|school|academy|polytechnic)\b|جامعة|كلية|معهد|أكاديمية|مدرسة", re.I)
_SEPARATORS = re.compile(r"\s+[—–|@]\s+|\s+-\s+|\s+at\s+|\s+لدى\s+|\s*\|\s*")
_HAS_LETTER = re.compile(rf"[A-Za-z{_AR}]")


def _words(text: str) -> list[str]:
    return re.findall(rf"[A-Za-z{_AR}][\w'’\-{_AR}]*", text)


def has_title_word(text: str) -> bool:
    return any(w.lower().strip("'’-") in _TITLE_WORDS for w in _words(text))


def looks_like_name(line: str) -> bool:
    """Two to five name-like words: no digits, contact details, separators, job-title, place or section words."""
    line = line.strip()
    if not line or re.search(r"[\d@|&/:,،;()+]", line) or len(line) > 60:
        return False
    tokens = line.split()
    if not 2 <= len(tokens) <= 5:
        return False
    for token in tokens:
        bare = token.strip("'’.-")
        if not bare or not re.fullmatch(rf"[A-Za-z{_AR}][A-Za-z{_AR}'’\-]*", bare):
            return False
        low = bare.lower()
        if low in _TITLE_WORDS or low in _PLACES or low in _SECTION_WORDS:
            return False
        if bare[0].isascii() and not bare[0].isupper():
            return False
    return True


def _header_shape(text: str) -> bool:
    """A line laid out like a position's header: title and organization separated, or a title with dates."""
    if len(text.split()) > 16 or _TERMINAL.search(text):
        return False
    return bool(_SEPARATORS.search(text) and has_title_word(text)) or bool(find_dates(text).years and has_title_word(text))


def _sentence(text: str) -> bool:
    words = text.split()
    return len(words) > 14 or (len(words) > 6 and bool(re.search(r"[.!؟?]\s*$", text)))


def _title_case(text: str) -> bool:
    latin = [w for w in _words(text) if w[0].isascii() and len(w) > 3]
    if not latin:
        return False
    return sum(w[0].isupper() for w in latin) / len(latin) >= 0.6


def valid_title(text: str | None) -> bool:
    if not text or not _HAS_LETTER.search(text):
        return False
    words = text.split()
    if not 1 <= len(words) <= 12 or len(text) > 150 or _starts_lower(text) or re.search(r"[.!?؟]\s*$", text):
        return False
    # A single generic word ("documentation", "requirements") is a fragment, not a position.
    return len(words) > 1 or has_title_word(text)


# --- Sections

def _split_parts(text: str) -> list[str]:
    parts = [p.strip(" ,،-–—|") for p in _SEPARATORS.split(text)]
    parts = [p for p in parts if p and _HAS_LETTER.search(p)]
    if len(parts) == 1 and re.search(r"[,،]", text):
        # "Data Engineer, Gulf Analytics": a comma separates only when both sides are short.
        left, right = (s.strip(" ,،") for s in re.split(r"[,،]", text, maxsplit=1))
        if left and right and len(left.split()) <= 6 and len(right.split()) <= 7 and (_ORG_WORDS.search(right) or _title_case(right)):
            parts = [left, right]
    return [p for p in parts if not all(w.lower() in _PLACES for w in _words(p))]


def parse_experience(lines: list[Line]) -> tuple[list[dict], bool]:
    """One entry per position: its header lines give title, organization and dates; what follows is its responsibilities.
    Returns the entries and whether something was left out because it couldn't be placed."""
    entries: list[dict] = []
    current: dict | None = None
    left_out = False
    for line in lines:
        text = line.text
        dates = find_dates(text)
        header = not line.bullet and (
            _header_shape(text)
            or (not _sentence(text) and len(text.split()) <= 8 and not _TERMINAL.search(text) and (_title_case(text) or has_title_word(text))
                and (current is None or current["body"]))
            or (dates.years and len(strip_dates(text).split()) == 0)  # a dates-only line belongs to the header
        )
        if header:
            starts_new = current is None or current["body"] or (dates.years and current["dates"].years) or len(current["head"]) >= 3
            if starts_new and strip_dates(text):
                current = {"head": [], "dates": Dates(), "body": []}
                entries.append(current)
            elif current is None:
                current = {"head": [], "dates": Dates(), "body": []}
                entries.append(current)
            if strip_dates(text):
                current["head"].append(strip_dates(text))
            if dates.years:
                current["dates"] = dates
        elif current is not None:
            current["body"].append(text)
        else:
            left_out = True  # Text before any position can't be attached to one.
    result = []
    for entry in entries:
        parts = [p for head in entry["head"] for p in _split_parts(head)]
        if len(parts) >= 2 and _ORG_WORDS.search(parts[0]) and not _ORG_WORDS.search(parts[1]) and has_title_word(parts[1]):
            parts[0], parts[1] = parts[1], parts[0]
        title = parts[0] if parts else None
        organization = parts[1] if len(parts) > 1 else None
        if not valid_title(title):
            left_out = True
            continue
        body = [b for b in entry["body"] if _HAS_LETTER.search(b)]
        result.append({
            "title": title[:200],
            "organization": organization[:200] if organization and valid_title(organization) else None,
            "start_year": entry["dates"].start,
            "end_year": entry["dates"].end,
            "current": entry["dates"].current,
            "responsibilities": [b[:600] for b in body][:15],
            "description": "\n".join(body)[:2000] or None,
        })
    return result[:30], left_out


def parse_education(lines: list[Line]) -> tuple[list[dict], bool]:
    entries: list[dict] = []
    left_out = False
    for line in lines:
        text = line.text
        dates = find_dates(text)
        bare = strip_dates(text)
        if _DEGREE.search(bare):
            parts = _split_parts(bare) or [bare]
            degree = next((p for p in parts if _DEGREE.search(p)), parts[0])
            institution = next((p for p in parts if p is not degree and _INSTITUTION.search(p)), None)
            qualification, subject = _degree_and_field(degree)
            entries.append({"qualification": qualification[:200], "field": subject, "institution": institution[:200] if institution else None,
                            "start_year": dates.start if len(dates.years) > 1 else None, "end_year": max(dates.years) if dates.years else None})
        elif entries and _INSTITUTION.search(bare) and not entries[-1]["institution"]:
            entries[-1]["institution"] = (_split_parts(bare) or [bare])[0][:200]
            if dates.years and not entries[-1]["end_year"]:
                entries[-1]["end_year"] = max(dates.years)
        elif entries and dates.years and not bare and not entries[-1]["end_year"]:
            entries[-1]["end_year"] = max(dates.years)
        elif bare and not re.search(r"\b(?:gpa|grade|honou?rs?)\b|المعدل|بتقدير", bare, re.I):
            left_out = True
    return entries[:20], left_out


def _degree_and_field(degree: str) -> tuple[str, str | None]:
    match = re.match(r"(.+?)\s+in\s+(.+)$", degree, re.I) or re.match(r"(.+?)\s+(?:في|تخصص)\s+(.+)$", degree)
    if match:
        return match.group(1).strip(), match.group(2).strip()[:200]
    # "BSc Computer Science", "بكالوريوس إدارة أعمال": the degree word, then the subject.
    match = re.match(r"((?:b\.?\s?sc\.?|bsc|m\.?\s?sc\.?|msc|mba|b\.?\s?a\.?|m\.?\s?a\.?|ph\.?\s?d\.?|بكالوريوس|بكالوريس|ماجستير|ماجيستير|دكتوراه|دكتوراة|دبلوم))\s+(.+)$", degree, re.I)
    if match and not re.match(r"(?:of|in)\b", match.group(2), re.I):
        return match.group(1).strip(), match.group(2).strip()[:200]
    return degree.strip(), None


_SKILL_SPLIT = re.compile(r"\s*[,،;؛|•·]\s*|\s+-\s+")


def parse_skills(lines: list[Line]) -> list[str]:
    seen: dict[str, str] = {}
    for line in lines:
        text = line.text
        label = re.match(r"^([^:：]{2,40})[:：]\s*(.+)$", text)
        if label and len(label.group(1).split()) <= 4:
            text = label.group(2)
        items = _SKILL_SPLIT.split(text)
        if len(items) == 1 and _sentence(text):
            continue  # A sentence about skills isn't a skill.
        for item in items:
            item = re.sub(r"\s+", " ", item).strip(" .-–—*")
            if not item or not _HAS_LETTER.search(item) or len(item) > 50 or len(item.split()) > 5 or _TERMINAL.search(item):
                continue
            seen.setdefault(item.casefold(), item)
    return list(seen.values())[:100]


def parse_titled(lines: list[Line], grouped: bool = False) -> list[dict]:
    """Certifications and courses: one item per logical line. Projects (grouped): a short title line and its description."""
    items: list[dict] = []
    for line in lines:
        text = line.text.strip()
        if not _HAS_LETTER.search(text):
            continue
        is_title = not line.bullet and not _sentence(text) and len(text.split()) <= 10 and not _TERMINAL.search(text)
        if grouped and items and not is_title:
            items[-1]["description"] = f"{items[-1]['description']}\n{text}" if items[-1]["description"] else text
            continue
        if grouped and not is_title and not items:
            items.append({"title": text[:300], "description": None})
            continue
        items.append({"title": text[:300], "description": None})
    for item in items:
        if item["description"]:
            item["description"] = item["description"][:2000]
    return items


def parse_languages(lines: list[Line]) -> list[dict]:
    out: list[dict] = []
    for line in lines:
        for part in re.split(r"\s*[,،;؛]\s*", line.text):
            match = re.match(rf"^\s*([A-Za-z{_AR}][A-Za-z{_AR} ]{{1,30}}?)\s*(?:[(:：–—-]\s*([^)]{{1,40}})\)?)?\s*$", part)
            if match and len(match.group(1).split()) <= 3:
                out.append({"name": match.group(1).strip(), "level": (match.group(2) or "").strip() or None})
    return out[:20]


def top_fields(lines: list[str]) -> dict[str, str | None]:
    """Name, headline and city from the lines above the first heading. Anything unclear stays empty."""
    name = headline = city = None
    for raw in lines[:8]:
        line = raw.strip()
        if not line:
            continue
        parts = [p.strip() for p in re.split(r"\s*[|•·]\s*", line) if p.strip()]
        for part in parts:
            if not city and _words(part) and all(w.lower() in _PLACES for w in _words(part)):
                city = part.split(",")[0].split("،")[0].strip()[:100]
        contact = bool(re.search(r"@|\+?\d[\d\s\-]{6,}|https?://|www\.", line))
        if not name and looks_like_name(line):
            name = line[:200]
            continue
        if not headline and not contact and has_title_word(line) and len(line.split()) <= 12 and not _TERMINAL.search(line):
            headline = line[:200]
    return {"full_name": name, "headline": headline, "city": city}
