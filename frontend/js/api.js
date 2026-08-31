// frontend/js/api.js
// Shared API wrapper + UI helpers
// Works on localhost and on the deployed Render website.

(function () {
  "use strict";

  // ============================================================
  // API BASE
  // ============================================================
  //
  // Empty string means:
  //
  // Local:
  //   http://localhost:5000/api/...
  //
  // Render:
  //   https://online-assignment-portal-wa8o.onrender.com/api/...
  //
  // The browser automatically uses the current website origin.
  //
  const API_BASE = "";

  // ============================================================
  // SESSION STORAGE
  // ============================================================

  function getToken() {
    return (
      localStorage.getItem("oa_token") ||
      sessionStorage.getItem("oa_token") ||
      localStorage.getItem("aop_token") ||
      sessionStorage.getItem("aop_token") ||
      ""
    );
  }

  function setSession(token, user) {
    if (!token) return;

    localStorage.setItem("oa_token", token);
    localStorage.setItem(
      "oa_user",
      JSON.stringify(user || {})
    );

    // Backward compatibility
    localStorage.setItem("aop_token", token);
    localStorage.setItem(
      "aop_user",
      JSON.stringify(user || {})
    );
  }

  function getUser() {
    try {
      const raw =
        localStorage.getItem("oa_user") ||
        sessionStorage.getItem("oa_user") ||
        localStorage.getItem("aop_user") ||
        sessionStorage.getItem("aop_user");

      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn(
        "Could not read stored user:",
        err.message
      );

      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem("oa_token");
    localStorage.removeItem("oa_user");

    sessionStorage.removeItem("oa_token");
    sessionStorage.removeItem("oa_user");

    localStorage.removeItem("aop_token");
    localStorage.removeItem("aop_user");

    sessionStorage.removeItem("aop_token");
    sessionStorage.removeItem("aop_user");
  }

  // ============================================================
  // NORMALIZE API PATH
  // ============================================================

  function normalizeApiPath(path) {
    if (!path) return "/";

    const value = String(path).trim();

    if (value.startsWith("http://")) {
      return value;
    }

    if (value.startsWith("https://")) {
      return value;
    }

    return value.startsWith("/")
      ? value
      : "/" + value;
  }

  // ============================================================
  // API REQUEST
  // ============================================================

  async function api(
    path,
    {
      method = "GET",
      body,
      isForm = false,
      auth = true,
    } = {}
  ) {
    const requestPath =
      normalizeApiPath(path);

    const headers = {};

    // ----------------------------------------------------------
    // AUTHORIZATION
    // ----------------------------------------------------------

    const token = getToken();

    if (auth && token) {
      headers.Authorization =
        "Bearer " + token;
    }

    // ----------------------------------------------------------
    // JSON CONTENT TYPE
    // ----------------------------------------------------------

    if (!isForm && body !== undefined) {
      headers["Content-Type"] =
        "application/json";
    }

    // ----------------------------------------------------------
    // REQUEST URL
    // ----------------------------------------------------------

    const url =
      requestPath.startsWith("http://") ||
      requestPath.startsWith("https://")
        ? requestPath
        : API_BASE + requestPath;

    let response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: isForm
          ? body
          : body !== undefined
          ? JSON.stringify(body)
          : undefined,

        // Credentials are useful if cookies are
        // introduced later. They are harmless for
        // the current Bearer-token authentication.
        credentials: "same-origin",
      });
    } catch (networkError) {
      console.error(
        "API NETWORK ERROR:",
        networkError
      );

      throw new Error(
        "Cannot connect to the server. Please check your internet connection or try again."
      );
    }

    // ==========================================================
    // READ RESPONSE
    // ==========================================================

    let data = null;

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    try {
      if (
        contentType.includes(
          "application/json"
        )
      ) {
        data = await response.json();
      } else {
        const text =
          await response.text();

        data = text
          ? { message: text }
          : null;
      }
    } catch (parseError) {
      console.warn(
        "API response parsing error:",
        parseError.message
      );
    }

    // ==========================================================
    // HANDLE ERRORS
    // ==========================================================

    if (!response.ok) {
      // --------------------------------------------------------
      // Unauthorized
      // --------------------------------------------------------

      if (response.status === 401) {
        clearSession();

        const currentPath =
          window.location.pathname;

        const isLoginPage =
          currentPath.endsWith(
            "index.html"
          ) ||
          currentPath === "/" ||
          currentPath.endsWith("/");

        if (!isLoginPage) {
          window.location.href =
            "index.html";
        }
      }

      const errorMessage =
        data && data.error
          ? data.error
          : data && data.message
          ? data.message
          : `Request failed (${response.status})`;

      throw new Error(
        errorMessage
      );
    }

    return data;
  }

  // ============================================================
  // NOTICE POPUP
  // ============================================================

  function notice(
    title,
    message,
    kind = "ok"
  ) {
    const root =
      document.getElementById(
        "noticeRoot"
      ) || document.body;

    root.innerHTML = `
      <div class="notice-bg">
        <div class="notice ${kind}">
          <div class="icon">
            ${
              kind === "err"
                ? "!"
                : "✓"
            }
          </div>

          <h3>
            ${escapeHtml(title)}
          </h3>

          <p>
            ${escapeHtml(message)}
          </p>

          <button
            class="btn"
            id="noticeClose"
            type="button">
            OK
          </button>
        </div>
      </div>
    `;

    const closeBtn =
      document.getElementById(
        "noticeClose"
      );

    if (closeBtn) {
      closeBtn.onclick = () => {
        root.innerHTML = "";
      };
    }
  }

  // ============================================================
  // GENERIC MODAL
  // ============================================================

  function openModal(
    title,
    bodyHtml
  ) {
    const root =
      document.getElementById(
        "modalRoot"
      ) || document.body;

    root.innerHTML = `
      <div class="modal-bg">
        <div class="modal">

          <h3>
            ${escapeHtml(title)}
          </h3>

          ${bodyHtml}

          <div
            style="
              margin-top:14px;
              text-align:right;
            ">

            <button
              class="btn secondary"
              id="modalClose"
              type="button">
              Close
            </button>

          </div>

        </div>
      </div>
    `;

    const closeBtn =
      document.getElementById(
        "modalClose"
      );

    if (closeBtn) {
      closeBtn.onclick = () => {
        root.innerHTML = "";
      };
    }
  }

  // ============================================================
  // CLOSE MODAL
  // ============================================================

  function closeModal() {
    const root =
      document.getElementById(
        "modalRoot"
      ) || document.body;

    if (root) {
      root.innerHTML = "";
    }
  }

  // ============================================================
  // HTML ESCAPE
  // ============================================================

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[character])
    );
  }

  // ============================================================
  // FORMAT DATE/TIME
  // ============================================================

  function fmtDateTime(iso) {
    if (!iso) {
      return "—";
    }

    const formatted =
      String(iso).replace(
        " ",
        "T"
      );

    const date =
      new Date(formatted);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(iso);
    }

    return date.toLocaleString();
  }

  // ============================================================
  // REQUIRE LOGIN
  // ============================================================

  function requireLogin(
    expectedRole
  ) {
    const user = getUser();
    const token = getToken();

    const valid =
      Boolean(token) &&
      Boolean(user) &&
      (
        !expectedRole ||
        user.role === expectedRole
      );

    if (!valid) {
      window.location.href =
        "index.html";

      return null;
    }

    return user;
  }

  // ============================================================
  // LOGOUT
  // ============================================================

  function logout() {
    clearSession();

    window.location.href =
      "index.html";
  }

  // ============================================================
  // MAKE FUNCTIONS AVAILABLE
  // ============================================================

  window.API_BASE = API_BASE;

  window.getToken = getToken;
  window.setSession = setSession;
  window.getUser = getUser;
  window.clearSession = clearSession;

  window.api = api;

  window.notice = notice;

  window.openModal = openModal;
  window.closeModal = closeModal;

  window.escapeHtml = escapeHtml;
  window.fmtDateTime = fmtDateTime;

  window.requireLogin =
    requireLogin;

  window.logout = logout;
})();