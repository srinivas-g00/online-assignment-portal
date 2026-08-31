// frontend/js/api.js
// Shared API wrapper + UI helpers
// Works on localhost and Render.
//
// IMPORTANT:
// This file uses the SAME ORIGIN as the current website.
// Therefore:
// Local  -> http://localhost:5000
// Online -> https://online-assignment-portal-wa8o.onrender.com
//
// Do NOT hard-code localhost or the Render URL here.

(function () {
  "use strict";

  // ============================================================
  // API BASE
  // ============================================================

  const API_BASE = window.location.origin;

  // ============================================================
  // GET TOKEN
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
    if (!token) {
      console.warn("setSession called without token.");
      return;
    }

    const safeUser = user || {};

    // Main session keys
    localStorage.setItem(
      "oa_token",
      token
    );

    localStorage.setItem(
      "oa_user",
      JSON.stringify(safeUser)
    );

    // Backward-compatible keys
    localStorage.setItem(
      "aop_token",
      token
    );

    localStorage.setItem(
      "aop_user",
      JSON.stringify(safeUser)
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

      if (!raw) {
        return null;
      }

      return JSON.parse(raw);
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

  function normalizePath(value) {
    if (!value) {
      return "/";
    }

    const path =
      String(value).trim();

    // Keep absolute URLs unchanged
    if (
      path.startsWith("http://") ||
      path.startsWith("https://")
    ) {
      return path;
    }

    // Make relative API path start with /
    return path.startsWith("/")
      ? path
      : "/" + path;
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
      normalizePath(path);

    const url =
      requestPath.startsWith("http://") ||
      requestPath.startsWith("https://")
        ? requestPath
        : API_BASE + requestPath;

    const headers = {};

    // ----------------------------------------------------------
    // AUTHORIZATION HEADER
    // ----------------------------------------------------------

    const token = getToken();

    if (auth && token) {
      headers.Authorization =
        "Bearer " + token;
    }

    // ----------------------------------------------------------
    // JSON HEADER
    // ----------------------------------------------------------
    // Do NOT manually set Content-Type for FormData.
    // The browser adds the multipart boundary automatically.

    if (
      !isForm &&
      body !== undefined &&
      body !== null
    ) {
      headers["Content-Type"] =
        "application/json";
    }

    let response;

    // ==========================================================
    // FETCH
    // ==========================================================

    try {
      response = await fetch(
        url,
        {
          method,
          headers,

          body:
            isForm
              ? body
              : body !== undefined &&
                body !== null
              ? JSON.stringify(body)
              : undefined,

          // Same-origin cookies can be used later if required.
          credentials: "same-origin",
        }
      );
    } catch (err) {
      console.error(
        "API NETWORK ERROR:",
        err
      );

      throw new Error(
        "Unable to connect to the server. Please check your internet connection."
      );
    }

    // ==========================================================
    // RESPONSE
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
        data =
          await response.json();
      } else {
        const text =
          await response.text();

        data =
          text
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

    // ==========================================================
    // ERROR HANDLING
    // ==========================================================

    if (!response.ok) {
      // --------------------------------------------------------
      // Unauthorized
      // --------------------------------------------------------

      if (
        response.status === 401
      ) {
        clearSession();

        const currentPath =
          window.location.pathname
            .toLowerCase();

        const isLoginPage =
          currentPath === "/" ||
          currentPath.endsWith(
            "/index.html"
          );

        if (!isLoginPage) {
          window.location.href =
            "/index.html";
        }
      }

      // --------------------------------------------------------
      // Get server error message
      // --------------------------------------------------------

      const serverMessage =
        data &&
        typeof data === "object"
          ? (
              data.error ||
              data.message
            )
          : null;

      throw new Error(
        serverMessage ||
          `Request failed (${response.status})`
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

        <div class="notice ${escapeHtml(
          kind
        )}">

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
      closeButton.onclick =
        function () {
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
      function (character) {
        return (
          {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[character] ||
          character
        );
      }
    );
  }

  // ============================================================
  // FORMAT DATE / TIME
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
    const user =
      getUser();

    const token =
      getToken();

    // ----------------------------------------------------------
    // No token
    // ----------------------------------------------------------

    if (!token) {
      window.location.href =
        "/index.html";

      return null;
    }

    // ----------------------------------------------------------
    // No user
    // ----------------------------------------------------------

    if (!user) {
      clearSession();

      window.location.href =
        "/index.html";

      return null;
    }

    // ----------------------------------------------------------
    // Wrong role
    // ----------------------------------------------------------

    if (
      expectedRole &&
      user.role !== expectedRole
    ) {
      clearSession();

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
  // EXPORT FUNCTIONS GLOBALLY
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