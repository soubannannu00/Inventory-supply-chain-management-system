// Purchase Orders page: live purchase orders (and their items) from MySQL (inventory_db).
// Small helpers are copied from inventory.js / dashboard.js so this page works on its own.

// Backend API base URL (Express server in /backend)
const API_BASE = "http://localhost:3000";

let allOrders = [];
let ordersLoaded = false;
const expandedOrders = new Set();
const itemsCache = {};

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

// ---------- Purchase orders table ----------

const PO_COLS = 8;

// "2026-09-28" -> "28 Sep 2026" without Date parsing (no timezone shift).
function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return value ? String(value) : "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = months[Number(match[2]) - 1] || match[2];
  return Number(match[3]) + " " + monthName + " " + match[1];
}

function capitalize(text) {
  const value = String(text || "").trim();
  if (!value) return "Pending";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

// Same mapping as the dashboard.
function displayStatus(rawStatus) {
  const key = String(rawStatus || "").trim().toLowerCase();
  if (key === "received") return "Received";
  if (key === "ordered" || key === "approved") return "In Transit";
  if (key === "delivered") return "Paid";
  return capitalize(key);
}

function statusClass(status) {
  const key = String(status || "").toLowerCase().replace(" ", "-");
  if (key === "paid") return "status status-paid";
  if (key === "received") return "status status-received";
  if (key === "in-transit") return "status status-transit";
  return "status status-pending";
}

function isOpenOrder(order) {
  return ["pending", "approved", "ordered"].includes(String(order.status || "").toLowerCase());
}

function poNumber(order) {
  return "PO-" + order.purchase_order_id;
}

function setTableMessage(message) {
  const body = document.getElementById("po-table");
  body.innerHTML = `<tr><td class="empty-row" colspan="${PO_COLS}">${escapeHtml(message)}</td></tr>`;
}

function renderSummary() {
  const summary = document.getElementById("po-summary");
  const chip = document.getElementById("po-open-chip");
  const openCount = allOrders.filter(isOpenOrder).length;
  const total = allOrders
    .filter((o) => String(o.status || "").toLowerCase() !== "cancelled")
    .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

  if (summary) {
    summary.textContent =
      allOrders.length + (allOrders.length === 1 ? " order" : " orders") +
      " · " + formatMoney(total) + " · live from inventory_db";
  }
  if (chip) {
    chip.textContent = openCount + (openCount === 1 ? " open order" : " open orders");
  }
}

function itemsTableHtml(items) {
  if (!items.length) {
    return '<p class="empty-row">No items on this order.</p>';
  }
  return `
    <table>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col">SKU</th>
          <th scope="col">Quantity</th>
          <th scope="col">Unit Price</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map((item) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unit_price) || 0;
            const total = item.total_price !== null && item.total_price !== undefined
              ? Number(item.total_price) || 0
              : qty * price;
            return `
              <tr>
                <td>${escapeHtml(item.product_name)}</td>
                <td>${escapeHtml(item.sku)}</td>
                <td>${escapeHtml(formatNumber(qty))}</td>
                <td>${escapeHtml(formatMoney(price))}</td>
                <td>${escapeHtml(formatMoney(total))}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function detailRowHtml(id) {
  const state = itemsCache[id];
  let inner;
  if (!state || state.loading) {
    inner = '<p class="empty-row">Loading items…</p>';
  } else if (state.error) {
    inner = '<p class="empty-row">Could not load items for this order.</p>';
  } else {
    inner = itemsTableHtml(state.items);
  }
  return `<tr class="po-items-row" data-items-for="${escapeHtml(id)}"><td colspan="${PO_COLS}">${inner}</td></tr>`;
}

function renderOrders(query) {
  if (!ordersLoaded) return;

  const body = document.getElementById("po-table");
  const q = (query || "").trim().toLowerCase();

  if (!allOrders.length) {
    setTableMessage("No purchase orders yet.");
    return;
  }

  const rows = allOrders.filter((o) =>
    `${poNumber(o)} ${o.purchase_order_id} ${o.supplier_name || ""} ${o.warehouse_name || ""} ${o.status || ""} ${displayStatus(o.status)}`
      .toLowerCase()
      .includes(q)
  );

  if (!rows.length) {
    setTableMessage("No matching purchase orders.");
    return;
  }

  body.innerHTML = rows
    .map((o) => {
      const id = String(o.purchase_order_id);
      const open = expandedOrders.has(id);
      const status = displayStatus(o.status);
      const itemsCount = o.items_count === undefined || o.items_count === null ? "—" : formatNumber(Number(o.items_count) || 0);
      const row = `
        <tr data-po-id="${escapeHtml(id)}" tabindex="0" aria-expanded="${open}" title="Show items for ${escapeHtml(poNumber(o))}" style="cursor: pointer">
          <td>${escapeHtml(poNumber(o))}</td>
          <td>${escapeHtml(o.supplier_name || "—")}</td>
          <td>${escapeHtml(o.warehouse_name || "—")}</td>
          <td>${escapeHtml(formatDate(o.order_date))}</td>
          <td>${escapeHtml(formatDate(o.expected_date))}</td>
          <td>${escapeHtml(itemsCount)} <a href="#" class="chip" data-po-toggle="${escapeHtml(id)}">${open ? "Hide" : "View"}</a></td>
          <td>${escapeHtml(formatMoney(Number(o.total_amount) || 0))}</td>
          <td><span class="${statusClass(status)}">${escapeHtml(status)}</span></td>
        </tr>
      `;
      return open ? row + detailRowHtml(id) : row;
    })
    .join("");
}

async function toggleOrder(id) {
  if (expandedOrders.has(id)) {
    expandedOrders.delete(id);
    renderOrders(currentQuery());
    return;
  }

  expandedOrders.add(id);

  if (!itemsCache[id] || itemsCache[id].error) {
    itemsCache[id] = { loading: true };
    renderOrders(currentQuery());
    try {
      const result = await fetchJSON("/api/purchase-orders/" + encodeURIComponent(id));
      itemsCache[id] = { items: Array.isArray(result.items) ? result.items : [] };
    } catch (error) {
      console.error("Error loading purchase order items:", error);
      itemsCache[id] = { error: true };
    }
  }

  renderOrders(currentQuery());
}

function setupRowToggle() {
  const body = document.getElementById("po-table");
  if (!body) return;

  body.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-po-id]");
    if (!row) return;
    event.preventDefault();
    toggleOrder(row.dataset.poId);
  });

  body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-po-id]");
    if (!row) return;
    event.preventDefault();
    toggleOrder(row.dataset.poId);
  });
}

function currentQuery() {
  const input = document.getElementById("po-search");
  return input ? input.value : "";
}

async function loadOrdersPage() {
  setTableMessage("Loading purchase orders…");

  try {
    const result = await fetchJSON("/api/purchase-orders");
    allOrders = result && Array.isArray(result.data) ? result.data : [];
    ordersLoaded = true;
    renderSummary();
    renderOrders(currentQuery());
  } catch (error) {
    console.error("Error loading purchase orders:", error);
    ordersLoaded = false;
    setTableMessage("Could not load purchase orders. Is the backend running?");
    const summary = document.getElementById("po-summary");
    if (summary) summary.textContent = "Purchase orders unavailable";
  }
}

function setupSearch() {
  const input = document.getElementById("po-search");
  if (!input) return;
  input.addEventListener("input", () => {
    renderOrders(input.value);
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
setupRowToggle();
loadOrdersPage();
loadWarehouseLabel();
setupDbStatus();
