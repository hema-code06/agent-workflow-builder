import { useState } from 'react';
import { useAuthenticationStatus, useSignInEmailPassword, useUserId, useSignOut } from '@nhost/react';
import { useQuery, useMutation, useSubscription, gql } from '@apollo/client';
import { useAccessToken } from '@nhost/react';
import { setApolloToken } from './apollo';

const GET_WORKFLOWS = gql`
  query GetWorkflows($org_id: uuid!) {
    workflows(where: { org_id: { _eq: $org_id } }) {
      id
      name
      workflow_steps(order_by: { step_order: asc }) {
        step_type
        step_order
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
      }
    }
  }
`;

const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members {
      org_id
      role
      organization {
        id
        name
        quota_limit
        quota_used
      }
    }
  }
`;

const TRIGGER_RUN = gql`
  mutation TriggerRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      run_id
      status
    }
  }
`;

const APPROVE_STEP = gql`
  mutation Approve($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      success
      message
    }
  }
`;

const STEP_RUNS_SUB = gql`
  subscription WatchRun($run_id: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $run_id } }, order_by: { created_at: asc }) {
      id
      status
      output
      error
    }
  }
`;

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signInEmailPassword, isLoading, isError, error } = useSignInEmailPassword();

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', fontFamily: 'sans-serif' }}>
      <h2>Login</h2>
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ display: 'block', marginBottom: 10, width: '100%', padding: 8 }} />
      <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ display: 'block', marginBottom: 10, width: '100%', padding: 8 }} />
      <button onClick={() => signInEmailPassword(email, password)} disabled={isLoading} style={{ padding: 10, width: '100%' }}>
        {isLoading ? 'Logging in...' : 'Login'}
      </button>
      {isError && <p style={{ color: 'red' }}>{error?.message}</p>}
    </div>
  );
}

function RunStatus({ runId }) {
  const { data, loading } = useSubscription(STEP_RUNS_SUB, { variables: { run_id: runId } });
  const [approveStep] = useMutation(APPROVE_STEP);

  if (loading) return <p>Loading run status...</p>;

  return (
    <div style={{ marginTop: 10, padding: 10, background: '#f5f5f5' }}>
      <strong>Live Run Status:</strong>
      {data?.step_runs.map(sr => (
        <div key={sr.id} style={{ padding: 8, margin: '4px 0', background: '#fff', border: '1px solid #ddd' }}>
          <span style={{
            fontWeight: 'bold',
            color: sr.status === 'succeeded' ? 'green' : sr.status === 'failed' ? 'red' : sr.status === 'paused' ? 'orange' : 'blue'
          }}>
            {sr.status.toUpperCase()}
          </span>
          {sr.status === 'paused' && (
            <button style={{ marginLeft: 10 }} onClick={() => approveStep({ variables: { step_run_id: sr.id } })}>
              Approve
            </button>
          )}
          {sr.error && <p style={{ color: 'red' }}>{sr.error}</p>}
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const userId = useUserId();
  const { signOut } = useSignOut();
  const accessToken = useAccessToken();
  setApolloToken(accessToken);
  const { data: orgsData, loading: orgsLoading, error: orgsError } = useQuery(GET_MY_ORGS);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);

  const myOrgs = orgsData?.org_members || [];
  const currentOrg = myOrgs.find(m => m.org_id === selectedOrgId);

  const { data: workflowsData, loading: wfLoading, refetch } = useQuery(GET_WORKFLOWS, {
    variables: { org_id: selectedOrgId },
    skip: !selectedOrgId,
  });

  const [triggerRun] = useMutation(TRIGGER_RUN);

  const handleRun = async (workflowId) => {
    const res = await triggerRun({ variables: { workflow_id: workflowId } });
    setActiveRunId(res.data.triggerWorkflowRun.run_id);
    refetch();
  };

  if (orgsLoading) return <p>Loading orgs...</p>;

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2>Workflow Builder</h2>
        <button onClick={signOut}>Sign Out</button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <strong>Select Organization:</strong>
        {myOrgs.map(m => (
          <button
            key={m.org_id}
            onClick={() => setSelectedOrgId(m.org_id)}
            style={{ marginLeft: 8, fontWeight: selectedOrgId === m.org_id ? 'bold' : 'normal' }}
          >
            {m.organization.name} ({m.role})
          </button>
        ))}
      </div>

      {currentOrg && (
        <p>Quota: {currentOrg.organization.quota_used} / {currentOrg.organization.quota_limit}</p>
      )}

      {wfLoading && <p>Loading workflows...</p>}

      {workflowsData?.workflows.map(wf => (
        <div key={wf.id} style={{ border: '1px solid #ccc', padding: 15, marginBottom: 15 }}>
          <h3>{wf.name}</h3>
          <p>Steps: {wf.workflow_steps.map(s => s.step_type).join(' → ')}</p>
          <p>Last run: {wf.workflow_runs[0]?.status || 'never run'}</p>

          {currentOrg?.role !== 'viewer' && (
            <button onClick={() => handleRun(wf.id)}>Run Workflow</button>
          )}

          {activeRunId && <RunStatus runId={activeRunId} />}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { isLoading, isAuthenticated } = useAuthenticationStatus();

  if (isLoading) return <p>Loading...</p>;
  if (!isAuthenticated) return <LoginScreen />;

  return <Dashboard />;
}