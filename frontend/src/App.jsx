
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import axios from 'axios';

import { createWorkflow, getWorkflows } from './api';
import MonitoringDashboard from './components/MonitoringDashboard';
import StatsDashboard from './components/StatsDashboard';
import WorkflowEditor from './WorkflowEditor';

import './App.css';

const SESSION_KEY = 'saga-demo-session';

const API = axios.create({
  baseURL: 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Check whether the user is logged in.
function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

// Protect pages that require login.
function ProtectedRoute({ children }) {
  const [session, setSession] = useState(getSession);

  useEffect(() => {
    const updateSession = () => setSession(getSession());

    window.addEventListener('auth-session-changed', updateSession);
    return () => {
      window.removeEventListener('auth-session-changed', updateSession);
    };
  }, []);

  return session?.token ? children : <Navigate to="/login" replace />;
}

// Registration page.
function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function handleRegister(event) {
    event.preventDefault();
    setMessage('');

    try {
      const response = await API.post('/auth/register', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });

      const data = response.data;

      if (data.success === false) {
        setMessage(data.message || 'Registration failed.');
        return;
      }

      setMessage(data.message || 'Registration successful!');
      setTimeout(() => navigate('/login'), 700);
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
        'Registration failed. Check the backend connection.'
      );
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

// Login page.
function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function handleLogin(event) {
    event.preventDefault();
    setMessage('');

    try {
      const response = await API.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      const data = response.data;

      if (!data.success || !data.token || !data.user) {
        setMessage(data.message || 'Invalid email or password.');
        return;
      }

      const sessionData = {
        name: data.user.name,
        email: data.user.email,
        token: data.token,
        tenantId: data.user.tenantId,
      };

      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      window.dispatchEvent(new Event('auth-session-changed'));
      navigate('/dashboard');
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
        'Login failed. Check your email and password.'
      );
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

// Workflow dashboard: create and fetch workflows from backend.
function WorkflowDashboard() {
  const navigate = useNavigate();

  const [workflows, setWorkflows] = useState([]);
  const [workflowName, setWorkflowName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function refreshWorkflows() {
    setLoading(true);
    setError('');

    try {
      const data = await getWorkflows();
      setWorkflows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
      setError(
        err.response?.data?.message ||
        'Unable to load workflows. Check that the backend is running.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshWorkflows();
  }, []);

  async function handleCreateWorkflow(event) {
    event.preventDefault();

    const name = workflowName.trim() || 'My Workflow';

    setCreating(true);
    setError('');

    try {
      const workflow = await createWorkflow({
        workflowName: name,
        nodes: [
          {
            id: 'task-1',
            name: 'Sample HTTP Task',
            type: 'http',
            url: 'https://example.com/api',
            method: 'GET',
          },
        ],
        edges: [],
      });

      if (!workflow?._id) {
        throw new Error('Backend did not return a workflow ID.');
      }

      setWorkflowName('');
      await refreshWorkflows();

      navigate(`/editor/${encodeURIComponent(workflow._id)}`, {
        state: { workflowName: name },
      });
    } catch (err) {
      console.error('Workflow creation failed:', err);
      setError(
        err.response?.data?.message ||
        err.message ||
        'Unable to create workflow.'
      );
    } finally {
      setCreating(false);
    }
  }

  function openWorkflow(workflow) {
    if (!workflow?._id) {
      setError('Invalid workflow ID.');
      return;
    }

    navigate(`/editor/${encodeURIComponent(workflow._id)}`, {
      state: { workflowName: workflow.workflowName },
    });
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new Event('auth-session-changed'));
    navigate('/login');
  }

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
          onClick={handleLogout}
        >
          Log Out
        </button>
      </header>

      <form className="create-workflow-card" onSubmit={handleCreateWorkflow}>
        <h2>Create a Workflow</h2>

        <label htmlFor="workflow-name">Workflow name</label>
        <input
          id="workflow-name"
          value={workflowName}
          onChange={(event) => setWorkflowName(event.target.value)}
          placeholder="Example: Order Processing"
        />

        <button
          type="submit"
          className="primary-button"
          disabled={creating}
        >
          {creating ? 'Creating...' : '+ Create Workflow'}
        </button>
      </form>

      <div className="saved-heading">
        <h2>Saved Workflows</h2>

        <button
          type="button"
          className="refresh-button"
          onClick={refreshWorkflows}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh list'}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <div className="empty-state">
          <p>Loading workflows...</p>
        </div>
      ) : workflows.length === 0 ? (
        <div className="empty-state">
          <h3>No saved workflows yet</h3>
          <p>Create a workflow to get started.</p>
        </div>
      ) : (
        <div className="workflow-cards">
          {workflows.map((workflow) => (
            <article className="saved-workflow-card" key={workflow._id}>
              <h3>{workflow.workflowName}</h3>
              <p>
                Nodes: {workflow.nodes?.length || 0}
                {' · '}
                Connections: {workflow.edges?.length || 0}
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => openWorkflow(workflow)}
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

// Loads the selected workflow route into the editor.
function WorkflowEditorPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <WorkflowEditor
      workflowId={id}
      workflowName={location.state?.workflowName || 'Workflow'}
      onBack={() => navigate('/dashboard')}
    />
  );
}

// Main application and routes.
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            getSession()
              ? <Navigate to="/dashboard" replace />
              : <Navigate to="/login" replace />
          }
        />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <WorkflowDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/editor/:id"
          element={
            <ProtectedRoute>
              <WorkflowEditorPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/monitoring"
          element={
            <ProtectedRoute>
              <MonitoringDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stats"
          element={
            <ProtectedRoute>
              <StatsDashboard />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
