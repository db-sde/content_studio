import { useState, useEffect, useReducer, useRef, useCallback } from 'react';
import {
  schemas,
  PAGE_TYPES,
  SCHEMA_DETAILS,
  getInitialState,
  transformToACF,
  validateState,
  validateFactsOnly,
  calculateProgress,
  getSectionStatus,
  getIcon
} from './config/schemas';
import {
  TextInput,
  TextArea,
  RichText,
  RepeaterBuilder,
  SearchableSelect
} from './components/FieldTypes';
import { AiFieldToolbar } from './components/AiFieldToolbar';
import { InvitePanel } from './components/InvitePanel';
import { NotificationsPanel } from './components/NotificationsPanel';
import { StyleReviewPanel } from './screens/StyleReviewPanel';
import { ActivityPanel } from './screens/ActivityPanel';
import { syncFieldRecord, getPricingEstimate, getGlobalCostSummary } from './services/aiClient';
import { listDirectoryEntries } from './services/directoryClient';
import * as draftsClient from './services/draftsClient';
import * as notificationsClient from './services/notificationsClient';
import { canEditField, getLockReason } from './utils/permissions';
import { normalizeKey, parseBulkPasteLines, extractRepeaterBlocks } from './utils/pasteParsing';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { BootstrapScreen } from './screens/BootstrapScreen';
import { LoginScreen } from './screens/LoginScreen';
import { InviteAcceptScreen } from './screens/InviteAcceptScreen';
import { PasswordResetScreen } from './screens/PasswordResetScreen';
import {
  ArrowLeft, Save, Download, Eye, Copy, Trash2,
  History, Sparkles, CheckCircle, AlertCircle, X, ChevronRight,
  Check, CornerDownRight, ClipboardPaste, GraduationCap, BookOpen, Award, Pencil, Bell,
  Flame, ShieldCheck, Globe, ExternalLink, ChevronDown, LayoutGrid, FolderOpen
} from 'lucide-react';
import './App.css';

// Per-page-type icon + blurb for the home screen template cards. Purely cosmetic — deliberately
// kept out of schemas.js, which stays the single source of truth for form/data structure.
const PAGE_TYPE_META = {
  university: { icon: GraduationCap, description: 'Full institution profile — accreditations, rankings, programs, and faculty.' },
  course: { icon: BookOpen, description: 'A single degree program — fees, eligibility, syllabus, and placements.' },
  specialization: { icon: Award, description: 'A specialization track within a course, with its own fees and syllabus.' }
};

// Single source of truth for the 4-stage draft workflow's display label, used everywhere a draft's
// status is shown (the workspace header pill, the home screen's drafts table) — previously each
// call site re-derived the same label/colors via its own ternary chain, which could silently drift
// out of sync if a future edit only updated one of them.
const DRAFT_STATUS_LABELS = {
  intern_editing: 'Intern Editing',
  senior_review: 'Senior Review',
  admin_review: 'Admin Review',
  approved: 'Approved'
};

// Dark-header variant (workspace toolbar) — semi-transparent badge + a matching solid dot.
const DRAFT_STATUS_HEADER_STYLES = {
  intern_editing: { badge: 'bg-white/10 text-gray-300', dot: 'bg-gray-300' },
  senior_review: { badge: 'bg-info/15 text-info', dot: 'bg-info' },
  admin_review: { badge: 'bg-purple-review/15 text-purple-review', dot: 'bg-purple-review' },
  approved: { badge: 'bg-green-success/15 text-green-success', dot: 'bg-green-success' }
};

// Light-background variant (drafts table on the home screen) — solid-soft badge, no dot.
const DRAFT_STATUS_TABLE_STYLES = {
  intern_editing: 'bg-off text-muted',
  senior_review: 'bg-info-soft text-info',
  admin_review: 'bg-purple-review-soft text-purple-review',
  approved: 'bg-green-soft text-green-success'
};

// Which quick status-change actions an Admin can fire directly from the Saved Drafts list
// (via the status chip), keyed by the draft's *current* status — mirrors exactly what the
// server's STATUS_ACTIONS already allows an admin to do, just surfaced without opening the
// draft. senior_review has no entry: an Admin has no status-changing action available at that
// stage (only the Senior can send it onward), so the chip is a plain non-interactive badge there.
const ADMIN_STATUS_CHIP_ACTIONS = {
  intern_editing: [{ action: 'send-to-senior', label: 'Send to Senior' }],
  admin_review: [
    { action: 'approve', label: 'Approve' },
    { action: 'revert-to-senior', label: 'Revert to Senior' },
    { action: 'revert-to-intern', label: 'Revert to Intern' }
  ],
  approved: [{ action: 'reopen', label: 'Reopen' }]
};

// Groups a section's fields into alternating "grid" runs (consecutive short TEXT_INPUT fields,
// packed 2-3 per row) and "single" full-width fields (textarea/rich text/repeater) — pure
// presentation, doesn't touch the schema or field order.
const groupFieldsForLayout = (fields) => {
  const groups = [];
  let run = [];
  fields.forEach(field => {
    if (field.type === 'TEXT_INPUT') {
      run.push(field);
    } else {
      if (run.length) { groups.push({ type: 'grid', fields: run }); run = []; }
      groups.push({ type: 'single', fields: [field] });
    }
  });
  if (run.length) groups.push({ type: 'grid', fields: run });
  return groups;
};

// Resolves the option list for a SEARCHABLE_SELECT field. University options are plain strings;
// course options carry their own university name (see the directory-fetch effect below) so a
// field declaring `scopedByFieldKey` (the specialization schema's Linked Course, scoped to its
// own Linked University) narrows to just that university's courses — falling back to the full
// unfiltered list whenever nothing's selected yet or nothing matches, so the dropdown never goes
// silently empty just because the sibling field hasn't been picked (or was typed as "Other").
const getSearchableSelectOptions = (field, formData, directoryOptions) => {
  const entries = directoryOptions[field.directoryPageType] || [];
  if (!field.scopedByFieldKey) return entries;

  const scopeValue = formData[field.scopedByFieldKey];
  const scoped = scopeValue ? entries.filter(e => e.universityName === scopeValue) : [];
  return (scoped.length ? scoped : entries).map(e => e.value);
};

// Action Types for Reducer
const ACTIONS = {
  START_FORM: 'START_FORM',
  UPDATE_FIELD: 'UPDATE_FIELD',
  LOAD_DRAFT: 'LOAD_DRAFT',
  RESET: 'RESET',
  SYNC_DRAFT_ID: 'SYNC_DRAFT_ID',
  MERGE_FIELDS: 'MERGE_FIELDS',
  SET_DRAFT_STATUS: 'SET_DRAFT_STATUS',
  SET_ALLOW_INTERN_AI_EDIT: 'SET_ALLOW_INTERN_AI_EDIT',
  BULK_UPDATE_FIELDS: 'BULK_UPDATE_FIELDS',
  SET_WORDPRESS_URL: 'SET_WORDPRESS_URL'
};

// State Reducer
function formReducer(state, action) {
  switch (action.type) {
    case ACTIONS.START_FORM:
      return {
        activePageType: action.payload.pageType,
        activeDraftId: action.payload.draftId,
        formData: action.payload.initialState,
        status: 'intern_editing',
        allowInternAiEdit: false,
        prioritizedAt: null,
        wordpressUrl: null
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
        formData: action.payload.state,
        status: action.payload.status,
        allowInternAiEdit: action.payload.allowInternAiEdit,
        prioritizedAt: action.payload.prioritizedAt ?? null,
        wordpressUrl: action.payload.wordpressUrl ?? null
      };
    case ACTIONS.SYNC_DRAFT_ID:
      return {
        ...state,
        activeDraftId: action.payload.draftId
      };
    case ACTIONS.MERGE_FIELDS:
      return {
        ...state,
        formData: { ...state.formData, ...action.payload.formData },
        status: action.payload.status
      };
    case ACTIONS.SET_DRAFT_STATUS:
      return {
        ...state,
        status: action.payload.status,
        prioritizedAt: action.payload.prioritizedAt !== undefined ? action.payload.prioritizedAt : state.prioritizedAt
      };
    case ACTIONS.SET_ALLOW_INTERN_AI_EDIT:
      return {
        ...state,
        allowInternAiEdit: action.payload.allow
      };
    case ACTIONS.BULK_UPDATE_FIELDS:
      return {
        ...state,
        formData: { ...state.formData, ...action.payload.fields }
      };
    case ACTIONS.SET_WORDPRESS_URL:
      return {
        ...state,
        wordpressUrl: action.payload.wordpressUrl
      };
    case ACTIONS.RESET:
      return {
        activePageType: null,
        activeDraftId: null,
        formData: {},
        status: null,
        allowInternAiEdit: false,
        prioritizedAt: null,
        wordpressUrl: null
      };
    default:
      return state;
  }
}

