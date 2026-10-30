"""
AI Mock Interview Simulator - Flask Backend
Uses Google Gemini API for intelligent interview question generation and feedback
"""

import os
import sys
import json
import uuid
import tempfile
from datetime import datetime
from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

try:
    from google import genai
    from google.genai import types as genai_types
    USE_NEW_SDK = True
except ImportError:
    import google.generativeai as genai_legacy
    USE_NEW_SDK = False

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.secret_key = os.getenv("SECRET_KEY", "mock-interview-secret-2024")
CORS(app, supports_credentials=True)

# ─── Configure Gemini ────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
    if USE_NEW_SDK:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    else:
        genai_legacy.configure(api_key=GEMINI_API_KEY)
        gemini_client = genai_legacy.GenerativeModel("gemini-1.5-flash")
    AI_ENABLED = True
else:
    gemini_client = None
    AI_ENABLED = False

# ─── Session Storage (Memory + Temp Cache for Serverless Persistence) ────────
interview_sessions = {}
SESSION_CACHE_DIR = os.path.join(tempfile.gettempdir(), "interviewai_sessions")
try:
    os.makedirs(SESSION_CACHE_DIR, exist_ok=True)
except Exception:
    pass

def _get_session(session_id):
    if not session_id:
        return None
    if session_id in interview_sessions:
        return interview_sessions[session_id]
    filepath = os.path.join(SESSION_CACHE_DIR, f"{session_id}.json")
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                sess = json.load(f)
                interview_sessions[session_id] = sess
                return sess
        except Exception:
            pass
    return None

