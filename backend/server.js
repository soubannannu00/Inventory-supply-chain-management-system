require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { pool,testConnection } = require("./config/database");
const purchaseOrdersRouter=require("./routes/purchaseOrders")
const app = express();
const PORT = process.env.PORT || 3000;

// Allow the frontend (browser) to call this API from another origin.
app.use(cors());

// Read JSON bodies from POST/PUT requests (used later).
app.use(express.json());

// Simple check that the API is running. Does not require MySQL.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Inventory Supply Chain API is running",
  });
});
// Get all products
app.get("/api/products", async (req, res) => {
  try {
    // All product columns + category name + total stock across warehouses.
    const [rows] = await pool.query(`
      SELECT
        p.*,
        c.category_name,
        COALESCE(s.total_stock, 0) AS total_stock
      FROM products p
      LEFT JOIN categories c ON c.category_id = p.category_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity) AS total_stock
        FROM inventory
        GROUP BY product_id
      ) s ON s.product_id = p.product_id
      ORDER BY p.product_id
    `);

    res.json(rows.map((row) => {
      const totalStock = Number(row.total_stock) || 0;
      return {
        ...row,
        unit_price: Number(row.unit_price) || 0,
        total_stock: totalStock,
        is_low_stock: totalStock <= (Number(row.reorder_level) || 0)
      };
    }));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to fetch products"
    });
  }
});
// Inventory: one row per inventory record (product x warehouse)
app.get("/api/inventory", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        i.inventory_id,
        i.product_id,
        p.product_name,
        p.sku,
        c.category_name,
        i.warehouse_id,
        w.warehouse_name,
        w.city,
        i.quantity,
        i.reserved_quantity,
        (i.quantity - i.reserved_quantity) AS available,
        p.reorder_level,
        DATE_FORMAT(i.last_updated, '%Y-%m-%d %H:%i') AS last_updated
      FROM inventory i
      JOIN products p ON p.product_id = i.product_id
      JOIN warehouses w ON w.warehouse_id = i.warehouse_id
      LEFT JOIN categories c ON c.category_id = p.category_id
      ORDER BY w.warehouse_name, p.product_name
    `);

    res.json(rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity) || 0,
      reserved_quantity: Number(row.reserved_quantity) || 0,
      available: Number(row.available) || 0,
      reorder_level: Number(row.reorder_level) || 0
    })));
  } catch (error) {
    console.error("Inventory error:", error);
    res.status(500).json({
      error: "Failed to fetch inventory"
    });
  }
});

// Suppliers with purchase order summary
app.get("/api/suppliers", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.supplier_id,
        s.supplier_name,
        s.contact_person,
        s.email,
        s.phone,
        s.city,
        s.state,
        s.country,
        COALESCE(po.total_orders, 0) AS total_orders,
        COALESCE(po.total_purchased, 0) AS total_purchased,
        COALESCE(po.open_orders, 0) AS open_orders,
        DATE_FORMAT(po.last_order_date, '%d %b %Y') AS last_order_date
      FROM suppliers s
      LEFT JOIN (
        SELECT
          supplier_id,
          COUNT(*) AS total_orders,
          SUM(CASE WHEN status <> 'cancelled' THEN total_amount ELSE 0 END) AS total_purchased,
          SUM(CASE WHEN status IN ('pending', 'approved', 'ordered') THEN 1 ELSE 0 END) AS open_orders,
          MAX(order_date) AS last_order_date
        FROM purchase_orders
        GROUP BY supplier_id
      ) po ON po.supplier_id = s.supplier_id
      ORDER BY s.supplier_name
    `);

    res.json(rows.map((row) => ({
      ...row,
      total_orders: Number(row.total_orders) || 0,
      total_purchased: Number(row.total_purchased) || 0,
      open_orders: Number(row.open_orders) || 0
    })));
  } catch (error) {
    console.error("Suppliers error:", error);
    res.status(500).json({
      error: "Failed to fetch suppliers"
    });
  }
});

