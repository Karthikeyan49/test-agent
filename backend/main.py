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
    repo_path = os.path.abspath(req.repoPath)
    
    # Security: prevent path traversal outside allowed root
    allowed_root = os.path.abspath(REPO_ROOT)
    if not repo_path.startswith(allowed_root):
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
    uvicorn.run(app, host="0.0.0.0", port=8000)
