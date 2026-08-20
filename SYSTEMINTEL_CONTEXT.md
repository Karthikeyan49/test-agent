# SystemIntel: Autonomous Software System Intelligence & Testing Platform
**Comprehensive Technical Architecture, Context, and Requirements Documentation**

---

## 1. Executive Summary & Product Objective

SystemIntel is an advanced, production-grade autonomous developer and testing platform designed to entirely map, understand, and automatically test large-scale enterprise software applications. 

Modern enterprise software systems—like ERPs, CRMs, and complex SaaS platforms—are deeply layered. A single business action (e.g., "Create Customer") begins at a UI form, translates into an HTTP request, passes through API gateways, hits backend controllers, routes to business logic services, interfaces with an Object-Relational Mapper (ORM) or repository layer, and finally alters rows in a relational database.

When humans test or debug these systems, they must manually build a mental model of this entire chain. SystemIntel automates this entirely.

> **Scope note (honest):** the engine is **primarily built and validated for PHP + React**
> applications (the bundled `test-ecosudar` target). Route detection exists for several other
> frameworks, but the full multi-layer oracle stack is proven on the PHP stack; treat other
> stacks as experimental until validated on a second target. See the support matrix in `README.md`.

The objective of SystemIntel is to ingest:
1.  **Frontend Source Code** (React, Vue, HTML, etc.)
2.  **Backend Source Code** (Node.js, Python, Java, etc.)
3.  **Database Schemas** (SQL DDL files, Prisma schemas)
4.  **API Definitions** (OpenAPI, Swagger YAML/JSON)
5.  **Configuration Files** (.env, JSON, YAML)
6.  **Existing Test Suites** (Jest, Pytest, Mocha)
7.  **Runtime Execution Traces** (HAR files, server access logs)

From this raw data, SystemIntel systematically constructs a **System Graph**—a mathematically rigorous, machine-readable representation of the entire application architecture. It then uses this graph to autonomously generate tests, execute them across UI, API, and DB layers, and perform AI-assisted root-cause analysis when failures occur.

---

## 2. Core Philosophy: Strict Determinism vs. AI Assistance

A critical requirement of SystemIntel is the strict separation between **Deterministic Fact-Finding** and **Probabilistic AI Reasoning**.

### 2.1 The Danger of LLM Hallucination in Architecture
Large Language Models (LLMs) are exceptionally powerful at reasoning, but they are inherently probabilistic. If an LLM is asked to map the connectivity of a 1,000-file repository, it is highly likely to "hallucinate" file names, assume standard REST patterns that don't actually exist in the specific codebase, or miss subtle edge cases. 

If the foundational map of the system is hallucinated, all subsequent automated tests and root-cause analyses will be flawed.

### 2.2 The Deterministic Foundation (Systematic Parsing)
To solve this, SystemIntel strictly forbids the use of AI for building the System Graph.
Instead, the graph is constructed **systematically and deterministically** using:
*   **Regular-expression / pattern-based static analysis:** the current parser (`backend/engine.py`)
    is regex-driven (not a full AST). It recognises common framework conventions to extract
    routes, controllers, SQL, fields, and FK constraints.
*   **SQL DDL parsing:** `CREATE TABLE` / `FOREIGN KEY` extraction for the ERD.
*   **Static tracing** of controller → service → repository chains and inline SQL.

