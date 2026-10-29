#!/usr/bin/env python3
"""
check_services.py — Service Health & Dependency Connectivity Probe
Part of the Multi-Tenant Distributed Workflow Saga Orchestration Engine.

Validates operational status of:
  - Monitoring Microservice HTTP root & health endpoints
  - Liveness probe (/health/live) & Readiness probe (/health/ready)
  - Database & internal dependency status (/health)
  - Backend API availability (default: http://localhost:5000)
  - Combined Status API (/api/status)

Usage:
  python Monitoring/scripts/check_services.py [OPTIONS]

Options:
  --url URL           Monitoring service base URL (default: http://localhost:4000)
  --backend-url URL   Backend API base URL (default: http://localhost:5000)
  --api-key KEY       Monitoring API key (default: dev-monitoring-key-change-me)
  --timeout SECS      Timeout in seconds per probe (default: 5)
  --verbose           Enable detailed diagnostic output
"""

import sys
import os
import re
import json
import argparse
import urllib.request
import urllib.error

# ANSI color codes
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

# Avoid ANSI codes if output is piped or on older Windows terminals
if not sys.stdout.isatty() or os.name == "nt" and "WT_SESSION" not in os.environ and "TERM" not in os.environ:
    GREEN = YELLOW = RED = CYAN = BOLD = RESET = ""

def redact_sensitive(text: str) -> str:
    """Redact passwords, connection strings, and secret keys from logs."""
    if not text:
        return ""
    # Redact :password@ in URIs
    s = re.sub(r':([^:@/\s]+)@', r':[REDACTED]@', str(text))
    # Redact Bearer tokens
    s = re.sub(r'Bearer\s+[A-Za-z0-9\-_.]+', r'Bearer [REDACTED]', s)
    # Redact API keys in query params
    s = re.sub(r'apiKey=[^&\s]+', r'apiKey=[REDACTED]', s)
    return s

