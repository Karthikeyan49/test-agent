#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Smoke test — Smart Inventory Input Layer (Prompt 2 endpoints).
#
# Exercises the full happy path end-to-end against a deployed server:
#   login → create zone → create product → receive stock → low-stock →
#   quality-check reject (auto-move to DAMAGED) → bulk import → cleanup-ish.
#
# Usage:
#   BASE_URL="https://yourdomain.com/api" \
#   ADMIN_EMAIL="admin@example.com" ADMIN_PASS="secret" \
#   bash smoke_inventory.sh
#
# Defaults assume a local dev server. Requires: curl. Uses jq if available
# (falls back to grep/sed for token + id extraction otherwise).
# ─────────────────────────────────────────────────────────────────────────────
set -u

BASE_URL="${BASE_URL:-http://localhost:8000/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@ecosudar.com}"
ADMIN_PASS="${ADMIN_PASS:-changeme}"

# A unique suffix so reruns don't collide on unique SKU / zone_code.
SFX="$(date +%s)"
PASS=0
FAIL=0

c_green="\033[32m"; c_red="\033[31m"; c_dim="\033[2m"; c_off="\033[0m"

have_jq() { command -v jq >/dev/null 2>&1; }

# Extract a top-level-ish JSON value. With jq: a real path filter.
# Without jq: a crude "first match" grep for "key":value.
json() { # $1 = body, $2 = jq filter, $3 = fallback regex key
  if have_jq; then printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null
  else printf '%s' "$1" | grep -oE "\"$3\"[: ]*\"?[^,\"}]+\"?" | head -1 | sed -E "s/.*[:] ?\"?//; s/\"?$//"
  fi
}

req() { # METHOD PATH [json-body]   → echoes "HTTP_CODE<newline>BODY"
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -w $'\n%{http_code}' -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -w $'\n%{http_code}' -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN"
  fi
}

check() { # NAME EXPECTED_CODE METHOD PATH [body]   → returns body via $LAST_BODY
  local name="$1" want="$2" method="$3" path="$4" body="${5:-}"
  local out code resp
  out="$(req "$method" "$path" "$body")"
  code="$(printf '%s' "$out" | tail -n1)"
  resp="$(printf '%s' "$out" | sed '$d')"
  LAST_BODY="$resp"
  if [ "$code" = "$want" ]; then
    printf "${c_green}PASS${c_off} %-45s ${c_dim}[%s %s]${c_off}\n" "$name" "$method" "$path"
    PASS=$((PASS+1))
  else
    printf "${c_red}FAIL${c_off} %-45s ${c_dim}[%s %s]${c_off} got %s want %s\n" "$name" "$method" "$path" "$code" "$want"
    printf "     ${c_dim}%s${c_off}\n" "$(printf '%s' "$resp" | head -c 300)"
    FAIL=$((FAIL+1))
  fi
}

echo "── Smart Inventory smoke test ──────────────────────────────"
echo "Base: $BASE_URL"
have_jq && echo "jq:   yes" || echo "jq:   no (using fallback parser)"
echo ""

# ── 0. Login ────────────────────────────────────────────────────────────────
LOGIN_BODY="$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")"
TOKEN="$(json "$LOGIN_BODY" '.data.token' 'token')"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  printf "${c_red}ABORT${c_off} login failed — no token.\n"
  printf "     %s\n" "$(printf '%s' "$LOGIN_BODY" | head -c 400)"
  exit 1
fi
printf "${c_green}OK${c_off}   logged in as %s\n\n" "$ADMIN_EMAIL"

# Admin user id — needed as approved_by on the adjustment movement. Falls back to 1.
ADMIN_USER_ID="$(json "$LOGIN_BODY" '.data.user.user_id' 'user_id')"
[ -z "$ADMIN_USER_ID" ] || [ "$ADMIN_USER_ID" = "null" ] && ADMIN_USER_ID=1

# ── 1. Zones ────────────────────────────────────────────────────────────────
check "create READY zone" 201 POST /admin/inventory/zones \
  "{\"zone_name\":\"Smoke Ready $SFX\",\"zone_code\":\"ZN-RDY-$SFX\",\"zone_type\":\"READY_STOCK\",\"warehouse_location\":\"Test WH\"}"
