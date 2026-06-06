import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { 
  Bold, Italic, List, ListOrdered, Heading2, Heading3, Link as LinkIcon, 
  Trash2, Plus, GripVertical, ChevronUp, ChevronDown, CheckSquare, PlusCircle 
} from 'lucide-react';

// Common wrapper for fields to show labels, required indicators, and helper texts
export const FieldWrapper = ({ label, required, children, error, labelSuffix }) => {
  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-navy flex items-center">
          {label}
          {required && <span className="text-orange ml-1 text-sm font-bold">*</span>}
        </label>
        {labelSuffix && <span className="text-xs text-muted font-medium">{labelSuffix}</span>}
      </div>
      {children}
      {error && <p className="mt-1 text-xs text-orange font-medium">{error}</p>}
    </div>
  );
};

// TEXT_INPUT Field
export const TextInput = ({ label, placeholder, required, value, onChange, maxLength, error }) => {
  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={maxLength ? `${(value || '').length}/${maxLength}` : null}>
      <input
        type="text"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-4 py-2.5 rounded-lg border bg-white text-navy placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition-all duration-200 text-sm ${
          error ? 'border-orange ring-2 ring-orange/10' : 'border-border'
        }`}
      />
    </FieldWrapper>
  );
};

// TEXTAREA Field
export const TextArea = ({ label, placeholder, rows = 3, required, value, onChange, error }) => {
  return (
    <FieldWrapper label={label} required={required} error={error}>
      <textarea
        rows={rows}
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-4 py-2.5 rounded-lg border bg-white text-navy placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition-all duration-200 text-sm resize-y ${
          error ? 'border-orange ring-2 ring-orange/10' : 'border-border'
        }`}
      />
    </FieldWrapper>
  );
};

// RICH_TEXT Field (TipTap)
export const RichText = ({ label, placeholder, required, value, onChange, error }) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-orange underline cursor-pointer',
        },
      }),
    ],
    content: value || '',
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

  if (!editor) {
    return null;
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter the URL:', previousUrl);
    
    // cancelled
    if (url === null) {
      return;
    }

    // empty
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    // update link
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <FieldWrapper label={label} required={required} error={error}>
      <div className={`border rounded-lg overflow-hidden bg-white ${
        error ? 'border-orange ring-2 ring-orange/10' : 'border-border focus-within:ring-2 focus-within:ring-navy/20 focus-within:border-navy'
      } transition-all duration-200`}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 p-2 bg-off border-b border-border">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('bold') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('italic') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('bulletList') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Bullet List"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('orderedList') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Ordered List"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-navy text-white hover:bg-navy' : 'text-navy font-bold text-xs'}`}
            title="Heading 2"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-navy text-white hover:bg-navy' : 'text-navy font-bold text-xs'}`}
            title="Heading 3"
          >
            <Heading3 className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-border mx-1"></div>
          <button
            type="button"
            onClick={setLink}
            className={`p-1.5 rounded hover:bg-border transition-colors ${editor.isActive('link') ? 'bg-navy text-white hover:bg-navy' : 'text-navy'}`}
            title="Insert Link"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Editor Area */}
        <EditorContent editor={editor} className="text-sm min-h-[120px] text-navy" />
      </div>
    </FieldWrapper>
  );
};

