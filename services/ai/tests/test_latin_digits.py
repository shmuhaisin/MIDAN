"""Every model reply reaches MIDAN with English digits, in Arabic text too (owner's requirement, 2026-11-10)."""
import json

from midan_ai.providers import JsonLLMProvider, latin_digits


def test_arabic_indic_digits_become_english_and_json_stays_valid():
    reply = latin_digits(lambda system, user: json.dumps({"title": "المهمة ٢ من ٣", "minutes": "٩٠", "persian": "۴۵"}, ensure_ascii=False))
    data = json.loads(reply("s", "u"))
    assert data == {"title": "المهمة 2 من 3", "minutes": "90", "persian": "45"}


def test_the_wrapper_keeps_schema_support_and_is_used_by_every_live_provider():
    def complete(system, user, schema=None, budget=None):
        return '{"n": "١٠"}'
    complete.accepts_schema = True
    provider = JsonLLMProvider(complete, "test-model", provider="groq")
    assert getattr(provider.complete, "accepts_schema", False) is True
    assert provider.complete("s", "u", schema=("X", {})) == '{"n": "10"}'


def test_text_without_those_digits_is_unchanged():
    text = '{"a": "Data analyst — churn 12%", "b": "تحليل"}'
    assert latin_digits(lambda *a: text)() == text
