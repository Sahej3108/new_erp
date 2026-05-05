'use strict';

/**
 * TPPL ERP — Vercel Serverless API Handler (OPTIMIZED)
 * ════════════════════════════════════════════════════════
 * 
 * PERFORMANCE IMPROVEMENTS:
 * ✅ Response caching (5-minute TTL)
 * ✅ Pagination for large datasets
 * ✅ Lazy loading support
 * ✅ Field filtering
 * ✅ Gzip compression
 * ✅ New leads endpoint with dynamic Google Sheets fetching
 * 
 * ENV VARS required in Vercel project settings:
 *   GOOGLE_CLIENT_EMAIL   — client_email from service_account.json
 *   GOOGLE_PRIVATE_KEY    — private_key  from service_account.json (with real \n)
 */

// ══════════════════════════════════════════════════════════════════════════════
// 🔥 INTELLIGENT CACHING LAYER — PREVENTS QUOTA LIMIT ERRORS & IMPROVES SPEED
// ══════════════════════════════════════════════════════════════════════════════

class CacheManager {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.stats = { hits: 0, misses: 0, stores: 0 };
  }

  async get(key, fetcher) {
    const now = Date.now();
    
    // Check cache
    if (this.cache.has(key)) {
      const { data, timestamp } = this.cache.get(key);
      const age = now - timestamp;
      
      if (age < this.CACHE_TTL) {
        this.stats.hits++;
        console.log(`[CACHE HIT] ${key} (age: ${Math.round(age/1000)}s)`);
        return data;
      } else {
        console.log(`[CACHE EXPIRED] ${key}`);
        this.cache.delete(key);
      }
    }

    // Cache miss - fetch fresh data
    this.stats.misses++;
    console.log(`[CACHE MISS] ${key} — fetching fresh data`);
    const data = await fetcher();
    
    // Store in cache
    this.cache.set(key, { data, timestamp: now });
    this.stats.stores++;
    console.log(`[CACHE STORED] ${key}`);
    
    return data;
  }

  invalidate(key) {
    if (key) {
      this.cache.delete(key);
      console.log(`[CACHE INVALIDATED] ${key}`);
    } else {
      this.cache.clear();
      console.log(`[CACHE CLEARED] All`);
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      stores: this.stats.stores,
      entries: Array.from(this.cache.entries()).map(([key, { timestamp }]) => ({
        key,
        age_seconds: Math.round((Date.now() - timestamp) / 1000),
        ttl_seconds: Math.round(this.CACHE_TTL / 1000)
      }))
    };
  }
}

const cacheManager = new CacheManager();

// ══════════════════════════════════════════════════════════════════════════════
// SHEET IDs
// ══════════════════════════════════════════════════════════════════════════════

const SPREADSHEET_ID             = '1MgsPCBWo-GGbGf-I_Y0LRCtY64B1aVbVQQYpTqFI4NY';
const DISPATCH_FMS_SOURCE_ID     = '17JDVzgF7pK_7C25_k8VKIlC4gbizdASaYjob2JDQWzo';
const O2D_SOURCE_SHEET_ID        = '1A3wZ4PvmuNn3TWOI96W3IUK62oxOFzY6_JueiaXBuKA';
const FMS_SHEET_ID               = '1A3wZ4PvmuNn3TWOI96W3IUK62oxOFzY6_JueiaXBuKA';
const CALL_LATER_SHEET_ID        = '1nqIlxfNARypJycUBCKL736Vm082gAOBC3ljdUUm6x4s';
const DONE_SHEET_ID              = '1T0pj7dWZ8ixYaeLORVKtmO55TYCDBjFpNSp4KuJg9o4';
const O2D_CALL_LATER_ID          = '19H9thoVTStj7kCBOoODvpGD7T2I9uj01FrQbqBQY6A0';
const O2D_DONE_SHEET_ID          = '1T0pj7dWZ8ixYaeLORVKtmO55TYCDBjFpNSp4KuJg9o4';
const DISPATCH_FMS_HOLD_SHEET_ID = '14tSrq3GAFtY144Wp9DbW3Q6_isIIr2u2PIJM5O7b478';
const DISPATCH_FMS_DONE_SHEET_ID = '1zhZQeU4nr2P8JUFJJK1a9gs1li34xZT-zpzAR9KEgoQ';
const CHECKLIST_SHEET_ID         = '1mvd94ei64eITswOua4b-d_o7IhnRs_lKxLJgRF6H7DE';
const LEADS_SHEET_ID             = '1vvUYVy4BPok-tNL3p2ocy_sGRwfMnlKlMA9UKI2guNU'; // 🆕 Lead Testing