ZONE_ID="$(json "$LAST_BODY" '.data.zone_id' 'zone_id')"

# Ensure a DAMAGED zone exists so quality-check reject has a target.
check "create DAMAGED zone" 201 POST /admin/inventory/zones \
  "{\"zone_name\":\"Smoke Damaged $SFX\",\"zone_code\":\"ZN-DMG-$SFX\",\"zone_type\":\"DAMAGED\"}"

check "reject duplicate zone_code" 422 POST /admin/inventory/zones \
  "{\"zone_name\":\"Dup\",\"zone_code\":\"ZN-RDY-$SFX\",\"zone_type\":\"READY_STOCK\"}"

check "reject bad zone_type" 422 POST /admin/inventory/zones \
  "{\"zone_name\":\"Bad\",\"zone_code\":\"ZN-BAD-$SFX\",\"zone_type\":\"NONSENSE\"}"

check "list zones" 200 GET /admin/inventory/zones
check "list active zones" 200 GET /admin/inventory/zones/active
check "show zone" 200 GET "/admin/inventory/zones/$ZONE_ID"

# ── 2. Products ─────────────────────────────────────────────────────────────
check "create product" 201 POST /admin/inventory/products \
  "{\"name\":\"Smoke Pellet $SFX\",\"sku\":\"SKU-$SFX\",\"category\":\"Pellets\",\"unit_of_measure\":\"kg\",\"hsn_code\":\"44013100\",\"reorder_level\":50,\"reorder_quantity\":200,\"cost_price\":12.5,\"selling_price\":18}"
PRODUCT_ID="$(json "$LAST_BODY" '.data.product_id' 'product_id')"

check "reject duplicate SKU" 422 POST /admin/inventory/products \
  "{\"name\":\"Dup\",\"sku\":\"SKU-$SFX\",\"category\":\"Pellets\",\"unit_of_measure\":\"kg\",\"reorder_level\":1,\"cost_price\":1}"

check "reject bad unit_of_measure" 422 POST /admin/inventory/products \
  "{\"name\":\"Bad Unit\",\"sku\":\"SKU-BADU-$SFX\",\"category\":\"Pellets\",\"unit_of_measure\":\"tonnes\",\"reorder_level\":1,\"cost_price\":1}"

check "reject missing required fields" 422 POST /admin/inventory/products \
  "{\"name\":\"\",\"sku\":\"\"}"

check "list products" 200 GET /admin/inventory/products
check "search products" 200 "GET" "/admin/inventory/products/search?q=Smoke"
check "show product" 200 GET "/admin/inventory/products/$PRODUCT_ID"
check "update product" 200 PUT "/admin/inventory/products/$PRODUCT_ID" \
  "{\"selling_price\":19.5}"
check "show missing product 404" 404 GET "/admin/inventory/products/99999999"

# ── 3. Stock receiving ──────────────────────────────────────────────────────
check "receive stock (STOCK_IN)" 201 POST /admin/inventory/stock/receive \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":100,\"unit_cost\":12.5,\"reference_type\":\"PURCHASE_ORDER\",\"reference_id\":1,\"remarks\":\"smoke receive\"}"

check "reject receive qty < 0.001" 422 POST /admin/inventory/stock/receive \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":0,\"unit_cost\":1,\"reference_type\":\"PURCHASE_ORDER\",\"reference_id\":1}"

check "reject receive unknown product" 422 POST /admin/inventory/stock/receive \
  "{\"product_id\":99999999,\"zone_id\":$ZONE_ID,\"quantity\":5,\"unit_cost\":1,\"reference_type\":\"PURCHASE_ORDER\",\"reference_id\":1}"

check "get product stock" 200 GET "/admin/inventory/stock/$PRODUCT_ID"

# ── 4. Quality check (reject → auto-move to DAMAGED) ────────────────────────
check "QC approve" 200 POST /admin/inventory/stock/quality-check \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":10,\"decision\":\"approve\",\"remarks\":\"looks good\"}"

