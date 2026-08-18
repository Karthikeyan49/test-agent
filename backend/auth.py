"""
Authentication Manager for the SystemIntel HTTP test runner.

Protected ERP endpoints reject unauthenticated requests with 401, which
prevents the tool from ever reaching the real business logic behind login.
This module acquires a bearer token — either supplied statically or fetched
by POSTing credentials to a login endpoint — and exposes it as ready-to-use
request headers for backend/http_runner.py.

Design goals:
  - Zero hard dependencies beyond httpx (already used by http_runner.py).
  - Never raise on network / parse errors: log a [Auth] line and return None,
    so a misconfigured login degrades to "no auth" instead of crashing a run.
  - httpx is referenced at module scope (``httpx.post``) so the self-test can
    monkeypatch it without a real server.
"""

import httpx
import time
from typing import Any, Dict, List, Optional, Union


class AuthManager:
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        cfg = config or {}
        self.mode: str = cfg.get("mode", "none")

        # Static-token mode
        self.static_token: Optional[str] = cfg.get("static_token")

        # Login mode
        self.login_url: str      = cfg.get("login_url", "")
        self.username: str       = cfg.get("username", "")
        self.password: str       = cfg.get("password", "")
        self.username_field: str = cfg.get("username_field", "username")
        self.password_field: str = cfg.get("password_field", "password")
        self.token_json_path: str = cfg.get("token_json_path", "token")

        # Header shaping (shared by all modes)
        self.header: str  = cfg.get("header", "Authorization")
        self.scheme: str  = cfg.get("scheme", "Bearer")
        self.timeout: float = float(cfg.get("timeout", 10.0))

        # Populated after a successful login() / from a static token
        self.token: Optional[str] = None
        if self.mode == "token" and self.static_token:
            self.token = self.static_token

    # ── Public API ────────────────────────────────────────────────────────

    def login(self, base_url: str = "") -> Optional[str]:
        """Acquire and store an auth token according to ``mode``.

        - mode="none":  returns None (no token).
        - mode="token": returns ``static_token`` (no network call).
        - mode="login": POSTs {username_field: username, password_field: password}
          as JSON to ``login_url`` (prefixed with ``base_url`` when it is a path),
          extracts the token via ``token_json_path`` and stores it.

        Never raises: on any network/parse error it logs and returns None.
        """
        if self.mode == "none":
            return None

        if self.mode == "token":
            self.token = self.static_token
            return self.token

        if self.mode != "login":
            print(f"[Auth] Unknown mode '{self.mode}' — treating as no auth")
            return None

        if not self.login_url:
            print("[Auth] mode='login' but no login_url configured — skipping")
            return None

        url = self._full_url(self.login_url, base_url)
        payload = {
            self.username_field: self.username,
            self.password_field: self.password,
        }

        start = time.time()
        try:
            resp = httpx.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.ConnectError:
            print(f"[Auth] CONNECTION_REFUSED: cannot reach login endpoint {url}")
            return None
        except httpx.TimeoutException:
            print(f"[Auth] TIMEOUT: login request to {url} exceeded {self.timeout}s")
            return None
        except httpx.HTTPStatusError as e:
            code = getattr(getattr(e, "response", None), "status_code", "?")
            print(f"[Auth] login failed: HTTP {code} from {url}")
            return None
        except Exception as e:
            print(f"[Auth] login error: {type(e).__name__}: {e}")
            return None

        token = self._extract(data, self.token_json_path)
        if not token:
            print(f"[Auth] login succeeded but no token at path "
                  f"'{self.token_json_path}' in response")
            return None

        self.token = str(token)
        latency_ms = round((time.time() - start) * 1000)
        print(f"[Auth] token acquired via login ({latency_ms}ms) — "
              f"{self.header}: {self.scheme} …{self.token[-6:]}")
        return self.token

    def auth_headers(self) -> Dict[str, str]:
        """Return the header dict to merge into outgoing requests, or {}."""
        if not self.token:
            return {}
        value = f"{self.scheme} {self.token}".strip()
        return {self.header: value}

    def is_active(self) -> bool:
        """True when a usable token is currently available."""
        return bool(self.token)

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _full_url(login_url: str, base_url: str) -> str:
        """Resolve a login URL that may be absolute or a base-relative path."""
        if login_url.startswith("http://") or login_url.startswith("https://"):
            return login_url
        if not base_url:
            return login_url
        return f"{base_url.rstrip('/')}/{login_url.lstrip('/')}"

    @staticmethod
    def _extract(data: Any, path: str) -> Optional[Any]:
        """Walk a dot-path (e.g. 'data.accessToken', 'items.0.token') through
        nested dicts/lists. Returns the value, or None if any hop is missing."""
        if not path:
            return None
        current: Union[Any, None] = data
        for segment in path.split("."):
            if current is None:
                return None
            if isinstance(current, dict):
                current = current.get(segment)
            elif isinstance(current, list):
                try:
                    current = current[int(segment)]
                except (ValueError, IndexError):
                    return None
            else:
                return None
        return current


# ── Self-test (no real server required) ───────────────────────────────────

if __name__ == "__main__":

    class _FakeResponse:
        status_code = 200

        def json(self) -> Dict[str, Any]:
            return {"data": {"accessToken": "TOK123"}}

        def raise_for_status(self) -> None:
            return None

    def _fake_post(*args, **kwargs) -> _FakeResponse:
        return _FakeResponse()

    # Monkeypatch httpx.post so login() hits the fake instead of the network.
    httpx.post = _fake_post  # type: ignore[assignment]

    # (1) mode="login" → token extracted via nested json path
    login_mgr = AuthManager({
        "mode": "login",
        "login_url": "/api/auth/login",
        "username": "admin",
        "password": "secret",
        "token_json_path": "data.accessToken",
    })
    tok = login_mgr.login(base_url="http://localhost:3000")
    assert tok == "TOK123", f"expected TOK123, got {tok!r}"
    assert login_mgr.auth_headers() == {"Authorization": "Bearer TOK123"}, \
        login_mgr.auth_headers()
    assert login_mgr.is_active() is True
    print("[self-test] login mode → token TOK123, headers OK")

    # (2) mode="token" → static token wrapped in scheme
    token_mgr = AuthManager({"mode": "token", "static_token": "X"})
    assert token_mgr.auth_headers() == {"Authorization": "Bearer X"}, \
        token_mgr.auth_headers()
    assert token_mgr.is_active() is True
    print("[self-test] token mode → headers OK")

    # (3) mode="none" → no token, no headers
    none_mgr = AuthManager({"mode": "none"})
    assert none_mgr.login() is None
    assert none_mgr.auth_headers() == {}, none_mgr.auth_headers()
    assert none_mgr.is_active() is False
    print("[self-test] none mode → no auth OK")

    print("SELF-TEST PASS")
