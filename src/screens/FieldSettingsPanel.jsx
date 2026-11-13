import { useMemo, useState } from 'react';
import { X, Lock, RotateCcw, Search } from 'lucide-react';
import { schemas, SCHEMA_DETAILS } from '../config/schemas';
import { resolveFieldSetting, defaultSettingOf, defaultInternFillable, isLockedField, canBeAiGenerated, SETTING_KEYS } from '../config/fieldSettings';
import { updateFieldSetting, resetFieldSetting } from '../services/fieldSettingsClient';
import { FieldTags } from '../components/FieldTags';
import { wordpressTagOf } from '../utils/wordpressTag';

// Admin only. Per page type and field: shown or hidden, mandatory or not, AI-generated or filled by
// hand, and who fills it in. Every change saves at once and applies to every draft of that page type,
// old and new (see config/fieldSettings.js). `overrides` / `onOverridesChange`: the settings as
// GET /api/field-settings returns them - App.jsx rebuilds the forms from them.
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
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

function FieldRow({ pageType, field, override, target, checkedLive, onSave, onReset }) {
  const locked = isLockedField(pageType, field.key);
  const setting = resolveFieldSetting(pageType, field, override);
  // "Who fills it" defaults to following the AI setting (see defaultInternFillable).
  const defaults = { ...defaultSettingOf(field), internFillable: defaultInternFillable(field, setting.aiGenerated) };
  const changed = !locked && SETTING_KEYS.some(k => setting[k] !== defaults[k] && !(k === 'aiInstructions' && !setting.aiGenerated));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draftInstructions, setDraftInstructions] = useState(null);
  const instructions = draftInstructions ?? setting.aiInstructions;
  const aiPossible = canBeAiGenerated(field);

  const run = async (fn) => {
    setSaving(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };
  // A value equal to the field's default is stored as "default", so the row reads as unchanged.
  const save = (key, value) => run(() => onSave(field.key, { [key]: value === defaults[key] ? null : value }));
  const saveInstructions = () => {
    if (draftInstructions === null) return;
    const text = draftInstructions.trim();
    setDraftInstructions(null);
    if (text === (setting.aiInstructions || '').trim()) return;
    run(() => onSave(field.key, { aiInstructions: text && text !== defaults.aiInstructions ? text : null }));
  };

  return (
    <div className={`px-4 py-3 border-b border-border last:border-b-0 ${setting.visible ? '' : 'bg-off/70'}`}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold ${setting.visible ? 'text-navy' : 'text-muted line-through'}`}>{field.label}</span>
            <code className="text-[10px] text-muted">{field.key}</code>
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
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <SettingCell label="Visible">
            <Toggle label={`Show "${field.label}"`} checked={setting.visible} disabled={locked || saving} onChange={(v) => save('visible', v)} />
          </SettingCell>
          <SettingCell label="Mandatory">
            <Toggle
              label={`"${field.label}" is mandatory`}
              title={!setting.visible ? 'A hidden field is never mandatory' : undefined}
              checked={setting.required}
              disabled={locked || saving || !setting.visible}
              onChange={(v) => save('required', v)}
            />
          </SettingCell>
          <SettingCell label="AI writes it">
            <Toggle
              label={`"${field.label}" is AI-generated`}
              title={!aiPossible ? 'Lists and dropdowns can\'t be AI-generated - only text fields' : undefined}
              checked={setting.aiGenerated}
              disabled={locked || saving || !aiPossible || !setting.visible}
              onChange={(v) => save('aiGenerated', v)}
            />
          </SettingCell>
          <div className="flex flex-col gap-1 w-44 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Who fills it</span>
            <select
              aria-label={`Who fills "${field.label}"`}
              value={setting.internFillable ? 'intern' : 'senior'}
              disabled={locked || saving || !setting.visible}
              onChange={(e) => save('internFillable', e.target.value === 'intern')}
              className="text-xs font-semibold text-navy border border-border rounded-md px-2 py-1 bg-white disabled:opacity-40"
            >
              <option value="intern">{setting.aiGenerated ? 'Intern can edit' : 'Intern (and above)'}</option>
              <option value="senior">Senior &amp; Admin only</option>
            </select>
          </div>
          <div className="w-20 shrink-0 flex justify-end">
            {changed && (
              <button
                type="button"
                disabled={saving}
                onClick={() => run(() => onReset(field.key))}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-navy disabled:opacity-40"
                title="Back to this field's default settings"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {setting.aiGenerated && setting.visible && !locked && (
        <div className="mt-2">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-muted mb-1" htmlFor={`ai-instructions-${pageType}-${field.key}`}>
            What the AI should write (saved when you click away)
          </label>
          <textarea
            id={`ai-instructions-${pageType}-${field.key}`}
            rows={2}
            value={instructions}
            disabled={saving}
            onChange={(e) => setDraftInstructions(e.target.value)}
            onBlur={saveInstructions}
            className="w-full text-xs text-navy border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
        </div>
      )}
      {error && <p className="text-[11px] text-danger mt-1.5">{error}</p>}
    </div>
  );
}

export function FieldSettingsPanel({ overrides, onOverridesChange, wordpress, onClose }) {
  const pageTypes = Object.keys(schemas);
  const [pageType, setPageType] = useState(pageTypes[0]);
  const [query, setQuery] = useState('');

  const byKey = useMemo(() => new Map((overrides || []).map(o => [`${o.pageType}:${o.fieldKey}`, o])), [overrides]);
  const targets = wordpress?.targets?.[pageType] || {};
  const checkedLive = !!wordpress?.checkedLive?.[pageType];

  const allFields = schemas[pageType].sections.flatMap(s => s.fields);
  const summary = allFields.reduce((acc, field) => {
    const s = resolveFieldSetting(pageType, field, byKey.get(`${pageType}:${field.key}`));
    if (s.visible) acc.shown++;
    if (s.required) acc.required++;
    if (s.aiGenerated && s.visible) acc.ai++;
    if (wordpressTagOf(targets[field.key], checkedLive)?.tone === 'warn') acc.missing++;
    return acc;
  }, { shown: 0, required: 0, ai: 0, missing: 0 });

  const q = query.trim().toLowerCase();
  const sections = schemas[pageType].sections
    .map(section => ({ ...section, fields: section.fields.filter(f => !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)) }))
    .filter(section => section.fields.length);

  const onSave = async (fieldKey, changes) => onOverridesChange((await updateFieldSetting(pageType, fieldKey, changes)).overrides);
  const onReset = async (fieldKey) => onOverridesChange((await resetFieldSetting(pageType, fieldKey)).overrides);

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
          <div className="flex gap-1.5">
            {pageTypes.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setPageType(type)}
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
          <p className="text-[11px] text-muted ml-auto">
            {summary.shown} of {allFields.length} shown · {summary.required} mandatory · {summary.ai} AI-generated
            {summary.missing > 0 && <span className="text-orange font-semibold"> · {summary.missing} missing on WordPress</span>}
            {!checkedLive && ' · WordPress not checked'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto styled-scrollbar px-6 py-4 space-y-4">
          {sections.length === 0 && <p className="text-xs text-muted text-center py-8">No field matches "{query}".</p>}
          {sections.map(section => (
            <div key={section.id} className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-off border-b border-border text-xs font-extrabold text-navy uppercase tracking-wide">{section.title}</div>
              {section.fields.map(field => (
                <FieldRow
                  key={`${pageType}:${field.key}`}
                  pageType={pageType}
                  field={field}
                  override={byKey.get(`${pageType}:${field.key}`)}
                  target={targets[field.key]}
                  checkedLive={checkedLive}
                  onSave={onSave}
                  onReset={onReset}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
