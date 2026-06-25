require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const { Pool } = require('pg');

const authRoutes = require('./routes/authRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const testingRoutes = require('./routes/testingRoutes');
const supplyRoutes = require('./routes/supplyRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { runAutomation } = require('./controllers/alertController');
const { getQRDataUrl, verifyMedicine } = require('./controllers/medicineController');

const app = express();

// Trust Render's reverse proxy (needed for correct req.protocol behind HTTPS)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

/* ─────────────────────────────────────────────────────────────
   PostgreSQL Database Connection
───────────────────────────────────────────────────────────── */
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'pharmatrace',
  password: process.env.DB_PASSWORD || '',   // must come from .env
  port: Number(process.env.DB_PORT) || 5432
});

// Make DB pool available if any route/controller wants it
app.locals.pool = pool;

// Test DB connection on startup
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL connected successfully');
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connection failed:', err.message);
  });

/* ─────────────────────────────────────────────────────────────
   View Engine
───────────────────────────────────────────────────────────── */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ─────────────────────────────────────────────────────────────
   Middleware
───────────────────────────────────────────────────────────── */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────────────────────────────────────────────────────────
   Session
───────────────────────────────────────────────────────────── */
app.use(session({
  secret: process.env.SESSION_SECRET || 'pharma_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

/* ─────────────────────────────────────────────────────────────
   Flash Messages
───────────────────────────────────────────────────────────── */
app.use(flash());

/* ─────────────────────────────────────────────────────────────
   Global Template Locals
───────────────────────────────────────────────────────────── */
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

/* ─────────────────────────────────────────────────────────────
   Routes
───────────────────────────────────────────────────────────── */
app.use('/', authRoutes);
app.use('/medicines', medicineRoutes);
app.use('/testing', testingRoutes);
app.use('/supply', supplyRoutes);
app.use('/admin', adminRoutes);

/* ─────────────────────────────────────────────────────────────
   Real-time QR API
───────────────────────────────────────────────────────────── */
app.get('/qr/api/:batchId', getQRDataUrl);

/* ─────────────────────────────────────────────────────────────
   Public Verify Routes
───────────────────────────────────────────────────────────── */
app.get('/verify', (req, res) => res.render('verifyMedicine', { result: null }));
app.post('/verify', verifyMedicine);
app.get('/verify/:batchId', verifyMedicine);

/* ─────────────────────────────────────────────────────────────
   Root Redirect
───────────────────────────────────────────────────────────── */
app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/dashboard' : '/login');
});

/* ─────────────────────────────────────────────────────────────
   404 Handler
───────────────────────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).render('404');
});

/* ─────────────────────────────────────────────────────────────
   Global Error Handler
───────────────────────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  req.flash('error', 'An unexpected error occurred.');
  res.redirect('/dashboard');
});

/* ─────────────────────────────────────────────────────────────
   Start Server FIRST
───────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       💊  PharmaTrace AI  Started        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  🌐  App        → http://localhost:${PORT}`);
  console.log(`  🔍  Verify     → http://localhost:${PORT}/verify`);
  console.log(`  📱  QR API     → http://localhost:${PORT}/qr/api/:batchId`);
  console.log(`  🤖  AI Service → http://localhost:5001`);
  console.log(`  📊  Analytics  → http://localhost:${PORT}/admin/analytics\n`);
});

/* ─────────────────────────────────────────────────────────────
   Automation Engine (runs hourly)
   Delay startup slightly so DB can initialize first
───────────────────────────────────────────────────────────── */
setTimeout(() => {
  runAutomation();
  setInterval(runAutomation, 60 * 60 * 1000);
}, 3000);