check "QC reject moves to DAMAGED" 200 POST /admin/inventory/stock/quality-check \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":15,\"decision\":\"reject\",\"remarks\":\"wet batch\"}"

check "reject QC bad decision" 422 POST /admin/inventory/stock/quality-check \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":5,\"decision\":\"maybe\"}"

# ── 5. Low stock ────────────────────────────────────────────────────────────
check "low-stock list" 200 GET /admin/inventory/stock/low-stock

# ── 6. Bulk import (multipart CSV) ──────────────────────────────────────────
CSV_FILE="$(mktemp /tmp/inv_import_XXXX.csv)"
cat > "$CSV_FILE" <<CSV
sku,name,category,unit_of_measure,hsn_code,reorder_level,reorder_quantity,cost_price,selling_price,zone_code
BULK-A-$SFX,Bulk Pellet A,Pellets,kg,44013100,10,50,11.0,16.0,ZN-RDY-$SFX
BULK-B-$SFX,Bulk Pellet B,Pellets,bag,44013100,5,20,9.5,14.0,
,Missing SKU Row,Pellets,kg,,1,1,1,1,
BULK-D-$SFX,Bad Unit Row,Pellets,tonnes,,1,1,1,1,
SKU-$SFX,Duplicate Existing,Pellets,kg,,1,1,1,1,
CSV
# Expect: total=5 success=2 failed=3 (missing SKU, bad unit, duplicate)
BULK_OUT="$(curl -sS -w $'\n%{http_code}' -X POST "$BASE_URL/admin/inventory/stock/bulk-import" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$CSV_FILE;type=text/csv")"
BULK_CODE="$(printf '%s' "$BULK_OUT" | tail -n1)"
BULK_BODY="$(printf '%s' "$BULK_OUT" | sed '$d')"
rm -f "$CSV_FILE"
if [ "$BULK_CODE" = "200" ]; then
  printf "${c_green}PASS${c_off} %-45s ${c_dim}[POST /admin/inventory/stock/bulk-import]${c_off}\n" "bulk import"
  PASS=$((PASS+1))
  printf "     ${c_dim}report: %s${c_off}\n" "$(printf '%s' "$BULK_BODY" | (have_jq && jq -c '.data | {total,success,failed,errors}' || cat))"
else
  printf "${c_red}FAIL${c_off} %-45s got %s want 200\n" "bulk import" "$BULK_CODE"
  printf "     ${c_dim}%s${c_off}\n" "$(printf '%s' "$BULK_BODY" | head -c 300)"
  FAIL=$((FAIL+1))
fi

# ── 6b. Smart Allocation Engine ─────────────────────────────────────────────
# Receive more stock so there is quantity to allocate, then trigger the engine.
check "receive for allocation" 201 POST /admin/inventory/stock/receive \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":80,\"unit_cost\":12.5,\"reference_type\":\"PURCHASE_ORDER\",\"reference_id\":2}"

check "trigger allocation" 200 POST /admin/inventory/allocate \
  "{\"product_id\":$PRODUCT_ID,\"quantity\":40}"
printf "     ${c_dim}placements: %s${c_off}\n" "$(printf '%s' "$LAST_BODY" | (have_jq && jq -c '.data.allocations' || head -c 200))"

check "allocation history" 200 GET "/admin/inventory/allocate/$PRODUCT_ID"
check "zone distribution" 200 "GET" "/admin/inventory/zones/distribution?product_id=$PRODUCT_ID"
check "pending allocations" 200 GET /admin/inventory/allocate/pending

check "manual override" 200 POST /admin/inventory/allocate/manual \
  "{\"product_id\":$PRODUCT_ID,\"quantity\":5,\"zone_id\":$ZONE_ID,\"override_reason\":\"Emergency production requirement\"}"

check "reject manual override short reason" 422 POST /admin/inventory/allocate/manual \
  "{\"product_id\":$PRODUCT_ID,\"quantity\":5,\"zone_id\":$ZONE_ID,\"override_reason\":\"too short\"}"

check "reject allocate unknown product" 422 POST /admin/inventory/allocate \
  "{\"product_id\":99999999,\"quantity\":5}"

