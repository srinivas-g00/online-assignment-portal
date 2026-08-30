// frontend/js/student.js
(function () {
  const user = requireLogin("student");
  if (!user) return;
  const $ = (id) => document.getElementById(id);

  // ---------- Tabs ----------
  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ["faculties", "courses", "marks", "exams"].forEach((t) => {
        const el = $(`tab-${t}`);
        if (el) el.classList.add("hidden");
      });
      const activeTabEl = $(`tab-${btn.dataset.tab}`);
      if (activeTabEl) activeTabEl.classList.remove("hidden");

      if ($("facultyDetailWrap")) $("facultyDetailWrap").classList.add("hidden");
      if (btn.dataset.tab === "courses") loadCourses();
      if (btn.dataset.tab === "marks") loadMarks();
      if (btn.dataset.tab === "exams") loadExams();
    };
  });

  async function init() {
    try {
      const me = await api("/api/student/me");
      if ($("studentName")) $("studentName").textContent = me.name || user.name;
      if ($("studentUsername")) {
        $("studentUsername").textContent =
          "@" + (me.username || user.username) + (me.branch ? " · " + me.branch : "");
      }
      if ($("avatarInitial")) {
        $("avatarInitial").textContent = (me.name || user.name || "S")[0].toUpperCase();
      }
      await loadFaculties();
    } catch (err) {
      console.error("Student init error:", err.message || err);
    }
  }

  // ---------- Faculty list + search ----------
  let searchTimer;
  if ($("facSearch")) {
    $("facSearch").oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadFaculties, 250);
    };
  }

  async function loadFaculties() {
    try {
      const searchVal = $("facSearch") ? $("facSearch").value : "";
      const rows = await api("/api/student/faculties?search=" + encodeURIComponent(searchVal));
      const listEl = $("facultyList");
      if (!listEl) return;

      listEl.innerHTML = rows && rows.length
        ? rows
            .map(
              (f) => `
          <div class="mini-card" data-fac="${f.id}" style="cursor:pointer">
            <h4>${escapeHtml(f.name)}</h4>
            <p>${escapeHtml(f.subject || "Subject not set")}</p>
            <p>${escapeHtml(f.branch || "")} ${f.slot ? "· " + escapeHtml(f.slot) : ""}</p>
            ${f.enrollStatus ? `<span class="status-pill status-${f.enrollStatus}">${f.enrollStatus}</span>` : `<span class="note">Not registered</span>`}
          </div>`
            )
            .join("")
        : `<div class="empty">No faculties matched your search.</div>`;

      document
        .querySelectorAll("[data-fac]")
        .forEach((c) => (c.onclick = () => openFaculty(c.dataset.fac)));
    } catch (err) {
      console.error("loadFaculties error:", err.message || err);
    }
  }

  // ---------- Faculty detail ----------
  async function openFaculty(id) {
    try {
      const fac = await api(`/api/student/faculties/${id}`);
      if ($("facultyDetailWrap")) $("facultyDetailWrap").classList.remove("hidden");
      if (!$("facultyDetail")) return;

      let html = `
        <h2>${escapeHtml(fac.name)}</h2>
        <div class="meta-row" style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="pill">Subject: ${escapeHtml(fac.subject || "—")}</span>
          <span class="pill">Branch: ${escapeHtml(fac.branch || "—")}</span>
          <span class="pill">Slot: ${escapeHtml(fac.slot || "—")}</span>
        </div>`;

      if (!fac.enrollStatus) {
        html += `<button class="btn" id="enrollBtn" style="margin-top:14px">Register under this faculty</button>`;
      } else if (fac.enrollStatus === "pending") {
        html += `<div class="open-banner" style="margin-top:14px">Registration pending faculty approval.</div>`;
      } else if (fac.enrollStatus === "rejected") {
        html += `<div class="closed-banner" style="margin-top:14px">Your registration request was not accepted.</div>`;
      } else {
        html += `<div id="facultyAssignments" style="margin-top:16px"></div>`;
      }
      $("facultyDetail").innerHTML = html;

      if ($("enrollBtn")) {
        $("enrollBtn").onclick = async () => {
          try {
            await api(`/api/student/faculties/${id}/enroll`, { method: "POST" });
            notice("Request sent", "Your registration request was sent to the faculty for approval.");
            openFaculty(id);
            loadFaculties();
          } catch (e) {
            notice("Could not register", e.message, "err");
          }
        };
      }
      if (fac.enrollStatus === "accepted") loadAssignments(id);
    } catch (err) {
      notice("Error loading faculty", err.message, "err");
    }
  }

  async function loadAssignments(facultyId) {
    try {
      const rows = await api(`/api/student/faculties/${facultyId}/assignments`);
      const assignWrap = $("facultyAssignments");
      if (!assignWrap) return;

      assignWrap.innerHTML = rows && rows.length
        ? `<h3>Assignments</h3>` + rows.map(renderAssignment).join("")
        : `<div class="empty">No assignments posted yet.</div>`;
      if (rows && rows.length) rows.forEach(bindAssignment);
    } catch (err) {
      console.error("loadAssignments error:", err.message || err);
    }
  }

  function renderAssignment(a) {
    const timePart = (a.due_time || "23:59:59").slice(0, 8);
    const datePart = (a.due_date || "").split("T")[0].split(" ")[0];
    const dueMs = new Date(`${datePart}T${timePart}`).getTime();
    const closed = a.closed || (!isNaN(dueMs) && dueMs < Date.now());
    
    const qFileName = (a.question_file || "").split(/[/\\]/).pop();
    const subFileName = (a.file_path || "").split(/[/\\]/).pop();
    const subDisplayName = a.file_original || subFileName || "Uploaded Document";

    return `
    <div class="mini-card" style="margin-bottom:14px">
      <h4>${escapeHtml(a.title)}</h4>
      <p>${escapeHtml(a.description || "No instructions provided.")}</p>
      <p><span class="pill">Total: ${a.total_marks}</span> <span class="pill deadline">Due: ${escapeHtml(datePart)} ${escapeHtml(timePart)}</span></p>
      ${closed ? `<div class="closed-banner">Submission closed.</div>` : `<div class="open-banner">Open for submission.</div>`}
      
      ${a.question_file ? `<div style="margin: 8px 0;"><a href="/uploads/questions/${encodeURIComponent(qFileName)}" target="_blank" style="color:#4f46e5;font-weight:600;text-decoration:underline;">📄 View question paper</a></div>` : ""}
      
      ${
        a.submission_id
          ? `<div class="submitted-box" style="background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;margin-top:10px;">
              <p style="margin:0 0 6px 0;font-size:14px;color:#1e293b;">
                <strong>Your Submission:</strong> 
                <a href="/uploads/answers/${encodeURIComponent(subFileName)}" target="_blank" download="${escapeHtml(subDisplayName)}" style="color:#4f46e5;text-decoration:underline;font-weight:600;">
                  📄 ${escapeHtml(subDisplayName)}
                </a>
              </p>
              <p class="note" style="margin:0 0 6px 0;">Submitted on: ${fmtDateTime(a.submitted_at)}</p>
              <p style="margin:0;font-size:13px;color:#475569;">
                Marks: ${a.posted ? `<b style="color:#16a34a;">${a.final_marks}/${a.total_marks}</b>` : "<em>not posted yet</em>"}
              </p>
            </div>
            ${!closed ? `<button class="btn secondary" style="margin-top:10px;" data-modify="${a.id}" data-sub="${a.submission_id}">Modify submission (OTP required)</button>` : ""}`
          : !closed
          ? `<div class="filebox" style="margin-top:10px">
               <input type="file" id="file-${a.id}">
               <button class="btn" style="margin-top:8px" data-submit="${a.id}">Submit answer</button>
             </div>`
          : `<p class="note" style="margin-top:8px;">No submission was made before the deadline.</p>`
      }
    </div>`;
  }

  function bindAssignment(a) {
    const submitBtn = document.querySelector(`[data-submit="${a.id}"]`);
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const fileInput = document.getElementById(`file-${a.id}`);
        const file = fileInput ? fileInput.files[0] : null;
        if (!file) return notice("No file chosen", "Select a file to upload (max 5MB, any type).", "err");
        if (file.size > 5 * 1024 * 1024) return notice("File too large", "Maximum allowed size is 5MB.", "err");

        const fd = new FormData();
        fd.append("file", file);
        try {
          await api(`/api/student/assignments/${a.id}/submit`, {
            method: "POST",
            isForm: true,
            body: fd,
          });
          notice("Submitted", "Your answer was submitted successfully.");
          openFaculty(a.faculty_id);
        } catch (e) {
          notice("Submission failed", e.message, "err");
        }
      };
    }

    const modifyBtn = document.querySelector(`[data-modify="${a.id}"]`);
    if (modifyBtn) modifyBtn.onclick = () => requestModifyOtp(a);
  }

  async function requestModifyOtp(a) {
    try {
      await api(`/api/student/submissions/${a.submission_id}/request-modify-otp`, {
        method: "POST",
      });
    } catch (e) {
      return notice("Could not send OTP", e.message, "err");
    }

    openModal(
      "Verify to modify submission",
      `
      <p class="note">Enter the OTP code sent to your registered email to replace your file.</p>
      <div class="field" style="margin-top:10px;"><label>New file (max 5MB, any type)</label><input type="file" id="modFile"></div>
      <div class="otp-boxes" style="margin-top:10px;">
        <div class="field"><label>Email OTP Code</label><input id="modEmailOtp" maxlength="6" placeholder="e.g. 123456"></div>
      </div>
      <div class="error-inline hidden" id="modErr"></div>
      <div class="row-buttons" style="margin-top:15px;">
        <button class="btn" id="modConfirm">Verify & Replace</button>
      </div>
    `
    );

    document.getElementById("modConfirm").onclick = async () => {
      const fileInput = document.getElementById("modFile");
      const file = fileInput ? fileInput.files[0] : null;
      const errBox = document.getElementById("modErr");
      errBox.classList.add("hidden");

      if (!file) {
        errBox.textContent = "Choose a replacement file.";
        errBox.classList.remove("hidden");
        return;
      }

      const emailOtp = document.getElementById("modEmailOtp").value.trim();
      if (!emailOtp) {
        errBox.textContent = "Please enter the OTP code.";
        errBox.classList.remove("hidden");
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("emailOtp", emailOtp);

      try {
        await api(`/api/student/submissions/${a.submission_id}/modify`, {
          method: "POST",
          isForm: true,
          body: fd,
        });
        closeModal();
        notice("Submission replaced", "Your latest file is now the active submission.");
        openFaculty(a.faculty_id);
      } catch (e) {
        errBox.textContent = e.message;
        errBox.classList.remove("hidden");
      }
    };
  }

  // ---------- My courses ----------
  async function loadCourses() {
    try {
      const rows = await api("/api/student/my-courses");
      const listEl = $("coursesList");
      if (!listEl) return;

      listEl.innerHTML = rows && rows.length
        ? rows
            .map(
              (c) => `<div class="mini-card"><h4>${escapeHtml(c.name)}</h4><p>${escapeHtml(c.subject || "")}</p>
              <span class="status-pill status-${c.status}">${c.status}</span></div>`
            )
            .join("")
        : `<div class="empty">You haven't registered under any faculty yet.</div>`;
    } catch (err) {
      console.error("loadCourses error:", err.message || err);
    }
  }

  // ---------- Marks ----------
  async function loadMarks() {
    try {
      const rows = await api("/api/student/marks");
      const bodyEl = $("marksBody");
      if (!bodyEl) return;

      bodyEl.innerHTML = rows && rows.length
        ? rows
            .map(
              (r) => `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.faculty_name)}</td>
              <td>${fmtDateTime(r.submitted_at)}</td>
              <td>${r.posted ? `<span class="marks">${r.final_marks}/${r.total_marks}</span>` : "Not posted yet"}</td></tr>`
            )
            .join("")
        : `<tr><td colspan="4" class="empty">No submissions yet.</td></tr>`;
    } catch (err) {
      console.error("loadMarks error:", err.message || err);
    }
  }

  // ---------- Exams ----------
  async function loadExams() {
    try {
      const rows = await api("/api/student/exams");
      const listEl = $("examsList");
      if (!listEl) return;

      listEl.innerHTML = rows && rows.length
        ? rows
            .map((ex) => {
              const startTime = ex.start_time || "00:00:00";
              const start = new Date(`${ex.exam_date}T${startTime}`);
              const durationMin = Number(ex.duration_min) || 30;
              const end = new Date(start.getTime() + durationMin * 60000);
              const now = new Date();
              let status = "";

              if (ex.submitted_at) {
                status = ex.posted
                  ? `Result: <b>${ex.score != null ? ex.score : 0}/${ex.total_marks}</b>`
                  : "Submitted - awaiting result";
              } else if (now < start) {
                status = `Starts ${start.toLocaleString()}`;
              } else if (now > end) {
                status = "Missed / window closed";
              } else {
                status = `<button class="btn" data-exam="${ex.id}">Start exam</button>`;
              }

              return `<div class="mini-card"><h4>${escapeHtml(ex.title)}</h4><p>${escapeHtml(ex.faculty_name)}</p>
                <p>${escapeHtml(ex.exam_date)} ${escapeHtml(ex.start_time)} · ${durationMin} min · ${ex.total_marks} marks</p>
                <p style="margin-top:8px;">${status}</p></div>`;
            })
            .join("")
        : `<div class="empty">No exams available yet.</div>`;

      document
        .querySelectorAll("[data-exam]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              (window.location.href = `exam-take.html?examId=${b.dataset.exam}`))
        );
    } catch (err) {
      console.error("loadExams error:", err.message || err);
    }
  }

  init();
})();