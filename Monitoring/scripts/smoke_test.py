#!/usr/bin/env python3
"""
smoke_test.py — End-to-End Monitoring Stack Smoke Test
Part of the Multi-Tenant Distributed Workflow Saga Orchestration Engine.

Performs a comprehensive sanity check on:
  1. Base HTTP reachability (GET /)
  2. Health endpoint (GET /health)
  3. Liveness probe (GET /health/live)
  4. Readiness probe (GET /health/ready)
  5. Authenticated Metrics JSON API (GET /metrics)
  6. Prometheus Text Exposition format (GET /metrics?format=prometheus)
  7. Standalone Dashboard HTML UI (GET /dashboard)
  8. Static assets serving (GET /public/index.html)
  9. Active Alerts API (GET /alerts)
 10. Status API (GET /api/status)
 11. WebSocket transport connectivity & RFC 6455 upgrade

Usage:
  python Monitoring/scripts/smoke_test.py [OPTIONS]

Options:
  --base-url URL       Base HTTP URL (default: http://localhost:4000)
  --api-key KEY        Admin monitoring API key (default: dev-monitoring-key-change-me)
  --jwt-secret SECRET  JWT Secret for token generation (default: wf-engine-s3cr3t-jwt-k3y-change-in-production)
  --wait-seconds SECS  Max wait time for server availability (default: 15)
  --timeout SECS       HTTP and socket timeout in seconds (default: 5)
"""

import sys
import os
import re
import time
import json
import base64
import socket
import argparse
import urllib.request
import urllib.error
import urllib.parse

# Colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

if not sys.stdout.isatty() or os.name == "nt" and "WT_SESSION" not in os.environ and "TERM" not in os.environ:
    GREEN = YELLOW = RED = CYAN = BOLD = RESET = ""

def redact(text: str) -> str:
    """Redact credentials and secrets from logs and diagnostics."""
    if not text:
        return ""
    s = re.sub(r':([^:@/\s]+)@', r':[REDACTED]@', str(text))
    s = re.sub(r'Bearer\s+[A-Za-z0-9\-_.]+', r'Bearer [REDACTED]', s)
    s = re.sub(r'apiKey=[^&\s]+', r'apiKey=[REDACTED]', s)
    return s

