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
// 🔥 CACHING LAYER — PREVENTS QUOTA LIMIT ERRORS
// ══════════════════════════════════════════════════════════════════════════════

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes — adjust based on data freshness needs

/**
 * Wrap any async function with caching
 * @param {string} key - cache key
 * @param {Function} fetcher - async function that returns data
 * @returns {Promise} cached or fresh data
 */
async function withCache(key, fetcher) {
  const now = Date.now();
  
  // Check cache
  if (cache.has(key)) {
    const { data, timestamp } = cache.get(key);
    const age = now - timestamp;
    
    if (age < CACHE_TTL) {
      console.log(`[CACHE HIT] ${key} (${Math.round(age/1000)}s old)`);
      return data;
    } else {
      console.log(`[CACHE EXPIRED] ${key}`);
      cache.delete(key);
    }
  }

  // Fetch fresh data
  console.log(`[CACHE MISS] ${key} — fetching fresh data`);
  const data = await fetcher();
  
  // Store in cache
  cache.set(key, { data, timestamp: now });
  console.log(`[CACHE STORED] ${key}`);
  
  return data;
}

/**
 * Clear cache for a specific key (e.g., after write operations)
 */
function invalidateCache(key) {
  cache.delete(key);
  console.log(`[CACHE INVALIDATED] ${key}`);
}

/**
 * Clear all cache
 */
function clearAllCache() {
  cache.clear();
  console.log(`[CACHE CLEARED] All cache cleared`);
}

// ══════════════════════════════════════════════════════════════════════════════
// SHEET IDs
// ══════════════════════════════════════════════════════════════════════════════
@@ -149,161 +206,181 @@
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA FETCH FUNCTIONS
// DATA FETCH FUNCTIONS (with caching)
// ══════════════════════════════════════════════════════════════════════════════

async function fetchSalesOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'order');
  return withCache('sales-orders', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'order')
  );
}

async function fetchPendingOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'pending sales');
  return withCache('pending-orders', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'pending sales')
  );
}

async function fetchDispatchOrders() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Dispatch');
  return withCache('dispatch-orders', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'Dispatch')
  );
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
  return withCache('dispatch-fms', async () => {
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
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Stock');
  return withCache('stock-register', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'Stock')
  );
}

async function fetchProductionRequirements() {
  return fetchSheetAsRecords(SPREADSHEET_ID, 'Production Requirement');
  return withCache('production-requirements', () => 
    fetchSheetAsRecords(SPREADSHEET_ID, 'Production Requirement')
  );
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
  return withCache('fms-advance-orders', async () => {
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
      const qty    = toFloat(row['Qty']);
      const amount = toFloat(row['Amount']);
      const total  = toFloat(row['Total']);

    ordersMap[soNo]['Total Qty']  += qty;
    ordersMap[soNo]['Amount']     += amount;
    ordersMap[soNo]['Total Bill'] += total;
    ordersMap[soNo]['Items']      += 1;
    ordersMap[soNo]['items'].push(row);
  }
      ordersMap[soNo]['Total Qty']  += qty;
      ordersMap[soNo]['Amount']     += amount;
      ordersMap[soNo]['Total Bill'] += total;
      ordersMap[soNo]['Items']      += 1;
      ordersMap[soNo]['items'].push(row);
    }

  return Object.values(ordersMap);
    return Object.values(ordersMap);
  });
}

async function fetchO2dPipeline() {
  const raw     = await fetchSheetAsRecords(O2D_SOURCE_SHEET_ID, 'Sheet1');
  const results = [];

  for (const row of raw) {
    const norm = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.replace(/ /g, '_'), v])
    );
  return withCache('o2d-pipeline', async () => {
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

    const soDateStr = String(norm['SO_Date'] || '').trim();
    let planDateStr = '';
    if (soDateStr) {
      try {
        const soDate = new Date(soDateStr);
        soDate.setDate(soDate.getDate() + O2D_PLAN_DAYS);
        planDateStr  = soDate.toISOString().slice(0, 10);
      } catch (_) {}
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
    return results;
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// CHECKLIST SHEET FETCHERS
// CHECKLIST SHEET FETCHERS (with caching)
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
  return withCache('checklist-tasks', async () => {
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
  return withCache('checklist-logs', async () => {
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


@@ -524,11 +601,27 @@
      return res.json({ ok: true });
    }

    // ── CACHE MANAGEMENT ENDPOINTS ──────────────────────────────────────────
    
    if (method === 'GET' && path === '/api/cache-stats') {
      const stats = Array.from(cache.entries()).map(([key, { timestamp }]) => ({
        key,
        age_seconds: Math.round((Date.now() - timestamp) / 1000),
        ttl_seconds: Math.round(CACHE_TTL / 1000)
      }));
      return res.json({ ok: true, cache_size: cache.size, cache: stats });
    }

    if (method === 'POST' && path === '/api/cache-clear') {
      clearAllCache();
      return res.json({ ok: true, message: 'Cache cleared' });
    }

    // ── 404 ─────────────────────────────────────────────────────────────────
    res.status(404).json({ ok: false, error: `No handler for ${method} ${path}` });

  } catch (err) {
    console.error('[TPPL ERP API]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
