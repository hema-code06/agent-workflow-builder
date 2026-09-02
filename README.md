# AI Agent Workflow Builder

A mini n8n-style platform for chaining AI agent steps into workflows, built with **nhost (Postgres + Hasura + Auth)**, **GraphQL** (queries/mutations/subscriptions), and a **React (Vite)** frontend.

Users inside an organization build workflows out of multiple step types, start them multiple ways (manual click or webhook), and every action is checked against two separate layers of permissions — org/role scoping at the database level, and step-level gating enforced in a custom backend Action handler.

---

### Test Accounts

| Email | Password | Org | Role |
|---|---|---|---|
| ownerA@test.com | Test1234! | Org A | owner |
| viewerB@test.com | Test1234! | Org B | viewer |

---

## Tech Stack

- **nhost** — Postgres + Hasura + Auth
- **Hasura GraphQL Engine** — schema, relationships, permissions, Actions
- **PostgreSQL** — data storage
- **GraphQL** — queries, mutations, subscriptions
- **Node.js / Express** — custom Action handler backend (executes workflow steps), deployed on **Render**
- **React (Vite) + Apollo Client** — frontend, with live subscriptions via `graphql-ws`, deployed on **Vercel**
- **LLM API** — `llm_call` implementation

---

## Architecture Overview

```
organizations → org_members → workflows → workflow_steps
                                        └→ workflow_triggers
workflows → workflow_runs → step_runs
```

### Two permission layers

1. **Org + role scoping** (Hasura row-level permissions): every table's permission rule traverses relationships back to org_members to confirm the caller belongs to that row's organization — role alone is never sufficient.
2. **Step-level gating**: partly in Hasura (`INSERT` permissions block editors from adding `db_write`/`notify` steps or `webhook` triggers — owner only), and partly in the Action handler (approving a paused `approval_gate` re-checks the approver's `org_members.role` in `backend/index.js`, since it's a mid-execution decision, not a simple row permission).

### Core engine (`backend/index.js`) — two Hasura Actions

- **`triggerWorkflowRun(workflow_id)`** — verifies the caller is owner/editor in the workflow's org, checks quota, creates a `workflow_run`, then executes steps in order with one retry on `llm_call`/`http_request` failure, pausing on `approval_gate`.
- **`approveStep(step_run_id)`** — independently checks the approver's role, marks the paused step succeeded, and resumes execution from the next step. Multiple approval gates in the same workflow pause and resume correctly in sequence.

### Step types implemented

`llm_call` (stubbed), `http_request`, `db_write`, `notify`, `conditional_branch`, `approval_gate` — all six from the spec.

### Trigger types implemented

- **Manual** — the Run button in the frontend, calling `triggerWorkflowRun`.
- **Webhook** — a public POST endpoint (`/webhook-trigger/:workflow_id`) that starts a run with no user session, using the org's owner as the acting identity. This satisfies the "at least one trigger beyond manual" requirement.

### Live updates

A GraphQL subscription on `step_runs` (filtered by `workflow_run_id`) streams step-by-step status to the frontend in real time, including the `paused` state — no polling or refresh.

---

## Local Setup (to run your own copy)

### Prerequisites
- Node.js 18+
- An [nhost](https://nhost.io) project (free tier)
- (Optional, for local dev only) [ngrok](https://ngrok.com) — to expose a locally-running backend to Hasura Actions instead of using the deployed Render backend

### 1. Clone the repo

```bash
git clone <REPO_URL>
cd agent-workflow-builder
```

### 2. Backend setup

```bash
cd backend
npm install
```

Create `backend/.env`:
```
HASURA_GRAPHQL_ENDPOINT=https://<your-subdomain>.hasura.<your-region>.nhost.run/v1/graphql
HASURA_ADMIN_SECRET=<your nhost admin secret>
LLM_API_KEY=<optional — only needed if you swap in a real LLM provider>
PORT=4000
```

Run the backend:
```bash
node index.js
```

### 3. Point Hasura Actions at your backend

**For local development:** expose your local backend with ngrok:
```bash
ngrok http 4000
```
Copy the forwarding URL (e.g. `https://xxxx.ngrok-free.dev`) and set it as the **Webhook Handler** URL for both Hasura Actions (`triggerWorkflowRun` → `/trigger-workflow-run`, `approveStep` → `/approve-step`) in the Hasura Console.

**For production (as deployed here):** the backend is deployed permanently on [Render]. The Hasura Actions point directly at the Render URL — no tunnel needed, and it works independent of any local machine being on.

### 4. Frontend setup

```bash
cd ../frontend
npm install
```

Update `frontend/src/nhost.js` and `frontend/src/apollo.js` with your own nhost subdomain/region.

```bash
npm run dev
```

Open `http://localhost:5173`.

### 5. Hasura schema + permissions

Schema, relationships, and permissions were built via the Hasura Console during development and are exported under `hasura/`. To apply them to your own project:

`config.yaml` is gitignored on purpose — the admin secret should never be committed to version control. Pass it as an environment variable or a CLI flag instead.

See `WRITEUP.md` for the full schema and permission reasoning.

---

## Security

- The Hasura Action handler holds the project's **admin secret** as a server-side environment variable (`HASURA_ADMIN_SECRET` in `backend/.env` / Render's dashboard) — it is never sent to the frontend and never appears in client-side code.
- `hasura/config.yaml` (the local Hasura CLI config, which can carry an admin secret) is gitignored; `hasura/config.yaml.example` is the safe, secret-free template committed to the repo.
- All schema-level authorization runs through Hasura row permissions scoped to the caller's `org_members` row; the Action handler adds an independent second check rather than trusting the database layer alone (see **Two permission layers** above).

---

*Built with ❤️ using React · Vite · Node.js · Express · Hasura GraphQL · PostgreSQL · nhost*



