// backend/server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:63343';

app.use(express.json());

// ---- CORS (must be before routes) ----
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- MySQL pool ----
let pool;
(async () => {
    pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    });

})();

// ---- Health check ----
app.get('/health', (req, res) => res.json({ ok: true }));

// ---- DB-backed login ----
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const sql = `
      SELECT user_id AS id,
             user_email AS email,
             user_password AS pass
      FROM user
      WHERE user_email = ?
      LIMIT 1
    `;
        const [rows] = await pool.query(sql, [email]);

        if (!rows || rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const user = rows[0];

        // TEMP: plain-text compare; migrate to bcrypt ASAP
        const ok = String(password) === String(user.pass);
        if (!ok) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        return res.json({ message: 'Login successful', userId: user.id });
    } catch (err) {
        console.error('Login error'); // keep logs generic
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

// ---- Start server ----
app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
