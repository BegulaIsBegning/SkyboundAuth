// src/index.js — Skybound Auth Server
// (dotenv not needed — Render injects env vars directly)
if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch {} }
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── Trust proxy (Render puts you behind one) ────────────────────────────────
app.set('trust proxy', 1);

// ─── CORS ────────────────────────────────────────────────────────────────────
// /oauth/token and /oauth/userinfo need to be open to cross-origin fetch
app.use('/oauth/token', cors());
app.use('/oauth/userinfo', cors());
app.use('/oauth/.well-known', cors());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Session (Postgres-backed via pool) ───────────────────────────────────────
// Simple in-process session for Render free tier (restarts clear sessions, that's fine)
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-production-please',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/oauth/token', authLimiter);

// ─── Static files (login/dashboard UI) ───────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/oauth', require('./routes/oauth'));
app.use('/apps', require('./routes/apps'));

// ─── HTML Pages (SPA-ish) ─────────────────────────────────────────────────────
// Serve index.html for all non-API routes (the frontend handles routing)
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/developer', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.accepts('html')) return res.sendFile(path.join(__dirname, '../public/index.html'));
  res.status(404).json({ error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Skybound Auth running on ${BASE_URL}`);
  console.log(`   OpenID config: ${BASE_URL}/oauth/.well-known/openid-configuration`);
});

module.exports = app;