function ContentStudioApp() {
  const { currentUser, logout } = useAuth();
  const toast = useToast();
  const [state, dispatch] = useReducer(formReducer, {
    activePageType: null,
    activeDraftId: null,
    formData: {},
    status: null,
    allowInternAiEdit: false,
    prioritizedAt: null,
    wordpressUrl: null
  });

  const { activePageType, activeDraftId, formData, status: draftStatus, allowInternAiEdit, prioritizedAt, wordpressUrl } = state;
  const isPrioritized = !!prioritizedAt;

  // Local UI States
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showStyleReview, setShowStyleReview] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Home is now two tabs instead of one cluttered scroll: 'create' (hero + templates) and
  // 'drafts' (the saved-drafts table, with all its status/priority/live badges) — splitting them
  // is what actually fixes the "too much on one page" complaint, not just re-styling the same pile.
  const [homeTab, setHomeTab] = useState('create');
  // Fixed at a size that comfortably clears the compact bell+avatar cluster in the top-right
  // corner — that cluster no longer grows with the signed-in user's name/role (it's just an
  // avatar + chevron now), so this no longer needs to be measured live like the old wide pill did.
  const userBadgeClearance = 120;
  const [drafts, setDrafts] = useState([]);
  const [expandedSections, setExpandedSections] = useState({});
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [isExportingFullData, setIsExportingFullData] = useState(false);
  const [pricingEstimate, setPricingEstimate] = useState(null);
  const [costSummary, setCostSummary] = useState(null);
  // Option lists for SEARCHABLE_SELECT fields, keyed by directoryPageType ('university'/'course').
  const [directoryOptions, setDirectoryOptions] = useState({});
  const [showJsonEditMode, setShowJsonEditMode] = useState(false);
  const [jsonEditText, setJsonEditText] = useState('');
  const [jsonEditError, setJsonEditError] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  // Generic in-app replacement for window.confirm() — { title, message, confirmLabel, danger, onConfirm }.
  // A blocking native confirm() is exactly the kind of interaction this app's toast system was
  // built to get away from; a destructive/irreversible choice still needs an explicit two-button
  // decision (a toast alone would be wrong here), just rendered as our own modal instead.
  const [confirmModal, setConfirmModal] = useState(null);
  const [saveIndicator, setSaveIndicator] = useState(null); // 'saving' | 'saved' | null
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [copiedIndicator, setCopiedIndicator] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [latestDraft, setLatestDraft] = useState(null);
  // Admin-only bulk selection on the Saved Drafts list — lets a trusting Admin mass-approve or
  // mass-publish several drafts at once instead of opening each one individually.
  const [selectedDraftIds, setSelectedDraftIds] = useState(new Set());
  const [isBulkActing, setIsBulkActing] = useState(false);
  // Which single draft's status chip dropdown is open (only one at a time) — the status badge
  // itself becomes the quick-action control for an Admin, rather than a separate button.
  const [statusChipOpenFor, setStatusChipOpenFor] = useState(null);
  const [showBulkPasteModal, setShowBulkPasteModal] = useState(false);
  const [bulkPasteResult, setBulkPasteResult] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTogglingAllowAiEdit, setIsTogglingAllowAiEdit] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLastReadAt, setNotificationsLastReadAt] = useState(null);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [globalCostSummary, setGlobalCostSummary] = useState(null);
  // Shared by every status-transition action that can carry an optional note (send-to-senior,
  // send-to-admin, revert-to-intern, revert-to-senior) — one modal instead of four near-identical
  // ones, keyed by the exact action string the backend's STATUS_ACTIONS map expects.
  const [noteModal, setNoteModal] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  const autoSaveIntervalRef = useRef(null);
  const mainRef = useRef(null);
  // Mirrors the latest formData without being a dependency of the autosave-interval effect below
  // — if that effect depended on formData directly, the interval would be torn down and recreated
  // on every keystroke (every field edit produces a new formData object), so it would never
  // actually reach 30 seconds while the user keeps typing continuously. Reading through this ref
  // instead lets the interval survive edits and genuinely fire every 30s.
  const formDataRef = useRef(formData);
  useEffect(() => {
    formDataRef.current = formData;
  });

  // Mirrors activePageType so refreshDraftsList (below) can be a stable useCallback with no
  // dependencies — it only needs the *current* value to decide whether to surface the "continue
  // your draft" banner, not to re-run the mount-once polling effect every time the user opens or
  // closes a draft.
  const activePageTypeRef = useRef(activePageType);
  useEffect(() => {
    activePageTypeRef.current = activePageType;
  });

  const refreshNotifications = useCallback(async () => {
    try {
      const { notifications: list, lastReadAt } = await notificationsClient.listNotifications();
      setNotifications(list);
      setNotificationsLastReadAt(lastReadAt);
    } catch (e) {
      console.error('Error loading notifications', e);
    }
  }, []);

  const refreshGlobalCostSummary = useCallback(async () => {
    try {
      setGlobalCostSummary(await getGlobalCostSummary());
    } catch (e) {
      console.error('Error loading global cost summary', e);
    }
  }, []);

  // Refreshes the home screen's draft list from the server — the DB row is the canonical source
  // of truth now (an Intern and a Senior on different logins need to see the same shared draft),
  // so this replaces the old direct localStorage read. Reads activePageType through a ref (see
  // activePageTypeRef above) rather than closing over it directly, so this can stay a stable,
  // dependency-free useCallback instead of one that's recreated — and re-triggers the mount-once
  // polling effect below — every time the user opens or closes a draft.
  const refreshDraftsList = useCallback(async () => {
    try {
      const { drafts: list } = await draftsClient.listDrafts();
      setDrafts(list);

      // Admin sees every draft across every Intern/Senior, so "your unfinished draft" never
      // actually means the Admin's own work — the resume-prompt only makes sense for the two
      // roles that actually originate and edit drafts themselves.
      if (list.length > 0 && !activePageTypeRef.current && currentUser?.role !== 'admin') {
        setLatestDraft(list[0]);
        setShowBanner(true);
      }
    } catch (e) {
      console.error('Error loading drafts', e);
    }
  }, [currentUser?.role]);

  // Neither role can otherwise tell the other has acted (new draft submitted, sent back with
  // notes, cost accrued) without this app telling them — so the home-screen list, the
  // notification feed, and the global cost figure are polled continuously rather than only
  // refreshed after the current user's own actions. 12s is frequent enough to feel live without
  // hammering the server; these are three cheap GETs, not anything AI-cost-incurring.
  useEffect(() => {
    const poll = () => {
      refreshDraftsList();
      refreshNotifications();
      refreshGlobalCostSummary();
    };
    poll();
    const interval = setInterval(poll, 12000);
    return () => clearInterval(interval);
  }, [refreshDraftsList, refreshNotifications, refreshGlobalCostSummary]);

  // Mirrors draftStatus for the open-draft poll below, same reasoning as formDataRef — without
  // it, the interval (set up once per activeDraftId) would forever compare against whatever
  // status was current at the moment it was created, instead of the latest.
  const draftStatusRef = useRef(draftStatus);
  useEffect(() => {
    draftStatusRef.current = draftStatus;
  });

  // Picks up the *other* role's action on the draft currently open in this browser — chiefly, a
  // Senior reverting a draft an Intern is sitting on (locked, nothing to lose) or approving one
  // while a Senior peeked at it. Deliberately only reacts to an actual status change rather than
  // merging in form_data on every tick: this browser's own in-flight edits (not yet autosaved)
  // must never be silently overwritten by a same-status poll.
  useEffect(() => {
    if (!activeDraftId) return;
    const interval = setInterval(async () => {
      try {
        const { draft } = await draftsClient.getDraft(activeDraftId);
        if (draft.status !== draftStatusRef.current) {
          dispatch({
            type: ACTIONS.LOAD_DRAFT,
            payload: {
              pageType: draft.page_type,
              draftId: draft.id,
              state: draft.form_data,
              status: draft.status,
              allowInternAiEdit: !!draft.allow_intern_ai_edit,
              prioritizedAt: draft.prioritized_at,
              wordpressUrl: draft.wordpress_url
            }
          });
          draftsClient.getCostSummary(draft.id).then(setCostSummary).catch(() => {});
        }
      } catch (e) {
        console.error('Error polling draft for remote changes', e);
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [activeDraftId]);

  const unreadNotificationCount = notifications.filter(n => !notificationsLastReadAt || n.created_at > notificationsLastReadAt).length;

  const openNotificationsPanel = () => {
    setShowNotificationsPanel(v => !v);
    if (!showNotificationsPanel && unreadNotificationCount > 0) {
      notificationsClient.markNotificationsRead().then(() => {
        // Matches the server's iso_now() shape ("YYYY-MM-DDTHH:MM:SSZ") closely enough for the
        // plain string comparison above to stay correct — toISOString() is the same format with
        // extra millisecond precision, which only ever sorts later at an identical-second tie.
        setNotificationsLastReadAt(new Date().toISOString());
      }).catch(() => {});
    }
  };

  const openDraftById = (draftId) => {
    loadDraft({ id: draftId });
  };

  // The backend's iso_now() (server/db/migrations_pg/001_init.sql) already returns a full
  // "YYYY-MM-DDTHH:MM:SSZ" string, directly parseable by `new Date(...)` with no massaging.
  const parseServerTimestamp = (isoTimestamp) => new Date(isoTimestamp);

  // Derives the same per-page-type display title the old localStorage draft objects carried
  // pre-computed, from the summary fields the server extracts out of form_data_json for the list.
  const getDraftListTitle = (draft) => {
    if (draft.page_type === PAGE_TYPES.SPECIALIZATION) return draft.spec_name || 'Untitled Specialization';
    if (draft.page_type === PAGE_TYPES.COURSE) return draft.program_name || 'Untitled Course';
    if (draft.page_type === PAGE_TYPES.UNIVERSITY) return draft.university_full_name || draft.university_name || 'Untitled University';
    return 'Untitled Page';
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
      const cName = formData.program_name || '';
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
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local expand/collapse UI state when the page type changes
        setExpandedSections(initialExpanded);
      }
      setShowValidationErrors(false);
      setSaveIndicator(null);
    }
  }, [activePageType]);

  // Static pre-generate cost estimate (no API call made) — fetched once per page type so it's
  // ready by the time the Intern's "Generate All AI Fields" button becomes actionable.
  useEffect(() => {
    if (!activePageType) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears a stale estimate from the previously active page type
      setPricingEstimate(null);
      return;
    }
    let cancelled = false;
    getPricingEstimate(activePageType)
      .then(data => { if (!cancelled) setPricingEstimate(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activePageType]);

  // Fetches the option list(s) behind every SEARCHABLE_SELECT field on the active schema (e.g. a
  // course/specialization page's Linked University, a specialization's Linked Course) — derived
  // from the schema itself rather than hardcoded per page type, so a future page/field reusing
  // this component picks up the right list automatically.
  useEffect(() => {
    const schema = activePageType && schemas[activePageType];
    if (!schema) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale options from the previously active page type
      setDirectoryOptions({});
      return;
    }
    const neededTypes = new Set();
    schema.sections.forEach(sec => sec.fields.forEach(f => {
      if (f.type === 'SEARCHABLE_SELECT' && f.directoryPageType) neededTypes.add(f.directoryPageType);
    }));
    if (!neededTypes.size) {
      setDirectoryOptions({});
      return;
    }

    let cancelled = false;
    Promise.all([...neededTypes].map(pageType =>
      listDirectoryEntries(pageType).then(data => {
        // Course entries carry their own university name (secondary_label) so a same-named
        // course at a different university reads unambiguously ("MBA in Finance — NMIMS") and so
        // the course list can be scoped to whichever university the draft's own Linked University
        // field currently names (see the scopedByFieldKey handling in renderField below).
        const entries = pageType === 'course'
          ? data.entries.map(e => ({
              value: e.secondary_label ? `${e.display_name} — ${e.secondary_label}` : e.display_name,
              universityName: e.secondary_label || null
            }))
          : data.entries.map(e => e.display_name);
        return [pageType, entries];
      })
    )).then(pairs => {
      if (!cancelled) setDirectoryOptions(Object.fromEntries(pairs));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activePageType]);

  // Scroll-spy: highlights whichever section is currently in view in the sidebar nav
  useEffect(() => {
    if (!activePageType) return;
    const schema = schemas[activePageType];
    if (!schema) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveSectionId(visible[0].target.id.replace('section-', ''));
      },
      { root: mainRef.current, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );

    schema.sections.forEach(sec => {
      const el = document.getElementById(`section-${sec.id}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [activePageType, expandedSections]);

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
    // formData intentionally excluded — see formDataRef above. Including it here would reset
    // this interval on every keystroke, and the callback reads formDataRef.current instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageType, activeDraftId]);

  // Save draft function — hoisted function declaration for the same reason as
  // refreshDraftsList above (safely referenced by the autosave effect regardless of textual order).
  async function saveDraftToStorage(isAuto = false) {
    if (!activePageType || !activeDraftId) return;

    setSaveIndicator('saving');

    try {
      // Reads through the ref rather than the closed-over formData — the autosave interval below
      // is set up once per draft (not recreated on every keystroke), so its callback is running
      // whichever closure of this function existed at that point; formDataRef.current is always
      // current regardless of which render created that closure.
      const { skippedKeys } = await draftsClient.saveDraft(activeDraftId, formDataRef.current);
      // Should be empty in normal use (locked inputs are disabled client-side) — if the server
      // ever silently drops a locked field's change, it's worth knowing about during development.
      if (skippedKeys?.length) console.warn('[saveDraftToStorage] server skipped locked field(s):', skippedKeys);
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setSaveIndicator('saved');
      refreshDraftsList();

      // On a manual save (not the 30s autosave, to avoid API spam), give every AI-eligible field
      // that already has content but has never been AI-touched a permanent field_records row —
      // this is how purely writer-typed content still gets "source: writer" recorded per spec,
      // without any extra UI. Fields Generate/Regenerate/Accept/Reject already touched are left
      // alone (onlyIfMissing: true is a no-op if a row exists).
      if (!isAuto) {
        const schema = schemas[activePageType];
        if (schema) {
          schema.sections.forEach(sec => {
            sec.fields.forEach(field => {
              if (!field.aiAssist) return;
              const val = formDataRef.current[field.key];
              const hasValue = !!val && String(val).trim() !== '' && val !== '<p></p>';
              if (!hasValue) return;

              syncFieldRecord({
                draftId: activeDraftId,
                pageType: activePageType,
                fieldKey: field.key,
                generatedContent: null,
                approvedContent: val,
                source: 'writer',
                status: 'accepted',
                onlyIfMissing: true
              });
            });
          });
        }
      }
    } catch (e) {
      console.error('Error saving draft', e);
    }

    setTimeout(() => {
      setSaveIndicator(null);
    }, 2500);
  }

  // Collects this page type's aiAssist field metadata in the shape the backend's batch endpoint
  // expects — schemas.js stays the single source of truth, the server never duplicates it.
  const getAiAssistFieldsForGeneration = () => {
    const schema = schemas[activePageType];
    if (!schema) return [];
    const fields = [];
    schema.sections.forEach(sec => {
      sec.fields.forEach(field => {
        if (!field.aiAssist) return;
        fields.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          fieldInstructions: field.aiAssist.instructions,
          outputFormat: field.type === 'RICH_TEXT' ? 'markdown' : field.type === 'TEXT_INPUT' ? 'plain-short' : 'plain'
        });
      });
    });
    return fields;
  };

  // Real running cost total, computed server-side from this draft's actual generation/evaluation
  // rows. Refreshed after any action that spends tokens (batch generate, per-field regenerate).
  const refreshCostSummary = async () => {
    if (!activeDraftId) return;
    try {
      const data = await draftsClient.getCostSummary(activeDraftId);
      setCostSummary(data);
    } catch (e) {
      console.error('Error loading cost summary', e);
    }
  };

  // Drives both "Generate All AI Fields" (onlyEmpty: false) and the post-revert "Generate Empty
  // Fields" (onlyEmpty: true). Saves current facts to the DB first — the server's emptiness check
  // for onlyEmpty runs against the stored draft, not this browser's in-memory state.
  const handleGenerateAllFields = async (onlyEmpty) => {
    if (!activeDraftId || isGenerating) return;
    const fields = getAiAssistFieldsForGeneration();
    if (!fields.length) return;

    setIsGenerating(true);
    try {
      await draftsClient.saveDraft(activeDraftId, formData);
      const { draft, failures } = await draftsClient.generateAllFields(activeDraftId, {
        fields, facts: aiFacts, onlyEmpty
      });
      dispatch({
        type: ACTIONS.MERGE_FIELDS,
        payload: { formData: draft.form_data, status: draft.status }
      });
      refreshDraftsList();
      refreshCostSummary();
      // Successful fields are already saved — the draft stays with the Intern (server keeps
      // status at intern_editing when failures exist) so "Generate Empty Fields" can retry just
      // the ones that failed, without re-billing the fields that already succeeded.
      if (failures && failures.length) {
        toast.error(`${failures.length} field(s) failed to generate (${failures.map(f => f.fieldKey).join(', ')}). Click Generate again to retry just those.`);
      } else {
        toast.success('All AI fields generated — this draft is now with the Senior for review.');
      }
    } catch (e) {
      console.error('Error generating AI fields', e);
      toast.error(e.message || 'Failed to generate AI fields');
    } finally {
      setIsGenerating(false);
    }
  };

  // Config for each action the shared note modal (see below) can fire — action must match a key
  // in the backend's STATUS_ACTIONS map exactly.
  const NOTE_MODAL_CONFIG = {
    'send-to-senior': {
      heading: 'Send to Senior', icon: Check,
      helperText: "The Senior will see this note when they open this draft — flag anything you want them to double-check.",
      placeholder: 'e.g. Left the fee figures as given in the university brochure, please confirm...',
      submitLabel: 'Send to Senior', submittingLabel: 'Sending…',
      toastMessage: 'Sent to Senior for review.'
    },
    'send-to-admin': {
      heading: 'Send to Admin', icon: Check,
      helperText: "The Admin will see this note when they open this draft — flag anything you want them to double-check before publishing.",
      placeholder: 'e.g. Rewrote the About section per the new style guide, everything else is untouched...',
      submitLabel: 'Send to Admin', submittingLabel: 'Sending…',
      toastMessage: 'Sent to Admin for review.'
    },
    'revert-to-intern': {
      heading: 'Revert to Intern', icon: CornerDownRight,
      helperText: "The Intern will see these notes when they open this draft — describe what needs fixing so they don't have to guess.",
      placeholder: "e.g. The eligibility section is missing the work-experience requirement, and the fee figures don't match the university's page...",
      submitLabel: 'Send Back to Intern', submittingLabel: 'Sending…',
      toastMessage: 'Sent back to the Intern with your notes.'
    },
    'revert-to-senior': {
      heading: 'Revert to Senior', icon: CornerDownRight,
      helperText: 'The Senior will see these notes when they open this draft — describe what needs fixing before it comes back to you.',
      placeholder: 'e.g. Tone is off for the hero section, and the placement stats need a source citation...',
      submitLabel: 'Send Back to Senior', submittingLabel: 'Sending…',
      toastMessage: 'Sent back to the Senior with your notes.'
    }
  };

  const openNoteModal = (action) => {
    setNoteText('');
    setNoteModal(action);
  };

  const handleSubmitNoteAction = async () => {
    if (!activeDraftId || !noteModal) return;
    if ((noteModal === 'send-to-senior' || noteModal === 'send-to-admin') && !currentValidation.isValid) {
      toast.error('This draft still has required fields missing — fill them in before sending it onward.');
      return;
    }
    setIsSubmittingNote(true);
    try {
      const { draft } = await draftsClient.setDraftStatus(activeDraftId, noteModal, noteText.trim() || undefined);
      dispatch({ type: ACTIONS.SET_DRAFT_STATUS, payload: { status: draft.status, prioritizedAt: draft.prioritized_at } });
      refreshDraftsList();
      toast.success(NOTE_MODAL_CONFIG[noteModal].toastMessage);
      setNoteModal(null);
      setNoteText('');
    } catch (e) {
      console.error(`Error performing "${noteModal}"`, e);
      toast.error(e.message || 'Failed to update this draft');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const handleApproveDraft = async () => {
    if (!activeDraftId) return;
    if (!currentValidation.isValid) {
      toast.error('This draft still has required fields missing — it cannot be approved yet.');
      return;
    }
    try {
      const { draft } = await draftsClient.approveDraft(activeDraftId);
      dispatch({ type: ACTIONS.SET_DRAFT_STATUS, payload: { status: draft.status, prioritizedAt: draft.prioritized_at } });
      refreshDraftsList();
      toast.success('Draft approved.');
    } catch (e) {
      console.error('Error approving draft', e);
      toast.error(e.message || 'Failed to approve draft');
    }
  };

  const handleReopenDraft = async () => {
    if (!activeDraftId) return;
    try {
      const { draft } = await draftsClient.reopenDraft(activeDraftId);
      dispatch({ type: ACTIONS.SET_DRAFT_STATUS, payload: { status: draft.status, prioritizedAt: draft.prioritized_at } });
      refreshDraftsList();
      toast.info('Reopened for corrections.');
    } catch (e) {
      console.error('Error reopening draft', e);
      toast.error(e.message || 'Failed to reopen draft');
    }
  };

  const handlePublishToWordPress = async () => {
    if (!activeDraftId || isPublishing) return;
    setIsPublishing(true);
    try {
      const { draft } = await draftsClient.publishToWordPress(activeDraftId);
      dispatch({ type: ACTIONS.SET_WORDPRESS_URL, payload: { wordpressUrl: draft.wordpress_url } });
      refreshDraftsList();
      toast.success('Published to WordPress — live now.');
    } catch (e) {
      console.error('Error publishing to WordPress', e);
      toast.error(e.message || 'Failed to publish to WordPress');
    } finally {
      setIsPublishing(false);
    }
  };

  // Fires any status-changing action straight from the Saved Drafts list's status chip, no need
  // to open the draft first — the server still enforces the exact same STATUS_ACTIONS rules
  // (role/from-status eligibility, complete-fields-required for approve) as the in-draft buttons,
  // so this can't do anything the full flow wouldn't have allowed anyway.
  const handleQuickStatusAction = async (draftId, action, e) => {
    e.stopPropagation();
    setStatusChipOpenFor(null);
    try {
      await draftsClient.setDraftStatus(draftId, action);
      toast.success('Status updated.');
      refreshDraftsList();
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  // Closes whichever status chip dropdown is open on any click outside it — only attached while
  // one is actually open, same pattern as SearchableSelect's own outside-click handling. Must
  // check containment (not just "any mousedown") or a mousedown on a dropdown action button would
  // close the dropdown — unmounting that button — before its own click handler ever fires.
  useEffect(() => {
    if (!statusChipOpenFor) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('[data-status-chip-root]')) setStatusChipOpenFor(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [statusChipOpenFor]);

  const toggleDraftSelected = (draftId, e) => {
    e.stopPropagation();
    setSelectedDraftIds(prev => {
      const next = new Set(prev);
      if (next.has(draftId)) next.delete(draftId); else next.add(draftId);
      return next;
    });
  };

  const toggleSelectAllDrafts = () => {
    setSelectedDraftIds(prev => (prev.size === drafts.length ? new Set() : new Set(drafts.map(d => d.id))));
  };

  // Shared by both bulk actions below — only ever calls the action on drafts whose current status
  // actually qualifies (mirrors the same requirement the single-draft button enforces), so a
  // careless "Select All" followed by "Approve Selected" can't fire off a wave of requests that
  // were only ever going to 403. Per-draft failures beyond that (e.g. WordPress unreachable) are
  // still tolerated individually rather than aborting the whole batch — same reasoning as
  // generateAllAiFields's partial-failure handling.
  const runBulkDraftAction = async (eligibleStatuses, actionFn, actionLabel) => {
    const selectedIds = [...selectedDraftIds];
    if (!selectedIds.length || isBulkActing) return;

    const eligibleIds = drafts.filter(d => selectedIds.includes(d.id) && eligibleStatuses.includes(d.status)).map(d => d.id);
    const skipped = selectedIds.length - eligibleIds.length;
    if (!eligibleIds.length) {
      toast.error(`None of the selected drafts are eligible for ${actionLabel.toLowerCase()} right now.`);
      return;
    }

    setIsBulkActing(true);
    const results = await Promise.allSettled(eligibleIds.map(id => actionFn(id)));
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    let message = `${actionLabel}: ${succeeded} succeeded`;
    if (failed) message += `, ${failed} failed`;
    if (skipped) message += `, ${skipped} skipped (not eligible)`;
    (succeeded ? toast.success : toast.error)(`${message}.`);

    setSelectedDraftIds(new Set());
    setIsBulkActing(false);
    refreshDraftsList();
  };

  const handleBulkApprove = () => runBulkDraftAction(['admin_review'], (id) => draftsClient.approveDraft(id), 'Mass approve');
  const handleBulkPublish = () => runBulkDraftAction(['approved'], (id) => draftsClient.publishToWordPress(id), 'Mass publish');

  const handleToggleAllowInternAiEdit = async () => {
    if (!activeDraftId || isTogglingAllowAiEdit) return;
    setIsTogglingAllowAiEdit(true);
    try {
      const { draft } = await draftsClient.setAllowInternAiEdit(activeDraftId, !allowInternAiEdit);
      dispatch({ type: ACTIONS.SET_ALLOW_INTERN_AI_EDIT, payload: { allow: !!draft.allow_intern_ai_edit } });
    } catch (e) {
      console.error('Error toggling allow_intern_ai_edit', e);
      toast.error(e.message || 'Failed to update setting');
    } finally {
      setIsTogglingAllowAiEdit(false);
    }
  };

  const startNewForm = async (pageType) => {
    try {
      const { draft } = await draftsClient.createDraft(pageType);
      const initial = getInitialState(pageType);
      dispatch({
        type: ACTIONS.START_FORM,
        payload: { pageType, draftId: draft.id, initialState: initial }
      });
      setShowBanner(false);
    } catch (e) {
      console.error('Error creating draft', e);
    }
  };

  const loadDraft = async (draftSummary) => {
    try {
      const { draft } = await draftsClient.getDraft(draftSummary.id);
      dispatch({
        type: ACTIONS.LOAD_DRAFT,
        payload: {
          pageType: draft.page_type,
          draftId: draft.id,
          state: draft.form_data,
          status: draft.status,
          allowInternAiEdit: !!draft.allow_intern_ai_edit,
          prioritizedAt: draft.prioritized_at,
          wordpressUrl: draft.wordpress_url
        }
      });
      setShowBanner(false);
      draftsClient.getCostSummary(draft.id).then(setCostSummary).catch(() => {});
    } catch (e) {
      console.error('Error loading draft', e);
    }
  };

  const deleteDraft = async (draftId, e) => {
    e.stopPropagation();
    try {
      await draftsClient.deleteDraft(draftId);
      const filtered = drafts.filter(d => d.id !== draftId);
      setDrafts(filtered);
      if (latestDraft && latestDraft.id === draftId) {
        setLatestDraft(filtered[0] || null);
        if (filtered.length === 0) {
          setShowBanner(false);
        }
      }
    } catch (e) {
      console.error('Error deleting draft', e);
    }
  };

  const resetToHome = () => {
    setConfirmModal({
      title: 'Go back to home?',
      message: 'Unsaved changes in the last few seconds might be lost.',
      confirmLabel: 'Go Back',
      onConfirm: () => {
        if (autoSaveIntervalRef.current) {
          clearInterval(autoSaveIntervalRef.current);
        }
        dispatch({ type: ACTIONS.RESET });
        refreshDraftsList();
      }
    });
  };

  const clearAllDrafts = async () => {
    setConfirmModal({
      title: 'Delete all saved drafts?',
      message: 'This action is permanent and cannot be undone.',
      confirmLabel: 'Delete All',
      danger: true,
      onConfirm: async () => {
        try {
          await Promise.all(drafts.map(d => draftsClient.deleteDraft(d.id)));
          setDrafts([]);
          setLatestDraft(null);
          setShowBanner(false);
        } catch (e) {
          console.error('Error clearing drafts', e);
          toast.error(e.message || 'Failed to delete all drafts');
        }
      }
    });
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

  // Escapes text before it's ever inserted into the dangerouslySetInnerHTML preview below —
  // field values (including AI-generated content) can legitimately contain "<"/">"/"&", and
  // without this they'd render as raw HTML in the preview pane instead of literal text.
  const escapeHtml = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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
        return `<span class="${cls}">${escapeHtml(match)}</span>`;
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

  // Maps every parsed [key, value] pair onto the matching field in the active schema (by field
  // key or label) and fills it in directly — mirrors Vercel's "paste the whole .env at once" flow.
  // Repeater-shaped tables (a "Fee Plans" header line followed by rows) are pulled out first via
  // extractRepeaterBlocks and routed to the matching repeater, appended to whatever rows already
  // exist — everything left over goes through the normal flat key:value line parser as before.
  const applyBulkPaste = (text) => {
    const schema = schemas[activePageType];
    if (!schema) return;

    const flatFields = [];
    const repeaterFields = [];
    schema.sections.forEach(sec => {
      sec.fields.forEach(f => (f.type === 'REPEATER' ? repeaterFields : flatFields).push(f));
    });

    const fieldsByKey = {};
    const fieldsByLabel = {};
    flatFields.forEach(f => {
      fieldsByKey[f.key] = f;
      fieldsByLabel[normalizeKey(f.label)] = f;
    });

    const matchedLabels = [];
    const lockedLabels = [];
    const unmatched = [];

    const { blocks: repeaterBlocks, remainingText } = extractRepeaterBlocks(text, repeaterFields);

    repeaterBlocks.forEach(({ repeaterField, rows }) => {
      if (!canEditField(repeaterField, { role: currentUser.role, draftStatus, allowInternAiEdit })) {
        lockedLabels.push(repeaterField.label);
        return;
      }
      const existingRows = formData[repeaterField.key] || [];
      handleFieldChange(repeaterField.key, [...existingRows, ...rows]);
      matchedLabels.push(`${repeaterField.label} (${rows.length} row${rows.length === 1 ? '' : 's'})`);
    });

    parseBulkPasteLines(remainingText).forEach(([rawKey, rawValue]) => {
      const normalized = normalizeKey(rawKey);
      const field = fieldsByKey[normalized] || fieldsByLabel[normalized];
      if (!field) {
        unmatched.push(rawKey);
        return;
      }

      // Mirrors the JSON edit-mode's canEditField filtering (Phase 6) — pasting text was the one
      // remaining path that could set a locked field's value straight through the disabled input.
      if (!canEditField(field, { role: currentUser.role, draftStatus, allowInternAiEdit })) {
        lockedLabels.push(field.label);
        return;
      }

      const value = field.type === 'RICH_TEXT'
        ? `<p>${rawValue.split(/\n+/).map(s => s.trim()).filter(Boolean).join('</p><p>')}</p>`
        : rawValue;

      handleFieldChange(field.key, value);
      matchedLabels.push(field.label);
    });

    setBulkPasteResult({ matchedCount: matchedLabels.length, matchedLabels, lockedLabels, unmatched });
  };

  const handleBulkPasteEvent = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    applyBulkPaste(text);
  };

  const openJsonEditMode = () => {
    setJsonEditText(JSON.stringify(acfPayload, null, 2));
    setJsonEditError(null);
    setShowJsonEditMode(true);
  };

  const cancelJsonEditMode = () => {
    setShowJsonEditMode(false);
    setJsonEditError(null);
  };

  // Parses the hand-edited JSON and merges it back onto formData. transformToACF is key-identical
  // to formData (no renaming/reshaping), so a direct key-for-key reverse-merge is safe. Every key
  // is filtered through canEditField first so a locked-out user's paste can't smuggle in changes
  // to fields they aren't allowed to touch — matches the same rule the per-field renderer enforces.
  const applyJsonChanges = () => {
    let parsed;
    try {
      parsed = JSON.parse(jsonEditText);
    } catch (e) {
      setJsonEditError(`Invalid JSON: ${e.message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setJsonEditError('Invalid JSON: expected an object');
      return;
    }

    const schema = schemas[activePageType];
    if (!schema) return;

    const fieldsByKey = {};
    schema.sections.forEach(sec => sec.fields.forEach(f => { fieldsByKey[f.key] = f; }));

    const allowed = {};
    const skipped = [];
    Object.keys(parsed).forEach(key => {
      const field = fieldsByKey[key];
      if (!field) return;
      const canEdit = canEditField(field, { role: currentUser.role, draftStatus, allowInternAiEdit });
      if (canEdit) {
        allowed[key] = parsed[key];
      } else {
        skipped.push(field.label);
      }
    });

    dispatch({ type: ACTIONS.BULK_UPDATE_FIELDS, payload: { fields: allowed } });
    setJsonEditError(null);
    setShowJsonEditMode(false);
    if (skipped.length) {
      toast.error(`Applied changes. Skipped locked field(s): ${skipped.join(', ')}`);
    } else {
      toast.success('Changes applied.');
    }
  };

  const handleDownloadAttempt = () => {
    const result = currentValidation;
    if (!result.isValid) {
      setShowValidationErrors(true);
      toast.error(`${result.errors.length} required field(s) are missing — check the highlighted fields below.`);

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
        ? (formData.program_name || 'course').trim().toLowerCase().replace(/\s+/g, '_')
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

  // PLACEHOLDER export — the exact "Complete Data" file format is an open product decision the
  // plan explicitly defers; this ships a fuller JSON dump (draft + every generation/evaluation/
  // field-record row for it) via the backend's /full-export route until that format is confirmed.
  const handleDownloadFullExport = async () => {
    if (!activeDraftId || isExportingFullData) return;
    setIsExportingFullData(true);
    try {
      const data = await draftsClient.getFullExport(activeDraftId);
      const uName = (formData.university_name || 'university').trim().toLowerCase().replace(/\s+/g, '_');
      const cleanFilename = `${uName}_complete_data.json`.replace(/[^a-zA-Z0-9_.-]/g, '');

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = cleanFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exporting complete data', e);
    } finally {
      setIsExportingFullData(false);
    }
  };

  // Active schema variables
  const activeSchema = activePageType ? schemas[activePageType] : null;
  // Excludes fields the current viewer can't act on right now (e.g. an Intern's locked AI fields)
  // from both the top progress bar and the sidebar dots below — otherwise "100%"/"complete" never
  // arrives for an Intern who has genuinely finished everything that's theirs to fill in.
  const isFieldRelevantToViewer = (field) => canEditField(field, { role: currentUser.role, draftStatus, allowInternAiEdit });
  const progressPercent = activePageType ? calculateProgress(formData, activePageType, isFieldRelevantToViewer) : 0;
  const acfPayload = activePageType ? transformToACF(formData, activePageType) : null;
  const currentValidation = activePageType ? validateState(formData, activePageType) : { isValid: true, errors: [], invalidFields: {} };
  // Gates "Generate All AI Fields" — must ignore aiAssist fields (they're required but start
  // blank until generated), unlike currentValidation above which gates the final Download flow.
  const factsValidation = activePageType ? validateFactsOnly(formData, activePageType) : { isValid: true, errors: [], invalidFields: {} };

  // Structured facts handed to the AI: every non-aiAssist field's current value. Never includes
  // other AI-editorial fields, so generation can't be contaminated by a sibling field's draft.
  // Excludes faqs/reviews specifically: they're independent, editor-authored content blocks, not
  // grounding facts about the entity, and no aiAssist instruction ever references them — including
  // them just inflates every Claude/GPT call's input tokens for zero benefit.
  const AI_FACTS_EXCLUDED_KEYS = new Set(['faqs', 'reviews']);
  const aiFacts = {};
  if (activeSchema) {
    activeSchema.sections.forEach(sec => {
      sec.fields.forEach(f => {
        if (!f.aiAssist && !AI_FACTS_EXCLUDED_KEYS.has(f.key)) aiFacts[f.key] = formData[f.key];
      });
    });
  }

  const aiOutputFormat = (field) =>
    field.type === 'RICH_TEXT' ? 'markdown' : field.type === 'TEXT_INPUT' ? 'plain-short' : 'plain';

  // Distinguishes the Intern's very first pass (no aiAssist field has content yet — show
  // "Generate All AI Fields") from a post-revert pass (some aiAssist content already exists,
  // preserved by the Senior's revert — show "Send to Senior" / "Generate Empty Fields" instead).
  const hasAnyAiContent = !!(activeSchema && activeSchema.sections.some(sec =>
    sec.fields.some(f => {
      if (!f.aiAssist) return false;
      const val = formData[f.key];
      return !!val && String(val).trim() !== '' && val !== '<p></p>';
    })
  ));

  // Surfaces whoever-handed-off-this-draft's note inline on the form itself (not just in the
  // notifications panel) — this is exactly the moment the current holder needs that context.
  // Covers both directions: an Admin/Senior bouncing a draft backward with corrections, and an
  // Intern/Senior passing a draft forward with a note about what they did. `notifications` is
  // already sorted newest-first so `.find` gives the latest relevant one for this draft.
  const INLINE_NOTE_TYPES_BY_STATUS = {
    intern_editing: ['reverted_to_intern'],
    senior_review: ['reverted_to_senior', 'sent_to_senior'],
    admin_review: ['sent_to_admin']
  };
  const latestRevertNote = activeDraftId
    ? notifications.find(n => n.draft_id === activeDraftId && n.message
        && (INLINE_NOTE_TYPES_BY_STATUS[draftStatus] || []).includes(n.type))
    : null;

  return (
    <div className="min-h-screen bg-off flex flex-col antialiased">

      {/* Compact top-right cluster — bell + a single avatar menu, floats over both the home screen
          and form workspace. Replaces a wide pill of five always-visible text links (Notifications,
          Style Review, Activity, Invite, Log out) with one small trigger, since that pill was the
          single biggest source of visual clutter in the header. */}
      <div className="fixed top-3 right-4 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={openNotificationsPanel}
          className="relative p-2 rounded-full bg-white border border-border shadow-premium text-muted hover:text-navy transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadNotificationCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger border border-white"></span>
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserMenu(v => !v)}
            className="flex items-center gap-1 bg-white border border-border rounded-full pl-1 pr-1.5 py-1 shadow-premium hover:border-border-strong transition-colors"
            title={currentUser?.name}
          >
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
              currentUser?.role === 'admin' ? 'bg-purple-review text-white' :
              currentUser?.role === 'senior' ? 'bg-navy text-white' : 'bg-orange-soft text-orange'
            }`}>
              {currentUser?.role === 'admin' ? <ShieldCheck className="w-3 h-3" /> : currentUser?.name?.charAt(0).toUpperCase()}
            </span>
            <ChevronDown className="w-3 h-3 text-muted" />
          </button>

          {showUserMenu && (
            <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-border rounded-xl shadow-premium-hover text-sm z-50 overflow-hidden py-1.5">
              <div className="px-3.5 py-2 border-b border-border mb-1">
                <p className="font-semibold text-navy text-xs truncate">{currentUser?.name}</p>
                <p className="text-[10px] text-muted uppercase tracking-wide font-medium mt-0.5">
                  {currentUser?.role === 'admin' ? 'Admin' : currentUser?.role === 'senior' ? 'Senior Content Writer' : 'Intern'}
                </p>
              </div>
              {(currentUser?.role === 'senior' || currentUser?.role === 'admin') && (
                <button
                  type="button"
                  onClick={() => { setShowStyleReview(true); setShowUserMenu(false); }}
                  className="w-full text-left px-3.5 py-2 text-navy hover:bg-off transition-colors"
                >
                  Style Review
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowActivity(true); setShowUserMenu(false); }}
                className="w-full text-left px-3.5 py-2 text-navy hover:bg-off transition-colors"
              >
                Activity
              </button>
              <button
                type="button"
                onClick={() => { setShowInvitePanel(true); setShowUserMenu(false); }}
                className="w-full text-left px-3.5 py-2 text-navy hover:bg-off transition-colors"
              >
                Invite
              </button>
              <div className="border-t border-border my-1"></div>
              <button
                type="button"
                onClick={logout}
                className="w-full text-left px-3.5 py-2 text-danger hover:bg-danger-soft transition-colors"
              >
                Log out
              </button>
            </div>
          )}
        </div>

        {showInvitePanel && (
          <InvitePanel role={currentUser?.role} onClose={() => setShowInvitePanel(false)} />
        )}
        {showNotificationsPanel && (
          <NotificationsPanel notifications={notifications} onClose={() => setShowNotificationsPanel(false)} onOpenDraft={openDraftById} />
        )}
      </div>

      {showStyleReview && (
        <StyleReviewPanel onClose={() => setShowStyleReview(false)} />
      )}

      {showActivity && (
        <ActivityPanel onClose={() => setShowActivity(false)} onOpenDraft={openDraftById} />
      )}

      {/* CONFIRM MODAL — in-app replacement for window.confirm(), top-level so it's reachable from
          both the home screen (Clear All) and the form workspace (Back to Home). */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-border">
            <h3 className="text-lg font-extrabold text-navy mb-2 uppercase tracking-wide">{confirmModal.title}</h3>
            <p className="text-sm text-muted mb-6">{confirmModal.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 bg-off hover:bg-border text-navy text-xs font-bold py-3 rounded-lg border border-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
                className={`flex-1 text-white text-xs font-bold py-3 rounded-lg shadow-md transition-colors ${
                  confirmModal.danger ? 'bg-danger hover:bg-danger-hover' : 'bg-orange hover:bg-orange-hover'
                }`}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. AUTO-SAVE BANNER ON HOME SCREEN */}
      {/* Reserves space for the fixed user badge (top-3 right-4) using its measured width, so it
          never sits on top of and blocks clicks on "Continue Editing"/"Dismiss". */}
      {showBanner && latestDraft && !activePageType && (
        <div
          className="bg-navy text-white border-b border-orange/30 pl-6 py-3.5 flex flex-wrap justify-between items-center gap-y-2 shadow-lg transition-all duration-300"
          style={{ paddingRight: userBadgeClearance }}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange"></span>
            </span>
            <div className="text-sm">
              <span className="font-semibold text-orange-hover">Auto-Saved Draft Found:</span> We found your unfinished draft for{' '}
              <strong className="text-white font-semibold">{latestDraft.university_name}</strong> ({SCHEMA_DETAILS[latestDraft.page_type]?.title || latestDraft.page_type}) edited on {parseServerTimestamp(latestDraft.updated_at).toLocaleDateString()} at {parseServerTimestamp(latestDraft.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}.
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

      {/* RENDER HOME SCREEN — two tabs instead of one long scroll: Create (hero + templates) and
          Drafts (the saved-drafts table). Splitting these is the actual fix for "too much on one
          page" — the old layout stacked marketing-style hero content directly on top of a dense
          data table, which is what read as cluttered. */}
      {!activePageType ? (
        <div className="flex-1 w-full">
          <div className="bg-white border-b border-border px-6" style={{ paddingRight: userBadgeClearance }}>
            <div className="max-w-6xl w-full mx-auto flex items-center gap-1 h-14">
              <button
                type="button"
                onClick={() => setHomeTab('create')}
                className={`flex items-center gap-1.5 h-full px-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${
                  homeTab === 'create' ? 'text-orange border-orange' : 'text-muted border-transparent hover:text-navy'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Create
              </button>
              <button
                type="button"
                onClick={() => setHomeTab('drafts')}
                className={`flex items-center gap-1.5 h-full px-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${
                  homeTab === 'drafts' ? 'text-orange border-orange' : 'text-muted border-transparent hover:text-navy'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Drafts
                {drafts.length > 0 && (
                  <span className="bg-navy-soft text-navy text-[10px] font-bold px-1.5 py-0.5 rounded-full">{drafts.length}</span>
                )}
              </button>
            </div>
          </div>

          {homeTab === 'create' ? (
            <div className="relative">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-navy/[0.05] via-orange/[0.025] to-transparent -z-10" />

              <div className="max-w-6xl w-full mx-auto px-6 pt-14 pb-20">

                {/* Brand/Hero Section */}
                <div className="text-center mb-14">
                  <div className="relative inline-flex items-center justify-center mb-5">
                    <div className="absolute inset-0 bg-orange/20 blur-2xl rounded-full scale-150"></div>
                    <div className="relative inline-flex items-center justify-center p-3.5 bg-navy text-white rounded-2xl shadow-premium">
                      <Sparkles className="w-8 h-8 text-orange" />
                    </div>
                  </div>
                  <h1 className="text-4xl font-extrabold text-navy tracking-tight mb-3 uppercase">
                    DegreeBaba <span className="text-orange">Content Studio</span>
                  </h1>
                  <p className="text-muted text-sm font-medium max-w-md mx-auto leading-relaxed">
                    WordPress ACF-compliant payload generator for internal content writers. Speed up university catalog deployment.
                  </p>
                  {globalCostSummary && globalCostSummary.generateCalls > 0 && (
                    <div className="inline-flex items-center gap-2 mt-4 px-3.5 py-1.5 rounded-full bg-navy-soft text-navy text-xs font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-orange" />
                      Total AI cost so far: <span className="font-extrabold">₹{globalCostSummary.totalInr.toFixed(2)}</span>
                      across {globalCostSummary.draftsTouched} draft{globalCostSummary.draftsTouched === 1 ? '' : 's'}
                    </div>
                  )}
                </div>

                {/* Page Type Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {Object.values(SCHEMA_DETAILS).map(type => {
                    const meta = PAGE_TYPE_META[type.id] || {};
                    const Icon = meta.icon || GraduationCap;
                    return (
                      <button
                        key={type.id}
                        onClick={() => startNewForm(type.id)}
                        className="group relative flex flex-col text-left p-6 rounded-2xl bg-white border border-border hover:border-orange/40 transition-all duration-300 shadow-premium hover:shadow-premium-hover hover:-translate-y-0.5 cursor-pointer overflow-hidden"
                      >
                        {/* Visual hover top bar accent */}
                        <div className="absolute top-0 left-0 w-full h-1.5 bg-navy group-hover:bg-orange transition-colors duration-300"></div>

                        <div className="w-11 h-11 rounded-xl bg-navy-soft group-hover:bg-orange-soft flex items-center justify-center mb-4 transition-colors duration-300">
                          <Icon className="w-5 h-5 text-navy group-hover:text-orange transition-colors duration-300" />
                        </div>

                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Create New Template</span>
                        <h3 className="text-lg font-extrabold text-navy group-hover:text-orange transition-colors mb-1.5 uppercase">
                          {type.title}
                        </h3>
                        <p className="text-xs text-muted leading-relaxed mb-4">
                          {meta.description}
                        </p>

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
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-6xl w-full mx-auto px-6 py-10">
              <div className="bg-white border border-border rounded-2xl p-6 shadow-premium">
                <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
                  <h2 className="text-lg font-bold text-navy flex items-center gap-2 uppercase tracking-wide">
                    <History className="w-5 h-5 text-orange" />
                    Saved Drafts
                  </h2>
                  <div className="flex items-center gap-4">
                    {currentUser.role === 'admin' && selectedDraftIds.size > 0 && (
                      <div className="flex items-center gap-2 bg-navy-soft px-3 py-1.5 rounded-lg">
                        <span className="text-xs font-bold text-navy">{selectedDraftIds.size} selected</span>
                        <button
                          onClick={handleBulkApprove}
                          disabled={isBulkActing}
                          className="text-xs bg-green-success text-white hover:brightness-110 disabled:opacity-50 font-semibold px-3 py-1 rounded transition-all"
                        >
                          Approve Selected
                        </button>
                        <button
                          onClick={handleBulkPublish}
                          disabled={isBulkActing}
                          className="text-xs bg-orange text-white hover:bg-orange-hover disabled:opacity-50 font-semibold px-3 py-1 rounded transition-all"
                        >
                          Publish Selected
                        </button>
                        <button
                          onClick={() => setSelectedDraftIds(new Set())}
                          disabled={isBulkActing}
                          className="text-xs text-muted hover:text-navy font-semibold px-1"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                    {drafts.length > 0 && (
                      <button
                        onClick={clearAllDrafts}
                        className="flex items-center gap-1.5 text-xs text-danger font-semibold hover:text-danger-hover transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {drafts.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="w-12 h-12 rounded-full bg-navy-soft flex items-center justify-center mx-auto mb-3">
                      <History className="w-5 h-5 text-navy/50" />
                    </div>
                    <p className="text-sm text-navy font-semibold">No saved drafts yet</p>
                    <button
                      onClick={() => setHomeTab('create')}
                      className="text-xs text-orange font-bold uppercase tracking-wide mt-2 hover:text-orange-hover"
                    >
                      Pick a template to start writing →
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted font-semibold uppercase tracking-wider">
                          {currentUser.role === 'admin' && (
                            <th className="py-3 px-4 w-8">
                              <input
                                type="checkbox"
                                checked={drafts.length > 0 && selectedDraftIds.size === drafts.length}
                                onChange={toggleSelectAllDrafts}
                                className="rounded border-border-strong cursor-pointer"
                                title="Select all"
                              />
                            </th>
                          )}
                          <th className="py-3 px-4">University Name</th>
                          <th className="py-3 px-4">Page Type</th>
                          <th className="py-3 px-4">Page/Spec Title</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Last Edited</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {drafts.map(draft => (
                          <tr
                            key={draft.id}
                            onClick={() => loadDraft(draft)}
                            className={`hover:bg-off cursor-pointer transition-colors group ${draft.prioritized_at ? 'bg-orange-soft/40' : ''}`}
                          >
                            {currentUser.role === 'admin' && (
                              <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedDraftIds.has(draft.id)}
                                  onChange={(e) => toggleDraftSelected(draft.id, e)}
                                  className="rounded border-border-strong cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="py-4 px-4 font-bold text-navy">
                              <span className="flex items-center gap-1.5">
                                {draft.prioritized_at && <Flame className="w-3.5 h-3.5 text-orange shrink-0" title="Bounced back — needs attention" />}
                                {draft.university_name}
                              </span>
                            </td>
                            <td className="py-4 px-4">
                              <span className="inline-block bg-navy-soft text-[10px] font-bold uppercase tracking-wider text-navy px-2 py-0.5 rounded-full">
                                {SCHEMA_DETAILS[draft.page_type]?.title || draft.page_type}
                              </span>
                            </td>
                            <td className="py-4 px-4 font-medium text-muted">{getDraftListTitle(draft)}</td>
                            <td className="py-4 px-4">
                              {currentUser.role === 'admin' ? (
                                (() => {
                                  const chipActions = ADMIN_STATUS_CHIP_ACTIONS[draft.status] || [];
                                  return (
                                    <div className="relative inline-block" data-status-chip-root onClick={(e) => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        onClick={() => chipActions.length && setStatusChipOpenFor(statusChipOpenFor === draft.id ? null : draft.id)}
                                        disabled={!chipActions.length}
                                        title={chipActions.length ? 'Change status' : 'No status action available while a Senior has this draft'}
                                        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full transition-all ${DRAFT_STATUS_TABLE_STYLES[draft.status] || DRAFT_STATUS_TABLE_STYLES.intern_editing} ${chipActions.length ? 'cursor-pointer hover:brightness-95' : 'cursor-default opacity-80'}`}
                                      >
                                        {DRAFT_STATUS_LABELS[draft.status] || DRAFT_STATUS_LABELS.intern_editing}
                                        {chipActions.length > 0 && <ChevronDown className="w-2.5 h-2.5" />}
                                      </button>
                                      {statusChipOpenFor === draft.id && chipActions.length > 0 && (
                                        <div className="absolute top-full left-0 mt-1 bg-white border border-border rounded-lg shadow-premium-hover z-20 overflow-hidden min-w-[150px]">
                                          {chipActions.map(a => (
                                            <button
                                              key={a.action}
                                              type="button"
                                              onClick={(e) => handleQuickStatusAction(draft.id, a.action, e)}
                                              className="block w-full text-left px-3 py-2 text-xs font-semibold text-navy hover:bg-off transition-colors"
                                            >
                                              {a.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()
                              ) : (
                                <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${DRAFT_STATUS_TABLE_STYLES[draft.status] || DRAFT_STATUS_TABLE_STYLES.intern_editing}`}>
                                  {DRAFT_STATUS_LABELS[draft.status] || DRAFT_STATUS_LABELS.intern_editing}
                                </span>
                              )}
                              {draft.wordpress_url && (
                                <a
                                  href={draft.wordpress_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-soft text-green-success hover:brightness-95"
                                >
                                  <Globe className="w-2.5 h-2.5" />
                                  Live
                                </a>
                              )}
                            </td>
                            <td className="py-4 px-4 text-xs text-muted">
                              {parseServerTimestamp(draft.updated_at).toLocaleDateString()} at{' '}
                              {parseServerTimestamp(draft.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                                  className="text-danger hover:text-danger-hover hover:bg-danger-soft p-1.5 rounded transition-colors"
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
          )}
        </div>
      ) : (

        /* SCREEN 2 — FORM VIEW */
        <div className="flex-1 flex flex-col">
          
          {/* Sticky Header Top Bar */}
          {/* Reserves space for the fixed user badge (top-3 right-4, z-50) using its measured
              width, so it never overlaps "Preview JSON"/"Download JSON" and eats their clicks. */}
          <header className="sticky top-0 z-30 bg-gradient-to-b from-navy to-navy-deep text-white border-b border-white/5 shadow-md px-6 py-3.5 flex flex-col gap-2">
            <div className="flex flex-wrap justify-between items-center gap-y-2" style={{ paddingRight: userBadgeClearance }}>
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
                  onClick={() => { setBulkPasteResult(null); setShowBulkPasteModal(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste Data
                </button>
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
                {draftStatus === 'approved' && (
                  <button
                    type="button"
                    onClick={handleDownloadFullExport}
                    disabled={isExportingFullData}
                    className="flex items-center gap-1.5 px-4 py-1.5 border border-white/20 hover:bg-white/10 disabled:opacity-50 font-bold text-xs rounded text-white transition-all"
                    title="Placeholder export format — exact shape TBD"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isExportingFullData ? 'Exporting…' : 'Download Complete Data as a File'}
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar Row */}
            <div className="flex items-center gap-3 mt-1.5 border-t border-white/5 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-300 w-32 shrink-0">
                Required Fields Filled:
              </span>
              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange to-orange-hover transition-all duration-500 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
              <span className="text-xs font-bold text-orange shrink-0 w-8 text-right">
                {progressPercent}%
              </span>
            </div>

            {/* Reviewer Workflow Row */}
            <div className="flex items-center justify-between gap-3 mt-1 border-t border-white/5 pt-2">
              <div className="flex items-center gap-2">
                <span className={`flex items-center gap-1.5 text-[9px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full ${(DRAFT_STATUS_HEADER_STYLES[draftStatus] || DRAFT_STATUS_HEADER_STYLES.intern_editing).badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${(DRAFT_STATUS_HEADER_STYLES[draftStatus] || DRAFT_STATUS_HEADER_STYLES.intern_editing).dot}`} />
                  {DRAFT_STATUS_LABELS[draftStatus] || DRAFT_STATUS_LABELS.intern_editing}
                </span>
                {isPrioritized && (
                  <span className="flex items-center gap-1 text-[9px] font-bold tracking-widest uppercase px-2 py-1 rounded-full bg-orange/15 text-orange">
                    <Flame className="w-2.5 h-2.5" />
                    Priority
                  </span>
                )}
                {costSummary && costSummary.generateCalls > 0 && (
                  <span className="text-[10px] text-gray-300 font-medium">
                    Cost on this page: ₹{costSummary.totalInr.toFixed(2)} across {costSummary.generateCalls} generate + {costSummary.evaluateCalls} evaluate calls
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {draftStatus === 'intern_editing' && !hasAnyAiContent && (
                  <>
                    {pricingEstimate && (
                      <span className="text-[10px] text-gray-300 font-medium">
                        Estimated cost: ~₹{pricingEstimate.estimatedInr.toFixed(2)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleGenerateAllFields(false)}
                      disabled={!factsValidation.isValid || isGenerating}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 disabled:cursor-not-allowed font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
                      title={!factsValidation.isValid ? factsValidation.errors.join('\n') : ''}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {isGenerating ? 'Generating…' : 'Generate All AI Fields'}
                    </button>
                  </>
                )}
                {/* Names exactly which non-AI facts are still incomplete — without this, a generic
                    "fill required fields" message reads as if the (locked) AI fields are blocking
                    the button, when in practice it's usually an under-filled repeater (e.g. only 1
                    of 2 required Highlights rows) that the Intern can and must still fill in. */}
                {draftStatus === 'intern_editing' && !hasAnyAiContent && !factsValidation.isValid && (
                  <span className="text-[10px] text-gray-300 font-medium max-w-xs truncate" title={factsValidation.errors.join('\n')}>
                    Missing: {factsValidation.errors.join(' · ')}
                  </span>
                )}

                {draftStatus === 'intern_editing' && hasAnyAiContent && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleGenerateAllFields(true)}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 disabled:opacity-50 font-bold text-xs rounded transition-all text-white"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {isGenerating ? 'Generating…' : 'Generate Empty Fields'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openNoteModal('send-to-senior')}
                      disabled={!currentValidation.isValid}
                      title={!currentValidation.isValid ? 'Some required fields (facts or AI-generated) are still missing' : ''}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 disabled:cursor-not-allowed font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
                    >
                      Send to Senior
                    </button>
                  </>
                )}

                {(currentUser.role === 'senior' || currentUser.role === 'admin') && (
                  <button
                    type="button"
                    onClick={handleToggleAllowInternAiEdit}
                    disabled={isTogglingAllowAiEdit}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded disabled:opacity-50 font-bold text-xs transition-all ${
                      allowInternAiEdit
                        ? 'bg-orange/20 border border-orange/40 text-orange-hover hover:bg-orange/25'
                        : 'border border-white/20 text-white hover:bg-white/10'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${allowInternAiEdit ? 'bg-orange' : 'bg-white/30'}`} />
                    {allowInternAiEdit ? 'Intern AI Edit: On' : 'Intern AI Edit: Off'}
                  </button>
                )}

                {/* Senior reviewing: bounce facts/content problems back to the Intern, or pass a
                    clean draft on to the Admin for final approval + publish. */}
                {currentUser.role === 'senior' && draftStatus === 'senior_review' && (
                  <>
                    <button
                      type="button"
                      onClick={() => openNoteModal('revert-to-intern')}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                    >
                      Revert to Intern
                    </button>
                    <button
                      type="button"
                      onClick={() => openNoteModal('send-to-admin')}
                      disabled={!currentValidation.isValid}
                      title={!currentValidation.isValid ? 'Some required fields (facts or AI-generated) are still missing' : ''}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 disabled:cursor-not-allowed font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
                    >
                      Send to Admin
                    </button>
                  </>
                )}

                {/* Admin reviewing: full control — bounce to either earlier role with notes, or
                    approve outright (WordPress publish is a separate deliberate action, not
                    bundled into approve — see the "Publish to WordPress" button once approved). */}
                {currentUser.role === 'admin' && draftStatus === 'admin_review' && (
                  <>
                    <button
                      type="button"
                      onClick={() => openNoteModal('revert-to-intern')}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                    >
                      Revert to Intern
                    </button>
                    <button
                      type="button"
                      onClick={() => openNoteModal('revert-to-senior')}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                    >
                      Revert to Senior
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveDraft}
                      disabled={!currentValidation.isValid}
                      title={!currentValidation.isValid ? 'Some required fields (facts or AI-generated) are still missing' : ''}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-green-success hover:brightness-110 disabled:bg-white/10 disabled:text-gray-400 disabled:cursor-not-allowed font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                  </>
                )}

                {currentUser.role === 'admin' && draftStatus === 'approved' && (
                  <>
                    <button
                      type="button"
                      onClick={handleReopenDraft}
                      title="Move this draft back to Admin Review to make corrections"
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-white/20 hover:bg-white/10 font-bold text-xs rounded transition-all text-white"
                    >
                      Reopen for Corrections
                    </button>
                    {wordpressUrl ? (
                      <a
                        href={wordpressUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-green-success hover:brightness-110 font-bold text-xs rounded text-white transition-all shadow-md"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View Live
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePublishToWordPress}
                        disabled={isPublishing}
                        title="Send this draft's JSON to WordPress via the REST API and publish it live"
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 disabled:cursor-not-allowed font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        {isPublishing ? 'Publishing…' : 'Publish to WordPress'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </header>

          {latestRevertNote && (
            <div className="bg-info-soft border-b border-info/20 px-6 py-3 flex gap-3 text-sm text-navy">
              <CornerDownRight className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-info uppercase tracking-wide text-[10px]">
                  {latestRevertNote.created_by_name} {latestRevertNote.type.startsWith('reverted_') ? 'sent this back with notes' : 'sent this to you with a note'}
                </span>
                <p className="text-xs text-navy/80 mt-0.5">{latestRevertNote.message}</p>
              </div>
            </div>
          )}

          {/* Form Workspace Container */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* COLUMN 1: LEFT SIDEBAR (STICKY SECTION NAV) */}
            <aside className="w-[260px] bg-white border-r border-border flex flex-col shrink-0 overflow-y-auto no-scrollbar shadow-sm">
              <div className="p-4 border-b border-border bg-off/50">
                <h3 className="text-xs font-bold text-navy uppercase tracking-wider">Form Sections</h3>
              </div>
              <nav className="flex-1 p-2.5 space-y-0.5">
                {activeSchema.sections.map((sec, index) => {
                  const status = getSectionStatus(formData, sec, isFieldRelevantToViewer);
                  const hasErrors = showValidationErrors && sec.fields.some(f => currentValidation.invalidFields[f.key]);
                  const isActive = activeSectionId === sec.id;

                  let statusIndicator;
                  if (hasErrors) {
                    statusIndicator = <AlertCircle className="w-4 h-4 text-danger shrink-0" title="Required fields incomplete" />;
                  } else if (status === 'complete') {
                    statusIndicator = <CheckCircle className="w-4 h-4 text-green-success shrink-0" />;
                  } else if (status === 'partial') {
                    statusIndicator = <span className="w-3.5 h-3.5 rounded-full border-2 border-orange bg-orange/25 shrink-0" title="Partially filled"></span>;
                  } else {
                    statusIndicator = <span className="w-3.5 h-3.5 rounded-full border-2 border-border-strong shrink-0" title="Empty"></span>;
                  }

                  return (
                    <button
                      key={sec.id}
                      onClick={() => scrollToSection(sec.id)}
                      className={`w-full flex items-center justify-between text-left px-2.5 py-2.5 rounded-lg text-xs font-semibold transition-all border-l-2 ${
                        hasErrors
                          ? 'text-danger bg-danger-soft hover:bg-danger-soft border-danger'
                          : isActive
                            ? 'text-orange bg-orange-soft/60 border-orange'
                            : 'text-navy hover:bg-off border-transparent'
                      }`}
                    >
                      <span className="truncate pr-2 flex items-center gap-2">
                        <span className="text-muted/60 font-mono text-[10px] shrink-0">{(index + 1).toString().padStart(2, '0')}</span>
                        {sec.title}
                      </span>
                      {statusIndicator}
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* COLUMN 2: CENTER (SCROLLABLE FORM CARDS) */}
            <main ref={mainRef} className="flex-1 bg-off p-6 overflow-y-auto space-y-5">

              {showValidationErrors && !currentValidation.isValid && (
                <div className="bg-danger-soft border border-danger/20 rounded-xl p-4 flex gap-3 text-sm text-danger">
                  <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold uppercase tracking-wider text-xs text-danger mb-1">Validation errors found</h4>
                    <p className="text-xs text-danger font-medium">
                      Form is incomplete. We highlighted the missing required fields below. Fix them to enable downloading the payload.
                    </p>
                  </div>
                </div>
              )}

              {activeSchema.sections.map(sec => {
                const isCollapsed = !expandedSections[sec.id];
                const IconComponent = getIcon(sec.icon);

                // Check if any field in this section has validation error
                const secHasErrors = showValidationErrors && sec.fields.some(f => currentValidation.invalidFields[f.key]);
                const requiredFields = sec.fields.filter(f => f.required);
                const isRequiredBadge = requiredFields.length > 0;

                const renderField = (field) => {
                  const isInvalid = showValidationErrors && currentValidation.invalidFields[field.key];
                  const value = formData[field.key];
                  const key = field.key;
                  const locked = !canEditField(field, { role: currentUser.role, draftStatus, allowInternAiEdit });
                  const lockReason = locked ? getLockReason(field, { role: currentUser.role, draftStatus, allowInternAiEdit }) : null;

                  return (
                    <div key={key} id={`field-container-${key}`}>
                      {field.type === 'TEXT_INPUT' && (
                        <TextInput
                          label={field.label}
                          fieldKey={key}
                          placeholder={field.placeholder}
                          required={field.required}
                          value={value}
                          onChange={(val) => handleFieldChange(key, val)}
                          error={isInvalid ? `${field.label} is required` : null}
                          disabled={locked}
                          labelSuffix={lockReason}
                        />
                      )}

                      {field.type === 'TEXTAREA' && (
                        <TextArea
                          label={field.label}
                          fieldKey={key}
                          placeholder={field.placeholder}
                          required={field.required}
                          rows={field.rows}
                          value={value}
                          onChange={(val) => handleFieldChange(key, val)}
                          error={isInvalid ? `${field.label} is required` : null}
                          disabled={locked}
                          labelSuffix={lockReason}
                        />
                      )}

                      {field.type === 'SEARCHABLE_SELECT' && (
                        <SearchableSelect
                          label={field.label}
                          fieldKey={key}
                          placeholder={field.placeholder}
                          required={field.required}
                          value={value}
                          options={getSearchableSelectOptions(field, formData, directoryOptions)}
                          onChange={(val) => handleFieldChange(key, val)}
                          error={isInvalid ? `${field.label} is required` : null}
                          disabled={locked}
                          labelSuffix={lockReason}
                        />
                      )}

                      {field.type === 'RICH_TEXT' && (
                        <RichText
                          label={field.label}
                          fieldKey={key}
                          placeholder={field.placeholder}
                          required={field.required}
                          value={value}
                          onChange={(val) => handleFieldChange(key, val)}
                          error={isInvalid ? `${field.label} is required` : null}
                          disabled={locked}
                          labelSuffix={lockReason}
                        />
                      )}

                      {field.type === 'REPEATER' && (
                        <RepeaterBuilder
                          label={field.label}
                          required={field.required}
                          subfields={field.subfields}
                          value={value}
                          onChange={(val) => handleFieldChange(key, val)}
                          error={isInvalid ? `Requires at least ${field.minItems || 1} item(s)` : null}
                          disabled={locked}
                        />
                      )}

                      {field.aiAssist && (
                        (currentUser.role === 'senior' && draftStatus === 'senior_review') ||
                        (currentUser.role === 'admin' && draftStatus === 'admin_review')
                      ) && (
                        <AiFieldToolbar
                          pageType={activePageType}
                          draftId={activeDraftId}
                          fieldKey={key}
                          fieldLabel={field.label}
                          fieldInstructions={field.aiAssist.instructions}
                          outputFormat={aiOutputFormat(field)}
                          value={value}
                          onChange={(val) => handleFieldChange(key, val)}
                          facts={aiFacts}
                          currentUserRole={currentUser.role}
                          onGenerated={refreshCostSummary}
                        />
                      )}
                    </div>
                  );
                };

                return (
                  <div
                    key={sec.id}
                    id={`section-${sec.id}`}
                    className={`bg-white border rounded-xl shadow-premium overflow-hidden transition-all duration-300 ${
                      secHasErrors ? 'border-danger/50 ring-1 ring-danger/10' : 'border-border hover:shadow-premium-hover'
                    }`}
                  >
                    {/* Collapsible Card Header */}
                    <div
                      onClick={() => toggleSection(sec.id)}
                      className={`px-5 py-4 flex justify-between items-center cursor-pointer select-none transition-colors ${
                        secHasErrors ? 'bg-danger-soft' : 'bg-white hover:bg-off/70'
                      } ${!isCollapsed ? 'border-b border-border' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${secHasErrors ? 'bg-danger/15 text-danger' : 'bg-navy-soft text-navy'}`}>
                          <IconComponent className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-bold text-navy tracking-wide">
                          {sec.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {isRequiredBadge && (
                          <span className="hidden sm:inline-block bg-orange-soft text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full text-orange">
                            Required
                          </span>
                        )}
                        <ChevronRight className={`w-4 h-4 text-muted transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} />
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

                        {/* Dynamic Field Renderer — short TEXT_INPUT runs pack into a grid,
                            long-form fields (textarea/rich text/repeater) stay full-width */}
                        <div className="space-y-4">
                          {groupFieldsForLayout(sec.fields).map((group, gi) => (
                            group.type === 'grid' ? (
                              <div key={gi} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-4">
                                {group.fields.map(field => renderField(field))}
                              </div>
                            ) : (
                              renderField(group.fields[0])
                            )
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </main>

          </div>

          {/* LIVE ACF PAYLOAD SLIDE-OVER (on-demand, triggered by "Preview JSON") */}
          <div
            className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
              showPreviewModal ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => { setShowPreviewModal(false); cancelJsonEditMode(); }}
          />
          <aside
            className={`fixed top-0 right-0 z-50 h-full w-full max-w-[440px] bg-navy-deep text-white flex flex-col shadow-2xl transition-transform duration-300 ${
              showPreviewModal ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            {/* Header */}
            <div className="p-4 bg-black/20 border-b border-white/10 flex justify-between items-center shrink-0">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange"></span>
                {showJsonEditMode ? 'Edit JSON' : 'Live ACF Payload'}
              </span>

              <div className="flex gap-2">
                {!showJsonEditMode && (
                  <button
                    onClick={openJsonEditMode}
                    className="p-1.5 hover:bg-white/10 rounded text-gray-300 transition-colors"
                    title="Edit JSON"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleCopyJSON(acfPayload)}
                  className="p-1.5 hover:bg-white/10 rounded text-gray-300 transition-colors"
                  title="Copy JSON to Clipboard"
                >
                  {copiedIndicator ? (
                    <Check className="w-4 h-4 text-green-success" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => { setShowPreviewModal(false); cancelJsonEditMode(); }}
                  className="p-1.5 hover:bg-white/10 rounded text-gray-300 transition-colors"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Validation Status Panel */}
            {!showJsonEditMode && (
              <div className="p-4 bg-black/10 border-b border-white/10 shrink-0">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Validation Status</span>
                  {currentValidation.isValid ? (
                    <span className="text-[10px] bg-green-success/20 border border-green-success/40 px-2 py-0.5 rounded text-green-success font-bold">
                      ALL PASS
                    </span>
                  ) : (
                    <span className="text-[10px] bg-danger/20 border border-danger/40 px-2 py-0.5 rounded text-red-300 font-bold">
                      INCOMPLETE
                    </span>
                  )}
                </div>

                {/* Missing fields summary */}
                {!currentValidation.isValid && (
                  <div className="mt-2 text-[10px] text-red-300 space-y-1 max-h-32 overflow-y-auto styled-scrollbar">
                    <p className="font-bold text-[9px] uppercase tracking-wide text-gray-400">Missing Required Fields:</p>
                    {currentValidation.errors.map((err, i) => (
                      <div key={i} className="flex gap-1.5 items-start">
                        <CornerDownRight className="w-3 h-3 text-orange shrink-0 mt-0.5" />
                        <span className="text-gray-300">{err}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Code Pre container / Edit textarea */}
            <div className="flex-1 p-4 overflow-auto styled-scrollbar font-mono text-xs select-text bg-black/20 flex flex-col">
              {showJsonEditMode ? (
                <>
                  <textarea
                    value={jsonEditText}
                    onChange={(e) => setJsonEditText(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full bg-transparent text-gray-100 outline-none resize-none whitespace-pre font-mono"
                  />
                  {jsonEditError && (
                    <p className="mt-2 text-[11px] text-red-300 font-semibold shrink-0">{jsonEditError}</p>
                  )}
                </>
              ) : (
                <pre
                  className="whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: highlightJSON(acfPayload) }}
                />
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-black/20 border-t border-white/10 flex justify-between items-center shrink-0">
              {showJsonEditMode ? (
                <>
                  <button
                    onClick={cancelJsonEditMode}
                    className="text-xs font-bold text-gray-300 hover:text-white px-4 py-2 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyJsonChanges}
                    className="bg-orange hover:bg-orange-hover text-white text-xs font-bold px-4 py-2 rounded transition-colors"
                  >
                    Apply Changes
                  </button>
                </>
              ) : (
                <>
                  <div className="text-xs text-gray-400 font-medium">
                    {progressPercent}% required fields filled
                  </div>
                  <button
                    onClick={() => {
                      setShowPreviewModal(false);
                      handleDownloadAttempt();
                    }}
                    className="bg-orange hover:bg-orange-hover text-white text-xs font-bold px-4 py-2 rounded transition-colors"
                  >
                    Validate & Download
                  </button>
                </>
              )}
            </div>
          </aside>

          {/* VALIDATION SUCCESS MODAL */}
          {showSuccessModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl text-center border border-border">
                <div className="w-16 h-16 bg-green-soft rounded-full flex items-center justify-center mx-auto mb-4 text-green-success">
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

          {/* BULK PASTE MODAL */}
          {showBulkPasteModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-border">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-extrabold text-navy uppercase tracking-wide flex items-center gap-2">
                    <ClipboardPaste className="w-5 h-5 text-orange" />
                    Paste Data
                  </h3>
                  <button
                    onClick={() => { setShowBulkPasteModal(false); setBulkPasteResult(null); }}
                    className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {!bulkPasteResult ? (
                  <>
                    <p className="text-xs text-muted font-medium mb-3">
                      Copy a two-column table — from a spreadsheet, a doc, or <code>key: value</code> / <code>key=value</code> lines — and paste it below. Every row jumps to its matching field automatically. To fill a repeater (Fee Plans, Job Profiles, FAQs, etc.), start that block with the field's own name on its own line, then its table right below it.
                    </p>
                    <textarea
                      autoFocus
                      onPaste={handleBulkPasteEvent}
                      placeholder={'university_name\tNMIMS\nhero_description\tShort description here...\n\nFee Plans\nSemester 1\t45000\nSemester 2\t45000'}
                      rows={8}
                      className="w-full px-4 py-2.5 rounded-lg border border-border bg-off text-navy placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-xs font-mono resize-none"
                    />
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-green-success font-bold text-sm">
                      <CheckCircle className="w-5 h-5" />
                      {bulkPasteResult.matchedCount} field{bulkPasteResult.matchedCount === 1 ? '' : 's'} filled
                    </div>

                    {bulkPasteResult.matchedLabels.length > 0 && (
                      <div className="text-xs text-muted max-h-32 overflow-y-auto space-y-1 bg-off rounded-lg p-3 border border-border">
                        {bulkPasteResult.matchedLabels.map((l, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-green-success shrink-0" />
                            {l}
                          </div>
                        ))}
                      </div>
                    )}

                    {bulkPasteResult.lockedLabels?.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-orange mb-1.5">
                          Skipped (locked for you right now):
                        </p>
                        <div className="text-xs text-muted space-y-1 max-h-24 overflow-y-auto">
                          {bulkPasteResult.lockedLabels.map((l, i) => (
                            <div key={i}>{l}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {bulkPasteResult.unmatched.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-orange mb-1.5">
                          Unmatched keys (no field found):
                        </p>
                        <div className="text-xs text-muted space-y-1 max-h-24 overflow-y-auto font-mono">
                          {bulkPasteResult.unmatched.map((k, i) => (
                            <div key={i}>{k}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => { setShowBulkPasteModal(false); setBulkPasteResult(null); }}
                      className="w-full mt-2 bg-navy hover:bg-navy-hover text-white text-xs font-bold py-3 rounded-lg transition-colors"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SHARED STATUS-ACTION NOTE MODAL — send-to-senior / send-to-admin / revert-to-intern / revert-to-senior */}
          {noteModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-border">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-extrabold text-navy uppercase tracking-wide flex items-center gap-2">
                    {(() => { const Icon = NOTE_MODAL_CONFIG[noteModal].icon; return <Icon className="w-5 h-5 text-orange" />; })()}
                    {NOTE_MODAL_CONFIG[noteModal].heading}
                  </h3>
                  <button
                    onClick={() => setNoteModal(null)}
                    className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-xs text-muted font-medium mb-3">
                  {NOTE_MODAL_CONFIG[noteModal].helperText}
                </p>
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={NOTE_MODAL_CONFIG[noteModal].placeholder}
                  rows={6}
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-off text-navy placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-xs resize-y"
                />

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setNoteModal(null)}
                    className="flex-1 bg-off hover:bg-border text-navy text-xs font-bold py-3 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitNoteAction}
                    disabled={isSubmittingNote}
                    className="flex-1 bg-navy hover:bg-navy-hover disabled:opacity-50 text-white text-xs font-bold py-3 rounded-lg transition-colors"
                  >
                    {isSubmittingNote ? NOTE_MODAL_CONFIG[noteModal].submittingLabel : NOTE_MODAL_CONFIG[noteModal].submitLabel}
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

// Top-level gate: invite/reset links must work regardless of auth status (a currently logged-in
// user clicking their own generated invite link should still see the accept screen, since
// accepting creates a separate new account rather than touching their own session). Everything
// else is gated on the current auth status before any of ContentStudioApp's internals run.
function App() {
  const { status } = useAuth();

  const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/);
  if (inviteMatch) return <InviteAcceptScreen token={inviteMatch[1]} />;

  const resetMatch = window.location.pathname.match(/^\/reset\/([^/]+)$/);
  if (resetMatch) return <PasswordResetScreen token={resetMatch[1]} />;

  if (status === 'loading') return null;
  if (status === 'needs-bootstrap') return <BootstrapScreen />;
  if (status === 'logged-out') return <LoginScreen />;

  return <ContentStudioApp />;
}

export default App;