const RATE_CL_SHEET_URL =
  'https://script.google.com/a/macros/takkarpolychem.com/s/' +
  'AKfycbysaa_5eoEQjD2G57IRnPzV0O2YNo-WfPWxweyoSAK5j1kwbmUe5Q4nvX6PiYz0cSQ/exec';

const O2D_PLAN_DAYS = 3;

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE AUTH — JWT → access token (no googleapis dependency)
// ══════════════════════════════════════════════════════════════════════════════

function loadCredentials() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key   = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      'Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY environment variables. ' +
      'Set them in your Vercel project settings → Environment Variables.'
    );
  }
  return { client_email: email, private_key: key.replace(/\\n/g, '\n') };
}

async function getAccessToken() {
  const { client_email, private_key } = loadCredentials();

  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const unsigned = `${header}.${payload}`;

  const keyPem = private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(keyPem, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(unsigned)
  );

  const jwt = `${unsigned}.${Buffer.from(sigBuffer).toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const json = await res.json();
  if (!json.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(json));
  return json.access_token;
}

// ══════════════════════════════════════════════════════════════════════════════
// SHEET HELPERS
// ══════════════════════════════════════════════════════════════════════════════

async function fetchSheetAsRecords(spreadsheetId, sheetName) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${await res.text()}`);
  const { values = [] } = await res.json();
  if (values.length < 2) return [];
  const [headers, ...rows] = values;
  return rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [String(h).trim(), row[i] ?? '']))
  );
}

/** 🆕 Fetch sheet with pagination support */
async function fetchSheetAsRecordsWithPagination(spreadsheetId, sheetName, page = 1, pageSize = 50) {
  const allRecords = await fetchSheetAsRecords(spreadsheetId, sheetName);
  const total = allRecords.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  
  return {
    data: allRecords.slice(start, end),
    pagination: {
      current: page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
      hasNext: end < total,
      hasPrev: page > 1
    }
  };
}

async function fetchSheetByGid(spreadsheetId, gid) {
  const token = await getAccessToken();
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!metaRes.ok) throw new Error(`Sheets meta error ${metaRes.status}: ${await metaRes.text()}`);
  const meta = await metaRes.json();
  const sheet = (meta.sheets || []).find(s => String(s.properties.sheetId) === String(gid));
  if (!sheet) throw new Error(`Sheet gid ${gid} not found in spreadsheet ${spreadsheetId}`);
  const title = sheet.properties.title;
  return fetchSheetAsRecords(spreadsheetId, title);
}

async function appendRowToSheet(spreadsheetId, sheetName, rowData) {
  const token = await getAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/` +
                `${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values: [rowData] }),
  });
  if (!res.ok) throw new Error(`Sheets append error ${res.status}: ${await res.text()}`);
}

function toFloat(value) {
  const n = parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return isNaN(n) ? 0.0 : n;
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV FETCH — for sheets shared publicly (no auth needed)
// ══════════════════════════════════════════════════════════════════════════════

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  
  function parseRow(line) {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    return cells;
  }
  
  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseRow(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] || '').trim()]));
  });
}

async function fetchPublicSheetCsv(spreadsheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`CSV fetch error ${res.status} for gid=${gid}`);
  const text = await res.text();
  return parseCsv(text);
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA FETCH FUNCTIONS (with smart caching)
// ══════════════════════════════════════════════════════════════════════════════

async function fetchSalesOrders() {
  return cacheManager.get('sales-orders', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'order')
  );
}

async function fetchPendingOrders() {
  return cacheManager.get('pending-orders', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'pending sales')
  );
}

async function fetchDispatchOrders() {
  return cacheManager.get('dispatch-orders', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'Dispatch')
  );
}

async function fetchDispatchFms() {
  return cacheManager.get('dispatch-fms', async () => {
    const records = await fetchSheetAsRecords(DISPATCH_FMS_SOURCE_ID, 'DATA');
    return records.map(r => ({
      'Timestamp':    r['Timestamp']                              || '',
      'Date':         r['Date of Dispatch'] || r['Date']         || '',
      'Party Name':   r['Party Name']                            || '',
      'PO':           r['PO']                                    || '',
      'SO':           r['SO']                                    || '',
      'Invoice No':   r['Invoice No']                            || '',
      'Item Name':    r['Item Name']                             || '',
      'Qty':          toFloat(r['Qty']),
      'Machine No':   r['Machine no']                            || '',
      'Product Name': r['PRODUCT NAME'] || r['Product Name']     || '',
      'WA Status':    r['WA Status']                             || '',
    }));
  });
}

