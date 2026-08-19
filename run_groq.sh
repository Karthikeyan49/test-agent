#!/bin/bash
# Example runner using Groq (an EXTERNAL LLM). Running this script means you
# consent to sending repo snippets/schema to Groq — hence SYSTEMINTEL_AI_ALLOW_EXTERNAL=1.
# For private code, prefer a local provider (ollama) and drop that line.
set -euo pipefail

export SYSTEMINTEL_AI_PROVIDER=openai
export SYSTEMINTEL_AI_BASE_URL=https://api.groq.com/openai
export SYSTEMINTEL_AI_MODEL=qwen/qwen3.6-27b
export SYSTEMINTEL_AI_API_KEY="${SYSTEMINTEL_AI_API_KEY:?Set your Groq API key first:  export SYSTEMINTEL_AI_API_KEY=gsk_...}"
export SYSTEMINTEL_AI_ALLOW_EXTERNAL=1   # explicit consent to third-party egress (S5)
export SYSTEMINTEL_HTTP_TIMEOUT=10
export SYSTEMINTEL_HEADLESS=true
export SYSTEMINTEL_SCREENSHOTS_DIR=./screenshots

# Target repo + output are configurable; default to the bundled demo target.
TARGET="${1:-./test-ecosudar}"
GRAPH="${SYSTEMINTEL_GRAPH:-./system_graph.json}"

echo "Starting SystemIntel Scan on ${TARGET}..."
python3 cli.py scan --path "${TARGET}" --output "${GRAPH}"

echo -e "\nStarting SystemIntel Test Execution..."
python3 cli.py test --graph "${GRAPH}" --format html --output ./SystemIntel_Report.html

echo -e "\nRunning AI Agent query to prove AI is working..."
python3 cli.py agent "Analyze the graph and tell me the main architecture of this project" --graph "${GRAPH}"
