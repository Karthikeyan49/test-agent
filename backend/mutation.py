"""
Mutation Testing Harness
Measures whether a generated test suite actually CATCHES bugs — the real
test-quality KPI. It injects small "mutants" (flipped operators / constants)
into the source, re-runs the suite, and counts how many mutants the suite
"kills" (a test that passed on clean code now fails). Mutation score = the
fraction killed. Originals are always restored.
"""

import re
from typing import Dict, Any, List, Callable, Tuple

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
    ("True", "False"),  ("False", "True"),      # Python literals
    ("true", "false"),  ("false", "true"),      # PHP / JS / Java literals
]

# A line is treated as a comment (skipped) when its stripped form starts with any
# of these — covers #, // and /* */ single-line comment styles.
_COMMENT_PREFIXES = ("#", "//", "*", "/*")


def generate_mutants(source: str, max_mutants: int = 20) -> List[Dict[str, Any]]:
    """Return up to N mutants of `source`, each = one operator swap at one spot
    (skipping comment lines). Each: {op, lineno, original_line, mutated_line, mutated_source}."""
    lines = source.split('\n')
    mutants: List[Dict[str, Any]] = []

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith(_COMMENT_PREFIXES):
            continue

        # operator/keyword swaps — one per occurrence
        for old, new in _SWAPS:
            start = 0
            while True:
                pos = line.find(old, start)
                if pos == -1:
                    break
                mutated_line = line[:pos] + new + line[pos + len(old):]
                new_lines = lines[:idx] + [mutated_line] + lines[idx + 1:]
                mutants.append({
                    "op": f"{old.strip() or old!r}->{new.strip() or new!r}",
                    "lineno": idx + 1,
                    "original_line": line,
                    "mutated_line": mutated_line,
                    "mutated_source": '\n'.join(new_lines),
                })
                start = pos + len(old)
                if len(mutants) >= max_mutants:
                    return mutants

        # first standalone integer literal on the line -> +1
        m = re.search(r'(?<![\w.])(\d+)(?![\w.])', line)
        if m:
            newval = str(int(m.group(1)) + 1)
            mutated_line = line[:m.start()] + newval + line[m.end():]
            new_lines = lines[:idx] + [mutated_line] + lines[idx + 1:]
            mutants.append({
                "op": f"int {m.group(1)}->{newval}",
                "lineno": idx + 1,
                "original_line": line,
                "mutated_line": mutated_line,
                "mutated_source": '\n'.join(new_lines),
            })
            if len(mutants) >= max_mutants:
                return mutants

    return mutants


class MutationTester:
    """Run a caller-supplied test suite against injected mutants and score it."""

    def run(self, files: List[str], run_tests: Callable[[], Tuple[int, int]],
            max_mutants_per_file: int = 10) -> Dict[str, Any]:
        base_passed, base_failed = run_tests()
        if base_passed <= 0:
            return {"error": "baseline has no passing tests — cannot score mutants",
                    "baselinePassed": base_passed, "baselineFailed": base_failed}

        tried = killed = survived = 0
        surviving_samples: List[Dict[str, Any]] = []

        for path in files:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    original = f.read()
            except OSError:
                continue

            for mut in generate_mutants(original, max_mutants_per_file):
                tried += 1
                try:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(mut["mutated_source"])
                    _p, mut_failed = run_tests()
                    if mut_failed > base_failed:
                        killed += 1
                    else:
                        survived += 1
                        if len(surviving_samples) < 10:
                            surviving_samples.append(
                                {"file": path, "lineno": mut["lineno"], "op": mut["op"]})
                finally:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(original)   # ALWAYS restore

        return {
            "mutantsTried": tried,
            "killed": killed,
            "survived": survived,
            "mutationScore": round(killed / tried, 3) if tried else 0.0,
            "surviving": surviving_samples,
        }


if __name__ == "__main__":
    import os, tempfile

    d = tempfile.mkdtemp()
    calc = os.path.join(d, "calc.py")
    ORIGINAL = "def add(a, b):\n    return a + b\n\ndef is_pos(x):\n    return x > 0\n"
    with open(calc, "w") as f:
        f.write(ORIGINAL)

    def run_tests():
        ns: Dict[str, Any] = {}
        try:
            with open(calc) as f:
                exec(f.read(), ns)
            ok = (ns["add"](2, 3) == 5 and ns["is_pos"](1) is True and ns["is_pos"](-1) is False)
        except Exception:
            ok = False
        return (2, 0) if ok else (0, 2)

    assert run_tests() == (2, 0), "baseline should pass"
    muts = generate_mutants(ORIGINAL)
    assert muts, "should generate mutants"

    result = MutationTester().run([calc], run_tests, max_mutants_per_file=20)
    print("mutation result:", {k: result[k] for k in ("mutantsTried", "killed", "survived", "mutationScore")})
    assert result["mutationScore"] > 0, "the + -> - and > -> <= mutants must be killed"
    with open(calc) as f:
        assert f.read() == ORIGINAL, "file must be restored byte-for-byte"

    print("SELF-TEST PASS")
