"""
Spec / Contract Oracle for SystemIntel (Phase 6 — the intent oracle).

Most generated tests only know *"did it run"*, not *"is this the documented
behavior"*. When the user actually HAS an OpenAPI 3.x / Swagger 2.0 document,
we can do better: the spec IS the source of truth for expected behavior. This
module turns that spec into deterministic, runner-ready test-case dicts.

For every ``path + HTTP method`` operation it derives three kinds of tests:

  1. HAPPY PATH        — expect the first documented 2xx status code.
  2. REQUIRED-FIELD    — for each required request field, omit exactly that one
     NEGATIVES           field (keeping the others) and expect the first
                         documented 4xx (default 400).
  3. DOCUMENTED ERRORS — one branch test per documented 401 / 403 / 404 response.

Every emitted dict matches the shape the existing SystemIntel runner (see
``backend/engine.py`` and ``backend/http_runner.py``) already consumes, so these
tests can simply be appended to the generated test list — e.g. via a future
``--openapi <file>`` option on the ``test`` command in ``cli.py``.

Public API
----------
    generate_spec_tests(spec_content: str) -> list[dict]
    generate_spec_tests_from_file(path: str) -> list[dict]
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

try:  # PyYAML is installed in this environment; JSON is a valid YAML subset,
    import yaml  # so a single safe_load handles both YAML and JSON specs.
    _HAS_YAML = True
except Exception:  # pragma: no cover - defensive: fall back to json-only.
    _HAS_YAML = False


# HTTP methods we recognise as operations on a path item. Anything else
# (parameters, summary, description, servers, $ref, ...) is skipped.
_HTTP_METHODS = ("get", "put", "post", "delete", "patch", "options", "head", "trace")

# Documented client-error branches we surface as dedicated tests.
_DOCUMENTED_ERROR_CODES = (401, 403, 404)


# --------------------------------------------------------------------------- #
# Parsing helpers
# --------------------------------------------------------------------------- #
def _parse_spec(spec_content: str) -> Dict[str, Any]:
    """Parse a spec string that may be YAML or JSON.

    Tries ``yaml.safe_load`` first (a JSON document is valid YAML), then falls
    back to ``json.loads``. Returns an empty dict if nothing usable parses out,
    so callers never have to guard against ``None``.
    """
    if not spec_content or not spec_content.strip():
        return {}

    if _HAS_YAML:
        try:
            parsed = yaml.safe_load(spec_content)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass  # fall through to json

    try:
        parsed = json.loads(spec_content)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    return {}


def _is_openapi3(spec: Dict[str, Any]) -> bool:
    """True when the document self-identifies as OpenAPI 3.x."""
    return str(spec.get("openapi", "")).startswith("3")


def _resolve_ref(spec: Dict[str, Any], node: Any) -> Any:
    """Follow a single local ``$ref`` (``#/a/b/c``) one level deep.

    Returns the referenced sub-document, or ``None`` when the node is a ``$ref``
    that we cannot resolve (external file, malformed pointer, missing target).
    Non-ref nodes are returned unchanged.
    """
    if not isinstance(node, dict) or "$ref" not in node:
        return node

    ref = node["$ref"]
    if not isinstance(ref, str) or not ref.startswith("#/"):
        return None  # external/remote ref we deliberately skip

    target: Any = spec
    for part in ref[2:].split("/"):
        # JSON-Pointer un-escaping (~1 -> "/", ~0 -> "~").
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(target, dict) and part in target:
            target = target[part]
        else:
            return None
    return target


def _deref(spec: Dict[str, Any], node: Any, _depth: int = 0) -> Any:
    """Resolve chained top-level ``$ref``s, guarding against cycles/malformed refs."""
    seen = 0
    while isinstance(node, dict) and "$ref" in node and seen < 20:
        node = _resolve_ref(spec, node)
        seen += 1
    return node


def _normalize_responses(operation: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Return the operation's ``responses`` map with keys coerced to strings."""
    responses = operation.get("responses")
    if not isinstance(responses, dict):
        return {}
    return {str(code): (val if isinstance(val, dict) else {}) for code, val in responses.items()}


def _first_status_in_class(responses: Dict[str, Dict[str, Any]], klass: str) -> Optional[int]:
    """First *documented* numeric status code in a class ('2', '4', ...).

    Iterates in document order (YAML/JSON parsing preserves key order), so the
    result is the first response of that class as written in the spec. Returns
    ``None`` when the class is absent.
    """
    for code in responses:
        if len(code) == 3 and code[0] == klass and code.isdigit():
            return int(code)
    return None


# --------------------------------------------------------------------------- #
# Request-model extraction (required fields + property schemas)
# --------------------------------------------------------------------------- #
def _example_value(field: str, schema: Optional[Dict[str, Any]]) -> Any:
    """Synthesize a plausible example value for a request field.

    Prefers explicit ``example`` / ``default`` / ``enum`` hints from the schema,
    then falls back to a type- and name-based heuristic so bodies are realistic
    enough for a real backend to accept (mirrors ``engine.py``'s ``fake_value``).
    """
    schema = schema if isinstance(schema, dict) else {}

    if "example" in schema:
        return schema["example"]
    if "default" in schema:
        return schema["default"]
    enum = schema.get("enum")
    if isinstance(enum, list) and enum:
        return enum[0]

    typ = schema.get("type")
    fmt = str(schema.get("format", "")).lower()
    name = field.lower()

    if typ == "boolean":
        return True
    if typ == "integer":
        return 10
    if typ == "number":
        return 10.5
    if typ == "array":
        return []
    if typ == "object":
        return {}

    # string (or unknown) — lean on format then field-name heuristics.
    if fmt in ("email",) or "email" in name:
        return "test@example.com"
    if fmt in ("date",) or name.endswith("date"):
        return "2025-01-01"
    if fmt in ("date-time", "datetime"):
        return "2025-01-01T00:00:00Z"
    if fmt in ("uuid",) or name.endswith("id"):
        return "00000000-0000-0000-0000-000000000000"
    if "phone" in name or "mobile" in name:
        return "9999999999"
    if any(k in name for k in ("amount", "price", "qty", "quantity", "count",
                               "limit", "balance", "total", "number")):
        return 10
    return f"test-{field}"


def _extract_request_model(
    spec: Dict[str, Any], operation: Dict[str, Any], is_v3: bool
) -> Tuple[List[str], Dict[str, Dict[str, Any]]]:
    """Return ``(required_fields, property_schemas)`` for an operation's request.

    * OpenAPI 3.x — read ``requestBody.content.<media>.schema`` (``application/json``
      preferred), taking its ``required`` list and ``properties`` map.
    * Swagger 2.0 — read the ``in: body`` parameter's schema, plus any required
      non-body parameters (query / formData / path), which are each themselves a
      required field.

    ``property_schemas`` maps every field name we know about to its (best-effort)
    schema, used to build realistic example values. Missing / unresolvable
    sections degrade to empty results rather than raising.
    """
    required: List[str] = []
    properties: Dict[str, Dict[str, Any]] = {}

    if is_v3:
        request_body = _deref(spec, operation.get("requestBody"))
        if isinstance(request_body, dict):
            content = request_body.get("content")
            if isinstance(content, dict) and content:
                media = content.get("application/json") or next(iter(content.values()), {})
                schema = _deref(spec, (media or {}).get("schema"))
                required, properties = _schema_required_and_props(spec, schema)
    else:
        # Swagger 2.0 — parameters carry both the body schema and required fields.
        for param in _iter_parameters(spec, operation):
            location = param.get("in")
            if location == "body":
                schema = _deref(spec, param.get("schema"))
                b_required, b_props = _schema_required_and_props(spec, schema)
                for f in b_required:
                    if f not in required:
                        required.append(f)
                properties.update(b_props)
            elif param.get("required") and param.get("name"):
                name = param["name"]
                if name not in required:
                    required.append(name)
                # A Swagger2 non-body param carries its type inline.
                properties.setdefault(name, {k: param[k] for k in ("type", "format", "enum")
                                             if k in param})

    return required, properties


def _schema_required_and_props(
    spec: Dict[str, Any], schema: Any
) -> Tuple[List[str], Dict[str, Dict[str, Any]]]:
    """Pull ``required`` + ``properties`` out of a (possibly ``$ref``'d) object schema."""
    schema = _deref(spec, schema)
    if not isinstance(schema, dict):
        return [], {}

    required = [f for f in schema.get("required", []) if isinstance(f, str)]

    properties: Dict[str, Dict[str, Any]] = {}
    raw_props = schema.get("properties")
    if isinstance(raw_props, dict):
        for name, prop in raw_props.items():
            resolved = _deref(spec, prop)
            properties[name] = resolved if isinstance(resolved, dict) else {}

    return required, properties


def _iter_parameters(spec: Dict[str, Any], operation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return an operation's parameters, each ``$ref``-resolved, ignoring junk."""
    result = []
    for param in operation.get("parameters", []) or []:
        resolved = _deref(spec, param)
        if isinstance(resolved, dict):
            result.append(resolved)
    return result


# --------------------------------------------------------------------------- #
# Test-case construction
# --------------------------------------------------------------------------- #
def generate_spec_tests(spec_content: str) -> List[Dict[str, Any]]:
    """Derive Spec/Contract test cases from an OpenAPI 3.x / Swagger 2.0 document.

    Parameters
    ----------
    spec_content:
        The raw spec text, in YAML or JSON. May be an OpenAPI 3.x or a Swagger
        2.0 document.

    Returns
    -------
    list[dict]
        Runner-ready test-case dicts (``technique="SPEC_ORACLE"``,
        ``category="Spec / Contract"``). Returns whatever could be derived; an
        unparseable or empty spec yields ``[]`` rather than raising.
    """
    spec = _parse_spec(spec_content)
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return []

    is_v3 = _is_openapi3(spec)
    tests: List[Dict[str, Any]] = []
    counter = [0]

    def add(
        title: str,
        assertions: List[Dict[str, Any]],
        evidence: List[Dict[str, Any]],
        test_data: Optional[Dict[str, Any]] = None,
        priority: str = "high",
    ) -> None:
        counter[0] += 1
        case: Dict[str, Any] = {
            "id":            f"SPEC-{counter[0]:03d}",
            "title":         title,
            "category":      "Spec / Contract",
            "technique":     "SPEC_ORACLE",
            "priority":      priority,
            "status":        "CONFIRMED",
            "confidence":    0.95,
            "steps":         [],
            "assertions":    assertions,
            "sourceEvidence": evidence,
        }
        if test_data is not None:
            case["testData"] = test_data
        tests.append(case)

    for raw_path, path_item in paths.items():
        path_item = _deref(spec, path_item)
        if not isinstance(path_item, dict):
            continue

        for method in _HTTP_METHODS:
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue

            try:
                _emit_operation_tests(spec, is_v3, raw_path, method, operation, add)
            except Exception:
                # Never let one malformed operation sink the whole batch.
                continue

    return tests


def _emit_operation_tests(
    spec: Dict[str, Any],
    is_v3: bool,
    raw_path: str,
    method: str,
    operation: Dict[str, Any],
    add,
) -> None:
    """Emit the happy-path, required-field-negative, and documented-error tests
    for a single ``path + method`` operation."""
    http_method = method.upper()
    endpoint = f"{http_method} {raw_path}"
    responses = _normalize_responses(operation)

    required, properties = _extract_request_model(spec, operation, is_v3)

    def evidence(detail: str, **extra: Any) -> List[Dict[str, Any]]:
        ev: Dict[str, Any] = {
            "spec":   detail,
            "path":   raw_path,
            "method": http_method,
        }
        ev.update(extra)
        return [ev]

    # --- 1. HAPPY PATH ----------------------------------------------------- #
    success_code = _first_status_in_class(responses, "2")
    if success_code is None:
        success_code = 201 if http_method == "POST" else 200

    happy_body = {f: _example_value(f, properties.get(f)) for f in required}
    happy_assertion: Dict[str, Any] = {
        "type":               "API",
        "endpoint":           endpoint,
        "expectedStatusCode": success_code,
    }
    if happy_body:
        happy_assertion["body"] = dict(happy_body)
    add(
        f"[Spec] {endpoint} → {success_code}",
        [happy_assertion],
        evidence(f"documented {success_code} success response for {endpoint}",
                 responseCode=success_code),
        test_data=dict(happy_body) if happy_body else None,
    )

    # --- 2. REQUIRED-FIELD NEGATIVES -------------------------------------- #
    error_code = _first_status_in_class(responses, "4") or 400
    for field in required:
        # Body carrying every OTHER required field, but omitting THIS one.
        partial_body = {
            other: _example_value(other, properties.get(other))
            for other in required
            if other != field
        }
        add(
            f"[Spec] {endpoint} missing '{field}' → {error_code}",
            [{
                "type":               "API",
                "endpoint":           endpoint,
                "expectedStatusCode": error_code,
                "body":               dict(partial_body),
            }],
            evidence(
                f"'{field}' is a required request field; omitting it must yield "
                f"{error_code}",
                field=field,
                responseCode=error_code,
            ),
            test_data=dict(partial_body),
        )

    # --- 3. DOCUMENTED ERRORS (401 / 403 / 404) --------------------------- #
    for code in _DOCUMENTED_ERROR_CODES:
        if str(code) in responses:
            add(
                f"[Spec] {endpoint} → {code} (documented)",
                [{
                    "type":               "API",
                    "endpoint":           endpoint,
                    "expectedStatusCode": code,
                    "softMatch":          True,
                }],
                evidence(f"documented {code} error response for {endpoint}",
                         responseCode=code),
                priority="medium",
            )


def generate_spec_tests_from_file(path: str) -> List[Dict[str, Any]]:
    """Read a spec file from ``path`` and derive test cases from it.

    Convenience wrapper over :func:`generate_spec_tests`. A missing or unreadable
    file yields ``[]`` rather than raising, keeping call sites terse.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            content = fh.read()
    except Exception:
        return []
    return generate_spec_tests(content)


# --------------------------------------------------------------------------- #
# Self-test
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    _SAMPLE_SPEC = """
openapi: "3.0.3"
info:
  title: Customers API
  version: "1.0.0"
paths:
  /customers:
    post:
      summary: Create a customer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
                - email
              properties:
                name:
                  type: string
                email:
                  type: string
                  format: email
                creditLimit:
                  type: integer
      responses:
        '201':
          description: Customer created
        '400':
          description: Invalid request body
  /customers/{id}:
    get:
      summary: Fetch a customer by id
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: The customer
        '404':
          description: No such customer
"""

    generated = generate_spec_tests(_SAMPLE_SPEC)

    for tc in generated:
        print(tc["title"])

    def _first_assertion(tc: Dict[str, Any]) -> Dict[str, Any]:
        return (tc.get("assertions") or [{}])[0]

    # (a) happy-path POST /customers → 201
    assert any(
        _first_assertion(tc).get("endpoint") == "POST /customers"
        and _first_assertion(tc).get("expectedStatusCode") == 201
        and tc["technique"] == "SPEC_ORACLE"
        for tc in generated
    ), "expected a happy-path test for POST /customers → 201"

    # (b) missing-'email' negative → 400
    assert any(
        "missing 'email'" in tc["title"]
        and _first_assertion(tc).get("expectedStatusCode") == 400
        for tc in generated
    ), "expected a missing-'email' negative test → 400"

    # The omitting body must keep the OTHER required field ('name') and drop email.
    email_neg = next(tc for tc in generated if "missing 'email'" in tc["title"])
    assert "name" in email_neg["testData"] and "email" not in email_neg["testData"], \
        "missing-'email' body must include 'name' but omit 'email'"

    # (c) documented 404 branch for GET /customers/{id}
    assert any(
        _first_assertion(tc).get("endpoint") == "GET /customers/{id}"
        and _first_assertion(tc).get("expectedStatusCode") == 404
        for tc in generated
    ), "expected a 404 branch test for GET /customers/{id}"

    print("SELF-TEST PASS")
