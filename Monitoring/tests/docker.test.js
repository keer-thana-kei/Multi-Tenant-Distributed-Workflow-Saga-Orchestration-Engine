'use strict';

/**
 * tests/docker.test.js
 *
 * Automated verification of Docker deployment & Compose integration:
 *  1. Monitoring/docker-compose.monitoring.yml structure, YAML validity & schema
 *  2. All 4 required monitoring services defined: monitoring, prometheus, alertmanager, grafana
 *  3. Persistent storage volumes defined for data survival
 *  4. Network connectivity & explicit name binding (workflow-net)
 *  5. Health checks, restart policies & resource boundaries
 *  6. Port security (localhost-binding defaults)
 *  7. Monitoring Dockerfile validation (src, public, EXPOSE, HEALTHCHECK)
 *  8. Environment configuration documentation (.env.example)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const MONITORING_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(MONITORING_DIR, '..');

describe('Docker Deployment & Compose Integration Test Suite', () => {
  const composePath = path.join(MONITORING_DIR, 'docker-compose.monitoring.yml');
  const rootComposePath = path.join(ROOT_DIR, 'docker-compose.yml');
  const dockerfilePath = path.join(MONITORING_DIR, 'Dockerfile');
  const envExamplePath = path.join(MONITORING_DIR, '.env.example');

  // ── 1. Compose File Existence & Parsing ────────────────────────────────────

  test('Monitoring/docker-compose.monitoring.yml exists and is valid YAML', () => {
    assert.ok(fs.existsSync(composePath), 'Monitoring/docker-compose.monitoring.yml must exist');
    const content = fs.readFileSync(composePath, 'utf8');
    const doc = YAML.parse(content);
    assert.ok(doc, 'Parsed YAML must not be null');
    assert.ok(doc.services, 'YAML must define a services section');
  });

  // ── 2. Services Verification ──────────────────────────────────────────────

  test('Defines all required monitoring services: monitoring, prometheus, alertmanager, grafana', () => {
    const content = fs.readFileSync(composePath, 'utf8');
    const doc = YAML.parse(content);
    const services = Object.keys(doc.services || {});

    assert.ok(services.includes('monitoring'), 'Must contain monitoring service');
    assert.ok(services.includes('prometheus'), 'Must contain prometheus service');
    assert.ok(services.includes('alertmanager'), 'Must contain alertmanager service');
    assert.ok(services.includes('grafana'), 'Must contain grafana service');
  });

  test('Monitoring service has correct build context, container name, and restart policy', () => {
    const doc = YAML.parse(fs.readFileSync(composePath, 'utf8'));
    const mon = doc.services.monitoring;

    assert.equal(mon.container_name, 'workflow-monitoring');
    assert.equal(mon.restart, 'unless-stopped');
    assert.equal(mon.build.context, '.');
    assert.equal(mon.build.dockerfile, 'Dockerfile');
  });

  // ── 3. Persistent Volumes ─────────────────────────────────────────────────

  test('Configures persistent storage volumes for Prometheus, Grafana, and Alertmanager', () => {
    const doc = YAML.parse(fs.readFileSync(composePath, 'utf8'));
    assert.ok(doc.volumes, 'Compose must define volumes section');

    assert.ok(doc.volumes['prometheus-data'], 'prometheus-data volume must exist');
    assert.ok(doc.volumes['grafana-data'], 'grafana-data volume must exist');
    assert.ok(doc.volumes['alertmanager-data'], 'alertmanager-data volume must exist');

    // Check mounts inside services
    const promVols = doc.services.prometheus.volumes || [];
    assert.ok(
      promVols.some((v) => typeof v === 'string' && v.includes('prometheus-data:/prometheus')),
      'Prometheus must mount prometheus-data to /prometheus'
    );

    const grafVols = doc.services.grafana.volumes || [];
    assert.ok(
      grafVols.some((v) => typeof v === 'string' && v.includes('grafana-data:/var/lib/grafana')),
      'Grafana must mount grafana-data to /var/lib/grafana'
    );

    const alertVols = doc.services.alertmanager.volumes || [];
    assert.ok(
      alertVols.some((v) => typeof v === 'string' && v.includes('alertmanager-data:/alertmanager')),
      'Alertmanager must mount alertmanager-data to /alertmanager'
    );
  });

  // ── 4. Network Integration ────────────────────────────────────────────────

  test('Connects all monitoring services to the shared application network (workflow-net)', () => {
    const doc = YAML.parse(fs.readFileSync(composePath, 'utf8'));
    assert.ok(doc.networks, 'Must define networks section');
    assert.ok(doc.networks['workflow-net'], 'Must define workflow-net');
    assert.equal(doc.networks['workflow-net'].name, 'workflow-net');

    for (const [sName, sCfg] of Object.entries(doc.services)) {
      const netList = sCfg.networks || [];
      assert.ok(
        netList.includes('workflow-net'),
        `Service "${sName}" must connect to workflow-net`
      );
    }
  });

  // ── 5. Health Checks & Resource Guardrails ────────────────────────────────

  test('All services configure explicit health checks with intervals and timeouts', () => {
    const doc = YAML.parse(fs.readFileSync(composePath, 'utf8'));

    for (const [sName, sCfg] of Object.entries(doc.services)) {
      assert.ok(sCfg.healthcheck, `Service "${sName}" must have a healthcheck defined`);
      assert.ok(sCfg.healthcheck.test, `Service "${sName}" healthcheck must specify test command`);
      assert.ok(sCfg.healthcheck.interval, `Service "${sName}" healthcheck must specify interval`);
      assert.ok(sCfg.healthcheck.timeout, `Service "${sName}" healthcheck must specify timeout`);
      assert.ok(sCfg.healthcheck.retries, `Service "${sName}" healthcheck must specify retries`);
    }
  });

  test('All services define reasonable CPU and memory resource limits', () => {
    const doc = YAML.parse(fs.readFileSync(composePath, 'utf8'));

    for (const [sName, sCfg] of Object.entries(doc.services)) {
      const resources = sCfg.deploy?.resources;
      assert.ok(resources, `Service "${sName}" must define deploy.resources`);
      assert.ok(resources.limits?.cpus, `Service "${sName}" must define cpu limit`);
      assert.ok(resources.limits?.memory, `Service "${sName}" must define memory limit`);
    }
  });

  // ── 6. Port Security & Defaults ───────────────────────────────────────────

  test('Published ports bind to 127.0.0.1 by default for secure local access', () => {
    const doc = YAML.parse(fs.readFileSync(composePath, 'utf8'));

    for (const [sName, sCfg] of Object.entries(doc.services)) {
      const ports = sCfg.ports || [];
      for (const p of ports) {
        assert.ok(
          p.includes('127.0.0.1:'),
          `Service "${sName}" port "${p}" must bind to 127.0.0.1 by default`
        );
      }
    }
  });

  // ── 7. Monitoring Dockerfile ──────────────────────────────────────────────

  test('Monitoring/Dockerfile copies src, public assets, exposes 4000, and specifies HEALTHCHECK', () => {
    assert.ok(fs.existsSync(dockerfilePath), 'Monitoring/Dockerfile must exist');
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    assert.ok(content.includes('COPY src ./src'), 'Must copy src directory');
    assert.ok(content.includes('COPY public ./public'), 'Must copy public directory for dashboard');
    assert.ok(content.includes('EXPOSE 4000'), 'Must expose port 4000');
    assert.ok(content.includes('HEALTHCHECK'), 'Must define container HEALTHCHECK instruction');
    assert.ok(content.includes('CMD ["node", "src/server.js"]'), 'Must specify server start CMD');
  });

  // ── 8. Environment Example Documentation ──────────────────────────────────

  test('Monitoring/.env.example documents all required variables without committed secrets', () => {
    assert.ok(fs.existsSync(envExamplePath), 'Monitoring/.env.example must exist');
    const content = fs.readFileSync(envExamplePath, 'utf8');

    assert.ok(content.includes('PORT='), 'Must document PORT');
    assert.ok(content.includes('BACKEND_URL='), 'Must document BACKEND_URL');
    assert.ok(content.includes('MONGODB_URI='), 'Must document MONGODB_URI');
    assert.ok(content.includes('HEALTH_CHECK_INTERVAL='), 'Must document HEALTH_CHECK_INTERVAL');
    assert.ok(content.includes('MONITORING_API_KEY='), 'Must document MONITORING_API_KEY');
    assert.ok(content.includes('JWT_SECRET='), 'Must document JWT_SECRET');
    assert.ok(content.includes('GRAFANA_ADMIN_USER='), 'Must document GRAFANA_ADMIN_USER');
    assert.ok(content.includes('ALERT_WEBHOOK_URL='), 'Must document ALERT_WEBHOOK_URL');

    // Verify placeholder in MONGODB_URI (no real passwords in .env.example)
    assert.ok(content.includes('<username>') && content.includes('<password>'), 'Must use placeholders for MONGODB_URI');
  });

  // ── 9. Root docker-compose.yml Integrity ──────────────────────────────────

  test('Root docker-compose.yml retains backend and connects to the same workflow-net', () => {
    assert.ok(fs.existsSync(rootComposePath), 'Root docker-compose.yml must exist');
    const doc = YAML.parse(fs.readFileSync(rootComposePath, 'utf8'));

    assert.ok(doc.services.backend, 'Root compose must retain backend service');
    assert.equal(doc.services.backend.container_name, 'workflow-backend');
    assert.equal(doc.networks['workflow-net'].name, 'workflow-net');
  });
});