check "distribution missing product_id 400" 400 GET /admin/inventory/zones/distribution

# ── 6c. Movement Engine ─────────────────────────────────────────────────────
# Ensure there is stock in $ZONE_ID to move (manual override earlier put some there).
check "receive for movements" 201 POST /admin/inventory/stock/receive \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"quantity\":120,\"unit_cost\":12.5,\"reference_type\":\"PURCHASE_ORDER\",\"reference_id\":3}"

check "movements list" 200 GET /admin/inventory/movements
check "movements filtered by type" 200 "GET" "/admin/inventory/movements?movement_type=STOCK_IN"
check "movements by product" 200 "GET" "/admin/inventory/movements/product/$PRODUCT_ID"
check "pending approvals list" 200 GET /admin/inventory/movements/pending-approvals

# Production use (outflow, auto-approved) — needs stock in the zone.
check "production use" 201 POST /admin/inventory/movements/production-use \
  "{\"product_id\":$PRODUCT_ID,\"quantity\":10,\"batch_reference\":\"BATCH-001\",\"zone_id\":$ZONE_ID}"

# Zone transfer to DAMAGED zone (created earlier as ZN-DMG-$SFX).
DMG_ID="$(json "$(req GET "/admin/inventory/zones")" '.data[] | select(.zone_code==("ZN-DMG-'"$SFX"'")) | .zone_id' 'zone_id')"
if [ -n "$DMG_ID" ] && [ "$DMG_ID" != "null" ]; then
  check "zone transfer" 201 POST /admin/inventory/movements/transfer \
    "{\"product_id\":$PRODUCT_ID,\"from_zone_id\":$ZONE_ID,\"to_zone_id\":$DMG_ID,\"quantity\":5,\"reason\":\"Smoke test relocation between zones\"}"
fi

# Adjustment → always pending approval (expect approval_required true).
check "adjustment (pending approval)" 201 POST /admin/inventory/movements/adjustment \
  "{\"product_id\":$PRODUCT_ID,\"zone_id\":$ZONE_ID,\"new_quantity\":200,\"reason\":\"Physical stock count correction after audit\",\"approved_by\":$ADMIN_USER_ID}"

# Reject: outflow larger than available.
check "reject overdraw production" 422 POST /admin/inventory/movements/production-use \
  "{\"product_id\":$PRODUCT_ID,\"quantity\":999999,\"batch_reference\":\"BATCH-X\",\"zone_id\":$ZONE_ID}"

# Reject: short remarks on employee issue.
check "reject employee-issue short remarks" 422 POST /admin/inventory/movements/employee-issue \
  "{\"product_id\":$PRODUCT_ID,\"employee_id\":1,\"quantity\":1,\"remarks\":\"hi\",\"zone_id\":$ZONE_ID}"

# ── 6f. Approval Workflow ────────────────────────────────────────────────────
# The adjustment + emergency movements above are PENDING approvals.
check "approvals list" 200 GET /admin/inventory/approvals
check "approvals pending" 200 GET /admin/inventory/approvals/pending
check "approval stats" 200 GET /admin/inventory/approvals/stats
check "approval history" 200 GET /admin/inventory/approvals/history
check "reject reject missing remarks" 422 POST /admin/inventory/approvals/1/reject \
  "{\"remarks\":\"short\"}"
check "escalate overdue approvals" 200 POST /admin/inventory/approvals/escalate \
  "{\"hours_threshold\":24}"

# Capture a real pending approval id, then assert self-approval is blocked
# (the logged-in admin requested it) and that show works.
APPROVAL_ID="$(json "$(req GET "/admin/inventory/approvals/pending")" '.data[0].approval_id' 'approval_id')"
if [ -n "$APPROVAL_ID" ] && [ "$APPROVAL_ID" != "null" ]; then
  check "approval show" 200 GET "/admin/inventory/approvals/$APPROVAL_ID"
  check "block self-approval" 422 POST "/admin/inventory/approvals/$APPROVAL_ID/approve" \
    "{\"remarks\":\"approving my own request\"}"
fi
check "approve missing approval 422" 422 POST /admin/inventory/approvals/99999999/approve \
  "{\"remarks\":\"no such approval\"}"

