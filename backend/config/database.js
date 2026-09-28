const mysql = require("mysql2/promise");

// Pool = a small group of reusable MySQL connections.
// The rest of the app will use this later (products, users, etc.).
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    connection.release();
    console.log("MySQL connected.");
  } catch (error) {
    console.log("MySQL is not connected yet.");
    console.log("Check that MySQL is running and that backend/.env is correct.");
    console.log(error.message);
  }
}

module.exports = { pool, testConnection };
