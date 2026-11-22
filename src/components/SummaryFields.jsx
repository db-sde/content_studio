import { useMemo } from 'react';
import { RefreshCw, Loader2, Globe } from 'lucide-react';
import { RichText, TextInput } from './FieldTypes';
import { SEO_TARGETS, lengthTone, countBullets, cleanSummaryHtml } from '../config/summaryPages';

// The fields of a blog / category draft (see config/summaryPages.js), as the normal draft editor
// shows them: the summary with a rendered preview and a 4-5 bullet hint, the SEO title and meta
// description with live length counters and a search-result preview, and reading time.

export function RegenerateButton({ onClick, busy, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`Regenerate ${label}`}
      className="inline-flex items-center gap-1 text-[11px] font-bold text-navy hover:text-orange disabled:text-muted disabled:cursor-wait normal-case tracking-normal rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-navy/20"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="w-3 h-3" />}
      {busy ? 'Regenerating…' : 'Regenerate'}
    </button>
  );
}

// Only the tags a summary uses survive in the preview; everything else is reduced to its text.
const PREVIEW_TAGS = new Set(['UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'BR', 'P', 'A']);
function safePreviewHtml(html) {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 1) {
        walk(child);
        if (!PREVIEW_TAGS.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          return;
        }
        [...child.attributes].forEach(attr => {
          const keep = child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value);
          if (!keep) child.removeAttribute(attr.name);
        });
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    });
  };
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

export function SummaryField({ field, value, onChange, disabled, lockReason, error, regenerate, pasteFieldNames }) {
  const bullets = countBullets(value);
  const preview = useMemo(() => safePreviewHtml(cleanSummaryHtml(value)), [value]);
  const hasText = !!String(value || '').replace(/<[^>]+>/g, '').trim();
  return (
    <div className="space-y-3">
      <RichText
        label={field.label}
        fieldKey={field.key}
        pasteFieldNames={pasteFieldNames}
        placeholder={field.placeholder}
        required={field.required}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
        labelSuffix={lockReason || (regenerate && <RegenerateButton label={field.label} {...regenerate} />)}
      />
      {hasText && (bullets < 4 || bullets > 5) && (
        <p className="text-xs font-medium text-orange" role="status">
          {bullets === 0 ? 'This isn\'t a bullet list yet - use the list button so it shows as bullet points.' : `${bullets} bullet point${bullets === 1 ? '' : 's'} - aim for 4 or 5 short ones.`}
        </p>
      )}
      <div className="rounded-xl border border-border bg-off/60 px-5 py-4" aria-label="Summary preview">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Preview - top of the page</p>
        {preview
          ? <div className="summary-preview text-sm text-navy leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1.5 [&_strong]:font-semibold [&_a]:text-orange [&_a]:underline" dangerouslySetInnerHTML={{ __html: preview }} />
          : <p className="text-sm text-muted">The summary's bullet points will show here.</p>}
      </div>
    </div>
  );
}

const TONE_STYLE = { ok: 'text-green-success', short: 'text-orange', over: 'text-danger', empty: 'text-muted' };

function lengthNote(fieldKey, text) {
  const { min, max } = SEO_TARGETS[fieldKey];
  const length = String(text || '').length;
  const tone = lengthTone(fieldKey, text);
  if (tone === 'empty') return `Aim for ${min}-${max} characters.`;
  if (tone === 'over') return `${length - max} over - search results cut it off after about ${max}.`;
  if (tone === 'short') return `${min - length} more to reach ${min}.`;
  return 'Good length.';
}

export function SeoField({ field, value, onChange, disabled, lockReason, error, regenerate, multiline }) {
  const id = `seo-field-${field.key}`;
  const noteId = `${id}-length`;
  const { min, max } = SEO_TARGETS[field.key];
  const length = String(value || '').length;
  const tone = lengthTone(field.key, value);
  const inputClass = `w-full px-4 py-2.5 rounded-lg border bg-white text-navy placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy transition-all duration-200 text-sm disabled:bg-off disabled:text-muted disabled:cursor-not-allowed ${
    error ? 'border-danger ring-2 ring-danger/10' : tone === 'over' ? 'border-danger/50' : 'border-border hover:border-border-strong'
  }`;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5 gap-2">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-navy flex items-center">
          {field.label}
          {field.required && <span className="text-orange ml-1 text-sm font-bold">*</span>}
        </label>
        <span className="text-xs text-muted font-medium">{lockReason || (regenerate && <RegenerateButton label={field.label} {...regenerate} />)}</span>
      </div>
      {multiline
        ? <textarea id={id} rows={field.rows || 3} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={field.placeholder} aria-describedby={noteId} className={`${inputClass} resize-y`} />
        : <input id={id} type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={field.placeholder} aria-describedby={noteId} className={inputClass} />}
      <div id={noteId} className="mt-1 flex justify-between gap-3 text-xs font-medium" aria-live="polite">
        <span className={TONE_STYLE[tone]}>{lengthNote(field.key, value)}</span>
        <span className={`${TONE_STYLE[tone]} tabular-nums shrink-0`}>{length} / {min}-{max}</span>
      </div>
      {error && <p className="mt-1 text-xs text-danger font-medium">{error}</p>}
    </div>
  );
}

const slugOf = (text) => String(text || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Roughly how Google shows the page: site and path, the title (cut where Google would cut it) and the
// description.
export function SerpPreview({ pageType, title, description }) {
  const path = pageType === 'blog' ? 'blog' : 'category';
  const t = String(title || '').trim();
  const d = String(description || '').trim();
  return (
    <div className="rounded-xl border border-border bg-white px-5 py-4" aria-label="Search result preview">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-3">Search result preview</p>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-full bg-navy-soft flex items-center justify-center shrink-0"><Globe className="w-3.5 h-3.5 text-navy" /></span>
        <div className="min-w-0">
          <p className="text-xs text-navy leading-tight">DegreeBaba</p>
          <p className="text-[11px] text-muted leading-tight truncate">degreebaba.com › {path}{t ? ` › ${slugOf(t)}` : ''}</p>
        </div>
      </div>
      <p className={`text-lg leading-snug ${t ? 'text-info' : 'text-muted'} break-words`}>{t ? cut(t, 60) : 'SEO title'}</p>
      <p className={`text-sm leading-relaxed mt-0.5 break-words ${d ? 'text-navy/80' : 'text-muted'}`}>{d ? cut(d, 160) : 'The meta description shows here.'}</p>
    </div>
  );
}

export function ReadingTimeField({ field, value, onChange, disabled, lockReason, error }) {
  return (
    <div>
      <TextInput label={field.label} fieldKey={field.key} placeholder={field.placeholder} required={field.required} value={value} onChange={onChange}
        error={error} disabled={disabled} labelSuffix={lockReason || 'Calculated from word count'} />
      <p className="mt-1 text-xs text-muted">200 words a minute, from the uploaded document. Change it if the page has changed.</p>
    </div>
  );
}
