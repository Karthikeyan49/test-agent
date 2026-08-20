"""
Mutation Testing Harness
Measures whether a generated test suite actually CATCHES bugs — the real
test-quality KPI. It injects small "mutants" (flipped operators / constants)
into the source, re-runs the suite, and counts how many mutants the suite
"kills" (a test that passed on clean code now fails). Mutation score = the
fraction killed. Originals are always restored.

Scale (Gap #5): discovery is REPO-WIDE and honest. `discover_mutants` walks a
tree (include/exclude globs) and enumerates EVERY candidate mutant across ALL
matching files WITHOUT executing anything — so a caller can truthfully say
"repo has M mutants; executing N". Executing all M is infeasible (each mutant
re-runs the whole suite, ~100s), so `sample_catalog` picks a representative,
deterministic (seeded), stratified subset bounded by `budget`, `per_file_cap`
and an optional `time_budget_seconds`. The score is always `killed / executed`
and the full `discovered` count is surfaced alongside it, so a sampled score is
never mistaken for full coverage.
"""

import re
from typing import Dict, Any, List, Callable, Tuple, Iterator, Optional

# One-for-one textual swaps (applied one occurrence at a time). Language-agnostic
# on purpose — the operators below cover Python, PHP, JS/TS and Java/C-family, so a
# single mutant generator works whether we mutate a .py, .php, .js or .java file.
_SWAPS = [
    # strict equality first so ` == ` never rewrites the inner part of ` === `
    (" === ", " !== "), (" !== ", " === "),   # PHP / JS strict comparison
    (" == ", " != "),   (" != ", " == "),
    (" >= ", " < "),    (" <= ", " > "),
    (" > ", " <= "),    (" < ", " >= "),
    (" && ", " || "),   (" || ", " && "),      # C-family boolean
    (" and ", " or "),  (" or ", " and "),      # Python boolean
    (" + ", " - "),     (" - ", " + "),
    (" * ", " / "),     (" / ", " * "),        # multiplicative
    (" % ", " * "),
    (" += ", " -= "),   (" -= ", " += "),      # compound assignment
    (" *= ", " /= "),   (" /= ", " *= "),
    ("++", "--"),       ("--", "++"),          # inc/dec
    ("True", "False"),  ("False", "True"),      # Python literals
    ("true", "false"),  ("false", "true"),      # PHP / JS / Java literals
    ("null", "0"),      ("None", "0"),          # null-ish
]

# A line is treated as a comment (skipped) when its stripped form starts with any
# of these — covers #, // and /* */ single-line comment styles.
_COMMENT_PREFIXES = ("#", "//", "*", "/*")

# Default source globs — PHP back-end controllers/services/models, extend as needed.
DEFAULT_INCLUDE: Tuple[str, ...] = ("*.php",)
DEFAULT_EXCLUDE: Tuple[str, ...] = ()

# Cap how many survivor examples we retain (the `survived` count is always exact).
_MAX_SURVIVOR_SAMPLES = 100
# Rough default cost of one mutant (whole-suite re-run) for up-front time estimates.
DEFAULT_SECONDS_PER_MUTANT = 100.0


def _iter_mutations(source: str) -> Iterator[Tuple[int, str, str, str]]:
    """Yield (lineno, op, original_line, mutated_line) for EVERY candidate mutation
    in `source`, in deterministic order (operator swaps per occurrence, then the
    first integer literal, per non-comment line). Cheap: it never materialises the
    full mutated file text — callers rebuild it only for the mutants they execute."""
    lines = source.split('\n')
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith(_COMMENT_PREFIXES):
            continue

        # operator/keyword swaps — one mutant per occurrence
        for old, new in _SWAPS:
            start = 0
            while True:
                pos = line.find(old, start)
                if pos == -1:
                    break
                mutated_line = line[:pos] + new + line[pos + len(old):]
                yield (idx + 1, f"{old.strip() or old!r}->{new.strip() or new!r}",
                       line, mutated_line)
                start = pos + len(old)

        # EVERY standalone integer literal on the line, each mutated three ways
        # (+1, -1, and a role-flip 0<->1) — off-by-one + zero/boundary faults.
        for m in re.finditer(r'(?<![\w.])(\d+)(?![\w.])', line):
            orig = m.group(1)
            iv = int(orig)
            variants = {str(iv + 1), str(iv - 1)}
            variants.add("1" if iv == 0 else "0")   # 0<->1 role flip
            for newval in sorted(variants):
                if newval == orig:
                    continue
                mutated_line = line[:m.start()] + newval + line[m.end():]
                yield (idx + 1, f"int {orig}->{newval}", line, mutated_line)


