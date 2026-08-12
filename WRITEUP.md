# Write-up: AI Agent Workflow Builder

## Schema Reasoning

The schema follows the relationship chain required by the assignment: `organizations → org_members → workflows → workflow_steps / workflow_triggers`, and `workflows → workflow_runs → step_runs`.

- **`organizations`** holds `quota_limit` / `quota_used` directly, since quota is an org-wide resource, not tied to any single workflow.
- **`org_members`** is a join table (`user_id`, `org_id`, `role`) rather than a role column on the user — this was a deliberate choice, since a single user can belong to multiple organizations with *different* roles in each (owner in one, viewer in another). A static per-user role would not support this; scoping role to the (user, org) pair is what makes true multi-tenancy possible.
- **`workflow_steps`** uses a `step_order` integer (not `order`, which is a reserved SQL keyword) plus a `step_type` text field and a `config` JSONB column. JSONB was chosen over a rigid per-step-type schema because each step type needs different configuration shapes (a prompt for `llm_call`, a URL/method for `http_request`, a condition for `conditional_branch`), and the assignment explicitly allows this.
- **`workflow_runs`** and **`step_runs`** are separated (one run has many step runs) so that a single execution's full history — including retries, errors, and the paused state — is fully auditable and queryable independently, which is also what the required subscription depends on.
- **`step_runs.approved_by` / `approved_at`** are nullable columns populated only when a step is an `approval_gate` that gets approved, keeping the audit trail on the same row as the step's other execution data rather than a separate approvals table.

## How the Two Permission Layers Are Enforced Differently

**Layer 1 (org + role scoping)** is enforced entirely as **Hasura row-level permissions**, using a single custom role called `user` (not separate `owner`/`editor`/`viewer` Hasura roles). This is deliberate: since one person can hold different roles in different orgs, the role check has to happen *dynamically per row*, not statically per JWT role claim. Every table's `select`/`insert` permission JSON traverses relationships back to `org_members` and checks `user_id = X-Hasura-User-Id` (and, where relevant, `role IN [...]`). For example, `workflows` insert permission requires the caller to have an `org_members` row for that workflow's org with `role IN [owner, editor]`. This means Postgres itself refuses the row — there is no way to bypass it from the client, including by guessing IDs, since the `_eq`/`_in` checks are evaluated server-side against the real session's user ID on every single request.

**Layer 2 (step-level gating)** is split across two mechanisms depending on *when* the decision needs to be made:
- Static gating (e.g., "only an owner can add a `db_write`/`notify`/webhook-trigger step") is still expressible as a Hasura `insert` permission, since it's a simple row-level check at write time — the permission JSON adds a `step_type NOT IN [...]` condition for the editor branch of an `_or`.
- **Dynamic, mid-execution gating** — specifically, approving a paused `approval_gate` — **cannot** be a database permission, because approval isn't a plain row read/write; it's a decision that has side effects (resuming execution of remaining steps). This is enforced in the `approveStep` Action's Node.js handler: before touching any data, it queries the step's org via relationships, checks the caller's `org_members.role` is `owner` or `editor`, and only then proceeds. If the check fails, the handler returns a 403 before any mutation happens — the frontend never even sees a resumable state.

## Approval-Gate Pause/Resume Implementation

`triggerWorkflowRun`'s execution loop (`executeWorkflowSteps` in `backend/index.js`) walks `workflow_steps` in `step_order`, creating a `step_runs` row per step and updating its status as it completes. When it encounters a step with `step_type = 'approval_gate'`, it sets that `step_runs` row to `status: 'paused'`, sets the parent `workflow_runs.status` to `'paused'`, and **returns immediately** — the loop does not continue past this point, and no later steps get `step_runs` rows created yet.

Resuming is a separate Action, `approveStep`, called with the paused step's `step_run_id`. After the role check described above, it marks that step's `step_runs` row `succeeded` (recording `approved_by`/`approved_at`), sets the parent run back to `running`, and calls `resumeWorkflowSteps` — a variant of the main execution loop that looks up the approved step's position in `workflow_steps` and continues from the *next* step onward, carrying forward the last known output as input. This means a workflow can have multiple approval gates in sequence, each pausing and resuming independently, without re-running any already-completed step.

Because every status change (`running` → `succeeded`/`failed`/`paused`) is written to `step_runs`/`workflow_runs` as it happens, the required GraphQL subscription — filtered by `workflow_run_id` — reflects every stage of this process live, including the `paused, awaiting approval` state, without the frontend polling or refreshing.

## Cross-Org Isolation (verified)

Tested directly: a `viewer` in Org B, given Org A's real `workflow_id` (not guessed — the exact UUID), receives `null` from a direct `workflows_by_pk` query, and receives an explicit `403 Not authorized` from `triggerWorkflowRun` when attempting to trigger it. The `null` result comes from Hasura's row permission (Layer 1); the `403` comes from the Action handler's own independent role check (Layer 2) — meaning even if a future Layer 1 permission had a bug, the Action handler is a second, independent line of defense against cross-org access.
