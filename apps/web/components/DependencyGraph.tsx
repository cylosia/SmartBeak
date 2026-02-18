interface GraphNode {
  label: string;
}

export function DependencyGraph({ nodes }: { nodes: GraphNode[] }) {
  return (
  // P2-A11Y-FIX: Added role/aria-label so screen readers announce this as an image.
  <svg width='600' height='300' role='img' aria-label='Dependency graph'>
    {nodes.map((n, i) => (
    // P1-KEY-FIX: Use stable index as key instead of n.label. Duplicate or
    // mutated labels would collide on the label-based key, causing React to
    // silently reuse DOM nodes across different nodes in the list.
    <g key={i}>
      <circle cx={50 + i * 100} cy={150} r={20} fill='#ccc' />
      <text x={50 + i * 100} y={155} textAnchor='middle'>{n.label}</text>
    </g>
    ))}
  </svg>
  );
}
