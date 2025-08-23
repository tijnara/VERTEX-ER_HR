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
        const { data: products } = await axios.get(PRODUCT_API_URL, { timeout: 15000 });

        const mapped = (products || [])
            .filter(p => p.isActive === true)
            .map(p => ({
                product_id: p.productId,
                product_name: p.productName,
                unit: p.unit ?? null,
                unit_count: p.unitCount ?? null,
                barcode: p.barcode ?? null,
                category_id: p.categoryId,
                category_name: p.categoryName,
                brand_id: p.brandId ?? null,
                brand_name: p.brandName ?? null,
                last_updated: p.lastUpdated ?? null,
            }))
            .sort((a, b) => a.product_name.localeCompare(b.product_name));

        res.json(mapped);
    } catch (err) {
        console.error('Products GET error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to product service.' });
    }
});

// Create product by forwarding payload to external API (aligned to your sample structure)
app.post('/api/products', async (req, res) => {
    try {
        const {
            productName,
            barcode = null,
            shortDescription = '',
            // Defaults mirrored from your sample objects:
            parentId = 0,
            unit = 'Pieces',
            unitCount = 1,
            priceA = 0,
            priceB = 0,
            priceC = 0,
            priceD = 0,
            priceE = 0,
            isActive = true,
            // IMPORTANT: Use the correct category for your target catalog.
            // We keep the default at 172 so it passes validation like your samples.
            categoryId = DEFAULT_CATEGORY_ID,
            // Your samples use brandId=18 (CDO). Replace with a valid brand id in your system as needed.
            brandId = 18,
            suppliers = [],
        } = req.body || {};

        if (!productName) {
            return res.status(400).json({ message: 'productName is required.' });
        }

        const payload = {
            productName,
            parentId,
            barcode,
            shortDescription,
            unit,
            unitCount,
            priceA, priceB, priceC, priceD, priceE,
            isActive,
            categoryId,
            brandId,
            suppliers,
        };

        // Log what we send for easy troubleshooting against the external API
        console.log('[Products POST] outbound payload ->', payload);

        const { data: created } = await axios.post(PRODUCT_API_URL, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
        });

        const normalized = {
            product_id: created.productId,
            product_name: created.productName,
            unit: created.unit ?? unit,
            unit_count: created.unitCount ?? unitCount,
            barcode: created.barcode ?? barcode,
            category_id: created.categoryId ?? categoryId,
            brand_id: created.brandId ?? brandId,
            last_updated: created.lastUpdated ?? null,
        };

        return res.status(201).json({
            message: 'Medicine created successfully.',
            product: normalized,
        });
    } catch (err) {
        const status = err?.response?.status || 500;
        const upstream = err?.response?.data ?? err?.message ?? String(err);

        // Log the upstream error details from the external API
        console.error('[Products POST] upstream error ->', upstream);

        return res.status(status).json({
            message: 'Failed to create medicine via external Product API.',
            error: upstream,
        });
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
