import { useMemo, useState } from 'react';
import { X, Lock, RotateCcw, Search, Plus, Pencil, Archive } from 'lucide-react';
import { schemas, SCHEMA_DETAILS } from '../config/schemas';
import {
  resolveFieldSetting, defaultSettingOf, defaultInternFillable, isLockedField, canBeAiGenerated, SETTING_KEYS,
  withCustomFields, humanizeFieldKey
} from '../config/fieldSettings';
import * as api from '../services/fieldSettingsClient';
import { FieldTags } from '../components/FieldTags';
import { wordpressTagOf } from '../utils/wordpressTag';

// Admin only. Per page type and field: shown or hidden, mandatory or not, AI-generated or filled by
// hand, and who fills it in - plus adding fields for WordPress fields nothing fills yet, and removing
// (archiving) those. Every change saves at once and applies to every draft of that page type, old and
// new (see config/fieldSettings.js). `settings`: { overrides, customFields } as GET
// /api/field-settings returns them; `onSettingsChange` hands App.jsx the new ones (it rebuilds the
// forms from them); `wordpress`: GET /api/field-settings/wordpress, refreshed by `onWordpressRefresh`.
const TEXT_TYPE_LABELS = { TEXT_INPUT: 'Single line', TEXTAREA: 'Paragraph', RICH_TEXT: 'Formatted text (headings, lists, links)' };
const STATUS_WORDS = { intern_editing: 'with interns', senior_review: 'in Senior review', admin_review: 'waiting for Admin approval', approved: 'approved (only if reopened)' };

const inputClass = 'w-full text-xs text-navy border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-navy/15 disabled:opacity-50';
const smallButton = 'inline-flex items-center gap-1 text-[11px] font-semibold disabled:opacity-40';

