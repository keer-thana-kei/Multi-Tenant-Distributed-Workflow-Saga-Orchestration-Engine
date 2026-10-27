
const nodeTypes = [
  { type: 'start', label: 'Start', color: '#d1fae5' },
  { type: 'task', label: 'Task', color: '#dbeafe' },
  { type: 'condition', label: 'Condition', color: '#fef3c7' },
  { type: 'end', label: 'End', color: '#fee2e2' },
];

export default function NodePalette() {
  const handleDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="node-palette">
      <h3>Node Palette</h3>
      <p>Drag a node onto the canvas.</p>

      {nodeTypes.map((node) => (
        <div
          key={node.type}
          draggable
          onDragStart={(event) =>
            handleDragStart(event, node.type)
          }
          className="palette-node"
          style={{ backgroundColor: node.color }}
        >
          {node.label}
        </div>
      ))}
    </aside>
  );
}
