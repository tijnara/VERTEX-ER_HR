// WebStorm/backend/server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// The external API addresses
const USER_API_URL = 'http://goatedcodoer:8080/api/users';
const PRODUCT_API_URL = 'http://goatedcodoer:8080/api/products';
const BRANCH_API_URL = 'http://goatedcodoer:8080/api/branches'; // New API for branches

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

// ---- MySQL Pool (only needed for creating new issues now) ----
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
        console.log('Successfully connected to the database for issuance creation.');
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

        const apiResponse = await axios.get(USER_API_URL);
        const users = apiResponse.data;

        const user = users.find(u => u.email === email);
        if (!user) return res.status(401).json({ message: 'Invalid credentials.' });

        const ok = String(password) === String(user.password);
        if (!ok) return res.status(401).json({ message: 'Invalid credentials.' });

        return res.json({ message: 'Login successful', userId: user.userId });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

// ---- Get All Branches (from API) ----
app.get('/api/branches', async (req, res) => {
    try {
        const apiResponse = await axios.get(BRANCH_API_URL);
        const branches = apiResponse.data;

        const activeBranches = branches
            .filter(branch => branch.isActive === 1)
            .map(branch => ({
                id: branch.id,
                branch_name: branch.branchName
            }))
            .sort((a, b) => a.branch_name.localeCompare(b.branch_name));

        res.json(activeBranches);
    } catch (err) {
        console.error('Error fetching branches:', err);
        res.status(500).json({ message: 'Could not connect to branch service.' });
    }
});

// ---- Get All Active Products (from API) ----
app.get('/api/products', async (req, res) => {
    try {
        const apiResponse = await axios.get(PRODUCT_API_URL);
        const products = apiResponse.data;

        const activeProducts = products
            .filter(product => product.isActive && product.categoryId === 285)
            .map(product => ({
                product_id: product.productId,
                product_name: product.productName
            }))
            .sort((a, b) => a.product_name.localeCompare(b.product_name));

        res.json(activeProducts);
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ message: 'Could not connect to product service.' });
    }
});

// ---- Get All Active Users (from API) ----
app.get('/api/users', async (req, res) => {
    try {
        const apiResponse = await axios.get(USER_API_URL);
        const users = apiResponse.data;

        const activeUsers = users
            .filter(user => user.isActive)
            .map(user => ({
                user_id: user.userId,
                full_name: user.fullName
            }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name));

        res.json(activeUsers);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ message: 'Could not connect to user service.' });
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