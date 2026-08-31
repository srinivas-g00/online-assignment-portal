// frontend/js/auth.js

(function () {
  "use strict";

  let role = "student";

  let loginCaptchaId = null;
  let regCaptchaId = null;

  const $ = (id) =>
    document.getElementById(id);

  // ============================================================
  // SAFE SESSION HELPERS
  // ============================================================

  function getSafeUser() {
    try {
      if (
        typeof window.getUser ===
        "function"
      ) {
        return window.getUser();
      }

      const raw =
        localStorage.getItem(
          "oa_user"
        ) ||
        sessionStorage.getItem(
          "oa_user"
        ) ||
        localStorage.getItem(
          "aop_user"
        ) ||
        sessionStorage.getItem(
          "aop_user"
        );

      return raw
        ? JSON.parse(raw)
        : null;
    } catch (err) {
      console.warn(
        "GET USER ERROR:",
        err.message
      );

      return null;
    }
  }

  function getSafeToken() {
    try {
      if (
        typeof window.getToken ===
        "function"
      ) {
        return window.getToken();
      }

      return (
        localStorage.getItem(
          "oa_token"
        ) ||
        sessionStorage.getItem(
          "oa_token"
        ) ||
        localStorage.getItem(
          "aop_token"
        ) ||
        sessionStorage.getItem(
          "aop_token"
        ) ||
        ""
      );
    } catch (err) {
      console.warn(
        "GET TOKEN ERROR:",
        err.message
      );

      return "";
    }
  }

  function saveSession(
    token,
    user
  ) {
    if (!token) {
      throw new Error(
        "Login token was not returned by the server."
      );
    }

    if (
      typeof window.setSession ===
      "function"
    ) {
      window.setSession(
        token,
        user
      );

      return;
    }

    localStorage.setItem(
      "oa_token",
      token
    );

    localStorage.setItem(
      "oa_user",
      JSON.stringify(
        user || {}
      )
    );

    // Backward compatibility
    localStorage.setItem(
      "aop_token",
      token
    );

    localStorage.setItem(
      "aop_user",
      JSON.stringify(
        user || {}
      )
    );
  }

  // ============================================================
  // AUTO REDIRECT IF ALREADY LOGGED IN
  // ============================================================

  try {
    const existingUser =
      getSafeUser();

    const existingToken =
      getSafeToken();

    if (
      existingToken &&
      existingUser &&
      existingUser.role
    ) {
      window.location.href =
        existingUser.role ===
        "faculty"
          ? "faculty.html"
          : "student.html";

      return;
    }
  } catch (err) {
    console.warn(
      "Session check skipped:",
      err.message
    );
  }

  // ============================================================
  // ROLE TOGGLE
  // ============================================================

  if ($("roleStudent")) {
    $("roleStudent").onclick =
      () =>
        setRole(
          "student"
        );
  }

  if ($("roleFaculty")) {
    $("roleFaculty").onclick =
      () =>
        setRole(
          "faculty"
        );
  }

  function setRole(newRole) {
    role =
      newRole ===
      "faculty"
        ? "faculty"
        : "student";

    if ($("roleStudent")) {
      $("roleStudent").classList.toggle(
        "active",
        role === "student"
      );
    }

    if ($("roleFaculty")) {
      $("roleFaculty").classList.toggle(
        "active",
        role === "faculty"
      );
    }

    if ($("studentFields")) {
      $("studentFields").classList.toggle(
        "hidden",
        role !== "student"
      );
    }

    if ($("facultyFields")) {
      $("facultyFields").classList.toggle(
        "hidden",
        role !== "faculty"
      );
    }
  }

  // ============================================================
  // LOGIN / REGISTER MODE
  // ============================================================

  if ($("modeLogin")) {
    $("modeLogin").onclick =
      () =>
        setMode(
          "login"
        );
  }

  if ($("modeRegister")) {
    $("modeRegister").onclick =
      () =>
        setMode(
          "register"
        );
  }

  function setMode(mode) {
    if ($("modeLogin")) {
      $("modeLogin").classList.toggle(
        "active",
        mode === "login"
      );
    }

    if ($("modeRegister")) {
      $("modeRegister").classList.toggle(
        "active",
        mode === "register"
      );
    }

    if ($("loginForm")) {
      $("loginForm").classList.toggle(
        "hidden",
        mode !== "login"
      );
    }

    if ($("registerForm")) {
      $("registerForm").classList.toggle(
        "hidden",
        mode !== "register"
      );
    }

    if ($("loginError")) {
      $("loginError").classList.add(
        "hidden"
      );
    }

    if ($("regError")) {
      $("regError").classList.add(
        "hidden"
      );
    }

    // Refresh the captcha belonging to the active form
    if (mode === "login") {
      loadCaptcha(
        "login"
      );
    } else {
      loadCaptcha(
        "register"
      );
    }
  }

  // ============================================================
  // PASSWORD VISIBILITY
  // ============================================================

  document
    .querySelectorAll(
      ".eye"
    )
    .forEach((button) => {
      button.onclick =
        () => {
          const input =
            $(
              button.dataset
                .toggle
            );

          if (!input) {
            return;
          }

          input.type =
            input.type ===
            "password"
              ? "text"
              : "password";
        };
    });

  // ============================================================
  // CAPTCHA
  // ============================================================

  async function fetchCaptchaDirect() {
    const response =
      await fetch(
        "/api/auth/captcha",
        {
          method:
            "GET",

          headers: {
            Accept:
              "application/json",
          },

          credentials:
            "same-origin",
        }
      );

    let data = null;

    try {
      data =
        await response.json();
    } catch (err) {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        (
          data &&
          data.error
        ) ||
          `Captcha request failed (${response.status})`
      );
    }

    return data;
  }

  async function loadCaptcha(
    target
  ) {
    const isLogin =
      target ===
      "login";

    const textEl =
      isLogin
        ? $("loginCapText")
        : $("regCapText");

    const inputEl =
      isLogin
        ? $("loginCapAnswer")
        : $("regCapAnswer");

    if (textEl) {
      textEl.textContent =
        "•••";
    }

    try {
      const data =
        await fetchCaptchaDirect();

      const captchaId =
        data &&
        (
          data.captchaId ||
          data.id
        );

      const captchaText =
        data &&
        (
          data.captchaText ||
          data.text
        );

      if (!captchaId) {
        throw new Error(
          "Captcha ID missing."
        );
      }

      if (!captchaText) {
        throw new Error(
          "Captcha text missing."
        );
      }

      if (isLogin) {
        loginCaptchaId =
          captchaId;
      } else {
        regCaptchaId =
          captchaId;
      }

      if (textEl) {
        textEl.textContent =
          captchaText;
      }

      if (inputEl) {
        inputEl.value =
          "";
      }
    } catch (err) {
      console.error(
        "Failed to load captcha:",
        err
      );

      if (textEl) {
        textEl.textContent =
          "REFRESH";
      }
    }
  }

  // Initial captchas
  loadCaptcha(
    "login"
  );

  loadCaptcha(
    "register"
  );

  if (
    $("loginCapRefresh")
  ) {
    $("loginCapRefresh").onclick =
      () =>
        loadCaptcha(
          "login"
        );
  }

  if (
    $("regCapRefresh")
  ) {
    $("regCapRefresh").onclick =
      () =>
        loadCaptcha(
          "register"
        );
  }

  // ============================================================
  // LOGIN
  // ============================================================

  if ($("loginForm")) {
    $("loginForm").onsubmit =
      async (event) => {
        event.preventDefault();

        const errorBox =
          $("loginError");

        if (errorBox) {
          errorBox.classList.add(
            "hidden"
          );
        }

        const submitButton =
          $("loginForm").querySelector(
            "button[type='submit']"
          );

        if (submitButton) {
          submitButton.disabled =
            true;
        }

        try {
          const loginId =
            $("loginId")
              ? $("loginId").value.trim()
              : "";

          const password =
            $("loginPassword")
              ? $("loginPassword").value
              : "";

          const captchaAnswer =
            $("loginCapAnswer")
              ? $("loginCapAnswer")
                  .value
                  .trim()
              : "";

          if (!loginId) {
            throw new Error(
              "Enter your username or email."
            );
          }

          if (!password) {
            throw new Error(
              "Enter your password."
            );
          }

          if (!captchaAnswer) {
            throw new Error(
              "Enter the captcha."
            );
          }

          if (!loginCaptchaId) {
            throw new Error(
              "Captcha is not ready. Please refresh it."
            );
          }

          const response =
            await fetch(
              "/api/auth/login",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json",
                },

                credentials:
                  "same-origin",

                body:
                  JSON.stringify({
                    role,

                    usernameOrEmail:
                      loginId,

                    password,

                    captchaId:
                      loginCaptchaId,

                    captchaAnswer,
                  }),
              }
            );

          let data = null;

          try {
            data =
              await response.json();
          } catch (err) {
            data = null;
          }

          if (!response.ok) {
            throw new Error(
              (
                data &&
                (
                  data.error ||
                  data.message
                )
              ) ||
                `Login failed (${response.status})`
            );
          }

          // ------------------------------------------------------
          // EMAIL VERIFICATION REQUIRED
          // ------------------------------------------------------

          if (
            data &&
            data.needsVerification
          ) {
            openOtpModal(
              data.userId,
              "register",
              async (
                userId,
                emailOtp
              ) => {
                const verifyResponse =
                  await fetch(
                    "/api/auth/verify-registration",
                    {
                      method:
                        "POST",

                      headers: {
                        "Content-Type":
                          "application/json",

                        Accept:
                          "application/json",
                      },

                      credentials:
                        "same-origin",

                      body:
                        JSON.stringify({
                          userId,
                          emailOtp,
                        }),
                    }
                  );

                let verifyData =
                  null;

                try {
                  verifyData =
                    await verifyResponse.json();
                } catch (err) {
                  verifyData =
                    null;
                }

                if (
                  !verifyResponse.ok
                ) {
                  throw new Error(
                    (
                      verifyData &&
                      (
                        verifyData.error ||
                        verifyData.message
                      )
                    ) ||
                      "Verification failed."
                  );
                }

                closeModal();

                alert(
                  "Account verified. You can now log in."
                );

                // Refresh captcha after verification
                loadCaptcha(
                  "login"
                );
              }
            );

            return;
          }

          // ------------------------------------------------------
          // SAVE LOGIN SESSION
          // ------------------------------------------------------

          if (
            !data ||
            !data.token ||
            !data.user
          ) {
            throw new Error(
              "Invalid login response from server."
            );
          }

          saveSession(
            data.token,
            data.user
          );

          window.location.href =
            data.user.role ===
            "faculty"
              ? "faculty.html"
              : "student.html";

        } catch (err) {
          console.error(
            "LOGIN ERROR:",
            err
          );

          if (errorBox) {
            errorBox.textContent =
              err.message ||
              "Invalid credentials.";

            errorBox.classList.remove(
              "hidden"
            );
          }

          loadCaptcha(
            "login"
          );

        } finally {
          if (submitButton) {
            submitButton.disabled =
              false;
          }
        }
      };
  }

  // ============================================================
  // REGISTER
  // ============================================================

  if ($("registerForm")) {
    $("registerForm").onsubmit =
      async (event) => {
        event.preventDefault();

        const errorBox =
          $("regError");

        if (errorBox) {
          errorBox.classList.add(
            "hidden"
          );
        }

        const password =
          $("regPassword")
            ? $("regPassword").value
            : "";

        const confirmPassword =
          $("regConfirmPassword")
            ? $("regConfirmPassword").value
            : "";

        // --------------------------------------------------------
        // PASSWORD VALIDATION
        // --------------------------------------------------------

        if (
          password.length <
          8
        ) {
          if (errorBox) {
            errorBox.textContent =
              "Password must be at least 8 characters.";

            errorBox.classList.remove(
              "hidden"
            );
          }

          return;
        }

        if (
          password !==
          confirmPassword
        ) {
          if (errorBox) {
            errorBox.textContent =
              "Passwords do not match. Please re-enter.";

            errorBox.classList.remove(
              "hidden"
            );
          }

          return;
        }

        const submitButton =
          $("registerForm").querySelector(
            "button[type='submit']"
          );

        if (submitButton) {
          submitButton.disabled =
            true;
        }

        try {
          const payload = {
            role,

            name:
              $("regName")
                ? $("regName")
                    .value
                    .trim()
                : "",

            username:
              $("regUsername")
                ? $("regUsername")
                    .value
                    .trim()
                : "",

            email:
              $("regEmail")
                ? $("regEmail")
                    .value
                    .trim()
                : "",

            password,

            confirmPassword,

            captchaId:
              regCaptchaId,

            captchaAnswer:
              $("regCapAnswer")
                ? $("regCapAnswer")
                    .value
                    .trim()
                : "",
          };

          // ------------------------------------------------------
          // STUDENT FIELDS
          // ------------------------------------------------------

          if (
            role ===
            "student"
          ) {
            payload.branch =
              $("regBranch")
                ? $("regBranch")
                    .value
                    .trim()
                : "";

            payload.year =
              $("regYear")
                ? $("regYear")
                    .value
                    .trim()
                : "";
          }

          // ------------------------------------------------------
          // FACULTY FIELDS
          // ------------------------------------------------------

          else {
            payload.subject =
              $("regSubject")
                ? $("regSubject")
                    .value
                    .trim()
                : "";

            payload.slot =
              $("regSlot")
                ? $("regSlot")
                    .value
                    .trim()
                : "";
          }

          if (!payload.name) {
            throw new Error(
              "Enter your name."
            );
          }

          if (!payload.username) {
            throw new Error(
              "Enter a username."
            );
          }

          if (!payload.email) {
            throw new Error(
              "Enter your email address."
            );
          }

          if (!payload.captchaAnswer) {
            throw new Error(
              "Enter the captcha."
            );
          }

          if (!regCaptchaId) {
            throw new Error(
              "Captcha is not ready. Please refresh it."
            );
          }

          // ------------------------------------------------------
          // REGISTER REQUEST
          // ------------------------------------------------------

          const response =
            await fetch(
              "/api/auth/register",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json",
                },

                credentials:
                  "same-origin",

                body:
                  JSON.stringify(
                    payload
                  ),
              }
            );

          let data = null;

          try {
            data =
              await response.json();
          } catch (err) {
            data = null;
          }

          if (!response.ok) {
            throw new Error(
              (
                data &&
                (
                  data.error ||
                  data.message
                )
              ) ||
                `Registration failed (${response.status})`
            );
          }

          // ------------------------------------------------------
          // OPEN REGISTRATION OTP
          // ------------------------------------------------------

          if (
            !data ||
            !data.userId
          ) {
            throw new Error(
              "Registration response did not contain a user ID."
            );
          }

          openOtpModal(
            data.userId,
            "register",
            async (
              userId,
              emailOtp
            ) => {
              const verifyResponse =
                await fetch(
                  "/api/auth/verify-registration",
                  {
                    method:
                      "POST",

                    headers: {
                      "Content-Type":
                        "application/json",

                      Accept:
                        "application/json",
                    },

                    credentials:
                      "same-origin",

                    body:
                      JSON.stringify({
                        userId,
                        emailOtp,
                      }),
                  }
                );

              let verifyData =
                null;

              try {
                verifyData =
                  await verifyResponse.json();
              } catch (err) {
                verifyData =
                  null;
              }

              if (
                !verifyResponse.ok
              ) {
                throw new Error(
                  (
                    verifyData &&
                    (
                      verifyData.error ||
                      verifyData.message
                    )
                  ) ||
                    "Verification failed."
                );
              }

              closeModal();

              alert(
                "Registration complete! You can now log in."
              );

              setMode(
                "login"
              );

              if (
                $("loginId")
              ) {
                $("loginId").value =
                  payload.username;
              }

              loadCaptcha(
                "login"
              );
            }
          );

        } catch (err) {
          console.error(
            "REGISTRATION ERROR:",
            err
          );

          if (errorBox) {
            errorBox.textContent =
              err.message ||
              "Registration failed.";

            errorBox.classList.remove(
              "hidden"
            );
          }

          loadCaptcha(
            "register"
          );

        } finally {
          if (submitButton) {
            submitButton.disabled =
              false;
          }
        }
      };
  }

  // ============================================================
  // MODAL
  // ============================================================

  function openModal(
    title,
    html
  ) {
    const root =
      $("modalRoot");

    if (!root) {
      return;
    }

    root.innerHTML = `
      <div class="modal-bg">

        <div class="modal">

          <h3>
            ${escapeHtmlLocal(
              title
            )}
          </h3>

          ${html}

          <div
            style="
              text-align:right;
              margin-top:10px;
            "
          >

            <button
              class="btn secondary"
              id="modalCloseBtn"
              type="button"
            >
              Cancel
            </button>

          </div>

        </div>

      </div>
    `;

    const closeButton =
      document.getElementById(
        "modalCloseBtn"
      );

    if (closeButton) {
      closeButton.onclick =
        closeModal;
    }
  }

  // ============================================================
  // CLOSE MODAL
  // ============================================================

  function closeModal() {
    const root =
      $("modalRoot");

    if (root) {
      root.innerHTML =
        "";
    }
  }

  // ============================================================
  // OTP MODAL
  // ============================================================

  function openOtpModal(
    userId,
    purpose,
    onVerify
  ) {
    openModal(
      "Verify Email OTP",
      `
        <p class="note">
          Enter the 6-digit code sent to
          your email inbox.
          Valid for 10 minutes.
        </p>

        <div
          class="field"
          style="margin-top:10px;"
        >

          <label>
            Email OTP Code
          </label>

          <input
            id="otpEmail"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="e.g. 123456"
          >

        </div>

        <div
          class="error-inline hidden"
          id="otpError"
        ></div>

        <div
          class="row-buttons"
          style="margin-top:15px;"
        >

          <button
            class="btn"
            id="otpVerifyBtn"
            type="button"
          >
            Verify
          </button>

          <button
            class="btn secondary"
            id="otpResendBtn"
            type="button"
          >
            Resend Code
          </button>

        </div>
      `
    );

    const verifyButton =
      document.getElementById(
        "otpVerifyBtn"
      );

    const resendButton =
      document.getElementById(
        "otpResendBtn"
      );

    if (verifyButton) {
      verifyButton.onclick =
        async () => {

          const input =
            document.getElementById(
              "otpEmail"
            );

          const errorBox =
            document.getElementById(
              "otpError"
            );

          if (!input || !errorBox) {
            return;
          }

          const emailOtp =
            input.value.trim();

          errorBox.classList.add(
            "hidden"
          );

          if (!emailOtp) {
            errorBox.textContent =
              "Please enter the OTP code.";

            errorBox.classList.remove(
              "hidden"
            );

            return;
          }

          if (
            !/^\d{6}$/.test(
              emailOtp
            )
          ) {
            errorBox.textContent =
              "OTP must contain exactly 6 digits.";

            errorBox.classList.remove(
              "hidden"
            );

            return;
          }

          verifyButton.disabled =
            true;

          try {
            await onVerify(
              userId,
              emailOtp
            );
          } catch (err) {
            errorBox.textContent =
              err.message ||
              "Invalid OTP.";

            errorBox.classList.remove(
              "hidden"
            );
          } finally {
            verifyButton.disabled =
              false;
          }
        };
    }

    if (resendButton) {
      resendButton.onclick =
        async () => {

          resendButton.disabled =
            true;

          try {
            const response =
              await fetch(
                "/api/auth/resend-otp",
                {
                  method:
                    "POST",

                  headers: {
                    "Content-Type":
                      "application/json",

                    Accept:
                      "application/json",
                  },

                  credentials:
                    "same-origin",

                  body:
                    JSON.stringify({
                      userId,
                      purpose,
                    }),
                }
              );

            let data = null;

            try {
              data =
                await response.json();
            } catch (err) {
              data = null;
            }

            if (
              !response.ok
            ) {
              throw new Error(
                (
                  data &&
                  (
                    data.error ||
                    data.message
                  )
                ) ||
                  "Failed to resend code."
              );
            }

            alert(
              "A new OTP code has been sent to your email."
            );
          } catch (err) {
            alert(
              err.message ||
              "Failed to resend code."
            );
          } finally {
            resendButton.disabled =
              false;
          }
        };
    }
  }

  // ============================================================
  // FORGOT PASSWORD
  // ============================================================

  if (
    $("forgotPasswordLink")
  ) {
    $("forgotPasswordLink").onclick =
      (event) => {
        event.preventDefault();

        openModal(
          "Forgot Password",
          `
            <p class="note">
              Enter your registered email address
              to receive a password reset code.
            </p>

            <div
              class="field"
              style="margin-top:10px;"
            >

              <label>
                Registered Email
              </label>

              <input
                id="fpEmail"
                type="email"
                placeholder="name@example.com"
              >

            </div>

            <div
              class="error-inline hidden"
              id="fpError"
            ></div>

            <div
              class="row-buttons"
              style="margin-top:15px;"
            >

              <button
                class="btn"
                id="fpSendBtn"
                type="button"
              >
                Send OTP
              </button>

            </div>
          `
        );

        const sendButton =
          document.getElementById(
            "fpSendBtn"
          );

        if (!sendButton) {
          return;
        }

        sendButton.onclick =
          async () => {

            const emailInput =
              document.getElementById(
                "fpEmail"
              );

            const errorBox =
              document.getElementById(
                "fpError"
              );

            if (
              !emailInput ||
              !errorBox
            ) {
              return;
            }

            const email =
              emailInput.value
                .trim();

            errorBox.classList.add(
              "hidden"
            );

            if (!email) {
              errorBox.textContent =
                "Please enter your email.";

              errorBox.classList.remove(
                "hidden"
              );

              return;
            }

            sendButton.disabled =
              true;

            try {
              const response =
                await fetch(
                  "/api/auth/forgot-password",
                  {
                    method:
                      "POST",

                    headers: {
                      "Content-Type":
                        "application/json",

                      Accept:
                        "application/json",
                    },

                    credentials:
                      "same-origin",

                    body:
                      JSON.stringify({
                        email,
                      }),
                  }
                );

              let data = null;

              try {
                data =
                  await response.json();
              } catch (err) {
                data = null;
              }

              if (
                !response.ok
              ) {
                throw new Error(
                  (
                    data &&
                    (
                      data.error ||
                      data.message
                    )
                  ) ||
                    "Request failed."
                );
              }

              closeModal();

              openResetPasswordModal(
                data.userId
              );

            } catch (err) {

              errorBox.textContent =
                err.message ||
                "Could not request password reset.";

              errorBox.classList.remove(
                "hidden"
              );

            } finally {
              sendButton.disabled =
                false;
            }
          };
      };
  }

  // ============================================================
  // RESET PASSWORD MODAL
  // ============================================================

  function openResetPasswordModal(
    userId
  ) {
    openModal(
      "Reset Password",
      `
        <p class="note">
          Enter the 6-digit OTP code sent to
          your email and your new password.
        </p>

        <div
          class="field"
          style="margin-top:10px;"
        >

          <label>
            Email OTP Code
          </label>

          <input
            id="rpOtp"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="e.g. 123456"
          >

        </div>

        <div
          class="field"
          style="margin-top:10px;"
        >

          <label>
            New Password (min 8 chars)
          </label>

          <input
            id="rpPassword"
            type="password"
            placeholder="Enter new password"
          >

        </div>

        <div
          class="field"
          style="margin-top:10px;"
        >

          <label>
            Confirm New Password
          </label>

          <input
            id="rpConfirmPassword"
            type="password"
            placeholder="Re-enter new password"
          >

        </div>

        <div
          class="error-inline hidden"
          id="rpError"
        ></div>

        <div
          class="row-buttons"
          style="margin-top:15px;"
        >

          <button
            class="btn"
            id="rpSubmitBtn"
            type="button"
          >
            Update Password
          </button>

        </div>
      `
    );

    const submitButton =
      document.getElementById(
        "rpSubmitBtn"
      );

    if (!submitButton) {
      return;
    }

    submitButton.onclick =
      async () => {

        const otpInput =
          document.getElementById(
            "rpOtp"
          );

        const passwordInput =
          document.getElementById(
            "rpPassword"
          );

        const confirmInput =
          document.getElementById(
            "rpConfirmPassword"
          );

        const errorBox =
          document.getElementById(
            "rpError"
          );

        if (
          !otpInput ||
          !passwordInput ||
          !errorBox
        ) {
          return;
        }

        const otp =
          otpInput.value.trim();

        const newPassword =
          passwordInput.value;

        const confirmPassword =
          confirmInput
            ? confirmInput.value
            : "";

        errorBox.classList.add(
          "hidden"
        );

        if (
          !otp ||
          !newPassword
        ) {
          errorBox.textContent =
            "Please fill in all fields.";

          errorBox.classList.remove(
            "hidden"
          );

          return;
        }

        if (
          !/^\d{6}$/.test(
            otp
          )
        ) {
          errorBox.textContent =
            "OTP must contain exactly 6 digits.";

          errorBox.classList.remove(
            "hidden"
          );

          return;
        }

        if (
          newPassword.length <
          8
        ) {
          errorBox.textContent =
            "Password must be at least 8 characters.";

          errorBox.classList.remove(
            "hidden"
          );

          return;
        }

        if (
          confirmInput &&
          newPassword !==
            confirmPassword
        ) {
          errorBox.textContent =
            "Passwords do not match.";

          errorBox.classList.remove(
            "hidden"
          );

          return;
        }

        submitButton.disabled =
          true;

        try {
          const response =
            await fetch(
              "/api/auth/reset-password",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json",
                },

                credentials:
                  "same-origin",

                body:
                  JSON.stringify({
                    userId,
                    otp,
                    newPassword,
                  }),
              }
            );

          let data = null;

          try {
            data =
              await response.json();
          } catch (err) {
            data = null;
          }

          if (!response.ok) {
            throw new Error(
              (
                data &&
                (
                  data.error ||
                  data.message
                )
              ) ||
                "Password reset failed."
            );
          }

          closeModal();

          alert(
            (
              data &&
              data.message
            ) ||
              "Password reset successfully."
          );
        } catch (err) {

          errorBox.textContent =
            err.message ||
            "Password reset failed.";

          errorBox.classList.remove(
            "hidden"
          );

        } finally {
          submitButton.disabled =
            false;
        }
      };
  }

  // ============================================================
  // LOCAL HTML ESCAPER
  // ============================================================
  //
  // auth.js can load before api.js, so use a local helper
  // for modal titles.

  function escapeHtmlLocal(
    value
  ) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&":
            "&amp;",
          "<":
            "&lt;",
          ">":
            "&gt;",
          '"':
            "&quot;",
          "'":
            "&#39;",
        }[
          character
        ] || character)
    );
  }

})();