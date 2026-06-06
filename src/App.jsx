import React, { useState, useEffect, useReducer, useRef } from 'react';
import { 
  schemas, 
  PAGE_TYPES, 
  SCHEMA_DETAILS, 
  getInitialState, 
  transformToACF, 
  validateState, 
  calculateProgress, 
  getSectionStatus,
  getIcon
} from './config/schemas';
import { 
  TextInput, 
  TextArea, 
  RichText, 
  ListBuilder, 
  TableBuilder, 
  FaqBuilder, 
  ReviewBuilder, 
  StepBuilder, 
  BadgeSelector 
} from './components/FieldTypes';
import { 
  ArrowLeft, Save, Download, Eye, Copy, Plus, Trash2, 
  History, Sparkles, CheckCircle, AlertCircle, X, ChevronRight,
  Menu, Check, CornerDownRight, ExternalLink
} from 'lucide-react';
import './App.css';

// Action Types for Reducer
const ACTIONS = {
  START_FORM: 'START_FORM',
  UPDATE_FIELD: 'UPDATE_FIELD',
  LOAD_DRAFT: 'LOAD_DRAFT',
  RESET: 'RESET',
  SYNC_DRAFT_ID: 'SYNC_DRAFT_ID'
};

// State Reducer
function formReducer(state, action) {
  switch (action.type) {
    case ACTIONS.START_FORM:
      return {
        activePageType: action.payload.pageType,
        activeDraftId: action.payload.draftId,
        formData: action.payload.initialState
      };
    case ACTIONS.UPDATE_FIELD:
      return {
        ...state,
        formData: {
          ...state.formData,
          [action.payload.key]: action.payload.value
        }
      };
    case ACTIONS.LOAD_DRAFT:
      return {
        activePageType: action.payload.pageType,
        activeDraftId: action.payload.draftId,
        formData: action.payload.state
      };
    case ACTIONS.SYNC_DRAFT_ID:
      return {
        ...state,
        activeDraftId: action.payload.draftId
      };
    case ACTIONS.RESET:
      return {
        activePageType: null,
        activeDraftId: null,
        formData: {}
      };
    default:
      return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(formReducer, {
    activePageType: null,
    activeDraftId: null,
    formData: {}
  });

  const { activePageType, activeDraftId, formData } = state;

  // Local UI States
  const [drafts, setDrafts] = useState([]);
  const [expandedSections, setExpandedSections] = useState({});
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState(null); // 'saving' | 'saved' | null
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [copiedIndicator, setCopiedIndicator] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [latestDraft, setLatestDraft] = useState(null);

  const autoSaveIntervalRef = useRef(null);

  // Load drafts on mount
  useEffect(() => {
    loadDraftsFromStorage();
  }, []);

  // Check for existing drafts to display the "Continue draft?" banner
  const loadDraftsFromStorage = () => {
    const stored = localStorage.getItem('degreebaba_drafts');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Sort by last edited descending
        const sorted = parsed.sort((a, b) => new Date(b.last_edited) - new Date(a.last_edited));
        setDrafts(sorted);

        if (sorted.length > 0 && !activePageType) {
          setLatestDraft(sorted[0]);
          setShowBanner(true);
        }
      } catch (e) {
        console.error('Error loading drafts', e);
      }
    }
  };

  // Get display name for top bar
  const getPageDisplayName = () => {
    if (!formData) return 'Untitled Page';
    
    const uName = formData.university_name || '';
    
    if (activePageType === PAGE_TYPES.SPECIALIZATION) {
      const sName = formData.spec_name || '';
      if (!uName && !sName) return 'New Specialization Draft';
      return `${uName}${uName && sName ? ' · ' : ''}${sName}`;
    }
    
    if (activePageType === PAGE_TYPES.COURSE) {
      const cName = formData.course_name || '';
      if (!uName && !cName) return 'New Course Draft';
      return `${uName}${uName && cName ? ' · ' : ''}${cName}`;
    }
    
    if (activePageType === PAGE_TYPES.UNIVERSITY) {
      if (!uName) return 'New University Draft';
      return uName;
    }

    return 'Untitled Draft';
  };

  // Expand all sections by default when a schema is loaded
  useEffect(() => {
    if (activePageType) {
      const schema = schemas[activePageType];
      if (schema) {
        const initialExpanded = {};
        schema.sections.forEach(sec => {
          initialExpanded[sec.id] = true;
        });
        setExpandedSections(initialExpanded);
      }
      setShowValidationErrors(false);
      setSaveIndicator(null);
    }
  }, [activePageType]);

  // Set up 30-second Auto-save
  useEffect(() => {
    if (activePageType && activeDraftId) {
      // Clear previous interval if active
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }

      autoSaveIntervalRef.current = setInterval(() => {
        saveDraftToStorage(true);
      }, 30000);
    }

    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
    };
  }, [activePageType, activeDraftId, formData]);

  // Save draft function
  const saveDraftToStorage = (isAuto = false) => {
    if (!activePageType || !activeDraftId) return;

    setSaveIndicator('saving');

    const uName = formData.university_name || 'Untitled University';
    let title = 'Untitled Page';

    if (activePageType === PAGE_TYPES.SPECIALIZATION) {
      title = formData.spec_name || 'Untitled Specialization';
    } else if (activePageType === PAGE_TYPES.COURSE) {
      title = formData.course_name || 'Untitled Course';
    } else if (activePageType === PAGE_TYPES.UNIVERSITY) {
      title = formData.university_full_name || uName;
    }

    const now = new Date();
    const currentDraft = {
      id: activeDraftId,
      page_type: activePageType,
      university_name: uName,
      title: title,
      last_edited: now.toISOString(),
      state: formData
    };

    // Load fresh copy from storage to merge
    let currentDrafts = [];
    const stored = localStorage.getItem('degreebaba_drafts');
    if (stored) {
      try {
        currentDrafts = JSON.parse(stored);
      } catch (e) {
        console.error(e);
      }
    }

    // Filter out existing copy
    currentDrafts = currentDrafts.filter(d => d.id !== activeDraftId);
    
    // Add new draft to beginning
    currentDrafts.unshift(currentDraft);

    // Persist
    localStorage.setItem('degreebaba_drafts', JSON.stringify(currentDrafts));
    
    // Update local drafts list
    setDrafts(currentDrafts);
    setLastSavedTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setSaveIndicator('saved');

    setTimeout(() => {
      setSaveIndicator(null);
    }, 2500);
  };

  const startNewForm = (pageType) => {
    const newId = `draft_${Date.now()}`;
    const initial = getInitialState(pageType);
    dispatch({
      type: ACTIONS.START_FORM,
      payload: { pageType, draftId: newId, initialState: initial }
    });
    setShowBanner(false);
  };

  const loadDraft = (draft) => {
    dispatch({
      type: ACTIONS.LOAD_DRAFT,
      payload: { pageType: draft.page_type, draftId: draft.id, state: draft.state }
    });
    setShowBanner(false);
  };

  const deleteDraft = (draftId, e) => {
    e.stopPropagation();
    const filtered = drafts.filter(d => d.id !== draftId);
    localStorage.setItem('degreebaba_drafts', JSON.stringify(filtered));
    setDrafts(filtered);
    if (latestDraft && latestDraft.id === draftId) {
      setLatestDraft(filtered[0] || null);
      if (filtered.length === 0) {
        setShowBanner(false);
      }
    }
  };

  const resetToHome = () => {
    if (confirm('Are you sure you want to go back to home? Unsaved changes in the last few seconds might be lost.')) {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
      dispatch({ type: ACTIONS.RESET });
      loadDraftsFromStorage();
    }
  };

  const clearAllDrafts = () => {
    if (confirm('Are you sure you want to delete all saved drafts? This action is permanent.')) {
      localStorage.removeItem('degreebaba_drafts');
      setDrafts([]);
      setLatestDraft(null);
      setShowBanner(false);
    }
  };

  // Field change handler
  const handleFieldChange = (key, value) => {
    dispatch({
      type: ACTIONS.UPDATE_FIELD,
      payload: { key, value }
    });
  };

  // Collapsible toggle
  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  // Scroll to section element
  const scrollToSection = (sectionId) => {
    const el = document.getElementById(`section-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // JSON syntax highlighter styling helper
  const highlightJSON = (jsonObj) => {
    const jsonStr = JSON.stringify(jsonObj, null, 2);
    if (!jsonStr) return '';
    return jsonStr.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'text-emerald-400 font-medium'; // numbers / booleans
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-sky-300 font-semibold'; // keys
          } else {
            cls = 'text-amber-200'; // strings
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-violet-400 font-semibold';
        } else if (/null/.test(match)) {
          cls = 'text-gray-400 italic';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  };

  const handleCopyJSON = (payload) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedIndicator(true);
    setTimeout(() => {
      setCopiedIndicator(false);
    }, 2000);
  };

  const handleDownloadAttempt = () => {
    const result = currentValidation;
    if (!result.isValid) {
      setShowValidationErrors(true);
      setShowErrorModal(true);
      
      // Auto scroll to first missing field
      setTimeout(() => {
        const firstInvalidKey = Object.keys(result.invalidFields)[0];
        if (firstInvalidKey) {
          const container = document.getElementById(`field-container-${firstInvalidKey}`);
          if (container) {
            container.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight it temporarily
            container.classList.add('ring-2', 'ring-orange/30');
            setTimeout(() => {
              container.classList.remove('ring-2', 'ring-orange/30');
            }, 3000);
          }
        }
      }, 300);
    } else {
      setShowValidationErrors(false);
      setShowSuccessModal(true);
    }
  };

  const executeDownload = () => {
    const payload = transformToACF(formData, activePageType);
    const uName = (formData.university_name || 'university').trim().toLowerCase().replace(/\s+/g, '_');
    const pageName = activePageType === PAGE_TYPES.SPECIALIZATION 
      ? (formData.spec_name || 'specialization').trim().toLowerCase().replace(/\s+/g, '_')
      : activePageType === PAGE_TYPES.COURSE
        ? (formData.course_name || 'course').trim().toLowerCase().replace(/\s+/g, '_')
        : 'page';

    const cleanFilename = `${uName}_${pageName}_acf.json`
      .replace(/[^a-zA-Z0-9_.-]/g, '');

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = cleanFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setShowSuccessModal(false);
  };

  // Active schema variables
  const activeSchema = activePageType ? schemas[activePageType] : null;
  const progressPercent = activePageType ? calculateProgress(formData, activePageType) : 0;
  const acfPayload = activePageType ? transformToACF(formData, activePageType) : null;
  const currentValidation = activePageType ? validateState(formData, activePageType) : { isValid: true, errors: [], invalidFields: {} };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col antialiased">
      
      {/* 1. AUTO-SAVE BANNER ON HOME SCREEN */}
      {showBanner && latestDraft && !activePageType && (
        <div className="bg-[#0E1F3D] text-white border-b border-orange/40 px-6 py-3.5 flex justify-between items-center shadow-lg transition-all duration-300">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange"></span>
            </span>
            <div className="text-sm">
              <span className="font-semibold text-orange-hover">Auto-Saved Draft Found:</span> We found your unfinished draft for{' '}
              <strong className="text-white font-semibold">{latestDraft.university_name}</strong> ({SCHEMA_DETAILS[latestDraft.page_type]?.title || latestDraft.page_type}) edited on {new Date(latestDraft.last_edited).toLocaleDateString()} at {new Date(latestDraft.last_edited).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}.
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => loadDraft(latestDraft)}
              className="bg-orange hover:bg-orange-hover text-white text-xs font-semibold px-4 py-1.5 rounded transition-all duration-150 shadow-sm"
            >
              Continue Editing
            </button>
            <button
              onClick={() => setShowBanner(false)}
              className="bg-transparent hover:bg-white/10 text-white/80 border border-white/20 text-xs font-semibold px-3 py-1.5 rounded transition-all duration-150"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* RENDER HOME SCREEN */}
      {!activePageType ? (
        <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex flex-col justify-center">
          
          {/* Brand/Hero Section */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center p-3 bg-navy text-white rounded-2xl mb-4 shadow-premium">
              <Sparkles className="w-8 h-8 text-orange" />
            </div>
            <h1 className="text-4xl font-extrabold text-navy tracking-tight mb-2 uppercase">
              DegreeBaba <span className="text-orange">Content Studio</span>
            </h1>
            <p className="text-muted text-sm font-medium max-w-md mx-auto">
              WordPress ACF-compliant payload generator for internal content writers. Speed up university catalog deployment.
            </p>
          </div>

          {/* Page Type Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {Object.values(SCHEMA_DETAILS).map(type => (
              <button
                key={type.id}
                onClick={() => startNewForm(type.id)}
                className="group relative flex flex-col text-left p-6 rounded-2xl bg-white border border-border hover:border-orange transition-all duration-300 shadow-premium hover:shadow-premium-hover cursor-pointer"
              >
                {/* Visual hover top bar accent */}
                <div className="absolute top-0 left-0 w-full h-1.5 bg-navy group-hover:bg-orange rounded-t-2xl transition-colors duration-300"></div>
                
                <span className="text-xs font-bold uppercase tracking-wider text-muted mb-2">Create New Template</span>
                <h3 className="text-xl font-extrabold text-navy group-hover:text-orange transition-colors mb-4 uppercase">
                  {type.title}
                </h3>
                
                <div className="mt-auto space-y-2">
                  <div className="flex justify-between items-center text-xs font-medium border-t border-border pt-3">
                    <span className="text-muted">Fields Required</span>
                    <span className="text-navy font-bold">{type.fieldCount}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-medium">
                    <span className="text-muted">Est. Fill Time</span>
                    <span className="text-navy font-bold">{type.estimatedTime}</span>
                  </div>
                </div>
                
                <div className="mt-4 flex items-center gap-1.5 text-xs text-orange font-bold uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity">
                  Get Started
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </button>
            ))}
          </div>

          {/* Recent Drafts Table */}
          <div className="bg-white border border-border rounded-2xl p-6 shadow-premium">
            <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
              <h2 className="text-lg font-bold text-navy flex items-center gap-2 uppercase tracking-wide">
                <History className="w-5 h-5 text-orange" />
                Recent Saved Drafts
              </h2>
              {drafts.length > 0 && (
                <button
                  onClick={clearAllDrafts}
                  className="flex items-center gap-1.5 text-xs text-red-500 font-semibold hover:text-red-700 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All
                </button>
              )}
            </div>

            {drafts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted font-medium italic">
                No saved drafts found. Select a card above to start writing.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">University Name</th>
                      <th className="py-3 px-4">Page Type</th>
                      <th className="py-3 px-4">Page/Spec Title</th>
                      <th className="py-3 px-4">Last Edited</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {drafts.slice(0, 5).map(draft => (
                      <tr
                        key={draft.id}
                        onClick={() => loadDraft(draft)}
                        className="hover:bg-off/60 cursor-pointer transition-colors group"
                      >
                        <td className="py-4 px-4 font-bold text-navy">{draft.university_name}</td>
                        <td className="py-4 px-4">
                          <span className="inline-block bg-off border border-border text-[10px] font-bold uppercase tracking-wider text-navy px-2 py-0.5 rounded">
                            {SCHEMA_DETAILS[draft.page_type]?.title || draft.page_type}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-medium text-muted">{draft.title}</td>
                        <td className="py-4 px-4 text-xs text-muted">
                          {new Date(draft.last_edited).toLocaleDateString()} at{' '}
                          {new Date(draft.last_edited).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => loadDraft(draft)}
                              className="text-xs bg-navy text-white hover:bg-navy-hover font-semibold px-3 py-1.5 rounded transition-all"
                            >
                              Continue
                            </button>
                            <button
                              onClick={(e) => deleteDraft(draft.id, e)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors"
                              title="Delete Draft"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      ) : (
        
        /* SCREEN 2 — FORM VIEW (3-COLUMN INTERFACE) */
        <div className="flex-1 flex flex-col">
          
          {/* Sticky Header Top Bar */}
          <header className="sticky top-0 z-30 bg-navy text-white border-b border-border shadow-md px-6 py-3.5 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <button
                  onClick={resetToHome}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors border border-white/10"
                  title="Back to Home"
                >
                  <ArrowLeft className="w-4 h-4 text-white" />
                </button>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-extrabold tracking-tight truncate max-w-sm">
                      {getPageDisplayName()}
                    </h2>
                    <span className="bg-orange text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded text-white shrink-0">
                      {SCHEMA_DETAILS[activePageType]?.title || activePageType}
                    </span>
                  </div>
                  {/* Auto save indicator */}
                  <div className="text-[10px] text-muted flex items-center gap-1.5 mt-0.5">
                    {saveIndicator === 'saving' ? (
                      <span className="flex items-center gap-1 text-orange">
                        <span className="animate-spin h-2 w-2 border-2 border-orange border-t-transparent rounded-full"></span>
                        Saving draft changes...
                      </span>
                    ) : saveIndicator === 'saved' ? (
                      <span className="flex items-center gap-1 text-green-success font-medium animate-pulse">
                        <Check className="w-3 h-3" />
                        Draft Saved
                      </span>
                    ) : lastSavedTime ? (
                      <span className="text-gray-400">Auto-saved at {lastSavedTime}</span>
                    ) : (
                      <span className="text-gray-400">Draft unsaved</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => saveDraftToStorage(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPreviewModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview JSON
                </button>
                <button
                  type="button"
                  onClick={handleDownloadAttempt}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-orange hover:bg-orange-hover font-bold text-xs rounded text-white transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download JSON
                </button>
              </div>
            </div>

            {/* Progress Bar Row */}
            <div className="flex items-center gap-3 mt-1.5 border-t border-white/5 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-300 w-32 shrink-0">
                Required Fields Filled:
              </span>
              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange transition-all duration-500 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
              <span className="text-xs font-bold text-orange shrink-0 w-8 text-right">
                {progressPercent}%
              </span>
            </div>
          </header>

          {/* Form Workspace Container */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* COLUMN 1: LEFT SIDEBAR (STICKY SECTION NAV) */}
            <aside className="w-[240px] bg-white border-r border-border flex flex-col shrink-0 overflow-y-auto no-scrollbar shadow-sm">
              <div className="p-4 border-b border-border bg-off/50">
                <h3 className="text-xs font-bold text-navy uppercase tracking-wider">Form Sections</h3>
              </div>
              <nav className="flex-1 p-2 space-y-1">
                {activeSchema.sections.map((sec, index) => {
                  const status = getSectionStatus(formData, sec, activePageType);
                  const hasErrors = showValidationErrors && sec.fields.some(f => currentValidation.invalidFields[f.key]);

                  // Determine dot/checkmark configuration
                  let statusIndicator = null;
                  if (hasErrors) {
                    statusIndicator = <span className="w-2.5 h-2.5 rounded-full bg-orange shrink-0 border border-white ring-2 ring-orange/30 animate-pulse" title="Required fields incomplete"></span>;
                  } else if (status === 'complete') {
                    statusIndicator = <CheckCircle className="w-4 h-4 text-green-success shrink-0" />;
                  } else if (status === 'partial') {
                    statusIndicator = <span className="w-2 h-2 rounded-full bg-orange shrink-0" title="Partially filled"></span>;
                  } else {
                    statusIndicator = <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" title="Empty"></span>;
                  }

                  return (
                    <button
                      key={sec.id}
                      onClick={() => scrollToSection(sec.id)}
                      className={`w-full flex items-center justify-between text-left p-2.5 rounded-lg text-xs font-medium transition-all hover:bg-off ${
                        hasErrors 
                          ? 'text-orange bg-orange/5 hover:bg-orange/10 font-bold' 
                          : 'text-navy hover:text-orange-hover'
                      }`}
                    >
                      <span className="truncate pr-2 flex items-center gap-1.5">
                        <span className="text-muted font-mono shrink-0">{(index + 1).toString().padStart(2, '0')}</span>
                        {sec.title}
                      </span>
                      {statusIndicator}
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* COLUMN 2: CENTER (SCROLLABLE FORM CARDS) */}
            <main className="flex-1 bg-off p-6 overflow-y-auto space-y-6">
              
              {showValidationErrors && !currentValidation.isValid && (
                <div className="bg-red-50 border border-orange/20 rounded-xl p-4 flex gap-3 text-sm text-orange">
                  <AlertCircle className="w-5 h-5 text-orange shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold uppercase tracking-wider text-xs text-orange mb-1">Validation errors found</h4>
                    <p className="text-xs text-orange font-medium">
                      Form is incomplete. We highlighted the missing required fields in red. Fix them to enable downloading the payload.
                    </p>
                  </div>
                </div>
              )}

              {activeSchema.sections.map((sec, secIndex) => {
                const isCollapsed = !expandedSections[sec.id];
                const IconComponent = getIcon(sec.icon);
                
                // Check if any field in this section has validation error
                const secHasErrors = showValidationErrors && sec.fields.some(f => currentValidation.invalidFields[f.key]);
                const requiredFields = sec.fields.filter(f => f.required);
                const isRequiredBadge = requiredFields.length > 0;

                return (
                  <div
                    key={sec.id}
                    id={`section-${sec.id}`}
                    className={`bg-white border rounded-xl shadow-premium overflow-hidden transition-all duration-300 ${
                      secHasErrors ? 'border-orange ring-1 ring-orange/10' : 'border-border hover:shadow-premium-hover'
                    }`}
                  >
                    {/* Collapsible Card Header */}
                    <div
                      onClick={() => toggleSection(sec.id)}
                      className="bg-navy text-white px-5 py-4 flex justify-between items-center cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-white/10 rounded-lg text-white">
                          <IconComponent className="w-4 h-4 text-orange" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-1.5">
                            {sec.title}
                          </h3>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {isRequiredBadge && (
                          <span className="bg-orange/20 border border-orange/40 text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded text-orange">
                            Required Fields
                          </span>
                        )}
                        <span className="text-[10px] uppercase font-bold text-gray-400">
                          {isCollapsed ? 'Expand' : 'Collapse'}
                        </span>
                      </div>
                    </div>

                    {/* Section Fields Body */}
                    {!isCollapsed && (
                      <div className="p-5 bg-white">
                        {sec.description && (
                          <p className="text-xs text-muted font-medium mb-4 italic pb-3 border-b border-border">
                            {sec.description}
                          </p>
                        )}
                        
                        {/* Dynamic Field Renderer */}
                        <div className="space-y-4">
                          
                          {/* SPECIAL RENDER: GRID LAYOUTS FOR STATS / ROW CONFIGS */}
                          {sec.id === 'hero_stats' ? (
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                              {sec.fields.map(field => {
                                const isInvalid = showValidationErrors && currentValidation.invalidFields[field.key];
                                return (
                                  <div key={field.key} id={`field-container-${field.key}`}>
                                    <TextInput
                                      label={field.label}
                                      placeholder={field.placeholder}
                                      required={field.required}
                                      value={formData[field.key]}
                                      onChange={(val) => handleFieldChange(field.key, val)}
                                      error={isInvalid ? 'Invalid stat field' : null}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          ) : sec.id === 'fee_structure' ? (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-3 border-b border-border/50">
                                <div id={`field-container-fee_semester_amount`}>
                                  <TextInput
                                    label={sec.fields[0].label}
                                    placeholder={sec.fields[0].placeholder}
                                    required={sec.fields[0].required}
                                    value={formData.fee_semester_amount}
                                    onChange={(val) => handleFieldChange('fee_semester_amount', val)}
                                  />
                                </div>
                                <div id={`field-container-fee_semester_total`}>
                                  <TextInput
                                    label={sec.fields[1].label}
                                    placeholder={sec.fields[1].placeholder}
                                    required={sec.fields[1].required}
                                    value={formData.fee_semester_total}
                                    onChange={(val) => handleFieldChange('fee_semester_total', val)}
                                  />
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-3 border-b border-border/50">
                                <div id={`field-container-fee_annual_amount`}>
                                  <TextInput
                                    label={sec.fields[2].label}
                                    placeholder={sec.fields[2].placeholder}
                                    required={sec.fields[2].required}
                                    value={formData.fee_annual_amount}
                                    onChange={(val) => handleFieldChange('fee_annual_amount', val)}
                                  />
                                </div>
                                <div id={`field-container-fee_annual_total`}>
                                  <TextInput
                                    label={sec.fields[3].label}
                                    placeholder={sec.fields[3].placeholder}
                                    required={sec.fields[3].required}
                                    value={formData.fee_annual_total}
                                    onChange={(val) => handleFieldChange('fee_annual_total', val)}
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div id={`field-container-fee_onetime_amount`}>
                                  <TextInput
                                    label={sec.fields[4].label}
                                    placeholder={sec.fields[4].placeholder}
                                    required={sec.fields[4].required}
                                    value={formData.fee_onetime_amount}
                                    onChange={(val) => handleFieldChange('fee_onetime_amount', val)}
                                    error={showValidationErrors && currentValidation.invalidFields.fee_onetime_amount ? 'One-time amount is required' : null}
                                  />
                                </div>
                                <div id={`field-container-fee_savings_note`}>
                                  <TextInput
                                    label={sec.fields[5].label}
                                    placeholder={sec.fields[5].placeholder}
                                    required={sec.fields[5].required}
                                    value={formData.fee_savings_note}
                                    onChange={(val) => handleFieldChange('fee_savings_note', val)}
                                  />
                                </div>
                              </div>
                            </div>
                          ) : sec.id === 'placement' ? (
                            <div className="space-y-4">
                              {/* Stat rows side by side in pairs */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-3 border-b border-border/50">
                                <div className="p-3 bg-off rounded-lg">
                                  <span className="text-[10px] font-bold text-navy uppercase block mb-2 tracking-wide">Placement Stat 1</span>
                                  <TextInput
                                    label="Value"
                                    placeholder="e.g. 40%"
                                    value={formData.placement_stat_1_value}
                                    onChange={(val) => handleFieldChange('placement_stat_1_value', val)}
                                  />
                                  <TextInput
                                    label="Label"
                                    placeholder="e.g. Salary hike"
                                    value={formData.placement_stat_1_label}
                                    onChange={(val) => handleFieldChange('placement_stat_1_label', val)}
                                  />
                                </div>
                                
                                <div className="p-3 bg-off rounded-lg">
                                  <span className="text-[10px] font-bold text-navy uppercase block mb-2 tracking-wide">Placement Stat 2</span>
                                  <TextInput
                                    label="Value"
                                    placeholder="e.g. 500+"
                                    value={formData.placement_stat_2_value}
                                    onChange={(val) => handleFieldChange('placement_stat_2_value', val)}
                                  />
                                  <TextInput
                                    label="Label"
                                    placeholder="e.g. Hiring partners"
                                    value={formData.placement_stat_2_label}
                                    onChange={(val) => handleFieldChange('placement_stat_2_label', val)}
                                  />
                                </div>

                                <div className="p-3 bg-off rounded-lg">
                                  <span className="text-[10px] font-bold text-navy uppercase block mb-2 tracking-wide">Placement Stat 3</span>
                                  <TextInput
                                    label="Value"
                                    placeholder="e.g. 6 mo"
                                    value={formData.placement_stat_3_value}
                                    onChange={(val) => handleFieldChange('placement_stat_3_value', val)}
                                  />
                                  <TextInput
                                    label="Label"
                                    placeholder="e.g. Job access duration"
                                    value={formData.placement_stat_3_label}
                                    onChange={(val) => handleFieldChange('placement_stat_3_label', val)}
                                  />
                                </div>
                              </div>
                              
                              <div id={`field-container-placement_services`}>
                                <ListBuilder
                                  label={sec.fields[6].label}
                                  placeholder={sec.fields[6].placeholder}
                                  required={sec.fields[6].required}
                                  value={formData.placement_services}
                                  onChange={(val) => handleFieldChange('placement_services', val)}
                                />
                              </div>

                              <div id={`field-container-placement_partners`}>
                                <ListBuilder
                                  label={sec.fields[7].label}
                                  placeholder={sec.fields[7].placeholder}
                                  required={sec.fields[7].required}
                                  value={formData.placement_partners}
                                  onChange={(val) => handleFieldChange('placement_partners', val)}
                                  error={showValidationErrors && currentValidation.invalidFields.placement_partners ? 'Min 3 placement partners required' : null}
                                />
                              </div>
                            </div>
                          ) : (
                            /* STANDARD FIELD RENDERER */
                            sec.fields.map(field => {
                              const isInvalid = showValidationErrors && currentValidation.invalidFields[field.key];
                              const value = formData[field.key];
                              const key = field.key;

                              return (
                                <div key={key} id={`field-container-${key}`}>
                                  {field.type === 'TEXT_INPUT' && (
                                    <TextInput
                                      label={field.label}
                                      placeholder={field.placeholder}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `${field.label} is required` : null}
                                    />
                                  )}

                                  {field.type === 'TEXTAREA' && (
                                    <TextArea
                                      label={field.label}
                                      placeholder={field.placeholder}
                                      required={field.required}
                                      rows={field.rows}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `${field.label} is required` : null}
                                    />
                                  )}

                                  {field.type === 'RICH_TEXT' && (
                                    <RichText
                                      label={field.label}
                                      placeholder={field.placeholder}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `${field.label} is required` : null}
                                    />
                                  )}

                                  {field.type === 'LIST_BUILDER' && (
                                    <ListBuilder
                                      label={field.label}
                                      placeholder={field.placeholder}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `Invalid items: check requirements` : null}
                                    />
                                  )}

                                  {field.type === 'TABLE_BUILDER' && (
                                    <TableBuilder
                                      label={field.label}
                                      columns={field.columns}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `Table requires valid records` : null}
                                    />
                                  )}

                                  {field.type === 'FAQ_BUILDER' && (
                                    <FaqBuilder
                                      label={field.label}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `Min 3 FAQs required` : null}
                                    />
                                  )}

                                  {field.type === 'REVIEW_BUILDER' && (
                                    <ReviewBuilder
                                      label={field.label}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `Min 2 reviews required` : null}
                                    />
                                  )}

                                  {field.type === 'STEP_BUILDER' && (
                                    <StepBuilder
                                      label={field.label}
                                      required={field.required}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                      error={isInvalid ? `Min 3 steps required` : null}
                                    />
                                  )}

                                  {field.type === 'BADGE_SELECTOR' && (
                                    <BadgeSelector
                                      label={field.label}
                                      options={field.options}
                                      value={value}
                                      onChange={(val) => handleFieldChange(key, val)}
                                    />
                                  )}
                                </div>
                              );
                            })
                          )}

                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </main>

            {/* COLUMN 3: RIGHT PANEL (LIVE JSON PREVIEW & ERROR CONSOLE) */}
            <aside className="w-[340px] bg-slate-900 text-white flex flex-col shrink-0 overflow-y-auto no-scrollbar shadow-inner">
              {/* Header */}
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-orange"></span>
                  Live ACF Payload
                </span>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopyJSON(acfPayload)}
                    className="p-1.5 hover:bg-slate-800 rounded text-slate-300 transition-colors"
                    title="Copy JSON to Clipboard"
                  >
                    {copiedIndicator ? (
                      <Check className="w-4 h-4 text-green-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={handleDownloadAttempt}
                    className="p-1.5 hover:bg-slate-800 rounded text-orange transition-colors"
                    title="Download JSON File"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Validation Status Panel */}
              <div className="p-4 bg-slate-800/40 border-b border-slate-800/80">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Validation Status</span>
                  {currentValidation.isValid ? (
                    <span className="text-[10px] bg-green-success/20 border border-green-success/40 px-2 py-0.5 rounded text-green-success font-bold">
                      ALL PASS
                    </span>
                  ) : (
                    <span className="text-[10px] bg-red-500/20 border border-red-500/40 px-2 py-0.5 rounded text-red-400 font-bold">
                      INCOMPLETE
                    </span>
                  )}
                </div>

                {/* Missing fields summary */}
                {!currentValidation.isValid && (
                  <div className="mt-2 text-[10px] text-red-300 space-y-1 max-h-40 overflow-y-auto">
                    <p className="font-bold text-[9px] uppercase tracking-wide text-slate-400">Missing Required Fields:</p>
                    {currentValidation.errors.map((err, i) => (
                      <div key={i} className="flex gap-1.5 items-start">
                        <CornerDownRight className="w-3 h-3 text-orange shrink-0 mt-0.5" />
                        <span className="text-slate-300">{err}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Code Pre container */}
              <div className="flex-1 p-4 overflow-auto font-mono text-xs select-text bg-[#0E1F3D]">
                <pre
                  className="whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: highlightJSON(acfPayload) }}
                />
              </div>
            </aside>

          </div>

          {/* VIEW DRAFT PREVIEW MODAL */}
          {showPreviewModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full h-[80vh] flex flex-col shadow-2xl overflow-hidden">
                <div className="p-4 bg-slate-950 border-b border-slate-850 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-white">Full JSON Payload Preview</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                      {PAGE_TYPES[activePageType]}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowPreviewModal(false)}
                    className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="flex-1 p-6 overflow-auto bg-[#0E1F3D]">
                  <pre
                    className="text-xs font-mono text-white whitespace-pre-wrap select-text"
                    dangerouslySetInnerHTML={{ __html: highlightJSON(acfPayload) }}
                  />
                </div>

                <div className="p-4 bg-slate-950 border-t border-slate-850 flex justify-between items-center">
                  <div className="text-xs text-slate-400 font-medium">
                    {progressPercent}% required fields filled
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCopyJSON(acfPayload)}
                      className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-4 py-2 rounded transition-colors"
                    >
                      {copiedIndicator ? <Check className="w-4 h-4 text-green-success" /> : <Copy className="w-4 h-4" />}
                      Copy JSON
                    </button>
                    <button
                      onClick={() => {
                        setShowPreviewModal(false);
                        handleDownloadAttempt();
                      }}
                      className="bg-orange hover:bg-orange-hover text-white text-xs font-bold px-4 py-2 rounded transition-colors"
                    >
                      Validate & Download
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VALIDATION SUCCESS MODAL */}
          {showSuccessModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl text-center border border-border">
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4 text-green-success border border-green-100">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-extrabold text-navy mb-2 uppercase">Validation Passed!</h3>
                <p className="text-sm text-muted mb-6">
                  The ACF payload structure is 100% complete and validated. You can download the JSON file and import it directly.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSuccessModal(false)}
                    className="flex-1 bg-off hover:bg-border text-navy text-xs font-bold py-3 rounded-lg border border-border transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={executeDownload}
                    className="flex-1 bg-orange hover:bg-orange-hover text-white text-xs font-bold py-3 rounded-lg shadow-md transition-colors"
                  >
                    Download JSON File
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VALIDATION ERROR MODAL */}
          {showErrorModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col border border-border max-h-[85vh]">
                <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-orange border border-red-100 mb-4 shrink-0 mx-auto">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-extrabold text-navy text-center mb-2 uppercase tracking-wide">
                  Validation Failed
                </h3>
                <p className="text-xs text-muted text-center mb-4 font-medium">
                  The following required fields must be correctly filled before download is allowed.
                </p>

                {/* Scroller error list */}
                <div className="flex-1 overflow-y-auto bg-off p-4 rounded-xl border border-border space-y-2 mb-6 max-h-[40vh]">
                  {currentValidation.errors.map((err, idx) => (
                    <div key={idx} className="flex gap-2 items-start text-xs font-semibold text-orange">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange shrink-0 mt-1.5"></span>
                      <span>{err}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={() => setShowErrorModal(false)}
                    className="flex-1 bg-navy hover:bg-navy-hover text-white text-xs font-bold py-3 rounded-lg shadow-md transition-colors"
                  >
                    Fix Missing Fields
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}

export default App;
