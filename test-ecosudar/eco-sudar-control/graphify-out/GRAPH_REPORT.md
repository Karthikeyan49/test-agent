# Graph Report - eco-sudar-control  (2026-05-04)

## Corpus Check
- 129 files · ~155,554 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 513 nodes · 627 edges · 24 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]

## God Nodes (most connected - your core abstractions)
1. `number()` - 13 edges
2. `apiFetch()` - 13 edges
3. `downloadInvoiceTemplatePdf()` - 11 edges
4. `rowToInvoice()` - 9 edges
5. `drawItemCells()` - 9 edges
6. `text()` - 8 edges
7. `buildFrontCanvas()` - 7 edges
8. `prepareTemplatePage()` - 7 edges
9. `writeTemplateBody()` - 7 edges
10. `writeReportBody()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `updateOvertimeHours()` --calls--> `number()`  [INFERRED]
  src/pages/Payroll.tsx → src/lib/invoiceTemplatePdf.ts
- `number()` --calls--> `toUI()`  [INFERRED]
  src/lib/invoiceTemplatePdf.ts → src/lib/api/expenses.ts
- `updateOrderPayment()` --calls--> `apiFetch()`  [INFERRED]
  src/lib/api/orders.ts → src/lib/api/client.ts
- `updateOrderRefundStatus()` --calls--> `apiFetch()`  [INFERRED]
  src/lib/api/orders.ts → src/lib/api/client.ts
- `apiFetch()` --calls--> `updateCustomerStatus()`  [INFERRED]
  src/lib/api/client.ts → src/lib/api/customers.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.1
Nodes (51): addPreparedPage(), amountInWords(), buildRows(), calcLine(), calcTotals(), canUseTemplateBody(), clearDynamicBody(), clearTemplateDynamicData() (+43 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (18): hoursBetweenTimes(), mockAttendanceMetrics(), workingDaysInMonth(), exportToExcel(), exportToPdf(), currentMonth(), exportPdf(), exportXlsx() (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (21): getAuthToken(), buildBackCanvas(), buildFrontCanvas(), cleanQualifications(), downloadBack(), downloadBoth(), downloadFront(), drawCirclePhoto() (+13 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (13): apiFetch(), createProduct(), deleteProduct(), fetchProducts(), toProductType(), updateProduct(), fetchPending(), handleApprove() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (13): calcInvoiceTotals(), normalizeStatus(), round2(), rowToInvoice(), downloadPdf(), emptyForm(), errorMessage(), load() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (12): toUI(), addressLines(), firstLine(), inr(), invoiceToTemplateDraft(), normalizeOrderStatus(), normalizePayment(), normalizePaymentStatus() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (14): buildCutoff(), emptyShiftForm(), errorMessage(), handleSaveAttendance(), handleSaveCalc(), handleSaveContact(), handleSaveProfile(), load() (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (14): extractAmount(), extractBillData(), extractDate(), extractVendor(), guessCategory(), runTesseract(), autoFillFromBill(), emptyForm() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (12): createDealer(), deleteDealer(), fetchDealers(), updateDealer(), handleAdd(), handleDelete(), handleEdit(), loadDealers() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (9): capitalize(), capitalizePay(), fmt(), formatDate(), mapApiOrderToUI(), updateOrderPayment(), updateOrderRefundStatus(), updateOrderStatus() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (3): async(), Sops(), reload()

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (7): emptyForm(), load(), onDelete(), onSubmit(), openCreate(), plus(), quickStatus()

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (9): emptyForm(), load(), newAction(), newRaciRow(), onDelete(), onSubmit(), openCreate(), today() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (6): fetchCustomerOrderStats(), fmt(), formatDate(), mapApiUserToUI(), updateCustomerStatus(), view()

### Community 14 - "Community 14"
Cohesion: 0.25
Nodes (4): useAuth(), Login(), LoginRoute(), ProtectedRoutes()

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (7): addToRemoveQueue(), dispatch(), genId(), reducer(), toast(), useToast(), Toaster()

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (2): formatTo24h(), set()

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (2): onPointerUp(), savePos()

### Community 19 - "Community 19"
Cohesion: 0.38
Nodes (4): computePerformance(), iso(), minus(), today()

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (1): Clean the remaining red arc artifacts from the front template. The previous clea

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (1): Create clean front template with the correctly measured photo position. Circle:

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (2): generate(), persist()

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (2): fmtMoney(), rowToQuote()

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (1): More precise measurement: look for the circular red border only in the center ar

## Knowledge Gaps
- **3 isolated node(s):** `Clean the remaining red arc artifacts from the front template. The previous clea`, `Create clean front template with the correctly measured photo position. Circle:`, `More precise measurement: look for the circular red border only in the center ar`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (8 nodes): `fmtTime()`, `formatTo24h()`, `if()`, `isoToTime()`, `parseTo12h()`, `set()`, `todayStr()`, `Attendance.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (8 nodes): `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `onResize()`, `savedPos()`, `savePos()`, `send()`, `ChatWidget.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (3 nodes): `main()`, `cleanup_arcs.py`, `Clean the remaining red arc artifacts from the front template. The previous clea`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (3 nodes): `clean_front_template()`, `create_clean_templates.py`, `Create clean front template with the correctly measured photo position. Circle:`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (3 nodes): `generate()`, `persist()`, `Insights.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (3 nodes): `fmtMoney()`, `rowToQuote()`, `quoteRequests.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `measure_template.py`, `More precise measurement: look for the circular red border only in the center ar`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `number()` connect `Community 0` to `Community 1`, `Community 5`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `Community 3` to `Community 8`, `Community 9`, `Community 2`, `Community 13`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `updateOvertimeHours()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `number()` (e.g. with `onSubmit()` and `inr()`) actually correct?**
  _`number()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `apiFetch()` (e.g. with `fetchPending()` and `handleApprove()`) actually correct?**
  _`apiFetch()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `downloadInvoiceTemplatePdf()` (e.g. with `downloadPdf()` and `confirmDownloadInvoice()`) actually correct?**
  _`downloadInvoiceTemplatePdf()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Clean the remaining red arc artifacts from the front template. The previous clea`, `Create clean front template with the correctly measured photo position. Circle:`, `More precise measurement: look for the circular red border only in the center ar` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._