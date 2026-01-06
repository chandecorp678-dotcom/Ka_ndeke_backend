require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { initDb, pool } = require("./db");
const routes = require("./routes");

const app = express();

// Basic request logging to help debugging
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.originalUrl);
  next();
});

app.use(cors());
app.use(express.json());

// Serve static frontend from ./public
app.use(express.static(path.join(__dirname, "public")));

(async () => {
  try {
    await initDb();       // test Postgres connection
    app.locals.db = pool; // attach Postgres pool to app

    // mount API routes under /api
    app.use("/api", routes);

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log("Ka Ndeke backend running on port", PORT);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);      // <-- only here, inside catch
  }
})();
