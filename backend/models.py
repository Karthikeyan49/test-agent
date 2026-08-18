"""
SQLAlchemy & Pydantic Database Schema Models for SystemIntel Backend
Represents Graph Entities, Nodes, Edges, Workflows, Test Cases, Runs, and Reports.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class ProjectCreate(BaseModel):
    name: str
    repository_url: Optional[str] = None
    git_branch: Optional[str] = "main"

class ProjectMetadata(BaseModel):
    id: str
    name: str
    frontend_framework: str = "React"
    backend_framework: str = "Express / FastAPI"
    database_tech: str = "PostgreSQL"
    api_style: str = "REST"
    created_at: str

class GraphNode(BaseModel):
    id: str
    type: str  # Page, Component, Field, Form, Route, APIEndpoint, Controller, Service, Repository, Table, Column
    name: str
    category: str  # Frontend, Backend, Database, API
    metadata: Dict[str, Any] = {}

class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relationship: str  # CONTAINS, CALLS, SUBMITS_TO, IMPLEMENTED_BY, READS_FROM, WRITES_TO, REFERENCES, MAPS_TO
    confidence: float = 1.0
    discovery_method: str = "STATIC_ANALYSIS"  # STATIC_ANALYSIS, DATABASE_ANALYSIS, AI_INFERENCE, RUNTIME_TRACE
    source_file: Optional[str] = None
    source_line: Optional[int] = None
    reason: Optional[str] = None

class TestScenario(BaseModel):
    id: str
    title: str
    category: str
    priority: str
    status: str = "CONFIRMED"
    confidence: float = 0.95
    steps: List[Dict[str, Any]]
    assertions: List[Dict[str, Any]]
    affected_nodes: List[str]
    source_evidence: List[Dict[str, Any]]

class TestExecutionResult(BaseModel):
    run_id: str
    test_id: str
    title: str
    status: str  # PASS, FAIL, BLOCKED
    duration_ms: int
    trace_id: str
    step_logs: List[str]
    screenshot_url: Optional[str] = None
    failure_details: Optional[Dict[str, Any]] = None

class AIQueryResult(BaseModel):
    question: str
    answer: str
    citations: List[Dict[str, Any]]
    confidence: float