class ServiceChecker:
    def __init__(self, mon_url: str, backend_url: str, api_key: str, timeout: int, verbose: bool):
        self.mon_url = mon_url.rstrip('/')
        self.backend_url = backend_url.rstrip('/')
        self.api_key = api_key
        self.timeout = timeout
        self.verbose = verbose

        self.passed = 0
        self.failed = 0
        self.warned = 0
        self.skipped = 0

    def log_pass(self, msg: str, detail: str = ""):
        self.passed += 1
        d = f" ({detail})" if detail else ""
        print(f"  {GREEN}[PASS]{RESET} {msg}{d}")

    def log_fail(self, msg: str, error: str = ""):
        self.failed += 1
        err = f" — {redact_sensitive(error)}" if error else ""
        print(f"  {RED}[FAIL]{RESET} {msg}{err}")

    def log_warn(self, msg: str, reason: str = ""):
        self.warned += 1
        r = f" — {redact_sensitive(reason)}" if reason else ""
        print(f"  {YELLOW}[WARN]{RESET} {msg}{r}")

    def log_skip(self, msg: str, reason: str = ""):
        self.skipped += 1
        r = f" ({reason})" if reason else ""
        print(f"  {CYAN}[SKIP]{RESET} {msg}{r}")

    def _http_get(self, url: str, headers: dict = None) -> tuple:
        """Perform an HTTP GET request safely, returning (status_code, body_dict_or_str, error)."""
        req_headers = {"User-Agent": "WorkflowEngine-CheckServices/1.0"}
        if headers:
            req_headers.update(headers)

        req = urllib.request.Request(url, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                code = resp.status
                raw = resp.read().decode('utf-8', errors='replace')
                try:
                    data = json.loads(raw)
                except Exception:
                    data = raw
                return code, data, None
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', errors='replace')
            try:
                data = json.loads(raw)
            except Exception:
                data = raw
            return e.code, data, str(e)
        except Exception as e:
            return None, None, str(e)

    def check_monitoring_root(self):
        code, data, err = self._http_get(f"{self.mon_url}/")
        if code == 200 and isinstance(data, dict) and data.get("service") == "monitoring":
            self.log_pass("Monitoring Root endpoint", f"status={data.get('status', 'running')}")
        elif code:
            self.log_fail("Monitoring Root endpoint", f"HTTP {code}")
        else:
            self.log_fail("Monitoring Root endpoint", err)

    def check_liveness(self):
        code, data, err = self._http_get(f"{self.mon_url}/health/live")
        if code == 200 and isinstance(data, dict) and data.get("status") == "alive":
            self.log_pass("Monitoring Liveness probe (/health/live)", "process alive")
        elif code:
            self.log_fail("Monitoring Liveness probe (/health/live)", f"HTTP {code}")
        else:
            self.log_fail("Monitoring Liveness probe (/health/live)", err)

    def check_readiness(self):
        code, data, err = self._http_get(f"{self.mon_url}/health/ready")
        if code == 200 and isinstance(data, dict) and data.get("status") == "healthy":
            self.log_pass("Monitoring Readiness probe (/health/ready)", "dependencies healthy")
        elif code == 503 or (isinstance(data, dict) and data.get("status") == "degraded"):
            self.log_warn("Monitoring Readiness probe (/health/ready)", "degraded / waiting for database")
        elif code:
            self.log_fail("Monitoring Readiness probe (/health/ready)", f"HTTP {code}")
        else:
            self.log_fail("Monitoring Readiness probe (/health/ready)", err)

    def check_services_detail(self):
        code, data, err = self._http_get(f"{self.mon_url}/health")
        if code == 200 and isinstance(data, dict):
            overall = data.get("overall", "unknown")
            services = data.get("services", [])
            svc_summary = ", ".join([f"{s.get('name')}={s.get('status')}" for s in services])
            if overall == "healthy":
                self.log_pass("Monitored Services (/health)", svc_summary or "all healthy")
            else:
                self.log_warn("Monitored Services (/health)", f"overall={overall} [{svc_summary}]")
        elif code:
            self.log_fail("Monitored Services (/health)", f"HTTP {code}")
        else:
            self.log_fail("Monitored Services (/health)", err)

    def check_backend_api(self):
        code, data, err = self._http_get(f"{self.backend_url}/")
        if code == 200:
            self.log_pass("Backend API Probe (port 5000)", f"HTTP 200 OK")
        elif code:
            self.log_warn("Backend API Probe (port 5000)", f"HTTP {code}")
        else:
            self.log_skip("Backend API Probe (port 5000)", "Backend offline or not started locally")

    def check_combined_status(self):
        headers = {"X-Monitoring-Key": self.api_key}
        code, data, err = self._http_get(f"{self.mon_url}/api/status", headers=headers)
        if code == 200 and isinstance(data, dict) and "overall" in data:
            self.log_pass("Combined Status API (/api/status)", f"overall={data.get('overall')}")
        elif code:
            self.log_fail("Combined Status API (/api/status)", f"HTTP {code}")
        else:
            self.log_fail("Combined Status API (/api/status)", err)

    def run_all(self) -> int:
        print(f"\n{BOLD}=== Service Health & Dependency Connectivity Probe ==={RESET}")
        print(f"Monitoring Target : {redact_sensitive(self.mon_url)}")
        print(f"Backend Target    : {redact_sensitive(self.backend_url)}")
        print(f"Probe Timeout     : {self.timeout}s\n")

        self.check_monitoring_root()
        self.check_liveness()
        self.check_readiness()
        self.check_services_detail()
        self.check_backend_api()
        self.check_combined_status()

        print(f"\n{BOLD}Results Summary:{RESET} {GREEN}{self.passed} passed{RESET}, "
              f"{RED}{self.failed} failed{RESET}, "
              f"{YELLOW}{self.warned} warnings{RESET}, "
              f"{CYAN}{self.skipped} skipped{RESET}")

        if self.failed > 0:
            print(f"{RED}{BOLD}FAILED: One or more required service checks failed.{RESET}\n")
            return 1
        print(f"{GREEN}{BOLD}PASSED: Service checks verified successfully.{RESET}\n")
        return 0

def main():
    parser = argparse.ArgumentParser(description="Check health of monitoring service and dependencies.")
    parser.add_argument("--url", default=os.getenv("MONITORING_URL", "http://localhost:4000"), help="Monitoring base URL")
    parser.add_argument("--backend-url", default=os.getenv("BACKEND_URL", "http://localhost:5000"), help="Backend base URL")
    parser.add_argument("--api-key", default=os.getenv("MONITORING_API_KEY", "dev-monitoring-key-change-me"), help="Monitoring API key")
    parser.add_argument("--timeout", type=int, default=5, help="Timeout in seconds")
    parser.add_argument("--verbose", action="store_true", help="Verbose diagnostics")

    args = parser.parse_args()
    checker = ServiceChecker(args.url, args.backend_url, args.api_key, args.timeout, args.verbose)
    sys.exit(checker.run_all())

if __name__ == "__main__":
    main()
