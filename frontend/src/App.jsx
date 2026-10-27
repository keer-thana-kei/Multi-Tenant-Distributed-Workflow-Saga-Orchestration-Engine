
import React, { useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  Link,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router-dom';

import MonitoringDashboard from './components/MonitoringDashboard';
import WorkflowEditor from './WorkflowEditor';
import heroImg from './assets/hero.png';
import reactLogo from './assets/react.svg';
import viteLogo from './assets/vite.svg';
import './App.css';

const USERS_KEY = 'saga-demo-users';
const SESSION_KEY = 'saga-demo-session';
const WORKFLOWS_KEY = 'flowforge-workflows';

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function getSavedWorkflows() {
  try {
    return JSON.parse(localStorage.getItem(WORKFLOWS_KEY) || '{}');
  } catch {
    return {};
  }
}

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  function handleRegister(event) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const users = getUsers();

    if (users.some((user) => user.email === normalizedEmail)) {
      setMessage('An account with this email already exists.');
      return;
    }

    users.push({
      name: name.trim(),
      email: normalizedEmail,
      password,
    });

    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
      setMessage('Registration successful! Redirecting to login...');
      setTimeout(() => navigate('/login'), 700);
    } catch {
      setMessage('Unable to register. Browser storage may be unavailable.');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleRegister}>
        <h1>Create Account</h1>
        <p className="muted-text">Register to access the workflow console.</p>

        <label htmlFor="register-name">Full name</label>
        <input
          id="register-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="name"
          placeholder="Enter your full name"
        />

        <label htmlFor="register-email">Email address</label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          placeholder="Enter your email"
        />

        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="At least 6 characters"
        />

        {message && <p className="form-message" role="status">{message}</p>}

        <button type="submit" className="primary-button">
          Register
        </button>

        <p className="auth-footer">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  function handleLogin(event) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const user = getUsers().find(
      (item) =>
        item.email === normalizedEmail &&
        item.password === password
    );

    if (!user) {
      setMessage('Invalid email or password. Register first if you do not have an account.');
      return;
    }

    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ name: user.name, email: user.email })
      );
      navigate('/dashboard');
    } catch {
      setMessage('Unable to log in. Browser storage may be unavailable.');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleLogin}>
        <h1>Welcome Back</h1>
        <p className="muted-text">Log in to manage your workflows.</p>

        <label htmlFor="login-email">Email address</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          placeholder="Enter your email"
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoComplete="current-password"
          placeholder="Enter your password"
        />

        {message && <p className="form-error" role="alert">{message}</p>}

        <button type="submit" className="primary-button">
          Log In
        </button>

        <p className="auth-footer">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </div>
  );
}

function WorkflowDashboard() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState(getSavedWorkflows());
  const [workflowName, setWorkflowName] = useState('');

  function createWorkflow(event) {
    event.preventDefault();

    const id = `workflow-${Date.now()}`;
    const name = workflowName.trim() || 'My Workflow';

    navigate(`/editor/${encodeURIComponent(id)}`, {
      state: { workflowName: name },
    });
  }

  function refreshWorkflows() {
    setWorkflows(getSavedWorkflows());
  }

  const entries = Object.entries(workflows);

  return (
    <section className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <h1>Workflow Dashboard</h1>
          <p className="muted-text">
            Create workflows, open saved designs, and manage your canvas.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            localStorage.removeItem(SESSION_KEY);
            navigate('/login');
          }}
        >
          Log Out
        </button>
      </header>

      <form className="create-workflow-card" onSubmit={createWorkflow}>
        <h2>Create a Workflow</h2>

        <label htmlFor="workflow-name">Workflow name</label>
        <input
          id="workflow-name"
          value={workflowName}
          onChange={(event) => setWorkflowName(event.target.value)}
          placeholder="Example: Order Processing"
        />

        <button type="submit" className="primary-button">
          + Create Workflow
        </button>
      </form>

      <div className="saved-heading">
        <h2>Saved Workflows</h2>
        <button
          type="button"
          className="refresh-button"
          onClick={refreshWorkflows}
        >
          Refresh list
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <h3>No saved workflows yet</h3>
          <p>Create a workflow, add nodes, and save it in the editor.</p>
        </div>
      ) : (
        <div className="workflow-cards">
          {entries.map(([id, workflow], index) => (
            <article className="saved-workflow-card" key={id}>
              <h3>
                {workflow.workflowName ||
                  (/^workflow-\d+$/.test(id)
                    ? `Workflow ${index + 1}`
                    : `Workflow ${id}`)}
              </h3>

              <p>
                Nodes: {workflow.nodes?.length || 0}
                {' · '}
                Connections: {workflow.edges?.length || 0}
              </p>

              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  navigate(`/editor/${encodeURIComponent(id)}`, {
                    state: {
                      workflowName:
                        workflow.workflowName ||
                        (/^workflow-\d+$/.test(id)
                          ? `Workflow ${index + 1}`
                          : `Workflow ${id}`),
                    },
                  })
                }
              >
                Open Workflow
              </button>
            </article>
          ))}
        </div>
      )}

      <p className="dashboard-back-link">
        <Link to="/">Back to Workflow Console</Link>
      </p>
    </section>
  );
}

function EditorRoute() {
  const { workflowId } = useParams();
  const location = useLocation();
  const id = decodeURIComponent(workflowId || 'default-workflow');
  const saved = getSavedWorkflows()[id];

  const workflowName =
    location.state?.workflowName ||
    saved?.workflowName ||
    id;

  return (
    <WorkflowEditor
      key={id}
      workflowId={id}
      workflowName={workflowName}
      onBack={() => {
        window.history.back();
      }}
    />
  );
}

function HomeView() {
  const [count, setCount] = useState(0);

  return (
    <div className="home-view">
      <section className="home-hero">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>

        <h1>Multi-Tenant Saga Orchestrator</h1>
        <p className="muted-text">
          Distributed transaction coordinator with real-time telemetry,
          Prometheus exposition, and WebSocket streaming.
        </p>

        <button
          type="button"
          className="counter"
          onClick={() => setCount((current) => current + 1)}
        >
          Workflow triggers executed: {count}
        </button>
      </section>

      <section className="overview-card">
        <h2>Observability &amp; Engine Overview</h2>
        <p>
          This application integrates real-time saga telemetry, multi-tenant
          isolation, Prometheus exposition, and a live operational dashboard.
        </p>

        <div className="home-actions">
          <Link to="/monitoring" className="home-link">
            Open Live Monitoring →
          </Link>
          <Link to="/dashboard" className="home-link">
            Open Workflow Dashboard →
          </Link>
          <a
            href="http://localhost:4000/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="home-link secondary-link"
          >
            Standalone Service Dashboard ↗
          </a>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  });

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <nav className="app-nav">
          <Link to="/" className="app-brand">Saga Orchestrator</Link>

          <div className="nav-links">
            <NavLink to="/">Workflow Console</NavLink>
            <NavLink to="/dashboard">Workflow Dashboard</NavLink>
            <NavLink to="/monitoring">Live Monitoring</NavLink>

            {session ? (
              <button type="button" className="nav-logout" onClick={logout}>
                Log Out
              </button>
            ) : (
              <>
                <NavLink to="/login">Login</NavLink>
                <NavLink to="/register">Register</NavLink>
              </>
            )}
          </div>
        </nav>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={<WorkflowDashboard />} />
            <Route path="/editor/:workflowId" element={<EditorRoute />} />
            <Route path="/monitoring" element={<MonitoringDashboard />} />
            <Route path="/service-dashboard" element={<MonitoringDashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
