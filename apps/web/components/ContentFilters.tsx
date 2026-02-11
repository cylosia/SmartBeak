export function ContentFilters({ onFilter }: { onFilter: (f: any) => void }) {
  return (
  <div style={{ marginBottom: 16 }}>
    <select onChange={(e) => onFilter({ type: (e.target as HTMLSelectElement).value })}>
    <option value=''>All types</option>
    <option value='web'>Web</option>
    <option value='blog'>Blog</option>
    <option value='image'>Image</option>
    <option value='video'>Video</option>
    <option value='audio'>Audio</option>
    <option value='social'>Social</option>
    </select>
    <select style={{ marginLeft: 8 }} onChange={(e) => onFilter({ status: (e.target as HTMLSelectElement).value })}>
    <option value=''>All statuses</option>
    <option value='draft'>Draft</option>
    <option value='published'>Published</option>
    <option value='archived'>Archived</option>
    </select>
  </div>
  );
}