def generate_mutants(source: str, max_mutants: int = 20) -> List[Dict[str, Any]]:
    """Return up to N mutants of `source`, each = one operator swap at one spot
    (skipping comment lines). Each: {op, lineno, original_line, mutated_line, mutated_source}."""
    lines = source.split('\n')
    mutants: List[Dict[str, Any]] = []
    for lineno, op, original_line, mutated_line in _iter_mutations(source):
        new_lines = lines[:lineno - 1] + [mutated_line] + lines[lineno:]
        mutants.append({
            "op": op,
            "lineno": lineno,
            "original_line": original_line,
            "mutated_line": mutated_line,
            "mutated_source": '\n'.join(new_lines),
        })
        if len(mutants) >= max_mutants:
            break
    return mutants


# ---------------------------------------------------------------------------
# Repo-wide discovery (DRY — never executes anything, never touches disk state)
# ---------------------------------------------------------------------------

def _iter_source_files(root: str, include: Tuple[str, ...],
                       exclude: Tuple[str, ...]) -> Iterator[str]:
    """Yield source files under `root` (a dir or a single file) whose basename OR
    path-relative-to-root matches any `include` glob and no `exclude` glob. Sorted
    for deterministic discovery order."""
    import os, fnmatch
    if os.path.isfile(root):
        candidates = [root]
        base_dir = os.path.dirname(root) or "."
    else:
        candidates = []
        for dirpath, _dirs, names in os.walk(root):
            for name in names:
                candidates.append(os.path.join(dirpath, name))
        base_dir = root

    def _matches(path: str, patterns: Tuple[str, ...]) -> bool:
        rel = os.path.relpath(path, base_dir)
        base = os.path.basename(path)
        return any(fnmatch.fnmatch(base, p) or fnmatch.fnmatch(rel, p) for p in patterns)

    for path in sorted(candidates):
        if not _matches(path, include):
            continue
        if exclude and _matches(path, exclude):
            continue
        yield path


def discover_mutants(root: str,
                     include: Tuple[str, ...] = DEFAULT_INCLUDE,
                     exclude: Tuple[str, ...] = DEFAULT_EXCLUDE,
                     max_per_file: int = 0) -> List[Dict[str, Any]]:
    """DRY-RUN, repo-wide: enumerate EVERY candidate mutant across all matching
    files under `root`. Executes nothing (no suite run, no server, no PHP) and
    writes nothing — this is the honesty primitive that lets a caller show
    "repo has M mutants" before committing to run any of them.

    Returns a catalog: a flat list of lightweight entries, each
    {file, lineno, op, original_line, mutated_line}. Full mutated file text is
    reconstructed lazily at execution time, so the catalog stays small even for
    thousands of mutants. `max_per_file` (>0) caps enumeration per file."""
    import os
    catalog: List[Dict[str, Any]] = []
    for path in _iter_source_files(root, include, exclude):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                source = f.read()
        except (OSError, UnicodeDecodeError):
            continue
        n = 0
        abspath = os.path.abspath(path)
        for lineno, op, original_line, mutated_line in _iter_mutations(source):
            catalog.append({
                "file": abspath,
                "lineno": lineno,
                "op": op,
                "original_line": original_line,
                "mutated_line": mutated_line,
            })
            n += 1
            if max_per_file and n >= max_per_file:
                break
    return catalog


