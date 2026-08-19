#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SystemIntel runner tailored to the test-ecosudar project structure:
#   api/                  PHP backend  (routes registered in api/index.php via $router->)
#   database/*.sql        MySQL dump   (81 tables)  → schema source
#   eco-sudar-control/    React/Bun frontend source
#   admin/                compiled Vite bundle (noise — safe to ignore)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$TOOL_DIR"

# Target repo is configurable; defaults to the bundled demo target (repo-relative).
REPO="${1:-./test-ecosudar}"
GRAPH="${SYSTEMINTEL_GRAPH:-./system_graph.json}"
SQL="$REPO/database/u952547820_test (1).sql"   # explicit schema (filename has spaces)

# ── AI (Groq, OpenAI-compatible) ─────────────────────────────────────────────
# Running this uses an EXTERNAL LLM → SYSTEMINTEL_AI_ALLOW_EXTERNAL=1 is explicit
# consent to third-party egress (S5). For private code, use a local provider.
# Key is read from the environment. Prefer:  export SYSTEMINTEL_AI_API_KEY=gsk_...
export SYSTEMINTEL_AI_PROVIDER=openai
export SYSTEMINTEL_AI_BASE_URL=https://api.groq.com/openai
export SYSTEMINTEL_AI_ALLOW_EXTERNAL=1
export SYSTEMINTEL_AI_MODEL="${SYSTEMINTEL_AI_MODEL:-qwen/qwen3.6-27b}"   # or openai/gpt-oss-120b
export SYSTEMINTEL_AI_API_KEY="${SYSTEMINTEL_AI_API_KEY:?Set your Groq key first:  export SYSTEMINTEL_AI_API_KEY=gsk_...}"

# ── Vision (Gemini) — optional, only for form fields DOM introspection can't place ──
# Keep this key OUT of git; rotate it if this file is ever shared.
export SYSTEMINTEL_VISION_API_KEY="${SYSTEMINTEL_VISION_API_KEY:-}"   # optional: export SYSTEMINTEL_VISION_API_KEY=AIza... (Gemini)
export SYSTEMINTEL_VISION_MODEL="${SYSTEMINTEL_VISION_MODEL:-gemini-3.6-flash}"

# ── 1. SCAN → build the System Graph (deterministic; no app/DB needed) ────────
echo "== [1/4] Scanning test-ecosudar =="
python3 cli.py scan --path "$REPO" --sql "$SQL" --output "$GRAPH"

# ── 2. QUERY the graph (offline) ─────────────────────────────────────────────
echo -e "\n== [2/4] Example query =="
python3 cli.py query "give me the connection of ProductController" --graph "$GRAPH"

# ── 3. TEST generation/execution ─────────────────────────────────────────────
# NOTE: the live API is production (https://api.ecosudar.com/api) and the MySQL
# DB creds live in a server-side .env that is NOT in this repo. So by default we
# run OFFLINE: tests are generated from the graph, HTTP assertions get skipped
# (connection refused), and DB assertions are skipped (no --db). This produces a
# report but verifies nothing live.
echo -e "\n== [3/4] Test generation (offline — nothing live is hit) =="
python3 cli.py test --graph "$GRAPH" --no-browser \
    --base-url http://localhost:3000 \
    --format html --output ./SystemIntel_Report.html

# To run REAL assertions, stand up a LOCAL copy first, then uncomment & fill in:
#   1. serve the PHP api/ locally      (e.g. php -S localhost:8000 -t api)
#   2. import the dump into a test DB   (mysql testdb < "database/u952547820_test (1).sql")
# python3 cli.py test --graph "$GRAPH" --no-browser \
#     --base-url http://localhost:8000 \
#     --db mysql --db-host localhost --db-name u952547820_test \
#     --db-user root --db-password '' \
#     --format html --output "$REPO/SystemIntel_Report.html"

# ── 4. AGENT (grounded on the graph via Groq) ────────────────────────────────
echo -e "\n== [4/4] Autonomous agent =="
python3 cli.py agent "Which controller handles orders, what routes point to it, and what DB tables does the order workflow touch?" --graph "$GRAPH"

echo -e "\nDone. Graph: $GRAPH  |  Report: ./SystemIntel_Report.html"
