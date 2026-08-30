// frontend/js/exam-take.js
(function () {
  const user = requireLogin("student");
  if (!user) return;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(window.location.search);
  const examId = params.get("examId");
  if (!examId) {
    window.location.href = "student.html";
    return;
  }

  let attemptId = null,
    secondsLeft = 0,
    timerHandle = null,
    submitted = false;
  const answers = {}; // questionId -> 'A'|'B'|'C'|'D'

  async function start() {
    let data;
    try {
      data = await api(`/api/exams/${examId}/start`, { method: "POST" });
    } catch (e) {
      notice("Cannot start exam", e.message, "err");
      setTimeout(() => (window.location.href = "student.html"), 1800);
      return;
    }

    attemptId = data.attemptId;
    secondsLeft = Number(data.secondsLeft) || 0;

    if ($("examTitle") && data.exam) {
      $("examTitle").textContent = `${data.exam.title} (${data.exam.totalMarks || 0} marks)`;
    }

    renderQuestions(data.questions || []);
    tick();
    timerHandle = setInterval(tick, 1000);
  }

  function renderQuestions(questions) {
    // Robust fallback to locate the questions container in HTML
    const root =
      $("questionsRoot") ||
      document.querySelector(".questions-wrap") ||
      document.querySelector("#questionsWrap") ||
      document.querySelector(".exam-content");

    if (!root) return;

    if (!questions || !questions.length) {
      root.innerHTML = `<div class="empty" style="padding: 24px; text-align: center; color: #64748b;">No questions found for this exam.</div>`;
      return;
    }

    root.innerHTML = questions
      .map(
        (q, i) => `
      <div class="q-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <h4 style="margin: 0 0 12px 0; color: #1e293b; font-size: 16px;">
          Q${i + 1}. ${escapeHtml(q.question_text || "")} 
          <small class="note" style="font-size: 12px; color: #64748b; font-weight: normal;">(${q.marks || 1} mark${(q.marks || 1) > 1 ? "s" : ""})</small>
        </h4>
        <div class="options-container" style="display: flex; flex-direction: column; gap: 8px;">
          ${["A", "B", "C", "D"]
            .map((opt) => {
              const optText = q["option_" + opt.toLowerCase()] || "";
              return `
            <div class="opt" data-qid="${q.id}" data-opt="${opt}" style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; transition: all 0.2s ease;">
              <b style="color: #4f46e5; min-width: 20px;">${opt}.</b> 
              <span style="color: #334155;">${escapeHtml(optText)}</span>
            </div>`;
            })
            .join("")}
        </div>
      </div>`
      )
      .join("");

    root.querySelectorAll(".opt").forEach((el) => {
      el.onclick = () => {
        if (submitted) return;
        const qid = el.dataset.qid;
        const opt = el.dataset.opt;

        // Reset styling on sibling options for the same question
        root.querySelectorAll(`.opt[data-qid="${qid}"]`).forEach((o) => {
          o.classList.remove("selected");
          o.style.borderColor = "#cbd5e1";
          o.style.background = "#ffffff";
        });

        // Apply selected state
        el.classList.add("selected");
        el.style.borderColor = "#4f46e5";
        el.style.background = "#eef2ff";
        answers[qid] = opt;

        // Autosave answer
        api(`/api/exams/attempts/${attemptId}/answer`, {
          method: "POST",
          body: { questionId: qid, selected: opt },
        }).catch((err) => {
          console.warn("Autosave answer failed:", err.message);
        });
      };
    });
  }

  function tick() {
    if (submitted) return;
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;

    if ($("clock")) {
      $("clock").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    if ($("timerBar")) {
      $("timerBar").classList.toggle("low", secondsLeft <= 60);
    }

    if (secondsLeft <= 0) {
      doSubmit(true);
      return;
    }
    secondsLeft--;
  }

  async function doSubmit(auto) {
    if (submitted) return;
    submitted = true;
    clearInterval(timerHandle);

    if ($("submitExamBtn")) {
      $("submitExamBtn").disabled = true;
    }

    try {
      const res = await api(`/api/exams/attempts/${attemptId}/submit`, {
        method: "POST",
        body: { autoSubmitted: !!auto },
      });

      notice(
        auto ? "Time's up" : "Exam submitted",
        auto
          ? "The exam was auto-submitted when the timer ended."
          : `Your exam has been submitted successfully. Score: ${res.score != null ? res.score : "Recorded"}`
      );
      setTimeout(() => (window.location.href = "student.html"), 2000);
    } catch (e) {
      notice("Submit failed", e.message, "err");
      submitted = false;
      if ($("submitExamBtn")) $("submitExamBtn").disabled = false;
    }
  }

  if ($("submitExamBtn")) {
    $("submitExamBtn").onclick = () => {
      if (confirm("Submit the exam now? You cannot change answers after submitting.")) {
        doSubmit(false);
      }
    };
  }

  window.addEventListener("beforeunload", (e) => {
    if (!submitted) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  start();
})();