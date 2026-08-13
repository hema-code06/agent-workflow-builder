# AI Agent Workflow Builder

A mini n8n-style platform for chaining AI agent steps into workflows, built with **nhost (Postgres + Hasura + Auth)**, **GraphQL** (queries/mutations/subscriptions), and a **React (Vite)** frontend.

Users inside an organization build workflows out of multiple step types, start them multiple ways (manual click or webhook), and every action is checked against two separate layers of permissions — org/role scoping at the database level, and step-level gating enforced in a custom backend Action handler.

---

## Tech Stack

- **nhost** — Postgres + Hasura + Auth
- **Hasura GraphQL Engine** — schema, relationships, permissions, Actions
- **PostgreSQL** — data storage
- **GraphQL** — queries, mutations, subscriptions
- **Node.js / Express** — custom Action handler backend (executes workflow steps)
- **React (Vite)** + **Apollo Client** — frontend, with live subscriptions via `graphql-ws`
- **LLM API** —  `llm_call` implementation

---

## Architecture Overview

```
organizations → org_members → workflows → workflow_steps
                                        └→ workflow_triggers
workflows → workflow_runs → step_runs
```

- **Two permission layers:**
  1. **Org + role scoping** (Hasura row-level permissions): every table's permission rule traverses relationships back to `org_members` to confirm the caller belongs to that row's organization — role alone is never sufficient.
  2. **Step-level gating**: enforced partly in Hasura (`INSERT` permissions block editors from adding `db_write`/`notify`/webhook-trigger rows) and partly in the custom Action handler (approving a paused `approval_gate` step requires a live role check in `backend/index.js`, since it's a mid-execution decision, not a simple row permission).

- **Core engine** (`backend/index.js`): two Hasura Actions —
  - `triggerWorkflowRun(workflow_id)` — verifies caller's role, checks quota, creates a run, executes steps in order (with 1 retry on `llm_call`/`http_request` failures), pauses on `approval_gate`.
  - `approveStep(step_run_id)` — checks the approver's role, resumes execution from the next step.

- **Two trigger types implemented:**
  - **Manual** — Run button in the frontend, calls `triggerWorkflowRun`.
  - **Webhook** — a public POST endpoint (`/webhook-trigger/:workflow_id`) that starts a run without any user session, simulating an external system calling in.

- **Live updates:** a GraphQL subscription on `step_runs` (filtered by `workflow_run_id`) streams step-by-step status to the frontend in real time, including the `paused` state.

---

## Test Accounts (seeded for demo)

| Email | Password | Org | Role |
|---|---|---|---|
| ownerA@test.com | Test1234! | Org A | owner |
| viewerB@test.com | Test1234! | Org B | viewer |

---

## Local Setup

### Prerequisites
- Node.js 18+
- An [nhost](https://nhost.io) project (free tier)
- [ngrok](https://ngrok.com) (free tier) — to expose your local backend to Hasura Actions

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

### 3. Expose the backend with ngrok

```bash
ngrok http 4000
```

Copy the forwarding URL (e.g. `https://xxxx.ngrok-free.dev`) and set it as the **Webhook Handler** URL for both Hasura Actions (`triggerWorkflowRun` → `/trigger-workflow-run`, `approveStep` → `/approve-step`) in the Hasura Console.

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

Schema, relationships, and permissions were built directly via the Hasura Console during development. See `hasura/` folder for exported metadata (if included), or refer to the write-up (`WRITEUP.md`) for the full schema and permission reasoning.

---

## ⭐ Show Your Support

If you like this project, please give it a ⭐ on GitHub — it motivates me to keep building!

---


