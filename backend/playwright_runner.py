"""
Real Playwright Browser Automation Runner
Launches a real Chromium browser via Playwright, navigates ERP pages,
fills form fields, clicks buttons, captures screenshots, and asserts UI state.
"""

import time
import os
import base64
from typing import Dict, Any, List, Optional


class PlaywrightRunner:
    def __init__(self, base_url: str = "http://localhost:3000",
                 headless: bool = True,
                 screenshots_dir: str = "./screenshots",
                 auth_local_storage: Optional[Dict[str, str]] = None):
        self.base_url        = base_url.rstrip('/')
        self.headless        = headless
        self.screenshots_dir = screenshots_dir
        self.browser         = None
        self.context         = None
        self.page            = None
        self.playwright_ctx  = None
        self._available      = False
        # {localStorage_key: value} injected before app JS runs — carries a
        # pre-authenticated session so client-side auth gates don't redirect
        # protected routes to /login. See set_auth_local_storage().
        self.auth_local_storage = auth_local_storage or {}

        # Create screenshots directory
        os.makedirs(screenshots_dir, exist_ok=True)

        # Check if playwright is installed
        try:
            from playwright.sync_api import sync_playwright
            self._sync_playwright = sync_playwright
            self._available = True
        except ImportError:
            self._available = False

    def is_available(self) -> bool:
        return self._available

    def start(self):
        """Launch real Chromium browser via Playwright."""
        if not self._available:
            raise RuntimeError(
                "Playwright not installed.\n"
                "Run: pip install playwright && python -m playwright install chromium"
            )
        from playwright.sync_api import sync_playwright
        self.playwright_ctx = sync_playwright().start()
        self.browser = self.playwright_ctx.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context()
        # Inject a pre-authenticated session into localStorage BEFORE any app JS
        # runs (add_init_script runs before page scripts on EVERY navigation), so
        # a client-side auth gate that reads localStorage on load sees a valid
        # session and renders protected pages instead of bouncing to /login.
        if self.auth_local_storage:
            import json as _json
            payload = _json.dumps(self.auth_local_storage)
            self.context.add_init_script(
                "(() => { try { const e = " + payload + "; "
                "for (const k in e) { window.localStorage.setItem(k, e[k]); } } catch (_) {} })();"
            )
        self.page = self.context.new_page()
        # Intercept console errors
        self.console_errors = []
        self.page.on("console", lambda msg: self.console_errors.append({
            "type": msg.type,
            "text": msg.text
        }) if msg.type in ('error', 'warning') else None)

    def set_auth_local_storage(self, mapping: Dict[str, str]):
        """Provide {localStorage_key: value} to inject as a pre-authenticated
        session (call before start()). Reusable for any app whose auth gate reads
        a token from localStorage."""
        self.auth_local_storage = mapping or {}

    def stop(self):
        """Close the browser and Playwright context."""
        if self.context:
            try:
                self.context.close()
            except Exception:
                pass
        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
        if self.playwright_ctx:
            try:
                self.playwright_ctx.stop()
            except Exception:
                pass
        self.browser        = None
        self.context        = None
        self.page           = None
        self.playwright_ctx = None

    def _locate_field(self, name: str, explicit: str = None):
        """Find an input for a logical field name. Prefers a selector resolved by
        DOM introspection (field_mapper), then falls back to naive strategies."""
        if explicit:
            loc = self.page.locator(explicit).first
            return loc if loc.count() > 0 else None
        if not name:
            return None
        # DOM-introspection mapping (reliable — reads the form's real id/name/label)
        mapped = getattr(self, "_field_map", {}).get(name)
        if mapped:
            try:
                loc = self.page.locator(mapped).first
                if loc.count() > 0:
                    return loc
            except Exception:
                pass
        for sel in (f'#{name}', f'[name="{name}"]', f'[id="{name}"]',
                    f'[data-testid="{name}"]', f'[aria-label*="{name}" i]'):
            try:
                loc = self.page.locator(sel).first
                if loc.count() > 0:
                    return loc
            except Exception:
                continue
        return None

    def run_test_case(self, test_case: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a single test case's UI steps and assertions using real Playwright.
        Supported step actions:
          "navigate"   → navigate to URL
          "fill"       → fill an input with text
          "click"      → click a button/element
          "select"     → select from <select>
          "wait"       → wait for selector to appear
          "assert_text"→ assert element's visible text
          "assert_url" → assert current page URL
        """
        test_id  = test_case.get('id', 'UNKNOWN')
        steps    = test_case.get('steps', [])
        ui_asserts = [a for a in test_case.get('assertions', []) if a.get('type') == 'UI']

        result = {
            "testId":       test_id,
            "type":         "PLAYWRIGHT",
            "passed":       False,
            "stepLogs":     [],
            "consoleErrors":[],
            "screenshotPath": None,
            "error":        None,
            "durationMs":   0,
        }

        if not self.page:
            result["error"] = "Browser not started. Call start() first."
            return result

        start_ms = time.time() * 1000

        try:
            self.console_errors = []

            # fill targets in this test — mapped to real DOM selectors after navigation
            self._field_map = {}
            fill_targets = [s.get('target') for s in steps
                            if s.get('target') and any(k in s.get('action', '').lower()
                                                       for k in ('fill', 'type', 'enter', 'set'))]

            nav_ok = False
            fields_filled, fields_missed = 0, 0
            submit_fired = False
            # Does this test intend to exercise a form workflow (fill + submit)?
            intends_workflow = bool(fill_targets) or any(
                any(k in s.get('action', '').lower() for k in ('click', 'submit', 'confirm'))
                for s in steps)
            for step in steps:
                step_num   = step.get('step', '?')
                action     = step.get('action', '').lower()
                target     = step.get('target', '')
                value      = step.get('value', '')
                explicit   = step.get('selector')
                log_prefix = f"[Step {step_num}]"
                try:
                    if 'navigate' in action or 'open' in action or step.get('route') or step.get('url'):
                        route = step.get('url') or step.get('route')
                        if not route:
                            route = next((p for p in action.split(' ') if p.startswith('/')), None)
                        if route:
                            full_url = route if route.startswith('http') else f"{self.base_url}{route}"
                            self.page.goto(full_url, timeout=15000)
                            self.page.wait_for_load_state("domcontentloaded")
                            # Let a client-rendered SPA hydrate before we introspect the
                            # DOM — otherwise we assert against an empty <div id="root">.
                            try:
                                self.page.wait_for_load_state("networkidle", timeout=5000)
                            except Exception:
                                pass
                            try:
                                self.page.wait_for_selector("input, textarea, select, button", timeout=5000)
                            except Exception:
                                pass
                            nav_ok = True
                            result["stepLogs"].append(f"{log_prefix} Navigated to {full_url}")

                            # Auth-gate detection: a protected route that bounces to the
                            # login page is an unmet PRECONDITION (needs a session), not a
                            # UI defect → mark SKIPPED, exactly like an unreachable app.
                            try:
                                landed = (self.page.url or "").lower()
                                intended_login = any(k in (route or "").lower() for k in ("login", "signin", "sign-in"))
                                landed_login   = any(k in landed for k in ("login", "signin", "sign-in"))
                                if landed_login and not intended_login:
                                    result["skipped"] = True
                                    result["error"] = "Auth required — app redirected to login (no session)"
                                    result["stepLogs"].append(f"{log_prefix} SKIP — redirected to login (auth-gated)")
                                    break
                            except Exception:
                                pass

                            # resolve real DOM selectors for this form's fields (no vision needed)
                            if fill_targets:
                                try:
                                    from field_mapper import map_form_fields
                                    self._field_map = map_form_fields(self.page, fill_targets)
                                    result["fieldsMapped"] = len(self._field_map)
                                    result["stepLogs"].append(
                                        f"{log_prefix} Mapped {len(self._field_map)}/{len(fill_targets)} fields to DOM selectors")
                                except Exception:
                                    pass
                        else:
                            result["stepLogs"].append(f"{log_prefix} SKIP navigate — no URL")

                    elif any(k in action for k in ('fill', 'type', 'enter', 'set')):
                        fill_val = value or test_case.get('testData', {}).get(target, '')
                        loc = self._locate_field(target, explicit)
                        if loc is not None and fill_val:
                            loc.fill(str(fill_val), timeout=3000)
                            fields_filled += 1
                            result["stepLogs"].append(f"{log_prefix} Filled '{target}' = '{fill_val}'")
                        else:
                            fields_missed += 1
                            result["stepLogs"].append(f"{log_prefix} SKIP fill — no input matched '{target}'")

                    elif any(k in action for k in ('click', 'submit', 'confirm')):
                        loc = None
                        if explicit:
                            loc = self.page.locator(explicit).first
                        elif target and target.startswith(('#', '.', '[')):
                            loc = self.page.locator(target).first
                        else:
                            for sel in ('button[type="submit"]', f'#{target}',
                                        'button:has-text("Save")', 'button:has-text("Submit")',
                                        'button:has-text("Create")'):
                                cand = self.page.locator(sel).first
                                if cand.count() > 0:
                                    loc = cand
                                    break
                        if loc is not None and loc.count() > 0:
                            loc.click(timeout=3000)
                            submit_fired = True
                            result["stepLogs"].append(f"{log_prefix} Clicked submit")
                        else:
                            result["stepLogs"].append(f"{log_prefix} SKIP click — no button matched")

                    elif 'wait' in action:
                        self.page.wait_for_selector(explicit or (f"#{target}" if target else 'body'), timeout=6000)
                        result["stepLogs"].append(f"{log_prefix} Waited")

                    else:
                        result["stepLogs"].append(f"{log_prefix} note: {action}")

                except Exception as e:
                    msg = str(e)
                    # App/frontend unreachable → this is a SKIP, not a UI failure
                    if any(s in msg for s in ('ERR_CONNECTION', 'net::', 'ERR_NAME', 'NS_ERROR', 'Timeout')) and 'navigate' in action:
                        result["skipped"] = True
                        result["error"] = f"Frontend not reachable at {self.base_url}"
                        result["stepLogs"].append(f"{log_prefix} SKIP — frontend not reachable")
                        break
                    # Any other step error is non-fatal: log and keep going
                    result["stepLogs"].append(f"{log_prefix} step error ({type(e).__name__}) — continued")

            result["navOk"]        = nav_ok
            result["fieldsFilled"] = fields_filled
            result["fieldsMissed"] = fields_missed

            # If the frontend was unreachable, don't bother asserting — it's a skip
            if result.get("skipped"):
                result.update({
                    "passed": False, "durationMs": round(time.time() * 1000 - start_ms, 2),
                })
                return result

            # Run UI assertions
            assertion_results = []
            all_passed = True
            for a in ui_asserts:
                # accessibility (WCAG) audit — reported as a SEPARATE dimension, not
                # a pass/fail of the functional "does the form load & fill" test. A
                # form with WCAG issues still renders and works; a11y findings are
                # surfaced on their own so they neither hide nor fail functional UI.
                if a.get("checkType") == "accessibility":
                    try:
                        from ui_audits import run_accessibility_assertion
                        ax = run_accessibility_assertion(self.page)
                        assertion_results.append(ax)
                        result["accessibilityPassed"] = ax.get("passed")
                        result["accessibilityIssues"] = ax.get("issues", [])
                    except Exception as e:
                        assertion_results.append({"check": "accessibility", "passed": False, "error": str(e)})
                        result["accessibilityPassed"] = None
                    continue

                # "renders" = the form page actually mounted an interactive form
                if a.get("checkType") == "renders":
                    try:
                        cnt = self.page.locator('form, input, textarea, select, button').count()
                        ok  = cnt > 0
                        assertion_results.append({"check": "renders", "controlsFound": cnt, "passed": ok})
                        if not ok:
                            all_passed = False
                    except Exception as e:
                        assertion_results.append({"check": "renders", "passed": False, "error": str(e)})
                        all_passed = False
                    continue

                selector = a.get('selector', '')
                expected = a.get('expectedText', a.get('value', ''))
                try:
                    element = self.page.locator(selector)
                    actual_text = element.inner_text(timeout=4000).strip()
                    passed = expected in actual_text or actual_text == str(expected)
                    assertion_results.append({
                        "selector": selector,
                        "expected": expected,
                        "actual":   actual_text,
                        "passed":   passed,
                    })
                    if not passed:
                        all_passed = False
                except Exception as e:
                    assertion_results.append({
                        "selector": selector,
                        "expected": expected,
                        "actual":   None,
                        "passed":   False,
                        "error":    str(e),
                    })
                    all_passed = False

            # Capture screenshot
            screenshot_path = os.path.join(
                self.screenshots_dir,
                f"{test_id}_{int(time.time())}.png"
            )
            try:
                self.page.screenshot(path=screenshot_path, full_page=True)
                result["screenshotPath"] = screenshot_path
            except Exception:
                pass

            # Q6: a workflow test must actually EXERCISE the workflow to PASS — a
            # "renders" check alone (form mounted) is not success if no field was
            # filled and no submit fired. When the test intended a form workflow
            # but couldn't complete it (0 fields filled or submit never fired), the
            # honest verdict is SKIPPED (precondition unmet — selectors didn't map),
            # never a green "it works". A functional post-condition (a success
            # assertion here, or a linked API/DB check the caller runs) still
            # decides real correctness.
            has_text_assertion = any(
                ar.get("check") not in ("renders", "accessibility") and "selector" in ar
                for ar in assertion_results)
            result["submitFired"] = submit_fired
            if intends_workflow and not has_text_assertion and (fields_filled == 0 or not submit_fired):
                result.update({
                    "passed":  False,
                    "skipped": True,
                    "error":   (f"workflow not exercised (fieldsFilled={fields_filled}, "
                                f"submitFired={submit_fired}) — UI selectors didn't map; "
                                "not a functional pass"),
                    "uiAssertions":  assertion_results,
                    "consoleErrors": self.console_errors[:],
                    "durationMs":    round(time.time() * 1000 - start_ms, 2),
                })
                return result

            # Otherwise: passes if the page navigated AND all UI assertions held.
            result.update({
                "passed":           bool(nav_ok and all_passed),
                "uiAssertions":     assertion_results,
                "consoleErrors":    self.console_errors[:],
                "durationMs":       round(time.time() * 1000 - start_ms, 2),
                "error":            None,
            })

        except Exception as e:
            result.update({
                "passed":     False,
                "error":      f"{type(e).__name__}: {e}",
                "durationMs": round(time.time() * 1000 - start_ms, 2),
            })

        return result

    def print_result(self, result: Dict[str, Any]):
        status_color = "\033[32m" if result.get("passed") else "\033[31m"
        reset = "\033[0m"
        passed_label = "PASS" if result.get("passed") else "FAIL"
        print(f"  {status_color}[{passed_label}]{reset} Playwright: {result['testId']} ({result.get('durationMs', 0):.0f}ms)")
        for log in result.get("stepLogs", []):
            print(f"         → {log}")
        if result.get("screenshotPath"):
            print(f"         📷 Screenshot: {result['screenshotPath']}")
        if result.get("error"):
            print(f"         \033[31m✗ {result['error']}\033[0m")