function Toggle({ checked, onChange, disabled, label, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title || label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-navy/20 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-navy' : 'bg-border-strong'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function SettingCell({ label, children }) {
  return (
    <div className="flex flex-col items-center gap-1 w-20 shrink-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

const formatWhen = (ts) => {
  const d = new Date(ts);
  return !Number.isNaN(d.getTime()) ? d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

// Shared by every async action on the page: a busy flag and the error to show.
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message || 'Could not save');
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

// "12 drafts don't have this filled: 4 with interns, 8 in Senior review."
function missingSummary(missingByStatus) {
  const parts = Object.entries(STATUS_WORDS).filter(([s]) => missingByStatus[s]).map(([s, words]) => `${missingByStatus[s]} ${words}`);
  const total = Object.values(missingByStatus).reduce((a, b) => a + b, 0);
  if (!total) return '';
  return total === 1
    ? `1 draft doesn't have this filled (${parts.join(', ')}). It'll need it before it can move on.`
    : `${total} drafts don't have this filled: ${parts.join(', ')}. They'll need it before they can move on.`;
}

// Placement picker: a section, and the field it follows there.
function PlacementFields({ pageSchema, sectionId, afterFieldKey, ownKey, onChange, disabled }) {
  const section = pageSchema.sections.find(s => s.id === sectionId);
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Section</span>
        <select className={inputClass} value={sectionId} disabled={disabled} onChange={(e) => onChange({ sectionId: e.target.value, afterFieldKey: '' })}>
          {pageSchema.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Place it</span>
        <select className={inputClass} value={afterFieldKey} disabled={disabled} onChange={(e) => onChange({ sectionId, afterFieldKey: e.target.value })}>
          <option value="">At the end of the section</option>
          {(section?.fields || []).filter(f => f.key !== ownKey).map(f => <option key={f.key} value={f.key}>After "{f.label}"</option>)}
        </select>
      </label>
    </>
  );
}

function AddFieldForm({ pageType, pageSchema, available, onSettingsChange, onAdded, onCancel }) {
  const { busy, error, run } = useAction();
  const [wpKey, setWpKey] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('TEXT_INPUT');
  const [placement, setPlacement] = useState({ sectionId: pageSchema.sections[0]?.id || '', afterFieldKey: '' });
  const [required, setRequired] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);
  const target = available.addable.find(a => a.key === wpKey);
  const isList = target?.kind === 'list';

  const choose = (key) => {
    setWpKey(key);
    setLabel(key ? humanizeFieldKey(key) : '');
    if (available.addable.find(a => a.key === key)?.kind === 'list') setAiGenerated(false);
  };

  const submit = () => run(async () => {
    const result = await api.addCustomField(pageType, {
      fieldKey: wpKey,
      label,
      type: isList ? 'REPEATER' : type,
      sectionId: placement.sectionId,
      afterFieldKey: placement.afterFieldKey || null,
      settings: { ...(required ? { required: true } : {}), ...(aiGenerated ? { aiGenerated: true } : {}) }
    });
    onSettingsChange(result);
    onAdded();
  });

  return (
    <div className="border-2 border-navy/15 rounded-xl p-4 bg-navy-soft/40 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-extrabold text-navy uppercase tracking-wide">Add a field</h4>
        <button type="button" onClick={onCancel} className={`${smallButton} text-muted hover:text-navy`}>Cancel</button>
      </div>
      {available.addable.length === 0 ? (
        <p className="text-xs text-muted">Every WordPress field on this page that the app can fill is already filled by a field here.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">WordPress field it fills</span>
            <select className={inputClass} value={wpKey} disabled={busy} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose a WordPress field nothing fills yet…</option>
              <optgroup label="Text">
                {available.addable.filter(a => a.kind === 'text').map(a => <option key={a.key} value={a.key}>{a.key}</option>)}
              </optgroup>
              {available.addable.some(a => a.kind === 'list') && (
                <optgroup label="Lists">
                  {available.addable.filter(a => a.kind === 'list').map(a => <option key={a.key} value={a.key}>{a.key} ({a.columns.join(', ')})</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {wpKey && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Name shown on the form</span>
                <input className={inputClass} value={label} maxLength={80} disabled={busy} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Kind of field</span>
                {isList ? (
                  <span className="text-xs text-navy py-1.5">A list with the columns {target.columns.map(humanizeFieldKey).join(', ')}</span>
                ) : (
                  <select className={inputClass} value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
                    {Object.entries(TEXT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
              </label>
              <PlacementFields pageSchema={pageSchema} {...placement} onChange={setPlacement} disabled={busy} />
              <div className="flex items-center gap-6 md:col-span-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-navy">
                  <Toggle label="Mandatory" checked={required} disabled={busy} onChange={setRequired} /> Mandatory
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-navy" title={isList ? 'The AI can only write text fields' : undefined}>
                  <Toggle label="AI writes it" checked={aiGenerated} disabled={busy || isList} onChange={setAiGenerated} /> AI writes it
                </label>
              </div>
            </>
          )}
        </div>
      )}
      {available.unsupported.length > 0 && (
        <p className="text-[11px] text-muted">
          Needs a developer: {available.unsupported.map(u => `${u.key} (${u.reason})`).join(', ')}.
        </p>
      )}
      <p className="text-[11px] text-muted">
        It appears on every draft of this page type straight away, empty. It's only sent to WordPress when it has something in it,
        so publishing never blanks out what someone typed into WordPress directly.
      </p>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!wpKey || !label.trim() || busy}
          onClick={submit}
          className="px-3 py-1.5 rounded-md bg-navy text-white text-xs font-bold disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add field'}
        </button>
      </div>
    </div>
  );
}

function EditCustomField({ pageType, pageSchema, customField, onSettingsChange, onDone }) {
  const { busy, error, run } = useAction();
  const [label, setLabel] = useState(customField.label);
  const [type, setType] = useState(customField.type);
  const [placement, setPlacement] = useState({ sectionId: customField.sectionId, afterFieldKey: customField.afterFieldKey || '' });
  const save = () => run(async () => {
    const changes = { label, sectionId: placement.sectionId, afterFieldKey: placement.afterFieldKey || null };
    if (customField.type !== 'REPEATER') changes.type = type;
    onSettingsChange(await api.editCustomField(pageType, customField.fieldKey, changes));
    onDone();
  });
  return (
    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 border border-border rounded-lg p-3 bg-off/60">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Name shown on the form</span>
        <input className={inputClass} value={label} maxLength={80} disabled={busy} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Kind of field</span>
        {customField.type === 'REPEATER' ? (
          <span className="text-xs text-navy py-1.5">A list (its columns come from WordPress)</span>
        ) : (
          <select className={inputClass} value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TEXT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
      </label>
      <PlacementFields pageSchema={pageSchema} {...placement} ownKey={customField.fieldKey} onChange={setPlacement} disabled={busy} />
      {error && <p className="text-[11px] text-danger md:col-span-2">{error}</p>}
      <div className="flex justify-end gap-3 md:col-span-2">
        <button type="button" onClick={onDone} className={`${smallButton} text-muted hover:text-navy`}>Cancel</button>
        <button type="button" disabled={busy || !label.trim()} onClick={save} className="px-3 py-1.5 rounded-md bg-navy text-white text-xs font-bold disabled:opacity-40">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function FieldRow({ pageType, pageSchema, field, customField, override, target, checkedLive, onSettingsChange, onWordpressRefresh }) {
  const locked = isLockedField(pageType, field.key);
  const setting = resolveFieldSetting(pageType, field, override);
  // "Who fills it" defaults to following the AI setting (see defaultInternFillable).
  const defaults = { ...defaultSettingOf(field), internFillable: defaultInternFillable(field, setting.aiGenerated) };
  const changed = !locked && SETTING_KEYS.some(k => setting[k] !== defaults[k] && !(k === 'aiInstructions' && !setting.aiGenerated));
  const { busy, error, run } = useAction();
  const [draftInstructions, setDraftInstructions] = useState(null);
  const [pendingRequired, setPendingRequired] = useState(null); // the "these drafts aren't filled" warning
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const instructions = draftInstructions ?? setting.aiInstructions;
  const aiPossible = canBeAiGenerated(field);

  const saveChanges = async (changes) => onSettingsChange(await api.updateFieldSetting(pageType, field.key, changes));
  // A value equal to the field's default is stored as "default", so the row reads as unchanged.
  const save = (key, value) => run(() => saveChanges({ [key]: value === defaults[key] ? null : value }));
  const toggleRequired = (value) => run(async () => {
    if (!value) return saveChanges({ required: value === defaults.required ? null : value });
    const { missingByStatus } = await api.getFieldImpact(pageType, field.key);
    const warning = missingSummary(missingByStatus);
    if (warning) setPendingRequired(warning);
    else await saveChanges({ required: defaults.required ? null : true });
  });
  const saveInstructions = () => {
    if (draftInstructions === null) return;
    const text = draftInstructions.trim();
    setDraftInstructions(null);
    if (text === (setting.aiInstructions || '').trim()) return;
    run(() => saveChanges({ aiInstructions: text && text !== defaults.aiInstructions ? text : null }));
  };
  const remove = () => run(async () => {
    onSettingsChange(await api.archiveCustomField(pageType, field.key));
    onWordpressRefresh();
  });

  return (
    <div className={`px-4 py-3 border-b border-border last:border-b-0 ${setting.visible ? '' : 'bg-off/70'}`}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold ${setting.visible ? 'text-navy' : 'text-muted line-through'}`}>{field.label}</span>
            <code className="text-[10px] text-muted">{field.key}</code>
            {customField && <span className="text-[10px] font-bold text-purple-review bg-purple-review-soft rounded px-1.5 py-0.5 uppercase tracking-wide">Added</span>}
            {locked && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted" title="Every page needs this field to work, so it can't be turned off">
                <Lock className="w-3 h-3" /> Always on
              </span>
            )}
            {changed && <span className="text-[10px] font-bold text-orange uppercase tracking-wide">Changed</span>}
          </div>
          <FieldTags className="mt-1.5" target={target} checkedLive={checkedLive} aiGenerated={setting.aiGenerated} />
          {changed && override?.updatedByName && (
            <p className="text-[10px] text-muted mt-1">Last changed by {override.updatedByName}{override.updatedAt ? `, ${formatWhen(override.updatedAt)}` : ''}</p>
          )}
          {customField && (
            <p className="text-[10px] text-muted mt-1">Added{customField.createdByName ? ` by ${customField.createdByName}` : ''}{customField.createdAt ? `, ${formatWhen(customField.createdAt)}` : ''}</p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <SettingCell label="Visible">
            <Toggle label={`Show "${field.label}"`} checked={setting.visible} disabled={locked || busy} onChange={(v) => save('visible', v)} />
          </SettingCell>
          <SettingCell label="Mandatory">
            <Toggle
              label={`"${field.label}" is mandatory`}
              title={!setting.visible ? 'A hidden field is never mandatory' : undefined}
              checked={setting.required}
              disabled={locked || busy || !setting.visible || !!pendingRequired}
              onChange={toggleRequired}
            />
          </SettingCell>
          <SettingCell label="AI writes it">
            <Toggle
              label={`"${field.label}" is AI-generated`}
              title={!aiPossible ? 'Lists and dropdowns can\'t be AI-generated - only text fields' : undefined}
              checked={setting.aiGenerated}
              disabled={locked || busy || !aiPossible || !setting.visible}
              onChange={(v) => save('aiGenerated', v)}
            />
          </SettingCell>
          <div className="flex flex-col gap-1 w-44 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Who fills it</span>
            <select
              aria-label={`Who fills "${field.label}"`}
              value={setting.internFillable ? 'intern' : 'senior'}
              disabled={locked || busy || !setting.visible}
              onChange={(e) => save('internFillable', e.target.value === 'intern')}
              className="text-xs font-semibold text-navy border border-border rounded-md px-2 py-1 bg-white disabled:opacity-40"
            >
              <option value="intern">{setting.aiGenerated ? 'Intern can edit' : 'Intern (and above)'}</option>
              <option value="senior">Senior &amp; Admin only</option>
            </select>
          </div>
          <div className="w-24 shrink-0 flex flex-col items-end gap-1">
            {changed && (
              <button type="button" disabled={busy} onClick={() => run(async () => onSettingsChange(await api.resetFieldSetting(pageType, field.key)))} className={`${smallButton} text-muted hover:text-navy`} title="Back to this field's default settings">
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
            {customField && !editing && (
              <button type="button" disabled={busy} onClick={() => setEditing(true)} className={`${smallButton} text-muted hover:text-navy`}>
                <Pencil className="w-3 h-3" /> Edit
              </button>
            )}
            {customField && (
              <button type="button" disabled={busy} onClick={() => setConfirmRemove(true)} className={`${smallButton} text-danger hover:text-danger-hover`}>
                <Archive className="w-3 h-3" /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {pendingRequired && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-orange/30 bg-orange-soft px-3 py-2">
          <p className="text-[11px] text-navy flex-1">{pendingRequired}</p>
          <button type="button" onClick={() => setPendingRequired(null)} className={`${smallButton} text-muted hover:text-navy`}>Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => { await saveChanges({ required: defaults.required ? null : true }); setPendingRequired(null); })}
            className="px-2.5 py-1 rounded-md bg-navy text-white text-[11px] font-bold disabled:opacity-40"
          >
            Make mandatory
          </button>
        </div>
      )}

      {confirmRemove && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
          <p className="text-[11px] text-navy flex-1">
            Remove "{field.label}"? It leaves every form and stops being sent to WordPress. What's typed in it is kept, and you can restore it below.
          </p>
          <button type="button" onClick={() => setConfirmRemove(false)} className={`${smallButton} text-muted hover:text-navy`}>Cancel</button>
          <button type="button" disabled={busy} onClick={remove} className="px-2.5 py-1 rounded-md bg-danger text-white text-[11px] font-bold disabled:opacity-40">
            Remove
          </button>
        </div>
      )}

      {editing && customField && (
        <EditCustomField pageType={pageType} pageSchema={pageSchema} customField={customField} onSettingsChange={onSettingsChange} onDone={() => setEditing(false)} />
      )}

      {setting.aiGenerated && setting.visible && !locked && (
        <div className="mt-2">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-muted mb-1" htmlFor={`ai-instructions-${pageType}-${field.key}`}>
            What the AI should write (saved when you click away)
          </label>
          <textarea
            id={`ai-instructions-${pageType}-${field.key}`}
            rows={2}
            value={instructions}
            disabled={busy}
            onChange={(e) => setDraftInstructions(e.target.value)}
            onBlur={saveInstructions}
            className={inputClass}
          />
        </div>
      )}
      {error && <p className="text-[11px] text-danger mt-1.5">{error}</p>}
    </div>
  );
}

function ArchivedFields({ pageType, archived, onSettingsChange, onWordpressRefresh }) {
  const { busy, error, run } = useAction();
  if (!archived.length) return null;
  return (
    <div className="border border-dashed border-border-strong rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-off border-b border-border text-xs font-extrabold text-muted uppercase tracking-wide">Removed fields</div>
      {archived.map(cf => (
        <div key={cf.fieldKey} className="px-4 py-2.5 flex items-center gap-3 border-b border-border last:border-b-0">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-bold text-muted">{cf.label}</span> <code className="text-[10px] text-muted">{cf.fieldKey}</code>
            <p className="text-[10px] text-muted">Not on any form and not sent to WordPress. What drafts hold in it is kept.</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => { onSettingsChange(await api.restoreCustomField(pageType, cf.fieldKey)); onWordpressRefresh(); })}
            className="px-2.5 py-1 rounded-md border border-border text-[11px] font-bold text-navy hover:bg-off disabled:opacity-40"
          >
            Restore
          </button>
        </div>
      ))}
      {error && <p className="text-[11px] text-danger px-4 py-2">{error}</p>}
    </div>
  );
}

export function FieldSettingsPanel({ settings, onSettingsChange, wordpress, onWordpressRefresh, onClose }) {
  const pageTypes = Object.keys(schemas);
  const [pageType, setPageType] = useState(pageTypes[0]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const overrides = useMemo(() => settings?.overrides || [], [settings]);
  const customFields = useMemo(() => settings?.customFields || [], [settings]);
  const byKey = useMemo(() => new Map(overrides.map(o => [`${o.pageType}:${o.fieldKey}`, o])), [overrides]);
  const pageSchemas = useMemo(() => withCustomFields(customFields), [customFields]);
  const pageSchema = pageSchemas[pageType];
  const customByKey = new Map(customFields.filter(c => c.pageType === pageType && !c.archivedAt).map(c => [c.fieldKey, c]));
  const archived = customFields.filter(c => c.pageType === pageType && c.archivedAt);
  const targets = wordpress?.targets?.[pageType] || {};
  const checkedLive = !!wordpress?.checkedLive?.[pageType];
  const available = wordpress?.available?.[pageType] || null;

  const allFields = pageSchema.sections.flatMap(s => s.fields);
  const summary = allFields.reduce((acc, field) => {
    const s = resolveFieldSetting(pageType, field, byKey.get(`${pageType}:${field.key}`));
    if (s.visible) acc.shown++;
    if (s.required) acc.required++;
    if (s.aiGenerated && s.visible) acc.ai++;
    if (wordpressTagOf(targets[field.key], checkedLive)?.tone === 'warn') acc.missing++;
    return acc;
  }, { shown: 0, required: 0, ai: 0, missing: 0 });

  const q = query.trim().toLowerCase();
  const sections = pageSchema.sections
    .map(section => ({ ...section, fields: section.fields.filter(f => !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)) }))
    .filter(section => section.fields.length);

  const switchPage = (type) => {
    setPageType(type);
    setAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl max-w-6xl w-full h-[90vh] flex flex-col shadow-2xl border border-border">
        <div className="flex justify-between items-start gap-4 px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-extrabold text-navy uppercase tracking-wide">Field Settings</h3>
            <p className="text-xs text-muted mt-1 max-w-3xl">
              Changes save at once and apply to every draft of this page type, old and new. A hidden field leaves the form
              but keeps sending what was already saved in it to WordPress.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close Field Settings" className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex gap-1.5 flex-wrap">
            {pageTypes.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => switchPage(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${pageType === type ? 'bg-navy text-white' : 'bg-off text-muted hover:text-navy'}`}
              >
                {SCHEMA_DETAILS[type]?.title || type}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a field"
              aria-label="Find a field"
              className="text-xs border border-border rounded-md pl-7 pr-2.5 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <button
            type="button"
            disabled={!available || adding}
            title={!available ? 'WordPress didn\'t answer, so its field list isn\'t available right now' : undefined}
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-navy text-white text-xs font-bold disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add field
          </button>
          <p className="text-[11px] text-muted ml-auto">
            {summary.shown} of {allFields.length} shown · {summary.required} mandatory · {summary.ai} AI-generated
            {summary.missing > 0 && <span className="text-orange font-semibold"> · {summary.missing} missing on WordPress</span>}
            {!checkedLive && ' · WordPress not checked'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto styled-scrollbar px-6 py-4 space-y-4">
          {adding && available && (
            <AddFieldForm
              key={pageType}
              pageType={pageType}
              pageSchema={pageSchema}
              available={available}
              onSettingsChange={onSettingsChange}
              onAdded={() => { setAdding(false); onWordpressRefresh(); }}
              onCancel={() => setAdding(false)}
            />
          )}
          {sections.length === 0 && <p className="text-xs text-muted text-center py-8">No field matches "{query}".</p>}
          {sections.map(section => (
            <div key={section.id} className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-off border-b border-border text-xs font-extrabold text-navy uppercase tracking-wide">{section.title}</div>
              {section.fields.map(field => (
                <FieldRow
                  key={`${pageType}:${field.key}`}
                  pageType={pageType}
                  pageSchema={pageSchema}
                  field={field}
                  customField={customByKey.get(field.key)}
                  override={byKey.get(`${pageType}:${field.key}`)}
                  target={targets[field.key]}
                  checkedLive={checkedLive}
                  onSettingsChange={onSettingsChange}
                  onWordpressRefresh={onWordpressRefresh}
                />
              ))}
            </div>
          ))}
          <ArchivedFields pageType={pageType} archived={archived} onSettingsChange={onSettingsChange} onWordpressRefresh={onWordpressRefresh} />
        </div>
      </div>
    </div>
  );
}
