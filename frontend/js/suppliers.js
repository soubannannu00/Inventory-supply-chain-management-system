// Suppliers page: live supplier list with purchase order totals from MySQL (inventory_db).
// Small helpers are copied from inventory.js / dashboard.js so this page works on its own.

// Backend API base URL (Express server in /backend)
const API_BASE = "http://localhost:3000";

let allSuppliers = [];
let suppliersLoaded = false;

async function fetchJSON(path) {
  const response = await fetch(API_BASE + path);
  if (!response.ok) {
    throw new Error("Request failed: " + path + " (" + response.status + ")");
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return value.toLocaleString("en-IN");
}

function formatMoney(value) {
  return "₹" + formatNumber(value);
}

function renderToday() {
  const node = document.getElementById("today-label");
  const now = new Date();
  node.dateTime = now.toISOString().slice(0, 10);
  node.textContent = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ---------- Suppliers table ----------

function setTableMessage(message) {
  const body = document.getElementById("suppliers-table");
  body.innerHTML = `<tr><td class="empty-row" colspan="9">${escapeHtml(message)}</td></tr>`;
}

function renderSummary() {
  const summary = document.getElementById("suppliers-summary");
  const chip = document.getElementById("suppliers-open-chip");
  const openOrders = allSuppliers.reduce((sum, s) => sum + (Number(s.open_orders) || 0), 0);

  if (summary) {
    summary.textContent =
      allSuppliers.length + (allSuppliers.length === 1 ? " supplier" : " suppliers") + " · live from inventory_db";
  }
  if (chip) {
    chip.textContent = openOrders + (openOrders === 1 ? " open order" : " open orders");
  }
}

function supplierLocation(s) {
  return [s.city, s.state].filter(Boolean).join(", ") || "—";
}

function renderSuppliers(query) {
  if (!suppliersLoaded) return;

  const body = document.getElementById("suppliers-table");
  const q = (query || "").trim().toLowerCase();

  if (!allSuppliers.length) {
    setTableMessage("No suppliers found.");
    return;
  }

  const rows = allSuppliers.filter((s) =>
    `${s.supplier_name || ""} ${s.contact_person || ""} ${s.email || ""} ${s.city || ""}`.toLowerCase().includes(q)
  );

  if (!rows.length) {
    setTableMessage("No matching suppliers.");
    return;
  }

  body.innerHTML = rows
    .map(
      (s) => `
        <tr>
          <td>${escapeHtml(s.supplier_name)}</td>
          <td>${escapeHtml(s.contact_person || "—")}</td>
          <td>${escapeHtml(s.email || "—")}</td>
          <td>${escapeHtml(s.phone || "—")}</td>
          <td>${escapeHtml(supplierLocation(s))}</td>
          <td>${escapeHtml(formatNumber(Number(s.total_orders) || 0))}</td>
          <td>${escapeHtml(formatNumber(Number(s.open_orders) || 0))}</td>
          <td>${escapeHtml(formatMoney(Number(s.total_purchased) || 0))}</td>
          <td>${escapeHtml(s.last_order_date || "—")}</td>
        </tr>
      `
    )
    .join("");
}

function currentQuery() {
  const input = document.getElementById("supplier-search");
  return input ? input.value : "";
}

async function loadSuppliersPage() {
  setTableMessage("Loading suppliers…");

  try {
    const rows = await fetchJSON("/api/suppliers");
    allSuppliers = Array.isArray(rows) ? rows : [];
    suppliersLoaded = true;
    renderSummary();
    renderSuppliers(currentQuery());
  } catch (error) {
    console.error("Error loading suppliers:", error);
    suppliersLoaded = false;
    setTableMessage("Could not load suppliers. Is the backend running?");
    const summary = document.getElementById("suppliers-summary");
    if (summary) summary.textContent = "Suppliers unavailable";
  }
}

function setupSearch() {
  const input = document.getElementById("supplier-search");
  if (!input) return;
  input.addEventListener("input", () => {
    renderSuppliers(input.value);
  });
}

function setupSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const toggle = document.getElementById("menu-toggle");
  const banner = document.getElementById("page-banner");
  const links = document.querySelectorAll(".nav-link");

  function closeMenu() {
    sidebar.classList.remove("is-open");
    overlay.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
  }

  function openMenu() {
    sidebar.classList.add("is-open");
    overlay.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation menu");
  }

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("is-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  overlay.addEventListener("click", closeMenu);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      closeMenu();
    }
  });

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const page = link.dataset.page;

      // Live pages navigate normally; others are not built yet.
      if (!["Dashboard", "Products", "Inventory", "Suppliers", "Purchases"].includes(page)) {
        event.preventDefault();
        banner.removeAttribute("hidden");
        banner.textContent =
          "The " + page + " page is not built yet. Dashboard, Products, Inventory, Suppliers and Purchases show live data from inventory_db.";
      }

      closeMenu();
    });
  });
}

