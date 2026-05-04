/**
 * List of agents the control panel exposes for policy configuration.
 *
 * Includes:
 * - SDD stages (well-known)
 * - Generic agent types (common across projects)
 *
 * v0.3 uses a static list. Future v0.4 will auto-discover from the user's
 * opencode.json `agent` block via api.client or filesystem read.
 *
 * Categories help organize the command palette:
 *   - SDD · sdd-explore, sdd-propose, sdd-spec, sdd-design, sdd-tasks,
 *           sdd-apply, sdd-verify, sdd-archive
 *   - Generic · code-researcher, code-reviewer, code-writer, explorer,
 *               planner, researcher, refactorer, debugger, writer,
 *               judgment-day, branch-pr, issue-creation
 */

export interface AgentEntry {
  readonly name: string;
  readonly category: "SDD" | "Generic" | "Custom";
  readonly description?: string;
}

export const AGENTS: readonly AgentEntry[] = [
  // SDD stages
  { name: "sdd-explore", category: "SDD", description: "Explore + investigate before commit" },
  { name: "sdd-propose", category: "SDD", description: "Author change proposal" },
  { name: "sdd-spec", category: "SDD", description: "Write delta specs" },
  { name: "sdd-design", category: "SDD", description: "Tech design + ADRs" },
  { name: "sdd-tasks", category: "SDD", description: "Break down into task checklist" },
  { name: "sdd-apply", category: "SDD", description: "Implement tasks" },
  { name: "sdd-verify", category: "SDD", description: "Validate implementation" },
  { name: "sdd-archive", category: "SDD", description: "Sync delta + archive change" },
  // Generic agents
  { name: "code-researcher", category: "Generic", description: "Research code patterns" },
  { name: "code-reviewer", category: "Generic", description: "Review code changes" },
  { name: "code-writer", category: "Generic", description: "Write production code" },
  { name: "explorer", category: "Generic", description: "Explore codebase" },
  { name: "planner", category: "Generic", description: "Plan implementation" },
  { name: "researcher", category: "Generic", description: "General research" },
  { name: "refactorer", category: "Generic", description: "Refactor existing code" },
  { name: "debugger", category: "Generic", description: "Debug issues" },
  { name: "writer", category: "Generic", description: "Write docs / content" },
  { name: "judgment-day", category: "Generic", description: "Adversarial review" },
  { name: "branch-pr", category: "Generic", description: "PR creation workflow" },
  { name: "issue-creation", category: "Generic", description: "GitHub issue workflow" },
] as const;

export const AGENTS_BY_CATEGORY = AGENTS.reduce(
  (acc, agent) => {
    if (!acc[agent.category]) acc[agent.category] = [];
    acc[agent.category]!.push(agent);
    return acc;
  },
  {} as Record<string, AgentEntry[]>,
);
