/**
 * InterviewAI — Frontend Application
 * Manages screen transitions, interview session, API calls, real-time feedback, and report rendering.
 */

"use strict";

// ─── State ────────────────────────────────────────────────────────────────────
const State = {
  sessionId: null,
  currentQuestion: null,
  questionNumber: 1,
  totalQuestions: 5,
  scores: [],
  selectedDomain: "software_engineering",
  selectedCount: 5,
  timerInterval: null,
  elapsedSeconds: 0,
  recognition: null,
  isVoiceActive: false,
  isSubmitting: false,
};

const API_BASE = "/api";

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkApiStatus();
  setupDomainCards();
  setupCountButtons();
  setupTextareaEvents();
  injectSvgDefs();
});

function injectSvgDefs() {
  const svgDefs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgDefs.style.width = "0";
  svgDefs.style.height = "0";
  svgDefs.style.position = "absolute";
  svgDefs.innerHTML = `
    <defs>
      <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#8b5cf6"/>
      </linearGradient>
    </defs>`;
  document.body.appendChild(svgDefs);
}

// ─── API Status Check ─────────────────────────────────────────────────────────
async function checkApiStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    const data = await res.json();
    const dot  = document.getElementById("ai-status-dot");
    const text = document.getElementById("ai-status-text");
    if (data.status === "online") {
      dot.className  = "status-dot online";
      text.textContent = data.ai_enabled ? "AI Ready (Gemini)" : "Online (Demo Mode)";
    }
  } catch {
    const dot  = document.getElementById("ai-status-dot");
    const text = document.getElementById("ai-status-text");
    dot.className  = "status-dot offline";
    text.textContent = "Server Offline";
  }
}

// ─── Screen Navigation ────────────────────────────────────────────────────────
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToFeatures() {
  document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────
function setupDomainCards() {
  document.querySelectorAll(".domain-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".domain-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      State.selectedDomain = card.dataset.domain;
    });
  });
}

function setupCountButtons() {
  document.querySelectorAll(".count-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".count-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      State.selectedCount = parseInt(btn.dataset.count, 10);
    });
  });
}

