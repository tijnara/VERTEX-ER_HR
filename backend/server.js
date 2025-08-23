// WebStorm/backend/server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- External API addresses ----
const USER_API_URL    = 'http://goatedcodoer:8080/api/users';
const PRODUCT_API_URL = 'http://goatedcodoer:8080/api/products';
const BRANCH_API_URL  = 'http://goatedcodoer:8080/api/branches';

// If you later want to default new items into a specific category (e.g., "MEDICINES"),
// set this to the correct categoryId on your external service.
// For now we align with your sample (172 = GROCERY PRODUCTS) just to satisfy validation.
const DEFAULT_CATEGORY_ID = 172;

// ---- Parsers & Static ----
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ---- CORS (keep if you still open pages from WebStorm ports) ----
const allowedOrigins = [
    'http://localhost:3000',
    'http://192.168.0.65:3000',
    'http://localhost:63342',
    'http://localhost:63343',
];
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- Health ----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Login (external) ----
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

        const { data: users } = await axios.get(USER_API_URL, { timeout: 15000 });
        const user = (users || []).find(u => u.email === email);
        if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
        if (String(password) !== String(user.password)) return res.status(401).json({ message: 'Invalid credentials.' });

        return res.json({ message: 'Login successful', userId: user.userId });
    } catch (err) {
        console.error('Login error:', err?.message || err);
        return res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

// ---- Branches (external) ----
app.get('/api/branches', async (_req, res) => {
    try {
        const { data: branches } = await axios.get(BRANCH_API_URL, { timeout: 15000 });
        const active = (branches || [])
            .filter(b => b.isActive === 1)
            .map(b => ({ id: b.id, branch_name: b.branchName }))
            .sort((a, b) => a.branch_name.localeCompare(b.branch_name));
        res.json(active);
    } catch (err) {
        console.error('Branches error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to branch service.' });
    }
});

// ---- Users (external) ----
app.get('/api/users', async (_req, res) => {
    try {
        const { data: users } = await axios.get(USER_API_URL, { timeout: 15000 });
        const active = (users || [])
            .filter(u => u.isActive)
            .map(u => ({ user_id: u.userId, full_name: u.fullName }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name));
        res.json(active);
    } catch (err) {
        console.error('Users error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

//
// -------- PRODUCTS (external only; no local DB) --------
//

// Return ALL active products (no category filter) so new items are visible right away.
app.get('/api/products', async (_req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT product_id, product_name
             FROM products
             WHERE product_category = ?
             ORDER BY product_name ASC`,
            [285]
        );
        res.json(rows || []);
    } catch (err) {
        console.error('Products GET error (local DB):', err?.message || err);
        res.status(500).json({ message: 'Could not load products from database.' });
    }
});

// Create product in local DB with required defaults for medical products
app.post('/api/products', async (req, res) => {
    try {
        const { productName } = req.body || {};
        if (!productName || !String(productName).trim()) {
            return res.status(400).json({ message: 'productName is required.' });
        }
        const name = String(productName).trim();

        const insertSql = `
            INSERT INTO products (product_name, product_category, date_added, last_updated, unit_of_measurement)
            VALUES (?, ?, NOW(), NOW(), ?)
        `;
        const [result] = await pool.query(insertSql, [name, 285, 18]);

        const product = { product_id: result.insertId, product_name: name };
        return res.status(201).json({ message: 'Medicine created successfully.', product });
    } catch (err) {
        console.error('Products POST error (local DB):', err?.message || err);
        if (err && (err.code === 'ER_DUP_ENTRY' || String(err.message || '').toLowerCase().includes('duplicate'))) {
            return res.status(409).json({ message: 'A medicine with the same name already exists.' });
        }
        return res.status(500).json({ message: 'Failed to create medicine in database.' });
    }
});

//
// -------- Issuance (LOCAL DB for issuance only) --------
app.post('/api/issue', async (req, res) => {
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
        await connection.query(`UPDATE medical_supply_issue SET issue_no = ? WHERE id = ?`, [newIssueNo, issueId]);

        if (status === 'Approved') {
            await connection.query(
                `UPDATE medical_supply_issue SET approved_by = ?, approved_at = NOW() WHERE id = ?`,
                [userId, issueId]
            );
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
        res.status(201).json({ message: 'Issuance created successfully!', issueId, issueNo: newIssueNo });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Issuance error:', err?.message || err);
        res.status(500).json({ message: 'Failed to create issuance.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// ---- Start server ----
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`API + static files at http://${HOST}:${PORT} (open http://192.168.0.65:${PORT})`);
});