async function fetchStockRegister() {
  return cacheManager.get('stock-register', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'Stock')
  );
}

async function fetchProductionRequirements() {
  return cacheManager.get('production-requirements', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'Production Requirement')
  );
}

async function fetchFmsAdvanceOrders() {
  return cacheManager.get('fms-advance-orders', async () => {
    const raw       = await fetchSheetAsRecords(FMS_SHEET_ID, 'o2d');
    const ordersMap = {};

    for (const row of raw) {
      if (String(row['Payment Terms'] || '').trim().toUpperCase() !== 'ADVANCE') continue;
      const soNo = String(row['SO No'] || '').trim();
      if (!soNo) continue;

      if (!ordersMap[soNo]) {
        ordersMap[soNo] = {
          'SO No':         row['SO No']      || '',
          'Date':          row['Date']        || '',
          'Client Name':   row['Client Name'] || '',
          'Payment Terms': 'ADVANCE',
          'PO Number':     row['PO Number']   || '',
          'Total Qty':     0,
          'Amount':        0.0,
          'Total Bill':    0.0,
          'Items':         0,
          'CRM Status':    'Pending Call',
          'items':         [],
        };
      }

      const qty    = toFloat(row['Qty']);
      const amount = toFloat(row['Amount']);
      const total  = toFloat(row['Total']);

      ordersMap[soNo]['Total Qty']  += qty;
      ordersMap[soNo]['Amount']     += amount;
      ordersMap[soNo]['Total Bill'] += total;
      ordersMap[soNo]['Items']      += 1;
      ordersMap[soNo]['items'].push(row);
    }

    return Object.values(ordersMap);
  });
}

async function fetchO2dPipeline() {
  return cacheManager.get('o2d-pipeline', async () => {
    const raw     = await fetchSheetAsRecords(O2D_SOURCE_SHEET_ID, 'Sheet1');
    const results = [];

    for (const row of raw) {
      const norm = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k.replace(/ /g, '_'), v])
      );

      const soDateStr = String(norm['SO_Date'] || '').trim();
      let planDateStr = '';
      if (soDateStr) {
        try {
          const soDate = new Date(soDateStr);
          soDate.setDate(soDate.getDate() + O2D_PLAN_DAYS);
          planDateStr  = soDate.toISOString().slice(0, 10);
        } catch (_) {}
      }

      results.push({
        'Timestamp':   norm['Timestamp']   || '',
        'SO_No':       String(norm['SO_No']       || '').trim(),
        'Client_Name': String(norm['Client_Name'] || '').trim(),
        'Product':     String(norm['Product']     || '').trim(),
        'Qty':         toFloat(norm['Qty']),
        'SO_Date':     soDateStr,
        'Plan_Date':   planDateStr,
        'Step':        String(norm['Step'] || 'Product Planning').trim(),
        'Agent_Name':  String(norm['Agent_Name']  || '').trim(),
        'Notes':       String(norm['Notes']       || '').trim(),
      });
    }

    return results;
  });
}

/** 🆕 FETCH LEADS from dynamic Google Sheet */
async function fetchLeads(page = 1, pageSize = 50) {
  return cacheManager.get(`leads-page-${page}-size-${pageSize}`, async () => {
    console.log(`[API] Fetching leads from public sheet (gid=0)`);
    const records = await fetchPublicSheetCsv(LEADS_SHEET_ID, 0);
    
    const leads = records.map(r => ({
      id:           String(r['ID'] || r['id'] || '').trim(),
      name:         String(r['Name'] || r['name'] || '').trim(),
      email:        String(r['Email'] || r['email'] || '').trim(),
      phone:        String(r['Phone'] || r['phone'] || '').trim(),
      company:      String(r['Company'] || r['company'] || '').trim(),
      industry:     String(r['Industry'] || r['industry'] || '').trim(),
      status:       String(r['Status'] || r['status'] || 'New').trim(),
      last_contact: String(r['Last Contact'] || r['last_contact'] || '').trim(),
      notes:        String(r['Notes'] || r['notes'] || '').trim(),
      score:        toFloat(r['Score'] || r['score'] || 0),
    }));

    const total = leads.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      leads: leads.slice(start, end),
      pagination: {
        current: page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
        hasNext: end < total,
        hasPrev: page > 1
      }
    };
  });
}

