// WebStorm/backend/server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const usersFromApi = require('./userData'); // Import the user data

const app = express();
const PORT = process.env.PORT || 3000;

// ---- CORS Configuration ----
const allowedOrigins = ['http://localhost:63342', 'http://localhost:63343'];
app.use(express.json());
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- MySQL Pool (still needed for other routes) ----
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
        });
        console.log('Successfully connected to the database.');
    } catch (error) {
        console.error('FATAL: Database connection failed.', error);
    }
})();

// ---- Health check ----
app.get('/health', (req, res) => res.json({ ok: true }));

// ---- API-backed login ----
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

        const user = usersFromApi.find(u => u.email === email);

        if (!user) return res.status(401).json({ message: 'Invalid credentials.' });

        const ok = String(password) === String(user.password);
        if (!ok) return res.status(401).json({ message: 'Invalid credentials.' });

        return res.json({ message: 'Login successful', userId: user.userId });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

// ---- Get All Branches (from DB) ----
app.get('/api/branches', async (req, res) => {
    if (!pool) return res.status(500).json({ message: 'Database connection has not been established.' });
    try {
        const sql = "SELECT id, branch_name FROM branches WHERE isActive = 1 ORDER BY branch_name";
        const [branches] = await pool.query(sql);
        res.json(branches);
    } catch (err) {
        console.error('Error fetching branches:', err);
        res.status(500).json({ message: 'Failed to fetch branches.' });
    }
});

// ---- Get All Active Products (from DB) ----
app.get('/api/products', async (req, res) => {
    if (!pool) return res.status(500).json({ message: 'Database connection has not been established.' });
    try {
        const sql = "SELECT product_id, product_name FROM products WHERE isActive = 1 AND product_category = 285 ORDER BY product_name";
        const [products] = await pool.query(sql);
        res.json(products);
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ message: 'Failed to fetch products.' });
    }
});

// ---- Get All Active Users (from API data) ----
app.get('/api/users', async (req, res) => {
    try {
        const activeUsers = usersFromApi
            .filter(user => user.isActive)
            .map(user => ({
                user_id: user.userId,
                full_name: user.fullName
            }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name)); // Sort alphabetically

        res.json(activeUsers);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ message: 'Failed to fetch users.' });
    }
});

// ---- Create Medical Supply Issuance (to DB) ----
app.post('/api/issue', async (req, res) => {
    if (!pool) return res.status(500).json({ message: 'Database connection has not been established.' });

    const { branch_id, employee_id, issue_date, remarks, status, items, userId } = req.body;
    if (!branch_id || !employee_id || !issue_date || !items || !items.length || !userId) {
        return res.status(400).json({ message: 'Missing required fields, or user is not identified.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const issueSql = `
            INSERT INTO medical_supply_issue (issue_no, branch_id, employee_id, status, issue_date, remarks, created_by)
            VALUES ('TEMP', ?, ?, ?, ?, ?, ?);
        `;
        const [issueResult] = await connection.query(issueSql, [branch_id, employee_id, status, issue_date, remarks, userId]);
        const issueId = issueResult.insertId;

        const newIssueNo = `ISS-${new Date().getFullYear()}-${String(issueId).padStart(6, '0')}`;
        const updateSql = `UPDATE medical_supply_issue SET issue_no = ? WHERE id = ?`;
        await connection.query(updateSql, [newIssueNo, issueId]);

        if (status === 'Approved') {
            const approvalSql = `
                UPDATE medical_supply_issue
                SET approved_by = ?, approved_at = NOW()
                WHERE id = ?
            `;
            await connection.query(approvalSql, [userId, issueId]);
        }

        const lineSql = `
            INSERT INTO medical_supply_issue_line (issue_id, product_id, qty, uom, batch_no, expiry_date)
            VALUES (?, ?, ?, ?, ?, ?);
        `;
        for (const item of items) {
            if (!item.product_id || !item.qty) throw new Error('Each item must have a product and quantity.');
            const expiry = item.expiry_date === '' ? null : item.expiry_date;
            await connection.query(lineSql, [issueId, item.product_id, item.qty, item.uom, item.batch_no, expiry]);
        }

        await connection.commit();
        res.status(201).json({ message: 'Issuance created successfully!', issueId: issueId, issueNo: newIssueNo });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Issuance creation error:', err);
        res.status(500).json({ message: 'Failed to create issuance.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// ---- Start server ----
app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));