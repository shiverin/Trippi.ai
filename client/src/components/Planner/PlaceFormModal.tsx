import { AlertTriangle, Loader2, Paperclip, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapsApi } from '../../api/client';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useCanDo } from '../../store/permissionsStore';
import { useTripStore } from '../../store/tripStore';
import type { Assignment, Category, Place } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';
import CustomSelect from '../shared/CustomSelect';
import CustomTimePicker from '../shared/CustomTimePicker';
import Modal from '../shared/Modal';
import { useToast } from '../shared/Toast';
import { DEFAULT_FORM, isGoogleMapsUrl, type PlaceFormData } from './PlaceFormModal.helpers';

// The submit payload mirrors the form, but lat/lng are parsed to numbers and
// category_id is normalised, plus any files chosen before the place existed.
export interface PlaceSubmitData extends Omit<PlaceFormData, 'lat' | 'lng' | 'category_id'> {
  lat: number | null;
  lng: number | null;
  category_id: string | null;
  _pendingFiles?: File[];
}

interface PlaceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PlaceSubmitData, files?: File[]) => Promise<void> | void;
  place: Place | null;
  prefillCoords?: {
    lat: number;
    lng: number;
    name?: string;
    address?: string;
    website?: string;
    phone?: string;
    osm_id?: string;
  } | null;
  tripId: number;
  categories: Category[];
  onCategoryCreated: (category: { name: string; color?: string; icon?: string }) => Promise<Category> | undefined;
  assignmentId: number | null;
  dayAssignments?: Assignment[];
}

/** Place create/edit form state: maps search + Google-URL resolve + autocomplete,
 * category creation, file attachments and submit. Keeps PlaceFormModal a thin
 * render over the form fields. */

// #1152: a manually-added place is treated as a likely duplicate of an existing
// trip place if it shares the Google Place ID, the (case-insensitive) name, or
// near-identical coordinates (~11 m). Mirrors the server-side import dedup.
const DUP_COORD_TOLERANCE = 0.0001;
function findDuplicatePlace(
  form: PlaceFormData,
  places: { name?: string | null; lat?: number | null; lng?: number | null; google_place_id?: string | null }[]
): { name?: string | null } | null {
  const name = (form.name || '').trim().toLowerCase();
  const gid = (form.google_place_id || '').trim();
  const lat = form.lat ? parseFloat(form.lat) : null;
  const lng = form.lng ? parseFloat(form.lng) : null;
  for (const p of places || []) {
    if (gid && p.google_place_id && p.google_place_id === gid) return p;
    if (name && p.name && p.name.trim().toLowerCase() === name) return p;
    if (
      lat != null &&
      lng != null &&
      p.lat != null &&
      p.lng != null &&
      Math.abs(Number(p.lat) - lat) <= DUP_COORD_TOLERANCE &&
      Math.abs(Number(p.lng) - lng) <= DUP_COORD_TOLERANCE
    )
      return p;
  }
  return null;
}

