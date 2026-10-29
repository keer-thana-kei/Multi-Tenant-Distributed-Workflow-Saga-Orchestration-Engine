
import React, { useCallback, useState } from 'react';
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

const STORAGE_KEY = 'flowforge-workflows';

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
    data: { label: 'Execute Task' },
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

function loadSavedWorkflow(workflowId) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );
    return saved[workflowId] || null;
  } catch (error) {
    console.error('Failed to load workflow:', error);
    return null;
  }
}

function saveWorkflow(workflowId, nodes, edges, workflowName) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );

    saved[workflowId] = {
      workflowName: workflowName || 'My Workflow',
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch (error) {
    console.error('Failed to save workflow:', error);
    return false;
  }
}

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

function WorkflowCanvas({
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  setSaveMessage,
}) {
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const nodeKind = event.dataTransfer.getData('application/reactflow');

      if (!nodeKind) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        },
      };

      setNodes((currentNodes) => [...currentNodes, newNode]);
      setSaveMessage('');
    },
    [screenToFlowPosition, setNodes, setSaveMessage]
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

function WorkflowEditorContent({
  onBack,
  workflowId,
  workflowName,
}) {
  const savedWorkflow = loadSavedWorkflow(workflowId);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    savedWorkflow?.nodes || initialNodes
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState(
    savedWorkflow?.edges || initialEdges
  );

  const [nextId, setNextId] = useState(
    Math.max(
      3,
      ...((savedWorkflow?.nodes || initialNodes).map(
        (node) => Number(node.id) || 0
      ))
    )
  );

  const [saveMessage, setSaveMessage] = useState('');

  const onConnect = useCallback(
    (connection) => {
      setEdges((currentEdges) =>
        addEdge({ ...connection, animated: true }, currentEdges)
      );
      setSaveMessage('');
    },
    [setEdges]
  );

  function addTaskNode() {
    const newNode = {
      id: String(nextId),
      type: 'default',
      position: {
        x: 150 + Math.random() * 250,
        y: 200 + Math.random() * 150,
      },
      data: { label: 'New Task' },
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setNextId((currentId) => currentId + 1);
    setSaveMessage('');
  }

  function handleSave() {
    const success = saveWorkflow(
      workflowId,
      nodes,
      edges,
      workflowName
    );

    setSaveMessage(
      success
        ? 'Workflow saved successfully!'
        : 'Unable to save. Check browser storage and try again.'
    );
  }

  return (
    <section className="workflow-editor-page">
      <header className="editor-toolbar">
        <div>
          <button type="button" onClick={onBack}>
            ← Back to Dashboard
          </button>
          <h1>{workflowName || 'My Workflow'}</h1>
          <p>Design your workflow by dragging nodes and connecting them.</p>
        </div>

        <div className="editor-actions">
          <button type="button" onClick={addTaskNode}>
            + Add Task
          </button>
          <button
            type="button"
            className="editor-save-button"
            onClick={handleSave}
          >
            Save Workflow
          </button>
        </div>
      </header>

      <div className="editor-summary">
        <span>Nodes: {nodes.length}</span>
        <span>Connections: {edges.length}</span>
        {saveMessage && (
          <span role="status" className="save-message">
            {saveMessage}
          </span>
        )}
      </div>

      <ReactFlowProvider>
        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          setNodes={setNodes}
          setEdges={setEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          setSaveMessage={setSaveMessage}
        />
      </ReactFlowProvider>
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
