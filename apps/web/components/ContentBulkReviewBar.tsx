export function ContentBulkReviewBar({ selected }: { selected: string[] }) {
  if (selected.length === 0) return null;
  return (
  <div style={{ padding: 12, background: '#222', marginBottom: 12 }}>
    <strong>{selected.length} selected</strong>
    <button style={{ marginLeft: 8 }}>Request Review</button>
    <button style={{ marginLeft: 8 }}>Add Tag</button>
    <button style={{ marginLeft: 8 }}>Add Note</button>
  </div>
  );
}
