# SystemIntel: AI-Powered Software System Intelligence & Autonomous Testing Platform

## 1. Executive Summary

SystemIntel is an enterprise-grade platform that ingests full-stack software applications (Frontend, Backend, Database schemas, APIs, and runtime execution traces) to construct a machine-readable system graph representation.

The platform provides bidirectional lineage tracing:
- **Hierarchical Lineage:** Page → Component → Field → Frontend State → API Request → API Endpoint → Controller → Service → Repository / ORM → Database Table → Database Column
- **Reverse Lineage:** Database Column → Backend Logic → API Response → Frontend State → Component → Page

---

## 2. Core Architectural Separation

```
 ┌─────────────────────────────────────────────────────────┐
 │                   SOURCE CODE PROJECT                   │
 └────────────────────────────┬────────────────────────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
   ┌──────────────────────┐      ┌──────────────────────┐
   │ DETERMINISTIC LAYER  │      │       AI LAYER       │
   │ (AST, Parser, SQL,   │      │ (Semantic Mapping,   │
   │  Lineage, Playwright)│      │  Workflow Discovery, │
   └──────────┬───────────┘      │  Root Cause Hypothesis)
              │                  └──────────┬───────────┘
              └──────────────┬──────────────┘
                             ▼
                  ┌──────────────────────┐
                  │     SYSTEM GRAPH     │
                  └──────────┬───────────┘
                             ▼
                  ┌──────────────────────┐
                  │    TEST GENERATION   │
                  └──────────┬───────────┘
                             ▼
                  ┌──────────────────────┐
                  │   PLAYWRIGHT RUNNER  │
                  └──────────┬───────────┘
                             ▼
                  ┌──────────────────────┐
                  │ FINAL TESTING REPORT │
                  └──────────────────────┘
```

---

## 3. Node & Relationship Entity Schema

### Graph Node Categories:
- `Page`, `Component`, `Field`, `Form`, `Route`, `APIEndpoint`, `Controller`, `Service`, `Function`, `Class`, `Repository`, `Database`, `Table`, `Column`, `ForeignKey`, `BusinessEntity`, `Workflow`, `TestScenario`, `TestCase`, `TestRun`, `Failure`.

### Edge Relationship Types:
- `CONTAINS`, `IMPORTS`, `EXPORTS`, `CALLS`, `RENDERS`, `CONTAINS_FIELD`, `BINDS_TO`, `SUBMITS_TO`, `CALLS_API`, `RETURNS_FROM`, `IMPLEMENTED_BY`, `READS_FROM`, `WRITES_TO`, `MAPS_TO`, `REFERENCES`, `DEPENDS_ON`, `AFFECTS`, `PRECEDES`, `TRIGGERS`, `VALIDATES`, `TESTS`, `FAILED_BECAUSE_OF`.

### Relationship Edge Attributes:
- `source_node_id`, `target_node_id`, `relationship_type`, `confidence`, `discovery_method` (`STATIC_ANALYSIS`, `DATABASE_ANALYSIS`, `RUNTIME_TRACE`, `API_SCHEMA`, `AI_INFERENCE`, `MANUAL`), `source_file`, `source_line`, `source_column`, `reason`.

---

## 4. Test Execution & Reporting

- **Browser Automation:** Playwright Chromium runner for E2E step execution and screenshot capture.
- **API Runner:** HTTP Client verifying request payloads, response bodies, and HTTP status codes.
- **Database Verification:** SQL assertion engine validating exact table row insertion, column values, and FK integrity.
- **AI Failure Intelligence:** Evaluates test execution traces, network logs, SQL queries, and graph paths to pinpoint probable root cause hypotheses with exact source line references.
