const assert = require('assert');
const http = require('http');

const API_BASE = 'http://localhost:5000';
const TENANT_A_KEY = 'wf_3c5cf0ccd3088b2f4ab4b19bd57c153971d7eb63b6b92245';
const TENANT_B_KEY = 'wf_tenant_b_isolated_key_999888777666555444333222';
const INVALID_KEY = 'wf_completely_fake_invalid_key_0000000000000000000000';

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const reqOptions = {
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = http.request(url, reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authentication Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Missing authentication header returns 401', async () => {
    const res = await request('/api/stats/summary');
    assert.strictEqual(res.status, 401, 'Expected 401 for missing credentials');
    assert.strictEqual(res.body.message, 'Missing credentials');
});

test('Invalid API key returns 401', async () => {
    const res = await request('/api/stats/summary', {
        headers: { 'x-api-key': INVALID_KEY }
    });
    assert.strictEqual(res.status, 401, 'Expected 401 for invalid API key');
    assert.strictEqual(res.body.message, 'Invalid API key');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tenant A Access and Summary Statistics
// ─────────────────────────────────────────────────────────────────────────────

test('Tenant A can access GET /api/stats/summary with correct fields', async () => {
    const res = await request('/api/stats/summary', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert.strictEqual(typeof d.total, 'number');
    assert.strictEqual(typeof d.success, 'number');
    assert.strictEqual(typeof d.failed, 'number');
    assert.strictEqual(typeof d.running, 'number');
    assert.strictEqual(typeof d.successRate, 'number');
    assert.strictEqual(typeof d.failureRate, 'number');
    assert.strictEqual(d.total, 30, 'Tenant A should have exactly 30 total executions');
    assert.strictEqual(d.success, 18, 'Tenant A should have exactly 18 successful executions');
    assert(d.failed >= 10, 'Tenant A should have at least 10 failed/compensated executions');
    assert.strictEqual(d.failed + d.running, 12, 'Tenant A should have 12 non-successful executions');
    assert.strictEqual(d.successRate, 60.0);
    assert.strictEqual(d.failureRate, parseFloat(((d.failed / d.total) * 100).toFixed(2)));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tenant A Failure Statistics
// ─────────────────────────────────────────────────────────────────────────────

test('Tenant A can access GET /api/stats/failures with full analytics', async () => {
    const res = await request('/api/stats/failures', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert(Array.isArray(d.failuresByTime), 'failuresByTime must be array');
    assert(Array.isArray(d.failuresByStatus), 'failuresByStatus must be array');
    assert(Array.isArray(d.failuresByWorkflow), 'failuresByWorkflow must be array');
    assert(Array.isArray(d.failuresByStep), 'failuresByStep must be array');
    assert(Array.isArray(d.stepRetryStats), 'stepRetryStats must be array');
    assert(Array.isArray(d.failureHeatmap), 'failureHeatmap must be array');

    assert(d.failuresByTime.length > 0, 'Should have failures grouped by time');
    assert(d.stepRetryStats.length > 0, 'Should have step retry statistics');
    const paymentRetry = d.stepRetryStats.find(s => s.stepName === 'ProcessPayment');
    assert(paymentRetry, 'ProcessPayment step retries should be captured');
    assert(paymentRetry.totalRetries > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tenant A Latency Statistics
// ─────────────────────────────────────────────────────────────────────────────

test('Tenant A can access GET /api/stats/latency with durations and distribution', async () => {
    const res = await request('/api/stats/latency', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert.strictEqual(typeof d.avgDuration, 'number');
    assert.strictEqual(typeof d.minDuration, 'number');
    assert.strictEqual(typeof d.maxDuration, 'number');
    assert(d.minDuration > 0, 'minDuration should be > 0');
    assert(d.maxDuration >= d.minDuration, 'maxDuration should be >= minDuration');
    assert(Array.isArray(d.latencyTrend), 'latencyTrend must be array');
    assert(Array.isArray(d.durationDistribution), 'durationDistribution must be array');
    assert(d.durationDistribution.length > 0, 'durationDistribution should have buckets');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tenant A Quota Statistics
// ─────────────────────────────────────────────────────────────────────────────

test('Tenant A can access GET /api/stats/quota with accurate calculations', async () => {
    const res = await request('/api/stats/quota', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert.strictEqual(d.tenantName, 'Acme Corporation (Tenant A)');
    assert.strictEqual(d.totalQuota, 60);
    assert.strictEqual(d.maxRunsPerMinute, 60);
    assert.strictEqual(typeof d.usedQuota, 'number');
    assert.strictEqual(typeof d.remainingQuota, 'number');
    assert.strictEqual(typeof d.quotaUtilization, 'number');
    assert.strictEqual(d.totalExecutions, 30);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Tenant B Isolation & Cross-Tenant Access Prevention
// ─────────────────────────────────────────────────────────────────────────────

test('Tenant B accesses its own independent statistics (Tenant Isolation)', async () => {
    const res = await request('/api/stats/summary', {
        headers: { 'x-api-key': TENANT_B_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert.strictEqual(d.total, 10, 'Tenant B must only see its own 10 executions');
    assert.strictEqual(d.success, 5, 'Tenant B has 5 successful executions');
    assert.strictEqual(d.failed, 5, 'Tenant B has 5 failed executions');
});

test('Tenant B quota reflects its own configured limit (30 runs/min)', async () => {
    const res = await request('/api/stats/quota', {
        headers: { 'x-api-key': TENANT_B_KEY }
    });
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    assert.strictEqual(d.tenantName, 'Beta Global (Tenant B)');
    assert.strictEqual(d.totalQuota, 30);
    assert.strictEqual(d.totalExecutions, 10);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Company ID Validation & Tamper Protection
// ─────────────────────────────────────────────────────────────────────────────

test('Invalid companyId format is rejected with 400 Bad Request', async () => {
    const res = await request('/api/stats/summary?companyId=not-a-valid-object-id', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert(res.body.message.includes('Invalid company ID format'));
});

test('Tenant A attempting to query Tenant B companyId is rejected with 403 Forbidden', async () => {
    // First get Tenant B ID via Tenant B call
    const compBRes = await request('/api/stats/companies', {
        headers: { 'x-api-key': TENANT_B_KEY }
    });
    const tenantBId = compBRes.body.data[0].id;

    // Tenant A tries to access Tenant B's companyId
    const res = await request(`/api/stats/summary?companyId=${tenantBId}`, {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 403, 'Cross-tenant company access must return 403 Forbidden');
    assert.strictEqual(res.body.success, false);
    assert(res.body.message.includes('does not belong to authenticated tenant'));
});

test('Tenant A querying with its own authorized companyId succeeds', async () => {
    const compARes = await request('/api/stats/companies', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    const tenantAId = compARes.body.data[0].id;

    const res = await request(`/api/stats/summary?companyId=${tenantAId}`, {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.total, 30);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Date Range Filtering Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Date filters narrow results accurately', async () => {
    // Filter for future dates where no executions exist
    const futureRes = await request('/api/stats/summary?startDate=2030-01-01&endDate=2030-01-02', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(futureRes.status, 200);
    assert.strictEqual(futureRes.body.data.total, 0, 'Future range must yield 0 executions');
    assert.strictEqual(futureRes.body.data.successRate, 0);

    // Filter for invalid date string returns 400
    const invalidDateRes = await request('/api/stats/summary?startDate=invalid-date', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(invalidDateRes.status, 400);
    assert.strictEqual(invalidDateRes.body.message, 'Invalid date format');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Empty Dataset Graceful Handling
// ─────────────────────────────────────────────────────────────────────────────

test('Empty dataset returns zero-value statistics gracefully across all endpoints', async () => {
    const futureRange = 'startDate=2035-01-01&endDate=2035-01-02';

    const [summary, failures, latency] = await Promise.all([
        request(`/api/stats/summary?${futureRange}`, { headers: { 'x-api-key': TENANT_A_KEY } }),
        request(`/api/stats/failures?${futureRange}`, { headers: { 'x-api-key': TENANT_A_KEY } }),
        request(`/api/stats/latency?${futureRange}`, { headers: { 'x-api-key': TENANT_A_KEY } })
    ]);

    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.body.data.total, 0);
    assert.strictEqual(summary.body.data.success, 0);
    assert.strictEqual(summary.body.data.successRate, 0);

    assert.strictEqual(failures.status, 200);
    assert.deepStrictEqual(failures.body.data.failuresByTime, []);
    assert.deepStrictEqual(failures.body.data.failuresByStatus, []);

    assert.strictEqual(latency.status, 200);
    assert.strictEqual(latency.body.data.avgDuration, 0);
    assert.strictEqual(latency.body.data.minDuration, 0);
    assert.deepStrictEqual(latency.body.data.latencyTrend, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Dead-Letter Statistics Tests (/api/stats/deadletters)
// ─────────────────────────────────────────────────────────────────────────────

test('Missing credentials on /api/stats/deadletters returns 401', async () => {
    const res = await request('/api/stats/deadletters');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.message, 'Missing credentials');
});

test('Invalid API key on /api/stats/deadletters returns 401', async () => {
    const res = await request('/api/stats/deadletters', {
        headers: { 'x-api-key': INVALID_KEY }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.message, 'Invalid API key');
});

test('Invalid companyId format on /api/stats/deadletters returns 400 Bad Request', async () => {
    const res = await request('/api/stats/deadletters?companyId=not-valid-id', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert(res.body.message.includes('Invalid company ID format'));
});

test('Tenant A attempting to query Tenant B companyId on /api/stats/deadletters returns 403 Forbidden', async () => {
    const compBRes = await request('/api/stats/companies', {
        headers: { 'x-api-key': TENANT_B_KEY }
    });
    const tenantBId = compBRes.body.data[0].id;

    const res = await request(`/api/stats/deadletters?companyId=${tenantBId}`, {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.success, false);
    assert(res.body.message.includes('does not belong to authenticated tenant'));
});

test('Tenant A querying its own deadletters succeeds with correct count structure', async () => {
    const res = await request('/api/stats/deadletters', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert.strictEqual(typeof d.open, 'number', 'open count must be number');
    assert.strictEqual(typeof d.replayed, 'number', 'replayed count must be number');
    assert.strictEqual(typeof d.discarded, 'number', 'discarded count must be number');
    assert.strictEqual(typeof d.total, 'number', 'total count must be number');
    assert.strictEqual(d.total, d.open + d.replayed + d.discarded, 'total must equal sum of open + replayed + discarded');
});

test('Tenant A deadletters returns reason breakdown array', async () => {
    const res = await request('/api/stats/deadletters', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    assert(Array.isArray(d.byReason), 'byReason must be an array');
    if (d.byReason.length > 0) {
        assert(typeof d.byReason[0].reason === 'string', 'reason must be string');
        assert(typeof d.byReason[0].count === 'number', 'count must be number');
    }
});

test('Tenant A deadletters returns recentOpen entries array', async () => {
    const res = await request('/api/stats/deadletters', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    assert(Array.isArray(d.recentOpen), 'recentOpen must be an array');
    if (d.recentOpen.length > 0) {
        assert(d.recentOpen[0].stepName !== undefined, 'entry must have stepName');
        assert(d.recentOpen[0].reason !== undefined, 'entry must have reason');
        assert(d.recentOpen[0].createdAt !== undefined, 'entry must have createdAt');
    }
});

test('Tenant B cross-tenant isolation: accesses only its own dead letters', async () => {
    const resA = await request('/api/stats/deadletters', { headers: { 'x-api-key': TENANT_A_KEY } });
    const resB = await request('/api/stats/deadletters', { headers: { 'x-api-key': TENANT_B_KEY } });
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
    // Tenant B's counts are independent
    assert(typeof resB.body.data.total === 'number');
    assert(typeof resB.body.data.open === 'number');
});

test('Future date range on /api/stats/deadletters returns zero counts and empty arrays gracefully', async () => {
    const futureRange = 'startDate=2035-01-01&endDate=2035-01-02';
    const res = await request(`/api/stats/deadletters?${futureRange}`, {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.total, 0);
    assert.strictEqual(res.body.data.open, 0);
    assert.strictEqual(res.body.data.replayed, 0);
    assert.strictEqual(res.body.data.discarded, 0);
    assert.deepStrictEqual(res.body.data.byReason, []);
    assert.deepStrictEqual(res.body.data.recentOpen, []);
});

test('Authorized tenant querying with its own companyId query param succeeds', async () => {
    const compARes = await request('/api/stats/companies', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    const tenantAId = compARes.body.data[0].id;

    const res = await request(`/api/stats/deadletters?companyId=${tenantAId}`, {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Quota Thresholds & Alerting Tests
// ─────────────────────────────────────────────────────────────────────────────

test('GET /api/stats/quota includes warningThreshold (80) and exceededThreshold (100)', async () => {
    const res = await request('/api/stats/quota', {
        headers: { 'x-api-key': TENANT_A_KEY }
    });
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    assert.strictEqual(d.warningThreshold, 80);
    assert.strictEqual(d.exceededThreshold, 100);
    assert(['normal', 'warning', 'exceeded'].includes(d.quotaStatus), `quotaStatus must be valid: got ${d.quotaStatus}`);
    assert.strictEqual(typeof d.isWarning, 'boolean');
    assert.strictEqual(typeof d.isExceeded, 'boolean');
});

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
    console.log(`\n========================================`);
    console.log(`RUNNING STATS API & TENANT ISOLATION TESTS`);
    console.log(`========================================\n`);

    let passed = 0;
    let failed = 0;

    for (const t of tests) {
        try {
            await t.fn();
            console.log(`[PASS] ${t.name}`);
            passed++;
        } catch (err) {
            console.error(`[FAIL] ${t.name}`);
            console.error(`       Error: ${err.message}`);
            if (err.stack) {
                console.error(`       Stack: ${err.stack.split('\n')[1]}`);
            }
            failed++;
        }
    }

    console.log(`\n========================================`);
    console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed out of ${tests.length} tests`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
    process.exit(0);
}

run();
