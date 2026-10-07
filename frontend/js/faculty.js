// frontend/js/faculty.js

(function () {
  "use strict";

  const user = requireLogin("faculty");

  if (!user) return;

  const $ = (id) => document.getElementById(id);

  let questionRowCount = 0;

  // ============================================================
  // GET AUTH TOKEN
  // ============================================================

  function getAuthToken() {
    try {
      if (typeof getToken === "function") {
        const t = getToken();
        if (t) return t;
      }

      return (
        localStorage.getItem("oa_token") ||
        sessionStorage.getItem("oa_token") ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("token") ||
        ""
      );
    } catch {
      return "";
    }
  }

  // ============================================================
  // NAVIGATION TABS
  // ============================================================

  document
    .querySelectorAll(".tabs button")
    .forEach((btn) => {
      btn.onclick = () => {
        document
          .querySelectorAll(".tabs button")
          .forEach((b) => {
            b.classList.remove("active");
          });

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

        const activeTab =
          $(`tab-${btn.dataset.tab}`);

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
          me.name ||
          user.name ||
          "Faculty";
      }

      if ($("facSubject")) {
        $("facSubject").textContent =
          (me.subject ||
            "Subject not set") +
          (me.slot
            ? " · " + me.slot
            : "");
      }

      if ($("avatarInitial")) {
        $("avatarInitial").textContent =
          (
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
      const rows =
        await api(
          "/api/faculty/students?status=pending"
        );

      const listEl =
        $("requestsList");

      if (!listEl) return;

      if (!rows || !rows.length) {
        listEl.innerHTML =
          `<div class="empty">No pending registration requests.</div>`;

        return;
      }

      listEl.innerHTML =
        rows
          .map(
            (r) => `
              <div class="mini-card">

                <h4>
                  ${escapeHtml(
                    r.name
                  )}
                </h4>

                <p>
                  @${escapeHtml(
                    r.username
                  )}

                  ${
                    r.branch
                      ? " · " +
                        escapeHtml(
                          r.branch
                        )
                      : ""
                  }

                  ${
                    r.year
                      ? " · " +
                        escapeHtml(
                          r.year
                        )
                      : ""
                  }
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
        err.message ||
          "Could not update request.",
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
          $("newTitle")
            .value
            .trim();

        const totalMarks =
          $("newTotalMarks")
            .value;

        const dueDate =
          $("newDueDate")
            .value;

        const dueTime =
          $("newDueTime")
            .value;

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

        const fd =
          new FormData();

        fd.append(
          "title",
          title
        );

        fd.append(
          "description",
          $("newDesc")
            .value
            .trim()
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
            $("newQFile")
              .files[0]
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
            err.message ||
              "Could not post assignment.",
            "err"
          );
        }
      };
  }

  // ============================================================
  // ASSIGNMENTS LIST (WITH SIDE-BY-SIDE DELETE BUTTON)
  // ============================================================

  async function loadAssignments() {
    try {
      const rows =
        await api(
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

                      <div class="row-buttons" style="display:flex;gap:8px;align-items:center;">

                        <button
                          class="btn secondary"
                          data-open="${a.id}"
                          type="button">
                          Open
                        </button>

                        <button
                          class="btn danger"
                          data-delete="${a.id}"
                          type="button">
                          Delete
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

      // 1. Open Assignment Listener
      document
        .querySelectorAll("[data-open]")
        .forEach((button) => {
          button.onclick = () =>
            openAssignment(
              button.dataset.open
            );
        });

      // 2. Delete Assignment Listener (beside Open)
      document
        .querySelectorAll("[data-delete]")
        .forEach((button) => {
          button.onclick = async () => {
            const assignmentId = button.dataset.delete;

            if (
              !confirm(
                "Are you sure you want to delete this assignment? It will be permanently removed for both faculty and students."
              )
            ) {
              return;
            }

            try {
              button.disabled = true;
              button.textContent = "Deleting...";

              await api(
                `/api/faculty/assignments/${encodeURIComponent(assignmentId)}`,
                {
                  method: "DELETE",
                }
              );

              notice("Deleted", "Assignment was deleted successfully.");

              // Hide details view if this assignment was open
              if ($("assignmentDetailWrap")) {
                $("assignmentDetailWrap").classList.add("hidden");
              }

              // Re-fetch assignments list to update the table immediately
              await loadAssignments();
            } catch (err) {
              button.disabled = false;
              button.textContent = "Delete";
              notice(
                "Delete failed",
                err.message || "Could not delete assignment.",
                "err"
              );
            }
          };
        });
    } catch (err) {
      console.error(
        "loadAssignments error:",
        err.message || err
      );
    }
  }

  // Expose to window for testing / external console access
  window.loadAssignments = loadAssignments;

  // ============================================================
  // OPEN ASSIGNMENT (WITH IN-VIEW DELETE)
  // ============================================================
async function openAssignment(id) {
  try {
    // The submissions endpoint returns an ARRAY of submissions.
    const submissionsResponse =
      await api(
        `/api/faculty/assignments/${encodeURIComponent(id)}/submissions`
      );

    const submissions =
      Array.isArray(submissionsResponse)
        ? submissionsResponse
        : (
            submissionsResponse &&
            Array.isArray(submissionsResponse.submissions)
          )
          ? submissionsResponse.submissions
          : [];

    // Get assignment information separately.
    const assignmentsResponse =
      await api(
        "/api/faculty/assignments"
      );

    const assignments =
      Array.isArray(assignmentsResponse)
        ? assignmentsResponse
        : (
            assignmentsResponse &&
            Array.isArray(assignmentsResponse.assignments)
          )
          ? assignmentsResponse.assignments
          : [];

    const a =
      assignments.find(
        (assignment) =>
          String(assignment.id) ===
          String(id)
      );

    if (!a) {
      console.error(
        "Assignment not found.",
        {
          requestedId: id,
          assignments
        }
      );

      throw new Error(
        "Assignment information could not be found."
      );
    }

    if ($("assignmentDetailWrap")) {
      $("assignmentDetailWrap")
        .classList.remove("hidden");
    }

    if (!$("assignmentDetail")) {
      return;
    }

    const token =
      getAuthToken();

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

    const duplicateList =
      submissions.filter(
        (s) => s.duplicate_flag
      );
  
      // ========================================================
      // ASSIGNMENT DETAIL HTML
      // ========================================================

      $("assignmentDetail").innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
          <h2 style="margin:0;">
            ${escapeHtml(a.title)}
          </h2>
          <button
            class="btn danger"
            id="detailDeleteBtn"
            type="button"
            style="white-space:nowrap;">
            Delete Assignment
          </button>
        </div>

        <p>
          ${escapeHtml(
            a.description || ""
          )}
        </p>

        <p>

          <span class="pill">
            Total:
            ${a.total_marks}
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
              <div
                style="
                  margin:10px 0;
                  padding:10px;
                  background:#f8fafc;
                  border:1px solid #e2e8f0;
                  border-radius:8px;
                ">

                <a
                  href="/api/faculty/assignments/${encodeURIComponent(
                    a.id
                  )}/question-paper?token=${encodeURIComponent(token)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  style="
                    color:#4f46e5;
                    font-weight:600;
                    text-decoration:underline;
                  ">

                  📄 View Question Paper

                  ${
                    a.question_original
                      ? `(${escapeHtml(
                          a.question_original
                        )})`
                      : ""
                  }

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
          Submissions
          (${submissions.length})
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
                          .split(
                            /[/\\]/
                          )
                          .pop();

                      const displayName =
                        s.file_original ||
                        fileName ||
                        "Submission File";

                      const hasMarks =
                        s.final_marks !==
                          null &&
                        s.final_marks !==
                          undefined;

                      const posted =
                        s.posted === true ||
                        Number(
                          s.posted
                        ) === 1;

                      return `
                        <tr>

                          <td>

                            <b>
                              ${escapeHtml(
                                s.student_name ||
                                  "Unknown Student"
                              )}
                            </b>

                            <br>

                            <small>
                              @${escapeHtml(
                                s.student_username ||
                                  ""
                              )}
                            </small>

                          </td>

                          <td>

                            ${
                              s.file_path
                                ? `
                                  <button
                                    class="btn secondary"
                                    data-view-submission="${escapeHtml(
                                      s.id
                                    )}"
                                    data-file-name="${escapeHtml(
                                      displayName
                                    )}"
                                    type="button"
                                    style="
                                      white-space:nowrap;
                                    ">

                                    📄 View / Download

                                  </button>

                                  <div
                                    style="
                                      margin-top:5px;
                                      font-size:12px;
                                      color:#64748b;
                                      word-break:break-word;
                                    ">

                                    ${escapeHtml(
                                      displayName
                                    )}

                                  </div>
                                `
                                : `
                                  <span class="note">
                                    No file
                                  </span>
                                `
                            }

                          </td>

                          <td>
                            ${fmtDateTime(
                              s.submitted_at
                            )}
                          </td>

                          <td>

                            <b>
                              ${
                                s.similarity_pct !=
                                  null
                                  ? s.similarity_pct +
                                    "%"
                                  : "—"
                              }
                            </b>

                          </td>

                          <td>

                            <span
                              class="marks"
                              style="
                                font-weight:700;
                              ">

                              ${
                                hasMarks
                                  ? `${s.final_marks}/${a.total_marks}`
                                  : "—"
                              }

                            </span>

                            <br>

                            <small>

                              ${
                                posted
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

                            <div
                              class="row-buttons">

                              <button
                                class="btn secondary"
                                data-edit="${escapeHtml(
                                  s.id
                                )}"
                                type="button">

                                Change marks

                              </button>

                              <button
                                class="btn ${
                                  posted
                                    ? "secondary"
                                    : "success"
                                }"
                                data-post="${escapeHtml(
                                  s.id
                                )}"
                                ${
                                  !hasMarks ||
                                  posted
                                    ? "disabled"
                                    : ""
                                }
                                type="button">

                                ${
                                  posted
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

      // ========================================================
      // DETAIL VIEW DELETE BUTTON
      // ========================================================

      if ($("detailDeleteBtn")) {
        $("detailDeleteBtn").onclick = async () => {
          if (
            !confirm(
              "Are you sure you want to delete this assignment? It will be removed permanently for both you and your students."
            )
          ) {
            return;
          }

          try {
            $("detailDeleteBtn").disabled = true;
            $("detailDeleteBtn").textContent = "Deleting...";

            await api(`/api/faculty/assignments/${encodeURIComponent(id)}`, {
              method: "DELETE",
            });

            notice("Deleted", "Assignment was removed.");

            if ($("assignmentDetailWrap")) {
              $("assignmentDetailWrap").classList.add("hidden");
            }

            await loadAssignments();
          } catch (err) {
            $("detailDeleteBtn").disabled = false;
            $("detailDeleteBtn").textContent = "Delete Assignment";
            notice(
              "Delete failed",
              err.message || "Could not delete assignment.",
              "err"
            );
          }
        };
      }

      // ========================================================
      // VIEW STUDENT SUBMISSION BUTTONS
      // ========================================================

      document
        .querySelectorAll(
          "[data-view-submission]"
        )
        .forEach((button) => {
          button.onclick = () => {
            viewStudentSubmission(
              button.dataset.viewSubmission,
              button.dataset.fileName ||
                "student-submission"
            );
          };
        });

      // ========================================================
      // SAVE ANSWER KEY
      // ========================================================

      if ($("saveKeyBtn")) {
        $("saveKeyBtn").onclick =
          async () => {
            const fd =
              new FormData();

            fd.append(
              "keyText",
              $("keyText")
                .value
                .trim()
            );

            if (
              $("keyFile") &&
              $("keyFile").files[0]
            ) {
              fd.append(
                "keyFile",
                $("keyFile")
                  .files[0]
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
                "Answer key saved successfully."
              );

              await openAssignment(id);
            } catch (err) {
              notice(
                "Failed",
                err.message ||
                  "Could not save answer key.",
                "err"
              );
            }
          };
      }

      // ========================================================
      // AUTO CORRECTION
      // ========================================================

      if ($("runCorrectionBtn")) {
        $("runCorrectionBtn").onclick =
          async () => {
            try {
              const matchThreshold =
                $("matchThreshold")
                  .value;

              const penaltyMarks =
                $("duplicatePenalty")
                  .value;

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
                err.message ||
                  "Auto-correction failed.",
                "err"
              );
            }
          };
      }

      // ========================================================
      // EDIT ASSIGNMENT MARKS
      // ========================================================

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

      // ========================================================
      // POST ASSIGNMENT MARKS
      // ========================================================

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
        err.message ||
          "Could not load assignment.",
        "err"
      );
    }
  }

  // ============================================================
  // VIEW / DOWNLOAD STUDENT SUBMISSION
  // ============================================================

  async function viewStudentSubmission(
    submissionId,
    originalFileName
  ) {
    if (!submissionId) {
      return notice(
        "File unavailable",
        "Submission ID is missing.",
        "err"
      );
    }

    const token = getAuthToken();

    if (!token) {
      return notice(
        "Session expired",
        "Please log in again.",
        "err"
      );
    }

    const buttons =
      document.querySelectorAll(
        "[data-view-submission]"
      );

    let button = null;

    buttons.forEach((b) => {
      if (
        String(
          b.dataset.viewSubmission
        ) ===
        String(submissionId)
      ) {
        button = b;
      }
    });

    const originalText =
      button
        ? button.textContent
        : "📄 View / Download";

    if (button) {
      button.disabled = true;
      button.textContent = "Opening...";
    }

    let blobUrl = null;

    try {
      const base =
        window.API_BASE ||
        window.location.origin;

      const url =
        `${base}/api/faculty/submissions/${encodeURIComponent(
          submissionId
        )}/file?token=${encodeURIComponent(token)}`;

      const response =
        await fetch(
          url,
          {
            method: "GET",

            headers: {
              Authorization:
                "Bearer " + token,
              Accept:
                "*/*",
            },

            credentials:
              "same-origin",

            cache: "no-store",
          }
        );

      if (!response.ok) {
        let message =
          `Request failed (${response.status})`;

        try {
          const contentType =
            response.headers.get(
              "content-type"
            ) || "";

          if (
            contentType.includes(
              "application/json"
            )
          ) {
            const data =
              await response.json();

            message =
              data.error ||
              data.message ||
              message;
          } else {
            const text =
              await response.text();

            if (text) {
              message = text;
            }
          }
        } catch {
          // Fallback message
        }

        throw new Error(
          message
        );
      }

      const blob =
        await response.blob();

      if (!blob || !blob.size) {
        throw new Error(
          "The student's submitted file is empty."
        );
      }

      let mimeType =
        blob.type ||
        response.headers.get(
          "content-type"
        ) ||
        "application/octet-stream";

      blobUrl =
        URL.createObjectURL(blob);

      const previewable =
        mimeType.startsWith(
          "application/pdf"
        ) ||
        mimeType.startsWith(
          "image/"
        ) ||
        mimeType.startsWith(
          "text/"
        );

      if (previewable) {
        const newWindow =
          window.open(
            blobUrl,
            "_blank"
          );

        if (newWindow) {
          newWindow.focus();

          notice(
            "File opened",
            originalFileName
              ? `Opened ${originalFileName}.`
              : "The student submission was opened successfully."
          );
        } else {
          const link =
            document.createElement(
              "a"
            );

          link.href =
            blobUrl;

          link.download =
            originalFileName ||
            "student-submission";

          document.body.appendChild(
            link
          );

          link.click();

          link.remove();

          notice(
            "Download started",
            "Your browser blocked the preview, so the file download was started."
          );
        }
      } else {
        const link =
          document.createElement(
            "a"
          );

        link.href =
          blobUrl;

        link.download =
          originalFileName ||
          "student-submission";

        document.body.appendChild(
          link
        );

        link.click();

        link.remove();

        notice(
          "Download started",
          originalFileName
            ? `${originalFileName} is being downloaded.`
            : "The student submission download has started."
        );
      }

      setTimeout(() => {
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
        }
      }, 60000);

      blobUrl = null;
    } catch (err) {
      console.error(
        "VIEW STUDENT SUBMISSION ERROR:",
        err
      );

      notice(
        "Could not open submission",
        err.message ||
          "The student's submitted file could not be opened.",
        "err"
      );

      if (blobUrl) {
        URL.revokeObjectURL(
          blobUrl
        );
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          originalText;
      }
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
    const currentMarks =
      assignment &&
      assignment.currentMarks !=
        null
        ? assignment.currentMarks
        : "";

    openModal(
      "Change marks",
      `
        <div class="field">

          <label>
            New marks
            (out of ${
              assignment.total_marks
            })
          </label>

          <input
            id="marksInput"
            type="number"
            min="0"
            max="${
              assignment.total_marks
            }"
            step="1"
            value="${currentMarks}">

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
        const marksValue =
          Number(
            $("marksInput")
              .value
          );

        if (
          Number.isNaN(
            marksValue
          ) ||
          marksValue < 0 ||
          marksValue >
            Number(
              assignment.total_marks
            )
        ) {
          return notice(
            "Invalid marks",
            `Enter a value between 0 and ${assignment.total_marks}.`,
            "err"
          );
        }

        try {
          await api(
            `/api/faculty/submissions/${subId}/marks`,
            {
              method: "PUT",
              body: {
                marks:
                  marksValue,
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
            err.message ||
              "Could not update marks.",
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
        err.message ||
          "Could not post marks.",
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

      if (
        !rows ||
        !rows.length
      ) {
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
                    exam.exam_date ||
                      ""
                  ).split("T")[0];

                const startTime =
                  String(
                    exam.start_time ||
                      ""
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
                      ${escapeHtml(                         examDate                       )}${escapeHtml(
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
        $("examResultsWrap")
          .classList.remove(
            "hidden"
          );
      }

      if (!$("examResults")) {
        return;
      }

      if (!results.length) {
        $("examResults")
          .innerHTML = `
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

          <b>
            Total Marks:
          </b>

          ${
            Number(
              exam.total_marks
            ) || 0
          }

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
                const hasScore =
                  r.score !== null &&
                  r.score !== undefined &&
                  r.score !== "";

                const numericScore =
                  hasScore
                    ? Number(
                        r.score
                      )
                    : null;

                const safeScore =
                  numericScore !== null &&
                  !Number.isNaN(
                    numericScore
                  )
                    ? numericScore
                    : null;

                const total =
                  Number(
                    exam.total_marks
                  ) || 0;

                const posted =
                  r.posted === true ||
                  Number(
                    r.posted
                  ) === 1;

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
                        style="
                          font-weight:700;
                        ">

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
                          posted
                            ? "Posted to student"
                            : "Not posted"
                        }

                      </small>

                    </td>

                    <td>

                      <div
                        class="row-buttons">

                        <button
                          class="btn secondary"
                          data-editscore="${escapeHtml(
                            r.id
                          )}"
                          type="button">

                          Edit

                        </button>

                        <button
                          class="btn ${
                            posted
                              ? "secondary"
                              : "success"
                          }"
                          data-postscore="${escapeHtml(
                            r.id
                          )}"
                          ${
                            safeScore === null ||
                            posted
                              ? "disabled"
                              : ""
                          }
                          type="button">

                          ${
                            posted
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

      // ========================================================
      // EDIT SCORE
      // ========================================================

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

          button.onclick = () =>
            editScore(
              button.dataset.editscore,
              exam,
              examId,
              result
            );
        });

      // ========================================================
      // POST SCORE
      // ========================================================

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
                    method:
                      "POST",
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
            $("scoreInput")
              .value
          );

        if (
          Number.isNaN(
            scoreValue
          ) ||
          scoreValue < 0 ||
          scoreValue >
            totalMarks
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
                score:
                  scoreValue,
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

            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>

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
            .getElementById(
              'q-${n}'
            )
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
          $("examDate")
            .value;

        const startTime =
          $("examStart")
            .value;

        const durationMin =
          $("examDuration")
            .value;

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
            const textInput =
              card.querySelector(
                ".q-text"
              );

            const optionA =
              card.querySelector(
                ".q-a"
              );

            const optionB =
              card.querySelector(
                ".q-b"
              );

            const optionC =
              card.querySelector(
                ".q-c"
              );

            const optionD =
              card.querySelector(
                ".q-d"
              );

            const correct =
              card.querySelector(
                ".q-correct"
              );

            const marks =
              card.querySelector(
                ".q-marks"
              );

            if (
              !textInput ||
              !optionA ||
              !optionB ||
              !optionC ||
              !optionD ||
              !correct ||
              !marks
            ) {
              return;
            }

            questions.push({
              questionText:
                textInput.value.trim(),

              optionA:
                optionA.value.trim(),

              optionB:
                optionB.value.trim(),

              optionC:
                optionC.value.trim(),

              optionD:
                optionD.value.trim(),

              correctOption:
                correct.value,

              marks:
                marks.value,
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
              method:
                "POST",

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
            $("questionsWrap")
              .innerHTML = "";
          }

          questionRowCount = 0;

          addQuestionRow();

          $("examTitle").value = "";

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