def discovery_summary(catalog: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate a catalog for an up-front honesty report: total discovered,
    number of files, and per-file / per-operator breakdowns."""
    by_file: Dict[str, int] = {}
    by_op: Dict[str, int] = {}
    for e in catalog:
        by_file[e["file"]] = by_file.get(e["file"], 0) + 1
        by_op[e["op"]] = by_op.get(e["op"], 0) + 1
    return {
        "discovered": len(catalog),
        "files": len(by_file),
        "byFile": by_file,
        "byOperator": by_op,
    }


def sample_catalog(catalog: List[Dict[str, Any]], budget: int,
                   per_file_cap: int = 0, seed: int = 1337) -> List[Dict[str, Any]]:
    """Deterministically select a representative subset of `catalog` to execute.

    Stratified two ways so a sampled score is representative, not lopsided:
      * across FILES — round-robin, so no single big file dominates; and
      * across OPERATOR types within a file — round-robin over ops, so the sample
        isn't all `+ -> -`.
    Seeded (default 1337) so runs are reproducible. `per_file_cap` (>0) bounds how
    many mutants any one file may contribute. If `budget` >= len(catalog) and no
    per-file cap applies, the whole catalog is returned (run-all). Returns fewer
    than `budget` only when the caps make more impossible."""
    import random
    if not catalog:
        return []
    if budget is None or budget <= 0:
        budget = len(catalog)
    if budget >= len(catalog) and not per_file_cap:
        return list(catalog)

    rng = random.Random(seed)

    # Group by file; within a file build an operator-diverse queue (round-robin
    # across ops, each op's entries kept in discovered order for determinism).
    by_file: Dict[str, List[Dict[str, Any]]] = {}
    for e in catalog:
        by_file.setdefault(e["file"], []).append(e)

    file_queues: Dict[str, List[Dict[str, Any]]] = {}
    for fpath, entries in by_file.items():
        by_op: Dict[str, List[Dict[str, Any]]] = {}
        for e in entries:
            by_op.setdefault(e["op"], []).append(e)
        op_names = list(by_op.keys())
        rng.shuffle(op_names)
        queue: List[Dict[str, Any]] = []
        pos = {op: 0 for op in op_names}
        remaining = len(entries)
        while remaining:
            for op in op_names:
                i = pos[op]
                if i < len(by_op[op]):
                    queue.append(by_op[op][i])
                    pos[op] = i + 1
                    remaining -= 1
        file_queues[fpath] = queue

    files = list(file_queues.keys())
    rng.shuffle(files)

    picks: List[Dict[str, Any]] = []
    taken = {f: 0 for f in files}
    progressed = True
    while len(picks) < budget and progressed:
        progressed = False
        for f in files:
            if len(picks) >= budget:
                break
            idx = taken[f]
            if idx >= len(file_queues[f]):
                continue
            if per_file_cap and idx >= per_file_cap:
                continue
            picks.append(file_queues[f][idx])
            taken[f] = idx + 1
            progressed = True
    return picks


def plan_execution(catalog: List[Dict[str, Any]], budget: int,
                   per_file_cap: int = 0, seed: int = 1337,
                   seconds_per_mutant: float = DEFAULT_SECONDS_PER_MUTANT) -> Dict[str, Any]:
    """Up-front, EXECUTION-FREE plan: given a discovered catalog and a budget,
    report how many mutants would actually run and a rough wall-clock estimate.
    Lets a caller print "repo has M mutants; executing N (~T min)" honestly before
    doing any work."""
    sampled = len(sample_catalog(catalog, budget, per_file_cap, seed))
    return {
        "discovered": len(catalog),
        "sampled": sampled,
        "budget": budget,
        "perFileCap": per_file_cap,
        "estimatedSeconds": round(sampled * seconds_per_mutant, 1),
    }


class MutationTester:
    """Run a caller-supplied test suite against injected mutants and score it."""

    # ---- disk helpers -----------------------------------------------------
    @staticmethod
    def _write(path: str, text: str) -> None:
        # newline='' disables universal-newline translation on write, so a source
        # whose original line endings are CRLF is restored/written byte-for-byte
        # instead of being silently rewritten to LF (which would dirty the tree).
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)

    @staticmethod
    def _recover_orphans(files: List[str]) -> List[str]:
        """S4: if a previous run was hard-killed mid-mutation, a `<path>.si-orig`
        backup will still exist next to the source (which may hold an injected
        bug). Restore any such file from its backup BEFORE doing anything else,
        so the tool never leaves — or builds on — a corrupted source tree."""
        import os
        recovered = []
        for path in files:
            bak = path + ".si-orig"
            if os.path.exists(bak):
                # Skip a truncated/empty backup: a crash DURING the backup write
                # (before any mutation) can leave a 0-byte .si-orig while the source
                # itself is still clean — restoring from it would corrupt a good file.
                if os.path.getsize(bak) == 0:
                    os.remove(bak)
                    continue
                with open(bak, "r", encoding="utf-8", newline='') as f:
                    good = f.read()
                with open(path, "w", encoding="utf-8", newline='') as f:
                    f.write(good)
                os.remove(bak)
                recovered.append(path)
        return recovered

    def _mutate_file_safely(self, path: str, body: Callable[[str], None]) -> None:
        """S4 crash-safe wrapper around mutating ONE file. Writes an on-disk backup
        ATOMICALLY (tmp + fsync + os.replace) so even a SIGKILL / OOM / power-loss
        between mutation and restore is recoverable on the next run (see
        `_recover_orphans`), installs SIGINT/SIGTERM handlers that restore before
        exiting, runs `body(original)` (which does the per-mutant loop), then ALWAYS
        restores the source from the in-memory original and drops the backup."""
        import os, signal
        # newline='' preserves the source's real line endings (CRLF stays CRLF), so
        # the backup and every restore are byte-for-byte identical to the original.
        with open(path, 'r', encoding='utf-8', newline='') as f:
            original = f.read()

        bak = path + ".si-orig"
        # Write the backup ATOMICALLY (tmp + os.replace) so a crash mid-write
        # can't leave a partial .si-orig that a later recovery would trust.
        _tmp = bak + ".tmp"
        with open(_tmp, 'w', encoding='utf-8', newline='') as f:
            f.write(original)
            f.flush()
            os.fsync(f.fileno())
        os.replace(_tmp, bak)

        def _restore_and_exit(signum, frame, _p=path, _o=original, _b=bak):
            with open(_p, 'w', encoding='utf-8', newline='') as f:
                f.write(_o)
            if os.path.exists(_b):
                os.remove(_b)
            raise SystemExit(f"[mutation] interrupted — restored {_p}")

        prev_int = signal.signal(signal.SIGINT, _restore_and_exit)
        prev_term = signal.signal(signal.SIGTERM, _restore_and_exit)
        try:
            body(original)
        finally:
            # restore from the in-memory original, drop the backup, un-hook signals
            self._write(path, original)
            if os.path.exists(bak):
                os.remove(bak)
            signal.signal(signal.SIGINT, prev_int)
            signal.signal(signal.SIGTERM, prev_term)

    # ---- legacy single-file / explicit-file runner ------------------------
    def run(self, files: List[str], run_tests: Callable[[], Tuple[int, int]],
            max_mutants_per_file: int = 10) -> Dict[str, Any]:
        """Score a fixed list of files, up to `max_mutants_per_file` each. Kept for
        back-compat; `execute_catalog` is the repo-wide, budgeted entry point."""
        recovered = self._recover_orphans(files)
        if recovered:
            print(f"[mutation] recovered {len(recovered)} source file(s) from a "
                  f"previous interrupted run before starting")
        base_passed, base_failed = run_tests()
        if base_passed <= 0:
            return {"error": "baseline has no passing tests — cannot score mutants",
                    "baselinePassed": base_passed, "baselineFailed": base_failed}

        tried = killed = survived = 0
        surviving_samples: List[Dict[str, Any]] = []

        for path in files:
            def _body(original: str):
                nonlocal tried, killed, survived
                for mut in generate_mutants(original, max_mutants_per_file):
                    tried += 1
                    try:
                        self._write(path, mut["mutated_source"])
                        _p, mut_failed = run_tests()
                        if mut_failed > base_failed:
                            killed += 1
                        else:
                            survived += 1
                            if len(surviving_samples) < 10:
                                surviving_samples.append(
                                    {"file": path, "lineno": mut["lineno"], "op": mut["op"]})
                    finally:
                        self._write(path, original)   # ALWAYS restore (in-memory)

            try:
                self._mutate_file_safely(path, _body)
            except OSError:
                continue

        return {
            "mutantsTried": tried,
            "killed": killed,
            "survived": survived,
            "mutationScore": round(killed / tried, 3) if tried else 0.0,
            "surviving": surviving_samples,
        }

    # ---- repo-wide, budgeted, honest runner -------------------------------
    def execute_catalog(self, catalog: List[Dict[str, Any]],
                        run_tests: Callable[[], Tuple[int, int]],
                        budget: int = 200, per_file_cap: int = 0,
                        time_budget_seconds: float = 0, seed: int = 1337) -> Dict[str, Any]:
        """Execute a representative sample of a discovered catalog and score it.

        Honesty guarantees:
          * `discovered` (full catalog size) is always reported alongside
            `executed`, so a sampled score is never read as full coverage;
          * score is `killed / executed` (never / discovered);
          * survivors carry file:line + operator + original→mutant.

        Bounds: `budget` (max mutants to run), `per_file_cap` (max per file), and
        `time_budget_seconds` (soft wall-clock cap: the sample is pre-trimmed to the
        estimate AND execution stops early once the deadline passes). Sampling is
        deterministic via `seed`."""
        import os, time
        discovered = len(catalog)
        picks = sample_catalog(catalog, budget, per_file_cap, seed)

        files_in_play = list(dict.fromkeys(p["file"] for p in picks))
        recovered = self._recover_orphans(files_in_play)
        if recovered:
            print(f"[mutation] recovered {len(recovered)} source file(s) from a "
                  f"previous interrupted run before starting")

        t0 = time.time()
        base_passed, base_failed = run_tests()
        base_dur = max(time.time() - t0, 1e-6)
        if base_passed <= 0:
            return {"error": "baseline has no passing tests — cannot score mutants",
                    "discovered": discovered, "executed": 0,
                    "baselinePassed": base_passed, "baselineFailed": base_failed}

        # Time budget: pre-trim the sample to the estimate, then also enforce a hard
        # deadline during execution (the honest guard — real per-mutant cost varies).
        trimmed_for_time = False
        deadline: Optional[float] = None
        if time_budget_seconds and time_budget_seconds > 0:
            allowed = max(1, int(time_budget_seconds / base_dur))
            if allowed < len(picks):
                picks = picks[:allowed]
                trimmed_for_time = True
            deadline = time.time() + time_budget_seconds

        # Group the sample by file so each file is backed up / restored exactly once.
        by_file: Dict[str, List[Dict[str, Any]]] = {}
        for p in picks:
            by_file.setdefault(p["file"], []).append(p)

        tried = killed = survived = 0
        survivors: List[Dict[str, Any]] = []
        stopped_early = False

        for path, muts in by_file.items():
            if deadline and time.time() >= deadline:
                stopped_early = True
                break

            def _body(original: str, _muts=muts, _path=path):
                nonlocal tried, killed, survived, stopped_early
                orig_lines = original.split('\n')
                for mut in _muts:
                    if deadline and time.time() >= deadline:
                        stopped_early = True
                        return
                    ln = mut["lineno"]
                    # Reconstruct mutated file text lazily from the catalog entry.
                    if 1 <= ln <= len(orig_lines) and orig_lines[ln - 1] == mut["original_line"]:
                        mutated = '\n'.join(
                            orig_lines[:ln - 1] + [mut["mutated_line"]] + orig_lines[ln:])
                    else:
                        # Source drifted since discovery — skip rather than misapply.
                        continue
                    tried += 1
                    try:
                        self._write(_path, mutated)
                        _p, mut_failed = run_tests()
                        if mut_failed > base_failed:
                            killed += 1
                        else:
                            survived += 1
                            if len(survivors) < _MAX_SURVIVOR_SAMPLES:
                                survivors.append({
                                    "file": _path, "lineno": ln, "op": mut["op"],
                                    "original": mut["original_line"].strip(),
                                    "mutant": mut["mutated_line"].strip(),
                                })
                    finally:
                        self._write(_path, original)   # ALWAYS restore (in-memory)

            try:
                self._mutate_file_safely(path, _body)
            except OSError:
                continue
            if stopped_early:
                break

        return {
            "discovered": discovered,
            "sampled": len(picks),
            "executed": tried,
            "killed": killed,
            "survived": survived,
            "mutationScore": round(killed / tried, 3) if tried else 0.0,
            "coverage": round(tried / discovered, 3) if discovered else 0.0,
            "budget": budget,
            "perFileCap": per_file_cap,
            "stoppedEarly": stopped_early,
            "trimmedForTime": trimmed_for_time,
            "surviving": survivors,
        }

    def run_repo(self, root: str, run_tests: Callable[[], Tuple[int, int]],
                 include: Tuple[str, ...] = DEFAULT_INCLUDE,
                 exclude: Tuple[str, ...] = DEFAULT_EXCLUDE,
                 budget: int = 200, per_file_cap: int = 0,
                 time_budget_seconds: float = 0, seed: int = 1337,
                 max_per_file_discovery: int = 0) -> Dict[str, Any]:
        """Convenience: discover repo-wide, then execute a budgeted sample. Equivalent
        to `execute_catalog(discover_mutants(root, ...), ...)`."""
        catalog = discover_mutants(root, include, exclude, max_per_file_discovery)
        return self.execute_catalog(catalog, run_tests, budget=budget,
                                    per_file_cap=per_file_cap,
                                    time_budget_seconds=time_budget_seconds, seed=seed)


if __name__ == "__main__":
    import os, tempfile

    # ------------------------------------------------------------------ #
    # 1) Legacy single-file run: mutants generated, scored, byte-restore  #
    # ------------------------------------------------------------------ #
    d = tempfile.mkdtemp()
    calc = os.path.join(d, "calc.py")
    ORIGINAL = "def add(a, b):\n    return a + b\n\ndef is_pos(x):\n    return x > 0\n"
    with open(calc, "w") as f:
        f.write(ORIGINAL)

    def run_tests_calc():
        ns: Dict[str, Any] = {}
        try:
            with open(calc) as f:
                exec(f.read(), ns)
            ok = (ns["add"](2, 3) == 5 and ns["is_pos"](1) is True and ns["is_pos"](-1) is False)
        except Exception:
            ok = False
        return (2, 0) if ok else (0, 2)

    assert run_tests_calc() == (2, 0), "baseline should pass"
    muts = generate_mutants(ORIGINAL)
    assert muts, "should generate mutants"

    result = MutationTester().run([calc], run_tests_calc, max_mutants_per_file=20)
    print("legacy result:", {k: result[k] for k in ("mutantsTried", "killed", "survived", "mutationScore")})
    assert result["mutationScore"] > 0, "the + -> - and > -> <= mutants must be killed"
    with open(calc) as f:
        assert f.read() == ORIGINAL, "file must be restored byte-for-byte"

    # ------------------------------------------------------------------ #
    # 2) Repo-wide discovery across >1 file, WITHOUT executing anything   #
    # ------------------------------------------------------------------ #
    repo = tempfile.mkdtemp()
    fa = os.path.join(repo, "add.php")     # .php extension, python-evaluable body
    fb = os.path.join(repo, "chk.php")
    SRC_A = "def add(a, b):\n    return a + b\n"
    SRC_B = "def pos(x):\n    return x > 0\n"
    with open(fa, "w") as f:
        f.write(SRC_A)
    with open(fb, "w") as f:
        f.write(SRC_B)

    catalog = discover_mutants(repo, include=("*.php",))
    summary = discovery_summary(catalog)
    print("discovery:", summary["discovered"], "mutants across", summary["files"], "files")
    assert summary["discovered"] > 1, "discovery must find >1 mutant"
    assert summary["files"] == 2, "discovery must span both source files"
    # DRY guarantee: files still byte-identical after discovery (nothing executed/written).
    assert open(fa).read() == SRC_A and open(fb).read() == SRC_B, "discovery must not touch sources"

    # ------------------------------------------------------------------ #
    # 3) Stratified sampling: deterministic, respects budget & per_file_cap#
    # ------------------------------------------------------------------ #
    s1 = sample_catalog(catalog, budget=3, seed=42)
    s2 = sample_catalog(catalog, budget=3, seed=42)
    keyed = lambda s: [(e["file"], e["lineno"], e["op"]) for e in s]
    assert keyed(s1) == keyed(s2), "sampling must be deterministic for a fixed seed"
    assert len(s1) == 3, "sampling must respect budget"

    capped = sample_catalog(catalog, budget=999, per_file_cap=1)
    per_file_counts: Dict[str, int] = {}
    for e in capped:
        per_file_counts[e["file"]] = per_file_counts.get(e["file"], 0) + 1
    assert all(c <= 1 for c in per_file_counts.values()), "per_file_cap must bound each file"
    assert len(per_file_counts) == 2, "cap should still spread across both files"

    allp = sample_catalog(catalog, budget=10 ** 9)
    assert len(allp) == len(catalog), "budget >= M must run all"

    plan = plan_execution(catalog, budget=2, seconds_per_mutant=100.0)
    assert plan["discovered"] == len(catalog) and plan["sampled"] == 2, "plan must be honest"
    assert plan["estimatedSeconds"] == 200.0, "estimate = sampled * seconds_per_mutant"

    # ------------------------------------------------------------------ #
    # 4) Budgeted execution: score = killed/executed, discovered surfaced,#
    #    tree left byte-identical (S4 backup/restore intact)              #
    # ------------------------------------------------------------------ #
    def run_tests_repo():
        ns: Dict[str, Any] = {}
        try:
            with open(fa) as f:
                exec(f.read(), ns)
            with open(fb) as f:
                exec(f.read(), ns)
            ok = (ns["add"](2, 3) == 5 and ns["pos"](1) is True and ns["pos"](-1) is False)
        except Exception:
            ok = False
        return (2, 0) if ok else (0, 2)

    assert run_tests_repo() == (2, 0), "repo baseline should pass"

    full = MutationTester().execute_catalog(catalog, run_tests_repo, budget=10 ** 9)
    print("execute (all):", {k: full[k] for k in
          ("discovered", "executed", "killed", "survived", "mutationScore", "coverage")})
    assert full["discovered"] == len(catalog), "discovered must equal full catalog"
    assert full["executed"] == len(catalog) and full["coverage"] == 1.0, "budget>=M runs all"
    assert full["killed"] > 0, "+ -> - and > -> <= mutants must be killed"
    assert 0.0 <= full["mutationScore"] <= 1.0
    for s in full["surviving"]:
        assert {"file", "lineno", "op", "original", "mutant"} <= set(s), "survivor detail required"
    assert open(fa).read() == SRC_A and open(fb).read() == SRC_B, "tree must be byte-identical"
    assert not os.path.exists(fa + ".si-orig") and not os.path.exists(fb + ".si-orig"), "no orphan backups"

    # Sampled execution: executed < discovered, honestly surfaced.
    small = MutationTester().execute_catalog(catalog, run_tests_repo, budget=2)
    print("execute (budget=2):", {k: small[k] for k in ("discovered", "executed", "coverage")})
    assert small["discovered"] == len(catalog), "discovered surfaced even when sampling"
    assert small["executed"] <= 2 and small["executed"] < small["discovered"], "sampled < full"
    assert open(fa).read() == SRC_A and open(fb).read() == SRC_B, "tree byte-identical after sample"

    # ------------------------------------------------------------------ #
    # 5) CRLF preservation: a source with Windows line endings must be    #
    #    restored BYTE-for-byte (not silently rewritten to LF, which would #
    #    dirty a whole file in git). Regression test for the S4 restore.   #
    # ------------------------------------------------------------------ #
    fc = os.path.join(repo, "crlf.php")
    SRC_C_BYTES = b"def add(a, b):\r\n    return a + b\r\n"   # CRLF on the wire
    with open(fc, "wb") as f:
        f.write(SRC_C_BYTES)
    cat_c = discover_mutants(fc, include=("*.php",))
    assert cat_c, "should discover a mutant in the CRLF file"
    _ = MutationTester().execute_catalog(cat_c, run_tests_repo, budget=10 ** 9)
    with open(fc, "rb") as f:
        after = f.read()
    assert after == SRC_C_BYTES, ("CRLF source must be restored byte-for-byte "
                                  f"(got {after!r})")
    assert not os.path.exists(fc + ".si-orig"), "no orphan backup for the CRLF file"
    print("CRLF preservation: Windows-line-ending source restored byte-for-byte")

    print("SELF-TEST PASS")
