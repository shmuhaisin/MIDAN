"""Finds and removes personal data before any text can leave Midan. Runs entirely inside this service.

There are two passes on purpose. `redact` cleans text as it's prepared. `assert_clean` then checks the final outbound
payload with the same detectors, and blocks the request if anything is still there. Neither pass logs what it found:
only counts leave this module.

Known limit: there's no statistical name recognizer, so a stranger's name in free text is only caught when something
marks it as a name (a label, a title, a references section) or when it's a name we already know. That's why outbound
payloads are limited to a short allowlist of professional sections.
"""

import re
from collections import Counter
from collections.abc import Iterable
from typing import Any

PLACEHOLDER = "[REDACTED]"
ORGANIZATION = "[ORGANIZATION]"

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_ARABIC_LETTER = "ء-يٮ-ۓ"
_LABEL_END = r"\s*[:：\-–]\s*"

# Order matters: longer, more specific patterns run first, so a phone number isn't half-eaten by something else.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("email", re.compile(r"[\w.+\-]+\s?@\s?[\w\-]+(?:\.[\w\-]+)+", re.UNICODE)),
    ("link", re.compile(r"(?:https?://|ftp://|www\.)\S+", re.I)),
    ("link", re.compile(r"\b(?:linkedin|github|gitlab|behance|dribbble|twitter|x|facebook|instagram|t|wa)\.(?:com|me|in|sa)(?:/\S*)?", re.I)),
    ("link", re.compile(r"\b[\w\-]+(?:\.[\w\-]+)*\.(?:com|net|org|io|dev|me|sa|ai|co)(?:/\S*)?\b", re.I)),
    ("iban", re.compile(r"\b[A-Z]{2}\d{2}(?:[ \-]?[A-Z0-9]{2,4}){3,8}\b")),
    ("phone", re.compile(r"(?:\+|00)\s?\d{1,3}(?:[\s\-().]*\d){6,13}")),
    ("phone", re.compile(r"\(?\b05\d\)?(?:[\s\-.]*\d){7}\b")),
    ("phone", re.compile(r"\b5\d(?:[\s\-.]*\d){7}\b")),
    ("phone", re.compile(r"\(?\b01\d\)?(?:[\s\-.]*\d){6,7}\b")),
    ("national_id", re.compile(r"\b[12]\d{9}\b")),
    ("card_number", re.compile(r"\b\d(?:[ \-]?\d){12,18}\b")),
    ("passport", re.compile(r"\b[A-Z]{1,2}\d{6,9}\b")),
    ("date_of_birth", re.compile(rf"(?:تاريخ\s+(?:ال)?ميلاد|مواليد|date\s+of\s+birth|d\.?o\.?b\.?|born(?:\s+on)?)(?:{_LABEL_END}|\s+)[^\n]*", re.I)),
    ("identifier", re.compile(rf"(?:رقم\s+(?:الهوية|الإقامة|الجواز|جواز\s+السفر|الحساب)|الهوية\s+الوطنية|الإقامة|هوية|iqama|national\s+id|passport(?:\s+(?:no|number))?|id\s+(?:no|number)|account\s+(?:no|number)|iban){_LABEL_END}[^\n]*", re.I)),
    # Plain "address" is also an everyday verb, so it needs a label. A post box never does.
    ("address", re.compile(rf"(?:العنوان|عنوان\s+السكن|مقر\s+الإقامة|الرمز\s+البريدي|home\s+address|address|zip(?:\s+code)?|postal\s+code){_LABEL_END}[^\n]*", re.I)),
    ("address", re.compile(r"(?:ص\.?\s?ب\.?|p\.?\s?o\.?\s?box)[^\n]*", re.I)),
    ("address", re.compile(rf"(?:\bحي|\bشارع|\bطريق\s+الملك)\s+[{_ARABIC_LETTER}\s]{{2,40}}")),
    ("address", re.compile(r"\b\d{1,5}\s+[A-Z][\w\s]{2,30}\s(?:Street|St\.|Road|Rd\.|Avenue|Ave\.|District)\b")),
    ("sensitive", re.compile(rf"(?:الجنسية|الديانة|الحالة\s+(?:الاجتماعية|الصحية)|فصيلة\s+الدم|الجنس|النوع|الإعاقة|nationality|religion|marital\s+status|gender|sex|blood\s+type|health|disability|medical\s+condition){_LABEL_END}[^\n]*", re.I)),
    ("name", re.compile(rf"(?:الاسم(?:\s+الكامل)?|اسم\s+(?:المرجع|المدير|المشرف)|المرجع|المعرّف|full\s+name|name|reference|referee|supervisor|manager\s+name|contact\s+person|signature|التوقيع){_LABEL_END}[^\n]*", re.I)),
    ("name", re.compile(rf"(?:المهندس(?:ة)?|الدكتور(?:ة)?|الأستاذ(?:ة)?|السيد(?:ة)?|م\.|د\.|أ\.)\s*[{_ARABIC_LETTER}]+(?:\s+[{_ARABIC_LETTER}]+){{0,3}}")),
    ("name", re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Dr|Eng|Prof)\.?\s+[A-Z][\w'\-]+(?:\s+[A-Z][\w'\-]+){0,3}")),
    ("name", re.compile(rf"[{_ARABIC_LETTER}]+\s+(?:بن|بنت|ابن|آل)\s+[{_ARABIC_LETTER}]+(?:\s+[{_ARABIC_LETTER}]+)?")),
]