app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [[products]] = await pool.query(
      "SELECT COUNT(*) AS totalProducts FROM products"
    );

    const [[stock]] = await pool.query(
      "SELECT COALESCE(SUM(quantity), 0) AS totalStock FROM inventory"
    );

    const [[sales]] = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS totalSales FROM sales_orders"
    );

    const [[purchases]] = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS totalPurchases FROM purchase_orders"
    );

    // Low stock = products whose total stock (all warehouses) is at or
    // below their reorder level.
    const [[lowStock]] = await pool.query(`
      SELECT COUNT(*) AS lowStock
      FROM (
        SELECT p.product_id
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.product_id
        WHERE p.status = 'active'
        GROUP BY p.product_id, p.reorder_level
        HAVING COALESCE(SUM(i.quantity), 0) <= p.reorder_level
      ) AS low_items
    `);

    res.json({
      totalProducts: Number(products.totalProducts) || 0,
      totalStock: Number(stock.totalStock) || 0,
      totalSales: Number(sales.totalSales) || 0,
      totalPurchases: Number(purchases.totalPurchases) || 0,
      lowStock: Number(lowStock.lowStock) || 0
    });

  } catch (error) {
    console.error("Dashboard stats error:", error);

    res.status(500).json({
      error: "Failed to fetch dashboard stats"
    });
  }
});
// ---------- Dashboard helpers ----------

// Format a JS Date as YYYY-MM-DD using LOCAL time (avoids UTC shift).
function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Last `days` days including today, oldest first, starting `offset` days back.
function lastNDays(days, offset = 0) {
  const result = [];
  const today = new Date();
  for (let i = days - 1 + offset; i >= offset; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    result.push(day);
  }
  return result;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Daily totals for the last 7 days from sales_orders or purchase_orders.
// Always returns exactly 7 entries: [{ label, date, value }].
async function getDailySeries(tableName) {
  const days = lastNDays(7);
  const startKey = toLocalDateKey(days[0]);
  const endKey = toLocalDateKey(days[days.length - 1]);

  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day,
            COALESCE(SUM(total_amount), 0) AS total
     FROM ${tableName}
     WHERE order_date BETWEEN ? AND ?
       AND status <> 'cancelled'
     GROUP BY order_date`,
    [startKey, endKey]
  );

  const totals = {};
  rows.forEach((row) => {
    totals[row.day] = Number(row.total) || 0;
  });

  return days.map((day) => {
    const key = toLocalDateKey(day);
    return {
      label: DAY_LABELS[day.getDay()],
      date: key,
      value: totals[key] || 0,
    };
  });
}

// Sum of non-cancelled order totals between two YYYY-MM-DD dates.
async function getTotalBetween(tableName, startKey, endKey) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM ${tableName}
     WHERE order_date BETWEEN ? AND ?
       AND status <> 'cancelled'`,
    [startKey, endKey]
  );
  return Number(row.total) || 0;
}

// Sales chart: last 7 days
app.get("/api/dashboard/sales-chart", async (req, res) => {
  try {
    res.json(await getDailySeries("sales_orders"));
  } catch (error) {
    console.error("Sales chart error:", error);
    res.status(500).json({
      error: "Failed to fetch sales chart data"
    });
  }
});

// Purchase chart: last 7 days
app.get("/api/dashboard/purchase-chart", async (req, res) => {
  try {
    res.json(await getDailySeries("purchase_orders"));
  } catch (error) {
    console.error("Purchase chart error:", error);
    res.status(500).json({
      error: "Failed to fetch purchase chart data"
    });
  }
});