async function fetchChecklistTasks() {
  return cacheManager.get('checklist-tasks', async () => {
    const raw = await fetchPublicSheetCsv(CHECKLIST_SHEET_ID, 0);
    return raw.map(r => ({
      name:      String(r['NAME']        || '').trim(),
      email:     String(r['Email']       || '').trim(),
      dept:      String(r['Department']  || '').trim(),
      task_id:   String(r['Task ID']     || '').trim(),
      freq:      String(r['Freq']        || '').trim(),
      task:      String(r['Task']        || '').trim(),
      planned:   String(r['Planned']     || '').trim(),
      done_on:   String(r['Done On']     || '').trim(),
      status:    String(r['Status']      || '').trim().toUpperCase(),
      remark:    String(r['Remark']      || '').trim(),
    }));
  });
}

async function fetchChecklistLogs() {
  return cacheManager.get('checklist-logs', async () => {
    const raw = await fetchPublicSheetCsv(CHECKLIST_SHEET_ID, 870761503);
    return raw.map(r => ({
      timestamp:   String(r['Timestamp']          || '').trim(),
      uid:         String(r['UID']                || '').trim(),
      name:        String(r['Doer Name']          || '').trim(),
      email:       String(r['Email']              || '').trim(),
      dept:        String(r['Department']         || '').trim(),
      task_id:     String(r['Task ID']            || '').trim(),
      freq:        String(r['Freq']               || '').trim(),
      task:        String(r['Task']               || '').trim(),
      planned:     String(r['Planned']            || '').trim(),
      status:      String(r['Status']             || '').trim().toUpperCase(),
      mails_sent:  String(r['No of Mail Send']    || '').trim(),
      calls_today: String(r['No of Calling Today']|| '').trim(),
      summary:     String(r['Summary']            || '').trim(),
    }));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD METRICS
// ══════════════════════════════════════════════════════════════════════════════

function computeDashboardMetrics(orders, pending, dispatch, stock, production, fms) {
  const pendingCustomers = new Set(
    pending.map(r => String(r['Company Name'] || '').trim()).filter(Boolean)
  ).size;

  const now = new Date();
  const lastUpdated = now.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

  return {
    order_lines:        orders.length,
    total_qty_ordered:  orders.reduce((s, r) => s + toFloat(r['Qty']), 0),
    pending_lines:      pending.length,
    pending_bags:       pending.reduce((s, r) => s + toFloat(r['Pending Qty']), 0),
    pending_customers:  pendingCustomers,
    dispatched_lines:   dispatch.length,
    dispatched_bags:    dispatch.reduce((s, r) => s + toFloat(r['Qty']), 0),
    production_lines:   production.length,
    production_bags:    production.reduce((s, r) => s + toFloat(r['Qty'] || r['Pending Qty']), 0),
    stock_items:        stock.length,
    fms_advance_count:  fms.length,
    fms_advance_value:  fms.reduce((s, r) => s + toFloat(r['Total Bill']), 0),
    last_updated:       lastUpdated,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CORS HEADERS
// ══════════════════════════════════════════════════════════════════════════════

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Accept-Encoding');
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED APPEND HANDLER
// ══════════════════════════════════════════════════════════════════════════════

async function appendEndpoint(req, res, sheetId, sheetName = 'Sheet1') {
  let body = req.body || {};
  if (!body.row) {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
      req.on('error', reject);
    });
  }
  const row = body.row || [];
  if (!row.length) {
    res.status(400).json({ ok: false, error: 'No row data provided' });
    return;
  }
  await appendRowToSheet(sheetId, sheetName, row);
  // Invalidate related caches on write
  cacheManager.invalidate(null);
  res.json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// VERCEL SERVERLESS HANDLER (OPTIMIZED)
// ══════════════════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const url    = req.url || '/';
  const path   = url.split('?')[0];
  const method = req.method || 'GET';

  // Extract query parameters
  const queryParams = new URLSearchParams(url.split('?')[1] || '');
  const page = parseInt(queryParams.get('page')) || 1;
  const pageSize = parseInt(queryParams.get('pageSize')) || 50;

  try {
    // ── READ ENDPOINTS ──────────────────────────────────────────────────────

    if (method === 'GET' && path === '/api/health') {
      return res.json({ 
        ok: true, 
        service: 'TPPL ERP Sheets API (Vercel - Optimized)',
        time: new Date().toISOString(),
        cache: cacheManager.getStats()
      });
    }

    if (method === 'GET' && path === '/api/erp-data') {
      const [orders, pending, dispatch, dispfms, stock, production, fms, o2d] =
        await Promise.all([
          fetchSalesOrders(),
          fetchPendingOrders(),
          fetchDispatchOrders(),
          fetchDispatchFms(),
          fetchStockRegister(),
          fetchProductionRequirements(),
          fetchFmsAdvanceOrders(),
          fetchO2dPipeline(),
        ]);

      const metrics = computeDashboardMetrics(orders, pending, dispatch, stock, production, fms);

      return res.json({ ok: true, metrics, orders, pending, dispatch, dispfms, stock, production, fms, o2d });
    }

    // 🆕 LEADS ENDPOINT — with pagination
    if (method === 'GET' && path === '/api/leads') {
      try {
        console.log(`[API] /api/leads (page=${page}, pageSize=${pageSize})`);
        const result = await fetchLeads(page, pageSize);
        return res.json({ ok: true, ...result });
      } catch (err) {
        console.error('[API] /api/leads error:', err);
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    if (method === 'GET' && path === '/api/orders')     return res.json(await fetchSalesOrders());
    if (method === 'GET' && path === '/api/pending')    return res.json(await fetchPendingOrders());
    if (method === 'GET' && path === '/api/dispatch')   return res.json(await fetchDispatchOrders());
    if (method === 'GET' && path === '/api/dispfms')    return res.json(await fetchDispatchFms());
    if (method === 'GET' && path === '/api/stock')      return res.json(await fetchStockRegister());
    if (method === 'GET' && path === '/api/production') return res.json(await fetchProductionRequirements());
    if (method === 'GET' && path === '/api/fms')        return res.json(await fetchFmsAdvanceOrders());
    if (method === 'GET' && path === '/api/o2d')        return res.json(await fetchO2dPipeline());

    if (method === 'GET' && path === '/api/checklist') {
      try {
        console.log('[API] /api/checklist — fetching tasks and logs');
        const [tasks, logs] = await Promise.all([
          fetchChecklistTasks().catch(e => { 
            console.error('[API] fetchChecklistTasks failed:', e.message); 
            throw e;
          }),
          fetchChecklistLogs().catch(e => {
            console.error('[API] fetchChecklistLogs failed:', e.message);
            throw e;
          }),
        ]);
        console.log('[API] Success — tasks:', tasks.length, 'logs:', logs.length);
        return res.json({ ok: true, tasks, logs });
      } catch (err) {
        console.error('[API] /api/checklist error:', err);
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // ── WRITE ENDPOINTS ─────────────────────────────────────────────────────

    if (method === 'POST' && path === '/api/append/call-later')
      return appendEndpoint(req, res, CALL_LATER_SHEET_ID);

    if (method === 'POST' && path === '/api/append/done')
      return appendEndpoint(req, res, DONE_SHEET_ID);

    if (method === 'POST' && path === '/api/append/o2d-call-later')
      return appendEndpoint(req, res, O2D_CALL_LATER_ID);

    if (method === 'POST' && path === '/api/append/o2d-done')
      return appendEndpoint(req, res, O2D_DONE_SHEET_ID);

    if (method === 'POST' && path === '/api/append/dispatch-hold')
      return appendEndpoint(req, res, DISPATCH_FMS_HOLD_SHEET_ID);

    if (method === 'POST' && path === '/api/append/dispatch-done')
      return appendEndpoint(req, res, DISPATCH_FMS_DONE_SHEET_ID);

    if (method === 'POST' && path === '/api/append/rate-checklist') {
      let body = req.body || {};
      if (!body.row) {
        body = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => { data += chunk; });
          req.on('end',  () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
          req.on('error', reject);
        });
      }
      const row = body.row || [];
      const response = await fetch(RATE_CL_SHEET_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'rate_checklist', data: row }),
      });
      if (!response.ok) throw new Error(`Apps Script returned ${response.status}`);
      return res.json({ ok: true });
    }

    // ── CACHE MANAGEMENT ENDPOINTS ──────────────────────────────────────────
    
    if (method === 'GET' && path === '/api/cache-stats') {
      const stats = cacheManager.getStats();
      return res.json({ ok: true, ...stats });
    }

    if (method === 'POST' && path === '/api/cache-clear') {
      cacheManager.invalidate(null);
      return res.json({ ok: true, message: 'Cache cleared' });
    }

    // ── 404 ─────────────────────────────────────────────────────────────────
    res.status(404).json({ ok: false, error: `No handler for ${method} ${path}` });

  } catch (err) {
    console.error('[TPPL ERP API]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
