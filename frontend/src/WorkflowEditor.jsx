
import { useCallback, useRef, useState } from 'react';
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
    id: 'start',
    type: 'input',
    position: { x: 100, y: 120 },
    data: { label: 'Start Workflow', nodeKind: 'start' },
  },
  {
    id: 'task1',
    type: 'default',
    position: { x: 400, y: 120 },
    data: { label: 'Execute Task', nodeKind: 'task' },
  },
];

const initialEdges = [
  {
    id: 'start-task1',
    source: 'start',
    target: 'task1',
  },
];

const nodeLabels = {
  start: 'Start Workflow',
  task: 'Execute Task',
  condition: 'Condition',
  end: 'End Workflow',
};

function loadSavedWorkflow(workflowId) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );

    return saved[workflowId] || null;
  } catch (error) {
    console.error('Workflow loading failed:', error);
    return null;
  }
}

function saveWorkflow(workflowId, nodes, edges) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );

    saved[workflowId] = {
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(saved)
    );

    return true;
  } catch (error) {
    console.error('Workflow save failed:', error);
    return false;
  }
}

function ConditionNode({ data }) {
  return (
    <div className="condition-node">
      <Handle type="target" position={Position.Left} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const customNodeTypes = {
  condition: ConditionNode,
};

function WorkflowCanvas({
  nodes,
  setNodes,
  edges,
  setEdges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  setSaveMessage,
  reactFlowWrapper,
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

      if (!nodeKind || !nodeLabels[nodeKind]) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const id = `${nodeKind}-${Date.now()}`;

      const newNode = {
        id,
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
          label: nodeLabels[nodeKind],
          nodeKind,
        },
      };

      setNodes((currentNodes) => [
        ...currentNodes,
        newNode,
      ]);

      setSaveMessage('');
    },
    [screenToFlowPosition, setNodes, setSaveMessage]
  );

  return (
    <div className="editor-workspace">
      <NodePalette />

      <div
        className="workflow-canvas"
        ref={reactFlowWrapper}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={customNodeTypes}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            setSaveMessage('');
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            setSaveMessage('');
          }}
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

export default function WorkflowEditor({
  onBack,
  workflowId = 'default-workflow',
  workflowName = 'My Workflow',
}) {
  const [initialWorkflow] = useState(
    () => loadSavedWorkflow(workflowId)
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialWorkflow?.nodes || initialNodes
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialWorkflow?.edges || initialEdges
  );

  const [nextId, setNextId] = useState(
    () => (initialWorkflow?.nodes || initialNodes).length + 1
  );

  const [saveMessage, setSaveMessage] = useState('');
  const reactFlowWrapper = useRef(null);

  const onConnect = useCallback(
    (connection) => {
      setEdges((currentEdges) =>
        addEdge(connection, currentEdges)
      );
      setSaveMessage('');
    },
    [setEdges]
  );

  const addTask = () => {
    const id = `task-${Date.now()}`;

    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id,
        type: 'default',
        position: {
          x: 150 + (currentNodes.length % 4) * 180,
          y: 280 + Math.floor(currentNodes.length / 4) * 120,
        },
        data: {
          label: `Task ${nextId}`,
          nodeKind: 'task',
        },
      },
    ]);

    setNextId((current) => current + 1);
    setSaveMessage('');
  };

  const handleSave = () => {
    const success = saveWorkflow(
      workflowId,
      nodes,
      edges
    );

    setSaveMessage(
      success
        ? 'Workflow saved successfully!'
        : 'Could not save. Check browser storage.'
    );
  };

  return (
    <main className="editor-page">
      <header className="editor-header">
        <button
          className="editor-back"
          onClick={onBack}
        >
          ← Dashboard
        </button>

        <div className="editor-heading">
          <h1>Workflow Editor</h1>
          <p>
            Editing {workflowName}. Add nodes and connect
            them to design your workflow.
          </p>
        </div>

        <div className="editor-actions">
          <button
            className="editor-save"
            onClick={handleSave}
          >
            Save Workflow
          </button>

          <button
            className="editor-add"
            onClick={addTask}
          >
            + Add Task
          </button>
        </div>
      </header>

      {saveMessage && (
        <p className="save-message" role="status">
          {saveMessage}
        </p>
      )}

      <div className="editor-toolbar">
        <span>WORKFLOW CANVAS</span>
        <span>
          {nodes.length} nodes · {edges.length} connections
        </span>
      </div>

      <ReactFlowProvider>
        <WorkflowCanvas
          nodes={nodes}
          setNodes={setNodes}
          edges={edges}
          setEdges={setEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          setSaveMessage={setSaveMessage}
          reactFlowWrapper={reactFlowWrapper}
        />
      </ReactFlowProvider>
    </main>
  );
}
