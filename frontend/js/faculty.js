// frontend/js/faculty.js

(function () {
  const user = requireLogin("faculty");

  if (!user) return;

  const $ = (id) => document.getElementById(id);

  let questionRowCount = 0;

  // ============================================================
  // NAVIGATION TABS
  // ============================================================

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.onclick = () => {
      document
        .querySelectorAll(".tabs button")
        .forEach((b) => b.classList.remove("active"));

      btn.classList.add("active");

      [
        "requests",
        "assignments",
        "newAssignment",
        "exams",
        "newExam",
      ].forEach((tab) => {
        const el = $(`tab-${tab}`);

        if (el) {
          el.classList.add("hidden");
        }
      });

      const activeTab = $(`tab-${btn.dataset.tab}`);

      if (activeTab) {
        activeTab.classList.remove("hidden");
      }

      if (btn.dataset.tab === "requests") {
        loadRequests();
      }

      if (btn.dataset.tab === "assignments") {
        loadAssignments();
      }

      if (btn.dataset.tab === "exams") {
        loadExams();
      }
    };
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {
    try {
      const me = await api("/api/faculty/me");

      if ($("facName")) {
        $("facName").textContent =
          me.name || user.name || "Faculty";
      }

      if ($("facSubject")) {
        $("facSubject").textContent =
          (me.subject || "Subject not set") +
          (me.slot ? " · " + me.slot : "");
      }

      if ($("avatarInitial")) {
        $("avatarInitial").textContent = (
          me.name ||
          user.name ||
          "F"
        )[0].toUpperCase();
      }

      await loadRequests();

      if ($("questionsWrap")) {
        addQuestionRow();
      }
    } catch (err) {
      console.error(
        "Faculty initialization error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // STUDENT REGISTRATION REQUESTS
  // ============================================================

  async function loadRequests() {
    try {
      const rows = await api(
        "/api/faculty/students?status=pending"
      );

      const listEl = $("requestsList");

      if (!listEl) return;

      if (!rows || !rows.length) {
        listEl.innerHTML =
          `<div class="empty">No pending registration requests.</div>`;

        return;
      }

      listEl.innerHTML = rows
        .map(
          (r) => `
            <div class="mini-card">
              <h4>${escapeHtml(r.name)}</h4>

              <p>
                @${escapeHtml(r.username)}
                ${r.branch
                  ? " · " + escapeHtml(r.branch)
                  : ""}
                ${r.year
                  ? " · " + escapeHtml(r.year)
                  : ""}
              </p>

              <div class="row-buttons">
                <button
                  class="btn success"
                  data-accept="${r.enrollment_id}"
                  type="button">
                  Accept
                </button>

                <button
                  class="btn danger"
                  data-reject="${r.enrollment_id}"
                  type="button">
                  Reject
                </button>
              </div>
            </div>
          `
        )
        .join("");

      document
        .querySelectorAll("[data-accept]")
        .forEach((button) => {
          button.onclick = () =>
            decide(
              button.dataset.accept,
              "accepted"
            );
        });

      document
        .querySelectorAll("[data-reject]")
        .forEach((button) => {
          button.onclick = () =>
            decide(
              button.dataset.reject,
              "rejected"
            );
        });
    } catch (err) {
      console.error(
        "loadRequests error:",
        err.message || err
      );
    }
  }

  async function decide(
    enrollmentId,
    decision
  ) {
    try {
      await api(
        `/api/faculty/students/${enrollmentId}/decision`,
        {
          method: "POST",
          body: {
            decision,
          },
        }
      );

      notice(
        "Done",
        `Student ${decision}.`
      );

      await loadRequests();
    } catch (err) {
      notice(
        "Failed",
        err.message || "Could not update request.",
        "err"
      );
    }
  }

  // ============================================================
  // POST ASSIGNMENT
  // ============================================================

  if ($("postAssignmentBtn")) {
    $("postAssignmentBtn").onclick =
      async () => {
        const title =
          $("newTitle").value.trim();

        const totalMarks =
          $("newTotalMarks").value;

        const dueDate =
          $("newDueDate").value;

        const dueTime =
          $("newDueTime").value;

        if (
          !title ||
          !totalMarks ||
          !dueDate ||
          !dueTime
        ) {
          return notice(
            "Missing fields",
            "Title, total marks, due date and due time are required.",
            "err"
          );
        }

        const fd = new FormData();

        fd.append("title", title);

        fd.append(
          "description",
          $("newDesc").value.trim()
        );

        fd.append(
          "totalMarks",
          totalMarks
        );

        fd.append(
          "dueDate",
          dueDate
        );

        fd.append(
          "dueTime",
          dueTime
        );

        if (
          $("newQFile") &&
          $("newQFile").files[0]
        ) {
          fd.append(
            "questionFile",
            $("newQFile").files[0]
          );
        }

        try {
          await api(
            "/api/faculty/assignments",
            {
              method: "POST",
              isForm: true,
              body: fd,
            }
          );

          notice(
            "Posted",
            "Assignment posted to your enrolled students."
          );

          $("newTitle").value = "";
          $("newDesc").value = "";

          if ($("newQFile")) {
            $("newQFile").value = "";
          }

          await loadAssignments();
        } catch (err) {
          notice(
            "Failed",
            err.message || "Could not post assignment.",
            "err"
          );
        }
      };
  }

  // ============================================================
  // ASSIGNMENTS LIST
  // ============================================================

  async function loadAssignments() {
    try {
      const rows = await api(
        "/api/faculty/assignments"
      );

      const listEl =
        $("assignmentsList");

      if (!listEl) return;

      if (!rows || !rows.length) {
        listEl.innerHTML =
          `<div class="empty">You haven't posted any assignments yet.</div>`;

        return;
      }

      listEl.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Due</th>
              <th>Total</th>
              <th>Submissions</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${rows
              .map((a) => {
                const timePart =
                  (
                    a.due_time ||
                    "23:59:59"
                  ).slice(0, 8);

                const datePart =
                  String(
                    a.due_date || ""
                  )
                    .split("T")[0]
                    .split(" ")[0];

                return `
                  <tr>
                    <td>
                      <b>
                        ${escapeHtml(
                          a.title
                        )}
                      </b>
                    </td>

                    <td>
                      ${escapeHtml(
                        datePart
                      )}
                      ${escapeHtml(
                        timePart
                      )}

                      ${
                        a.closed
                          ? `<span class="status-pill status-rejected">
                               closed
                             </span>`
                          : `<span class="status-pill status-accepted">
                               open
                             </span>`
                      }
                    </td>

                    <td>
                      ${a.total_marks}
                    </td>

                    <td>
                      ${a.submission_count}
                    </td>

                    <td>
                      <button
                        class="btn secondary"
                        data-open="${a.id}"
                        type="button">
                        Open
                      </button>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

      document
        .querySelectorAll("[data-open]")
        .forEach((button) => {
          button.onclick = () =>
            openAssignment(
              button.dataset.open
            );
        });
    } catch (err) {
      console.error(
        "loadAssignments error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // OPEN ASSIGNMENT
  // ============================================================

  async function openAssignment(id) {
    try {
      const response =
        await api(
          `/api/faculty/assignments/${id}/submissions`
        );

      const a =
        response.assignment;

      const submissions =
        response.submissions || [];

      if ($("assignmentDetailWrap")) {
        $("assignmentDetailWrap").classList.remove(
          "hidden"
        );
      }

      if (!$("assignmentDetail")) return;

      const timePart =
        (
          a.due_time ||
          "23:59:59"
        ).slice(0, 8);

      const datePart =
        String(
          a.due_date || ""
        )
          .split("T")[0]
          .split(" ")[0];

      const qFileName =
        (
          a.question_file ||
          ""
        ).split(/[/\\]/).pop();

      const duplicateList =
        submissions.filter(
          (s) => s.duplicate_flag
        );

      $("assignmentDetail").innerHTML = `
        <h2>
          ${escapeHtml(a.title)}
        </h2>

        <p>
          ${escapeHtml(
            a.description || ""
          )}
        </p>

        <p>
          <span class="pill">
            Total: ${a.total_marks}
          </span>

          <span class="pill deadline">
            Due:
            ${escapeHtml(datePart)}
            ${escapeHtml(timePart)}
          </span>
        </p>

        ${
          a.question_file
            ? `
              <div style="margin:10px 0;">
                <a
                href="/uploads/questions/${encodeURIComponent(qFileName)}"
                  )}/question-paper"
                  target="_blank"
                  style="color:#4f46e5;font-weight:600;text-decoration:underline;">
                  📄 View Question Paper
                  (${escapeHtml(
                    a.question_original ||
                      qFileName
                  )})
                </a>
              </div>
            `
            : ""
        }

        <div
          class="filebox"
          style="
            margin:16px 0;
            background:#f8fafc;
            border:1px solid #cbd5e1;
            padding:16px;
            border-radius:8px;
          ">

          <h4 style="margin-top:0;">
            Auto-correction & Cross-Duplicate Detection
          </h4>

          <div class="field">
            <label>
              Answer key
              (text / keywords / rubric)
            </label>

            <textarea
              id="keyText"
              rows="3">${escapeHtml(
                a.answer_key || ""
              )}</textarea>
          </div>

          <div class="field">
            <label>
              Or upload an answer-key document
            </label>

            <input
              type="file"
              id="keyFile">
          </div>

          <div
            class="two-col"
            style="margin-top:10px;">

            <div class="field">
              <label>
                Match % to get Full Marks
              </label>

              <input
                type="number"
                id="matchThreshold"
                value="70"
                min="1"
                max="100">
            </div>

            <div class="field">
              <label>
                Marks to deduct for Duplicates
              </label>

              <input
                type="number"
                id="duplicatePenalty"
                value="5"
                min="0"
                max="${a.total_marks}">
            </div>
          </div>

          <div
            class="row-buttons"
            style="margin-top:14px;">

            <button
              class="btn secondary"
              id="saveKeyBtn"
              type="button">
              Save answer key
            </button>

            <button
              class="btn"
              id="runCorrectionBtn"
              type="button">
              Run auto-correction
            </button>
          </div>
        </div>

        <h3>
          Submissions (${submissions.length})
        </h3>

        ${
          submissions.length
            ? `
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>File</th>
                    <th>Submitted</th>
                    <th>Similarity</th>
                    <th>Marks</th>
                    <th>AI Feedback</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  ${submissions
                    .map((s) => {
                      const fileName =
                        (
                          s.file_path ||
                          ""
                        )
                          .split(/[/\\]/)
                          .pop();

                      const displayName =
                        s.file_original ||
                        fileName ||
                        "Submission File";

                      return `
                        <tr>
                          <td>
                            <b>
                              ${escapeHtml(
                                s.student_name
                              )}
                            </b>
                            <br>
                            <small>
                              @${escapeHtml(
                                s.student_username
                              )}
                            </small>
                          </td>

                          <td>
                            ${escapeHtml(
                              displayName
                            )}
                          </td>

                          <td>
                            ${fmtDateTime(
                              s.submitted_at
                            )}
                          </td>

                          <td>
                            <b>
                              ${
                                s.similarity_pct != null
                                  ? s.similarity_pct +
                                    "%"
                                  : "—"
                              }
                            </b>
                          </td>

                          <td>
                            <span class="marks">
                              ${
                                s.final_marks == null
                                  ? "—"
                                  : s.final_marks +
                                    "/" +
                                    a.total_marks
                              }
                            </span>

                            <br>

                            <small>
                              ${
                                s.posted
                                  ? "Posted"
                                  : "Not posted"
                              }
                            </small>
                          </td>

                          <td>
                            <small>
                              ${
                                s.auto_feedback
                                  ? escapeHtml(
                                      s.auto_feedback
                                    )
                                  : "—"
                              }
                            </small>
                          </td>

                          <td>
                            <div class="row-buttons">

                              <button
                                class="btn secondary"
                                data-edit="${s.id}"
                                type="button">
                                Change marks
                              </button>

                              <button
                                class="btn ${
                                  s.posted
                                    ? "secondary"
                                    : "success"
                                }"
                                data-post="${s.id}"
                                ${
                                  s.final_marks == null
                                    ? "disabled"
                                    : ""
                                }
                                type="button">

                                ${
                                  s.posted
                                    ? "Posted"
                                    : "Post marks"
                                }

                              </button>

                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            `
            : `
              <div class="empty">
                No submissions yet.
              </div>
            `
        }

        ${
          duplicateList.length
            ? `
              <div
                class="mini-card"
                style="
                  margin-top:20px;
                  border-left:4px solid #ef4444;
                  background:#fff5f5;
                ">

                <h4 style="color:#b91c1c;">
                  ⚠️ Duplicate Alert
                </h4>

                <p>
                  Similar student documents detected.
                </p>

                <ul>
                  ${duplicateList
                    .map(
                      (d) => `
                        <li>
                          <b>
                            ${escapeHtml(
                              d.student_name
                            )}
                          </b>
                        </li>
                      `
                    )
                    .join("")}
                </ul>
              </div>
            `
            : ""
        }
      `;

      // --------------------------------------------------------
      // SAVE ANSWER KEY
      // --------------------------------------------------------

      if ($("saveKeyBtn")) {
        $("saveKeyBtn").onclick =
          async () => {
            const fd =
              new FormData();

            fd.append(
              "keyText",
              $("keyText").value.trim()
            );

            if (
              $("keyFile") &&
              $("keyFile").files[0]
            ) {
              fd.append(
                "keyFile",
                $("keyFile").files[0]
              );
            }

            try {
              await api(
                `/api/faculty/assignments/${id}/answer-key`,
                {
                  method: "POST",
                  isForm: true,
                  body: fd,
                }
              );

              notice(
                "Saved",
                "Answer key saved."
              );
            } catch (err) {
              notice(
                "Failed",
                err.message,
                "err"
              );
            }
          };
      }

      // --------------------------------------------------------
      // AUTO CORRECTION
      // --------------------------------------------------------

      if ($("runCorrectionBtn")) {
        $("runCorrectionBtn").onclick =
          async () => {
            try {
              const matchThreshold =
                $("matchThreshold").value;

              const penaltyMarks =
                $("duplicatePenalty").value;

              await api(
                `/api/faculty/assignments/${id}/auto-correct`,
                {
                  method: "POST",
                  body: {
                    matchThreshold,
                    penaltyMarks,
                  },
                }
              );

              notice(
                "Auto-correction complete",
                "Duplicates analyzed and marks updated."
              );

              await openAssignment(id);
            } catch (err) {
              notice(
                "Failed",
                err.message,
                "err"
              );
            }
          };
      }

      // --------------------------------------------------------
      // EDIT ASSIGNMENT MARKS
      // --------------------------------------------------------

      document
        .querySelectorAll(
          "[data-edit]"
        )
        .forEach((button) => {
          button.onclick = () =>
            editMarks(
              button.dataset.edit,
              a,
              id
            );
        });

      // --------------------------------------------------------
      // POST ASSIGNMENT MARKS
      // --------------------------------------------------------

      document
        .querySelectorAll(
          "[data-post]"
        )
        .forEach((button) => {
          button.onclick = () =>
            postMarks(
              button.dataset.post,
              id
            );
        });
    } catch (err) {
      notice(
        "Error loading assignment",
        err.message,
        "err"
      );
    }
  }

  // ============================================================
  // EDIT ASSIGNMENT MARKS
  // ============================================================

  function editMarks(
    subId,
    assignment,
    assignmentId
  ) {
    openModal(
      "Change marks",
      `
        <div class="field">
          <label>
            New marks
            (out of ${assignment.total_marks})
          </label>

          <input
            id="marksInput"
            type="number"
            min="0"
            max="${assignment.total_marks}">
        </div>

        <button
          class="btn"
          id="saveMarksBtn"
          type="button">
          Save
        </button>
      `
    );

    $("saveMarksBtn").onclick =
      async () => {
        try {
          await api(
            `/api/faculty/submissions/${subId}/marks`,
            {
              method: "PUT",
              body: {
                marks:
                  $("marksInput").value,
              },
            }
          );

          closeModal();

          await openAssignment(
            assignmentId
          );

          notice(
            "Updated",
            "Assignment marks updated."
          );
        } catch (err) {
          notice(
            "Failed",
            err.message,
            "err"
          );
        }
      };
  }

  // ============================================================
  // POST ASSIGNMENT MARKS
  // ============================================================

  async function postMarks(
    subId,
    assignmentId
  ) {
    try {
      await api(
        `/api/faculty/submissions/${subId}/post`,
        {
          method: "POST",
        }
      );

      notice(
        "Posted",
        "Assignment marks posted to the student."
      );

      await openAssignment(
        assignmentId
      );
    } catch (err) {
      notice(
        "Failed",
        err.message,
        "err"
      );
    }
  }

  // ============================================================
  // EXAMS LIST
  // ============================================================

  async function loadExams() {
    try {
      const rows =
        await api(
          "/api/faculty/exams"
        );

      const listEl =
        $("examsList");

      if (!listEl) return;

      if (!rows || !rows.length) {
        listEl.innerHTML =
          `<div class="empty">
             You haven't created any exams yet.
           </div>`;

        return;
      }

      listEl.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Date/Time</th>
              <th>Duration</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${rows
              .map((exam) => {
                const examDate =
                  String(
                    exam.exam_date || ""
                  ).split("T")[0];

                const startTime =
                  String(
                    exam.start_time || ""
                  ).slice(0, 8);

                return `
                  <tr>
                    <td>
                      <b>
                        ${escapeHtml(
                          exam.title
                        )}
                      </b>
                    </td>

                    <td>
                      ${escapeHtml(
                        examDate
                      )}
                      ${escapeHtml(
                        startTime
                      )}
                    </td>

                    <td>
                      ${
                        Number(
                          exam.duration_min
                        ) || 30
                      }
                      min
                    </td>

                    <td>
                      ${
                        Number(
                          exam.total_marks
                        ) || 0
                      }
                    </td>

                    <td>
                      <button
                        class="btn secondary"
                        data-results="${exam.id}"
                        type="button">
                        Results
                      </button>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

      document
        .querySelectorAll(
          "[data-results]"
        )
        .forEach((button) => {
          button.onclick = () =>
            openResults(
              button.dataset.results
            );
        });
    } catch (err) {
      console.error(
        "loadExams error:",
        err.message || err
      );

      notice(
        "Failed",
        "Could not load exams.",
        "err"
      );
    }
  }

  // ============================================================
  // OPEN EXAM RESULTS
  // ============================================================

  async function openResults(
    examId
  ) {
    try {
      const response =
        await api(
          `/api/faculty/exams/${examId}/results`
        );

      const exam =
        response.exam;

      const results =
        response.results || [];

      if ($("examResultsWrap")) {
        $("examResultsWrap").classList.remove(
          "hidden"
        );
      }

      if (!$("examResults")) {
        return;
      }

      // --------------------------------------------------------
      // BUILD RESULT TABLE
      // --------------------------------------------------------

      if (!results.length) {
        $("examResults").innerHTML = `
          <h2>
            ${escapeHtml(
              exam.title
            )} - Results
          </h2>

          <div class="empty">
            No students have attempted this exam yet.
          </div>
        `;

        return;
      }

      $("examResults").innerHTML = `
        <h2>
          ${escapeHtml(
            exam.title
          )} - Results
        </h2>

        <div style="
          margin-bottom:12px;
          padding:12px;
          background:#f8fafc;
          border-radius:8px;
          border:1px solid #e2e8f0;
        ">
          <b>Total Marks:</b>
          ${Number(exam.total_marks) || 0}
        </div>

        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Submitted</th>
              <th>Auto-submitted</th>
              <th>Score</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${results
              .map((r) => {
                /*
                 * IMPORTANT:
                 *
                 * score === null means the backend did
                 * not calculate/store the score.
                 *
                 * score === 0 is a valid score and MUST
                 * NOT be treated as null.
                 */

                const hasScore =
                  r.score !== null &&
                  r.score !== undefined &&
                  r.score !== "";

                const score =
                  hasScore
                    ? Number(r.score)
                    : null;

                const total =
                  Number(
                    exam.total_marks
                  ) || 0;

                const safeScore =
                  score !== null &&
                  !Number.isNaN(score)
                    ? score
                    : null;

                return `
                  <tr>

                    <td>
                      <b>
                        ${escapeHtml(
                          r.student_name ||
                            "Unknown Student"
                        )}
                      </b>

                      <br>

                      <small>
                        @${escapeHtml(
                          r.student_username ||
                            ""
                        )}
                      </small>
                    </td>

                    <td>
                      ${
                        r.submitted_at
                          ? fmtDateTime(
                              r.submitted_at
                            )
                          : "Not submitted"
                      }
                    </td>

                    <td>
                      ${
                        r.auto_submitted
                          ? "Yes (timer)"
                          : "No"
                      }
                    </td>

                    <td>
                      <span
                        class="marks"
                        style="font-weight:700;">

                        ${
                          safeScore !== null
                            ? `${safeScore}/${total}`
                            : "Not graded"
                        }

                      </span>
                    </td>

                    <td>
                      <small>
                        ${
                          r.posted
                            ? "Posted to student"
                            : "Not posted"
                        }
                      </small>
                    </td>

                    <td>
                      <div class="row-buttons">

                        <button
                          class="btn secondary"
                          data-editscore="${r.id}"
                          type="button">

                          Edit
                        </button>

                        <button
                          class="btn ${
                            r.posted
                              ? "secondary"
                              : "success"
                          }"
                          data-postscore="${r.id}"
                          ${
                            safeScore === null ||
                            r.posted
                              ? "disabled"
                              : ""
                          }
                          type="button">

                          ${
                            r.posted
                              ? "Posted"
                              : "Post"
                          }

                        </button>

                      </div>
                    </td>

                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

      // --------------------------------------------------------
      // EDIT SCORE BUTTONS
      // --------------------------------------------------------

      $("examResults")
        .querySelectorAll(
          "[data-editscore]"
        )
        .forEach((button) => {
          const result =
            results.find(
              (r) =>
                String(r.id) ===
                String(
                  button.dataset
                    .editscore
                )
            );

          button.onclick = () => {
            editScore(
              button.dataset.editscore,
              exam,
              examId,
              result
            );
          };
        });

      // --------------------------------------------------------
      // POST SCORE BUTTONS
      // --------------------------------------------------------

      $("examResults")
        .querySelectorAll(
          "[data-postscore]"
        )
        .forEach((button) => {
          button.onclick =
            async () => {
              const attemptId =
                button.dataset
                  .postscore;

              try {
                button.disabled =
                  true;

                await api(
                  `/api/faculty/exam-attempts/${attemptId}/post`,
                  {
                    method: "POST",
                  }
                );

                notice(
                  "Marks Posted",
                  "The student's exam marks have been posted successfully."
                );

                await openResults(
                  examId
                );
              } catch (err) {
                button.disabled =
                  false;

                notice(
                  "Post Failed",
                  err.message ||
                    "Could not post exam marks.",
                  "err"
                );
              }
            };
        });
    } catch (err) {
      console.error(
        "openResults error:",
        err.message || err
      );

      notice(
        "Failed to load results",
        err.message ||
          "Could not load exam results.",
        "err"
      );
    }
  }

  // ============================================================
  // EDIT EXAM SCORE
  // ============================================================

  function editScore(
    attemptId,
    exam,
    examId,
    result
  ) {
    const totalMarks =
      Number(
        exam.total_marks
      ) || 0;

    const currentScore =
      result &&
      result.score !== null &&
      result.score !== undefined
        ? result.score
        : "";

    openModal(
      "Edit score",
      `
        <div class="field">

          <label>
            Score
            (out of ${totalMarks})
          </label>

          <input
            id="scoreInput"
            type="number"
            min="0"
            max="${totalMarks}"
            step="1"
            value="${currentScore}">
        </div>

        <button
          class="btn"
          id="saveScoreBtn"
          type="button">

          Save Score
        </button>
      `
    );

    $("saveScoreBtn").onclick =
      async () => {
        const scoreValue =
          Number(
            $("scoreInput").value
          );

        if (
          Number.isNaN(
            scoreValue
          ) ||
          scoreValue < 0 ||
          scoreValue > totalMarks
        ) {
          return notice(
            "Invalid score",
            `Enter a score between 0 and ${totalMarks}.`,
            "err"
          );
        }

        try {
          await api(
            `/api/faculty/exam-attempts/${attemptId}/score`,
            {
              method: "PUT",
              body: {
                score: scoreValue,
              },
            }
          );

          closeModal();

          notice(
            "Score Updated",
            "Exam score updated successfully."
          );

          await openResults(
            examId
          );
        } catch (err) {
          notice(
            "Failed",
            err.message ||
              "Could not update score.",
            "err"
          );
        }
      };
  }

  // ============================================================
  // CREATE EXAM
  // ============================================================

  if ($("addQuestionBtn")) {
    $("addQuestionBtn").onclick =
      () => addQuestionRow();
  }

  function addQuestionRow() {
    questionRowCount++;

    const n =
      questionRowCount;

    const div =
      document.createElement(
        "div"
      );

    div.className =
      "mini-card";

    div.id =
      `q-${n}`;

    div.innerHTML = `
      <div class="field">
        <label>
          Question ${n}
        </label>

        <input
          class="q-text"
          type="text">
      </div>

      <div class="two-col">

        <div class="field">
          <label>
            Option A
          </label>

          <input
            class="q-a"
            type="text">
        </div>

        <div class="field">
          <label>
            Option B
          </label>

          <input
            class="q-b"
            type="text">
        </div>

      </div>

      <div class="two-col">

        <div class="field">
          <label>
            Option C
          </label>

          <input
            class="q-c"
            type="text">
        </div>

        <div class="field">
          <label>
            Option D
          </label>

          <input
            class="q-d"
            type="text">
        </div>

      </div>

      <div class="two-col">

        <div class="field">
          <label>
            Correct option
          </label>

          <select
            class="q-correct">

            <option value="A">
              A
            </option>

            <option value="B">
              B
            </option>

            <option value="C">
              C
            </option>

            <option value="D">
              D
            </option>

          </select>
        </div>

        <div class="field">
          <label>
            Marks
          </label>

          <input
            class="q-marks"
            type="number"
            value="1"
            min="1">
        </div>

      </div>

      <button
        class="btn ghost"
        type="button"
        onclick="
          document
            .getElementById('q-${n}')
            .remove()
        ">

        Remove question
      </button>
    `;

    if ($("questionsWrap")) {
      $("questionsWrap")
        .appendChild(div);
    }
  }

  // ============================================================
  // CREATE EXAM BUTTON
  // ============================================================

  if ($("createExamBtn")) {
    $("createExamBtn").onclick =
      async () => {
        const title =
          $("examTitle")
            .value
            .trim();

        const examDate =
          $("examDate").value;

        const startTime =
          $("examStart").value;

        const durationMin =
          $("examDuration").value;

        if (
          !title ||
          !examDate ||
          !startTime ||
          !durationMin
        ) {
          return notice(
            "Missing fields",
            "Fill in title, date, start time and duration.",
            "err"
          );
        }

        const questions = [];

        document
          .querySelectorAll(
            "#questionsWrap .mini-card"
          )
          .forEach((card) => {
            questions.push({
              questionText:
                card
                  .querySelector(
                    ".q-text"
                  )
                  .value
                  .trim(),

              optionA:
                card
                  .querySelector(
                    ".q-a"
                  )
                  .value
                  .trim(),

              optionB:
                card
                  .querySelector(
                    ".q-b"
                  )
                  .value
                  .trim(),

              optionC:
                card
                  .querySelector(
                    ".q-c"
                  )
                  .value
                  .trim(),

              optionD:
                card
                  .querySelector(
                    ".q-d"
                  )
                  .value
                  .trim(),

              correctOption:
                card
                  .querySelector(
                    ".q-correct"
                  )
                  .value,

              marks:
                card
                  .querySelector(
                    ".q-marks"
                  )
                  .value,
            });
          });

        if (
          !questions.length ||
          questions.some(
            (q) =>
              !q.questionText ||
              !q.optionA ||
              !q.optionB ||
              !q.optionC ||
              !q.optionD
          )
        ) {
          return notice(
            "Incomplete questions",
            "Fill in every question and all four options.",
            "err"
          );
        }

        try {
          await api(
            "/api/faculty/exams",
            {
              method: "POST",
              body: {
                title,
                examDate,
                startTime,
                durationMin,
                questions,
              },
            }
          );

          notice(
            "Exam created",
            "The MCQ exam was created for students accepted under you."
          );

          if ($("questionsWrap")) {
            $("questionsWrap").innerHTML =
              "";
          }

          questionRowCount =
            0;

          addQuestionRow();

          $("examTitle").value =
            "";

          await loadExams();
        } catch (err) {
          notice(
            "Failed",
            err.message ||
              "Could not create exam.",
            "err"
          );
        }
      };
  }

  // ============================================================
  // START
  // ============================================================

  init();
})();