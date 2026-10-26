# Monitoring Service — Task 4

Real-time monitoring and observability for the **Multi-Tenant Distributed Workflow Saga Orchestration Engine**.

---

## Architecture

```
monitoring/
├── src/
│   ├── server.js            # HTTP + WebSocket server (port 4000)
│   ├── health/
│   │   └── checker.js       # Health checks: API, MongoDB, workers, DNS
│   ├── metrics/
│   │   └── collector.js     # CPU, memory, and per-tenant workflow metrics
│   ├── alerts/
│   │   └── engine.js        # 6 alert rules with state-change deduplication
│   ├── websocket/
│   │   └── hub.js           # WS hub + MongoDB change stream broadcasts
│   └── routes/
│       ├── health.js        # GET /health, /health/:service
│       ├── metrics.js       # GET /metrics, /metrics/:tenantId
│       ├── alerts.js        # GET /alerts, /alerts/history
│       └── status.js        # GET /api/status (combined dashboard payload)
├── tests/
│   ├── health.test.js       # Unit tests (offline, no server needed)
│   ├── alerts.test.js       # Unit tests (offline, no server needed)
│   ├── metrics.test.js      # Unit tests (offline, no server needed)
│   └── websocket.test.js    # Integration tests (server must be running)
├── scripts/
│   └── smoke-test.ps1       # Windows PowerShell smoke-test script
├── k8s/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── monitoring-deployment.yaml
│   └── monitoring-service.yaml
├── Dockerfile
├── .env.example
└── README.md                ← you are here
```

---

## Quick Start (Local)

### Prerequisites
- Node.js ≥ 20
- Backend already running on port 5000 (optional but recommended)

### 1. Install dependencies
```powershell
cd monitoring
npm install
```

### 2. Create `.env`
```powershell
Copy-Item .env.example .env
# Edit .env and fill in your MONGODB_URI
```

`.env` contents:
```
PORT=4000
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/
BACKEND_URL=http://localhost:5000
HEALTH_CHECK_INTERVAL=30
CPU_ALERT_THRESHOLD=80
MEMORY_ALERT_THRESHOLD=85
FAILURE_RATE_THRESHOLD=30
WORKER_STALL_MINUTES=10
```

### 3. Start
```powershell
node src/server.js
# or for development with auto-reload:
npx nodemon src/server.js
```

---

## API Reference

All endpoints return JSON.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service ping |
| GET | `/health` | All service health (overall + per-service array) |
| GET | `/health/:service` | Single service: `api`, `mongodb`, `workers`, `mongodb-dns` |
| GET | `/metrics` | System CPU/memory + all tenant workflow counts |
| GET | `/metrics/:tenantId` | Workflow metrics scoped to one `companyId` |
| GET | `/alerts` | Currently active alerts |
| GET | `/alerts/history` | Last 100 fired alerts |
| GET | `/api/status` | Combined dashboard payload (health + metrics + alerts) |

### Example: GET /health
```json
{
  "overall": "healthy",
  "checkedAt": "2026-10-20T05:32:00.000Z",
  "services": [
    { "name": "api",        "status": "healthy", "latencyMs": 12,  "detail": "HTTP 200" },
    { "name": "mongodb",    "status": "healthy", "latencyMs": 3,   "detail": "readyState=1" },
    { "name": "workers",    "status": "healthy", "latencyMs": 45,  "detail": "running=0, stalled_>10min=0" },
    { "name": "mongodb-dns","status": "healthy", "latencyMs": 22,  "detail": "resolved workflow-engine.bggwuip.mongodb.net" }
  ]
}
```

---

## WebSocket Real-Time Event Feed (Subtask 2)

Connect to `ws://localhost:4000` or `ws://localhost:4000/ws`.

### Authentication
Every connection requires server-side authentication via upgrade headers or query parameters:
1. **API Key (Admin / All-Tenant Access)**:
   - Header: `X-Monitoring-Key: <MONITORING_API_KEY>`
   - Query: `ws://localhost:4000/?apiKey=<MONITORING_API_KEY>`
2. **JWT (Tenant Isolated Access)**:
   - Header: `Authorization: Bearer <jwt_token>`
   - Query: `ws://localhost:4000/?token=<jwt_token>`
   - Subprotocol: `Sec-WebSocket-Protocol: Bearer, <jwt_token>`
   - Tenant identity is derived server-side from `payload.companyId` or `payload.tenantId`.
   - Cross-tenant subscription attempts are automatically rejected with close code `4003`.

### Versioned Event Envelope
All messages adhere to version 1 JSON envelope:
```json
{
  "v": "1",
  "type": "WORKFLOW_STEP_SUCCESS",
  "ts": "2026-10-26T14:09:28.935Z",
  "seq": 4,
  "severity": "info",
  "tenantId": "tenant-alpha",
  "payload": {
    "workflowId": "wf-saga-001",
    "workflowName": "PaymentSaga",
    "stepIndex": 0,
    "stepName": "ChargeCard",
    "stepStatus": "success"
  }
}
```

