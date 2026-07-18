import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, List, ListOrdered, Heading2, Heading3, Link as LinkIcon,
  Trash2, Plus, X, Search, PenLine
} from 'lucide-react';
import { parseRepeaterPasteText, extractSingleFieldValue } from '../utils/pasteParsing';

// Shared by TextInput/TextArea's onPaste below — a plain single-value paste (the common "copied
// just this one cell/value" case) is let through untouched; anything that looks like a bigger,
// multi-field blob gets scoped to just this field's own matching value (or ignored entirely if
// nothing matches), so pasting a big table onto one field can never leak other fields' content
// into it. Plain helper (not a hook) despite the "make a handler" shape — no hook calls inside.
function makeScopedPasteHandler({ fieldKey, label, onChange }) {
  return (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const trimmed = text.trim();
    const looksStructured = /\r?\n/.test(trimmed) || /^[^:=\t]+[:=\t]/.test(trimmed);
    if (!looksStructured) return; // let the default single-value paste happen

    e.preventDefault();
    const matched = extractSingleFieldValue(text, { fieldKey, label });
    if (matched != null) onChange(matched);
  };
}

// Common wrapper for fields to show labels, required indicators, and helper texts
export const FieldWrapper = ({ label, required, children, error, labelSuffix }) => {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-navy flex items-center">
          {label}
          {required && <span className="text-orange ml-1 text-sm font-bold">*</span>}
        </label>
        {labelSuffix && <span className="text-xs text-muted font-medium">{labelSuffix}</span>}
      </div>
      {children}
      {error && <p className="mt-1 text-xs text-danger font-medium">{error}</p>}
    </div>
  );
};

// TEXT_INPUT Field
export const TextInput = ({ label, placeholder, required, value, onChange, maxLength, error, disabled, labelSuffix, fieldKey }) => {
  const suffix = labelSuffix || (maxLength ? `${(value || '').length}/${maxLength}` : null);
  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={suffix}>
      <input
        type="text"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onPaste={makeScopedPasteHandler({ fieldKey, label, onChange })}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg border bg-white text-navy placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy transition-all duration-200 text-sm disabled:bg-off disabled:text-muted disabled:cursor-not-allowed ${
          error ? 'border-danger ring-2 ring-danger/10' : 'border-border hover:border-border-strong'
        }`}
      />
    </FieldWrapper>
  );
};

// TEXTAREA Field
export const TextArea = ({ label, placeholder, rows = 3, required, value, onChange, error, disabled, labelSuffix, fieldKey }) => {
  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={labelSuffix}>
      <textarea
        rows={rows}
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onPaste={makeScopedPasteHandler({ fieldKey, label, onChange })}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg border bg-white text-navy placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy transition-all duration-200 text-sm resize-y disabled:bg-off disabled:text-muted disabled:cursor-not-allowed ${
          error ? 'border-danger ring-2 ring-danger/10' : 'border-border hover:border-border-strong'
        }`}
      />
    </FieldWrapper>
  );
};