function usePlaceFormModal(props: PlaceFormModalProps) {
  const {
    isOpen,
    onClose,
    onSave,
    place,
    prefillCoords,
    tripId,
    categories,
    onCategoryCreated,
    assignmentId,
    dayAssignments = [],
  } = props;
  const [form, setForm] = useState(DEFAULT_FORM);
  const [mapsSearch, setMapsSearch] = useState('');
  const [mapsResults, setMapsResults] = useState([]);
  const [isSearchingMaps, setIsSearchingMaps] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileRef = useRef(null);
  const [acSuggestions, setAcSuggestions] = useState<{ placeId: string; mainText: string; secondaryText: string }[]>(
    []
  );
  const [acHighlight, setAcHighlight] = useState(-1);
  const acDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acAbortRef = useRef<AbortController | null>(null);
  const toast = useToast();
  const { t, language } = useTranslation();
  const { hasMapsKey } = useAuthStore();
  const can = useCanDo();
  const tripObj = useTripStore((s) => s.trip);
  const canUploadFiles = can('file_upload', tripObj);

  useEffect(() => {
    if (place) {
      // Times are stored per day-assignment, not on the pool place. When an
      // assignment is in context (itinerary edit, or a single-assignment pool
      // edit) read the times off its embedded place; fall back to the place prop.
      const assignment = assignmentId ? dayAssignments.find((a) => a.id === assignmentId) : null;
      const timeSource = assignment?.place ?? place;
      setForm({
        name: place.name || '',
        description: place.description || '',
        address: place.address || '',
        lat: place.lat != null ? String(place.lat) : '',
        lng: place.lng != null ? String(place.lng) : '',
        category_id: place.category_id != null ? String(place.category_id) : '',
        place_time: timeSource.place_time || '',
        end_time: timeSource.end_time || '',
        notes: place.notes || '',
        transport_mode: place.transport_mode || 'walking',
        website: place.website || '',
      });
    } else if (prefillCoords) {
      setForm({
        ...DEFAULT_FORM,
        lat: String(prefillCoords.lat),
        lng: String(prefillCoords.lng),
        name: prefillCoords.name || '',
        address: prefillCoords.address || '',
        website: prefillCoords.website || '',
        phone: prefillCoords.phone || '',
        osm_id: prefillCoords.osm_id,
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    setPendingFiles([]);
    setDuplicateWarning(null);
    // dayAssignments is a fresh array each render; read it at open-time only and
    // re-run on identity changes (place/assignmentId/open), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, prefillCoords, isOpen, assignmentId]);

  // Derive location bias bounding box from the trip's existing places
  const places = useTripStore((s) => s.places);
  const locationBias = useMemo(() => {
    const withCoords = (places || []).filter((p) => p.lat != null && p.lng != null);
    if (withCoords.length === 0) return undefined;

    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const p of withCoords) {
      const lat = Number(p.lat),
        lng = Number(p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    if (!Number.isFinite(minLat)) return undefined;

    // Skip bias if the bounding box is too large (~500 km diagonal)
    const dlat = maxLat - minLat;
    const dlng = maxLng - minLng;
    const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const diagKm = Math.sqrt((dlat * 111) ** 2 + (dlng * 111 * Math.cos(avgLatRad)) ** 2);
    if (diagKm > 500) return undefined;

    return { low: { lat: minLat, lng: minLng }, high: { lat: maxLat, lng: maxLng } };
  }, [places]);

  // Autocomplete fetch — aborts any in-flight request before starting a new one
  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (query.length < 2 || isGoogleMapsUrl(query)) {
        setAcSuggestions([]);
        setAcHighlight(-1);
        return;
      }
      acAbortRef.current?.abort();
      const controller = new AbortController();
      acAbortRef.current = controller;
      try {
        const result = await mapsApi.autocomplete(query, language, locationBias, controller.signal);
        setAcSuggestions(result.suggestions || []);
        setAcHighlight(-1);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'CanceledError') return; // axios abort
        console.error('Autocomplete failed:', err);
        setAcSuggestions([]);
      }
    },
    [language, locationBias]
  );

  // Debounce effect — only watches mapsSearch
  useEffect(() => {
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current);

    const trimmed = mapsSearch.trim();
    if (trimmed.length < 2 || isGoogleMapsUrl(trimmed)) {
      setAcSuggestions([]);
      setAcHighlight(-1);
      return;
    }

    acDebounceRef.current = setTimeout(() => fetchSuggestions(trimmed), 300);

    return () => {
      if (acDebounceRef.current) clearTimeout(acDebounceRef.current);
    };
  }, [mapsSearch, fetchSuggestions]);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleMapsSearch = async () => {
    if (!mapsSearch.trim()) return;
    setIsSearchingMaps(true);
    try {
      // Detect Google Maps URLs and resolve them directly
      const trimmed = mapsSearch.trim();
      if (isGoogleMapsUrl(trimmed)) {
        const resolved = await mapsApi.resolveUrl(trimmed);
        if (resolved.lat && resolved.lng) {
          setForm((prev) => ({
            ...prev,
            name: resolved.name || prev.name,
            address: resolved.address || prev.address,
            lat: String(resolved.lat),
            lng: String(resolved.lng),
            google_ftid: resolved.google_ftid || prev.google_ftid,
          }));
          setMapsResults([]);
          setMapsSearch('');
          toast.success(t('places.urlResolved'));
          return;
        }
      }
      const result = await mapsApi.search(mapsSearch, language);
      setMapsResults(result.places || []);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('places.mapsSearchError')));
    } finally {
      setIsSearchingMaps(false);
    }
  };

  const handleSelectMapsResult = (result) => {
    setForm((prev) => ({
      ...prev,
      name: result.name || prev.name,
      address: result.address || prev.address,
      lat: result.lat || prev.lat,
      lng: result.lng || prev.lng,
      google_place_id: result.google_place_id || prev.google_place_id,
      google_ftid: result.google_ftid || prev.google_ftid,
      osm_id: result.osm_id || prev.osm_id,
      website: result.website || prev.website,
      phone: result.phone || prev.phone,
    }));
    setMapsResults([]);
    setMapsSearch('');
  };

  const handleSelectSuggestion = async (suggestion: { placeId: string; mainText: string; secondaryText: string }) => {
    setAcSuggestions([]);
    setAcHighlight(-1);
    const previousSearch = mapsSearch;
    setMapsSearch('');
    setForm((prev) => ({ ...prev, name: suggestion.mainText }));
    setIsSearchingMaps(true);
    try {
      // The details lookup is a fragile second hop — it can fail when the
      // details kill-switch is off, when the OSM Overpass mirror is overloaded,
      // or on any upstream error. Treat a missing/coordinate-less place as a
      // miss and fall back to the reliable text-search path the search button
      // uses (its results already carry coordinates), so dropdown items stay
      // clickable instead of dead-ending on "Place search failed". (#1192)
      let place: Record<string, unknown> | null = null;
      try {
        const result = await mapsApi.details(suggestion.placeId, language);
        if (result.place && result.place.lat != null && result.place.lng != null) {
          place = result.place;
        }
      } catch (err) {
        console.error('Failed to fetch place details:', err);
      }
      if (!place) {
        const query = [suggestion.mainText, suggestion.secondaryText].filter(Boolean).join(', ');
        const search = await mapsApi.search(query, language);
        place = search.places?.[0] ?? null;
      }
      if (place) {
        handleSelectMapsResult(place);
      } else {
        setMapsSearch(previousSearch);
        toast.error(t('places.mapsSearchError'));
      }
    } catch (err) {
      console.error('Place suggestion lookup failed:', err);
      setMapsSearch(previousSearch);
      toast.error(getApiErrorMessage(err, t('places.mapsSearchError')));
    } finally {
      setIsSearchingMaps(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (acSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcHighlight((prev) => (prev + 1) % acSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcHighlight((prev) => (prev <= 0 ? acSuggestions.length - 1 : prev - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (acHighlight >= 0) {
          handleSelectSuggestion(acSuggestions[acHighlight]);
        } else {
          setAcSuggestions([]);
          handleMapsSearch();
        }
      } else if (e.key === 'Escape') {
        setAcSuggestions([]);
        setAcHighlight(-1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleMapsSearch();
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const cat = await onCategoryCreated?.({ name: newCategoryName, color: '#6366f1', icon: 'MapPin' });
      if (cat) setForm((prev) => ({ ...prev, category_id: String(cat.id) }));
      setNewCategoryName('');
      setShowNewCategory(false);
    } catch (err: unknown) {
      toast.error(t('places.categoryCreateError'));
    }
  };

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const handleRemoveFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // Paste support for files/images
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canUploadFiles) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setPendingFiles((prev) => [...prev, file]);
        return;
      }
    }
  };

  const hasTimeError =
    place &&
    form.place_time &&
    form.end_time &&
    form.place_time.length >= 5 &&
    form.end_time.length >= 5 &&
    form.end_time <= form.place_time;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error(t('places.nameRequired'));
      return;
    }
    // #1152: only for new places, and only on the first attempt — a second click
    // (with the warning already showing) is the explicit "add anyway" confirmation.
    if (!place && !duplicateWarning) {
      const dup = findDuplicatePlace(form, places);
      if (dup) {
        const dupName = dup.name || form.name;
        setDuplicateWarning(dupName);
        toast.warning(t('places.duplicateExists', { name: dupName }));
        return;
      }
    }
    setIsSaving(true);
    try {
      await onSave({
        ...form,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
        category_id: form.category_id || null,
        _pendingFiles: pendingFiles.length > 0 ? pendingFiles : undefined,
      });
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('places.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isOpen,
    onClose,
    onSave,
    place,
    prefillCoords,
    tripId,
    categories,
    onCategoryCreated,
    assignmentId,
    dayAssignments,
    form,
    setForm,
    mapsSearch,
    setMapsSearch,
    mapsResults,
    setMapsResults,
    isSearchingMaps,
    setIsSearchingMaps,
    newCategoryName,
    setNewCategoryName,
    showNewCategory,
    setShowNewCategory,
    isSaving,
    setIsSaving,
    pendingFiles,
    setPendingFiles,
    fileRef,
    acSuggestions,
    setAcSuggestions,
    acHighlight,
    setAcHighlight,
    acDebounceRef,
    acAbortRef,
    toast,
    t,
    language,
    hasMapsKey,
    can,
    tripObj,
    canUploadFiles,
    places,
    locationBias,
    fetchSuggestions,
    handleChange,
    handleMapsSearch,
    handleSelectMapsResult,
    handleSelectSuggestion,
    handleSearchKeyDown,
    handleCreateCategory,
    handleFileAdd,
    handleRemoveFile,
    handlePaste,
    hasTimeError,
    handleSubmit,
    duplicateWarning,
  };
}

export default function PlaceFormModal(props: PlaceFormModalProps) {
  const S = usePlaceFormModal(props);
  const {
    isOpen,
    onClose,
    onSave,
    place,
    prefillCoords,
    tripId,
    categories,
    onCategoryCreated,
    assignmentId,
    dayAssignments,
    form,
    setForm,
    mapsSearch,
    setMapsSearch,
    mapsResults,
    setMapsResults,
    isSearchingMaps,
    setIsSearchingMaps,
    newCategoryName,
    setNewCategoryName,
    showNewCategory,
    setShowNewCategory,
    isSaving,
    setIsSaving,
    pendingFiles,
    setPendingFiles,
    fileRef,
    acSuggestions,
    setAcSuggestions,
    acHighlight,
    setAcHighlight,
    acDebounceRef,
    acAbortRef,
    toast,
    t,
    language,
    hasMapsKey,
    can,
    tripObj,
    canUploadFiles,
    places,
    locationBias,
    fetchSuggestions,
    handleChange,
    handleMapsSearch,
    handleSelectMapsResult,
    handleSelectSuggestion,
    handleSearchKeyDown,
    handleCreateCategory,
    handleFileAdd,
    handleRemoveFile,
    handlePaste,
    hasTimeError,
    handleSubmit,
    duplicateWarning,
  } = S;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={place ? t('places.editPlace') : t('places.addPlace')}
      size="lg"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || hasTimeError}
            className="rounded-lg bg-slate-900 px-6 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {isSaving
              ? t('common.saving')
              : place
                ? t('common.update')
                : duplicateWarning
                  ? t('places.addAnyway')
                  : t('common.add')}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" onPaste={handlePaste}>
        {/* Place Search */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          {!hasMapsKey && <p className="mb-2 text-xs text-content-faint">{t('places.osmActive')}</p>}
          <div className="relative">
            <div className="flex gap-2">
              <input
                type="text"
                value={mapsSearch}
                onChange={(e) => setMapsSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onBlur={() => setTimeout(() => setAcSuggestions([]), 150)}
                onFocus={() => {
                  if (mapsSearch.trim().length >= 2 && acSuggestions.length === 0 && mapsResults.length === 0) {
                    fetchSuggestions(mapsSearch.trim());
                  }
                }}
                placeholder={t('places.mapsSearchPlaceholder')}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <button
                type="button"
                onClick={() => {
                  setAcSuggestions([]);
                  handleMapsSearch();
                }}
                disabled={isSearchingMaps}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {isSearchingMaps ? '...' : <Search className="h-4 w-4" />}
              </button>
            </div>

            {/* Autocomplete dropdown */}
            {acSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {acSuggestions.map((s, idx) => (
                  <button
                    key={s.placeId}
                    type="button"
                    onMouseDown={() => handleSelectSuggestion(s)}
                    onMouseEnter={() => setAcHighlight(idx)}
                    className={`w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 ${
                      idx === acHighlight ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-medium">{s.mainText}</div>
                    {s.secondaryText && <div className="truncate text-xs text-slate-500">{s.secondaryText}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search results (populated after full search) */}
          {mapsResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-hidden overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {mapsResults.map((result, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectMapsResult(result)}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                >
                  <div className="text-sm font-medium">{result.name}</div>
                  <div className="truncate text-xs text-slate-500">{result.address}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.formName')} *</label>
          <div className="relative">
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              required
              placeholder={t('places.formNamePlaceholder')}
              className="form-input"
            />
            {isSearchingMaps && (
              <div
                className="absolute bottom-0 right-2.5 top-0 flex items-center"
                role="status"
                aria-label={t('places.loadingDetails')}
              >
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.formDescription')}</label>
          <textarea
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            rows={2}
            placeholder={t('places.formDescriptionPlaceholder')}
            className="form-input"
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.formNotes')}</label>
          <textarea
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t('places.formNotesPlaceholder')}
            className="form-input"
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Address + Coordinates */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.formAddress')}</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => handleChange('address', e.target.value)}
            placeholder={t('places.formAddressPlaceholder')}
            className="form-input"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              type="number"
              step="any"
              value={form.lat}
              onChange={(e) => handleChange('lat', e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text').trim();
                const match = text.match(/^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/);
                if (match) {
                  e.preventDefault();
                  handleChange('lat', match[1]);
                  handleChange('lng', match[2]);
                }
              }}
              placeholder={t('places.formLat')}
              className="form-input"
            />
            <input
              type="number"
              step="any"
              value={form.lng}
              onChange={(e) => handleChange('lng', e.target.value)}
              placeholder={t('places.formLng')}
              className="form-input"
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.formCategory')}</label>
          {!showNewCategory ? (
            <div className="flex gap-2">
              <CustomSelect
                value={form.category_id}
                onChange={(value) => handleChange('category_id', String(value))}
                placeholder={t('places.noCategory')}
                options={[
                  { value: '', label: t('places.noCategory') },
                  ...(categories || []).map((c) => ({
                    // form.category_id is a string; CustomSelect matches options by
                    // strict equality, so the option value must be a string too —
                    // otherwise the chosen category never renders in the trigger.
                    value: String(c.id),
                    label: c.name,
                  })),
                ]}
                style={{ flex: 1 }}
                size="sm"
              />
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t('places.categoryNamePlaceholder')}
                className="form-input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={handleCreateCategory}
                className="rounded-lg bg-slate-900 px-3 text-sm text-white hover:bg-slate-700"
              >
                OK
              </button>
              <button type="button" onClick={() => setShowNewCategory(false)} className="px-2 text-sm text-gray-500">
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>

        {/* Time is per day-assignment: only shown when a single assignment is in
            context (itinerary edit, or a single-assignment pool edit). Hidden when
            creating, and for unassigned / multi-day pool edits where a single time
            is ambiguous and wouldn't persist. */}
        {place && assignmentId && (
          <TimeSection
            form={form}
            handleChange={handleChange}
            assignmentId={assignmentId}
            dayAssignments={dayAssignments}
            hasTimeError={hasTimeError}
            t={t}
          />
        )}

        {/* Website */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.formWebsite')}</label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => handleChange('website', e.target.value)}
            placeholder="https://..."
            className="form-input"
          />
        </div>

        {/* File Attachments */}
        {canUploadFiles && (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">{t('files.title')}</label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-slate-500 transition-colors hover:text-slate-700"
              >
                <Paperclip size={12} /> {t('files.attach')}
              </button>
            </div>
            <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileAdd} />
            {pendingFiles.length > 0 && (
              <div className="space-y-1">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                    <Paperclip size={10} className="shrink-0 text-slate-400" />
                    <span className="flex-1 truncate text-slate-600">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(idx)}
                      className="shrink-0 text-slate-400 hover:text-red-500"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pendingFiles.length === 0 && <p className="text-xs text-slate-400">{t('files.pasteHint')}</p>}
          </div>
        )}
      </form>
    </Modal>
  );
}

interface TimeSectionProps {
  form: PlaceFormData;
  handleChange: (field: string, value: string) => void;
  assignmentId: number | null;
  dayAssignments: Assignment[];
  hasTimeError: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function TimeSection({ form, handleChange, assignmentId, dayAssignments, hasTimeError, t }: TimeSectionProps) {
  const collisions = useMemo(() => {
    if (!assignmentId || !form.place_time || form.place_time.length < 5) return [];
    // Find the day_id for the current assignment
    const current = dayAssignments.find((a) => a.id === assignmentId);
    if (!current) return [];
    const myStart = form.place_time;
    const myEnd = form.end_time && form.end_time.length >= 5 ? form.end_time : null;
    return dayAssignments.filter((a) => {
      if (a.id === assignmentId) return false;
      if (a.day_id !== current.day_id) return false;
      const aStart = a.place?.place_time;
      const aEnd = a.place?.end_time;
      if (!aStart) return false;
      // Check overlap: two intervals overlap if start < otherEnd AND otherStart < end
      const s1 = myStart,
        e1 = myEnd || myStart;
      const s2 = aStart,
        e2 = aEnd || aStart;
      return s1 < (e2 || '23:59') && s2 < (e1 || '23:59') && s1 !== e2 && s2 !== e1;
    });
  }, [assignmentId, dayAssignments, form.place_time, form.end_time]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.startTime')}</label>
          <CustomTimePicker value={form.place_time} onChange={(v) => handleChange('place_time', v)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('places.endTime')}</label>
          <CustomTimePicker value={form.end_time} onChange={(v) => handleChange('end_time', v)} />
        </div>
      </div>
      {hasTimeError && (
        <div
          className="mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
          style={{ background: 'var(--bg-warning, #fef3c7)', color: 'var(--text-warning, #92400e)' }}
        >
          <AlertTriangle size={13} className="shrink-0" />
          {t('places.endTimeBeforeStart')}
        </div>
      )}
      {collisions.length > 0 && (
        <div
          className="mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
          style={{ background: 'var(--bg-warning, #fef3c7)', color: 'var(--text-warning, #92400e)' }}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {t('places.timeCollision')}{' '}
            {collisions
              .map((a) => a.place?.name)
              .filter(Boolean)
              .join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}
