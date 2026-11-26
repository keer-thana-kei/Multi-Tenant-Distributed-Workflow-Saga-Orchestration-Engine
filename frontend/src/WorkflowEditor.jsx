
import React, { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';
import './WorkflowEditor.css';
import NodePalette from './components/NodePalette';

import {
  getWorkflow,
  updateWorkflow,
  runWorkflow,
  getExecution,
} from './api';

// Initial visual workflow
const initialNodes = [
  {
    id: '1',
    type: 'input',
    position: { x: 100, y: 100 },
    data: { label: 'Start Workflow' },
  },
  {
    id: '2',
    type: 'default',
    position: { x: 350, y: 100 },
    data: {
      label: 'Execute Task',
      name: 'Execute Task',
      executionType: 'http',
      url: '',
      method: 'POST',
      code: '',
      compensateUrl: '',
      compensateMethod: 'POST',
    },
  },
];

const initialEdges = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    animated: true,
  },
];

// Convert backend workflow into React Flow format
function backendToCanvas(workflow) {
  const backendNodes = Array.isArray(workflow.nodes)
    ? workflow.nodes
    : [];

  const backendEdges = Array.isArray(workflow.edges)
    ? workflow.edges
    : [];

  if (backendNodes.length === 0) {
    return {
      nodes: initialNodes,
      edges: initialEdges,
    };
  }

  const taskNodes = backendNodes.map((node, index) => ({
    id: String(node.id),
    type: 'default',
    position: node.position || {
      x: 300 + (index % 3) * 250,
      y: 100 + Math.floor(index / 3) * 180,
    },
    data: {
      label: node.name || 'Execute Task',
      name: node.name || 'Execute Task',
      executionType: node.type || 'http',
      url: node.url || '',
      method: node.method || 'POST',
      code: node.code || '',
      compensateUrl: node.compensateUrl || '',
      compensateMethod: node.compensateMethod || 'POST',
    },
  }));

  const taskEdges = backendEdges.map((edge, index) => ({
    id: `backend-edge-${index}-${edge.from}-${edge.to}`,
    source: String(edge.from),
    target: String(edge.to),
    animated: true,
    data: edge.condition
      ? { condition: edge.condition }
      : {},
  }));

  const connectedTargets = new Set(
    taskEdges.map((edge) => edge.target)
  );

  const connectedSources = new Set(
    taskEdges.map((edge) => edge.source)
  );

  const rootNodes = taskNodes.filter(
    (node) => !connectedTargets.has(node.id)
  );

  const leafNodes = taskNodes.filter(
    (node) => !connectedSources.has(node.id)
  );

  const startNode = {
    id: 'visual-start',
    type: 'input',
    position: { x: 80, y: 100 },
    data: { label: 'Start Workflow' },
  };

  const endNode = {
    id: 'visual-end',
    type: 'output',
    position: { x: 750, y: 100 },
    data: { label: 'End Workflow' },
  };

  const visualEdges = [
    ...rootNodes.map((node) => ({
      id: `visual-start-${node.id}`,
      source: 'visual-start',
      target: node.id,
      animated: true,
    })),
    ...leafNodes.map((node) => ({
      id: `visual-${node.id}-end`,
      source: node.id,
      target: 'visual-end',
      animated: true,
    })),
  ];

  return {
    nodes: [startNode, ...taskNodes, endNode],
    edges: [...visualEdges, ...taskEdges],
  };
}

// Convert React Flow graph into backend graph format
function canvasToBackend(nodes, edges) {
  const executableNodes = nodes.filter(
    (node) => node.type === 'default'
  );

  const executableIds = new Set(
    executableNodes.map((node) => String(node.id))
  );

  const backendNodes = executableNodes.map((node) => {
    const data = node.data || {};

    return {
      id: String(node.id),
      name: data.name || data.label || 'Execute Task',
      type: data.executionType || 'http',
      url: data.url || '',
      method: data.method || 'POST',
      code: data.code || '',
      compensateUrl: data.compensateUrl || '',
      compensateMethod: data.compensateMethod || 'POST',
      position: node.position,
    };
  });

  const backendEdges = edges
    .filter(
      (edge) =>
        executableIds.has(String(edge.source)) &&
        executableIds.has(String(edge.target))
    )
    .map((edge) => ({
      from: String(edge.source),
      to: String(edge.target),
      ...(edge.data?.condition
        ? { condition: edge.data.condition }
        : {}),
    }));

  return {
    nodes: backendNodes,
    edges: backendEdges,
  };
}