// SEARCHABLE_SELECT Field — a searchable dropdown over a fixed list of options (e.g. every
// approved university/course name) with an always-present "Other" fallback for anything not yet
// in that list. The input is freely typable at all times, so typing something with no match is
// already "Other" in effect; the pinned "Other" row in the dropdown just makes that explicit and
// discoverable rather than relying on the user to notice the list came up empty.
export const SearchableSelect = ({ label, placeholder, required, value, onChange, options = [], error, disabled, labelSuffix, fieldKey }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // No separate "query" state — onChange already updates the parent's `value` on every
  // keystroke, so `value` itself is what's currently typed; a mirrored local copy would just be
  // two names for the same thing (and would need an effect to stay in sync when `value` changes
  // from outside, e.g. switching fields/drafts).
  const trimmedValue = (value || '').trim();
  const filtered = trimmedValue
    ? options.filter(o => o.toLowerCase().includes(trimmedValue.toLowerCase()))
    : options;

  const selectOption = (opt) => {
    onChange(opt);
    setIsOpen(false);
  };

  const useOther = () => setIsOpen(false);

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={labelSuffix}>
      <div className="relative" ref={wrapperRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          <input
            type="text"
            id={fieldKey}
            placeholder={placeholder}
            value={value || ''}
            disabled={disabled}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => { onChange(e.target.value); setIsOpen(true); }}
            className={`w-full pl-9 pr-4 py-2.5 rounded-lg border bg-white text-navy placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy transition-all duration-200 text-sm disabled:bg-off disabled:text-muted disabled:cursor-not-allowed ${
              error ? 'border-danger ring-2 ring-danger/10' : 'border-border hover:border-border-strong'
            }`}
          />
        </div>

        {isOpen && !disabled && (
          <div className="absolute top-full left-0 mt-1.5 w-full max-h-56 overflow-y-auto bg-white border border-border rounded-xl shadow-premium-hover text-sm z-50">
            {filtered.length === 0 && (
              <div className="px-3.5 py-2.5 text-xs text-muted">No matches — your typed text will be used as-is.</div>
            )}
            {filtered.map((opt, i) => (
              <button
                type="button"
                key={`${opt}-${i}`}
                onClick={() => selectOption(opt)}
                className={`block w-full text-left px-3.5 py-2 text-sm hover:bg-off transition-colors ${opt === value ? 'text-navy font-semibold bg-off/60' : 'text-navy'}`}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              onClick={useOther}
              className="flex items-center gap-1.5 w-full text-left px-3.5 py-2.5 text-xs font-medium text-muted hover:bg-off transition-colors border-t border-border"
            >
              <PenLine className="w-3.5 h-3.5 shrink-0" />
              {trimmedValue ? `Use "${trimmedValue}" (not in the list)` : 'Other — type your own'}
            </button>
          </div>
        )}
      </div>
    </FieldWrapper>
  );
};

// RICH_TEXT Field (TipTap)
export const RichText = ({ label, placeholder, required, value, onChange, error, disabled, labelSuffix, fieldKey }) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        // Explicit allowlist (TipTap already rejects javascript: by default even without this —
        // verified against the installed version — but naming the allowed schemes here means a
        // future extension upgrade can't silently widen what this editor will store as a link).
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: {
          class: 'text-orange underline cursor-pointer',
        },
      }),
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    content: value || '',
    editable: !disabled,
    editorProps: {
      // Same scoping as TextInput/TextArea's onPaste — a plain single-value paste is left to
      // TipTap's own handling (preserves any rich formatting from the clipboard); a structured,
      // multi-field paste is matched strictly to this field's own key/label and inserted as plain
      // text at the cursor, or swallowed entirely if nothing matches this field.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain') || '';
        const trimmed = text.trim();
        const looksStructured = /\r?\n/.test(trimmed) || /^[^:=\t]+[:=\t]/.test(trimmed);
        if (!looksStructured) return false;

        const matched = extractSingleFieldValue(text, { fieldKey, label });
        if (matched != null) {
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          dispatch(state.tr.insertText(matched, from, to));
        }
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      // Avoid infinite updates
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [disabled, editor]);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState('');

  if (!editor) {
    return null;
  }

  // In-app replacement for the old window.prompt('Enter the URL:') flow — a native prompt is
  // exactly the kind of blocking browser dialog the rest of this app has moved away from.
  const openLinkModal = () => {
    setLinkUrlInput(editor.getAttributes('link').href || '');
    setShowLinkModal(true);
  };

  const applyLink = () => {
    const url = linkUrlInput.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setShowLinkModal(false);
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={labelSuffix}>
      <div className={`border rounded-lg overflow-hidden ${disabled ? 'bg-off' : 'bg-white'} ${
        error ? 'border-danger ring-2 ring-danger/10' : 'border-border hover:border-border-strong focus-within:ring-2 focus-within:ring-navy/15 focus-within:border-navy'
      } transition-all duration-200`}>
        {/* Toolbar — hidden rather than individually disabled, since editor.setEditable(false) already
            blocks the underlying commands; showing controls that would silently no-op is worse UX. */}
        {!disabled && (
        <div className="flex flex-wrap items-center gap-1 p-2 bg-off border-b border-border">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('bold') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('italic') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('bulletList') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Bullet List"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('orderedList') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Ordered List"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-navy text-white hover:bg-navy' : 'text-navy font-bold text-xs'}`}
            title="Heading 2"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-navy text-white hover:bg-navy' : 'text-navy font-bold text-xs'}`}
            title="Heading 3"
          >
            <Heading3 className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <button
            type="button"
            onClick={openLinkModal}
            className={`p-1.5 rounded hover:bg-navy-soft transition-colors ${editor.isActive('link') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Insert Link"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
        </div>
        )}

        {/* Editor Area */}
        <EditorContent editor={editor} className={`text-sm min-h-[120px] ${disabled ? 'text-muted' : 'text-navy'}`} />
      </div>

      {showLinkModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-border">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-extrabold text-navy uppercase tracking-wide">Insert Link</h3>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={linkUrlInput}
              onChange={(e) => setLinkUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); }}
              placeholder="https://example.com"
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-off text-navy placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-sm"
            />
            <p className="text-xs text-muted mt-2">Leave blank and confirm to remove an existing link.</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowLinkModal(false)}
                className="flex-1 bg-off hover:bg-border text-navy text-xs font-bold py-3 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyLink}
                className="flex-1 bg-navy hover:bg-navy-hover text-white text-xs font-bold py-3 rounded-lg transition-colors"
              >
                {linkUrlInput.trim() ? 'Set Link' : 'Remove Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FieldWrapper>
  );
};

// REPEATER Field — generic ACF-style repeater. Renders one card per row with an input
// per configured sub-field (text or textarea), matching the WP ACF repeater/sub-field model 1:1.
export const RepeaterBuilder = ({ label, required, value = [], onChange, error, subfields = [], disabled }) => {

  const handleAddRow = () => {
    const newRow = {};
    subfields.forEach(sf => {
      newRow[sf.key] = '';
    });
    onChange([...value, newRow]);
  };

  const handleUpdateCell = (rowIndex, key, val) => {
    const updated = [...value];
    updated[rowIndex] = { ...updated[rowIndex], [key]: val };
    onChange(updated);
  };

  // Pasting a single value behaves like a normal paste. Pasting a multi-line or tab-separated
  // block (copied from a spreadsheet/doc table) explodes into this row plus as many new rows
  // as needed — mirroring how the standalone "Paste Data" bulk-import works for flat fields.
  const handleSubfieldPaste = (rowIndex, e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text.includes('\t') && !/\r?\n/.test(text.trim())) return; // plain single value, let default paste happen

    e.preventDefault();
    const parsedRows = parseRepeaterPasteText(text, subfields);
    if (parsedRows.length === 0) return;

    const updated = [...value];
    updated[rowIndex] = { ...updated[rowIndex], ...parsedRows[0] };
    updated.splice(rowIndex + 1, 0, ...parsedRows.slice(1));
    onChange(updated);
  };

  const handleRemoveRow = (rowIndex) => {
    onChange(value.filter((_, i) => i !== rowIndex));
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={`${value.length} row${value.length === 1 ? '' : 's'}`}>
      <div className="space-y-3 mb-3">
        {value.map((row, rowIndex) => (
          <div key={rowIndex} className="p-3 border border-border rounded-lg bg-off shadow-soft hover:border-border-strong transition-all duration-150">
            <div className="flex justify-between items-center mb-2 pb-1 border-b border-border">
              <span className="text-xs font-bold text-navy uppercase tracking-wider">
                {label} #{rowIndex + 1}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveRow(rowIndex)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-danger-soft text-danger transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              )}
            </div>

            <div className="space-y-2">
              {subfields.map(sf => (
                <div key={sf.key}>
                  <label className="text-[10px] font-bold text-navy uppercase tracking-wider block mb-0.5">{sf.label}</label>
                  {sf.type === 'textarea' ? (
                    <textarea
                      rows={2}
                      placeholder={sf.placeholder}
                      value={row[sf.key] || ''}
                      onChange={(e) => handleUpdateCell(rowIndex, sf.key, e.target.value)}
                      onPaste={(e) => handleSubfieldPaste(rowIndex, e)}
                      disabled={disabled}
                      className="w-full px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs resize-y disabled:bg-off disabled:text-muted disabled:cursor-not-allowed"
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder={sf.placeholder}
                      value={row[sf.key] || ''}
                      onChange={(e) => handleUpdateCell(rowIndex, sf.key, e.target.value)}
                      onPaste={(e) => handleSubfieldPaste(rowIndex, e)}
                      disabled={disabled}
                      className="w-full px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs disabled:bg-off disabled:text-muted disabled:cursor-not-allowed"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={handleAddRow}
          className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-orange/50 text-orange font-semibold hover:bg-orange-soft hover:border-orange transition-all duration-150 rounded-lg text-xs"
        >
          <Plus className="w-4 h-4 text-orange" />
          Add {label}
        </button>
      )}
    </FieldWrapper>
  );
};
