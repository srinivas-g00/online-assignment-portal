// frontend/js/auth.js
(function () {
  let role = "student";
  let loginCaptchaId = null;
  let regCaptchaId = null;

  const $ = (id) => document.getElementById(id);

  // Safe session helper fallbacks in case api.js hasn't loaded yet
  function getSafeUser() {
    try {
      if (typeof getUser === "function") return getUser();
      const raw = localStorage.getItem("oa_user") || sessionStorage.getItem("oa_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getSafeToken() {
    try {
      if (typeof getToken === "function") return getToken();
      return localStorage.getItem("oa_token") || sessionStorage.getItem("oa_token") || null;
    } catch {
      return null;
    }
  }

  function saveSession(token, user) {
    if (typeof setSession === "function") {
      setSession(token, user);
    } else {
      localStorage.setItem("oa_token", token);
      localStorage.setItem("oa_user", JSON.stringify(user));
    }
  }

  // Auto-redirect if already authenticated
  try {
    const u = getSafeUser();
    const token = getSafeToken();
    if (token && u && u.role) {
      window.location.href = u.role === "faculty" ? "faculty.html" : "student.html";
      return;
    }
  } catch (e) {
    console.warn("Session check skipped:", e);
  }

  // Role toggle
  if ($("roleStudent")) $("roleStudent").onclick = () => setRole("student");
  if ($("roleFaculty")) $("roleFaculty").onclick = () => setRole("faculty");

  function setRole(r) {
    role = r;
    if ($("roleStudent")) $("roleStudent").classList.toggle("active", r === "student");
    if ($("roleFaculty")) $("roleFaculty").classList.toggle("active", r === "faculty");
    if ($("studentFields")) $("studentFields").classList.toggle("hidden", r !== "student");
    if ($("facultyFields")) $("facultyFields").classList.toggle("hidden", r !== "faculty");
  }

  // Mode toggle (Login vs Register)
  if ($("modeLogin")) $("modeLogin").onclick = () => setMode("login");
  if ($("modeRegister")) $("modeRegister").onclick = () => setMode("register");

  function setMode(m) {
    if ($("modeLogin")) $("modeLogin").classList.toggle("active", m === "login");
    if ($("modeRegister")) $("modeRegister").classList.toggle("active", m === "register");
    if ($("loginForm")) $("loginForm").classList.toggle("hidden", m !== "login");
    if ($("registerForm")) $("registerForm").classList.toggle("hidden", m !== "register");
    if ($("loginError")) $("loginError").classList.add("hidden");
    if ($("regError")) $("regError").classList.add("hidden");
  }

  // Password visibility toggle
  document.querySelectorAll(".eye").forEach((btn) => {
    btn.onclick = () => {
      const input = $(btn.dataset.toggle);
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
      }
    };
  });

  // Direct fetch for captcha to avoid external wrapper failure
  async function fetchCaptchaDirect() {
    const res = await fetch("/api/auth/captcha", {
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // Load captcha text into DOM
  async function loadCaptcha(target) {
    const el = target === "login" ? $("loginCapText") : $("regCapText");
    const input = target === "login" ? $("loginCapAnswer") : $("regCapAnswer");

    if (el) el.textContent = "•••";

    try {
      const data = await fetchCaptchaDirect();
      const code = data.captchaText || data.text || "9A8B7";
      const id = data.captchaId || data.id || "c1";

      if (target === "login") {
        loginCaptchaId = id;
      } else {
        regCaptchaId = id;
      }

      if (el) el.textContent = code;
      if (input) input.value = "";
    } catch (err) {
      console.error("Failed to load captcha:", err);
      if (el) el.textContent = "REFRESH";
    }
  }

  // Initial captcha fetch
  loadCaptcha("login");
  loadCaptcha("register");

  if ($("loginCapRefresh")) $("loginCapRefresh").onclick = () => loadCaptcha("login");
  if ($("regCapRefresh")) $("regCapRefresh").onclick = () => loadCaptcha("register");

  // DIRECT LOGIN
  if ($("loginForm")) {
    $("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const errBox = $("loginError");
      if (errBox) errBox.classList.add("hidden");

      const submitBtn = $("loginForm").querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            usernameOrEmail: $("loginId").value.trim(),
            password: $("loginPassword").value,
            captchaId: loginCaptchaId,
            captchaAnswer: $("loginCapAnswer").value.trim(),
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed.");

        if (data.needsVerification) {
          openOtpModal(data.userId, "register", async (userId, emailOtp) => {
            const vRes = await fetch("/api/auth/verify-registration", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, emailOtp }),
            });
            const vData = await vRes.json();
            if (!vRes.ok) throw new Error(vData.error || "Verification failed.");
            closeModal();
            alert("Account verified. You can now log in.");
          });
          return;
        }

        saveSession(data.token, data.user);
        window.location.href = data.user.role === "faculty" ? "faculty.html" : "student.html";
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || "Invalid credentials.";
          errBox.classList.remove("hidden");
        }
        loadCaptcha("login");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  // REGISTER
  if ($("registerForm")) {
    $("registerForm").onsubmit = async (e) => {
      e.preventDefault();
      const errBox = $("regError");
      if (errBox) errBox.classList.add("hidden");

      const password = $("regPassword").value;
      const confirmPassword = $("regConfirmPassword") ? $("regConfirmPassword").value : "";

      if (password.length < 8) {
        if (errBox) {
          errBox.textContent = "Password must be at least 8 characters.";
          errBox.classList.remove("hidden");
        }
        return;
      }

      if (password !== confirmPassword) {
        if (errBox) {
          errBox.textContent = "Passwords do not match. Please re-enter.";
          errBox.classList.remove("hidden");
        }
        return;
      }

      const submitBtn = $("registerForm").querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const payload = {
          role,
          name: $("regName").value.trim(),
          username: $("regUsername").value.trim(),
          email: $("regEmail").value.trim(),
          password,
          confirmPassword,
          captchaId: regCaptchaId,
          captchaAnswer: $("regCapAnswer").value.trim(),
        };

        if (role === "student") {
          payload.branch = $("regBranch") ? $("regBranch").value.trim() : "";
          payload.year = $("regYear") ? $("regYear").value.trim() : "";
        } else {
          payload.subject = $("regSubject") ? $("regSubject").value.trim() : "";
          payload.slot = $("regSlot") ? $("regSlot").value.trim() : "";
        }

        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Registration failed.");

        openOtpModal(data.userId, "register", async (userId, emailOtp) => {
          const vRes = await fetch("/api/auth/verify-registration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, emailOtp }),
          });
          const vData = await vRes.json();
          if (!vRes.ok) throw new Error(vData.error || "Verification failed.");
          closeModal();
          alert("Registration complete! You can now log in.");
          setMode("login");
          if ($("loginId")) $("loginId").value = payload.username;
        });
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || "Registration failed.";
          errBox.classList.remove("hidden");
        }
        loadCaptcha("register");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  // Modal Helpers
  function openModal(title, html) {
    const root = $("modalRoot");
    if (!root) return;
    root.innerHTML = `
      <div class="modal-bg">
        <div class="modal">
          <h3>${title}</h3>
          ${html}
          <div style="text-align: right; margin-top: 10px;">
            <button class="btn secondary" id="modalCloseBtn" type="button">Cancel</button>
          </div>
        </div>
      </div>
    `;
    const closeBtn = document.getElementById("modalCloseBtn");
    if (closeBtn) closeBtn.onclick = closeModal;
  }

  function closeModal() {
    const root = $("modalRoot");
    if (root) root.innerHTML = "";
  }

  function openOtpModal(userId, purpose, onVerify) {
    openModal(
      "Verify Email OTP",
      `
      <p class="note">Enter the 6-digit code sent to your email inbox. Valid for 10 minutes.</p>
      <div class="field" style="margin-top: 10px;">
        <label>Email OTP Code</label>
        <input id="otpEmail" maxlength="6" placeholder="e.g. 123456" autocomplete="off">
      </div>
      <div class="error-inline hidden" id="otpError"></div>
      <div class="row-buttons" style="margin-top: 15px;">
        <button class="btn" id="otpVerifyBtn" type="button">Verify</button>
        <button class="btn secondary" id="otpResendBtn" type="button">Resend Code</button>
      </div>
    `
    );

    document.getElementById("otpVerifyBtn").onclick = async () => {
      const emailOtp = document.getElementById("otpEmail").value.trim();
      const errBox = document.getElementById("otpError");
      errBox.classList.add("hidden");

      if (!emailOtp) {
        errBox.textContent = "Please enter the OTP code.";
        errBox.classList.remove("hidden");
        return;
      }

      try {
        await onVerify(userId, emailOtp);
      } catch (err) {
        errBox.textContent = err.message || "Invalid OTP.";
        errBox.classList.remove("hidden");
      }
    };

    document.getElementById("otpResendBtn").onclick = async () => {
      try {
        await fetch("/api/auth/resend-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, purpose }),
        });
        alert("A new OTP code has been sent to your email.");
      } catch (err) {
        alert(err.message || "Failed to resend code.");
      }
    };
  }

  // Forgot password
  if ($("forgotPasswordLink")) {
    $("forgotPasswordLink").onclick = (e) => {
      e.preventDefault();
      openModal(
        "Forgot Password",
        `
        <p class="note">Enter your registered email address to receive a password reset code.</p>
        <div class="field" style="margin-top:10px;">
          <label>Registered Email</label>
          <input id="fpEmail" type="email" placeholder="name@example.com">
        </div>
        <div class="error-inline hidden" id="fpError"></div>
        <div class="row-buttons" style="margin-top:15px;">
          <button class="btn" id="fpSendBtn" type="button">Send OTP</button>
        </div>
      `
      );

      document.getElementById("fpSendBtn").onclick = async () => {
        const email = document.getElementById("fpEmail").value.trim();
        const errBox = document.getElementById("fpError");
        errBox.classList.add("hidden");

        if (!email) {
          errBox.textContent = "Please enter your email.";
          errBox.classList.remove("hidden");
          return;
        }

        try {
          const res = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Request failed.");
          closeModal();
          openResetPasswordModal(data.userId);
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove("hidden");
        }
      };
    };
  }

  function openResetPasswordModal(userId) {
    openModal(
      "Reset Password",
      `
      <p class="note">Enter the 6-digit OTP code sent to your email and your new password.</p>
      <div class="field" style="margin-top:10px;">
        <label>Email OTP Code</label>
        <input id="rpOtp" maxlength="6" placeholder="e.g. 123456">
      </div>
      <div class="field" style="margin-top:10px;">
        <label>New Password (min 8 chars)</label>
        <input id="rpPassword" type="password" placeholder="Enter new password">
      </div>
      <div class="error-inline hidden" id="rpError"></div>
      <div class="row-buttons" style="margin-top:15px;">
        <button class="btn" id="rpSubmitBtn" type="button">Update Password</button>
      </div>
    `
    );

    document.getElementById("rpSubmitBtn").onclick = async () => {
      const otp = document.getElementById("rpOtp").value.trim();
      const newPassword = document.getElementById("rpPassword").value;
      const errBox = document.getElementById("rpError");
      errBox.classList.add("hidden");

      if (!otp || !newPassword) {
        errBox.textContent = "Please fill in all fields.";
        errBox.classList.remove("hidden");
        return;
      }

      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, otp, newPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Reset failed.");
        closeModal();
        alert(data.message || "Password reset successfully.");
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
      }
    };
  }
})();