// Latest 5 sales orders
app.get("/api/dashboard/recent-sales", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CONCAT('INV-', so.sales_order_id) AS invoice,
        COALESCE(c.customer_name, '—') AS customer,
        so.total_amount AS amount,
        so.status,
        DATE_FORMAT(so.order_date, '%Y-%m-%d') AS order_date
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.customer_id
      ORDER BY so.order_date DESC, so.sales_order_id DESC
      LIMIT 5
    `);

    res.json(rows.map((row) => ({
      ...row,
      amount: Number(row.amount) || 0
    })));
  } catch (error) {
    console.error("Recent sales error:", error);
    res.status(500).json({
      error: "Failed to fetch recent sales"
    });
  }
});

// Products at or below their reorder level (total across warehouses)
app.get("/api/dashboard/low-stock", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        p.product_name AS name,
        p.sku,
        COALESCE(SUM(i.quantity), 0) AS qty,
        p.reorder_level AS min
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.product_id
      WHERE p.status = 'active'
      GROUP BY p.product_id, p.product_name, p.sku, p.reorder_level
      HAVING qty <= min
      ORDER BY qty ASC
      LIMIT 10
    `);

    res.json(rows.map((row) => ({
      ...row,
      qty: Number(row.qty) || 0,
      min: Number(row.min) || 0
    })));
  } catch (error) {
    console.error("Low stock error:", error);
    res.status(500).json({
      error: "Failed to fetch low stock items"
    });
  }
});

// Latest 5 purchase orders
app.get("/api/dashboard/recent-purchases", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CONCAT('PO-', po.purchase_order_id) AS po,
        COALESCE(s.supplier_name, '—') AS supplier,
        COALESCE(w.warehouse_name, '—') AS warehouse,
        po.total_amount AS amount,
        COALESCE(DATE_FORMAT(po.expected_date, '%d %b %Y'), '—') AS eta,
        po.status
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.supplier_id
      LEFT JOIN warehouses w ON po.warehouse_id = w.warehouse_id
      ORDER BY po.order_date DESC, po.purchase_order_id DESC
      LIMIT 5
    `);

    res.json(rows.map((row) => ({
      ...row,
      amount: Number(row.amount) || 0
    })));
  } catch (error) {
    console.error("Recent purchases error:", error);
    res.status(500).json({
      error: "Failed to fetch recent purchases"
    });
  }
});

// Live database connection check (cheap SELECT 1 with a 3s timeout)
app.get("/api/dashboard/db-status", async (req, res) => {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Database check timed out")), 3000);
    });

    await Promise.race([pool.query("SELECT 1"), timeout]);

    res.json({
      database: "connected",
      db: process.env.DB_NAME,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("DB status error:", error.code || error.message);
    res.status(503).json({
      database: "disconnected",
      error: error.code || error.message || "Database unavailable"
    });
  } finally {
    clearTimeout(timer);
  }
});

// Warehouses list (used for the dashboard header)
app.get("/api/dashboard/warehouses", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT warehouse_id, warehouse_name, city
      FROM warehouses
      ORDER BY warehouse_name ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error("Warehouses error:", error);
    res.status(500).json({
      error: "Failed to fetch warehouses"
    });
  }
});

// Small extra figures for the dashboard chips
app.get("/api/dashboard/summary-extras", async (req, res) => {
  try {
    const [[transit]] = await pool.query(`
      SELECT COUNT(*) AS ordersInTransit
      FROM purchase_orders
      WHERE status IN ('approved', 'ordered')
    `);

    const thisWeek = lastNDays(7);
    const prevWeek = lastNDays(7, 7);

    const salesThisWeek = await getTotalBetween(
      "sales_orders",
      toLocalDateKey(thisWeek[0]),
      toLocalDateKey(thisWeek[6])
    );
    const salesPrevWeek = await getTotalBetween(
      "sales_orders",
      toLocalDateKey(prevWeek[0]),
      toLocalDateKey(prevWeek[6])
    );

    // null when there is nothing to compare against
    const salesChangePct = salesPrevWeek > 0
      ? Math.round(((salesThisWeek - salesPrevWeek) / salesPrevWeek) * 1000) / 10
      : null;

    res.json({
      ordersInTransit: Number(transit.ordersInTransit) || 0,
      salesThisWeek,
      salesPrevWeek,
      salesChangePct
    });
  } catch (error) {
    console.error("Summary extras error:", error);
    res.status(500).json({
      error: "Failed to fetch dashboard summary extras"
    });
  }
});

app.get("/api/test",(req,res) => {
  res.json({
    message:"products route area is working"
  })
});
app.use("/api/purchase-orders",purchaseOrdersRouter);
app.get("/api/dashboard/test", (req, res) => {
  res.json({
    message: "Dashboard route is working"
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  testConnection();
});
