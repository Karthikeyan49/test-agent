#!/bin/bash
export SYSTEMINTEL_AI_PROVIDER=openai
export SYSTEMINTEL_AI_BASE_URL=https://api.groq.com/openai
export SYSTEMINTEL_AI_MODEL=qwen/qwen3.6-27b
export SYSTEMINTEL_AI_API_KEY="${SYSTEMINTEL_AI_API_KEY:?Set your Groq API key first:  export SYSTEMINTEL_AI_API_KEY=gsk_...}"
export SYSTEMINTEL_HTTP_TIMEOUT=10
export SYSTEMINTEL_HEADLESS=true
export SYSTEMINTEL_SCREENSHOTS_DIR=./screenshots

echo "Starting SystemIntel Scan on test-ecosudar..."
python3 cli.py scan --path /home/karthikeyan/vscode/test-ecosudar --output /home/karthikeyan/vscode/test-ecosudar/system_graph.json

echo -e "\nStarting SystemIntel Test Execution..."
# Provide a dummy baseUrl since we don't have the real app running, or it will try localhost:3000
python3 cli.py test --graph /home/karthikeyan/vscode/test-ecosudar/system_graph.json --format html --output /home/karthikeyan/vscode/test-ecosudar/SystemIntel_Report.html

echo -e "\nRunning AI Agent query to prove AI is working..."
python3 cli.py agent "Analyze the graph and tell me the main architecture of this project" --graph /home/karthikeyan/vscode/test-ecosudar/system_graph.json
