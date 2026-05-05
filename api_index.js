'use strict';

/**
 * TPPL ERP — Vercel Serverless API Handler
 * =========================================
 * This file replaces the Express listen() call for Vercel deployment.
 * Vercel routes all /api/* requests here via vercel.json rewrites.
 *
 * ENV VARS required in Vercel project settings:
 *   GOOGLE_CLIENT_EMAIL   — client_email from service_account.json
 *   GOOGLE_PRIVATE_KEY    — private_key  from service_account.json (with real \n)
 */

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
// DATA FETCH FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

async function fetchSalesOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'order');
}

async function fetchPendingOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'pending sales');
}

async function fetchDispatchOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Dispatch');
}

async function fetchDispatchFms() {
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
}

async function fetchStockRegister() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Stock');
}

async function fetchProductionRequirements() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Production Requirement');
}

async function fetchFmsAdvanceOrders() {
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
}

async function fetchO2dPipeline() {
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
}


// ══════════════════════════════════════════════════════════════════════════════
// CHECKLIST SHEET FETCHERS
// ══════════════════════════════════════════════════════════════════════════════

/** Task definitions — fetched via public CSV export (gid=0, Sheet1) */
async function fetchChecklistTasks() {
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
}

/** Activity log — fetched via public CSV export (gid=870761503, Sheet2) */
async function fetchChecklistLogs() {
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
}


// ══════════════════════════════════════════════════════════════════════════════
// CSV FETCH — for sheets shared publicly (no service account needed)
// ══════════════════════════════════════════════════════════════════════════════

/** Parse a CSV string into array of objects (header row → keys) */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  // Simple CSV parser — handles quoted fields
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

/** Fetch a Google Sheet tab as records via public CSV export (no auth required).
 *  The sheet must be shared as "Anyone with the link can view". */
async function fetchPublicSheetCsv(spreadsheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`CSV fetch error ${res.status} for gid=${gid} — make sure sheet is shared publicly`);
  const text = await res.text();
  return parseCsv(text);
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
// CORS HEADERS  (required for Vercel — browser fetches from different origin)
// ══════════════════════════════════════════════════════════════════════════════

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED APPEND HANDLER
// ══════════════════════════════════════════════════════════════════════════════

async function appendEndpoint(req, res, sheetId, sheetName = 'Sheet1') {
  let body = req.body || {};
  // Vercel doesn't parse body automatically — handle raw stream
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
  res.json({ ok: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// VERCEL SERVERLESS HANDLER  (replaces app.listen)
// ══════════════════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const url    = req.url || '/';
  // Strip query string for routing
  const path   = url.split('?')[0];
  const method = req.method || 'GET';

  try {
    // ── READ ENDPOINTS ──────────────────────────────────────────────────────

    if (method === 'GET' && path === '/api/health') {
      return res.json({ ok: true, service: 'TPPL ERP Sheets API (Vercel)', time: new Date().toISOString() });
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

    if (method === 'GET' && path === '/api/orders')     return res.json(await fetchSalesOrders());
    if (method === 'GET' && path === '/api/pending')    return res.json(await fetchPendingOrders());
    if (method === 'GET' && path === '/api/dispatch')   return res.json(await fetchDispatchOrders());
    if (method === 'GET' && path === '/api/dispfms')    return res.json(await fetchDispatchFms());
    if (method === 'GET' && path === '/api/stock')      return res.json(await fetchStockRegister());
    if (method === 'GET' && path === '/api/production') return res.json(await fetchProductionRequirements());
    if (method === 'GET' && path === '/api/fms')        return res.json(await fetchFmsAdvanceOrders());
    if (method === 'GET' && path === '/api/o2d')        return res.json(await fetchO2dPipeline());
    if (method === 'GET' && path === '/api/checklist')  {
      try {
        console.log('[API] /api/checklist — fetching tasks and logs from public CSV');
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

    // ── 404 ─────────────────────────────────────────────────────────────────
    res.status(404).json({ ok: false, error: `No handler for ${method} ${path}` });

  } catch (err) {
    console.error('[TPPL ERP API]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