// Header warehouse label: "All warehouses (N)" or the single warehouse name.
// Keeps the existing text if the request fails or returns nothing.
async function loadWarehouseLabel() {
  const label = document.getElementById("warehouse-label");
  if (!label) return;

  try {
    const warehouses = await fetchJSON("/api/dashboard/warehouses");
    if (!Array.isArray(warehouses) || !warehouses.length) return;

    if (warehouses.length === 1) {
      const w = warehouses[0];
      label.textContent = w.warehouse_name + (w.city ? ", " + w.city : "");
    } else {
      label.textContent = "All warehouses (" + warehouses.length + ")";
    }
  } catch (error) {
    console.warn("Warehouses unavailable:", error);
  }
}

// ---------- Live database connection indicator (sidebar footer) ----------

const DB_STATUS_POLL_MS = 30000;
const DB_STATUS_TEXT = {
  "connected": "Live data · inventory_db",
  "db-offline": "Database offline · check MySQL",
  "server-offline": "Server offline · start backend",
};

let dbStatusState = null;
let dbStatusChecking = false;

function renderDbStatus(state, detail) {
  const wrap = document.getElementById("db-status");
  const text = document.getElementById("db-status-text");
  const dot = wrap ? wrap.querySelector(".db-dot") : null;
  if (!wrap || !text) return;

  text.textContent = DB_STATUS_TEXT[state];

  if (dot) {
    dot.classList.remove("is-connected", "is-db-offline", "is-server-offline");
    dot.classList.add("is-" + state);
  }

  const checked = new Date().toLocaleTimeString("en-IN");
  wrap.title = "Last checked: " + checked + (detail ? " · " + detail : "");
}

async function checkDbStatus() {
  if (dbStatusChecking) return;
  dbStatusChecking = true;

  let state;
  let detail = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(API_BASE + "/api/dashboard/db-status", {
      cache: "no-store",
      signal: controller.signal,
    });
    let body = {};
    try {
      body = await response.json();
    } catch (parseError) {
      body = {};
    }

    if (response.ok && body.database === "connected") {
      state = "connected";
      detail = body.db ? "database " + body.db : "";
    } else if (response.status === 503 || body.database === "disconnected") {
      state = "db-offline";
      detail = body.error || "HTTP " + response.status;
    } else {
      state = "server-offline";
      detail = "HTTP " + response.status;
    }
  } catch (error) {
    state = "server-offline";
    detail = error.name === "AbortError" ? "request timed out" : "backend not reachable";
  } finally {
    clearTimeout(timer);
    dbStatusChecking = false;
  }

  renderDbStatus(state, detail);

  // Only log when the state changes, to avoid console spam while polling.
  if (state !== dbStatusState) {
    if (state !== "connected") {
      console.warn("Dashboard connection status:", DB_STATUS_TEXT[state], detail ? "(" + detail + ")" : "");
    } else if (dbStatusState !== null) {
      console.info("Dashboard connection restored:", DB_STATUS_TEXT[state]);
    }
    dbStatusState = state;
  }
}

function setupDbStatus() {
  checkDbStatus();
  setInterval(checkDbStatus, DB_STATUS_POLL_MS);
  window.addEventListener("focus", checkDbStatus);
}

renderToday();
setupSearch();
setupSidebar();
loadSuppliersPage();
loadWarehouseLabel();
setupDbStatus();
