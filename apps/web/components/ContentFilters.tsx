export function ContentFilters({ onFilter }: { onFilter: (f: Record<string, string>) => void }) {
  return (
  <div role="group" aria-label="Content filters" style={{ marginBottom: 16 }}>
    <label htmlFor="filter-type" style={{ marginRight: 4 }}>Type:</label>
    <select
      id="filter-type"
      aria-label="Filter by content type"
      onChange={(e) => onFilter({ type: (e.target as HTMLSelectElement).value })}
    >
    <option value=''>All types</option>
    <option value='web'>Web</option>
    <option value='blog'>Blog</option>
    <option value='image'>Image</option>
    <option value='video'>Video</option>
    <option value='audio'>Audio</option>
    <option value='social'>Social</option>
    </select>
    <label htmlFor="filter-status" style={{ marginLeft: 16, marginRight: 4 }}>Status:</label>
    <select
      id="filter-status"
      aria-label="Filter by content status"
      style={{ marginLeft: 8 }}
      onChange={(e) => onFilter({ status: (e.target as HTMLSelectElement).value })}
    >
    <option value=''>All statuses</option>
    <option value='draft'>Draft</option>
    <option value='published'>Published</option>
    <option value='archived'>Archived</option>
    </select>
  </div>
  );
}
