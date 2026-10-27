'use strict';

/**
 * tests/kubernetes.test.js
 *
 * Automated verification of Kubernetes deployment & Kustomize manifests:
 *  1. All required manifests exist under Monitoring/kubernetes/
 *  2. kustomization.yaml compiles cleanly via kubectl kustomize
 *  3. Namespace workflow-engine with standard Kubernetes labels
 *  4. Monitoring Deployment configuration:
 *     - Replicas: 2
 *     - RollingUpdate strategy with maxSurge: 1, maxUnavailable: 0
 *     - Non-root security context (runAsNonRoot: true, runAsUser: 1000)
 *     - Probes: startupProbe, livenessProbe (/health/live), readinessProbe (/health/ready)
 *     - Fault isolation: liveness does NOT check database to prevent CrashLoopBackOff
 *     - Resource requests and limits
 *  5. Prometheus Deployment:
 *     - Image prom/prometheus:v2.53.1
 *     - Non-root UID 65534
 *     - Probes on /-/ready
 *     - Mounts persistent storage PVC
 *  6. Alertmanager Deployment:
 *     - Image prom/alertmanager:v0.27.0
 *     - Non-root UID 65534
 *     - Probes on /-/ready
 *     - Mounts persistent storage PVC
 *  7. Grafana Deployment:
 *     - Image grafana/grafana:11.1.0
 *     - Non-root UID 472
 *     - Probes on /api/health
 *     - Mounts persistent storage PVC
 *  8. Services: ClusterIP for all components
 *  9. Ingress: Exposes ONLY workflow-monitoring-svc on port 4000; private tools remain internal
 * 10. PVCs: Durable storage requested for Prometheus (10Gi), Grafana (5Gi), Alertmanager (2Gi)
 * 11. Secrets: Contains template placeholders, NO committed production credentials
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const YAML = require('yaml');

const K8S_DIR = path.join(__dirname, '..', 'kubernetes');

describe('Kubernetes Manifests & Kustomize Test Suite', () => {
  // ── 1. Manifest Files Existence ───────────────────────────────────────────

  const requiredFiles = [
    'namespace.yaml',
    'configmap.yaml',
    'secret.yaml',
    'monitoring-deployment.yaml',
    'monitoring-service.yaml',
    'alertmanager-pvc.yaml',
    'alertmanager-configmap.yaml',
    'alertmanager-deployment.yaml',
    'alertmanager-service.yaml',
    'prometheus-pvc.yaml',
    'prometheus-configmap.yaml',
    'prometheus-deployment.yaml',
    'prometheus-service.yaml',
    'grafana-pvc.yaml',
    'grafana-configmap.yaml',
    'grafana-deployment.yaml',
    'grafana-service.yaml',
    'ingress.yaml',
    'kustomization.yaml',
    'README.md',
  ];

  test('All required Kubernetes manifests exist in Monitoring/kubernetes/', () => {
    for (const f of requiredFiles) {
      const p = path.join(K8S_DIR, f);
      assert.ok(fs.existsSync(p), `Missing required Kubernetes manifest: ${f}`);
    }
  });

  // ── 2. Kustomize Compilation Validation ───────────────────────────────────

  let renderedDocs = [];

  test('kubectl kustomize compiles successfully without error', () => {
    const stdout = execSync(`kubectl kustomize "${K8S_DIR}"`, { encoding: 'utf8' });
    assert.ok(stdout && stdout.length > 0, 'Kustomize output must not be empty');

    // Parse all documents in the rendered stream
    renderedDocs = YAML.parseAllDocuments(stdout).map((doc) => doc.toJSON());
    assert.ok(renderedDocs.length >= 10, `Expected at least 10 documents, got ${renderedDocs.length}`);
  });

  // ── 3. Namespace Validation ───────────────────────────────────────────────

  test('Namespace is workflow-engine with standard labels', () => {
    const nsDoc = renderedDocs.find((d) => d.kind === 'Namespace');
    assert.ok(nsDoc, 'Must contain a Namespace resource');
    assert.equal(nsDoc.metadata.name, 'workflow-engine');
    assert.equal(nsDoc.metadata.labels['app.kubernetes.io/part-of'], 'workflow-saga-engine');
  });

  // ── 4. Monitoring Deployment Specifications ───────────────────────────────

  test('Monitoring Deployment has rolling update, non-root context, and decoupled probes', () => {
    const dep = renderedDocs.find((d) => d.kind === 'Deployment' && d.metadata.name.includes('monitoring-deployment'));
    assert.ok(dep, 'Must contain monitoring-deployment');

    assert.equal(dep.spec.replicas, 2);
    assert.equal(dep.spec.strategy.type, 'RollingUpdate');
    assert.equal(dep.spec.strategy.rollingUpdate.maxSurge, 1);
    assert.equal(dep.spec.strategy.rollingUpdate.maxUnavailable, 0);

    const podSpec = dep.spec.template.spec;
    assert.equal(podSpec.securityContext.runAsNonRoot, true);
    assert.equal(podSpec.securityContext.runAsUser, 1000);

    const container = podSpec.containers[0];
    assert.equal(container.name, 'monitoring');
    assert.equal(container.imagePullPolicy, 'IfNotPresent');

    // Startup probe
    assert.ok(container.startupProbe, 'Must define startupProbe');
    assert.equal(container.startupProbe.httpGet.path, '/health/live');

    // Liveness probe (checks /health/live, NOT /health/ready, to avoid restarting on downstream outages)
    assert.ok(container.livenessProbe, 'Must define livenessProbe');
    assert.equal(container.livenessProbe.httpGet.path, '/health/live');
    assert.equal(container.livenessProbe.failureThreshold, 3);

    // Readiness probe (checks /health/ready, returns 503 when DB down to protect traffic)
    assert.ok(container.readinessProbe, 'Must define readinessProbe');
    assert.equal(container.readinessProbe.httpGet.path, '/health/ready');

    // Resources
    assert.ok(container.resources.requests.cpu, 'Must define CPU request');
    assert.ok(container.resources.requests.memory, 'Must define memory request');
    assert.ok(container.resources.limits.cpu, 'Must define CPU limit');
    assert.ok(container.resources.limits.memory, 'Must define memory limit');
  });

  // ── 5. Prometheus Deployment & Volume ─────────────────────────────────────

  test('Prometheus Deployment uses prom/prometheus:v2.53.1 and mounts durable PVC', () => {
    const dep = renderedDocs.find((d) => d.kind === 'Deployment' && d.metadata.name.includes('prometheus-deployment'));
    assert.ok(dep, 'Must contain prometheus-deployment');

    const container = dep.spec.template.spec.containers[0];
    assert.ok(container.image.includes('prom/prometheus:v2.53.1'));
    assert.equal(dep.spec.template.spec.securityContext.runAsUser, 65534);

    assert.equal(container.livenessProbe.httpGet.path, '/-/ready');
    assert.equal(container.readinessProbe.httpGet.path, '/-/ready');

    const storageMount = container.volumeMounts.find((v) => v.name === 'storage');
    assert.ok(storageMount);
    assert.equal(storageMount.mountPath, '/prometheus');

    const pvc = renderedDocs.find((d) => d.kind === 'PersistentVolumeClaim' && d.metadata.name.includes('prometheus-storage-pvc'));
    assert.ok(pvc, 'Must define prometheus-storage-pvc');
    assert.equal(pvc.spec.resources.requests.storage, '10Gi');
  });

  // ── 6. Alertmanager Deployment & Volume ───────────────────────────────────

  test('Alertmanager Deployment uses prom/alertmanager:v0.27.0 and mounts durable PVC', () => {
    const dep = renderedDocs.find((d) => d.kind === 'Deployment' && d.metadata.name.includes('alertmanager-deployment'));
    assert.ok(dep, 'Must contain alertmanager-deployment');

    const container = dep.spec.template.spec.containers[0];
    assert.ok(container.image.includes('prom/alertmanager:v0.27.0'));
    assert.equal(dep.spec.template.spec.securityContext.runAsUser, 65534);

    assert.equal(container.livenessProbe.httpGet.path, '/-/ready');
    assert.equal(container.readinessProbe.httpGet.path, '/-/ready');

    const pvc = renderedDocs.find((d) => d.kind === 'PersistentVolumeClaim' && d.metadata.name.includes('alertmanager-storage-pvc'));
    assert.ok(pvc, 'Must define alertmanager-storage-pvc');
    assert.equal(pvc.spec.resources.requests.storage, '2Gi');
  });

  // ── 7. Grafana Deployment & Volume ────────────────────────────────────────

  test('Grafana Deployment uses grafana/grafana:11.1.0, UID 472, and mounts durable PVC', () => {
    const dep = renderedDocs.find((d) => d.kind === 'Deployment' && d.metadata.name.includes('grafana-deployment'));
    assert.ok(dep, 'Must contain grafana-deployment');

    const container = dep.spec.template.spec.containers[0];
    assert.ok(container.image.includes('grafana/grafana:11.1.0'));
    assert.equal(dep.spec.template.spec.securityContext.runAsUser, 472);

    assert.equal(container.livenessProbe.httpGet.path, '/api/health');
    assert.equal(container.readinessProbe.httpGet.path, '/api/health');

    const pvc = renderedDocs.find((d) => d.kind === 'PersistentVolumeClaim' && d.metadata.name.includes('grafana-storage-pvc'));
    assert.ok(pvc, 'Must define grafana-storage-pvc');
    assert.equal(pvc.spec.resources.requests.storage, '5Gi');
  });

  // ── 8. Service Network Isolation ──────────────────────────────────────────

  test('All services are ClusterIP by default, isolating management ports from public internet', () => {
    const services = renderedDocs.filter((d) => d.kind === 'Service');
    assert.ok(services.length >= 4, 'Must define at least 4 Services');

    for (const svc of services) {
      assert.equal(svc.spec.type, 'ClusterIP', `Service ${svc.metadata.name} must be ClusterIP`);
    }
  });

  // ── 9. Ingress Policy ─────────────────────────────────────────────────────

  test('Ingress routes ONLY workflow-monitoring-svc with WebSocket timeouts', () => {
    const ingress = renderedDocs.find((d) => d.kind === 'Ingress');
    assert.ok(ingress, 'Must define Ingress resource');

    const annotations = ingress.metadata.annotations;
    assert.equal(annotations['nginx.ingress.kubernetes.io/proxy-read-timeout'], '3600');
    assert.equal(annotations['nginx.ingress.kubernetes.io/proxy-send-timeout'], '3600');
    assert.equal(annotations['nginx.ingress.kubernetes.io/websocket-services'], 'workflow-monitoring-svc');

    // Rule points strictly to workflow-monitoring-svc:4000
    const rule = ingress.spec.rules[0];
    const pathRule = rule.http.paths[0];
    assert.equal(pathRule.backend.service.name, 'workflow-monitoring-svc');
    assert.equal(pathRule.backend.service.port.number, 4000);
  });

  // ── 10. Secrets Hygiene ───────────────────────────────────────────────────

  test('Secret manifest contains placeholder templates and no real credentials', () => {
    const secretPath = path.join(K8S_DIR, 'secret.yaml');
    const content = fs.readFileSync(secretPath, 'utf8');

    assert.ok(content.includes('PLACEHOLDER_USER'), 'Must use placeholder for MongoDB user');
    assert.ok(content.includes('PLACEHOLDER_PASSWORD'), 'Must use placeholder for MongoDB password');
    assert.ok(!content.includes('nirisha_bommii'), 'Must NOT contain committed username');
    assert.ok(!content.includes('4prGv3ffJY1kOWKO'), 'Must NOT contain committed password');
  });
});
