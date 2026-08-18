"""
Real File System Scanner
Recursively walks an ERP repository directory, discovers all source files,
reads their contents, and classifies them by type for the parser engine.
"""

import os
import glob
from typing import List, Dict, Any

# File extensions we understand how to parse
FRONTEND_EXTENSIONS = {'.jsx', '.tsx', '.js', '.vue', '.svelte', '.html'}
BACKEND_EXTENSIONS  = {'.ts', '.py', '.java', '.cs', '.go', '.rb', '.php'}
SCHEMA_EXTENSIONS   = {'.sql', '.prisma', '.graphql'}
OPENAPI_EXTENSIONS  = {'.yaml', '.yml', '.json'}
CONFIG_EXTENSIONS   = {'.json', '.yaml', '.yml', '.env', '.toml'}
TEST_EXTENSIONS     = {'.spec.js', '.test.js', '.spec.ts', '.test.ts', 'test_*.py', '*_test.py', '.spec.jsx', '.test.jsx'}
TRACE_EXTENSIONS    = {'.har', '.log'}

# Code extensions whose minified/bundled builds should be excluded (huge single lines)
MINIFIABLE_EXTENSIONS = {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css'}

# Directories to always skip (noise)
SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    'dist', 'build', '.next', 'coverage', '.nyc_output', 'target',
    'vendor', '.gradle', 'bin', 'obj', 'out', 'logs', 'tmp', '.cache'
}

# Max file size to read (5MB per file — skip binary blobs)
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024


def scan_repository(repo_path: str) -> Dict[str, Any]:
    """
    Recursively scan a repository directory.
    Returns classified lists of source files grouped by type.
    """
    if not os.path.isdir(repo_path):
        raise ValueError(f"Repository path does not exist or is not a directory: {repo_path}")

    result = {
        "repo_path": os.path.abspath(repo_path),
        "frontend_files": [],
        "backend_files": [],
        "schema_files": [],
        "openapi_files": [],
        "config_files": [],
        "test_files": [],
        "trace_files": [],
        "unknown_files": [],
        "skipped_files": [],
        "total_files_scanned": 0,
        "total_lines_of_code": 0,
    }

    for dirpath, dirnames, filenames in os.walk(repo_path):
        # Prune skip directories in-place so os.walk doesn't descend into them
        # (also drop build-output dirs like dist-dealer/, dist-ssr/)
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and not d.startswith('.')
                       and not d.startswith('dist-')]

        for filename in filenames:
            full_path = os.path.join(dirpath, filename)
            rel_path  = os.path.relpath(full_path, repo_path)
            ext       = os.path.splitext(filename)[1].lower()

            # Skip empty or binary-only files
            try:
                file_size = os.path.getsize(full_path)
            except OSError:
                continue

            if file_size == 0:
                continue

            if file_size > MAX_FILE_SIZE_BYTES:
                result["skipped_files"].append({"path": rel_path, "reason": "exceeds_size_limit"})
                continue

            # Read the file content
            try:
                with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except (OSError, PermissionError) as e:
                result["skipped_files"].append({"path": rel_path, "reason": str(e)})
                continue

            lines = content.split('\n')

            # Skip minified/bundled build artifacts (one enormous line) — they are
            # compiled output, not real source, and pollute page/navigation detection.
            if ext in MINIFIABLE_EXTENSIONS and lines and max(len(l) for l in lines) > 2000:
                result["skipped_files"].append({"path": rel_path, "reason": "minified_bundle"})
                continue

            loc   = len(lines)
            result["total_lines_of_code"] += loc
            result["total_files_scanned"] += 1

            file_entry = {
                "name":     filename,
                "path":     rel_path,
                "abs_path": full_path,
                "ext":      ext,
                "size":     file_size,
                "loc":      loc,
                "content":  content,
            }

            # Determine file classification
            is_test = False
            for test_ext in TEST_EXTENSIONS:
                if (test_ext.startswith('*') and filename.endswith(test_ext[1:])) or \
                   (test_ext.endswith('*') and filename.startswith(test_ext[:-1])) or \
                   (filename.endswith(test_ext)):
                    is_test = True
                    break

            if is_test:
                result["test_files"].append(file_entry)
            elif ext in FRONTEND_EXTENSIONS:
                result["frontend_files"].append(file_entry)
            elif ext in BACKEND_EXTENSIONS:
                result["backend_files"].append(file_entry)
            elif ext in SCHEMA_EXTENSIONS:
                result["schema_files"].append(file_entry)
            elif ext in OPENAPI_EXTENSIONS and ('openapi' in filename.lower() or 'swagger' in filename.lower()):
                result["openapi_files"].append(file_entry)
            elif ext in CONFIG_EXTENSIONS:
                result["config_files"].append(file_entry)
            elif ext in TRACE_EXTENSIONS:
                result["trace_files"].append(file_entry)
            else:
                result["unknown_files"].append(file_entry)

    return result


def find_sql_schema_file(repo_path: str) -> str | None:
    """
    Auto-detect the primary SQL schema file in a repository.
    Searches common locations: schema.sql, migrations/, db/, database/
    """
    candidate_names = [
        'schema.sql', 'database.sql', 'init.sql', 'setup.sql',
        'create_tables.sql', 'structure.sql', 'db.sql', '*.sql'
    ]

    # Check root first
    for name in candidate_names:
        for match in glob.glob(os.path.join(repo_path, name)):
            if os.path.isfile(match):
                return match

    # Check common subdirectories
    common_dirs = ['db', 'database', 'migrations', 'sql', 'schema', 'data', 'scripts']
    for subdir in common_dirs:
        subdir_path = os.path.join(repo_path, subdir)
        if os.path.isdir(subdir_path):
            for name in candidate_names:
                for match in glob.glob(os.path.join(subdir_path, '**', name), recursive=True):
                    if os.path.isfile(match):
                        return match

    return None


def print_scan_summary(scan_result: Dict[str, Any]):
    """Print a clean terminal summary of the scan."""
    print(f"\n\033[32m[✓] Repository Scan Complete: {scan_result['repo_path']}\033[0m")
    print(f"  • Total Files Scanned : {scan_result['total_files_scanned']}")
    print(f"  • Total Lines of Code : {scan_result['total_lines_of_code']:,}")
    print(f"  • Frontend Files      : {len(scan_result['frontend_files'])} ({', '.join(set(f['ext'] for f in scan_result['frontend_files'])) or 'none'})")
    print(f"  • Backend Files       : {len(scan_result['backend_files'])} ({', '.join(set(f['ext'] for f in scan_result['backend_files'])) or 'none'})")
    print(f"  • Schema/SQL Files    : {len(scan_result['schema_files'])}")
    print(f"  • OpenAPI/Swagger     : {len(scan_result['openapi_files'])}")
    print(f"  • Config Files        : {len(scan_result['config_files'])}")
    print(f"  • Test Files          : {len(scan_result['test_files'])}")
    print(f"  • Trace/Log Files     : {len(scan_result['trace_files'])}")
    if scan_result['skipped_files']:
        print(f"  • Skipped Files       : {len(scan_result['skipped_files'])} (size limit / binary)")