Because the graph is built from the source (never a model's recall), an edge that **exists** is
grounded in a matched line of code. **Honest caveat:** regex parsing has coverage limits — code
that deviates from the recognised conventions can be missed, so a **missing** edge does not prove
"no such link exists". Files that fail to parse are now surfaced as a coverage warning after a
scan (rather than silently dropped), and moving to a real AST / `tree-sitter` backend is tracked
as future work. Treat the graph as high-precision, best-effort-recall — not provably complete.

### 2.3 The AI Layer (Reasoning on top of Facts)
AI (powered by local models like Ollama/vLLM or external APIs like OpenAI) is introduced *only after* the deterministic graph is built. The AI acts as a reasoning engine constrained by hard facts.
*   **Graph Querying:** When a user asks "Where is `customer_id` used?", the AI receives a highly filtered subset of the deterministic graph and formulates a human-readable answer.
*   **Failure Analysis:** If a test fails with a cryptic HTTP 500 error, the AI reads the stack trace, cross-references it with the deterministic graph, and suggests exactly which file and line number to investigate.

---

## 3. The System Graph: Bidirectional Data Lineage

The core data structure of SystemIntel is the System Graph. It maps the complete lifecycle of data through the application layers.

### 3.1 Node Types
The graph consists of various specialized nodes:
*   `Page`: A frontend view or route (e.g., `/customers`).
*   `Component`: A reusable UI element.
*   `Field`: A specific input mechanism (e.g., `<input id="email">`).
*   `APIEndpoint`: A backend REST route (e.g., `POST /api/v1/customers`).
*   `Controller`: The backend routing logic class.
*   `Service`: The business logic class.
*   `Repository`: The database access class.
*   `Table`: A relational database table.
*   `Column`: A specific field within a table.

### 3.2 Edge Relationships (Connectivity)
Nodes are connected by definitive, discovered relationships:
*   `NAVIGATES_TO`: A `Page` linking to another `Page` (inter-page navigation).
*   `CONTAINS_FIELD`: A `Page` rendering a `Field`.
*   `SUBMITS_TO`: A `Field` (or its parent form) making an HTTP request to an `APIEndpoint` (outside module connectivity).
*   `IMPLEMENTED_BY`: An `APIEndpoint` mapping to a `Controller`.
*   `CALLS`: A `Controller` invoking a `Service` (inter-module connectivity).
*   `READS_FROM` / `WRITES_TO`: A `Repository` executing SQL against a `Table`.
*   `CONTAINS`: A `Table` possessing a `Column`.
*   `REFERENCES`: A `Column` holding a Foreign Key to another `Column`.

### 3.3 Graph Capabilities
With this structure in place, the engine can perform powerful operations:
1.  **Upstream Tracing:** "What UI fields eventually write data into the `credit_limit` database column?"
2.  **Downstream Impact Analysis:** "If I change the `CustomerController`, what frontend pages might break?"
3.  **Workflow Discovery:** By performing Breadth-First Search (BFS) traversals that cross at least three distinct architectural layers (e.g., Page → API → Table), the system automatically discovers full business workflows without human input.

---

## 4. Platform Architecture & Module Deep Dives

SystemIntel is entirely terminal-native, driven by `cli.py`, with no dependency on a web UI. The architecture is modularized into specialized Python engines.

### 4.1 The Ingestion Engine (`file_scanner.py`)
This module is responsible for the initial pass over the target repository.
*   **Recursive Traversal:** Uses highly optimized file system walks to discover all files.
*   **Noise Filtering:** Automatically skips irrelevant directories like `node_modules`, `.git`, `dist`, `build`, and `__pycache__` to ensure performance.
*   **Classification:** Categorizes files based on extensions and content:
    *   Frontend: `.jsx`, `.tsx`, `.vue`, `.svelte`
    *   Backend: `.ts`, `.py`, `.java`, `.go`, `.php`
    *   Schema: `.sql`, `.prisma`
    *   OpenAPI: `.yaml`, `.json` (matching specific swagger/openapi patterns)
    *   Tests: `.spec.js`, `.test.ts`, `test_*.py`
    *   Traces: `.har`, `.log`

### 4.2 The Deterministic Parser (`engine.py`)
This is the heart of the systematic fact-finding process. It reads the raw text of the files identified by the scanner and extracts structural meaning.
*   **Frontend Parsing:** Scans for HTML inputs, React `useState` bindings, and `fetch`/`axios` calls. It captures IDs, placeholders, and required attributes.
*   **Backend Parsing:** Uses regex and AST-like pattern matching to find class definitions, method decorators (like `@app.post`), and inline SQL statements.
*   **Database Schema Parsing:** Reads raw SQL DDL (Data Definition Language). It dynamically parses `CREATE TABLE` blocks, extracts column names and data types, and maps `FOREIGN KEY` constraints.
*   **OpenAPI Parsing:** Utilizes `PyYAML` to parse structured API definitions, extracting paths, HTTP verbs, and operation IDs.
*   **Test & Trace Parsing:** Extracts existing test names from spec files and HTTP requests from HAR files.

### 4.3 The Graph Builder (`graph_builder.py`)
Takes the disparate lists of pages, fields, APIs, and tables generated by `engine.py` and weaves them together.
*   **Edge Creation:** It executes logic like: "If `Page A` contains an API call to `/api/users`, and `Backend File B` defines a route for `/api/users`, draw an edge between them."
*   **Workflow BFS:** Implements a Breadth-First Search algorithm that starts at every discovered `Page`. It walks the edges, attempting to find a path that ends at a database `Table`. When successful, it records this path as a "Discovered Business Workflow."

### 4.4 The Autonomous Test Generator
Using the completed System Graph, this module generates actionable test scenarios.
*   It identifies an API endpoint and the UI fields that submit to it.
*   It formulates a sequence of steps: Navigate to the page, fill out the specific fields, click the submit button.
*   It generates multi-layer assertions:
    1.  **UI Assertion:** Ensure the success message is visible.
    2.  **API Assertion:** Ensure the HTTP response is 200 or 201.
    3.  **DB Assertion:** Ensure the database row count for the target table increased by 1, and the specific column values match the input.

### 4.5 The Multi-Layer Execution Engines
Tests are not merely theoretical; SystemIntel executes them against live environments.

#### 4.5.1 UI Runner (`playwright_runner.py`)
*   Integrates with Microsoft Playwright (`playwright.sync_api`).
*   Launches a real headless Chromium browser.
*   Translates test steps into actual browser commands: `page.goto()`, `page.fill()`, `page.click()`.
*   Captures full-page screenshots for visual evidence and intercepts browser console logs to catch JavaScript errors.

#### 4.5.2 API Runner (`http_runner.py`)
*   Utilizes the robust `httpx` library.
*   Fires real HTTP requests to the target backend server.
*   Measures latency, verifies exact HTTP status codes, and can assert against JSON response bodies.

#### 4.5.3 Database Runner (`db_runner.py`)
*   Supports native connections to SQLite (`sqlite3`), PostgreSQL (`psycopg2`), and MySQL (`mysql-connector-python`).
*   Executes raw `SELECT` queries directly against the test database to prove, beyond any doubt, that data persisted correctly.

### 4.6 The Dynamic Failure Analyzer (`failure_analyzer.py`)
When a test fails, diagnosing the root cause is notoriously difficult. SystemIntel automates this by correlating the failure with the System Graph.
*   If the `http_runner` reports a 500 Internal Server Error on `POST /sales`, the analyzer queries the graph to find exactly which Controller and Service handle `POST /sales`.
*   If the `db_runner` reports that a row was not inserted into the `inventory` table, the analyzer queries the graph upstream to find the Repository class responsible for writing to `inventory`.
*   It then outputs these specific file names and line numbers to the developer, drastically reducing debugging time.
*   If the AI provider is enabled, it packages the error logs and the graph context and asks the LLM to provide a human-readable hypothesis.

### 4.7 The AI Provider (`ai_provider.py`)
The gateway to intelligent reasoning.
*   Connects to local models (Ollama, vLLM) or remote APIs (OpenAI).
*   Used for natural language Q&A (e.g., querying the graph context).
*   Used for advanced failure diagnosis.
*   Designed to fail gracefully; if the AI is offline or disabled, the deterministic platform continues to function perfectly without it.

### 4.8 The Command Line Interface (`cli.py`)
The unified entry point for the entire platform. It provides three primary commands:
1.  `scan`: Ingests the repository, builds the graph, and outputs a machine-readable JSON representation.
2.  `test`: Generates tests from the graph, executes them via Playwright/HTTP/DB runners, and generates comprehensive reports.
3.  `query`: Allows the user to ask natural language questions about the architecture.

---

## 5. Reporting and Output Formats

SystemIntel generates enterprise-grade reports detailing the results of the automated testing and graph discovery.

### 5.1 JSON Reporting
For integration into CI/CD pipelines (Jenkins, GitHub Actions, GitLab CI), the platform exports a deeply structured JSON file containing:
*   Total tests run, passed, failed, and duration.
*   Exact step-by-step logs for every test.
*   Detailed assertions for UI, API, and DB layers.
*   Root-cause hypotheses generated by the failure analyzer.

### 5.2 HTML Reporting
For human consumption by QA engineers and management, `cli.py` can generate a styled, standalone HTML report.
*   Provides an Executive Summary with color-coded pass rates.
*   Displays Coverage Metrics (how many pages/APIs were discovered vs. tested).
*   Lists all test executions in an easy-to-read tabular format with badges for PASS/FAIL status.

---

## 6. Setup, Configuration, and Workflow

### 6.1 Prerequisites
*   Python 3.8+
*   Playwright dependencies (`python -m playwright install chromium`)
*   Database drivers (e.g., `psycopg2-binary` for PostgreSQL)

### 6.2 Typical Execution Workflow
1.  **Initialize:** Ensure the target application (frontend, backend, database) is running locally or in a accessible staging environment.
2.  **Scan:** Run `python3 cli.py scan --path /path/to/repo`. The engine parses all code deterministically and builds `system_graph.json`.
3.  **Test:** Run `python3 cli.py test --graph system_graph.json --base-url http://localhost:3000 --db postgresql --db-host localhost --db-name testdb --db-user admin --format html`.
4.  **Review:** Open the generated `SystemIntel_Report.html` to view the results of the multi-layer execution, or use `cli.py query` to interrogate the discovered architecture.

### 6.3 Targeted Node Connectivity Queries
The CLI allows users to specifically isolate and trace the incoming (upstream) and outgoing (downstream) connections of any single node (Page, Field, API, or Database Table). 

**Example Usage:**
`python3 cli.py query "give me the connection of SalesOrderPage"`
`python3 cli.py query "connection of field-quantity"`

**What It Does:**
Instead of a broad AI summary, the deterministic graph is queried to return the exact edges for that specific entity.
*   **For a Page:** It will list all incoming links (which pages route *to* it) and all outgoing links (which pages it routes *to*, and which fields it contains).
*   **For a Field:** It will list its parent page (incoming) and the specific API endpoints it submits its data to (outgoing).
*   **For an API Endpoint:** It will list the frontend fields that trigger it (incoming) and the backend Controllers that implement it (outgoing).

---

## 7. The Autonomous AI Agent (ReAct Loop)

SystemIntel features a fully autonomous AI agent built directly into the platform, similar to Claude Code or Codex. Instead of relying on rigid, single-shot queries, the agent uses a **Reasoning + Acting (ReAct)** loop to solve high-level tasks autonomously.

### 7.1 How It Works
When given a task (e.g., *"Find the bug in the customer creation workflow and fix it"*), the agent does not immediately guess the answer. Instead, it enters an iterative loop:
1. **Thought:** The agent reasons about what it needs to know to solve the task.
2. **Action:** It calls a specific tool to gather data or perform an action.
3. **Observation:** The tool executes deterministically (e.g., reading a file, querying the graph) and returns the output to the agent.
4. **Repeat:** The agent processes the observation, reasons about the next step, and acts again until it has enough context to formulate a `FINAL_ANSWER`.

### 7.2 Built-In Agent Tools
The agent has autonomous access to the following tools:
*   `QUERY_GRAPH`: It can search the deterministic System Graph to find nodes matching specific keywords (e.g., finding the ID of the `CustomerController`).
*   `GET_NODE_LINKS`: It can query the exact incoming (upstream) and outgoing (downstream) edges of any specific node to trace data flow.
*   `READ_FILE`: It can read the raw source code of any file in the repository to inspect the implementation details.

### 7.3 Usage
You can invoke the autonomous agent from the CLI:
`python3 cli.py agent "Analyze the graph and tell me how the credit_limit field is saved to the database" --graph system_graph.json`

The terminal will stream the agent's internal thoughts, the tools it decides to use, and its final resolution.

---

## 7A. Test-Depth Capabilities (implemented — see `COVERAGE_UPGRADE.md`)

The following coverage-depth capabilities are implemented, each backed by a
deterministic self-test in the pytest harness (`tests/test_selftests.py`, 29/29 green):

* **Per-field completeness + in/out edge oracle** (`field_edge_oracle.py`): for a field
  the graph knows, the value SUBMITTED (SUBMITS_TO) is compared against the value STORED
  (WRITES_TO column) and READ BACK (read endpoint / cross-page). A provable corruption
  (truncation / silent-drop / encoding-change) is a FAIL with before/after; a leg with no
  evidence is a SKIP — never a PASS.
* **Honest field-coverage accounting** (`field_blackbox.field_coverage_report`): the true
  denominator across the union of DB columns + request-contract fields + page-docs UI
  fields, reporting which fields were exercised and which were not (with the reason).
* **Combinatorial (pairwise) generation** (`combinatorial.py`): a deterministic t-wise
  covering array so multiple fields can be wrong together, bounded per endpoint — beyond
  single-fault isolation.
* **Requirement (intent) oracle** (`requirement_oracle.py`): judges the machine-checkable
  subset of requirements (page-docs use-cases / OpenAPI) as PASS/FAIL/SKIP. A vague NL
  requirement that cannot be grounded is SKIP ("not machine-checkable"), never a fake PASS.
* **Page-docs RAG → AI, with an honest offline path** (`graph_rag`, `ai_provider`): the
  page-docs corpus is ingested as first-class retrievable documents; scenario proposals go
  to a live model when reachable + S5-consented, else fall back to a deterministic
  `offline-rag` result explicitly tagged `ai=False` so it is never mistaken for the model's
  output.
* **Mutation at repo scale** (`mutation.py`): repo-wide mutant discovery + a stratified,
  seeded, bounded executor that always reports discovered-vs-executed (a sampled score is
  never read as full coverage). Restores source byte-for-byte, CRLF-safe.

**Bug fixes shipped with the above:** the Q2 auth-token gap (a credential supplied via an
`Authorization` / `Cookie` header — how `--auth-token` / `--auth-cookie` arrive — now
credits the auth-skip decision, so a real 401/403 is a genuine result, not a wrongly
SKIPPED test), and the S4 CRLF mutation-restore fix.

**Also wired since:** the edge + requirement oracles are auto-invoked on **both** the
scenario runner and the flat `test` path (a real read-back GET + DB-row read per write),
and mutation is **scoped to the mutated file's endpoints** (`--mutate-scope auto`) so a
live kill score is fast. The UI browser path is proven end-to-end (real login + five
protected pages audited live).

**Honestly still open:** exhaustive per-page / per-field UI *breadth* (a volume-of-runs
exercise, not a capability gap — data-backed pages also need seeded rows).

---

## 8. Conclusion

SystemIntel represents a paradigm shift in software testing and quality assurance. By replacing brittle, manually maintained UI tests with an autonomously generated, multi-layered, graph-backed testing engine, development teams can achieve unprecedented coverage and confidence. 

Furthermore, by strictly isolating deterministic graph construction from probabilistic AI reasoning, SystemIntel ensures that its architectural understanding is mathematically rigorous, eliminating the risk of LLM hallucinations while still benefiting from autonomous AI agents, intelligent debugging, and natural language querying.