// Condition node
function ConditionNode({ data }) {
  return (
    <div className="condition-node">
      <Handle type="target" position={Position.Left} />
      <div>{data.label || 'Condition'}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const customNodeTypes = {
  condition: ConditionNode,
};

// Form field
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}) {
  return (
    <label style={fieldStyle}>
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder || ''}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

// Select field
function SelectField({ label, value, onChange, options }) {
  return (
    <label style={fieldStyle}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  marginBottom: '14px',
  fontSize: '14px',
  fontWeight: 600,
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 10px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '14px',
  background: '#fff',
};

// Properties panel
function PropertiesPanel({
  selectedNode,
  selectedEdge,
  updateNodeData,
  updateEdgeCondition,
  updateNodeLabel,
}) {
  if (!selectedNode && !selectedEdge) {
    return (
      <aside style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Properties</h3>
        <p>Select a node or connection on the canvas to edit its properties.</p>
      </aside>
    );
  }

  if (selectedNode) {
    const { data = {}, type } = selectedNode;
    const isExecutable = type === 'default';

    return (
      <aside style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Node Properties</h3>
        <p style={mutedStyle}>Node ID: {selectedNode.id}</p>

        <Field
          label="Display Label"
          value={data.label || ''}
          onChange={(value) => updateNodeLabel(selectedNode.id, value)}
          placeholder="Enter node label"
        />

        {isExecutable && (
          <>
            <Field
              label="Node Name"
              value={data.name || data.label || ''}
              onChange={(value) =>
                updateNodeData(selectedNode.id, 'name', value)
              }
              placeholder="Enter execution name"
            />

            <SelectField
              label="Execution Type"
              value={data.executionType || 'http'}
              onChange={(value) =>
                updateNodeData(selectedNode.id, 'executionType', value)
              }
              options={[
                { value: 'http', label: 'HTTP Request' },
                { value: 'script', label: 'JavaScript Script' },
              ]}
            />

            {(!data.executionType || data.executionType === 'http') && (
              <>
                <Field
                  label="Request URL"
                  value={data.url || ''}
                  onChange={(value) =>
                    updateNodeData(selectedNode.id, 'url', value)
                  }
                  placeholder="https://example.com/api"
                />

                <SelectField
                  label="HTTP Method"
                  value={data.method || 'POST'}
                  onChange={(value) =>
                    updateNodeData(selectedNode.id, 'method', value)
                  }
                  options={[
                    { value: 'GET', label: 'GET' },
                    { value: 'POST', label: 'POST' },
                    { value: 'PUT', label: 'PUT' },
                    { value: 'PATCH', label: 'PATCH' },
                    { value: 'DELETE', label: 'DELETE' },
                  ]}
                />
              </>
            )}

            {data.executionType === 'script' && (
              <label style={fieldStyle}>
                <span>JavaScript Code</span>
                <textarea
                  value={data.code || ''}
                  onChange={(event) =>
                    updateNodeData(
                      selectedNode.id,
                      'code',
                      event.target.value
                    )
                  }
                  placeholder={'// Example:\nreturn { message: "Task completed" };'}
                  rows={10}
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    fontFamily: 'monospace',
                  }}
                />
              </label>
            )}

            <Field
              label="Compensation URL (optional)"
              value={data.compensateUrl || ''}
              onChange={(value) =>
                updateNodeData(
                  selectedNode.id,
                  'compensateUrl',
                  value
                )
              }
              placeholder="https://example.com/undo"
            />

            <SelectField
              label="Compensation Method"
              value={data.compensateMethod || 'POST'}
              onChange={(value) =>
                updateNodeData(
                  selectedNode.id,
                  'compensateMethod',
                  value
                )
              }
              options={[
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'DELETE', label: 'DELETE' },
              ]}
            />
          </>
        )}

        {type !== 'default' && (
          <p style={mutedStyle}>
            This is a visual control node. It is not sent to the backend as an executable step.
          </p>
        )}
      </aside>
    );
  }

  const condition = selectedEdge.data?.condition || {};
  const hasCondition = Boolean(selectedEdge.data?.condition);

  return (
    <aside style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Connection Properties</h3>

      <p style={mutedStyle}>
        Connection: {selectedEdge.source} → {selectedEdge.target}
      </p>

      <label
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <input
          type="checkbox"
          checked={hasCondition}
          onChange={(event) =>
            updateEdgeCondition(
              selectedEdge.id,
              event.target.checked
                ? { field: '', op: 'equals', value: '' }
                : null
            )
          }
        />
        Enable execution condition
      </label>

      {hasCondition && (
        <>
          <Field
            label="Output Field"
            value={condition.field || ''}
            onChange={(value) =>
              updateEdgeCondition(selectedEdge.id, {
                ...condition,
                field: value,
              })
            }
            placeholder="e.g. status"
          />

          <SelectField
            label="Operator"
            value={condition.op || 'equals'}
            onChange={(value) =>
              updateEdgeCondition(selectedEdge.id, {
                ...condition,
                op: value,
              })
            }
            options={[
              { value: 'equals', label: 'Equals' },
              { value: 'notEquals', label: 'Not Equals' },
              { value: 'gt', label: 'Greater Than' },
              { value: 'lt', label: 'Less Than' },
            ]}
          />

          <Field
            label="Expected Value"
            value={condition.value ?? ''}
            onChange={(value) =>
              updateEdgeCondition(selectedEdge.id, {
                ...condition,
                value,
              })
            }
            placeholder="e.g. success"
          />

          <p style={mutedStyle}>
            The condition is checked against the output of the source node.
          </p>
        </>
      )}
    </aside>
  );
}

const panelStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '18px',
  marginTop: '16px',
  width: '100%',
  boxSizing: 'border-box',
  color: '#17172b',
};

const mutedStyle = {
  color: '#6b7280',
  fontSize: '13px',
  fontWeight: 400,
  lineHeight: 1.5,
};

// Workflow canvas
function WorkflowCanvas({
  nodes,
  edges,
  setNodes,
  onNodesChange,
  onEdgesChange,
  onConnect,
  setSaveMessage,
  setSelection,
}) {
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const nodeKind = event.dataTransfer.getData(
        'application/reactflow'
      );

      if (!nodeKind) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: `node-${Date.now()}`,
        type:
          nodeKind === 'start'
            ? 'input'
            : nodeKind === 'end'
              ? 'output'
              : nodeKind === 'condition'
                ? 'condition'
                : 'default',
        position,
        data: {
          label:
            nodeKind === 'start'
              ? 'Start Workflow'
              : nodeKind === 'task'
                ? 'Execute Task'
                : nodeKind === 'condition'
                  ? 'Check Condition'
                  : 'End Workflow',
          ...(nodeKind === 'task'
            ? {
                name: 'Execute Task',
                executionType: 'http',
                url: '',
                method: 'POST',
                code: '',
                compensateUrl: '',
                compensateMethod: 'POST',
              }
            : {}),
        },
      };

      setNodes((currentNodes) => [...currentNodes, newNode]);
      setSelection({ type: 'node', id: newNode.id });
      setSaveMessage('');
    },
    [screenToFlowPosition, setNodes, setSaveMessage, setSelection]
  );

  return (
    <div className="workflow-editor-layout">
      <NodePalette />

      <div
        className="workflow-canvas"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={customNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) =>
            setSelection({ type: 'node', id: node.id })
          }
          onEdgeClick={(_, edge) =>
            setSelection({ type: 'edge', id: edge.id })
          }
          onPaneClick={() => setSelection(null)}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}

