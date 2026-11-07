"""A local stand-in for the OpenAI and Gemini APIs, so the whole journey can run with a "live" provider and no key or network.

    uv run python tests/stub_provider.py 8099

Point the AI service at it: AI_PROVIDER=openai OPENAI_API_KEY=stub OPENAI_MODEL=stub-model OPENAI_API_URL=http://127.0.0.1:8099
It proves the plumbing only. It says nothing about the quality of a real model's work.
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


def assessment(user: str) -> dict:
    job = json.loads(user[user.index("{"):user.rindex("}") + 1])
    skills = [s["id"] for s in job["skills"]]
    criteria = [
        {"description_ar": "يحدد المطلوب ويدعمه بدليل من العمل", "description_en": "Identifies what's needed and backs it with evidence", "max_score": 10, "weight": 2},
        {"description_ar": "يقترح خطوات عملية", "description_en": "Proposes practical steps", "max_score": 10, "weight": 1},
    ]
    tasks = [{
        "task_type": "written_case_study", "title_ar": f"مهمة من الدور: {job['title_ar']}", "title_en": f"A task from the role: {job['title_en']}",
        "instructions_ar": f"نفّذ هذه المسؤولية في موقف خيالي: {r['ar']}", "instructions_en": f"Carry out this responsibility in a fictional situation: {r['en']}",
        "requirement_ids": [r["id"]] if r["id"] else [], "skill_ids": skills, "criteria": criteria,
    } for r in job["responsibilities"]]
    required = [r for r in job["reference_skills"] if r["is_required"]]
    if required and tasks:
        tasks[0]["reference_skill_ids"] = [r["id"] for r in required]
    elif required:
        tasks.append({
            "task_type": "written_case_study", "title_ar": "تطبيق المهارات", "title_en": "Apply the skills", "instructions_ar": "طبّق المهارات المطلوبة.", "instructions_en": "Apply the required skills.",
            "reference_skill_ids": [r["id"] for r in required], "skill_ids": skills, "criteria": criteria,
        })
    return {"tasks": tasks}


def score(user: str) -> dict:
    words = re.search(r"<response>\n(.*)\n</response>", user, re.S)
    answer = (words[1] if words else "").strip()
    maximum = float(re.search(r"Maximum score: ([\d.]+)", user)[1])
    return {"score": maximum * 0.7 if answer else 0, "evidence_quote": answer[:60], "explanation": "Stub score, for testing the plumbing only.", "confidence": 0.9}


def reply(system: str, user: str) -> str:
    if "design a practical assessment" in system:
        return json.dumps(assessment(user), ensure_ascii=False)
    if "assess one criterion" in system:
        return json.dumps(score(user), ensure_ascii=False)
    return "{}"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if "messages" in body:
            system, user = body["messages"][0]["content"], body["messages"][1]["content"]
            out = {"choices": [{"message": {"content": reply(system, user)}}]}
        else:
            system, user = body["systemInstruction"]["parts"][0]["text"], body["contents"][0]["parts"][0]["text"]
            out = {"candidates": [{"content": {"parts": [{"text": reply(system, user)}]}}]}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
