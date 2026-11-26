
import axios from 'axios';

const SESSION_KEY = 'saga-demo-session';

const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach login token to every backend request.
api.interceptors.request.use((config) => {
  const session = JSON.parse(
    localStorage.getItem(SESSION_KEY) || 'null'
  );

  if (session?.token) {
    config.headers.Authorization = `Bearer ${session.token}`;
  }

  return config;
});

// Create a workflow.
export const createWorkflow = async (workflowData) => {
  const response = await api.post('/workflows', workflowData);
  return response.data;
};

// Get all workflows.
export const getWorkflows = async () => {
  const response = await api.get('/workflows');
  return response.data;
};

// Get one workflow by ID.
export const getWorkflow = async (workflowId) => {
  const response = await api.get(`/workflows/${workflowId}`);
  return response.data;
};

// Update and save a workflow.
export const updateWorkflow = async (workflowId, workflowData) => {
  const response = await api.put(
    `/workflows/${workflowId}`,
    workflowData
  );
  return response.data;
};

// Validate workflow graph.
export const validateWorkflow = async (nodes, edges) => {
  const response = await api.post('/workflows/validate', {
    nodes,
    edges,
  });
  return response.data;
};

// Run workflow using the backend engine.
export const runWorkflow = async (workflowId) => {
  const response = await api.post(`/workflows/${workflowId}/run`);
  return response.data;
};

// Get execution details.
export const getExecution = async (executionId) => {
  const response = await api.get(
    `/workflows/executions/${executionId}`
  );
  return response.data;
};

// Delete a workflow.
export const deleteWorkflow = async (workflowId) => {
  const response = await api.delete(`/workflows/${workflowId}`);
  return response.data;
};

export default api;
