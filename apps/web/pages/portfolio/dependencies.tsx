
import { DependencyGraph } from '../../components/DependencyGraph';
export default function Dependencies() {
  const nodes = [
  { label: 'Amazon' },
  { label: 'Impact' },
  { label: 'Content Cluster A' }
  ];
  return (
  <main>
    <h1>Dependency Graph</h1>
    <DependencyGraph nodes={nodes} />
  </main>
  );
}
