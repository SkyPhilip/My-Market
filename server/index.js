const express = require('express');
const session = require('express-session');
const cors = require('cors');
const Alpaca = require('@alpacahq/alpaca-trade-api');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:4200',
  credentials: true
}));
app.use(session({
  secret: 'my-market-app-local-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 4 // 4 hours
  }
}));

// Helper: create Alpaca client from session credentials
function getAlpacaClient(req) {
  if (!req.session || !req.session.keyId || !req.session.secretKey) {
    return null;
  }
  return new Alpaca({
    keyId: req.session.keyId,
    secretKey: req.session.secretKey,
    paper: true
  });
}

// Auth middleware — applied to all routes except /api/login
function requireAuth(req, res, next) {
  if (!req.session || !req.session.keyId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  next();
}

// POST /api/login — validate credentials against Alpaca
app.post('/api/login', async (req, res) => {
  const { keyId, secretKey } = req.body;

  if (!keyId || !secretKey) {
    return res.status(400).json({ error: 'API Key and Secret are required.' });
  }

  try {
    const alpaca = new Alpaca({
      keyId,
      secretKey,
      paper: true
    });

    const account = await alpaca.getAccount();
    req.session.keyId = keyId;
    req.session.secretKey = secretKey;
    res.json(account);
  } catch (err) {
    console.error('Login failed:', err.message);
    console.error(err.stack);
    if (err.statusCode === 401 || err.statusCode === 403) {
      return res.status(401).json({ error: 'Invalid API Key or Secret. Please check your credentials and try again.' });
    }
    return res.status(502).json({ error: 'Unable to connect to Alpaca. Please try again later.' });
  }
});

// POST /api/logout — destroy session
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err.message);
      console.error(err.stack);
      return res.status(500).json({ error: 'Failed to log out. Please try again.' });
    }
    res.json({ message: 'Logged out successfully.' });
  });
});

// All routes below require authentication
app.use('/api', requireAuth);

// GET /api/account — return account info
app.get('/api/account', async (req, res) => {
  try {
    const alpaca = getAlpacaClient(req);
    const account = await alpaca.getAccount();
    res.json(account);
  } catch (err) {
    console.error('Error fetching account:', err.message);
    console.error(err.stack);
    res.status(502).json({ error: 'Unable to fetch account information. Please try again later.' });
  }
});

// GET /api/clock — return market clock
app.get('/api/clock', async (req, res) => {
  try {
    const alpaca = getAlpacaClient(req);
    const clock = await alpaca.getClock();
    res.json(clock);
  } catch (err) {
    console.error('Error fetching clock:', err.message);
    console.error(err.stack);
    res.status(502).json({ error: 'Unable to fetch market clock. Please try again later.' });
  }
});

// GET /api/market-summary — latest snapshots for DIA, SPY, QQQ
app.get('/api/market-summary', async (req, res) => {
  try {
    const alpaca = getAlpacaClient(req);
    const symbols = ['DIA', 'SPY', 'QQQ'];
    const snapshotsRaw = await alpaca.getSnapshots(symbols);

    // SDK returns array-like object indexed by number; convert to symbol-keyed map
    const snapshotMap = {};
    const values = Array.isArray(snapshotsRaw) ? snapshotsRaw : Object.values(snapshotsRaw);
    values.forEach(snap => {
      if (snap && snap.symbol) {
        snapshotMap[snap.symbol] = snap;
      }
    });

    const summary = symbols.map(symbol => {
      const snap = snapshotMap[symbol];
      if (!snap) {
        return { symbol, currentPrice: null, prevClose: null, change: null, changePercent: null };
      }
      const latestTrade = snap.LatestTrade || snap.latestTrade;
      const dailyBar = snap.DailyBar || snap.dailyBar;
      const prevDailyBar = snap.PrevDailyBar || snap.prevDailyBar;

      const currentPrice = latestTrade ? (latestTrade.Price || latestTrade.p) : null;
      const prevClose = prevDailyBar ? (prevDailyBar.ClosePrice || prevDailyBar.Close || prevDailyBar.c) : null;
      const change = currentPrice && prevClose ? currentPrice - prevClose : null;
      const changePercent = change && prevClose ? (change / prevClose) * 100 : null;

      return {
        symbol,
        currentPrice: currentPrice ? parseFloat(currentPrice.toFixed(2)) : null,
        prevClose: prevClose ? parseFloat(prevClose.toFixed(2)) : null,
        change: change ? parseFloat(change.toFixed(2)) : null,
        changePercent: changePercent ? parseFloat(changePercent.toFixed(2)) : null
      };
    });

    res.json(summary);
  } catch (err) {
    console.error('Error fetching market summary:', err.message);
    console.error(err.stack);
    res.status(502).json({ error: 'Unable to fetch market data. Please try again later.' });
  }
});

// GET /api/bars/:symbol — intraday bars for charting
app.get('/api/bars/:symbol', async (req, res) => {
  try {
    const alpaca = getAlpacaClient(req);
    const { symbol } = req.params;
    const timeframe = req.query.timeframe || '5Min';
    const start = req.query.start || new Date().toISOString().split('T')[0];
    const end = req.query.end || new Date().toISOString().split('T')[0];

    const bars = [];
    const barsIterator = alpaca.getBarsV2(symbol, {
      start,
      end,
      timeframe,
      limit: 1000,
      feed: 'iex'
    });

    for await (const bar of barsIterator) {
      bars.push({
        time: bar.Timestamp || bar.t,
        open: bar.OpenPrice || bar.o,
        high: bar.HighPrice || bar.h,
        low: bar.LowPrice || bar.l,
        close: bar.ClosePrice || bar.c,
        volume: bar.Volume || bar.v
      });
    }

    res.json(bars);
  } catch (err) {
    console.error(`Error fetching bars for ${req.params.symbol}:`, err.message);
    console.error(err.stack);
    res.status(502).json({ error: `Unable to fetch chart data for ${req.params.symbol}. Please try again later.` });
  }
});

// GET /api/snapshots — snapshots for multiple symbols (query: ?symbols=XLK,XLF,...)
app.get('/api/snapshots', async (req, res) => {
  try {
    const alpaca = getAlpacaClient(req);
    const symbols = req.query.symbols ? req.query.symbols.split(',') : [];

    if (symbols.length === 0) {
      return res.status(400).json({ error: 'Please provide symbols as a comma-separated query parameter.' });
    }

    const snapshots = await alpaca.getSnapshots(symbols);
    res.json(snapshots);
  } catch (err) {
    console.error('Error fetching snapshots:', err.message);
    console.error(err.stack);
    res.status(502).json({ error: 'Unable to fetch market snapshots. Please try again later.' });
  }
});

// Global error-handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again later.' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
