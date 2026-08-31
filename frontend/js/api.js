// frontend/js/api.js
(function () {
  "use strict";

  // ============================================================
  // API BASE
  // ============================================================
  // Same origin:
  // Local  -> http://localhost:5000
  // Render -> https://online-assignment-portal-wa8o.onrender.com
  //
  // DO NOT put localhost here.
  const API_BASE = window.location.origin;

  // ============================================================
  // TOKEN
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

  // ============================================================
  // SAVE SESSION
  // ============================================================

  function setSession(token, user) {
    if (!token) return;

    localStorage.setItem("oa_token", token);
    localStorage.setItem(
      "oa_user",
      JSON.stringify(user || {})
    );

    localStorage.setItem("aop_token", token);
    localStorage.setItem(
      "aop_user",
      JSON.stringify(user || {})
    );
  }

  // ============================================================
  // GET USER
  // ============================================================

  function getUser() {
    try {
      const raw =
        localStorage.getItem("oa_user") ||
        sessionStorage.getItem("oa_user") ||
        localStorage.getItem("aop_user") ||
        sessionStorage.getItem("aop_user");

      return raw
        ? JSON.parse(raw)
        : null;
    } catch (err) {
      console.error(
        "GET USER ERROR:",
        err.message
      );
      return null;
    }
  }

  // ============================================================
  // CLEAR SESSION
  // ============================================================

  function clearSession() {
    localStorage.removeItem("oa_token");
    localStorage.removeItem("oa_user");
    localStorage.removeItem("aop_token");
    localStorage.removeItem("aop_user");

    sessionStorage.removeItem("oa_token");
    sessionStorage.removeItem("oa_user");
    sessionStorage.removeItem("aop_token");
    sessionStorage.removeItem("aop_user");
  }

  // ============================================================
  // NORMALIZE PATH
  // ============================================================

  function normalizePath(apiPath) {
    if (!apiPath) {
      return "/";
    }

    const value =
      String(apiPath).trim();

    // Already a full URL
    if (
      value.startsWith("http://") ||
      value.startsWith("https://")
    ) {
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
    apiPath,
    {
      method = "GET",
      body,
      isForm = false,
      auth = true,
    } = {}
  ) {
    const requestPath =
      normalizePath(apiPath);

    const url =
      requestPath.startsWith("http://") ||
      requestPath.startsWith("https://")
        ? requestPath
        : API_BASE + requestPath;

    const headers = {};

    // ----------------------------------------------------------
    // Authorization
    // ----------------------------------------------------------

    const token = getToken();

    if (auth && token) {
      headers.Authorization =
        "Bearer " + token;
    }

    // ----------------------------------------------------------
    // JSON
    // ----------------------------------------------------------

    if (
      !isForm &&
      body !== undefined &&
      body !== null
    ) {
      headers["Content-Type"] =
        "application/json";
    }

    let response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: isForm
          ? body
          : body !== undefined &&
            body !== null
          ? JSON.stringify(body)
          : undefined,

        credentials: "same-origin",
      });
    } catch (err) {
      console.error(
        "NETWORK ERROR:",
        err
      );

      throw new Error(
        "Unable to connect to the server."
      );
    }

    // ----------------------------------------------------------
    // Parse response
    // ----------------------------------------------------------

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
        data =
          await response.json();
      } else {
        const text =
          await response.text();

        data = text
          ? {
              message: text,
            }
          : null;
      }
    } catch (err) {
      console.warn(
        "RESPONSE PARSE ERROR:",
        err.message
      );
    }

    // ----------------------------------------------------------
    // Handle errors
    // ----------------------------------------------------------

    if (!response.ok) {
      if (
        response.status === 401
      ) {
        clearSession();

        const path =
          window.location.pathname;

        const onLoginPage =
          path === "/" ||
          path.endsWith(
            "/index.html"
          );

        if (!onLoginPage) {
          window.location.href =
            "/index.html";
        }
      }

      throw new Error(
        (data && data.error) ||
          (data && data.message) ||
          `Request failed (${response.status})`
      );
    }

    return data;
  }

  // ============================================================
  // NOTICE
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

    const closeButton =
      document.getElementById(
        "noticeClose"
      );

    if (closeButton) {
      closeButton.onclick = () => {
        root.innerHTML = "";
      };
    }
  }

  // ============================================================
  // MODAL
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

    const closeButton =
      document.getElementById(
        "modalClose"
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
      document.getElementById(
        "modalRoot"
      );

    if (root) {
      root.innerHTML = "";
    }
  }

  // ============================================================
  // ESCAPE HTML
  // ============================================================

  function escapeHtml(value) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }

  // ============================================================
  // DATE/TIME
  // ============================================================

  function fmtDateTime(value) {
    if (!value) {
      return "—";
    }

    const normalized =
      String(value).replace(
        " ",
        "T"
      );

    const date =
      new Date(normalized);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(value);
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

    if (
      !token ||
      !user ||
      (
        expectedRole &&
        user.role !== expectedRole
      )
    ) {
      window.location.href =
        "/index.html";

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
      "/index.html";
  }

  // ============================================================
  // EXPORT GLOBAL FUNCTIONS
  // ============================================================

  window.API_BASE =
    API_BASE;

  window.getToken =
    getToken;

  window.setSession =
    setSession;

  window.getUser =
    getUser;

  window.clearSession =
    clearSession;

  window.api =
    api;

  window.notice =
    notice;

  window.openModal =
    openModal;

  window.closeModal =
    closeModal;

  window.escapeHtml =
    escapeHtml;

  window.fmtDateTime =
    fmtDateTime;

  window.requireLogin =
    requireLogin;

  window.logout =
    logout;

})();