"""
Autonomous AI Agent Engine (ReAct Pattern)
Equips SystemIntel with an agentic loop (Thought -> Action -> Observation).
Instead of just answering one-shot questions, the Agent can iteratively
query the graph, read source files, and run tests to solve high-level tasks.
"""

import re
import os
import json
from typing import Dict, Any, List, Optional
from graph_builder import SystemGraphBuilder
from ai_provider import AIProvider

class SystemIntelAgent:
    def __init__(self, ai_provider: AIProvider, graph_data: Dict[str, Any]):
        self.ai = ai_provider
        self.graph_data = graph_data
        # Repo root the graph was scanned from — used to resolve relative file
        # paths in READ_FILE (graph node paths are stored relative to the repo).
        self.repo_root = graph_data.get("repoPath", "") or ""
        self.max_iterations = 10
        self.tools = {
            "QUERY_GRAPH": self._tool_query_graph,
            "READ_FILE":   self._tool_read_file,
            "GET_NODE_LINKS": self._tool_get_node_links,
        }
        
    def _get_system_prompt(self) -> str:
        return (
            "You are SystemIntel, an autonomous AI software engineering agent. "
            "You have access to a deterministic System Graph of the codebase and can read files. "
            "You must use a Thought -> Action -> Observation loop to solve the user's task.\n\n"
            "AVAILABLE TOOLS:\n"
            "1. QUERY_GRAPH: Search the graph for entities whose name or file contains a keyword.\n"
            "   Format: ACTION: QUERY_GRAPH | ARGS: <single plain keyword, e.g. order>  (NOT a Cypher/SQL query)\n"
            "2. GET_NODE_LINKS: Get all incoming/outgoing connections for a specific node ID.\n"
            "   Format: ACTION: GET_NODE_LINKS | ARGS: <node_id from a prior QUERY_GRAPH result>\n"
            "3. READ_FILE: Read the contents of a source code file (path as shown in graph results).\n"
            "   Format: ACTION: READ_FILE | ARGS: <file_path>\n\n"
            "INSTRUCTIONS:\n"
            "1. Output a 'THOUGHT:' explaining your reasoning.\n"
            "2. Then output ONE 'ACTION:' line and STOP. Emit exactly one action per turn.\n"
            "3. The system executes the tool and gives you the real 'OBSERVATION:'. "
            "NEVER write your own 'OBSERVATION:' and never invent tool output — anything you "
            "write after the ACTION line is discarded.\n"
            "4. Base every conclusion ONLY on real OBSERVATION text. If a file is 'File not found' "
            "or a query returns nothing, say so — do not fabricate contents.\n"
            "5. When you have enough real evidence, output 'FINAL_ANSWER: <your comprehensive answer>'.\n"
        )

    def run(self, task: str) -> str:
        """Run the autonomous agent loop."""
        if not self.ai.is_enabled():
            return "Error: AI Provider is not enabled. Agent requires a working LLM."

        task_line = f"USER TASK: {task}\n"
        history = task_line
        # GraphRAG: ground the agent with the relevant subgraph up front (scales to
        # any repo — retrieves a slice, never dumps the whole graph).
        try:
            from graph_rag import retrieve_context
            ctx = retrieve_context(self.graph_data, task, max_chars=3000)
            if ctx:
                history += f"\nRELEVANT GRAPH CONTEXT (retrieved):\n{ctx}\n"
        except Exception:
            pass
        print(f"\n\033[35m[Agent Task]\033[0m {task}")
        MAX_HISTORY_CHARS = 12000  # Stay well under typical 16k token context windows

        for iteration in range(self.max_iterations):
            # Truncate history from the front if needed, always keeping the task
            if len(history) > MAX_HISTORY_CHARS:
                overflow = history[len(task_line):]  # everything after the task line
                history = task_line + "...[earlier context truncated]...\n" + overflow[-(MAX_HISTORY_CHARS - len(task_line)):]

            # Call LLM with the running ReAct transcript
            response = self.ai._call_llm(history, system_prompt=self._get_system_prompt())
            if not response:
                return "Error: LLM failed to respond."

            # Strip model-internal reasoning (e.g. qwen <think>...</think>) so it
            # cannot pollute the transcript or be mistaken for the answer.
            response = self._strip_think(response)

            action_m = re.search(r'ACTION:\s*([A-Z_]+)\s*\|\s*ARGS:\s*([^\n]*)', response)
            final_m  = re.search(r'FINAL_ANSWER:\s*(.*)', response, re.DOTALL)

            # A turn is EITHER an action or a final answer — honour whichever the
            # model emits FIRST. Executing the earliest action stops the model from
            # fabricating its own OBSERVATION and then "concluding" from fake data.
            if final_m and (not action_m or final_m.start() < action_m.start()):
                reasoning = response[:final_m.start()].strip()
                if reasoning:
                    print(f"\n\033[36m[Agent Reasoning]\033[0m\n{reasoning}")
                return final_m.group(1).strip()

            if action_m:
                # Keep only up to the end of the first ACTION line; DISCARD anything
                # written after it (fabricated OBSERVATION, repeated/extra actions).
                reasoning = response[:action_m.end()].strip()
                print(f"\n\033[36m[Agent Reasoning]\033[0m\n{reasoning}")
                history += f"\n{reasoning}\n"

                action = action_m.group(1).strip()
                args   = action_m.group(2).strip().strip('"\'')
                if action in self.tools:
                    print(f"\033[33m[Agent Executing Tool]\033[0m {action} ({args})")
                    try:
                        observation = self.tools[action](args)
                    except Exception as e:
                        observation = f"Error executing tool: {e}"
                else:
                    observation = (f"Error: Tool '{action}' does not exist. "
                                   "Valid tools: QUERY_GRAPH, GET_NODE_LINKS, READ_FILE.")

                print(f"\033[32m[Observation]\033[0m {str(observation)[:200]}...")
                history += f"OBSERVATION: {observation}\n"
            else:
                # No parseable action and no final answer — nudge the model.
                print(f"\n\033[36m[Agent Reasoning]\033[0m\n{response}")
                history += f"\n{response}\n"
                history += ("OBSERVATION: No valid ACTION or FINAL_ANSWER found. Respond with "
                            "'ACTION: <TOOL> | ARGS: <args>' or 'FINAL_ANSWER: <answer>'.\n")

        return "Error: Max agent iterations reached without a FINAL_ANSWER."

    def _strip_think(self, text: str) -> str:
        """Remove <think>...</think> reasoning blocks some models emit inline
        (and any unterminated trailing block if the model ran out of tokens)."""
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<think>.*$', '', text, flags=re.DOTALL | re.IGNORECASE)
        return text.strip()

    # ── Tools ─────────────────────────────────────────────────────────────

    def _tool_query_graph(self, keyword: str) -> str:
        """Search graph nodes by keyword. Tolerates a model passing a Cypher/SQL/JSON
        blob instead of a plain keyword by extracting searchable word tokens."""
        raw = (keyword or "").strip().strip('"\'').lower()
        terms = [raw] if raw else []
        # If it isn't a clean keyword, pull out word tokens (e.g. 'order' from
        # '{"query":"MATCH (n:Order) RETURN n"}') and drop query-language noise.
        if raw and not re.fullmatch(r'[a-z0-9_\- ]+', raw):
            stop = {"match", "return", "limit", "where", "select", "from", "query", "node", "nodes"}
            terms += [t for t in re.findall(r'[a-z0-9_]{3,}', raw) if t not in stop]

        results, seen = [], set()
        for node in self.graph_data.get("nodes", []):
            name = node["name"].lower()
            fp   = node.get("metadata", {}).get("filePath", "").lower()
            if any(t and (t in name or t in fp) for t in terms):
                if node["id"] in seen:
                    continue
                seen.add(node["id"])
                results.append(f"ID: {node['id']}, Type: {node['type']}, Name: {node['name']}, File: {node.get('metadata', {}).get('filePath', 'N/A')}")

        if not results:
            return f"No nodes found matching '{keyword}'. Try a shorter, single keyword."
        return "Matches found:\n" + "\n".join(results[:10])  # limit to 10

    def _tool_get_node_links(self, node_id: str) -> str:
        """Get incoming and outgoing edges for a node (by exact ID, or by a
        name/ID substring match if the exact ID isn't present)."""
        node_id = (node_id or "").strip().strip('"\'')
        edges = self.graph_data.get("edges", [])
        nodes = {n["id"]: n for n in self.graph_data.get("nodes", [])}

        if node_id not in nodes:
            match = next((n for n in nodes.values()
                          if node_id.lower() in n["name"].lower()
                          or node_id.lower() in n["id"].lower()), None)
            if not match:
                return (f"Node ID '{node_id}' not found. "
                        "Use QUERY_GRAPH first to obtain a valid node ID.")
            node_id = match["id"]

        incoming = []
        outgoing = []
        
        for e in edges:
            if e["target"] == node_id and e["source"] in nodes:
                src = nodes[e["source"]]
                incoming.append(f"[{src['type']}] {src['name']} --({e['relationship']})-->")
            elif e["source"] == node_id and e["target"] in nodes:
                tgt = nodes[e["target"]]
                outgoing.append(f"--({e['relationship']})--> [{tgt['type']}] {tgt['name']}")
                
        res = "INCOMING:\n" + ("\n".join(incoming) if incoming else "None") + "\n\n"
        res += "OUTGOING:\n" + ("\n".join(outgoing) if outgoing else "None")
        return res

    def _tool_read_file(self, file_path: str) -> str:
        """Read a source file. Graph node paths are stored relative to the scanned
        repo, so resolve against repo_root as well as the current directory."""
        file_path = (file_path or "").strip().strip('"\'')
        candidates = [file_path]
        if self.repo_root and not os.path.isabs(file_path):
            candidates.append(os.path.join(self.repo_root, file_path))

        for path in candidates:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                # Truncate to not blow up the context window
                if len(content) > 3000:
                    return content[:3000] + "\n...[TRUNCATED]..."
                return content
            except (FileNotFoundError, IsADirectoryError):
                continue
            except Exception as e:
                return f"Failed to read file: {e}"

        return f"File not found: {file_path} (searched repo root: {self.repo_root or 'N/A'})"
