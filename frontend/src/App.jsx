import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import MonitoringDashboard from './components/MonitoringDashboard';
import heroImg from './assets/hero.png';
import reactLogo from './assets/react.svg';
import viteLogo from './assets/vite.svg';
import './App.css';

function HomeView() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', textAlign: 'center' }}>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1 style={{ fontSize: '2rem', margin: '1rem 0' }}>Multi-Tenant Saga Orchestrator</h1>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
            Distributed transaction coordinator with real-time telemetry, Prometheus exposition, and WebSocket streaming.
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((c) => c + 1)}
        >
          Workflow triggers executed: {count}
        </button>
      </section>

      <section style={{
        marginTop: '2rem',
        padding: '1.5rem',
        background: '#1e293b',
        borderRadius: '8px',
        border: '1px solid #334155',
        textAlign: 'left'
      }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: '#f8fafc' }}>
          Observability &amp; Engine Overview
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.6' }}>
          This application integrates real-time saga telemetry, multi-tenant isolation, Prometheus exposition,
          and a live operational dashboard. Use the navigation bar above to view the <strong>Live Monitoring</strong> view
          or access the standalone monitoring dashboard served directly by the monitoring microservice.
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <NavLink
            to="/monitoring"
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
              color: '#ffffff',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.875rem'
            }}
          >
            Open Live Monitoring &rarr;
          </NavLink>
          <a
            href="http://localhost:4000/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.5rem 1rem',
              background: '#334155',
              color: '#f8fafc',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '0.875rem'
            }}
          >
            Standalone Service Dashboard (:4000) &nearr;
          </a>
        </div>
      </section>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
        <nav
          style={{
            background: '#1e293b',
            borderBottom: '1px solid #334155',
            padding: '0.75rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
                display: 'inline-block',
              }}
            />
            <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
              Saga Orchestrator
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.9rem' }}>
            <NavLink
              to="/"
              style={({ isActive }) => ({
                color: isActive ? '#60a5fa' : '#94a3b8',
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 400,
                borderBottom: isActive ? '2px solid #60a5fa' : 'none',
                paddingBottom: '4px',
              })}
            >
              Workflow Console
            </NavLink>
            <NavLink
              to="/monitoring"
              style={({ isActive }) => ({
                color: isActive ? '#60a5fa' : '#94a3b8',
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 400,
                borderBottom: isActive ? '2px solid #60a5fa' : 'none',
                paddingBottom: '4px',
              })}
            >
              Live Monitoring
            </NavLink>
            <a
              href="http://localhost:4000/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#94a3b8',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              Standalone (:4000) &nearr;
            </a>
          </div>
        </nav>

        <main style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/monitoring" element={<MonitoringDashboard />} />
            <Route path="/dashboard" element={<MonitoringDashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