class SmokeTestRunner:
    def __init__(self, base_url: str, api_key: str, wait_seconds: int, timeout: int):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.wait_seconds = wait_seconds
        self.timeout = timeout

        self.passed = 0
        self.failed = 0
        self.warned = 0
        self.skipped = 0

    def log_pass(self, title: str, detail: str = ""):
        self.passed += 1
        d = f" ({detail})" if detail else ""
        print(f"  {GREEN}[PASS]{RESET} {title}{d}")

    def log_fail(self, title: str, error: str = ""):
        self.failed += 1
        err = f" — {redact(error)}" if error else ""
        print(f"  {RED}[FAIL]{RESET} {title}{err}")

    def log_warn(self, title: str, reason: str = ""):
        self.warned += 1
        r = f" — {redact(reason)}" if reason else ""
        print(f"  {YELLOW}[WARN]{RESET} {title}{r}")

    def log_skip(self, title: str, reason: str = ""):
        self.skipped += 1
        r = f" ({reason})" if reason else ""
        print(f"  {CYAN}[SKIP]{RESET} {title}{r}")

    def _http_req(self, path: str, headers: dict = None) -> tuple:
        url = f"{self.base_url}{path}"
        req_headers = {"User-Agent": "MonitoringSmokeTest/1.0"}
        if headers:
            req_headers.update(headers)

        req = urllib.request.Request(url, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                code = resp.status
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read().decode('utf-8', errors='replace')
                return code, content_type, raw, None
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', errors='replace')
            return e.code, e.headers.get("Content-Type", ""), raw, str(e)
        except Exception as e:
            return None, "", "", str(e)

    def wait_for_server(self) -> bool:
        print(f"Waiting up to {self.wait_seconds}s for server at {redact(self.base_url)}...")
        start = time.time()
        while time.time() - start < self.wait_seconds:
            code, _, _, _ = self._http_req("/")
            if code and code < 500:
                return True
            time.sleep(1)
        return False

    def test_root(self):
        code, ctype, body, err = self._http_req("/")
        if code == 200 and "monitoring" in body:
            self.log_pass("GET / (Root Service Probe)", "HTTP 200 OK")
        else:
            self.log_fail("GET / (Root Service Probe)", err or f"HTTP {code}")

    def test_health(self):
        code, ctype, body, err = self._http_req("/health")
        if code == 200 and "services" in body:
            self.log_pass("GET /health (Overall Health)", "HTTP 200 OK")
        else:
            self.log_fail("GET /health (Overall Health)", err or f"HTTP {code}")

    def test_liveness(self):
        code, ctype, body, err = self._http_req("/health/live")
        if code == 200 and "alive" in body:
            self.log_pass("GET /health/live (Liveness Probe)", "HTTP 200 status=alive")
        else:
            self.log_fail("GET /health/live (Liveness Probe)", err or f"HTTP {code}")

    def test_readiness(self):
        code, ctype, body, err = self._http_req("/health/ready")
        if code == 200 and "healthy" in body:
            self.log_pass("GET /health/ready (Readiness Probe)", "HTTP 200 dependencies ready")
        elif code == 503 or "degraded" in body:
            self.log_warn("GET /health/ready (Readiness Probe)", "HTTP 503 degraded (offline DB)")
        else:
            self.log_fail("GET /health/ready (Readiness Probe)", err or f"HTTP {code}")

    def test_metrics_json(self):
        headers = {"X-Monitoring-Key": self.api_key}
        code, ctype, body, err = self._http_req("/metrics", headers=headers)
        if code == 200 and ("system" in body or "workflows" in body):
            self.log_pass("GET /metrics (Protected JSON Telemetry)", "HTTP 200 OK")
        elif code == 503:
            self.log_warn("GET /metrics (Protected JSON Telemetry)", "HTTP 503 metrics collecting")
        else:
            self.log_fail("GET /metrics (Protected JSON Telemetry)", err or f"HTTP {code}")

    def test_prometheus_exposition(self):
        headers = {"X-Monitoring-Key": self.api_key}
        code, ctype, body, err = self._http_req("/metrics?format=prometheus", headers=headers)
        if code == 200 and "text/plain" in ctype and "# HELP" in body:
            self.log_pass("GET /metrics?format=prometheus (Prometheus Scrape)", "Valid exposition format")
        else:
            self.log_fail("GET /metrics?format=prometheus (Prometheus Scrape)", err or f"HTTP {code}")

    def test_dashboard_html(self):
        code, ctype, body, err = self._http_req("/dashboard")
        if code == 200 and "text/html" in ctype and "Saga Orchestration Monitoring" in body:
            self.log_pass("GET /dashboard (Standalone Dashboard)", "HTML UI loaded successfully")
        else:
            self.log_fail("GET /dashboard (Standalone Dashboard)", err or f"HTTP {code}")

    def test_public_static(self):
        code, ctype, body, err = self._http_req("/public/index.html")
        if code == 200 and "text/html" in ctype:
            self.log_pass("GET /public/index.html (Static Directory)", "HTTP 200 OK")
        else:
            self.log_fail("GET /public/index.html (Static Directory)", err or f"HTTP {code}")

    def test_alerts(self):
        code, ctype, body, err = self._http_req("/alerts")
        if code == 200 and "alerts" in body:
            self.log_pass("GET /alerts (Active Alerts API)", "HTTP 200 OK")
        else:
            self.log_fail("GET /alerts (Active Alerts API)", err or f"HTTP {code}")

    def test_api_status(self):
        headers = {"X-Monitoring-Key": self.api_key}
        code, ctype, body, err = self._http_req("/api/status", headers=headers)
        if code == 200 and "overall" in body:
            self.log_pass("GET /api/status (Combined Status API)", "HTTP 200 OK")
        else:
            self.log_fail("GET /api/status (Combined Status API)", err or f"HTTP {code}")

    def test_websocket_transport(self):
        """Test RFC 6455 WebSocket Upgrade Handshake using safe standard TCP socket."""
        parsed = urllib.parse.urlparse(self.base_url)
        host = parsed.hostname or "localhost"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)

        # Generate standard Sec-WebSocket-Key
        ws_key = base64.b64encode(os.urandom(16)).decode('utf-8')
        path_with_auth = f"/?apiKey={self.api_key}"

        upgrade_req = (
            f"GET {path_with_auth} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {ws_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"User-Agent: MonitoringSmokeTest-WS/1.0\r\n\r\n"
        )

        try:
            sock = socket.create_connection((host, port), timeout=self.timeout)
            sock.sendall(upgrade_req.encode('utf-8'))
            response = sock.recv(4096).decode('utf-8', errors='replace')
            sock.close()

            if "101 Switching Protocols" in response:
                self.log_pass("WebSocket Transport Handshake (RFC 6455 Upgrade)", "HTTP 101 Switching Protocols")
            elif "4001" in response or "4003" in response or "401" in response:
                self.log_warn("WebSocket Transport Handshake", "Auth rejected (check API key)")
            else:
                first_line = response.split('\r\n')[0] if response else "No response"
                self.log_fail("WebSocket Transport Handshake", first_line)
        except Exception as e:
            self.log_fail("WebSocket Transport Handshake", str(e))

    def run(self) -> int:
        print(f"\n{BOLD}=== Monitoring Service Smoke Test Suite ==={RESET}")
        print(f"Target Base URL : {redact(self.base_url)}")
        print(f"Timeout         : {self.timeout}s\n")

        if not self.wait_for_server():
            print(f"{RED}[ERROR] Monitoring service unreachable at {redact(self.base_url)} within {self.wait_seconds}s.{RESET}")
            print("        Ensure the service is started with: node Monitoring/src/server.js\n")
            return 1

        self.test_root()
        self.test_health()
        self.test_liveness()
        self.test_readiness()
        self.test_metrics_json()
        self.test_prometheus_exposition()
        self.test_dashboard_html()
        self.test_public_static()
        self.test_alerts()
        self.test_api_status()
        self.test_websocket_transport()

        print(f"\n{BOLD}Smoke Test Results:{RESET} {GREEN}{self.passed} passed{RESET}, "
              f"{RED}{self.failed} failed{RESET}, "
              f"{YELLOW}{self.warned} warnings{RESET}, "
              f"{CYAN}{self.skipped} skipped{RESET}")

        if self.failed > 0:
            print(f"{RED}{BOLD}FAILED: Smoke tests encountered failures.{RESET}\n")
            return 1
        print(f"{GREEN}{BOLD}PASSED: All smoke test assertions succeeded.{RESET}\n")
        return 0

def main():
    parser = argparse.ArgumentParser(description="End-to-end smoke test for monitoring service.")
    parser.add_argument("--base-url", default=os.getenv("MONITORING_URL", "http://localhost:4000"), help="Base monitoring service URL")
    parser.add_argument("--api-key", default=os.getenv("MONITORING_API_KEY", "dev-monitoring-key-change-me"), help="Monitoring API key")
    parser.add_argument("--wait-seconds", type=int, default=15, help="Max wait seconds for server availability")
    parser.add_argument("--timeout", type=int, default=5, help="Probe timeout in seconds")

    args = parser.parse_args()
    runner = SmokeTestRunner(args.base_url, args.api_key, args.wait_seconds, args.timeout)
    sys.exit(runner.run())

if __name__ == "__main__":
    main()
