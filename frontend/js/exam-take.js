// frontend/js/exam-take.js

(function () {
  "use strict";

  const user = requireLogin("student");

  if (!user) return;

  const $ = (id) =>
    document.getElementById(id);

  // ============================================================
  // GET EXAM ID
  // ============================================================

  const params =
    new URLSearchParams(
      window.location.search
    );

  const examId =
    params.get("examId");

  if (!examId) {
    window.location.href =
      "student.html";
    return;
  }

  // ============================================================
  // STATE
  // ============================================================

  let attemptId = null;
  let secondsLeft = 0;
  let timerHandle = null;
  let submitted = false;

  // questionId -> selected option
  const answers = {};

  // ============================================================
  // START EXAM
  // ============================================================

  async function start() {
    try {
      const data =
        await api(
          `/api/exams/${encodeURIComponent(
            examId
          )}/start`,
          {
            method: "POST",
          }
        );

      // --------------------------------------------------------
      // Attempt
      // --------------------------------------------------------

      attemptId =
        data.attemptId;

      if (!attemptId) {
        throw new Error(
          "Exam attempt could not be created."
        );
      }

      // --------------------------------------------------------
      // Timer
      // --------------------------------------------------------

      secondsLeft =
        Number(
          data.secondsLeft
        );

      if (
        !Number.isFinite(
          secondsLeft
        ) ||
        secondsLeft < 0
      ) {
        secondsLeft = 0;
      }

      // --------------------------------------------------------
      // Exam title
      // --------------------------------------------------------

      if (
        $("examTitle") &&
        data.exam
      ) {
        const totalMarks =
          Number(
            data.exam.totalMarks
          ) || 0;

        $("examTitle").textContent =
          `${data.exam.title} (${totalMarks} marks)`;
      }

      // --------------------------------------------------------
      // Questions
      // --------------------------------------------------------

      renderQuestions(
        data.questions || []
      );

      // --------------------------------------------------------
      // Timer
      // --------------------------------------------------------

      tick();

      timerHandle =
        setInterval(
          tick,
          1000
        );

    } catch (e) {
      console.error(
        "START EXAM ERROR:",
        e
      );

      notice(
        "Cannot start exam",
        e.message ||
          "Could not start the exam.",
        "err"
      );

      setTimeout(
        () => {
          window.location.href =
            "student.html";
        },
        1800
      );
    }
  }

  // ============================================================
  // RENDER QUESTIONS
  // ============================================================

  function renderQuestions(
    questions
  ) {
    const root =
      $("questionsRoot") ||
      document.querySelector(
        ".questions-wrap"
      ) ||
      document.querySelector(
        "#questionsWrap"
      ) ||
      document.querySelector(
        ".exam-content"
      );

    if (!root) {
      console.error(
        "Questions container not found."
      );

      return;
    }

    if (
      !questions ||
      !questions.length
    ) {
      root.innerHTML = `
        <div
          class="empty"
          style="
            padding:24px;
            text-align:center;
            color:#64748b;
          "
        >
          No questions found for this exam.
        </div>
      `;

      return;
    }

    root.innerHTML =
      questions
        .map(
          (q, index) => {

            const marks =
              Number(
                q.marks
              ) || 1;

            return `
              <div
                class="q-card"
                data-question-id="${escapeHtml(
                  q.id
                )}"
                style="
                  background:#ffffff;
                  border:1px solid #e2e8f0;
                  border-radius:8px;
                  padding:18px;
                  margin-bottom:16px;
                  box-shadow:0 1px 3px rgba(0,0,0,0.05);
                "
              >

                <h4
                  style="
                    margin:0 0 12px 0;
                    color:#1e293b;
                    font-size:16px;
                  "
                >

                  Q${index + 1}.
                  ${escapeHtml(
                    q.question_text ||
                      ""
                  )}

                  <small
                    class="note"
                    style="
                      font-size:12px;
                      color:#64748b;
                      font-weight:normal;
                    "
                  >
                    (${marks}
                    ${
                      marks === 1
                        ? "mark"
                        : "marks"
                    })
                  </small>

                </h4>

                <div
                  class="options-container"
                  style="
                    display:flex;
                    flex-direction:column;
                    gap:8px;
                  "
                >

                  ${[
                    "A",
                    "B",
                    "C",
                    "D",
                  ]
                    .map(
                      (opt) => {

                        const key =
                          "option_" +
                          opt.toLowerCase();

                        const optText =
                          q[key] || "";

                        return `
                          <div
                            class="opt"
                            data-qid="${escapeHtml(
                              q.id
                            )}"
                            data-opt="${opt}"
                            role="button"
                            tabindex="0"
                            style="
                              display:flex;
                              align-items:center;
                              gap:10px;
                              padding:10px 14px;
                              border:1px solid #cbd5e1;
                              border-radius:6px;
                              cursor:pointer;
                              transition:all 0.2s ease;
                            "
                          >

                            <b
                              style="
                                color:#4f46e5;
                                min-width:20px;
                              "
                            >
                              ${opt}.
                            </b>

                            <span
                              style="
                                color:#334155;
                              "
                            >
                              ${escapeHtml(
                                optText
                              )}
                            </span>

                          </div>
                        `;
                      }
                    )
                    .join("")}

                </div>

              </div>
            `;
          }
        )
        .join("");

    // ========================================================
    // OPTION CLICK
    // ========================================================

    root
      .querySelectorAll(
        ".opt"
      )
      .forEach(
        (el) => {

          const selectOption =
            () => {

              if (
                submitted
              ) {
                return;
              }

              const qid =
                el.dataset.qid;

              const opt =
                el.dataset.opt;

              if (!qid || !opt) {
                return;
              }

              // ------------------------------------------------
              // Remove selected state
              // ------------------------------------------------

              root
                .querySelectorAll(
                  `.opt[data-qid="${CSS.escape(
                    String(qid)
                  )}"]`
                )
                .forEach(
                  (option) => {

                    option.classList.remove(
                      "selected"
                    );

                    option.style.borderColor =
                      "#cbd5e1";

                    option.style.background =
                      "#ffffff";
                  }
                );

              // ------------------------------------------------
              // Set selected state
              // ------------------------------------------------

              el.classList.add(
                "selected"
              );

              el.style.borderColor =
                "#4f46e5";

              el.style.background =
                "#eef2ff";

              answers[qid] =
                opt;

              // ------------------------------------------------
              // Autosave
              // ------------------------------------------------

              saveAnswer(
                qid,
                opt
              );
            };

          el.onclick =
            selectOption;

          el.onkeydown =
            (event) => {

              if (
                event.key ===
                  "Enter" ||
                event.key ===
                  " "
              ) {
                event.preventDefault();

                selectOption();
              }
            };
        }
      );
  }

  // ============================================================
  // SAVE ANSWER
  // ============================================================

  async function saveAnswer(
    questionId,
    selected
  ) {
    if (!attemptId) {
      return;
    }

    try {
      await api(
        `/api/exams/attempts/${encodeURIComponent(
          attemptId
        )}/answer`,
        {
          method: "POST",

          body: {
            questionId,
            selected,
          },
        }
      );
    } catch (err) {
      console.warn(
        "Autosave answer failed:",
        err.message || err
      );
    }
  }

  // ============================================================
  // TIMER
  // ============================================================

  function tick() {
    if (submitted) {
      return;
    }

    const safeSeconds =
      Math.max(
        0,
        Number(
          secondsLeft
        ) || 0
      );

    const minutes =
      Math.floor(
        safeSeconds / 60
      );

    const seconds =
      safeSeconds % 60;

    if ($("clock")) {
      $("clock").textContent =
        `${String(
          minutes
        ).padStart(
          2,
          "0"
        )}:${String(
          seconds
        ).padStart(
          2,
          "0"
        )}`;
    }

    if ($("timerBar")) {
      $("timerBar").classList.toggle(
        "low",
        safeSeconds <= 60
      );
    }

    // ----------------------------------------------------------
    // Time finished
    // ----------------------------------------------------------

    if (
      safeSeconds <= 0
    ) {
      doSubmit(true);
      return;
    }

    secondsLeft =
      safeSeconds - 1;
  }

  // ============================================================
  // SUBMIT EXAM
  // ============================================================

  async function doSubmit(
    autoSubmitted
  ) {
    if (submitted) {
      return;
    }

    submitted =
      true;

    if (timerHandle) {
      clearInterval(
        timerHandle
      );

      timerHandle =
        null;
    }

    if (
      $("submitExamBtn")
    ) {
      $("submitExamBtn").disabled =
        true;
    }

    try {

      const response =
        await api(
          `/api/exams/attempts/${encodeURIComponent(
            attemptId
          )}/submit`,
          {
            method: "POST",

            body: {
              autoSubmitted:
                Boolean(
                  autoSubmitted
                ),
            },
          }
        );

      // --------------------------------------------------------
      // Score returned by backend
      // --------------------------------------------------------

      const hasScore =
        response &&
        response.score !==
          null &&
        response.score !==
          undefined &&
        response.score !== "";

      const scoreText =
        hasScore
          ? `Score: ${Number(
              response.score
            )}`
          : "Your result has been recorded.";

      notice(
        autoSubmitted
          ? "Time's up"
          : "Exam submitted",
        autoSubmitted
          ? `The exam was auto-submitted when the timer ended. ${scoreText}`
          : `Your exam has been submitted successfully. ${scoreText}`
      );

      // --------------------------------------------------------
      // Return to student dashboard
      // --------------------------------------------------------

      setTimeout(
        () => {
          window.location.href =
            "student.html";
        },
        2000
      );

    } catch (e) {

      console.error(
        "SUBMIT EXAM ERROR:",
        e
      );

      submitted =
        false;

      if (
        $("submitExamBtn")
      ) {
        $("submitExamBtn").disabled =
          false;
      }

      notice(
        "Submit failed",
        e.message ||
          "Could not submit exam.",
        "err"
      );
    }
  }

  // ============================================================
  // MANUAL SUBMIT BUTTON
  // ============================================================

  if (
    $("submitExamBtn")
  ) {

    $("submitExamBtn").onclick =
      () => {

        if (submitted) {
          return;
        }

        const confirmed =
          window.confirm(
            "Submit the exam now? You cannot change answers after submitting."
          );

        if (
          confirmed
        ) {
          doSubmit(
            false
          );
        }
      };
  }

  // ============================================================
  // PREVENT ACCIDENTAL EXIT
  // ============================================================

  window.addEventListener(
    "beforeunload",
    (event) => {

      if (!submitted) {

        event.preventDefault();

        event.returnValue =
          "";
      }
    }
  );

  // ============================================================
  // START
  // ============================================================

  start();

})();