## graphify

This project has a graphify knowledge graph at .graphify/.

Rules:
- Before answering architecture or codebase questions, read .graphify/GRAPH_REPORT.md for god nodes and community structure
- If .graphify/wiki/index.md exists, navigate it instead of reading raw files
- If .graphify/graph.json is missing but graphify-out/graph.json exists, run `graphify migrate-state --dry-run` before relying on legacy state
- If .graphify/needs_update exists or .graphify/branch.json has stale=true, warn before relying on semantic results and run /graphify . --update when appropriate
- If the graphify MCP server is active, prefer graph tools like `query_graph`, `get_node`, and `shortest_path` for architecture navigation
- After modifying code files in this session, run `npx graphify hook-rebuild` to keep the graph current