// ─── Start Interview ──────────────────────────────────────────────────────────
async function startInterview() {
  const jobRole   = document.getElementById("job-role").value.trim() || "Software Engineer";
  const difficulty = document.getElementById("difficulty").value;
  const domain    = State.selectedDomain;
  const total     = State.selectedCount;

  if (!jobRole) {
    showToast("Please enter a job role", "warning");
    return;
  }

  showLoading("Starting your interview session…");

  try {
    const res = await fetch(`${API_BASE}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, difficulty, job_role: jobRole, total_questions: total }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Failed to start session");

    // Store state
    State.sessionId      = data.session_id;
    State.totalQuestions = data.total_questions;
    State.questionNumber = 1;
    State.scores         = [];
    State.currentQuestion = data.question;
    State.elapsedSeconds = 0;

    // Update sidebar
    document.getElementById("sidebar-domain").textContent     = data.domain;
    document.getElementById("sidebar-role").textContent       = data.job_role;
    document.getElementById("sidebar-difficulty").textContent = data.difficulty;
    document.getElementById("progress-text").textContent      = `0 / ${data.total_questions}`;
    document.getElementById("header-q-total").textContent     = `of ${data.total_questions}`;

    buildQuestionDots(data.total_questions);
    resetAvgScore();

    showScreen("screen-interview");
    hideLoading();
    clearChat();
    startTimer();

    // Show first question
    showInterviewerMessage(data.question);
    updateHeader(1, data.total_questions);

  } catch (err) {
    hideLoading();
    showToast(err.message, "error");
    console.error(err);
  }
}

// ─── Submit Answer ────────────────────────────────────────────────────────────
async function submitAnswer() {
  if (State.isSubmitting) return;
  const textarea = document.getElementById("answer-input");
  const answer   = textarea.value.trim();

  if (!answer) {
    showToast("Please type your answer before submitting", "warning");
    textarea.focus();
    return;
  }
  if (answer.length < 10) {
    showToast("Please provide a more detailed answer", "warning");
    textarea.focus();
    return;
  }

  State.isSubmitting = true;
  setSubmitState(true);

  // Show user message
  showUserMessage(answer);
  textarea.value = "";
  updateCharCount();
  hideFeedbackPanel();

  // Typing indicator
  const typingId = showTypingIndicator();
  showLoading("Analyzing your answer…");

  try {
    const res = await fetch(`${API_BASE}/session/${State.sessionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error submitting answer");

    removeTypingIndicator(typingId);
    hideLoading();

    // Show feedback
    if (data.feedback) {
      showFeedbackPanel(data.feedback);
      State.scores.push(data.feedback.score || 0);
      updateAvgScore();
      markDotAnswered(State.questionNumber);
      updateProgress(State.questionNumber, State.totalQuestions);
    }

    if (data.interview_complete) {
      State.questionNumber++;
      setTimeout(() => {
        showToast("Interview complete! Generating your report…", "success");
        loadReport(data.session_id || State.sessionId);
      }, 2000);
    } else {
      State.questionNumber = data.question_number;
      State.currentQuestion = data.next_question;
      updateHeader(data.question_number, data.total_questions);

      // Show next question after a short delay
      setTimeout(() => {
        hideFeedbackPanel();
        showInterviewerMessage(data.next_question);
        textarea.focus();
      }, 3500);
    }

  } catch (err) {
    removeTypingIndicator(typingId);
    hideLoading();
    showToast(err.message, "error");
    console.error(err);
  } finally {
    State.isSubmitting = false;
    setSubmitState(false);
  }
}

// ─── Skip Question ────────────────────────────────────────────────────────────
async function skipQuestion() {
  if (State.isSubmitting) return;
  State.isSubmitting = true;
  showLoading("Skipping question…");

  try {
    const res = await fetch(`${API_BASE}/session/${State.sessionId}/skip`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error skipping question");

    hideLoading();
    markDotSkipped(State.questionNumber);
    State.scores.push(0);
    updateAvgScore();
    hideFeedbackPanel();

    if (data.interview_complete) {
      showToast("Interview complete! Generating your report…", "info");
      setTimeout(() => loadReport(State.sessionId), 1500);
    } else {
      State.questionNumber = data.question_number;
      State.currentQuestion = data.next_question;
      updateHeader(data.question_number, data.total_questions);
      updateProgress(data.question_number - 1, data.total_questions);
      showToast("Question skipped", "warning");
      showInterviewerMessage(data.next_question);
    }

  } catch (err) {
    hideLoading();
    showToast(err.message, "error");
  } finally {
    State.isSubmitting = false;
  }
}

// ─── End Interview ────────────────────────────────────────────────────────────
function confirmEndInterview() {
  document.getElementById("modal-end").classList.remove("hidden");
}

async function endInterviewNow() {
  closeModal("modal-end");
  if (State.sessionId) {
    try {
      await fetch(`${API_BASE}/session/${State.sessionId}/end`, { method: "POST" });
    } catch {}
  }
  stopTimer();
  await loadReport(State.sessionId);
}

// ─── Load Report ──────────────────────────────────────────────────────────────
async function loadReport(sessionId) {
  showLoading("Generating your personalized report…");

  try {
    const res = await fetch(`${API_BASE}/session/${sessionId}/report`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate report");

    hideLoading();
    stopTimer();
    renderReport(data);
    showScreen("screen-report");

  } catch (err) {
    hideLoading();
    showToast(err.message, "error");
    console.error(err);
  }
}

// ─── Render Report ────────────────────────────────────────────────────────────
function renderReport(data) {
  const { report, session, qa_pairs } = data;

  // Meta
  document.getElementById("report-meta").innerHTML = `
    <span>📋 ${session.domain.replace(/_/g, " ")}</span>
    <span>🎯 ${session.job_role}</span>
    <span>📊 ${session.difficulty}</span>
    <span>❓ ${session.total_questions} Questions</span>
    <span>⏱️ ${session.duration}</span>`;

  // Overall score
  const score = parseFloat(report.overall_score) || 0;
  document.getElementById("report-overall-score").textContent = score.toFixed(1);

  // Animate score ring
  const circumference = 2 * Math.PI * 50;
  const offset = circumference - (score / 10) * circumference;
  setTimeout(() => {
    const ring = document.getElementById("ring-progress");
    if (ring) ring.style.strokeDashoffset = offset;
  }, 300);

  // Performance badge
  const perfBadge = document.getElementById("performance-badge");
  const level = report.performance_level || "Average";
  const badgeClass = {
    "Excellent": "badge-excellent",
    "Good": "badge-good",
    "Average": "badge-average",
    "Needs Improvement": "badge-needs",
  }[level] || "badge-average";
  perfBadge.className = `performance-badge ${badgeClass}`;
  perfBadge.textContent = level;

  // Readiness
  document.getElementById("readiness-verdict").textContent = `🎯 ${report.readiness_verdict || ""}`;
  document.getElementById("executive-summary").textContent = report.executive_summary || "";

  // Skill bars
  const skillBarsEl = document.getElementById("skill-bars");
  skillBarsEl.innerHTML = "";
  if (report.skill_scores && typeof report.skill_scores === "object") {
    Object.entries(report.skill_scores).forEach(([skill, s]) => {
      const sVal = parseFloat(s) || 0;
      const barEl = document.createElement("div");
      barEl.className = "skill-bar-item";
      barEl.innerHTML = `
        <div class="skill-bar-label">${skill}</div>
        <div class="skill-bar-track">
          <div class="skill-bar-fill" style="width:0%" data-target="${(sVal / 10) * 100}%"></div>
        </div>
        <div class="skill-bar-score">${sVal.toFixed(1)}</div>`;
      skillBarsEl.appendChild(barEl);
    });
    // Animate bars after a short delay
    setTimeout(() => {
      document.querySelectorAll(".skill-bar-fill").forEach(bar => {
        bar.style.width = bar.dataset.target;
      });
    }, 500);
  }

  // Strengths
  const strengthsList = document.getElementById("strengths-list");
  strengthsList.innerHTML = "";
  (report.top_strengths || []).forEach(s => {
    const li = document.createElement("li");
    li.textContent = s;
    strengthsList.appendChild(li);
  });

  // Improvements
  const improvList = document.getElementById("improvements-list");
  improvList.innerHTML = "";
  (report.key_improvements || []).forEach(s => {
    const li = document.createElement("li");
    li.textContent = s;
    improvList.appendChild(li);
  });

  // Resources
  const resourcesEl = document.getElementById("resources-list");
  resourcesEl.innerHTML = "";
  (report.recommended_resources || []).forEach(r => {
    const card = document.createElement("div");
    card.className = "resource-card";
    card.innerHTML = `
      <div class="resource-type">${r.type || "Resource"}</div>
      <div class="resource-title">${r.title || ""}</div>
      <div class="resource-reason">${r.reason || ""}</div>`;
    resourcesEl.appendChild(card);
  });

  // Next Steps
  const stepsEl = document.getElementById("next-steps-list");
  stepsEl.innerHTML = "";
  (report.next_steps || []).forEach((step, i) => {
    const el = document.createElement("div");
    el.className = "next-step-item";
    el.innerHTML = `<div class="step-num">${i + 1}</div><div>${step}</div>`;
    stepsEl.appendChild(el);
  });

  // Q&A Review
  const qaEl = document.getElementById("qa-review");
  qaEl.innerHTML = "";
  (qa_pairs || []).forEach((qa, i) => {
    const s = parseFloat(qa.score) || 0;
    const scoreColor = s >= 7 ? "var(--success)" : s >= 5 ? "var(--warning)" : "var(--danger)";
    const item = document.createElement("div");
    item.className = "qa-item";
    item.innerHTML = `
      <div class="qa-header">
        <span class="qa-q-num">Question ${i + 1}</span>
        <span class="qa-score-badge" style="color:${scoreColor};background:${scoreColor}22;border:1px solid ${scoreColor}44">
          ${s}/10
        </span>
      </div>
      <div class="qa-body">
        <div class="qa-question">${escapeHtml(qa.question)}</div>
        <div class="qa-answer">${escapeHtml(qa.answer)}</div>
      </div>`;
    qaEl.appendChild(item);
  });
}

// ─── Chat UI ──────────────────────────────────────────────────────────────────
function showInterviewerMessage(text) {
  const container = document.getElementById("chat-messages");
  const row = document.createElement("div");
  row.className = "message-row interviewer";
  row.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(row);
  scrollChatToBottom();
}

function showUserMessage(text) {
  const container = document.getElementById("chat-messages");
  const row = document.createElement("div");
  row.className = "message-row user";
  row.innerHTML = `
    <div class="message-avatar">👤</div>
    <div class="message-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(row);
  scrollChatToBottom();
}

function showTypingIndicator() {
  const container = document.getElementById("chat-messages");
  const row = document.createElement("div");
  const id  = `typing-${Date.now()}`;
  row.id    = id;
  row.className = "message-row interviewer";
  row.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  container.appendChild(row);
  scrollChatToBottom();
  return id;
}

function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

function clearChat() {
  const container = document.getElementById("chat-messages");
  container.innerHTML = `
    <div class="chat-welcome">
      <div class="welcome-avatar">🤖</div>
      <div class="welcome-text">
        <strong>AI Interviewer is ready!</strong><br/>
        <span>Answer each question thoughtfully. Take your time — quality matters.</span>
      </div>
    </div>`;
}

function scrollChatToBottom() {
  const container = document.getElementById("chat-messages");
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

// ─── Feedback Panel ───────────────────────────────────────────────────────────
function showFeedbackPanel(feedback) {
  const panel = document.getElementById("feedback-panel");
  const score = feedback.score || 0;
  const scoreColor = score >= 7 ? "var(--success)" : score >= 5 ? "var(--warning)" : "var(--danger)";

  const strengthsHtml = (feedback.strengths || [])
    .map(s => `<li>${escapeHtml(s)}</li>`).join("") || "<li>—</li>";
  const improvHtml = (feedback.improvements || [])
    .map(s => `<li>${escapeHtml(s)}</li>`).join("") || "<li>—</li>";

  panel.innerHTML = `
    <div class="feedback-inner">
      <div class="feedback-score-bar">
        <span class="feedback-score-label">Your Score</span>
        <div class="feedback-score-value">
          <span class="feedback-score-num" style="color:${scoreColor}">${score}</span>
          <span class="feedback-score-denom">/10</span>
        </div>
      </div>
      <div class="feedback-body">
        <div class="feedback-col strengths">
          <h4>✓ Strengths</h4>
          <ul>${strengthsHtml}</ul>
        </div>
        <div class="feedback-col improvements">
          <h4>→ Improve</h4>
          <ul>${improvHtml}</ul>
        </div>
      </div>
      ${feedback.tip ? `<div class="feedback-tip"><strong>💡 Tip:</strong> ${escapeHtml(feedback.tip)}</div>` : ""}
    </div>`;
  panel.classList.remove("hidden");
  scrollChatToBottom();
}

function hideFeedbackPanel() {
  const panel = document.getElementById("feedback-panel");
  panel.classList.add("hidden");
  panel.innerHTML = "";
}

// ─── Progress & Score ─────────────────────────────────────────────────────────
function buildQuestionDots(total) {
  const container = document.getElementById("question-dots");
  container.innerHTML = "";
  for (let i = 1; i <= total; i++) {
    const dot = document.createElement("div");
    dot.className = "q-dot" + (i === 1 ? " current" : "");
    dot.id = `dot-${i}`;
    dot.textContent = i;
    container.appendChild(dot);
  }
}

function markDotAnswered(num) {
  const dot = document.getElementById(`dot-${num}`);
  if (dot) { dot.className = "q-dot answered"; dot.textContent = "✓"; }
  const next = document.getElementById(`dot-${num + 1}`);
  if (next) next.className = "q-dot current";
}

function markDotSkipped(num) {
  const dot = document.getElementById(`dot-${num}`);
  if (dot) { dot.className = "q-dot skipped"; dot.textContent = "—"; }
  const next = document.getElementById(`dot-${num + 1}`);
  if (next) next.className = "q-dot current";
}

function updateProgress(answered, total) {
  const pct = (answered / total) * 100;
  document.getElementById("progress-fill").style.width = `${pct}%`;
  document.getElementById("progress-text").textContent = `${answered} / ${total}`;
}

function updateAvgScore() {
  const validScores = State.scores.filter(s => s > 0);
  if (validScores.length === 0) return;
  const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  document.getElementById("avg-score-display").textContent = avg.toFixed(1);
}

function resetAvgScore() {
  document.getElementById("avg-score-display").textContent = "—";
}

function updateHeader(qNum, total) {
  document.getElementById("header-q-num").textContent = `Question ${qNum}`;
  document.getElementById("header-q-total").textContent = `of ${total}`;
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  State.elapsedSeconds = 0;
  clearInterval(State.timerInterval);
  State.timerInterval = setInterval(() => {
    State.elapsedSeconds++;
    const m = String(Math.floor(State.elapsedSeconds / 60)).padStart(2, "0");
    const s = String(State.elapsedSeconds % 60).padStart(2, "0");
    document.getElementById("timer-display").textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(State.timerInterval);
  State.timerInterval = null;
}

// ─── Voice Input ──────────────────────────────────────────────────────────────
function toggleVoice() {
  const btn = document.getElementById("btn-voice");
  if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
    showToast("Voice input is not supported in this browser", "warning");
    return;
  }

  if (State.isVoiceActive) {
    State.recognition?.stop();
    State.isVoiceActive = false;
    btn.classList.remove("voice-active");
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  State.recognition = rec;

  rec.onstart = () => {
    State.isVoiceActive = true;
    btn.classList.add("voice-active");
    showToast("Listening… speak your answer", "info");
  };

  rec.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const textarea = document.getElementById("answer-input");
    textarea.value = transcript;
    updateCharCount();
  };

  rec.onerror = () => {
    State.isVoiceActive = false;
    btn.classList.remove("voice-active");
    showToast("Voice recognition error", "error");
  };

  rec.onend = () => {
    State.isVoiceActive = false;
    btn.classList.remove("voice-active");
  };

  rec.start();
}

// ─── Textarea Events ──────────────────────────────────────────────────────────
function setupTextareaEvents() {
  const textarea = document.getElementById("answer-input");
  if (!textarea) return;

  textarea.addEventListener("input", updateCharCount);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      submitAnswer();
    }
  });
}

function updateCharCount() {
  const textarea = document.getElementById("answer-input");
  const count    = document.getElementById("char-count");
  if (textarea && count) {
    count.textContent = `${textarea.value.length} / 3000`;
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function showLoading(text = "Loading…") {
  document.getElementById("loading-text").textContent = text;
  document.getElementById("loading-overlay").classList.remove("hidden");
}

function hideLoading() {
  document.getElementById("loading-overlay").classList.add("hidden");
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

// ─── Submit State ─────────────────────────────────────────────────────────────
function setSubmitState(disabled) {
  const btn = document.getElementById("btn-submit");
  const textarea = document.getElementById("answer-input");
  if (btn) {
    btn.disabled = disabled;
    btn.innerHTML = disabled
      ? `<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Submitting…`
      : `Submit <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
  if (textarea) textarea.disabled = disabled;
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const icons = {
    success: "✓",
    error:   "✕",
    warning: "⚠",
    info:    "ℹ",
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || "ℹ"}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function startFresh() {
  State.sessionId      = null;
  State.currentQuestion = null;
  State.questionNumber = 1;
  State.totalQuestions = 5;
  State.scores         = [];
  stopTimer();
  showScreen("screen-home");
}

function printReport() {
  window.print();
}
