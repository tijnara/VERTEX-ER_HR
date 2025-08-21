// server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- CORS (allow your domains + localhost) --------------------
const allowedOrigins = [
    'http://localhost:63342',
    'http://localhost:63343',
    'http://localhost:3000',
    'https://inv.dm3system.com',
    'https://dm3.dm3system.com',
];
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// -------------------- MySQL Pool with startup ping --------------------
let pool;
(async () => {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            dateStrings: true, // return DATETIME as strings (useful for JSON)
        });
        const c = await pool.getConnection();
        await c.ping();
        c.release();
        console.log('✅ Database pool ready.');
    } catch (error) {
        console.error('❌ FATAL: Database connection failed.', error);
    }
})();

// -------------------- Health --------------------
app.get('/health', (req, res) => res.json({ ok: true }));

// -------------------- Login (DB-backed) --------------------
app.post('/api/login', async (req, res) => {
    if (!pool) return res.status(500).json({ message: 'Database connection has not been established.' });
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

        const sql = `SELECT user_id AS id, user_password AS pass FROM user WHERE user_email = ? LIMIT 1`;
        const [rows] = await pool.query(sql, [email]);
        if (!rows || rows.length === 0) return res.status(401).json({ message: 'Invalid credentials.' });

        const user = rows[0];
        if (String(password) !== String(user.pass)) return res.status(401).json({ message: 'Invalid credentials.' });

        res.json({ message: 'Login successful', userId: user.id });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// -------------------- Create Medical Supply Issuance --------------------
app.post('/api/issue', async (req, res) => {
    if (!pool) return res.status(500).json({ message: 'Database connection has not been established.' });

    const { branch_id, employee_id, issue_date, remarks, status, items } = req.body || {};

    // Basic validation
    if (!branch_id || !employee_id || !issue_date || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const created_by = 1; // TODO: replace with session/userId

        // 1) Insert parent first (no fragile COUNT(*) logic)
        const [issueResult] = await connection.query(
            `INSERT INTO medical_supply_issue (branch_id, employee_id, status, issue_date, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [branch_id, employee_id, status || 'DRAFT', issue_date, remarks || null, created_by]
        );
        const issueId = issueResult.insertId;

        // 2) Generate stable issue_no based on date + insertId
        const today = new Date().toISOString().slice(0,10).replaceAll('-',''); // yyyymmdd
        const issueNo = `ISS-${today}-${issueId}`;
        await connection.query(
            `UPDATE medical_supply_issue SET issue_no = ? WHERE id = ?`,
            [issueNo, issueId]
        );

        // 3) Insert lines
        const lineSql =
            `INSERT INTO medical_supply_issue_line (issue_id, product_id, qty, uom, batch_no, expiry_date)
             VALUES (?, ?, ?, ?, ?, ?)`;

        for (const item of items) {
            if (!item || !item.product_id || !item.qty) {
                throw new Error('Each item must have product_id and qty.');
            }
            await connection.query(lineSql, [
                issueId,
                item.product_id,
                item.qty,
                item.uom || null,
                item.batch_no || null,
                item.expiry_date || null,
            ]);
        }

        await connection.commit();
        res.status(201).json({ message: 'Issuance created successfully!', issueId, issueNo });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Issuance creation error:', err);
        res.status(500).json({ message: 'Failed to create issuance.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// -------------------- JSON 404 + Error handlers --------------------
app.use((req, res) => {
    res.status(404).json({ message: 'Not Found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({ message: 'Internal server error.' });
});

// -------------------- Start --------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API running at http://localhost:${PORT}`);
});

// Avoid silent crashes on unhandled rejections
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