def _save_session(session_id, sess):
    interview_sessions[session_id] = sess
    try:
        filepath = os.path.join(SESSION_CACHE_DIR, f"{session_id}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(sess, f)
    except Exception:
        pass


# ─── Interview Domain Configurations ─────────────────────────────────────────
DOMAINS = {
    "software_engineering": {
        "name": "Software Engineering",
        "icon": "laptop",
        "color": "#6366f1",
        "skills": ["Data Structures", "Algorithms", "OOP", "Design Patterns", "Debugging"],
        "difficulty_levels": ["Entry Level", "Mid Level", "Senior Level"],
    },
    "system_design": {
        "name": "System Design",
        "icon": "building",
        "color": "#8b5cf6",
        "skills": ["Scalability", "Database Design", "API Design", "Caching", "Load Balancing"],
        "difficulty_levels": ["Mid Level", "Senior Level", "Staff/Principal"],
    },
    "data_science": {
        "name": "Data Science & ML",
        "icon": "chart",
        "color": "#06b6d4",
        "skills": ["Statistics", "Machine Learning", "Python/R", "Data Wrangling", "Model Evaluation"],
        "difficulty_levels": ["Entry Level", "Mid Level", "Senior Level"],
    },
    "product_management": {
        "name": "Product Management",
        "icon": "rocket",
        "color": "#10b981",
        "skills": ["Product Strategy", "Roadmapping", "Metrics", "User Research", "Prioritization"],
        "difficulty_levels": ["Associate PM", "PM", "Senior PM"],
    },
    "behavioral": {
        "name": "HR / Behavioral",
        "icon": "handshake",
        "color": "#f59e0b",
        "skills": ["Leadership", "Communication", "Problem Solving", "Teamwork", "Conflict Resolution"],
        "difficulty_levels": ["All Levels"],
    },
}

# ─── Fallback Questions (when AI is not available) ───────────────────────────
FALLBACK_QUESTIONS = {
    "software_engineering": [
        "Tell me about a challenging coding problem you've solved recently.",
        "What is the difference between a stack and a queue? When would you use each?",
        "Explain the concept of Big-O notation and why it matters.",
        "How do you approach debugging a complex issue in production?",
        "What design patterns have you used in your projects? Give an example.",
        "Describe the difference between synchronous and asynchronous programming.",
        "How do you ensure your code is testable and maintainable?",
        "Walk me through how you'd implement a binary search algorithm.",
    ],
    "system_design": [
        "Design a URL shortener like bit.ly.",
        "How would you design a distributed cache system?",
        "Walk me through how you'd design a real-time chat application.",
        "How would you ensure high availability in a microservices architecture?",
        "Design an API rate limiting system.",
        "How would you design a notification service for millions of users?",
        "Explain how you'd architect a ride-sharing backend like Uber.",
        "How would you design a scalable search autocomplete feature?",
    ],
    "data_science": [
        "Explain the difference between supervised and unsupervised learning.",
        "How do you handle class imbalance in a classification problem?",
        "What is overfitting and how do you prevent it?",
        "Explain the bias-variance tradeoff.",
        "How would you approach feature selection for a machine learning model?",
        "What is cross-validation and why is it important?",
        "Explain the intuition behind gradient descent.",
        "How would you evaluate a recommendation system?",
    ],
    "product_management": [
        "How do you prioritize features in a product roadmap?",
        "Tell me about a product you admire and how you'd improve it.",
        "How do you measure the success of a new feature launch?",
        "Describe how you handle conflict between engineering and business stakeholders.",
        "How would you approach entering a new market segment?",
        "Walk me through how you'd define metrics for a mobile app.",
        "How do you decide when to kill a feature?",
        "Tell me about a time you used data to make a product decision.",
    ],
    "behavioral": [
        "Tell me about a time you had to work under pressure.",
        "Describe a situation where you disagreed with your manager and how you handled it.",
        "Give an example of when you showed leadership without having a leadership title.",
        "Tell me about a project that failed. What did you learn?",
        "Describe a time you had to quickly learn a new technology or skill.",
        "Tell me about a time you resolved a conflict within your team.",
        "How have you handled receiving critical feedback?",
        "Describe a situation where you went above and beyond your job responsibilities.",
    ],
}


def build_interview_prompt(domain, difficulty, question_number, conversation_history, job_role):
    domain_config = DOMAINS.get(domain, {})
    skills = ", ".join(domain_config.get("skills", []))
    history_text = ""
    for msg in conversation_history[-6:]:
        role = "Interviewer" if msg["role"] == "assistant" else "Candidate"
        history_text += f"{role}: {msg['content']}\n"

    return f"""You are an expert, empathetic AI interviewer conducting a {domain_config.get('name', domain)} interview for a {difficulty} {job_role} position.

Key skills to assess: {skills}

Conversation so far:
{history_text}

Instructions:
- Ask question #{question_number} appropriate for {difficulty} level
- Keep questions concise and clear (1-3 sentences max)
- Vary question types: technical, situational, behavioral
- Build naturally on previous answers when relevant
- Do NOT give feedback - just ask the next question
- Format: Just the question text, no preamble

Question:"""


def build_feedback_prompt(question, answer, domain, difficulty):
    domain_config = DOMAINS.get(domain, {})
    skills = domain_config.get("skills", [])
    return f"""You are an expert {domain_config.get('name', domain)} interviewer providing structured feedback.

Interview Question: {question}
Candidate's Answer: {answer}
Level: {difficulty}

Provide feedback in this exact JSON format:
{{
  "score": <integer 1-10>,
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "sample_answer_hint": "<A brief hint about what an ideal answer would include - 2-3 sentences>",
  "skills_demonstrated": {json.dumps(skills[:2])},
  "tip": "<One actionable tip for the candidate>"
}}

Be constructive, specific, and encouraging. JSON only, no extra text."""


def build_report_prompt(domain, difficulty, job_role, qa_pairs, scores):
    domain_config = DOMAINS.get(domain, {})
    skills = domain_config.get("skills", [])
    avg_score = sum(scores) / len(scores) if scores else 0
    qa_text = ""
    for i, qa in enumerate(qa_pairs, 1):
        qa_text += f"\nQ{i}: {qa['question']}\nA{i}: {qa['answer']}\nScore: {qa.get('score', 'N/A')}/10\n"

    return f"""You are an expert career coach generating a comprehensive interview assessment report.

Role: {job_role} ({difficulty})
Domain: {domain_config.get('name', domain)}
Skills Assessed: {', '.join(skills)}
Average Score: {avg_score:.1f}/10

Interview Q&A:
{qa_text}

Generate a detailed assessment report in this exact JSON format:
{{
  "overall_score": {avg_score:.1f},
  "performance_level": "<Excellent/Good/Average/Needs Improvement>",
  "executive_summary": "<3-4 sentence overall assessment>",
  "skill_scores": {{
    {', '.join([f'"{s}": <score 1-10>' for s in skills])}
  }},
  "top_strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "key_improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "readiness_verdict": "<Ready to apply / Needs 1-2 months prep / Needs significant preparation>",
  "recommended_resources": [
    {{"type": "Book/Course/Practice", "title": "<title>", "reason": "<why>"}},
    {{"type": "Book/Course/Practice", "title": "<title>", "reason": "<why>"}}
  ],
  "next_steps": ["<action 1>", "<action 2>", "<action 3>"]
}}

JSON only, no extra text."""


def call_gemini(prompt):
    if not AI_ENABLED or not gemini_client:
        return None
    try:
        if USE_NEW_SDK:
            response = gemini_client.models.generate_content(
                model="gemini-1.5-flash",
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    temperature=0.7,
                    max_output_tokens=1024,
                ),
            )
        else:
            response = gemini_client.generate_content(
                prompt,
                generation_config=genai_legacy.GenerationConfig(temperature=0.7, max_output_tokens=1024),
            )
        return response.text.strip()
    except Exception as e:
        print(f"Gemini API error: {e}")
        return None


