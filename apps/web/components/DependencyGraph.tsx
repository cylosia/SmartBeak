interface GraphNode {
  label: string;
}

export function DependencyGraph({ nodes }: { nodes: GraphNode[] }) {
  return (
  <svg width='600' height='300'>
    {nodes.map((n, i) => (
    <g key={i}>
      <circle cx={50 + i * 100} cy={150} r={20} fill='#ccc' />
      <text x={50 + i * 100} y={155} textAnchor='middle'>{n.label}</text>
    </g>
    ))}
  </svg>
  );
}