### Supported Event Types
| Event Type | Category | Severity | Description |
|---|---|---|---|
| `CONNECTED` | Connection | `info` | Handshake acknowledgment containing tenant scope |
| `SNAPSHOT` | Snapshot | `info` | Fresh authorized snapshot on connect (`seq: 0`) |
| `WORKFLOW_STARTED` | Saga Lifecycle | `info` | Workflow transitioned to `running` |
| `WORKFLOW_STEP_RUNNING` | Saga Lifecycle | `info` | Step execution initiated |
| `WORKFLOW_STEP_SUCCESS` | Saga Lifecycle | `info` | Step completed successfully |
| `WORKFLOW_STEP_FAILED` | Saga Lifecycle | `warn` | Step encountered an execution error |
| `WORKFLOW_STEP_RETRY` | Saga Lifecycle | `warn` | Step retry attempt initiated |
| `WORKFLOW_STEP_RETRY_SUCCESS`| Saga Lifecycle | `info` | Step succeeded after retry |
| `WORKFLOW_COMPENSATING` | Saga Lifecycle | `warn` | Rollback/compensation in progress (`rolled back`) |
| `WORKFLOW_COMPENSATION_FAILED`| Saga Lifecycle| `error` | Compensation encountered a failure |
| `WORKFLOW_FAILED` | Saga Lifecycle | `error` | Workflow failed (compensated or uncompensated) |
| `WORKFLOW_COMPLETED` | Saga Lifecycle | `info` | All steps succeeded |
| `SYSTEM_HEALTH` | Infrastructure | `info` | Health check results across all dependencies |
| `METRICS_UPDATE` | Infrastructure | `info` | CPU, memory, and workflow throughput metrics |
| `WORKER_AVAILABILITY` | Infrastructure | `info`/`warn` | Real worker stall / liveness status |
| `QUEUE_BACKLOG` | Infrastructure | `info`/`warn` | Real pending workflow queue backlog count |
| `DEPENDENCY_HEALTH` | Infrastructure | `info`/`error` | Database, DNS, and API dependency health |
| `ALERT_FIRED` | Alerting | `warn`/`error` | Alert rule condition triggered |

### Change Streams & Graceful Fallback
- **MongoDB Change Streams**: Real-time push directly from replica set oplog with sub-10ms delivery latency.
- **Graceful Fallback**: On standalone MongoDB instances or change stream errors, the hub automatically activates bounded polling every 5s (`WS_POLL_INTERVAL_MS`).
- **Trade-off**: Polling introduces up to 5s delivery latency and periodic read queries, but guarantees resilience across any MongoDB setup without crashing.
- **Saga Adapter**: The non-invasive `sagaAdapter` (`src/websocket/adapter.js`) provides direct dispatch from the engine, wrapping delivery in try/catch so monitoring issues never interrupt saga orchestration.

### Browser Test
```js
const token = 'your-jwt-token';
const ws = new WebSocket(`ws://localhost:4000/?token=${token}`);
ws.onmessage = (e) => console.log('Event received:', JSON.parse(e.data));
```

---

## Alert Rules

| Key | Severity | Condition |
|-----|----------|-----------|
| `API_DOWN` | critical | Backend API `/` returns non-2xx or times out |
| `DB_DOWN` | critical | `mongoose.connection.readyState !== 1` |
| `HIGH_CPU` | warning | CPU usage > `CPU_ALERT_THRESHOLD` (default 80%) |
| `HIGH_MEMORY` | warning | Memory usage > `MEMORY_ALERT_THRESHOLD` (default 85%) |
| `WORKFLOW_FAILURE_SPIKE` | critical | Failure rate in last 60 min > `FAILURE_RATE_THRESHOLD` (default 30%) |
| `WORKER_STALLED` | warning | Any workflow stuck in `running` for > `WORKER_STALL_MINUTES` (default 10 min) |

Alerts only fire on **state change** (no repeated spam). They auto-clear when the condition resolves.

---

## Prometheus & Grafana Observability (Subtask 3)

### Prometheus Exposition Endpoint
- **URL**: `http://localhost:4000/metrics` (or `http://localhost:4000/metrics/prometheus`)
- **Format**: `text/plain; version=0.0.4; charset=utf-8` (OpenMetrics compatible)
- **Content Negotiation**: Returns Prometheus text format when requested by Prometheus (`Accept: text/plain` or `?format=prometheus`), and preserves existing JSON format for JSON clients.
- **Cardinality Safety**: Enforces strict allowlists; drops unbounded labels (`workflow_id`, `user_id`, `request_id`).

