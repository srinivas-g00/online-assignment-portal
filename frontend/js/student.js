// frontend/js/student.js

(function () {
  "use strict";

  const user = requireLogin("student");

  if (!user) return;

  const $ = (id) => document.getElementById(id);

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
  // GET API BASE
  // ============================================================

  function getApiBase() {
    return (
      window.API_BASE ||
      window.location.origin
    );
  }

  // ============================================================
  // OPEN / DOWNLOAD PROTECTED FILE
  // ============================================================

  async function openProtectedFile(url, fileName = "document") {
    const token = getAuthToken();

    if (!token) {
      notice(
        "Session expired",
        "Please log in again.",
        "err"
      );
      return;
    }

    const separator = url.includes("?") ? "&" : "?";
    const authedUrl = `${url}${separator}token=${encodeURIComponent(token)}`;

    let blobUrl = null;

    try {
      const response = await fetch(authedUrl, {
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "*/*",
        },
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        let message = `Request failed (${response.status})`;

        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await response.json();
            message = data.error || data.message || message;
          } else {
            const text = await response.text();
            if (text) message = text;
          }
        } catch (_) {}

        throw new Error(message);
      }

      const blob = await response.blob();

      if (!blob || !blob.size) {
        throw new Error("The file returned by the server is empty.");
      }

      const mimeType =
        blob.type ||
        response.headers.get("content-type") ||
        "application/octet-stream";

      blobUrl = URL.createObjectURL(blob);

      const isPdfOrImage =
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("image/") ||
        mimeType.startsWith("text/");

      if (isPdfOrImage) {
        const newTab = window.open(blobUrl, "_blank");
        if (newTab) {
          newTab.focus();
          notice("Opened", `${fileName} opened in a new tab.`);
          return;
        }
      }

      const downloadLink = document.createElement("a");
      downloadLink.href = blobUrl;
      downloadLink.download = fileName || "document";
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();

      notice("Download started", `${fileName} is being downloaded.`);
    } catch (err) {
      console.warn("Direct blob download failed, attempting native browser fallback:", err.message);

      try {
        const link = document.createElement("a");
        link.href = authedUrl;
        link.download = fileName || "document";
        link.target = "_blank";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (fallbackErr) {
        notice(
          "Could not open file",
          err.message || "The requested file could not be opened.",
          "err"
        );
      }
    } finally {
      if (blobUrl) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch (_) {}
        }, 120000);
      }
    }
  }

  // ============================================================
  // TABS
  // ============================================================

  document
    .querySelectorAll(".tabs button")
    .forEach((btn) => {
      btn.onclick = () => {
        document
          .querySelectorAll(".tabs button")
          .forEach((b) =>
            b.classList.remove(
              "active"
            )
          );

        btn.classList.add(
          "active"
        );

        [
          "faculties",
          "courses",
          "marks",
          "exams",
        ].forEach((t) => {
          const el =
            $(`tab-${t}`);

          if (el) {
            el.classList.add(
              "hidden"
            );
          }
        });

        const activeTabEl =
          $(
            `tab-${btn.dataset.tab}`
          );

        if (activeTabEl) {
          activeTabEl.classList.remove(
            "hidden"
          );
        }

        if ($("facultyDetailWrap")) {
          $("facultyDetailWrap").classList.add(
            "hidden"
          );
        }

        if (
          btn.dataset.tab ===
          "faculties"
        ) {
          loadFaculties();
        }

        if (
          btn.dataset.tab ===
          "courses"
        ) {
          loadCourses();
        }

        if (
          btn.dataset.tab ===
          "marks"
        ) {
          loadMarks();
        }

        if (
          btn.dataset.tab ===
          "exams"
        ) {
          loadExams();
        }
      };
    });

  // ============================================================
  // INITIALIZE STUDENT DASHBOARD
  // ============================================================

  async function init() {
    try {
      const me =
        await api(
          "/api/student/me"
        );

      if ($("studentName")) {
        $("studentName").textContent =
          me.name ||
          user.name ||
          "Student";
      }

      if ($("studentUsername")) {
        $("studentUsername").textContent =
          "@" +
          (
            me.username ||
            user.username ||
            ""
          ) +
          (
            me.branch
              ? " · " +
                me.branch
              : ""
          );
      }

      if ($("avatarInitial")) {
        $("avatarInitial").textContent =
          (
            me.name ||
            user.name ||
            "S"
          )[0].toUpperCase();
      }

      await loadFaculties();

    } catch (err) {
      console.error(
        "Student init error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // FACULTY SEARCH
  // ============================================================

  let searchTimer;

  if ($("facSearch")) {
    $("facSearch").oninput = () => {
      clearTimeout(
        searchTimer
      );

      searchTimer =
        setTimeout(
          () => {
            loadFaculties();
          },
          250
        );
    };
  }

  // ============================================================
  // LOAD FACULTIES
  // ============================================================

  async function loadFaculties() {
    try {
      const searchVal =
        $("facSearch")
          ? $("facSearch").value
          : "";

      const rows =
        await api(
          "/api/student/faculties?search=" +
            encodeURIComponent(
              searchVal
            )
        );

      const listEl =
        $("facultyList");

      if (!listEl) return;

      listEl.innerHTML =
        rows && rows.length
          ? rows
              .map(
                (f) => `
                  <div
                    class="mini-card"
                    data-fac="${escapeHtml(
                      f.id
                    )}"
                    style="cursor:pointer"
                  >

                    <h4>
                      ${escapeHtml(
                        f.name
                      )}
                    </h4>

                    <p>
                      ${escapeHtml(
                        f.subject ||
                          "Subject not set"
                      )}
                    </p>

                    <p>
                      ${escapeHtml(
                        f.branch ||
                          ""
                      )}

                      ${
                        f.slot
                          ? " · " +
                            escapeHtml(
                              f.slot
                            )
                          : ""
                      }
                    </p>

                    ${
                      f.enrollStatus
                        ? `
                          <span
                            class="status-pill status-${escapeHtml(
                              f.enrollStatus
                            )}"
                          >
                            ${escapeHtml(
                              f.enrollStatus
                            )}
                          </span>
                        `
                        : `
                          <span class="note">
                            Not registered
                          </span>
                        `
                    }

                  </div>
                `
              )
              .join("")
          : `
              <div class="empty">
                No faculties matched your search.
              </div>
            `;

      document
        .querySelectorAll(
          "[data-fac]"
        )
        .forEach((card) => {
          card.onclick = () => {
            openFaculty(
              card.dataset.fac
            );
          };
        });

    } catch (err) {
      console.error(
        "loadFaculties error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // FACULTY DETAILS
  // ============================================================

  async function openFaculty(id) {
    try {
      const fac =
        await api(
          `/api/student/faculties/${encodeURIComponent(
            id
          )}`
        );

      if ($("facultyDetailWrap")) {
        $("facultyDetailWrap").classList.remove(
          "hidden"
        );
      }

      if (!$("facultyDetail")) {
        return;
      }

      let html = `
        <h2>
          ${escapeHtml(
            fac.name
          )}
        </h2>

        <div
          class="meta-row"
          style="
            display:flex;
            gap:8px;
            flex-wrap:wrap;
          "
        >

          <span class="pill">
            Subject:
            ${escapeHtml(
              fac.subject ||
                "—"
            )}
          </span>

          <span class="pill">
            Branch:
            ${escapeHtml(
              fac.branch ||
                "—"
            )}
          </span>

          <span class="pill">
            Slot:
            ${escapeHtml(
              fac.slot ||
                "—"
            )}
          </span>

        </div>
      `;

      if (!fac.enrollStatus) {

        html += `
          <button
            class="btn"
            id="enrollBtn"
            style="margin-top:14px"
            type="button"
          >
            Register under this faculty
          </button>
        `;

      } else if (
        fac.enrollStatus ===
        "pending"
      ) {

        html += `
          <div
            class="open-banner"
            style="margin-top:14px"
          >
            Registration pending faculty approval.
          </div>
        `;

      } else if (
        fac.enrollStatus ===
        "rejected"
      ) {

        html += `
          <div
            class="closed-banner"
            style="margin-top:14px"
          >
            Your registration request was not accepted.
          </div>
        `;

      } else {

        html += `
          <div
            id="facultyAssignments"
            style="margin-top:16px"
          ></div>
        `;
      }

      $("facultyDetail").innerHTML =
        html;

      if ($("enrollBtn")) {
        $("enrollBtn").onclick =
          async () => {
            try {
              await api(
                `/api/student/faculties/${encodeURIComponent(
                  id
                )}/enroll`,
                {
                  method:
                    "POST",
                }
              );

              notice(
                "Request sent",
                "Your registration request was sent to the faculty for approval."
              );

              await openFaculty(
                id
              );

              await loadFaculties();

            } catch (e) {
              notice(
                "Could not register",
                e.message ||
                  "Could not send registration request.",
                "err"
              );
            }
          };
      }

      if (
        fac.enrollStatus ===
        "accepted"
      ) {
        await loadAssignments(
          id
        );
      }

    } catch (err) {
      notice(
        "Error loading faculty",
        err.message ||
          "Could not load faculty.",
        "err"
      );
    }
  }

  // ============================================================
  // LOAD ASSIGNMENTS
  // ============================================================

  async function loadAssignments(
    facultyId
  ) {
    try {
      const rows =
        await api(
          `/api/student/faculties/${encodeURIComponent(
            facultyId
          )}/assignments`
        );

      const assignWrap =
        $("facultyAssignments");

      if (!assignWrap) return;

      assignWrap.innerHTML =
        rows && rows.length
          ? `<h3>Assignments</h3>` +
            rows
              .map(
                renderAssignment
              )
              .join("")
          : `
              <div class="empty">
                No assignments posted yet.
              </div>
            `;

      if (
        rows &&
        rows.length
      ) {
        rows.forEach(
          bindAssignment
        );
      }

    } catch (err) {
      console.error(
        "loadAssignments error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // RENDER ASSIGNMENT
  // ============================================================

  function renderAssignment(a) {

    const timePart =
      (
        a.due_time ||
        "23:59:59"
      ).slice(
        0,
        8
      );

    const datePart =
      String(
        a.due_date ||
          ""
      )
        .split("T")[0]
        .split(" ")[0];

    const dueMs =
      new Date(
        `${datePart}T${timePart}`
      ).getTime();

    const closed =
      Boolean(
        a.closed
      ) ||
      (
        !Number.isNaN(
          dueMs
        ) &&
        dueMs <
          Date.now()
      );

    const subDisplayName =
      a.file_original ||
      "Uploaded Document";

    const hasSubmission =
      a.submission_id !==
        null &&
      a.submission_id !==
        undefined;

    const hasMarks =
      a.final_marks !==
        null &&
      a.final_marks !==
        undefined;

    const isPosted =
      Number(
        a.posted
      ) === 1 ||
      a.posted === true;

    return `
      <div
        class="mini-card"
        style="margin-bottom:14px"
      >

        <h4>
          ${escapeHtml(
            a.title
          )}
        </h4>

        <p>
          ${escapeHtml(
            a.description ||
              "No instructions provided."
          )}
        </p>

        <p>

          <span class="pill">
            Total:
            ${escapeHtml(
              a.total_marks
            )}
          </span>

          <span class="pill deadline">
            Due:
            ${escapeHtml(
              datePart
            )}
            ${escapeHtml(
              timePart
            )}
          </span>

        </p>

        ${
          closed
            ? `
              <div class="closed-banner">
                Submission closed.
              </div>
            `
            : `
              <div class="open-banner">
                Open for submission.
              </div>
            `
        }

        ${
          a.question_file
            ? `
              <div
                style="
                  margin:8px 0;
                "
              >

                <button
                  class="btn secondary"
                  data-view-question="${escapeHtml(
                    a.id
                  )}"
                  data-question-name="${escapeHtml(
                    a.question_original ||
                    "question-paper"
                  )}"
                  type="button"
                >
                  📄 View question paper
                </button>

              </div>
            `
            : ""
        }

        ${
          hasSubmission
            ? `
              <div
                class="submitted-box"
                style="
                  background:#f8fafc;
                  padding:12px;
                  border-radius:8px;
                  border:1px solid #e2e8f0;
                  margin-top:10px;
                "
              >

                <p
                  style="
                    margin:0 0 6px 0;
                    font-size:14px;
                    color:#1e293b;
                  "
                >

                  <strong>
                    Your Submission:
                  </strong>

                  <button
                    class="btn secondary"
                    data-view-own-submission="${escapeHtml(
                      a.submission_id
                    )}"
                    data-own-file-name="${escapeHtml(
                      subDisplayName
                    )}"
                    type="button"
                    style="margin-left:8px;"
                  >
                    📄 View / Download
                  </button>

                </p>

                <p
                  class="note"
                  style="
                    margin:0 0 6px 0;
                    word-break:break-word;
                  "
                >
                  File:
                  ${escapeHtml(
                    subDisplayName
                  )}
                </p>

                <p
                  class="note"
                  style="
                    margin:0 0 6px 0;
                  "
                >
                  Submitted on:
                  ${fmtDateTime(
                    a.submitted_at
                  )}
                </p>

                <p
                  style="
                    margin:0;
                    font-size:13px;
                    color:#475569;
                  "
                >

                  Marks:

                  ${
                    hasMarks &&
                    isPosted
                      ? `
                        <b
                          style="
                            color:#16a34a;
                          "
                        >
                          ${escapeHtml(
                            a.final_marks
                          )}/${escapeHtml(
                            a.total_marks
                          )}
                        </b>

                        <span
                          style="
                            color:#166534;
                            margin-left:6px;
                          "
                        >
                          Result posted
                        </span>
                      `
                      : hasMarks
                      ? `
                        <b
                          style="
                            color:#d97706;
                          "
                        >
                          ${escapeHtml(
                            a.final_marks
                          )}/${escapeHtml(
                            a.total_marks
                          )}
                        </b>

                        <em>
                          (not posted yet)
                        </em>
                      `
                      : `
                        <em>
                          not posted yet
                        </em>
                      `
                  }

                </p>

              </div>

              ${
                !closed
                  ? `
                    <button
                      class="btn secondary"
                      style="
                        margin-top:10px;
                      "
                      data-modify="${escapeHtml(
                        a.id
                      )}"
                      data-sub="${escapeHtml(
                        a.submission_id
                      )}"
                      type="button"
                    >
                      Modify submission
                      (OTP required)
                    </button>
                  `
                  : ""
              }
            `
            : !closed
            ? `
              <div
                class="filebox"
                style="
                  margin-top:10px;
                "
              >

                <input
                  type="file"
                  id="file-${escapeHtml(
                    a.id
                  )}"
                >

                <button
                  class="btn"
                  style="
                    margin-top:8px;
                  "
                  data-submit="${escapeHtml(
                    a.id
                  )}"
                  type="button"
                >
                  Submit answer
                </button>

              </div>
            `
            : `
              <p
                class="note"
                style="
                  margin-top:8px;
                "
              >
                No submission was made before
                the deadline.
              </p>
            `
        }

      </div>
    `;
  }

  // ============================================================
  // BIND ASSIGNMENT BUTTONS
  // ============================================================

  function bindAssignment(a) {

    // ----------------------------------------------------------
    // VIEW QUESTION PAPER
    // ----------------------------------------------------------

    const questionBtn =
      findButtonByData(
        "view-question",
        a.id
      );

    if (questionBtn) {
      questionBtn.onclick =
        async () => {
          const originalText =
            questionBtn.textContent;

          questionBtn.disabled =
            true;

          questionBtn.textContent =
            "Opening...";

          try {
            const url =
              `${getApiBase()}/api/student/assignments/${encodeURIComponent(
                a.id
              )}/question-paper`;

            await openProtectedFile(
              url,
              a.question_original ||
                "question-paper"
            );
          } finally {
            questionBtn.disabled =
              false;

            questionBtn.textContent =
              originalText;
          }
        };
    }

    // ----------------------------------------------------------
    // VIEW OWN SUBMISSION
    // ----------------------------------------------------------

    const ownSubmissionBtn =
      findButtonByData(
        "view-own-submission",
        a.submission_id
      );

    if (ownSubmissionBtn) {
      ownSubmissionBtn.onclick =
        async () => {
          const originalText =
            ownSubmissionBtn.textContent;

          ownSubmissionBtn.disabled =
            true;

          ownSubmissionBtn.textContent =
            "Opening...";

          try {
            const url =
              `${getApiBase()}/api/student/submissions/${encodeURIComponent(
                a.submission_id
              )}/file`;

            await openProtectedFile(
              url,
              a.file_original ||
                "student-submission"
            );
          } finally {
            ownSubmissionBtn.disabled =
              false;

            ownSubmissionBtn.textContent =
              originalText;
          }
        };
    }

    // ----------------------------------------------------------
    // SUBMIT ASSIGNMENT
    // ----------------------------------------------------------

    const submitBtn =
      findButtonByData(
        "submit",
        a.id
      );

    if (submitBtn) {

      submitBtn.onclick =
        async () => {

          const fileInput =
            document.getElementById(
              `file-${a.id}`
            );

          const file =
            fileInput
              ? fileInput.files[0]
              : null;

          if (!file) {
            return notice(
              "No file chosen",
              "Select a file to upload.",
              "err"
            );
          }

          if (
            file.size >
            15 *
              1024 *
              1024
          ) {
            return notice(
              "File too large",
              "Maximum allowed size is 15MB.",
              "err"
            );
          }

          const fd =
            new FormData();

          fd.append(
            "file",
            file
          );

          try {

            submitBtn.disabled =
              true;

            submitBtn.textContent =
              "Uploading...";

            await api(
              `/api/student/assignments/${encodeURIComponent(
                a.id
              )}/submit`,
              {
                method:
                  "POST",

                isForm:
                  true,

                body:
                  fd,
              }
            );

            notice(
              "Submitted",
              "Your answer was submitted successfully."
            );

            await openFaculty(
              a.faculty_id
            );

          } catch (e) {

            notice(
              "Submission failed",
              e.message ||
                "Could not submit the assignment.",
              "err"
            );

            submitBtn.disabled =
              false;

            submitBtn.textContent =
              "Submit answer";
          }
        };
    }

    // ----------------------------------------------------------
    // MODIFY SUBMISSION
    // ----------------------------------------------------------

    const modifyBtn =
      findButtonByData(
        "modify",
        a.id
      );

    if (modifyBtn) {
      modifyBtn.onclick =
        () =>
          requestModifyOtp(
            a
          );
    }
  }

  // ============================================================
  // SAFE DATA ATTRIBUTE BUTTON SEARCH
  // ============================================================

  function findButtonByData(
    attribute,
    value
  ) {
    const buttons =
      document.querySelectorAll(
        `[data-${attribute}]`
      );

    for (
      const button
      of buttons
    ) {
      if (
        String(
          button.dataset[
            attribute
          ]
        ) ===
        String(value)
      ) {
        return button;
      }
    }

    return null;
  }

  // ============================================================
  // REQUEST MODIFY OTP
  // ============================================================

  async function requestModifyOtp(
    a
  ) {
    try {

      await api(
        `/api/student/submissions/${encodeURIComponent(
          a.submission_id
        )}/request-modify-otp`,
        {
          method:
            "POST",
        }
      );

    } catch (e) {

      return notice(
        "Could not send OTP",
        e.message ||
          "Could not send OTP.",
        "err"
      );
    }

    openModal(
      "Verify to modify submission",
      `
        <p class="note">
          Enter the OTP code sent to your
          registered email to replace your file.
        </p>

        <div
          class="field"
          style="margin-top:10px;"
        >

          <label>
            New file (max 15MB)
          </label>

          <input
            type="file"
            id="modFile"
          >

        </div>

        <div
          class="otp-boxes"
          style="margin-top:10px;"
        >

          <div class="field">

            <label>
              Email OTP Code
            </label>

            <input
              id="modEmailOtp"
              maxlength="6"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="e.g. 123456"
            >

          </div>

        </div>

        <div
          class="error-inline hidden"
          id="modErr"
        ></div>

        <div
          class="row-buttons"
          style="margin-top:15px;"
        >

          <button
            class="btn"
            id="modConfirm"
            type="button"
          >
            Verify & Replace
          </button>

        </div>
      `
    );

    const confirmBtn =
      document.getElementById(
        "modConfirm"
      );

    if (!confirmBtn) {
      return;
    }

    confirmBtn.onclick =
      async () => {

        const fileInput =
          document.getElementById(
            "modFile"
          );

        const file =
          fileInput
            ? fileInput.files[0]
            : null;

        const errBox =
          document.getElementById(
            "modErr"
          );

        if (!errBox) {
          return;
        }

        errBox.classList.add(
          "hidden"
        );

        if (!file) {
          errBox.textContent =
            "Choose a replacement file.";

          errBox.classList.remove(
            "hidden"
          );

          return;
        }

        if (
          file.size >
          15 *
            1024 *
            1024
        ) {
          errBox.textContent =
            "Maximum allowed file size is 15MB.";

          errBox.classList.remove(
            "hidden"
          );

          return;
        }

        const otpInput =
          document.getElementById(
            "modEmailOtp"
          );

        const emailOtp =
          otpInput
            ? otpInput.value.trim()
            : "";

        if (!emailOtp) {
          errBox.textContent =
            "Please enter the OTP code.";

          errBox.classList.remove(
            "hidden"
          );

          return;
        }

        if (
          !/^\d{6}$/.test(
            emailOtp
          )
        ) {
          errBox.textContent =
            "OTP must contain exactly 6 digits.";

          errBox.classList.remove(
            "hidden"
          );

          return;
        }

        const fd =
          new FormData();

        fd.append(
          "file",
          file
        );

        fd.append(
          "emailOtp",
          emailOtp
        );

        try {

          confirmBtn.disabled =
            true;

          confirmBtn.textContent =
            "Replacing...";

          await api(
            `/api/student/submissions/${encodeURIComponent(
              a.submission_id
            )}/modify`,
            {
              method:
                "POST",

              isForm:
                true,

              body:
                fd,
            }
          );

          closeModal();

          notice(
            "Submission replaced",
            "Your latest file is now the active submission."
          );

          await openFaculty(
            a.faculty_id
          );

        } catch (e) {

          errBox.textContent =
            e.message ||
            "Could not replace submission.";

          errBox.classList.remove(
            "hidden"
          );

          confirmBtn.disabled =
            false;

          confirmBtn.textContent =
            "Verify & Replace";
        }
      };
  }

  // ============================================================
  // MY COURSES
  // ============================================================

  async function loadCourses() {
    try {

      const rows =
        await api(
          "/api/student/my-courses"
        );

      const listEl =
        $("coursesList");

      if (!listEl) {
        return;
      }

      listEl.innerHTML =
        rows && rows.length
          ? rows
              .map(
                (c) => `
                  <div class="mini-card">

                    <h4>
                      ${escapeHtml(
                        c.name
                      )}
                    </h4>

                    <p>
                      ${escapeHtml(
                        c.subject ||
                          ""
                      )}
                    </p>

                    <span
                      class="status-pill status-${escapeHtml(
                        c.status
                      )}"
                    >
                      ${escapeHtml(
                        c.status
                      )}
                    </span>

                  </div>
                `
              )
              .join("")
          : `
              <div class="empty">
                You haven't registered under
                any faculty yet.
              </div>
            `;

    } catch (err) {

      console.error(
        "loadCourses error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // ASSIGNMENT MARKS
  // ============================================================

  async function loadMarks() {
    try {

      const rows =
        await api(
          "/api/student/marks"
        );

      const bodyEl =
        $("marksBody");

      if (!bodyEl) {
        return;
      }

      bodyEl.innerHTML =
        rows && rows.length
          ? rows
              .map(
                (r) => `
                  <tr>

                    <td>
                      ${escapeHtml(
                        r.title
                      )}
                    </td>

                    <td>
                      ${escapeHtml(
                        r.faculty_name
                      )}
                    </td>

                    <td>
                      ${fmtDateTime(
                        r.submitted_at
                      )}
                    </td>

                    <td>

                      ${
                        r.posted
                          ? `
                            <span class="marks">
                              ${escapeHtml(                                     r.final_marks                                   )}/${escapeHtml(
                                r.total_marks
                              )}
                            </span>
                          `
                          : `
                            Not posted yet
                          `
                      }

                    </td>

                  </tr>
                `
              )
              .join("")
          : `
              <tr>

                <td
                  colspan="4"
                  class="empty"
                >
                  No submissions yet.
                </td>

              </tr>
            `;

    } catch (err) {

      console.error(
        "loadMarks error:",
        err.message || err
      );
    }
  }

  // ============================================================
  // EXAMS
  // ============================================================

  async function loadExams() {
    try {

      const rows =
        await api(
          "/api/student/exams"
        );

      const listEl =
        $("examsList");

      if (!listEl) {
        return;
      }

      listEl.innerHTML =
        rows && rows.length
          ? rows
              .map(
                (ex) => {

                  const startTime =
                    ex.start_time ||
                    "00:00:00";

                  const examDate =
                    String(
                      ex.exam_date ||
                        ""
                    )
                      .split(
                        "T"
                      )[0]
                      .split(
                        " "
                      )[0];

                  const start =
                    new Date(
                      `${examDate}T${startTime}`
                    );

                  const durationMin =
                    Number(
                      ex.duration_min
                    ) || 30;

                  const end =
                    new Date(
                      start.getTime() +
                        durationMin *
                          60000
                    );

                  const now =
                    new Date();

                  const totalMarks =
                    Number(
                      ex.total_marks
                    ) || 0;

                  const hasScore =
                    ex.score !==
                      null &&
                    ex.score !==
                      undefined &&
                    ex.score !==
                      "" &&
                    !Number.isNaN(
                      Number(
                        ex.score
                      )
                    );

                  let status =
                    "";

                  if (
                    ex.submitted_at
                  ) {

                    if (
                      hasScore
                    ) {

                      const score =
                        Number(
                          ex.score
                        );

                      status = `
                        <div
                          style="
                            margin-top:10px;
                            padding:12px;
                            border-radius:10px;
                            background:#ecfdf5;
                            border:1px solid #bbf7d0;
                          "
                        >

                          <div
                            style="
                              font-size:14px;
                              color:#166534;
                              font-weight:600;
                            "
                          >
                            EXAM SUBMITTED
                          </div>

                          <div
                            style="
                              font-size:20px;
                              font-weight:700;
                              color:#15803d;
                              margin-top:4px;
                            "
                          >
                            Marks Obtained:
                            ${score}/${totalMarks}
                          </div>

                          ${
                            Number(
                              ex.posted
                            ) ===
                              1 ||
                            ex.posted ===
                              true
                              ? `
                                <div
                                  style="
                                    margin-top:4px;
                                    font-size:13px;
                                    color:#166534;
                                  "
                                >
                                  Result posted by faculty
                                </div>
                              `
                              : `
                                <div
                                  style="
                                    margin-top:4px;
                                    font-size:13px;
                                    color:#166534;
                                  "
                                >
                                  Auto-evaluated score
                                </div>
                              `
                          }

                        </div>
                      `;

                    } else {

                      status = `
                        <div
                          style="
                            margin-top:10px;
                            padding:10px;
                            border-radius:8px;
                            background:#fff7ed;
                            border:1px solid #fed7aa;
                            color:#9a3412;
                          "
                        >
                          Exam submitted.
                          Score is not available yet.
                        </div>
                      `;
                    }

                  } else if (
                    now < start
                  ) {

                    status = `
                      <span class="note">
                        Starts
                        ${start.toLocaleString()}
                      </span>
                    `;

                  } else if (
                    now > end
                  ) {

                    status = `
                      <span class="note">
                        Missed / window closed
                      </span>
                    `;

                  } else {

                    status = `
                      <button
                        class="btn"
                        data-exam="${escapeHtml(
                          ex.id
                        )}"
                        type="button"
                      >
                        Start exam
                      </button>
                    `;
                  }

                  return `
                    <div
                      class="mini-card"
                      style="margin-bottom:14px;"
                    >

                      <h4>
                        ${escapeHtml(
                          ex.title
                        )}
                      </h4>

                      <p>
                        ${escapeHtml(
                          ex.faculty_name ||
                            ""
                        )}
                      </p>

                      <p>
                        ${escapeHtml(
                          examDate
                        )}

                        ${escapeHtml(
                          startTime
                        )}

                        ·

                        ${durationMin}
                        min

                        ·

                        ${totalMarks}
                        marks
                      </p>

                      ${status}

                    </div>
                  `;
                }
              )
              .join("")
          : `
              <div class="empty">
                No exams available yet.
              </div>
            `;

      // ========================================================
      // START EXAM BUTTONS
      // ========================================================

      document
        .querySelectorAll(
          "[data-exam]"
        )
        .forEach((button) => {

          button.onclick =
            () => {

              window.location.href =
                `exam-take.html?examId=${encodeURIComponent(
                  button.dataset
                    .exam
                )}`;
            };
        });

    } catch (err) {

      console.error(
        "loadExams error:",
        err.message || err
      );

      const listEl =
        $("examsList");

      if (listEl) {

        listEl.innerHTML = `
          <div
            class="closed-banner"
            style="margin-top:10px;"
          >
            Could not load exams.
            Please refresh the page.
          </div>
        `;
      }
    }
  }

  // ============================================================
  // START
  // ============================================================

  init();

})();