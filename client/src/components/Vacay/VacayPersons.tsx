import { Check, Clock, Loader2, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import apiClient from '../../api/client';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useVacayStore } from '../../store/vacayStore';
import { getApiErrorMessage } from '../../types';
import CustomSelect from '../shared/CustomSelect';
import { useToast } from '../shared/Toast';

const PRESET_COLORS = [
  '#6366f1',
  '#ec4899',
  '#14b8a6',
  '#8b5cf6',
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#06b6d4',
  '#f43f5e',
  '#a855f7',
  '#10b981',
  '#0ea5e9',
  '#64748b',
  '#be185d',
  '#0d9488',
];

export default function VacayPersons() {
  const { t } = useTranslation();
  const toast = useToast();
  const { users, pendingInvites, invite, cancelInvite, updateColor, selectedUserId, setSelectedUserId, isFused } =
    useVacayStore();
  const { user: currentUser } = useAuthStore();

  // Default selectedUserId to current user
  useEffect(() => {
    if (!selectedUserId && currentUser) setSelectedUserId(currentUser.id);
  }, [currentUser, selectedUserId]);
  const [showInvite, setShowInvite] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorEditUserId, setColorEditUserId] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedInviteUser, setSelectedInviteUser] = useState(null);
  const [inviting, setInviting] = useState(false);

  const loadAvailable = async () => {
    try {
      const data = await apiClient.get('/addons/vacay/available-users').then((r) => r.data);
      setAvailableUsers(data.users);
    } catch {
      /* */
    }
  };

  const handleInvite = async () => {
    if (!selectedInviteUser) return;
    setInviting(true);
    try {
      await invite(selectedInviteUser);
      toast.success(t('vacay.inviteSent'));
      setShowInvite(false);
      setSelectedInviteUser(null);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('vacay.inviteError')));
    } finally {
      setInviting(false);
    }
  };

  const handleColorChange = async (color) => {
    await updateColor(color, colorEditUserId);
    setShowColorPicker(false);
    setColorEditUserId(null);
  };

  const editingUserColor = users.find((u) => u.id === colorEditUserId)?.color || '#6366f1';

  return (
    <div className="rounded-xl border border-edge bg-surface-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-content-faint">
          {t('vacay.persons')}
        </span>
        <button
          onClick={() => {
            setShowInvite(true);
            loadAvailable();
          }}
          className="rounded p-0.5 text-content-faint transition-colors"
        >
          <UserPlus size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {users.map((u) => {
          const isSelected = selectedUserId === u.id;
          return (
            <div
              key={u.id}
              onClick={() => {
                if (isFused) setSelectedUserId(u.id);
              }}
              className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all ${isSelected ? 'border-edge bg-surface-hover' : 'border-transparent bg-transparent'}`}
              style={{
                cursor: isFused ? 'pointer' : 'default',
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setColorEditUserId(u.id);
                  setShowColorPicker(true);
                }}
                className="h-3.5 w-3.5 shrink-0 rounded-full transition-transform hover:scale-125"
                style={{ backgroundColor: u.color, cursor: 'pointer' }}
                title={t('vacay.changeColor')}
              />
              <span className="flex-1 truncate text-xs font-medium text-content">
                {u.username}
                {u.id === currentUser?.id && <span className="text-content-faint"> ({t('vacay.you')})</span>}
              </span>
              {isSelected && isFused && <Check size={12} className="text-content" />}
            </div>
          );
        })}

        {/* Pending invites */}
        {pendingInvites.map((inv) => (
          <div
            key={inv.user_id}
            className="group flex items-center gap-2 rounded-lg bg-surface-secondary px-2.5 py-1.5"
            style={{ opacity: 0.7 }}
          >
            <Clock size={12} className="text-content-faint" />
            <span className="flex-1 truncate text-xs text-content-muted">
              {inv.username} <span className="text-[10px]">({t('vacay.pending')})</span>
            </span>
            <button
              onClick={() => cancelInvite(inv.user_id)}
              className="rounded px-1.5 py-0.5 text-[10px] text-content-faint opacity-0 transition-all group-hover:opacity-100"
            >
              {t('common.cancel')}
            </button>
          </div>
        ))}
      </div>

      {/* Invite Modal — Portal to body to avoid z-index issues */}
      {showInvite &&
        ReactDOM.createPortal(
          <div
            className="trek-backdrop-enter fixed inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.5)] px-4"
            style={{ zIndex: 99990, paddingTop: 70 }}
            onClick={() => setShowInvite(false)}
          >
            <div
              className="trek-modal-enter w-full max-w-sm rounded-2xl bg-surface-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-edge-secondary p-5">
                <h2 className="text-base font-semibold text-content">{t('vacay.inviteUser')}</h2>
                <button
                  onClick={() => setShowInvite(false)}
                  className="rounded-lg p-1.5 text-content-faint transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-4 p-5">
                <p className="text-xs text-content-muted">{t('vacay.inviteHint')}</p>
                {availableUsers.length === 0 ? (
                  <p className="py-4 text-center text-xs text-content-faint">{t('vacay.noUsersAvailable')}</p>
                ) : (
                  <CustomSelect
                    value={selectedInviteUser}
                    onChange={setSelectedInviteUser}
                    options={availableUsers.map((u) => ({ value: u.id, label: `${u.username} (${u.email})` }))}
                    placeholder={t('vacay.selectUser')}
                    searchable
                  />
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowInvite(false)}
                    className="rounded-lg border border-edge px-4 py-2 text-sm text-content-muted"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleInvite}
                    disabled={!selectedInviteUser || inviting}
                    className="flex items-center gap-1.5 rounded-lg bg-content px-4 py-2 text-sm text-surface-card transition-colors disabled:opacity-40"
                  >
                    {inviting && <Loader2 size={13} className="animate-spin" />}
                    {t('vacay.sendInvite')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Color Picker Modal — Portal to body */}
      {showColorPicker &&
        ReactDOM.createPortal(
          <div
            className="trek-backdrop-enter fixed inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.5)] px-4"
            style={{ zIndex: 99990, paddingTop: 70 }}
            onClick={() => {
              setShowColorPicker(false);
              setColorEditUserId(null);
            }}
          >
            <div
              className="trek-modal-enter w-full max-w-xs rounded-2xl bg-surface-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-edge-secondary p-5">
                <h2 className="text-base font-semibold text-content">{t('vacay.changeColor')}</h2>
                <button
                  onClick={() => {
                    setShowColorPicker(false);
                    setColorEditUserId(null);
                  }}
                  className="rounded-lg p-1.5 text-content-faint transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5">
                <div className="flex flex-wrap justify-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleColorChange(c)}
                      className={`h-8 w-8 rounded-full transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${editingUserColor === c ? 'scale-110 ring-2 ring-offset-2' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
