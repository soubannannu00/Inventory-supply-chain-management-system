// Backend API base URL (Express server in /backend)
const API_BASE = "http://localhost:3000";

// Live dashboard data loaded from MySQL (inventory_db) via the API.
// Starts empty so the page shows empty states until data arrives.
const dashboardData = {
  recentSales: [],
  lowStock: [],
  purchaseOrders: [],
};

async function fetchJSON(path) {
  const response = await fetch(API_BASE + path);
  if (!response.ok) {
    throw new Error("Request failed: " + path + " (" + response.status + ")");
  }
  return response.json();
}

// Seven zero-value days ending today, used when the chart API fails.
function emptyWeekSeries() {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    series.push({ label: labels[day.getDay()], value: 0 });
  }
  return series;
}

function capitalize(text) {
  const value = String(text || "").trim();
  if (!value) return "Pending";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

// Map DB status values to the labels that statusClass() already styles.
function displayStatus(rawStatus) {
  const key = String(rawStatus || "").trim().toLowerCase();
  if (key === "received") return "Received";
  if (key === "ordered" || key === "approved") return "In Transit";
  if (key === "delivered") return "Paid";
  return capitalize(key);
}

function formatNumber(value) {
  return value.toLocaleString("en-IN");
}

function formatMoney(value) {
  return "₹" + formatNumber(value);
}

function statusClass(status) {
  const key = String(status || "").toLowerCase().replace(" ", "-");
  if (key === "paid") return "status status-paid";
  if (key === "received") return "status status-received";
  if (key === "in-transit") return "status status-transit";
  return "status status-pending";
}

function matchesQuery(haystack, query) {
  return haystack.toLowerCase().includes(query);
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

 async function renderStats() {
  try {
    const response = await fetch(
      "http://localhost:3000/api/dashboard/stats"
    );

    if (!response.ok) {
      throw new Error("Failed to fetch dashboard stats");
    }

    const stats = await response.json();

    console.log("Dashboard stats from MySQL:", stats);

    document.getElementById("stat-products").textContent =
      formatNumber(Number(stats.totalProducts || 0));

    document.getElementById("stat-stock").textContent =
      formatNumber(Number(stats.totalStock || 0));

    document.getElementById("stat-sales").textContent =
      formatMoney(Number(stats.totalSales || 0));

    document.getElementById("stat-purchases").textContent =
      formatMoney(Number(stats.totalPurchases || 0));

    document.getElementById("stat-low-stock").textContent =
      formatNumber(Number(stats.lowStock || 0));

  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}


function renderChart(containerId, series, barClass) {
  const container = document.getElementById(containerId);
  const max = Math.max(...series.map((item) => item.value), 1);

  container.innerHTML = series
    .map((item) => {
      const height = Math.max(8, Math.round((item.value / max) * 160));
      return `
        <div class="bar-col">
          <span class="bar-value">${item.value ? formatNumber(item.value / 1000) + "k" : "—"}</span>
          <div class="bar ${barClass}" style="height: ${height}px" title="${formatMoney(item.value)}"></div>
          <span class="bar-label">${item.label}</span>
        </div>
      `;
    })
    .join("");
}

function renderSales(query) {
  const body = document.getElementById("recent-sales");
  const rows = dashboardData.recentSales.filter((row) =>
    matchesQuery(`${row.invoice} ${row.customer} ${row.status}`, query)
  );

  if (!rows.length) {
    const message = query ? "No matching sales." : "No sales yet.";
    body.innerHTML = `<tr><td class="empty-row" colspan="4">${message}</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.invoice}</td>
          <td>${row.customer}</td>
          <td>${formatMoney(row.amount)}</td>
          <td><span class="${statusClass(row.status)}">${row.status}</span></td>
        </tr>
      `
    )
    .join("");
}

function renderLowStock(query) {
  const list = document.getElementById("low-stock-list");
  const items = dashboardData.lowStock.filter((item) =>
    matchesQuery(`${item.name} ${item.sku}`, query)
  );

  if (!items.length) {
    const message = query ? "No matching low-stock items." : "No low-stock items.";
    list.innerHTML = `<li class="alert-item"><p>${message}</p></li>`;
    return;
  }

  list.innerHTML = items
    .map(
      (item) => `
        <li class="alert-item">
          <div>
            <h3>${item.name}</h3>
            <p>${item.sku} · Reorder at ${item.min}</p>
          </div>
          <span class="status status-pending">${item.qty} left</span>
        </li>
      `
    )
    .join("");
}

function renderPurchases(query) {
  const body = document.getElementById("recent-purchases");
  const rows = dashboardData.purchaseOrders.filter((row) =>
    matchesQuery(`${row.po} ${row.supplier} ${row.warehouse} ${row.status}`, query)
  );

  if (!rows.length) {
    const message = query ? "No matching purchase orders." : "No purchase orders yet.";
    body.innerHTML = `<tr><td class="empty-row" colspan="6">${message}</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.po}</td>
          <td>${row.supplier}</td>
          <td>${row.warehouse}</td>
          <td>${formatMoney(row.amount)}</td>
          <td>${row.eta}</td>
          <td><span class="${statusClass(row.status)}">${row.status}</span></td>
        </tr>
      `
    )
    .join("");
}

function renderLists(query) {
  const q = (query || "").trim().toLowerCase();
  renderSales(q);
  renderLowStock(q);
  renderPurchases(q);
}

function setupSearch() {
  const input = document.getElementById("dashboard-search");
  input.addEventListener("input", () => {
    renderLists(input.value);
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
async function loadProducts() {
  try {
    const response = await fetch("http://localhost:3000/api/products");

    if (!response.ok) {
      throw new Error("Failed to fetch products");
    }

    const products = await response.json();

    console.log("Products from MySQL:", products);
    const tableBody = document.getElementById("recent-sales");

        tableBody.innerHTML = "";

        products.forEach(product => {
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${product.product_id}</td>
                <td>${product.product_name}</td>
                <td>₹${product.unit_price}</td>
                <td>${product.status}</td>
            `;

            tableBody.appendChild(row);
        });

  } catch (error) {
    console.error("Error loading products:", error);
  }
}

function currentQuery() {
  const input = document.getElementById("dashboard-search");
  return input ? input.value : "";
}

function renderSummaryChips(extras) {
  const salesChip = document.getElementById("sales-trend-chip");
  const transitChip = document.getElementById("purchase-transit-chip");

  if (salesChip) {
    if (extras && typeof extras.salesChangePct === "number") {
      const pct = extras.salesChangePct;
      salesChip.textContent = (pct >= 0 ? "+" : "") + pct + "% vs last week";
    } else {
      salesChip.textContent = "Last 7 days";
    }
  }

  if (transitChip) {
    if (extras && typeof extras.ordersInTransit === "number") {
      const count = extras.ordersInTransit;
      transitChip.textContent = count + (count === 1 ? " order" : " orders") + " in transit";
    } else {
      transitChip.textContent = "— orders in transit";
    }
  }
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

async function loadDashboardData() {
  const [salesChart, purchaseChart, recentSales, lowStock, recentPurchases, extras] =
    await Promise.allSettled([
      fetchJSON("/api/dashboard/sales-chart"),
      fetchJSON("/api/dashboard/purchase-chart"),
      fetchJSON("/api/dashboard/recent-sales"),
      fetchJSON("/api/dashboard/low-stock"),
      fetchJSON("/api/dashboard/recent-purchases"),
      fetchJSON("/api/dashboard/summary-extras"),
    ]);

  // Charts: API series [{label, date, value}] -> renderChart; zeros on failure.
  if (salesChart.status === "fulfilled" && Array.isArray(salesChart.value)) {
    renderChart("sales-chart", salesChart.value.map((d) => ({ label: d.label, value: Number(d.value) || 0 })), "");
  } else {
    console.warn("Sales chart unavailable:", salesChart.reason);
    renderChart("sales-chart", emptyWeekSeries(), "");
  }

  if (purchaseChart.status === "fulfilled" && Array.isArray(purchaseChart.value)) {
    renderChart("purchase-chart", purchaseChart.value.map((d) => ({ label: d.label, value: Number(d.value) || 0 })), "purchase");
  } else {
    console.warn("Purchase chart unavailable:", purchaseChart.reason);
    renderChart("purchase-chart", emptyWeekSeries(), "purchase");
  }

  if (recentSales.status === "fulfilled" && Array.isArray(recentSales.value)) {
    dashboardData.recentSales = recentSales.value.map((row) => ({
      invoice: row.invoice,
      customer: row.customer,
      amount: Number(row.amount) || 0,
      status: displayStatus(row.status),
    }));
  } else {
    console.warn("Recent sales unavailable:", recentSales.reason);
  }

  if (lowStock.status === "fulfilled" && Array.isArray(lowStock.value)) {
    dashboardData.lowStock = lowStock.value.map((item) => ({
      name: item.name,
      sku: item.sku,
      qty: Number(item.qty) || 0,
      min: Number(item.min) || 0,
    }));
  } else {
    console.warn("Low stock unavailable:", lowStock.reason);
  }

  if (recentPurchases.status === "fulfilled" && Array.isArray(recentPurchases.value)) {
    dashboardData.purchaseOrders = recentPurchases.value.map((row) => ({
      po: row.po,
      supplier: row.supplier,
      warehouse: row.warehouse,
      amount: Number(row.amount) || 0,
      eta: row.eta || "—",
      status: displayStatus(row.status),
    }));
  } else {
    console.warn("Recent purchases unavailable:", recentPurchases.reason);
  }

  if (extras.status === "fulfilled") {
    renderSummaryChips(extras.value);
  } else {
    console.warn("Summary extras unavailable:", extras.reason);
    renderSummaryChips(null);
  }

  renderLists(currentQuery());
}

renderToday();
renderStats();
renderChart("sales-chart", emptyWeekSeries(), "");
renderChart("purchase-chart", emptyWeekSeries(), "purchase");
renderLists("");
setupSearch();
setupSidebar();
loadDashboardData();
loadWarehouseLabel();
setupDbStatus();

// loadProducts() is kept for later use (e.g. a Products page) but is no
// longer called here, because it overwrote the Recent Sales table.
