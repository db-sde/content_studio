// A Saved Drafts column heading with its filter dropdown underneath. `options` come from
// utils/draftColumnFilters.js's columnOptions ({ key, label, group, count }); options with a `group`
// ("When", "Edited by") are shown under that heading in the list.
export function ColumnFilter({ label, allLabel, value, options, onChange }) {
  const active = !!value && value !== 'all';
  const ungrouped = options.filter(o => !o.group);
  const groups = [...new Set(options.filter(o => o.group).map(o => o.group))];
  const renderOption = (o) => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>;

  return (
    <div className="flex flex-col gap-1.5 min-w-[7.5rem]">
      <span>{label}</span>
      <select
        value={active ? value : 'all'}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter by ${label}`}
        title={`Filter by ${label}`}
        className={`w-full normal-case tracking-normal text-[11px] font-semibold rounded-md border px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-navy/15 transition-colors ${
          active ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-border hover:border-border-strong'
        }`}
      >
        <option value="all">{allLabel}</option>
        {ungrouped.map(renderOption)}
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {options.filter(o => o.group === g).map(renderOption)}
          </optgroup>
        ))}
        {/* The chosen option no longer matches anything under the other filters - keep it selectable/visible. */}
        {active && !options.some(o => o.key === value) && <option value={value}>Current choice (0)</option>}
      </select>
    </div>
  );
}