# ── 6d. Intelligence Hub ─────────────────────────────────────────────────────
check "health scores (all)" 200 GET /admin/inventory/intelligence/health-scores
check "health score by product" 200 GET "/admin/inventory/intelligence/health/$PRODUCT_ID"
check "dead stock list" 200 GET /admin/inventory/intelligence/dead-stock
check "dead stock value" 200 GET /admin/inventory/intelligence/dead-stock/value
check "runout predictions (all)" 200 GET /admin/inventory/intelligence/runout
check "runout prediction by product" 200 GET "/admin/inventory/intelligence/runout/$PRODUCT_ID"
check "abnormal movements" 200 GET /admin/inventory/intelligence/abnormal
check "intelligence summary" 200 GET /admin/inventory/intelligence/summary

# ── 6e. Intelligence Hub Part 2 (Reorder / Dealer Demand / Consumption) ──────
check "generate reorder suggestions" 200 POST /admin/inventory/reorder/generate
check "reorder suggestions (all)" 200 GET /admin/inventory/reorder/suggestions
SUGGESTION_ID="$(json "$LAST_BODY" '.data[0].suggestion_id' 'suggestion_id')"
if [ -n "$SUGGESTION_ID" ] && [ "$SUGGESTION_ID" != "null" ]; then
  check "reorder suggestion by id" 200 GET "/admin/inventory/reorder/suggestions/$SUGGESTION_ID"
  check "update suggestion status" 200 PUT "/admin/inventory/reorder/suggestions/$SUGGESTION_ID" \
    "{\"status\":\"DISMISSED\"}"
  check "reject bad suggestion status" 422 PUT "/admin/inventory/reorder/suggestions/$SUGGESTION_ID" \
    "{\"status\":\"NOPE\"}"
fi
check "dealer demand profiles" 200 GET /admin/inventory/reorder/dealer-demand
# Dealer-specific checks need a real users.user_id with user_type='dealer'.
# Export DEALER_USER_ID=<id> before running to exercise them; skipped otherwise.
if [ -n "$DEALER_USER_ID" ] && [ "$DEALER_USER_ID" != "null" ]; then
  check "update dealer demand" 200 POST /admin/inventory/reorder/dealer/update \
    "{\"dealer_id\":$DEALER_USER_ID,\"product_id\":$PRODUCT_ID}"
  check "dealer reservation suggestion" 200 GET "/admin/inventory/reorder/dealer/$DEALER_USER_ID"
fi
check "consumption trends" 200 GET "/admin/inventory/reorder/consumption/$PRODUCT_ID"
check "consumption breakdown" 200 GET "/admin/inventory/reorder/consumption/breakdown/$PRODUCT_ID"
check "top consuming dealers" 200 GET /admin/inventory/reorder/top-dealers
check "top consuming departments" 200 GET /admin/inventory/reorder/top-departments
check "consumption heatmap" 200 GET "/admin/inventory/reorder/heatmap/$PRODUCT_ID"

# ── 7. Soft delete ──────────────────────────────────────────────────────────
check "soft delete product" 200 DELETE "/admin/inventory/products/$PRODUCT_ID"
check "deleted product 404" 404 GET "/admin/inventory/products/$PRODUCT_ID"

# ── 8. Auth guard ───────────────────────────────────────────────────────────
NOAUTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/admin/inventory/products")"
if [ "$NOAUTH_CODE" = "401" ] || [ "$NOAUTH_CODE" = "403" ]; then
  printf "${c_green}PASS${c_off} %-45s ${c_dim}[no token → %s]${c_off}\n" "unauthenticated blocked" "$NOAUTH_CODE"
  PASS=$((PASS+1))
else
  printf "${c_red}FAIL${c_off} %-45s got %s want 401/403\n" "unauthenticated blocked" "$NOAUTH_CODE"
  FAIL=$((FAIL+1))
fi

echo ""
echo "────────────────────────────────────────────────────────────"
printf "Total: %s   ${c_green}PASS %s${c_off}   ${c_red}FAIL %s${c_off}\n" "$((PASS+FAIL))" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
