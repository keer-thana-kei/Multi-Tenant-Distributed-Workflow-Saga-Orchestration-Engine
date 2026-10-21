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

## WebSocket Events

Connect to `ws://localhost:4000`. All messages are JSON.

| Type | Trigger | Payload |
|------|---------|---------|
| `CONNECTED` | On connect | `{ type, ts, message }` |
| `HEALTH_UPDATE` | Every poll cycle | `{ type, ts, data: [ServiceHealth] }` |
| `METRICS_UPDATE` | Every poll cycle | `{ type, ts, data: MetricsObject }` |
| `ALERT_FIRED` | New alert state change | `{ type, ts, data: Alert }` |
| `WORKFLOW_EVENT` | MongoDB change stream | `{ type, ts, data: { operationType, workflowId, companyId, status } }` |

### Browser quick-test
```js
const ws = new WebSocket('ws://localhost:4000');
ws.onmessage = e => console.log(JSON.parse(e.data));
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

## Running Tests

### Unit tests (no server required)
```powershell
cd monitoring
npm install
node --test tests/health.test.js
node --test tests/alerts.test.js
node --test tests/metrics.test.js
# Or run all at once:
npm test
```

### Integration tests (server must be running)
```powershell
# In one terminal:
node src/server.js

# In another terminal:
node --test tests/websocket.test.js
```

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
