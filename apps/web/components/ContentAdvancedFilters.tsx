export function ContentAdvancedFilters({ onFilter }: { onFilter: (f: Record<string, string>) => void }) {
  return (
  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
    <select onChange={(e) => onFilter({ author: (e.target as HTMLSelectElement).value })}>
    <option value=''>All authors</option>
    <option value='jane-smith'>Jane Smith</option>
    <option value='editorial'>Editorial Team</option>
    </select>

    <select onChange={(e) => onFilter({ persona: (e.target as HTMLSelectElement).value })}>
    <option value=''>All personas</option>
    <option value='founder'>Founder</option>
    <option value='buyer'>Buyer</option>
    </select>

    <select onChange={(e) => onFilter({ keyword: (e.target as HTMLSelectElement).value })}>
    <option value=''>All keywords</option>
    <option value='seo'>SEO</option>
    <option value='affiliate'>Affiliate</option>
    </select>

    <select onChange={(e) => onFilter({ revenue: (e.target as HTMLSelectElement).value })}>
    <option value=''>All revenue</option>
    <option value='high'>High impact</option>
    <option value='medium'>Medium</option>
    <option value='low'>Low / None</option>
    </select>
  </div>
  );
}