// Main workflow editor
function WorkflowEditorContent({
  onBack,
  workflowId,
  workflowName: initialWorkflowName,
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const [currentWorkflowName, setCurrentWorkflowName] = useState(
    initialWorkflowName || 'My Workflow'
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const [saveMessage, setSaveMessage] = useState('');
  const [runMessage, setRunMessage] = useState('');
  const [execution, setExecution] = useState(null);

  const [selection, setSelection] = useState(null);

  // Load workflow from backend
  useEffect(() => {
    let cancelled = false;

    async function loadWorkflow() {
      try {
        setLoading(true);
        setSaveMessage('');

        const response = await getWorkflow(workflowId);

        const workflow =
          response?.workflow ||
          response?.data?.workflow ||
          response?.data ||
          response;

        if (!workflow || !Array.isArray(workflow.nodes)) {
          throw new Error('Invalid workflow data received from backend.');
        }

        const canvas = backendToCanvas(workflow);

        if (cancelled) return;

        setNodes(canvas.nodes);
        setEdges(canvas.edges);

        setCurrentWorkflowName(
          workflow.workflowName ||
          initialWorkflowName ||
          'My Workflow'
        );
      } catch (error) {
        if (cancelled) return;

        console.error('Failed to load workflow:', error);

        setSaveMessage(
          error.response?.data?.message ||
          error.message ||
          'Unable to load workflow from backend.'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadWorkflow();

    return () => {
      cancelled = true;
    };
  }, [workflowId, initialWorkflowName, setNodes, setEdges]);

  const selectedNode =
    selection?.type === 'node'
      ? nodes.find((node) => node.id === selection.id)
      : null;

  const selectedEdge =
    selection?.type === 'edge'
      ? edges.find((edge) => edge.id === selection.id)
      : null;

  const onConnect = useCallback(
    (connection) => {
      setEdges((currentEdges) =>
        addEdge(
          { ...connection, animated: true },
          currentEdges
        )
      );

      setSaveMessage('');
    },
    [setEdges]
  );

  function updateNodeData(nodeId, key, value) {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: { ...node.data, [key]: value },
            }
          : node
      )
    );

    setSaveMessage('');
  }

  function updateNodeLabel(nodeId, value) {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                label: value,
                ...(node.type === 'default'
                  ? { name: value }
                  : {}),
              },
            }
          : node
      )
    );

    setSaveMessage('');
  }

  function updateEdgeCondition(edgeId, condition) {
    setEdges((currentEdges) =>
      currentEdges.map((edge) => {
        if (edge.id !== edgeId) return edge;

        const updatedData = { ...(edge.data || {}) };

        if (condition) {
          updatedData.condition = condition;
        } else {
          delete updatedData.condition;
        }

        return { ...edge, data: updatedData };
      })
    );

    setSaveMessage('');
  }

  function addTaskNode() {
    const newNode = {
      id: `task-${Date.now()}`,
      type: 'default',
      position: {
        x: 300 + Math.random() * 250,
        y: 200 + Math.random() * 150,
      },
      data: {
        label: 'New Task',
        name: 'New Task',
        executionType: 'http',
        url: '',
        method: 'POST',
        code: '',
        compensateUrl: '',
        compensateMethod: 'POST',
      },
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelection({ type: 'node', id: newNode.id });
    setSaveMessage('');
  }

  // Save workflow to backend
  async function handleSave() {
    try {
      setSaving(true);
      setSaveMessage('');

      const graph = canvasToBackend(nodes, edges);

      if (graph.nodes.length === 0) {
        setSaveMessage(
          'Add at least one executable task before saving.'
        );
        return false;
      }

      const response = await updateWorkflow(workflowId, {
        workflowName: currentWorkflowName,
        nodes: graph.nodes,
        edges: graph.edges,
      });

      const updatedWorkflow =
        response?.workflow ||
        response?.data?.workflow ||
        response?.data ||
        response;

      if (updatedWorkflow?.workflowName) {
        setCurrentWorkflowName(updatedWorkflow.workflowName);
      }

      setSaveMessage('Workflow saved successfully to the backend!');
      return true;
    } catch (error) {
      console.error('Failed to save workflow:', error);

      setSaveMessage(
        error.response?.data?.message ||
        'Unable to save workflow. Check the backend and try again.'
      );

      return false;
    } finally {
      setSaving(false);
    }
  }

  // Save latest graph and execute workflow
  async function handleRunWorkflow() {
    try {
      setRunning(true);
      setRunMessage('');
      setExecution(null);

      // Save the latest editor changes first.
      setRunMessage('Saving workflow before execution...');

      const graph = canvasToBackend(nodes, edges);

      if (graph.nodes.length === 0) {
        throw new Error('Add at least one executable task before running.');
      }

      await updateWorkflow(workflowId, {
        workflowName: currentWorkflowName,
        nodes: graph.nodes,
        edges: graph.edges,
      });

      setRunMessage('Starting workflow execution...');

      // Start backend execution
      const startResponse = await runWorkflow(workflowId);

      const executionId =
        startResponse?.executionId ||
        startResponse?.execution?._id ||
        startResponse?.data?.executionId;

      if (!executionId) {
        throw new Error('Backend did not return an execution ID.');
      }

      setRunMessage(`Workflow started. Execution ID: ${executionId}`);

      // Poll backend for execution results
      let latestExecution = null;
      let finished = false;

      for (let attempt = 0; attempt < 60; attempt++) {
        const response = await getExecution(executionId);

        latestExecution =
          response?.execution ||
          response?.data?.execution ||
          response?.data ||
          response;

        setExecution(latestExecution);

        const status = String(
          latestExecution?.status || ''
        ).toLowerCase();

        if (
          ['success', 'failed', 'completed', 'cancelled'].includes(status)
        ) {
          finished = true;
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, 1500)
        );
      }

      const finalStatus = String(
        latestExecution?.status || 'unknown'
      ).toLowerCase();

      if (finalStatus === 'success' || finalStatus === 'completed') {
        setRunMessage('Workflow execution completed successfully!');
      } else if (finalStatus === 'failed') {
        setRunMessage('Workflow execution failed. Check task results.');
      } else if (!finished) {
        setRunMessage(
          'Execution is still running. The latest status is displayed below.'
        );
      } else {
        setRunMessage(`Workflow execution status: ${finalStatus}`);
      }
    } catch (error) {
      console.error('Workflow execution error:', error);

      setRunMessage(
        error.response?.data?.message ||
        error.message ||
        'Unable to execute workflow.'
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="workflow-editor-page">
      <header className="editor-toolbar">
        <div>
          <button type="button" onClick={onBack}>
            ← Back to Dashboard
          </button>

          <h1>{currentWorkflowName}</h1>

          <p>
            Design your workflow by dragging nodes and connecting them.
          </p>
        </div>

        <div className="editor-actions">
          <button
            type="button"
            onClick={addTaskNode}
            disabled={loading || saving || running}
          >
            + Add Task
          </button>

          <button
            type="button"
            className="editor-save-button"
            onClick={handleSave}
            disabled={loading || saving || running}
          >
            {saving ? 'Saving...' : 'Save Workflow'}
          </button>

          <button
            type="button"
            onClick={handleRunWorkflow}
            disabled={loading || saving || running}
          >
            {running ? 'Running...' : 'Run Workflow'}
          </button>
        </div>
      </header>

      <div className="editor-summary">
        <span>Nodes: {nodes.length}</span>
        <span>Connections: {edges.length}</span>

        {loading && (
          <span role="status" className="save-message">
            Loading workflow...
          </span>
        )}

        {saveMessage && (
          <span role="status" className="save-message">
            {saveMessage}
          </span>
        )}
      </div>

      {!loading && (
        <>
          <ReactFlowProvider>
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              setNodes={setNodes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              setSaveMessage={setSaveMessage}
              setSelection={setSelection}
            />
          </ReactFlowProvider>

          <PropertiesPanel
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            updateNodeData={updateNodeData}
            updateNodeLabel={updateNodeLabel}
            updateEdgeCondition={updateEdgeCondition}
          />
        </>
      )}

      {/* Execution results */}
      {runMessage && (
        <section style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Workflow Execution</h3>

          <p role="status">{runMessage}</p>

          {execution && (
            <>
              <p>
                <strong>Execution Status:</strong>{' '}
                {execution.status || 'Unknown'}
              </p>

              <p>
                <strong>Execution ID:</strong>{' '}
                {execution._id || execution.id || 'N/A'}
              </p>

              {Array.isArray(execution.steps) && (
                <>
                  <h4>Task Results</h4>

                  {execution.steps.map((step, index) => (
                    <div
                      key={step.nodeId || index}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        padding: '12px',
                        marginBottom: '10px',
                      }}
                    >
                      <strong>
                        {step.name || step.nodeId || `Task ${index + 1}`}
                      </strong>

                      <p>
                        Status: {step.status || 'Unknown'}
                      </p>

                      <p>
                        Attempts: {step.attempts ?? 0}
                      </p>

                      {step.output !== undefined && (
                        <>
                          <strong>Output:</strong>

                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              fontSize: '12px',
                              background: '#f9fafb',
                              padding: '10px',
                              borderRadius: '5px',
                            }}
                          >
                            {typeof step.output === 'string'
                              ? step.output
                              : JSON.stringify(step.output, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}

export default function WorkflowEditor({
  onBack,
  workflowId = 'default-workflow',
  workflowName = 'My Workflow',
}) {
  return (
    <WorkflowEditorContent
      key={workflowId}
      onBack={onBack}
      workflowId={workflowId}
      workflowName={workflowName}
    />
  );
}
