import httpx, os, sys

key = os.environ.get('SYSTEMINTEL_AI_API_KEY', '')
if not key:
    sys.exit("Set your Groq key first:  export SYSTEMINTEL_AI_API_KEY=gsk_...")

print("Checking available Groq models...")
resp = httpx.get(
    "https://api.groq.com/openai/v1/models",
    headers={"Authorization": f"Bearer {key}"},
    timeout=15.0,
)
print(f"Status: {resp.status_code}")
data = resp.json()
for m in data.get('data', []):
    print(f"  - {m['id']}")

print("\nTesting a small completion...")
test_resp = httpx.post(
    "https://api.groq.com/openai/v1/chat/completions",
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    json={
        "model": "openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": "Say: OK"}],
        "max_tokens": 10,
    },
    timeout=15.0,
)
print(f"Test status: {test_resp.status_code}")
print(f"Test body: {test_resp.text[:500]}")