_ORG_PATTERNS = [
    re.compile(rf"(?<![{_ARABIC_LETTER}])(شركة|مؤسسة|مجموعة|بنك|مصرف|جامعة|كلية|معهد|وزارة|هيئة)\s+[{_ARABIC_LETTER}]+(?:\s+(?:ال)?[{_ARABIC_LETTER}]+){{0,3}}"),
    re.compile(r"\b(?:[A-Z][\w&\-]+\s+){1,4}(?:Inc\.?|LLC|Ltd\.?|Limited|Company|Co\.|Corp\.?|Corporation|University|College|Institute|Bank|Group)\b"),
    re.compile(r"\b(?:University|College|Institute)\s+of\s+(?:[A-Z][\w\-]+\s*){1,4}"),
]

# A long run of digits in outbound text is treated as an identifier, whatever it looks like.
_DIGIT_RUN = re.compile(r"\d(?:[\s\-]?\d){6,}")


class PrivacyBlocked(Exception):
    """Outbound text still contains something it must not. The request stops here."""

    def __init__(self, counts: dict[str, int]):
        super().__init__("Outbound privacy check failed")
        self.counts = counts


def normalize_digits(text: str) -> str:
    return text.translate(_ARABIC_DIGITS)


def _letter_pattern(word: str) -> str:
    """Matches common spelling variants, since an Arabic name can be written several ways."""
    parts = []
    for ch in word:
        if ch in "اأإآ":
            parts.append("[اأإآ]")
        elif ch in "يى":
            parts.append("[يى]")
        elif ch in "ةه":
            parts.append("[ةه]")
        else:
            parts.append(re.escape(ch))
    return "".join(parts)


def _name_regex(names: Iterable[str]) -> re.Pattern[str] | None:
    tokens: set[str] = set()
    fulls: set[str] = set()
    for name in names:
        words = [w for w in re.split(r"\s+", normalize_digits(name or "").strip()) if w]
        if not words:
            continue
        fulls.add(r"\s+".join(_letter_pattern(w) for w in words))
        # Each part of a known name, except short joining words such as "bin".
        tokens.update(_letter_pattern(w) for w in words if len(w) >= 3 and w.lower() not in {"bin", "ibn", "abu", "بنت", "ابن", "عبد"})
    if not fulls and not tokens:
        return None
    alternatives = "|".join(sorted(fulls | tokens, key=len, reverse=True))
    return re.compile(rf"(?<![\w{_ARABIC_LETTER}])(?:{alternatives})(?![\w{_ARABIC_LETTER}])", re.I)


def redact(text: str, known_names: Iterable[str] = (), counts: Counter | None = None, keep_organizations: bool = False) -> str:
    """Returns the text with personal data replaced. Adds to `counts`, which never holds the values themselves.

    `keep_organizations` is only for text that stays in this service (the local reading the candidate reviews): employers
    and universities aren't personal data, but they stay generalized in anything sent out."""
    counts = Counter() if counts is None else counts
    out = normalize_digits(text)
    names = _name_regex(known_names)
    if names:
        out, found = names.subn(PLACEHOLDER, out)
        counts["name"] += found
    for label, pattern in _PATTERNS:
        out, found = pattern.subn(PLACEHOLDER, out)
        counts[label] += found
    for pattern in [] if keep_organizations else _ORG_PATTERNS:
        def keep_kind(match: re.Match[str]) -> str:
            # The kind of organization is useful and the identity isn't.
            kind = match.group(1) if match.re.groups else None
            return f"{kind} {ORGANIZATION}" if kind else ORGANIZATION
        out, found = pattern.subn(keep_kind, out)
        counts["organization"] += found
    out, found = _DIGIT_RUN.subn(PLACEHOLDER, out)
    counts["digits"] += found
    return out


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _strings(item)


def assert_clean(payload: Any, known_names: Iterable[str] = ()) -> None:
    """The last check before anything leaves. Raises rather than repairing, so nothing is sent on a best guess."""
    found: Counter = Counter()
    names = _name_regex(known_names)
    for text in _strings(payload):
        checked = normalize_digits(text).replace(PLACEHOLDER, " ").replace(ORGANIZATION, " ")
        if names:
            found["name"] += len(names.findall(checked))
        for label, pattern in _PATTERNS:
            found[label] += len(pattern.findall(checked))
        found["digits"] += len(_DIGIT_RUN.findall(checked))
    problems = {k: v for k, v in found.items() if v}
    if problems:
        raise PrivacyBlocked(problems)
