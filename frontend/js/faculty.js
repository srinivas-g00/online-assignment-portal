// frontend/js/faculty.js
(function () {
  const user = requireLogin("faculty");
  if (!user) return;
  const $ = (id) => document.getElementById(id);
  let questionRowCount = 0;

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["requests", "assignments", "newAssignment", "exams", "newExam"].forEach((t) => {
        const el = $(`tab-${t}`);
        if (el) el.classList.add("hidden");
      });

      const activeTabEl = $(`tab-${btn.dataset.tab}`);
      if (activeTabEl) activeTabEl.classList.remove("hidden");

      if (btn.dataset.tab === "requests") loadRequests();
      if (btn.dataset.tab === "assignments") loadAssignments();
      if (btn.dataset.tab === "exams") loadExams();
    };
  });

  async function init() {
    try {
      const me = await api("/api/faculty/me");
      if ($("facName")) $("facName").textContent = me.name || user.name;
      if ($("facSubject")) {
        $("facSubject").textContent =
          (me.subject || "Subject not set") + (me.slot ? " · " + me.slot : "");
      }
      if ($("avatarInitial")) {
        $("avatarInitial").textContent = (me.name || user.name || "F")[0].toUpperCase();
      }
      await loadRequests();
      addQuestionRow();
    } catch (err) {
      console.error("Faculty init error:", err.message || err);
    }
  }

  // ---------- Student registration requests ----------
  async function loadRequests() {
    try {
      const rows = await api("/api/faculty/students?status=pending");
      const listEl = $("requestsList");
      if (!listEl) return;

      listEl.innerHTML = rows && rows.length
        ? rows
            .map(
              (r) => `
          <div class="mini-card">
            <h4>${escapeHtml(r.name)}</h4>
            <p>@${escapeHtml(r.username)} ${r.branch ? "· " + escapeHtml(r.branch) : ""} ${r.year ? "· " + escapeHtml(r.year) : ""}</p>
            <div class="row-buttons">
              <button class="btn success" data-accept="${r.enrollment_id}">Accept</button>
              <button class="btn danger" data-reject="${r.enrollment_id}">Reject</button>
            </div>
          </div>`
            )
            .join("")
        : `<div class="empty">No pending registration requests.</div>`;

      document
        .querySelectorAll("[data-accept]")
        .forEach((b) => (b.onclick = () => decide(b.dataset.accept, "accepted")));
      document
        .querySelectorAll("[data-reject]")
        .forEach((b) => (b.onclick = () => decide(b.dataset.reject, "rejected")));
    } catch (e) {
      console.error("loadRequests error:", e.message || e);
    }
  }

  async function decide(enrollmentId, decision) {
    try {
      await api(`/api/faculty/students/${enrollmentId}/decision`, {
        method: "POST",
        body: { decision },
      });
      notice("Done", `Student ${decision}.`);
      loadRequests();
    } catch (e) {
      notice("Failed", e.message, "err");
    }
  }

  // ---------- Post assignment ----------
  if ($("postAssignmentBtn")) {
    $("postAssignmentBtn").onclick = async () => {
      const title = $("newTitle").value.trim();
      const totalMarks = $("newTotalMarks").value;
      const dueDate = $("newDueDate").value;
      const dueTime = $("newDueTime").value;

      if (!title || !totalMarks || !dueDate || !dueTime) {
        return notice("Missing fields", "Title, total marks, due date and due time are required.", "err");
      }

      const fd = new FormData();
      fd.append("title", title);
      fd.append("description", $("newDesc").value.trim());
      fd.append("totalMarks", totalMarks);
      fd.append("dueDate", dueDate);
      fd.append("dueTime", dueTime);
      if ($("newQFile") && $("newQFile").files[0]) {
        fd.append("questionFile", $("newQFile").files[0]);
      }

      try {
        await api("/api/faculty/assignments", { method: "POST", isForm: true, body: fd });
        notice("Posted", "Assignment posted to your enrolled students.");
        $("newTitle").value = "";
        $("newDesc").value = "";
        if ($("newQFile")) $("newQFile").value = "";
        loadAssignments();
      } catch (e) {
        notice("Failed", e.message, "err");
      }
    };
  }

  // ---------- Assignments list ----------
  async function loadAssignments() {
    try {
      const rows = await api("/api/faculty/assignments");
      const listEl = $("assignmentsList");
      if (!listEl) return;

      listEl.innerHTML = rows && rows.length
        ? `<table><thead><tr><th>Title</th><th>Due</th><th>Total</th><th>Submissions</th><th></th></tr></thead><tbody>
            ${rows
              .map((a) => {
                const timePart = (a.due_time || "23:59:59").slice(0, 8);
                const datePart = (a.due_date || "").split("T")[0].split(" ")[0];
                return `<tr>
              <td><b>${escapeHtml(a.title)}</b></td>
              <td>${escapeHtml(datePart)} ${escapeHtml(timePart)} ${a.closed ? '<span class="status-pill status-rejected">closed</span>' : '<span class="status-pill status-accepted">open</span>'}</td>
              <td>${a.total_marks}</td><td>${a.submission_count}</td>
              <td><button class="btn secondary" data-open="${a.id}">Open</button></td>
            </tr>`;
              })
              .join("")}
          </tbody></table>`
        : `<div class="empty">You haven't posted any assignments yet.</div>`;

      document
        .querySelectorAll("[data-open]")
        .forEach((b) => (b.onclick = () => openAssignment(b.dataset.open)));
    } catch (e) {
      console.error("loadAssignments error:", e.message || e);
    }
  }

  async function openAssignment(id) {
    try {
      const { assignment: a, submissions } = await api(`/api/faculty/assignments/${id}/submissions`);
      if ($("assignmentDetailWrap")) $("assignmentDetailWrap").classList.remove("hidden");
      if (!$("assignmentDetail")) return;

      const timePart = (a.due_time || "23:59:59").slice(0, 8);
      const datePart = (a.due_date || "").split("T")[0].split(" ")[0];
      const qFileName = (a.question_file || "").split(/[/\\]/).pop();
      const duplicateList = submissions ? submissions.filter((s) => s.duplicate_flag) : [];

      $("assignmentDetail").innerHTML = `
        <h2>${escapeHtml(a.title)}</h2>
        <p>${escapeHtml(a.description || "")}</p>
        <p><span class="pill">Total: ${a.total_marks}</span> <span class="pill deadline">Due: ${escapeHtml(datePart)} ${escapeHtml(timePart)}</span></p>

        ${a.question_file ? `<div style="margin: 10px 0;"><a href="/uploads/questions/${encodeURIComponent(qFileName)}" target="_blank" style="color:#4f46e5;font-weight:600;text-decoration:underline;">📄 Download Question Paper (${escapeHtml(a.question_original || qFileName)})</a></div>` : ""}

        <div class="filebox" style="margin:16px 0; background:#f8fafc; border:1px solid #cbd5e1; padding:16px; border-radius:8px;">
          <h4 style="margin-top:0;">Auto-correction & Cross-Duplicate Detection</h4>
          <div class="field"><label>Answer key (text / keywords / rubric)</label><textarea id="keyText" rows="3">${escapeHtml(a.answer_key || "")}</textarea></div>
          <div class="field"><label>Or upload an answer-key document</label><input type="file" id="keyFile"></div>

          <div class="two-col" style="margin-top:10px;">
            <div class="field">
              <label>Match % to get Full Marks</label>
              <input type="number" id="matchThreshold" value="70" min="1" max="100">
            </div>
            <div class="field">
              <label>Marks to deduct for Duplicates</label>
              <input type="number" id="duplicatePenalty" value="5" min="0" max="${a.total_marks}">
            </div>
          </div>

          <div class="row-buttons" style="margin-top:14px;">
            <button class="btn secondary" id="saveKeyBtn">Save answer key</button>
            <button class="btn" id="runCorrectionBtn">Run auto-correction</button>
          </div>
          <p class="note" style="margin-top:8px;">Cross-compares student documents for duplicates and grades answers against the answer key.</p>
        </div>

        <h3>Submissions (${submissions.length})</h3>
        ${
          submissions.length
            ? `<table><thead><tr><th>Student</th><th>File</th><th>Submitted</th><th>Similarity</th><th>Marks</th><th>AI Feedback</th><th>Action</th></tr></thead><tbody>
          ${submissions
            .map((s) => {
              const fileName = (s.file_path || "").split(/[/\\]/).pop();
              const displayName = s.file_original || fileName || "Submission File";
              return `<tr>
            <td><b>${escapeHtml(s.student_name)}</b><br><small>@${escapeHtml(s.student_username)}</small></td>
            <td>
              <a href="/uploads/answers/${encodeURIComponent(fileName)}" target="_blank" download="${escapeHtml(displayName)}" style="color:#4f46e5;font-weight:600;text-decoration:underline;">
                📄 ${escapeHtml(displayName)}
              </a>
              ${s.duplicate_flag ? `<br><span class="status-pill status-rejected" style="margin-top:4px;display:inline-block;font-size:11px;">⚠️ DUPLICATE</span>` : ""}
              ${s.resubmit_count ? `<br><small>resubmitted ${s.resubmit_count}x</small>` : ""}
            </td>
            <td>${fmtDateTime(s.submitted_at)}</td>
            <td><b>${s.similarity_pct != null ? s.similarity_pct + "%" : "—"}</b></td>
            <td><span class="marks">${s.final_marks == null ? "—" : s.final_marks + "/" + a.total_marks}</span><br><small>${s.posted ? "Posted" : "Not posted"}</small></td>
            <td><small style="color:${s.duplicate_flag ? '#dc2626' : '#334155'}">${s.auto_feedback ? escapeHtml(s.auto_feedback) : "—"}</small></td>
            <td><div class="row-buttons">
              <button class="btn secondary" data-edit="${s.id}">Change marks</button>
              <button class="btn ${s.posted ? "secondary" : "success"}" data-post="${s.id}" ${s.final_marks == null ? "disabled" : ""}>${s.posted ? "Posted" : "Post marks"}</button>
            </div></td>
          </tr>`;
            })
            .join("")}
        </tbody></table>`
            : `<div class="empty">No submissions yet.</div>`
        }

        ${
          duplicateList.length
            ? `<div class="mini-card" style="margin-top:20px; border-left: 4px solid #ef4444; background:#fff5f5;">
                 <h4 style="color:#b91c1c; margin-top:0;">⚠️ Duplicate Alert</h4>
                 <p style="margin-bottom:8px;">The following submitted documents were detected as similar to other student files:</p>
                 <ul style="margin:0; padding-left:20px; font-size:14px; color:#991b1b;">
                   ${duplicateList.map((d) => `<li><b>${escapeHtml(d.student_name)}</b> (@${escapeHtml(d.student_username)}) — <code>${escapeHtml(d.file_original || d.file_path)}</code></li>`).join("")}
                 </ul>
               </div>`
            : ""
        }
      `;

      $("saveKeyBtn").onclick = async () => {
        const fd = new FormData();
        fd.append("keyText", $("keyText").value.trim());
        if ($("keyFile").files[0]) fd.append("keyFile", $("keyFile").files[0]);
        try {
          await api(`/api/faculty/assignments/${id}/answer-key`, {
            method: "POST",
            isForm: true,
            body: fd,
          });
          notice("Saved", "Answer key saved.");
        } catch (e) {
          notice("Failed", e.message, "err");
        }
      };

      $("runCorrectionBtn").onclick = async () => {
        try {
          const matchThreshold = $("matchThreshold").value;
          const penaltyMarks = $("duplicatePenalty").value;

          await api(`/api/faculty/assignments/${id}/auto-correct`, {
            method: "POST",
            body: { matchThreshold, penaltyMarks },
          });
          notice("Auto-correction complete", "Duplicates analyzed and marks updated.");
          openAssignment(id);
        } catch (e) {
          notice("Failed", e.message, "err");
        }
      };

      document
        .querySelectorAll("[data-edit]")
        .forEach((b) => (b.onclick = () => editMarks(b.dataset.edit, a, id)));
      document
        .querySelectorAll("[data-post]")
        .forEach((b) => (b.onclick = () => postMarks(b.dataset.post, id)));
    } catch (err) {
      notice("Error loading assignment", err.message, "err");
    }
  }

  function editMarks(subId, a, assignmentId) {
    openModal(
      "Change marks",
      `
      <div class="field"><label>New marks (out of ${a.total_marks})</label><input id="marksInput" type="number" min="0" max="${a.total_marks}"></div>
      <button class="btn" id="saveMarksBtn">Save</button>
    `
    );

    document.getElementById("saveMarksBtn").onclick = async () => {
      try {
        await api(`/api/faculty/submissions/${subId}/marks`, {
          method: "PUT",
          body: { marks: document.getElementById("marksInput").value },
        });
        closeModal();
        openAssignment(assignmentId);
      } catch (e) {
        notice("Failed", e.message, "err");
      }
    };
  }

  async function postMarks(subId, assignmentId) {
    try {
      await api(`/api/faculty/submissions/${subId}/post`, { method: "POST" });
      openAssignment(assignmentId);
    } catch (e) {
      notice("Failed", e.message, "err");
    }
  }

  // ---------- Exams ----------
  async function loadExams() {
    try {
      const rows = await api("/api/faculty/exams");
      const listEl = $("examsList");
      if (!listEl) return;

      listEl.innerHTML = rows && rows.length
        ? `<table><thead><tr><th>Title</th><th>Date/Time</th><th>Duration</th><th>Total</th><th></th></tr></thead><tbody>
            ${rows
              .map(
                (e) => `<tr><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.exam_date)} ${escapeHtml(e.start_time)}</td>
              <td>${e.duration_min} min</td><td>${e.total_marks}</td>
              <td><button class="btn secondary" data-results="${e.id}">Results</button></td></tr>`
              )
              .join("")}
          </tbody></table>`
        : `<div class="empty">You haven't created any exams yet.</div>`;

      document
        .querySelectorAll("[data-results]")
        .forEach((b) => (b.onclick = () => openResults(b.dataset.results)));
    } catch (e) {
      console.error("loadExams error:", e.message || e);
    }
  }

  async function openResults(examId) {
    try {
      const { exam, results } = await api(`/api/faculty/exams/${examId}/results`);
      if ($("examResultsWrap")) $("examResultsWrap").classList.remove("hidden");
      if (!$("examResults")) return;

      $("examResults").innerHTML = `<h2>${escapeHtml(exam.title)} - Results</h2>
        ${
          results.length
            ? `<table><thead><tr><th>Student</th><th>Submitted</th><th>Auto-submitted</th><th>Score</th><th>Action</th></tr></thead><tbody>
          ${results
            .map(
              (r) => `<tr>
            <td><b>${escapeHtml(r.student_name)}</b><br><small>@${escapeHtml(r.student_username)}</small></td>
            <td>${fmtDateTime(r.submitted_at)}</td><td>${r.auto_submitted ? "Yes (timer)" : "No"}</td>
            <td><span class="marks">${r.score == null ? "—" : r.score + "/" + exam.total_marks}</span><br><small>${r.posted ? "Posted" : "Not posted"}</small></td>
            <td><div class="row-buttons">
              <button class="btn secondary" data-editscore="${r.id}">Edit</button>
              <button class="btn ${r.posted ? "secondary" : "success"}" data-postscore="${r.id}" ${r.score == null ? "disabled" : ""}>${r.posted ? "Posted" : "Post"}</button>
            </div></td>
          </tr>`
            )
            .join("")}</tbody></table>`
            : `<div class="empty">No attempts yet.</div>`
        }`;

      document
        .querySelectorAll("[data-editscore]")
        .forEach((b) => (b.onclick = () => editScore(b.dataset.editscore, exam, examId)));
      document.querySelectorAll("[data-postscore]").forEach((b) => {
        b.onclick = async () => {
          try {
            await api(`/api/faculty/exam-attempts/${b.dataset.postscore}/post`, { method: "POST" });
            openResults(examId);
          } catch (e) {
            notice("Failed", e.message, "err");
          }
        };
      });
    } catch (e) {
      notice("Failed to load results", e.message, "err");
    }
  }

  function editScore(attemptId, exam, examId) {
    openModal(
      "Edit score",
      `<div class="field"><label>Score (out of ${exam.total_marks})</label><input id="scoreInput" type="number" min="0" max="${exam.total_marks}"></div>
       <button class="btn" id="saveScoreBtn">Save</button>`
    );
    document.getElementById("saveScoreBtn").onclick = async () => {
      try {
        await api(`/api/faculty/exam-attempts/${attemptId}/score`, {
          method: "PUT",
          body: { score: document.getElementById("scoreInput").value },
        });
        closeModal();
        openResults(examId);
      } catch (e) {
        notice("Failed", e.message, "err");
      }
    };
  }

  // ---------- Create exam ----------
  if ($("addQuestionBtn")) $("addQuestionBtn").onclick = () => addQuestionRow();

  function addQuestionRow() {
    questionRowCount++;
    const n = questionRowCount;
    const div = document.createElement("div");
    div.className = "mini-card";
    div.id = `q-${n}`;
    div.innerHTML = `
      <div class="field"><label>Question ${n}</label><input class="q-text"></div>
      <div class="two-col">
        <div class="field"><label>Option A</label><input class="q-a"></div>
        <div class="field"><label>Option B</label><input class="q-b"></div>
      </div>
      <div class="two-col">
        <div class="field"><label>Option C</label><input class="q-c"></div>
        <div class="field"><label>Option D</label><input class="q-d"></div>
      </div>
      <div class="two-col">
        <div class="field"><label>Correct option</label>
          <select class="q-correct"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select>
        </div>
        <div class="field"><label>Marks</label><input class="q-marks" type="number" value="1" min="1"></div>
      </div>
      <button class="btn ghost" type="button" onclick="document.getElementById('q-${n}').remove()">Remove question</button>
    `;
    if ($("questionsWrap")) $("questionsWrap").appendChild(div);
  }

  if ($("createExamBtn")) {
    $("createExamBtn").onclick = async () => {
      const title = $("examTitle").value.trim();
      const examDate = $("examDate").value,
        startTime = $("examStart").value,
        durationMin = $("examDuration").value;
      if (!title || !examDate || !startTime || !durationMin) {
        return notice("Missing fields", "Fill in title, date, start time and duration.", "err");
      }

      const questions = [];
      document.querySelectorAll("#questionsWrap .mini-card").forEach((card) => {
        questions.push({
          questionText: card.querySelector(".q-text").value.trim(),
          optionA: card.querySelector(".q-a").value.trim(),
          optionB: card.querySelector(".q-b").value.trim(),
          optionC: card.querySelector(".q-c").value.trim(),
          optionD: card.querySelector(".q-d").value.trim(),
          correctOption: card.querySelector(".q-correct").value,
          marks: card.querySelector(".q-marks").value,
        });
      });

      if (
        !questions.length ||
        questions.some(
          (q) => !q.questionText || !q.optionA || !q.optionB || !q.optionC || !q.optionD
        )
      ) {
        return notice("Incomplete questions", "Fill in every question and all four options.", "err");
      }

      try {
        await api("/api/faculty/exams", {
          method: "POST",
          body: { title, examDate, startTime, durationMin, questions },
        });
        notice("Exam created", "The MCQ exam was created for students accepted under you.");
        if ($("questionsWrap")) $("questionsWrap").innerHTML = "";
        questionRowCount = 0;
        addQuestionRow();
        $("examTitle").value = "";
      } catch (e) {
        notice("Failed", e.message, "err");
      }
    };
  }

  init();
})();