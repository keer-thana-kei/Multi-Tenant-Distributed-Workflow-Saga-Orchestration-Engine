# Monitoring & Observability Service — Multi-Tenant Workflow Saga Engine

Production-grade observability, telemetry collection, alerting, real-time WebSocket event streaming, Prometheus exposition, Grafana visualization, and container/Kubernetes orchestration for the **Multi-Tenant Distributed Workflow Saga Orchestration Engine**.

---

## 1. Discovered Architecture & Component Responsibilities

The monitoring stack operates as a dedicated microservice alongside the distributed saga orchestration engine, structured into decoupled subsystems:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SAGA ORCHESTRATION ENGINE                                      │
│                                                                                                  │
│   ┌─────────────────────────┐               ┌────────────────────────────────────────────────┐   │
│   │   Workflow Backend      │               │              MongoDB Database                  │   │
│   │   (Port 5000 / HTTP)    │               │  Workflows Collection (State & Change Stream)  │   │
│   └────────────┬────────────┘               └───────────────────────┬────────────────────────┘   │
└────────────────┼────────────────────────────────────────────────────┼────────────────────────────┘
                 │ (Health Probes)                                    │ (Change Stream / Polling)
┌────────────────┼────────────────────────────────────────────────────┼────────────────────────────┐
│                ▼                                                    ▼                            │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              MONITORING MICROSERVICE (Port 4000)                           │  │
│  │                                                                                            │  │
│  │   ┌─────────────────────┐   ┌─────────────────────┐   ┌────────────────────────────────┐   │  │
│  │   │   Health Checker    │   │  Metrics Collector  │   │         Alerting Engine        │   │  │
│  │   │  - /health/live     │   │  - Host CPU & RAM   │   │  - 10 Actionable Rules         │   │  │
│  │   │  - /health/ready    │   │  - Workflow Queues  │   │  - State Deduplication         │   │  │
│  │   │  - Dependency Ping  │   │  - Prometheus Types │   │  - Webhook Dispatcher          │   │  │
│  │   └──────────┬──────────┘   └──────────┬──────────┘   └───────────────┬────────────────┘   │  │
│  │              │                         │                              │                    │  │
│  │              └─────────────────────────┼──────────────────────────────┘                    │  │
│  │                                        ▼                                                   │  │
│  │                       ┌─────────────────────────────────┐                                  │  │
│  │                       │   WebSocket Hub & Event Schema  │                                  │  │
│  │                       │   - Real-Time Push (RFC 6455)   │                                  │  │
│  │                       │   - Tenant Isolation (4003)     │                                  │  │
│  │                       │   - Initial Snapshot (seq: 0)   │                                  │  │
│  │                       │   - Slow Client Drops (4004)    │                                  │  │
│  │                       └────────────────┬────────────────┘                                  │  │
│  │                                        │                                                   │  │
│  │                                        ▼                                                   │  │
│  │                       ┌─────────────────────────────────┐                                  │  │
│  │                       │ Standalone Live Dashboard (:4000│                                  │  │
│  │                       │   - GET /dashboard (index.html) │                                  │  │
│  │                       │   - Status Semantics & Stale Tag│                                  │  │
│  │                       └─────────────────────────────────┘                                  │  │
│  └────────────────────────────────────────┬───────────────────────────────────────────────────┘  │
└───────────────────────────────────────────┼──────────────────────────────────────────────────────┘
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               │ Scrapes /metrics           │ Dispatches Alerts          │ Datasource Proxy
               ▼                            ▼                            ▼
┌─────────────────────────────┐┌─────────────────────────────┐┌─────────────────────────────┐
│    Prometheus (Port 9090)   ││   Alertmanager (Port 9093)  ││     Grafana (Port 3000)     │
│ - 15s Scrape Interval       ││ - Alert Grouping & Inhibit  ││ - Provisioned Datasource    │
│ - alert_rules.yml Evaluator ││ - Slack/PagerDuty Webhooks  ││ - saga_engine_overview.json │
│ - TSDB Persistent Storage   ││ - Silences & Notification   ││ - Operational Dashboards    │
└─────────────────────────────┘└─────────────────────────────┘└─────────────────────────────┘
```

### Component Responsibilities:
1. **Health Checker (`src/health/checker.js`)**: Runs isolated diagnostics for MongoDB, Backend API, Workers, and DNS. Exposes decoupled `/health/live` (process liveness) and `/health/ready` (dependency readiness).
2. **Metrics Engine (`src/metrics/collector.js`, `src/metrics/prometheus.js`)**: Zero-dependency Prometheus exposition (`Counter`, `Gauge`, `Histogram`), cardinality-safe label sanitization, and system/workflow telemetry aggregation.
3. **Alerting Engine (`src/alerts/engine.js`, `alerts/alert_rules.yml`)**: Evaluates 10 actionable PromQL and internal threshold rules with state-change deduplication (only fires on transition).
4. **WebSocket Hub (`src/websocket/hub.js`, `src/websocket/schema.js`, `src/websocket/adapter.js`)**: Manages authenticated client sockets (`JWT` and `API Key`), enforces tenant isolation, generates monotonic sequences, publishes initial snapshots (`seq: 0`), and monitors slow clients.
5. **Dashboard UI (`public/index.html` & `frontend/src/components/MonitoringDashboard.jsx`)**: Real-time visual dashboard reflecting system health, active workers, queue backlog, retries, compensation failures, CPU/memory, and interactive filters.

---

## 2. Actual Directory Structure

```
Monitoring/
├── .env.example                               # Documented safe configuration defaults
├── Dockerfile                                 # Alpine container manifest with healthchecks & public UI
├── docker-compose.monitoring.yml             # Dedicated compose stack with persistent storage
├── package.json                               # Dependencies & npm test runner script
├── README.md                                  # You are here
├── alerts/
│   ├── alert_manager_config.yml               # Alertmanager grouping, inhibit rules & receivers
│   └── alert_rules.yml                        # 10 production PromQL alerting rules
├── grafana/
│   ├── dashboards/
│   │   └── saga_engine_overview.json          # Pre-built Grafana dashboard (11 panels)
│   └── provisioning/
│       ├── dashboards/dashboards.yml          # Automated Grafana dashboard provider
│       └── datasources/prometheus.yml         # Automated Prometheus datasource config
├── k8s/                                       # Mirrored Kubernetes manifests
├── kubernetes/                                # Production Kubernetes & Kustomize manifests
│   ├── alertmanager-configmap.yaml
│   ├── alertmanager-deployment.yaml
│   ├── alertmanager-pvc.yaml                  # 2Gi durable storage for Alertmanager
│   ├── alertmanager-service.yaml              # Private ClusterIP :9093
│   ├── configmap.yaml                         # Monitoring environment configuration
│   ├── grafana-configmap.yaml
│   ├── grafana-deployment.yaml
│   ├── grafana-pvc.yaml                       # 5Gi durable storage for Grafana
│   ├── grafana-service.yaml                   # Private ClusterIP :3000
│   ├── ingress.yaml                           # NGINX Ingress with WebSocket timeouts
│   ├── kustomization.yaml                     # Unified Kustomize deployment manifest
│   ├── monitoring-deployment.yaml             # 2 replicas, RollingUpdate, probes, non-root UID 1000
│   ├── monitoring-service.yaml                # ClusterIP :4000
│   ├── namespace.yaml                         # Namespace workflow-engine
│   ├── prometheus-configmap.yaml              # Scrape configs & alert rules
│   ├── prometheus-deployment.yaml
│   ├── prometheus-pvc.yaml                    # 10Gi durable storage for Prometheus TSDB
│   ├── prometheus-service.yaml                # Private ClusterIP :9090
│   ├── README.md                              # Kubernetes operations & troubleshooting guide
│   └── secret.yaml                            # Template secret manifest (no committed credentials)
├── prometheus/
│   └── prometheus.yml                         # Prometheus scrape jobs & target definitions
├── public/
│   └── index.html                             # Standalone HTML5 live monitoring dashboard
├── scripts/
│   ├── check_services.py                      # Health probe & dependency checker
│   ├── smoke_test.py                          # End-to-end smoke test suite (HTTP + WebSocket)
│   ├── verify_deployment.py                   # Compose & Kubernetes deployment verifier
│   └── smoke-test.ps1                         # PowerShell verification script
├── src/
│   ├── logger.js                              # Structured JSON console logger
│   ├── server.js                              # HTTP + WebSocket microservice entrypoint
│   ├── alerts/
│   │   └── engine.js                          # State-change detection & alert evaluation
│   ├── health/
│   │   └── checker.js                         # Database, API, Worker, and DNS probes
│   ├── metrics/
│   │   ├── collector.js                       # System information & MongoDB metrics collector
│   │   └── prometheus.js                      # Custom zero-dependency Prometheus registry
│   ├── middleware/
│   │   ├── auth.js                            # JWT bearer token & API key authorization
│   │   └── httpMetrics.js                     # Normalized HTTP latency & status tracking
│   ├── routes/
│   │   ├── alerts.js                          # GET /alerts, GET /alerts/history
│   │   ├── health.js                          # GET /health, /health/live, /health/ready, /:service
│   │   ├── metrics.js                         # GET /metrics (JSON or text/plain Prometheus)
│   │   └── status.js                          # GET /api/status (Combined UI state)
│   └── websocket/
│       ├── adapter.js                         # Non-invasive saga lifecycle event dispatcher
│       ├── hub.js                             # RFC 6455 WebSocket hub, snapshots, heartbeats
│       └── schema.js                          # Versioned envelope ('1') & credential redactor
└── tests/
    ├── alerts.test.js                         # 11 tests: alert thresholds & deduplication
    ├── dashboard.test.js                      # 12 tests: static dashboard, semantics, live WS
    ├── docker.test.js                         # 11 tests: compose syntax, volumes, resources
    ├── health.test.js                         # 14 tests: DB, liveness, readiness, sanitize
    ├── integration.test.js                    # 19 tests: full stack integration & fault recovery
    ├── kubernetes.test.js                     # 10 tests: Kustomize build, probes, security
    ├── metrics.test.js                        # 8 tests: CPU, memory, workflow counters
    ├── prometheus.test.js                     # 17 tests: metric types, PromQL rules, Grafana
    ├── security.test.js                       # 14 tests: auth middleware, tenant isolation
    └── websocket.test.js                      # 17 tests: connection lifecycle, schema, isolation
```

---

## 3. Prerequisites & Dependency Versions

### Runtime Requirements
- **Node.js**: `v20.x` or `v22.x` (`>= 20.0.0` required by `package.json`)
- **Docker Engine**: `v24+` / Docker Compose `v2.24+` (verified on Docker Compose `v5.5.1`)
- **Kubectl & Kustomize**: `kubectl v1.28+` (built-in `kustomize v5.x`)
- **Python**: `3.8+` (for verification scripts, verified on Python `3.13.3`)

### Core Node.js Dependencies (`Monitoring/package.json`)
- `express` (`^4.19.2`): HTTP routing, middleware pipeline, static dashboard hosting.
- `ws` (`^8.18.0`): Push-only WebSocket server.
- `jsonwebtoken` (`^9.0.3`): JWT verification and tenant derivation.
- `mongoose` (`^8.5.2`): Database connection state monitoring and Change Streams.
- `node-cron` (`^3.0.3`): Background polling schedule.
- `systeminformation` (`^5.23.5`): CPU load and physical memory consumption.
- `yaml` (`^2.9.1`): YAML validation and manifest parsing.
- `dotenv` (`^16.4.5`): Local environment variable loading.

---

## 4. Environment Variables & Safe Configuration Examples

All environment configuration should be copied from `Monitoring/.env.example` into a local `Monitoring/.env` (which is excluded from Git via `.gitignore`). **Never commit real credentials.**

```ini
# ── Service Network & Ports ──────────────────────────────────────────────────
PORT=4000
BACKEND_URL=http://localhost:5000
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/

# ── Telemetry & Health Checks ────────────────────────────────────────────────
HEALTH_CHECK_INTERVAL=30
DEPENDENCY_TIMEOUT_MS=4000

# ── Alerting Engine Thresholds ───────────────────────────────────────────────
CPU_ALERT_THRESHOLD=80
MEMORY_ALERT_THRESHOLD=85
FAILURE_RATE_THRESHOLD=30
WORKER_STALL_MINUTES=10

# ── Security & Authentication ────────────────────────────────────────────────
MONITORING_API_KEY=dev-monitoring-key-change-me
JWT_SECRET=wf-engine-s3cr3t-jwt-k3y-change-in-production

# ── Real-Time WebSocket Transport ────────────────────────────────────────────
ALLOWED_WS_ORIGINS=*
WS_MAX_CLIENTS=100
WS_HEARTBEAT_INTERVAL_MS=30000
WS_HEARTBEAT_TIMEOUT_MS=10000
WS_SLOW_CLIENT_BYTES=262144
WS_POLL_INTERVAL_MS=5000

# ── Grafana Credentials ─────────────────────────────────────────────────────
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin

# ── Alertmanager Webhook Endpoints ──────────────────────────────────────────
SMTP_SMARTHOST=localhost:25
ALERT_EMAIL_FROM=alerts@workflow-engine.local
ALERT_WEBHOOK_URL=http://localhost:4000/alerts/webhook
CRITICAL_WEBHOOK_URL=http://localhost:4000/alerts/webhook
```

---

## 5. Local Development Commands

```powershell
# 1. Install dependencies
cd Monitoring
npm install

# 2. Start the monitoring microservice (default: http://localhost:4000)
node src/server.js

# 3. Development mode with auto-reload (nodemon)
npm run dev

# 4. Run the full automated test suite (133 tests)
npm test
```

---

## 6. Docker Compose Commands

The monitoring stack provides a dedicated Compose file at [`Monitoring/docker-compose.monitoring.yml`](file:///c:/Users/dilee/Multi-Tenant-Distributed-Workflow-Saga-Orchestration-Engine/Monitoring/docker-compose.monitoring.yml).

```powershell
# 1. Validate configuration and interpolated variables
docker compose -f Monitoring/docker-compose.monitoring.yml config

# 2. Build and start the stack in detached mode
docker compose -f Monitoring/docker-compose.monitoring.yml up -d --build

# 3. Inspect container status and health states
docker compose -f Monitoring/docker-compose.monitoring.yml ps

# 4. View live logs across all monitoring containers
docker compose -f Monitoring/docker-compose.monitoring.yml logs -f

# 5. Stop and remove containers (preserving persistent storage volumes)
docker compose -f Monitoring/docker-compose.monitoring.yml down

# 6. Stop and wipe persistent storage volumes (resets Prometheus/Grafana)
docker compose -f Monitoring/docker-compose.monitoring.yml down -v
```

---

## 7. Working URLs & HTTP Endpoints

| Endpoint | Method | Authentication | Format | Description |
| :--- | :---: | :---: | :---: | :--- |
| `/` | `GET` | None | JSON | Service identity ping (`{ service: 'monitoring', status: 'running' }`) |
| `/dashboard` | `GET` | None | HTML | Standalone live operational dashboard UI |
| `/public/index.html`| `GET` | None | HTML | Static dashboard entrypoint |
| `/health` | `GET` | None | JSON | Overall status and array of service checks |
| `/health/live` | `GET` | None | JSON | **Liveness probe**: Always returns 200 `alive` |
| `/health/ready` | `GET` | None | JSON | **Readiness probe**: Returns 200 when ready, 503 when degraded |
| `/health/:service` | `GET` | None | JSON | Individual probe: `api`, `mongodb`, `workers`, `mongodb-dns` |
| `/metrics` | `GET` | API Key / JWT | JSON / Text | JSON telemetry or Prometheus exposition |
| `/metrics?format=prometheus`| `GET` | API Key / JWT | `text/plain` | Prometheus scrape endpoint with gauge/counter exposition |
| `/alerts` | `GET` | None | JSON | Active firing alerts |
| `/alerts/history` | `GET` | API Key / JWT | JSON | Last 100 fired alerts with timestamp history |
| `/api/status` | `GET` | API Key / JWT | JSON | Combined payload for dashboard clients |

---

## 8. WebSocket Endpoint, Authentication & Event Schema

### Endpoint & Transport
- **URL**: `ws://localhost:4000/` (or `wss://<host>/`)
- **Protocol**: Push-only RFC 6455 WebSocket stream.
- **Connection Handshake**:
  - Via Query Parameter: `ws://localhost:4000/?apiKey=dev-monitoring-key-change-me`
  - Via JWT Query Parameter: `ws://localhost:4000/?token=<jwt_token>`
  - Via Upgrade Header: `Authorization: Bearer <jwt_token>` or `X-Monitoring-Key: <key>`
  - Via Sec-WebSocket-Protocol: `Bearer, <jwt_token>`

### Tenant Isolation & Permissions
- **Admin Access** (`apiKey` or JWT `role: "admin"`): Receives system-wide events (health, metrics, all tenants).
- **Tenant Access** (JWT containing `companyId` / `tenantId`): Automatically scoped to that tenant.
- **Cross-Tenant Rejection**: Attempting to subscribe to another company's feed (e.g. `?tenant=tenant-b` when authenticated as `tenant-a`) terminates with close code **`4003` (Unauthorized tenant)**.
- **Buffer Overflow Protection**: Slow clients with buffer exceeding `256 KB` over consecutive ticks terminate with close code **`4004`**.

### Standard Versioned Event Envelope
All frames follow a strict versioned JSON envelope (`v: "1"`):
```json
{
  "v": "1",
  "type": "WORKFLOW_STEP_SUCCESS",
  "ts": "2026-10-27T08:00:00.000Z",
  "seq": 42,
  "severity": "info",
  "tenantId": "tenant-alpha",
  "payload": {
    "workflowId": "wf-101",
    "workflowName": "PaymentSaga",
    "stepName": "AuthorizeCard",
    "stepStatus": "success",
    "attempt": 1
  }
}
```

### Supported Event Types (`TYPES`)
- `CONNECTED`: Handshake confirmation (`seq: 0`).
- `SNAPSHOT`: Full authoritative state snapshot on connect/reconnect (`seq: 0`, `isSnapshot: true`).
- `SYSTEM_HEALTH`: Updated health check results array.
- `METRICS_UPDATE`: CPU, memory, and workflow queue counts.
- `WORKER_AVAILABILITY`: Worker node availability status.
- `QUEUE_BACKLOG`: Pending workflow queue depth notifications.
- `WORKFLOW_STARTED`, `WORKFLOW_STEP_SUCCESS`, `WORKFLOW_STEP_FAILED`, `WORKFLOW_STEP_RETRY`, `WORKFLOW_COMPENSATING`, `WORKFLOW_COMPENSATION_FAILED`, `WORKFLOW_COMPLETED`, `WORKFLOW_FAILED`.
- `ALERT_FIRED`, `ALERT_CLEARED`: Alert lifecycle events.

### Payload Sanitization
Before dispatch, all payloads pass through recursive sanitization:
- Passwords (`:password@`), MongoDB credentials (`mongodb+srv://user:pass@`), tokens, and secret keys are replaced with `[REDACTED_CREDENTIAL]`, `[REDACTED_MONGODB]`, or `[REDACTED_TOKEN]`.
- Internal step URLs (`url`, `targetUrl`, `endpoint`) and internal hostnames (`.internal`, `.local`) are stripped.

---

## 9. Prometheus, Grafana & Alertmanager Access Instructions

### Prometheus (Port 9090)
- **URL**: `http://localhost:9090` (binds to `127.0.0.1` locally; accessible in cluster via `workflow-prometheus-svc:9090`).
- **Scrape Jobs**:
  1. `monitoring-service`: Scrapes `http://workflow-monitoring-svc:4000/metrics?format=prometheus` every 15s using Bearer auth.
  2. `workflow-backend`: Scrapes `http://workflow-backend-svc:5000/health` every 15s.
- **Rule Files**: Evaluates [`Monitoring/alerts/alert_rules.yml`](file:///c:/Users/dilee/Multi-Tenant-Distributed-Workflow-Saga-Orchestration-Engine/Monitoring/alerts/alert_rules.yml) every 15s.

### Alertmanager (Port 9093)
- **URL**: `http://localhost:9093` (binds to `127.0.0.1` locally; accessible in cluster via `workflow-alertmanager-svc:9093`).
- **Configuration**: [`Monitoring/alerts/alert_manager_config.yml`](file:///c:/Users/dilee/Multi-Tenant-Distributed-Workflow-Saga-Orchestration-Engine/Monitoring/alerts/alert_manager_config.yml).
- **Inhibition & Grouping**: Groups by `[alertname, severity, service]`; suppresses warnings if a critical alert for the same service is already active.

### Grafana (Port 3000)
- **URL**: `http://localhost:3000`
- **Default Credentials**: `admin` / `admin` (configurable via `GF_SECURITY_ADMIN_PASSWORD`).
- **Pre-Provisioned Dashboard**: **"Saga Engine — Operational Overview"** ([`Monitoring/grafana/dashboards/saga_engine_overview.json`](file:///c:/Users/dilee/Multi-Tenant-Distributed-Workflow-Saga-Orchestration-Engine/Monitoring/grafana/dashboards/saga_engine_overview.json)).
  - Includes 11 panels: System Health, Queue Backlog, Active Sagas, Completed Sagas, Compensation Failures, Host CPU %, Host Memory %, P95 HTTP Latency, HTTP 5xx Rate, WebSocket Delivery Failures, and Active Alerts.

---

## 10. Metric Definitions & Alert Thresholds

### Prometheus Metrics
| Metric Name | Type | Description |
| :--- | :---: | :--- |
| `http_requests_total` | Counter | Total HTTP requests by `method`, `route`, and `status_code`. |
| `http_request_duration_seconds` | Histogram | Request latency distribution (buckets: 5ms to 10s). |
| `database_connection_status` | Gauge | `1` if MongoDB connected, `0` otherwise. |
| `worker_availability_status` | Gauge | `1` if workers executing without stall, `0` otherwise. |
| `workflow_queue_depth` | Gauge | Number of workflows in `pending` queue state. |
| `workflow_active_running` | Gauge | Number of workflows in `running` state. |
| `workflow_lifecycle_total` | Counter | Workflow completions/failures partitioned by `status`. |
| `workflow_compensation_failures_total`| Counter | Critical saga rollback failures. |
| `websocket_connected_clients` | Gauge | Number of active WebSocket transport connections. |
| `websocket_delivery_failures_total` | Counter | Dropped or failed outbound event dispatches. |
| `process_cpu_usage_percent` | Gauge | Host CPU load percentage. |
| `process_memory_usage_percent` | Gauge | Host RAM consumption percentage. |

### 10 Actionable Alert Rules
1. `BackendUnavailable` (`critical`): Backend API failing health checks for > 1m.
2. `DatabaseConnectionFailed` (`critical`): MongoDB readyState disconnected for > 30s.
3. `WorkerUnavailable` (`critical`): Saga workers stalled (> 10m) or unavailable for > 2m.
4. `HighHttpErrorRate` (`warning`): HTTP 5xx rate > 5% over 5m window.
5. `ExcessiveRequestLatency` (`warning`): P95 request latency > 2.0s for > 3m.
6. `WorkflowFailureSpike` (`critical`): Saga failure rate > 30% over 15m window.
7. `SagaCompensationFailed` (`critical`): Any rollback compensation failure fires immediately.
8. `WorkflowQueueBacklog` (`warning`): Pending workflows > 50 for > 5m.
9. `StaleMetrics` (`warning`): Telemetry collector loop un-updated for > 120s.
10. `RepeatedPodRestarts` (`warning`): Container uptime < 120s for > 3m (crash-looping).

---

## 11. Kubernetes Prerequisites & Rollout Commands

Manifests are organized with Kustomize under [`Monitoring/kubernetes/`](file:///c:/Users/dilee/Multi-Tenant-Distributed-Workflow-Saga-Orchestration-Engine/Monitoring/kubernetes/).

```bash
# 1. Preview rendered resource manifests
kubectl kustomize Monitoring/kubernetes

# 2. Inject secrets safely into the cluster
kubectl create namespace workflow-engine --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic monitoring-secrets \
  --namespace=workflow-engine \
  --from-literal=MONGODB_URI="mongodb+srv://..." \
  --from-literal=JWT_SECRET="prod-jwt-secret-key" \
  --from-literal=MONITORING_API_KEY="prod-monitoring-key"

# 3. Apply the entire stack to the cluster
kubectl apply -k Monitoring/kubernetes

# 4. Check rollout status across deployments
kubectl rollout status -n workflow-engine deployment/monitoring-deployment
kubectl rollout status -n workflow-engine deployment/prometheus-deployment
kubectl rollout status -n workflow-engine deployment/alertmanager-deployment
kubectl rollout status -n workflow-engine deployment/grafana-deployment

# 5. Zero-downtime rolling restart
kubectl rollout restart -n workflow-engine deployment/monitoring-deployment

# 6. Secure port-forwarding to access private management tools
kubectl port-forward -n workflow-engine svc/workflow-prometheus-svc 9090:9090
kubectl port-forward -n workflow-engine svc/workflow-alertmanager-svc 9093:9093
kubectl port-forward -n workflow-engine svc/workflow-grafana-svc 3000:3000
```

---

## 12. Automated Tests & Smoke Tests

### Test Suites (`npm --prefix Monitoring test`)
The test runner executes 10 test suites comprising **133 total tests**:
```powershell
# Run all automated tests
npm --prefix Monitoring test

# Run individual test suites
node --test Monitoring/tests/health.test.js
node --test Monitoring/tests/metrics.test.js
node --test Monitoring/tests/alerts.test.js
node --test Monitoring/tests/security.test.js
node --test Monitoring/tests/websocket.test.js
node --test Monitoring/tests/prometheus.test.js
node --test Monitoring/tests/dashboard.test.js
node --test Monitoring/tests/docker.test.js
node --test Monitoring/tests/kubernetes.test.js
node --test Monitoring/tests/integration.test.js
```

### Verification Scripts
```powershell
# Deployment Configuration Verification (Docker + K8s syntax & secrets check)
python Monitoring/scripts/verify_deployment.py

# Live Service Health & Dependency Connectivity Probe
python Monitoring/scripts/check_services.py --url http://localhost:4000

# End-to-End Smoke Test Suite (HTTP + WebSocket)
python Monitoring/scripts/smoke_test.py --base-url http://localhost:4000

# PowerShell equivalent
pwsh Monitoring/scripts/smoke-test.ps1 -BaseUrl http://localhost:4000
```

---

## 13. Troubleshooting Procedures

| Problem | Root Cause | Remediation |
| :--- | :--- | :--- |
| **`CrashLoopBackOff` on Monitoring Pod** | Missing secret `MONGODB_URI` in cluster | Run `kubectl get secret -n workflow-engine monitoring-secrets` and verify `MONGODB_URI` is populated. |
| **Readiness probe failing (`HTTP 503`)** | Database connection degraded or DNS resolution failure | Inspect `/health/ready` response; check Atlas network access rules. Liveness probe (`/health/live`) remains green, avoiding restart loops. |
| **WebSocket disconnects after 60 seconds** | Ingress proxy timeout closing idle connection | Ensure NGINX Ingress annotations `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` and `nginx.ingress.kubernetes.io/websocket-services` are configured. |
| **Dashboard displays `Transport disconnected (stale)`** | Client disconnected from WebSocket hub | Check network connectivity to port 4000; the dashboard will retain cached state with stale badges and attempt automatic exponential reconnect with jitter. |
| **Prometheus returns `HTTP 401 Unauthorized`** | Missing or invalid Bearer token in scrape config | Verify `credentials` in `prometheus.yml` matches `JWT_SECRET` in `monitoring-secrets`. |
| **PVC in `Pending` state** | Missing dynamic StorageClass | Verify default cluster storage class via `kubectl get sc`. Update `*-pvc.yaml` to specify the cluster's active storage class. |

---

## 14. Security Considerations & Known Limitations

### Security Features
1. **Zero Committed Secrets**: All secrets in source control use placeholders. Real secrets are injected via `.env` (ignored by Git) or Kubernetes Secrets.
2. **Deep Credential Sanitization**: Passwords, connection URIs, JWT tokens, and internal cluster hostnames are redacted from logs and WebSocket event envelopes.
3. **Internal Management Ports Private by Default**: Prometheus (`:9090`), Alertmanager (`:9093`), and Grafana (`:3000`) are ClusterIP-only by default.
4. **Non-Root Execution**: Container processes run under dedicated non-root UIDs (`1000` monitoring, `65534` prometheus/alertmanager, `472` grafana).
5. **Slow-Client Termination**: Clients failing to drain socket buffers are dropped to prevent memory exhaustion attacks.

### Known Limitations
1. **Single MongoDB Instance / Replica Set Required**: MongoDB Change Streams require a replica set. When running against standalone MongoDB, the service automatically falls back to bounded polling (`WS_POLL_INTERVAL_MS=5000`).
2. **Ingress TLS Termination**: The provided Ingress manifest leaves TLS termination to cluster cert-manager or cloud load balancer.

---

## 15. Unverified Steps & Deployment Exclusions

In accordance with strict operational integrity guidelines:
- **Local Live Docker Daemon Container Startup**: Marked as `SKIP` in verification scripts because Docker Desktop engine daemon was offline on the host. Manifest syntax, schema, volume bindings, and port configurations are verified 100%.
- **Live Kubernetes Cluster Rollout**: Marked as `SKIP` because no local cluster (e.g. Minikube/Kind) was active. Kustomize compilation and Kubernetes API schemas are verified 100% via `kubectl kustomize`.
- **Production Data Modifications**: No synthetic or destructive production data was generated to test live events; all integration tests execute against isolated in-memory test fixtures.