### Exact Metric Names
| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests handled |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP request latency duration |
| `workflow_lifecycle_total` | Counter | `status` | Total workflow state transitions |
| `workflow_execution_duration_seconds`| Histogram | `status` | Workflow execution duration |
| `workflow_step_retries_total` | Counter | None | Total step execution retry attempts |
| `workflow_compensation_attempts_total`| Counter | None | Total saga compensation routines initiated |
| `workflow_compensation_failures_total`| Counter | None | Total saga compensation routines failed |
| `worker_availability_status` | Gauge | None | Worker status (1=healthy, 0.5=degraded, 0=down) |
| `workflow_queue_depth` | Gauge | None | Number of pending workflows queued in DB |
| `health_check_failures_total` | Counter | `service` | Total failed health checks by service |
| `database_connection_status` | Gauge | None | MongoDB readyState (1=connected, 0=down) |
| `websocket_active_connections`| Gauge | None | Active WebSocket dashboard connections |
| `websocket_delivery_failures_total`| Counter | None | WebSocket event delivery errors |
| `system_cpu_usage_percent` | Gauge | None | Current CPU load percent (0-100) |
| `system_memory_usage_percent` | Gauge | None | Current memory usage percent (0-100) |
| `system_memory_used_bytes` | Gauge | None | Memory used in bytes |
| `system_memory_total_bytes` | Gauge | None | Total system memory in bytes |
| `workflow_metrics_last_collected_timestamp_seconds`| Gauge | None | Timestamp of last metrics collection |
| `process_uptime_seconds` | Gauge | None | Monitoring service uptime in seconds |

### Prometheus & Grafana Stack URLs
- **Prometheus UI**: `http://localhost:9090`
- **Grafana UI**: `http://localhost:3000` (credentials: `admin` / `admin`)
- **Dashboard**: `http://localhost:3000/d/saga-engine-overview/multi-tenant-saga-engine-monitoring`

### Configuration Files
- **Prometheus Scrape Config**: [`monitoring/prometheus/prometheus.yml`](prometheus/prometheus.yml)
- **Prometheus Alert Rules**: [`monitoring/alerts/alert_rules.yml`](alerts/alert_rules.yml) (10 actionable alerts)
- **Alertmanager Config**: [`monitoring/alerts/alert_manager_config.yml`](alerts/alert_manager_config.yml) (safe environment variable substitution)
- **Grafana Datasource**: [`monitoring/grafana/provisioning/datasources/prometheus.yml`](grafana/provisioning/datasources/prometheus.yml)
- **Grafana Dashboard Provider**: [`monitoring/grafana/provisioning/dashboards/dashboards.yml`](grafana/provisioning/dashboards/dashboards.yml)
- **Grafana Dashboard Definition**: [`monitoring/grafana/dashboards/saga_engine_overview.json`](grafana/dashboards/saga_engine_overview.json)

---

## Running Tests

### All Tests (Unit + Integration)
```powershell
cd Monitoring
npm test
```
Runs 81 tests across 6 suites:
- `tests/health.test.js` (14 tests)
- `tests/metrics.test.js` (8 tests)
- `tests/alerts.test.js` (11 tests)
- `tests/security.test.js` (14 tests)
- `tests/websocket.test.js` (17 tests)
- `tests/prometheus.test.js` (17 tests)

### Smoke tests (server must be running)
```powershell
# Start the server first, then:
pwsh monitoring/scripts/smoke-test.ps1
```

---

## Docker Deployment

```powershell
# From repo root — builds both backend and monitoring
docker compose up --build

# To run monitoring only (backend must be accessible at BACKEND_URL):
docker build -t workflow-engine-monitoring ./monitoring
docker run -p 4000:4000 --env-file ./backend/.env workflow-engine-monitoring
```

---

## Kubernetes Deployment

```powershell
# 1. Create namespace
kubectl apply -f monitoring/k8s/namespace.yaml

# 2. Create ConfigMap
kubectl apply -f monitoring/k8s/configmap.yaml

# 3. Create Secret (edit secret.yaml with base64-encoded MONGODB_URI first!)
#    Encode URI: [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("mongodb+srv://..."))
kubectl apply -f monitoring/k8s/secret.yaml

# 4. Deploy
kubectl apply -f monitoring/k8s/monitoring-deployment.yaml
kubectl apply -f monitoring/k8s/monitoring-service.yaml

# 5. Verify
kubectl get pods -n workflow-engine
kubectl logs -n workflow-engine deployment/monitoring-deployment
```

---

## Tenant Isolation

- `GET /metrics/:tenantId` — scopes workflow metrics to a single `companyId`
- `WORKFLOW_EVENT` WebSocket messages include `companyId` so clients can filter by tenant
- All MongoDB queries group by `companyId` — no cross-tenant data leakage

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `MONGODB_URI is not set` on start | Missing `.env` | Copy `.env.example` → `.env` and fill in URI |
| `MongoDB connection failed` | Wrong URI or network | Check Atlas IP whitelist, verify URI format |
| `/health` returns `api: down` | Backend not running on `BACKEND_URL` | Start backend with `cd backend && npm start` |
| `/metrics` returns 503 | First poll not yet complete | Wait 5–10s and retry |
| WebSocket test timeout | Server not running | Start server before running WS tests |
| `WORKER_STALLED` alert fires unexpectedly | Workflow stuck in DB | Check `Workflow.find({status:"running"})` in MongoDB Atlas |
| Docker `depends_on` never satisfied | Backend healthcheck failing | Check `docker logs workflow-backend` for startup errors |
| K8s pods crashloop | Missing secret | Ensure `secret.yaml` has valid base64-encoded `MONGODB_URI` |