def parse_json_response(text):
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re
        match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        return None


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.errorhandler(404)
def handle_not_found(e):
    return jsonify({
        "error": "Not Found",
        "path": request.path,
        "url": request.url,
        "environ_path": request.environ.get("PATH_INFO"),
        "query": request.query_string.decode("utf-8", "ignore"),
    }), 404


@app.route("/api/status", methods=["GET"])
@app.route("/status", methods=["GET"])
@app.route("/api", methods=["GET"])
@app.route("/api/index", methods=["GET"])
def api_status():
    return jsonify({
        "status": "online",
        "ai_enabled": AI_ENABLED,
        "domains": list(DOMAINS.keys()),
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/domains", methods=["GET"])
@app.route("/domains", methods=["GET"])
def get_domains():
    return jsonify({"domains": DOMAINS})


@app.route("/api/session/start", methods=["POST"])
@app.route("/session/start", methods=["POST"])
def start_session():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    domain = data.get("domain", "software_engineering")
    difficulty = data.get("difficulty", "Mid Level")
    job_role = data.get("job_role", "Software Engineer")
    total_questions = min(int(data.get("total_questions", 5)), 10)

    if domain not in DOMAINS:
        return jsonify({"error": f"Invalid domain: {domain}"}), 400

    session_id = str(uuid.uuid4())
    session_data = {
        "id": session_id,
        "domain": domain,
        "difficulty": difficulty,
        "job_role": job_role,
        "total_questions": total_questions,
        "current_question": 1,
        "conversation_history": [],
        "qa_pairs": [],
        "scores": [],
        "started_at": datetime.now().isoformat(),
        "status": "active",
    }
    _save_session(session_id, session_data)

    first_question = _generate_question(session_id)

    return jsonify({
        "session_id": session_id,
        "question": first_question,
        "question_number": 1,
        "total_questions": total_questions,
        "domain": DOMAINS[domain]["name"],
        "difficulty": difficulty,
        "job_role": job_role,
    })


@app.route("/api/session/<session_id>/answer", methods=["POST"])
@app.route("/session/<session_id>/answer", methods=["POST"])
def submit_answer(session_id):
    sess = _get_session(session_id)
    if not sess:
        return jsonify({"error": "Session not found"}), 404

    if sess["status"] != "active":
        return jsonify({"error": "Session is not active"}), 400

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    answer = data.get("answer", "").strip()
    current_question = sess["conversation_history"][-1]["content"] if sess["conversation_history"] else ""

    if not answer:
        return jsonify({"error": "Answer cannot be empty"}), 400
    if len(answer) < 5:
        return jsonify({"error": "Please provide a more detailed answer"}), 400

    sess["conversation_history"].append({"role": "user", "content": answer})
    feedback = _generate_feedback(current_question, answer, sess)

    sess["qa_pairs"].append({
        "question": current_question,
        "answer": answer,
        "score": feedback.get("score", 5),
        "feedback": feedback,
    })
    if feedback.get("score"):
        sess["scores"].append(feedback["score"])

    sess["current_question"] += 1

    if sess["current_question"] > sess["total_questions"]:
        sess["status"] = "completed"
        _save_session(session_id, sess)
        return jsonify({
            "feedback": feedback,
            "interview_complete": True,
            "session_id": session_id,
        })

    _save_session(session_id, sess)
    next_question = _generate_question(session_id)

    return jsonify({
        "feedback": feedback,
        "next_question": next_question,
        "question_number": sess["current_question"],
        "total_questions": sess["total_questions"],
        "interview_complete": False,
    })


@app.route("/api/session/<session_id>/report", methods=["GET"])
@app.route("/session/<session_id>/report", methods=["GET"])
def get_report(session_id):
    sess = _get_session(session_id)
    if not sess:
        return jsonify({"error": "Session not found"}), 404

    if not sess["qa_pairs"]:
        return jsonify({"error": "No answers recorded yet"}), 400

    report = _generate_report(sess)
    sess["report"] = report
    _save_session(session_id, sess)

    return jsonify({
        "report": report,
        "session": {
            "domain": sess["domain"],
            "difficulty": sess["difficulty"],
            "job_role": sess["job_role"],
            "total_questions": len(sess["qa_pairs"]),
            "duration": _calculate_duration(sess.get("started_at")),
        },
        "qa_pairs": sess["qa_pairs"],
    })


@app.route("/api/session/<session_id>/skip", methods=["POST"])
@app.route("/session/<session_id>/skip", methods=["POST"])
def skip_question(session_id):
    sess = _get_session(session_id)
    if not sess:
        return jsonify({"error": "Session not found"}), 404

    if sess["status"] != "active":
        return jsonify({"error": "Session is not active"}), 400

    current_question = sess["conversation_history"][-1]["content"] if sess["conversation_history"] else ""

    sess["qa_pairs"].append({
        "question": current_question,
        "answer": "[Skipped]",
        "score": 0,
        "feedback": {"score": 0, "strengths": [], "improvements": ["Question was skipped"]},
    })
    sess["scores"].append(0)
    sess["current_question"] += 1

    if sess["current_question"] > sess["total_questions"]:
        sess["status"] = "completed"
        _save_session(session_id, sess)
        return jsonify({"interview_complete": True, "session_id": session_id})

    _save_session(session_id, sess)
    next_question = _generate_question(session_id)
    return jsonify({
        "next_question": next_question,
        "question_number": sess["current_question"],
        "total_questions": sess["total_questions"],
        "interview_complete": False,
    })


# ─── Private Helpers ──────────────────────────────────────────────────────────

def _generate_question(session_id):
    sess = _get_session(session_id)
    domain = sess["domain"]
    q_num = sess["current_question"]

    if AI_ENABLED:
        prompt = build_interview_prompt(
            domain=domain,
            difficulty=sess["difficulty"],
            question_number=q_num,
            conversation_history=sess["conversation_history"],
            job_role=sess["job_role"],
        )
        question = call_gemini(prompt)
        if question:
            sess["conversation_history"].append({"role": "assistant", "content": question})
            return question

    questions = FALLBACK_QUESTIONS.get(domain, FALLBACK_QUESTIONS["behavioral"])
    idx = (q_num - 1) % len(questions)
    question = questions[idx]
    sess["conversation_history"].append({"role": "assistant", "content": question})
    return question


def _generate_feedback(question, answer, sess):
    if AI_ENABLED:
        prompt = build_feedback_prompt(
            question=question,
            answer=answer,
            domain=sess["domain"],
            difficulty=sess["difficulty"],
        )
        raw = call_gemini(prompt)
        parsed = parse_json_response(raw)
        if parsed:
            return parsed

    word_count = len(answer.split())
    score = min(10, max(1, word_count // 10 + 3))
    return {
        "score": score,
        "strengths": ["Attempted to answer the question", "Showed engagement"],
        "improvements": ["Add more specific examples", "Structure your answer using STAR method"],
        "sample_answer_hint": "A strong answer typically includes specific examples, measurable results, and clear reasoning.",
        "skills_demonstrated": [],
        "tip": "Try to be more specific and quantify your achievements where possible.",
    }


def _generate_report(sess):
    if AI_ENABLED:
        prompt = build_report_prompt(
            domain=sess["domain"],
            difficulty=sess["difficulty"],
            job_role=sess["job_role"],
            qa_pairs=sess["qa_pairs"],
            scores=sess["scores"],
        )
        raw = call_gemini(prompt)
        parsed = parse_json_response(raw)
        if parsed:
            return parsed

    avg = sum(sess["scores"]) / len(sess["scores"]) if sess["scores"] else 5
    domain_config = DOMAINS.get(sess["domain"], {})
    skills = domain_config.get("skills", [])
    return {
        "overall_score": round(avg, 1),
        "performance_level": "Good" if avg >= 7 else "Average" if avg >= 5 else "Needs Improvement",
        "executive_summary": f"You completed a {sess['difficulty']} {domain_config.get('name', '')} interview with an average score of {avg:.1f}/10. Keep practicing to improve your performance.",
        "skill_scores": {skill: round(min(10, max(1, avg + (hash(skill) % 3 - 1))), 1) for skill in skills},
        "top_strengths": ["Attempted all questions", "Showed domain knowledge", "Communicated clearly"],
        "key_improvements": ["Use more concrete examples", "Improve answer structure", "Add quantifiable results"],
        "readiness_verdict": "Needs 1-2 months prep" if avg < 7 else "Ready to apply",
        "recommended_resources": [
            {"type": "Practice", "title": "LeetCode / HackerRank", "reason": "Sharpen problem-solving skills"},
            {"type": "Book", "title": "Cracking the Coding Interview", "reason": "Comprehensive interview prep guide"},
        ],
        "next_steps": ["Practice 1 problem daily", "Record yourself answering questions", "Do mock interviews weekly"],
    }


def _calculate_duration(started_at):
    if not started_at:
        return "Unknown"
    try:
        start = datetime.fromisoformat(started_at)
        delta = datetime.now() - start
        mins = int(delta.total_seconds() // 60)
        secs = int(delta.total_seconds() % 60)
        return f"{mins}m {secs}s"
    except Exception:
        return "Unknown"


if __name__ == "__main__":
    print("=" * 60)
    print("AI Mock Interview Simulator")
    print("=" * 60)
    print(f"AI Enabled: {'Yes (Gemini)' if AI_ENABLED else 'No (fallback mode)'}")
    if not AI_ENABLED:
        print("Set GEMINI_API_KEY in .env to enable AI features")
    print(f"Running at: http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, port=5000, host="0.0.0.0")
