# Kubernetes Deployment & Operations Guide
## Multi-Tenant Distributed Workflow Saga Orchestration Engine — Monitoring Stack

This directory contains production-ready Kubernetes manifests and Kustomize overlays for deploying the Observability & Monitoring infrastructure in the `workflow-engine` namespace.

---

### Architecture Overview

```
                          Internet / Ingress Controller
                                        │
                                        ▼ (Port 4000: /dashboard, /public, WS /)
                         ┌─────────────────────────────┐
                         │   workflow-monitoring-svc   │ (ClusterIP :4000)
                         └──────────────┬──────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
┌─────────────────────────┐                               ┌─────────────────────────┐
│  Pod: monitoring (1)    │                               │  Pod: monitoring (2)    │
│  - Startup Probe        │                               │  - Startup Probe        │
│  - Liveness: /health/live│                              │  - Liveness: /health/live│
│  - Readiness: /health/ready                             │  - Readiness: /health/ready
└────────────┬────────────┘                               └────────────┬────────────┘
             │                                                         │
             └──────────────────────────┬──────────────────────────────┘
                                        │ (Scrape /metrics)
                         ┌──────────────▼──────────────┐
                         │   workflow-prometheus-svc   │ (ClusterIP :9090 - Private)
                         └──────────────┬──────────────┘
                                        │ (Evaluates alert_rules.yml & dispatches alerts)
                         ┌──────────────▼──────────────┐
                         │ workflow-alertmanager-svc   │ (ClusterIP :9093 - Private)
                         └─────────────────────────────┘
                                        ▲
                                        │ (Prometheus Datasource)
                         ┌──────────────┴──────────────┐
                         │    workflow-grafana-svc     │ (ClusterIP :3000 - Private)
                         └─────────────────────────────┘
```

---

### Security & Ingress Policy

1. **Public vs Private Endpoints**:
   - `workflow-monitoring-svc` (Port 4000): Exposed via Ingress on `monitoring.local` for the live operator dashboard, static assets, and real-time WebSocket telemetry stream.
   - `workflow-prometheus-svc` (Port 9090), `workflow-alertmanager-svc` (Port 9093), and `workflow-grafana-svc` (Port 3000): Kept strictly **ClusterIP (private)**. They are **not** exposed to the public Internet by default.
2. **Accessing Private Management Tools**:
   Use `kubectl port-forward` or an internal VPN / Authenticated OAuth Proxy:
   ```bash
   # Access Prometheus Web UI on http://localhost:9090
   kubectl port-forward -n workflow-engine svc/workflow-prometheus-svc 9090:9090

   # Access Alertmanager UI on http://localhost:9093
   kubectl port-forward -n workflow-engine svc/workflow-alertmanager-svc 9093:9093

   # Access Grafana Dashboards on http://localhost:3000
   kubectl port-forward -n workflow-engine svc/workflow-grafana-svc 3000:3000
   ```
3. **Non-Root Execution**:
   - `monitoring`: Runs as UID/GID `1000:1000`.
   - `prometheus`: Runs as UID/GID `65534:65534` (`nobody`).
   - `alertmanager`: Runs as UID/GID `65534:65534` (`nobody`).
   - `grafana`: Runs as UID/GID `472:472` (`grafana`).
   All pods drop all Linux capabilities (`drop: ["ALL"]`) and forbid privilege escalation.

---

### Step-by-Step Deployment Instructions

#### 1. Provision Secrets Securely
Do not commit real secrets to Git. Inject secrets using `kubectl create secret generic` or External Secrets Operator:

```bash
kubectl create namespace workflow-engine --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic monitoring-secrets \
  --namespace=workflow-engine \
  --from-literal=MONGODB_URI="mongodb+srv://<username>:<password>@cluster.mongodb.net/" \
  --from-literal=JWT_SECRET="generate-a-strong-jwt-secret-key" \
  --from-literal=MONITORING_API_KEY="generate-a-strong-monitoring-api-key" \
  --dry-run=client -o yaml | kubectl apply -f -
```

#### 2. Validate Manifests with Kustomize
```bash
# Preview the rendered Kubernetes resource stream
kubectl kustomize Monitoring/kubernetes

# Client-side dry-run validation
kubectl apply -k Monitoring/kubernetes --dry-run=client
```

#### 3. Apply to Cluster
```bash
kubectl apply -k Monitoring/kubernetes
```

---

### Rollout Checks & Verification Commands

```bash
# 1. Check rollout status of all deployments
kubectl rollout status -n workflow-engine deployment/monitoring-deployment
kubectl rollout status -n workflow-engine deployment/prometheus-deployment
kubectl rollout status -n workflow-engine deployment/alertmanager-deployment
kubectl rollout status -n workflow-engine deployment/grafana-deployment

# 2. Inspect pods, services, PVCs and ingress
kubectl get pods,svc,pvc,ingress -n workflow-engine -o wide

# 3. Verify probe endpoints on monitoring pods
kubectl exec -n workflow-engine deploy/monitoring-deployment -c monitoring -- wget -qO- http://localhost:4000/health/live
kubectl exec -n workflow-engine deploy/monitoring-deployment -c monitoring -- wget -qO- http://localhost:4000/health/ready

# 4. View real-time logs
kubectl logs -n workflow-engine -l app=workflow-monitoring -c monitoring -f
```

---

### Probe Semantics & Restart Behavior

| Probe | Endpoint | Interval | Timeout | Threshold | Behavior & Fault Isolation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Startup** | `/health/live` | 2s | 3s | 30 | Allows up to 60s for initial database connect without premature killing. |
| **Liveness** | `/health/live` | 15s | 5s | 3 | Checks process event loop health. **Never restarts the pod if MongoDB or API is temporarily down.** |
| **Readiness**| `/health/ready`| 10s | 5s | 2 | Checks database & API readiness. When degraded (503), temporarily removes pod from Service endpoints to avoid routing client traffic, without crashlooping. |

---

### Troubleshooting Guide

| Issue / Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`Pending` PVCs** | StorageClass not matching cloud provider | Edit `*-pvc.yaml` to specify the cluster's active `storageClassName` (e.g. `gp3`, `standard`, `managed-csi`, `local-path`). |
| **`CrashLoopBackOff` on `monitoring`** | Missing or malformed `MONGODB_URI` secret | Run `kubectl get secret -n workflow-engine monitoring-secrets` and verify keys `MONGODB_URI`, `JWT_SECRET`, and `MONITORING_API_KEY`. |
| **Readiness Probe Failing (503)** | Downstream MongoDB or API unreachable | Check Atlas cluster access list and firewall rules. Notice that liveness probe remains green, preventing pod restart loops. |
| **WebSocket Connection Drops** | Ingress proxy timeout exceeded | Ensure NGINX Ingress annotations `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` and `nginx.ingress.kubernetes.io/websocket-services` are present. |
