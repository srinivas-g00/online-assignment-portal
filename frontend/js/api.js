// frontend/js/api.js
// Shared fetch wrapper + UI helpers reused across all views

const API_BASE = ""; // same-origin

function getToken() {
  return localStorage.getItem("oa_token") || sessionStorage.getItem("oa_token") || localStorage.getItem("aop_token");
}

function setSession(token, user) {
  localStorage.setItem("oa_token", token);
  localStorage.setItem("oa_user", JSON.stringify(user));
  // Keep backward compatibility
  localStorage.setItem("aop_token", token);
  localStorage.setItem("aop_user", JSON.stringify(user));
}

function getUser() {
  try {
    const raw = localStorage.getItem("oa_user") || sessionStorage.getItem("oa_user") || localStorage.getItem("aop_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
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
}

async function api(path, { method = "GET", body, isForm = false, auth = true } = {}) {
  const headers = {};
  const token = getToken();

  if (auth && token) {
    headers.Authorization = "Bearer " + token;
  }
  if (!isForm && body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
      if (!window.location.pathname.endsWith("index.html") && window.location.pathname !== "/") {
        window.location.href = "index.html";
      }
    }
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }

  return data;
}

// ---------- Notice popup ----------
function notice(title, message, kind = "ok") {
  const root = document.getElementById("noticeRoot") || document.body;
  root.innerHTML = `<div class="notice-bg"><div class="notice ${kind}">
    <div class="icon">${kind === "err" ? "!" : "✓"}</div>
    <h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>
    <button class="btn" id="noticeClose">OK</button>
  </div></div>`;
  const closeBtn = document.getElementById("noticeClose");
  if (closeBtn) {
    closeBtn.onclick = () => (root.innerHTML = "");
  }
}

// ---------- Generic modal ----------
function openModal(title, bodyHtml) {
  const root = document.getElementById("modalRoot") || document.body;
  root.innerHTML = `<div class="modal-bg"><div class="modal"><h3>${escapeHtml(title)}</h3>${bodyHtml}
    <div style="margin-top:14px;text-align:right"><button class="btn secondary" id="modalClose">Close</button></div>
  </div></div>`;
  const closeBtn = document.getElementById("modalClose");
  if (closeBtn) {
    closeBtn.onclick = () => (root.innerHTML = "");
  }
}

function closeModal() {
  const root = document.getElementById("modalRoot") || document.body;
  if (root) root.innerHTML = "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(
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

function fmtDateTime(iso) {
  if (!iso) return "—";
  const formatted = String(iso).replace(" ", "T");
  const dt = new Date(formatted);
  return isNaN(dt.getTime()) ? String(iso) : dt.toLocaleString();
}

function requireLogin(expectedRole) {
  const user = getUser();
  const token = getToken();
  if (!token || !user || (expectedRole && user.role !== expectedRole)) {
    window.location.href = "index.html";
    return null;
  }
  return user;
}

function logout() {
  clearSession();
  window.location.href = "index.html";
}