"""
Optional REST API server for SystemIntel (FastAPI).

This module is NOT used by the SystemIntel CLI (`cli.py`) or by `run_all.py`.
The CLI is fully self-contained and needs none of the web dependencies below;
this file is an optional HTTP surface that exposes the same scan/graph engine
over REST for callers that prefer an API to the command line.

Because it is optional, its dependencies are not required to run the CLI. To use
this server, install them explicitly:

    pip install fastapi pydantic uvicorn

Then launch it (binds to 127.0.0.1:8000 by default):

    python3 backend/main.py
    # or: uvicorn backend.main:app --host 127.0.0.1 --port 8000

Endpoints: POST /api/v1/scan, GET /api/v1/graph.

Companion Pydantic response schemas live in `backend/models.py`.
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any

from file_scanner import scan_repository, find_sql_schema_file
from engine import PythonSystemIntelligenceEngine
from graph_builder import SystemGraphBuilder

# Restrict scans to a safe base directory.
# Set SYSTEMINTEL_REPO_ROOT env var to allow a specific directory.
# Defaults to the current working directory.
REPO_ROOT = os.environ.get('SYSTEMINTEL_REPO_ROOT', os.getcwd())

app = FastAPI(
    title="SystemIntel Engine API",
    description="Backend API for Autonomous System Intelligence",
    version="1.0.0"
)

# CORS — restrict to local tools by default
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('SYSTEMINTEL_CORS_ORIGINS', 'http://localhost:3000').split(','),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Global in-memory cache for the latest scan/graph
# In production, this would use a real database or Redis
LATEST_ANALYSIS = {}
LATEST_GRAPH = {}

class ScanRequest(BaseModel):
    repoPath: str

@app.post("/api/v1/scan")
def trigger_scan(req: ScanRequest):
    # Security (S8): resolve symlinks with realpath and compare with commonpath,
    # so a sibling like /srv/repos-evil (startswith /srv/repos) or a symlink that
    # escapes the root can no longer bypass the check.
    repo_path    = os.path.realpath(req.repoPath)
    allowed_root = os.path.realpath(REPO_ROOT)
    try:
        within = os.path.commonpath([allowed_root, repo_path]) == allowed_root
    except ValueError:
        within = False  # different drives / relative-vs-absolute
    if not within:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: repoPath must be within {allowed_root}. "
                   f"Set SYSTEMINTEL_REPO_ROOT env var to change the allowed base directory."
        )
    
    if not os.path.isdir(repo_path):
        raise HTTPException(status_code=400, detail="Repository path not found")
        
    try:
        scan_result = scan_repository(repo_path)
        
        engine = PythonSystemIntelligenceEngine()
        analysis = engine.analyze_repository(scan_result)
        
        extra_sql_path = find_sql_schema_file(repo_path)
        if extra_sql_path and os.path.isfile(extra_sql_path):
            with open(extra_sql_path, 'r', encoding='utf-8') as f:
                extra_sql = f.read()
            extra_db = engine.parse_sql_schema(extra_sql)
            
            analysis["dbResult"]["tables"] += extra_db["tables"]
            analysis["dbResult"]["foreign_keys"] += extra_db["foreign_keys"]
            
            seen_t = set()
            deduped_t = []
            for t in analysis["dbResult"]["tables"]:
                if t["id"] not in seen_t:
                    seen_t.add(t["id"])
                    deduped_t.append(t)
            analysis["dbResult"]["tables"] = deduped_t
            
            seen_fk = set()
            deduped_fk = []
            for fk in analysis["dbResult"]["foreign_keys"]:
                k = f"{fk['sourceTable']}_{fk['sourceColumn']}_{fk['targetTable']}_{fk['targetColumn']}"
                if k not in seen_fk:
                    seen_fk.add(k)
                    deduped_fk.append(fk)
            analysis["dbResult"]["foreign_keys"] = deduped_fk

        gb = SystemGraphBuilder()
        gb.build_from_analysis(analysis)
        
        global LATEST_ANALYSIS, LATEST_GRAPH
        LATEST_ANALYSIS = analysis
        LATEST_GRAPH = gb.to_dict()
        
        return {
            "status": "success",
            "files_analyzed": analysis.get("filesAnalyzed", 0),
            "lines_of_code": analysis.get("linesOfCode", 0),
            "pages": len(analysis.get("pages", [])),
            "api_endpoints": len(analysis.get("apiEndpoints", [])),
            "tables": len(analysis["dbResult"].get("tables", [])),
            "nodes": LATEST_GRAPH["nodeCount"],
            "edges": LATEST_GRAPH["edgeCount"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/graph")
def get_graph():
    if not LATEST_GRAPH:
        raise HTTPException(status_code=404, detail="No graph found. Please run a scan first.")
    
    return {
        "nodes": LATEST_GRAPH["nodes"],
        "edges": LATEST_GRAPH["edges"]
    }

if __name__ == "__main__":
    import uvicorn
    # Bind to localhost by default (S8): this API has no authentication and can
    # trigger repo scans, so it must not listen on all interfaces. Override with
    # SYSTEMINTEL_API_HOST only behind a trusted proxy / auth layer.
    host = os.environ.get("SYSTEMINTEL_API_HOST", "127.0.0.1")
    port = int(os.environ.get("SYSTEMINTEL_API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