// LIST_BUILDER Field
export const ListBuilder = ({ label, placeholder, required, value = [], onChange, error }) => {
  const [draggedIndex, setDraggedIndex] = useState(null);

  const handleAddItem = () => {
    onChange([...value, '']);
  };

  const handleUpdateItem = (index, val) => {
    const updated = [...value];
    updated[index] = val;
    onChange(updated);
  };

  const handleRemoveItem = (index) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  // Reorder manually (up / down)
  const moveItem = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= value.length) return;
    const updated = [...value];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    onChange(updated);
  };

  // Native HTML5 Drag and Drop Handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag preview if needed
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    // Swap items on dragover for instant feedback
    const updated = [...value];
    const temp = updated[draggedIndex];
    updated[draggedIndex] = updated[index];
    updated[index] = temp;
    
    onChange(updated);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={`${value.length} items`}>
      <div className="space-y-2 mb-3">
        {value.map((item, index) => (
          <div
            key={index}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-2 p-2 rounded-lg bg-off border transition-all duration-200 ${
              draggedIndex === index ? 'border-orange ring-2 ring-orange/10 opacity-50 scale-[0.98]' : 'border-border hover:border-muted/50'
            }`}
          >
            {/* Drag Handle */}
            <div className="cursor-grab active:cursor-grabbing text-muted hover:text-navy p-1" title="Drag to reorder">
              <GripVertical className="w-4 h-4" />
            </div>

            {/* Manual Reordering buttons */}
            <div className="flex flex-col text-muted">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveItem(index, -1)}
                className="hover:text-navy disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={index === value.length - 1}
                onClick={() => moveItem(index, 1)}
                className="hover:text-navy disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-xs font-semibold text-muted w-5 text-center">#{index + 1}</span>

            <input
              type="text"
              placeholder={placeholder || 'Enter list item...'}
              value={item}
              onChange={(e) => handleUpdateItem(index, e.target.value)}
              className="flex-1 px-3 py-1.5 rounded border border-border bg-white text-navy focus:outline-none focus:border-navy text-sm placeholder:text-muted/40"
            />

            <button
              type="button"
              onClick={() => handleRemoveItem(index)}
              className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors"
              title="Delete item"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      
      <button
        type="button"
        onClick={handleAddItem}
        className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-orange text-orange font-semibold hover:bg-orange/5 transition-all duration-150 rounded-lg text-xs"
      >
        <Plus className="w-4 h-4 text-orange" />
        Add Item
      </button>
    </FieldWrapper>
  );
};

// TABLE_BUILDER Field
export const TableBuilder = ({ label, columns = [], required, value = [], onChange, error }) => {
  
  const handleAddRow = () => {
    const newRow = {};
    columns.forEach(col => {
      newRow[col] = '';
    });
    onChange([...value, newRow]);
  };

  const handleUpdateCell = (rowIndex, colKey, val) => {
    const updated = [...value];
    updated[rowIndex] = { ...updated[rowIndex], [colKey]: val };
    onChange(updated);
  };

  const handleRemoveRow = (rowIndex) => {
    const updated = value.filter((_, i) => i !== rowIndex);
    onChange(updated);
  };

  // Convert column keys to labels: e.g. "fee_per_semester" -> "Fee Per Semester"
  const formatHeader = (header) => {
    return header
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={`${value.length} rows`}>
      <div className="overflow-x-auto border border-border rounded-lg mb-3 shadow-sm bg-white">
        <table className="w-full border-collapse text-left text-sm text-navy">
          <thead className="bg-navy text-white text-xs font-semibold uppercase tracking-wider">
            <tr>
              <th className="py-2 px-3 w-10 text-center">#</th>
              {columns.map(col => (
                <th key={col} className="py-2 px-3 font-semibold">
                  {formatHeader(col)}
                </th>
              ))}
              <th className="py-2 px-3 w-12 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {value.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="py-6 text-center text-xs text-muted/60 bg-off font-medium italic">
                  No rows added yet. Click "Add Row" to start.
                </td>
              </tr>
            ) : (
              value.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-off/50">
                  <td className="py-2 px-3 text-center text-xs font-semibold text-muted">{rowIndex + 1}</td>
                  {columns.map(col => (
                    <td key={col} className="py-1 px-2">
                      <input
                        type="text"
                        value={row[col] || ''}
                        onChange={(e) => handleUpdateCell(rowIndex, col, e.target.value)}
                        placeholder={`Enter ${formatHeader(col)}...`}
                        className="w-full px-2 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs"
                      />
                    </td>
                  ))}
                  <td className="py-1 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(rowIndex)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors"
                      title="Delete row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={handleAddRow}
        className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-orange text-orange font-semibold hover:bg-orange/5 transition-all duration-150 rounded-lg text-xs"
      >
        <Plus className="w-4 h-4 text-orange" />
        Add Row
      </button>
    </FieldWrapper>
  );
};

// FAQ_BUILDER Field
export const FaqBuilder = ({ label, required, value = [], onChange, error }) => {
  
  const handleAddFaq = () => {
    onChange([...value, { question: '', answer: '' }]);
  };

  const handleUpdateFaq = (index, field, val) => {
    const updated = [...value];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  const handleRemoveFaq = (index) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={`${value.length} FAQs`}>
      <div className="space-y-3 mb-3">
        {value.map((faq, index) => (
          <div key={index} className="p-3 border border-border rounded-lg bg-off shadow-sm hover:border-muted/30 transition-all duration-150">
            <div className="flex justify-between items-center mb-2 pb-1 border-b border-border">
              <span className="text-xs font-bold text-navy uppercase tracking-wider">
                FAQ #{index + 1}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveFaq(index)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-red-50 text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </button>
            </div>
            
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-bold text-navy uppercase tracking-wider block mb-0.5">Question</label>
                <input
                  type="text"
                  placeholder="e.g. Is this program approved by UGC?"
                  value={faq.question || ''}
                  onChange={(e) => handleUpdateFaq(index, 'question', e.target.value)}
                  className="w-full px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-navy uppercase tracking-wider block mb-0.5">Answer</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Yes, NMIMS online programs are recognized by the UGC-DEB."
                  value={faq.answer || ''}
                  onChange={(e) => handleUpdateFaq(index, 'answer', e.target.value)}
                  className="w-full px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs resize-y"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAddFaq}
        className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-orange text-orange font-semibold hover:bg-orange/5 transition-all duration-150 rounded-lg text-xs"
      >
        <Plus className="w-4 h-4 text-orange" />
        Add FAQ
      </button>
    </FieldWrapper>
  );
};

// REVIEW_BUILDER Field
export const ReviewBuilder = ({ label, required, value = [], onChange, error }) => {
  
  const handleAddReview = () => {
    onChange([...value, { review: '', author: '' }]);
  };

  const handleUpdateReview = (index, field, val) => {
    const updated = [...value];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  const handleRemoveReview = (index) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={`${value.length} reviews`}>
      <div className="space-y-3 mb-3">
        {value.map((rev, index) => (
          <div key={index} className="p-3 border border-border rounded-lg bg-off shadow-sm hover:border-muted/30 transition-all duration-150">
            <div className="flex justify-between items-center mb-2 pb-1 border-b border-border">
              <span className="text-xs font-bold text-navy uppercase tracking-wider">
                Review #{index + 1}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveReview(index)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-red-50 text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </button>
            </div>
            
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-bold text-navy uppercase tracking-wider block mb-0.5">Review Text</label>
                <textarea
                  rows={2}
                  placeholder="e.g. This course helped me transition into a Product Marketing Manager role at Google..."
                  value={rev.review || ''}
                  onChange={(e) => handleUpdateReview(index, 'review', e.target.value)}
                  className="w-full px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs resize-y"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-navy uppercase tracking-wider block mb-0.5">Author Label / Info</label>
                <input
                  type="text"
                  placeholder="e.g. Rohit Sharma, Batch of 2024"
                  value={rev.author || ''}
                  onChange={(e) => handleUpdateReview(index, 'author', e.target.value)}
                  className="w-full px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAddReview}
        className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-orange text-orange font-semibold hover:bg-orange/5 transition-all duration-150 rounded-lg text-xs"
      >
        <Plus className="w-4 h-4 text-orange" />
        Add Review
      </button>
    </FieldWrapper>
  );
};

// STEP_BUILDER Field
export const StepBuilder = ({ label, required, value = [], onChange, error }) => {
  
  const handleAddStep = () => {
    onChange([...value, '']);
  };

  const handleUpdateStep = (index, val) => {
    const updated = [...value];
    updated[index] = val;
    onChange(updated);
  };

  const handleRemoveStep = (index) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <FieldWrapper label={label} required={required} error={error} labelSuffix={`${value.length} steps`}>
      <div className="space-y-3 mb-3">
        {value.map((step, index) => (
          <div key={index} className="flex gap-2 p-2 rounded-lg bg-off border border-border hover:border-muted/30 transition-all duration-150 items-start">
            <div className="bg-navy text-white text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0 mt-1 shadow-sm">
              {index + 1}
            </div>
            
            <textarea
              rows={2}
              placeholder={`Step ${index + 1} details (e.g. Fill the online admission form and submit required documents...)`}
              value={step}
              onChange={(e) => handleUpdateStep(index, e.target.value)}
              className="flex-1 px-3 py-1.5 border border-border rounded bg-white text-navy focus:outline-none focus:border-navy text-xs resize-y"
            />

            <button
              type="button"
              onClick={() => handleRemoveStep(index)}
              className="p-1.5 rounded hover:bg-red-50 text-red-500 transition-colors mt-1 shrink-0"
              title="Delete step"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAddStep}
        className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-orange text-orange font-semibold hover:bg-orange/5 transition-all duration-150 rounded-lg text-xs"
      >
        <Plus className="w-4 h-4 text-orange" />
        Add Step
      </button>
    </FieldWrapper>
  );
};

// BADGE_SELECTOR Field
export const BadgeSelector = ({ label, options = [], value = [], onChange, error }) => {
  const [customBadge, setCustomBadge] = useState('');
  const [allOptions, setAllOptions] = useState(options);

  // Sync if options change
  useEffect(() => {
    const merged = Array.from(new Set([...options, ...value]));
    setAllOptions(merged);
  }, [options]);

  const handleToggle = (badge) => {
    if (value.includes(badge)) {
      onChange(value.filter(v => v !== badge));
    } else {
      onChange([...value, badge]);
    }
  };

  const handleAddCustomBadge = (e) => {
    e.preventDefault();
    const cleanBadge = customBadge.trim();
    if (cleanBadge && !allOptions.includes(cleanBadge)) {
      setAllOptions([...allOptions, cleanBadge]);
      onChange([...value, cleanBadge]);
      setCustomBadge('');
    }
  };

  return (
    <FieldWrapper label={label} error={error} labelSuffix={`${value.length} selected`}>
      <div className="p-3 border border-border rounded-lg bg-off/30 mb-2">
        <div className="flex flex-wrap gap-2 mb-3">
          {allOptions.map((badge) => {
            const isSelected = value.includes(badge);
            return (
              <button
                type="button"
                key={badge}
                onClick={() => handleToggle(badge)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer select-none ${
                  isSelected 
                    ? 'bg-navy border-navy text-white shadow-sm' 
                    : 'bg-white border-border text-navy hover:border-muted/50 hover:bg-off'
                }`}
              >
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-orange"></span>}
                {badge}
              </button>
            );
          })}
        </div>
        
        {/* Add custom option */}
        <form onSubmit={handleAddCustomBadge} className="flex gap-2">
          <input
            type="text"
            placeholder="Add custom badge (e.g. Fast Track)"
            value={customBadge}
            onChange={(e) => setCustomBadge(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded border border-border bg-white text-navy focus:outline-none focus:border-navy text-xs"
          />
          <button
            type="submit"
            className="flex items-center gap-1 px-3 py-1.5 bg-navy hover:bg-navy-hover text-white text-xs font-semibold rounded transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Add
          </button>
        </form>
      </div>
    </FieldWrapper>
  );
};
