import { ClipboardList, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { GroupDecisionCreateContext, GroupDecisionCreateValues } from './groupDecisionModel';

interface GroupDecisionCreateModalProps {
  context: GroupDecisionCreateContext | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (values: GroupDecisionCreateValues) => void | Promise<void>;
}

export default function GroupDecisionCreateModal({
  context,
  busy = false,
  onClose,
  onSubmit,
}: GroupDecisionCreateModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context) return;
    setTitle(context.title ?? '');
    setDescription(context.description ?? '');
    setDeadline('');
    setOptions(['', '']);
    setError(null);
  }, [context]);

  const trimmedOptions = useMemo(() => options.map((option) => option.trim()).filter(Boolean), [options]);
  const canSubmit = title.trim().length > 0 && trimmedOptions.length >= 2 && !busy;

  if (!context) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('Add a decision title.');
      return;
    }
    if (trimmedOptions.length < 2) {
      setError('Add at least two options.');
      return;
    }
    setError(null);
    await onSubmit({
      title: nextTitle,
      description: description.trim() || null,
      deadline: deadline || null,
      options: trimmedOptions,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-create-title"
        onSubmit={handleSubmit}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-edge-secondary bg-surface-card shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-edge-faint px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-text">
              <ClipboardList size={17} strokeWidth={2.4} />
            </div>
            <h2 id="decision-create-title" className="text-lg font-semibold text-content">
              New decision
            </h2>
            <p className="mt-1 text-sm leading-5 text-content-muted">Linked to {context.targetLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-content-muted hover:text-content disabled:opacity-50"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-content-faint">Decision title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-edge-secondary bg-surface px-3 text-sm text-content outline-none focus:border-accent"
              placeholder="Choose dinner plan"
              maxLength={180}
              autoFocus
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-content-faint">Notes</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 min-h-[76px] w-full resize-y rounded-lg border border-edge-secondary bg-surface px-3 py-2 text-sm text-content outline-none focus:border-accent"
              placeholder="What should the group consider?"
              maxLength={1000}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-content-faint">Deadline</span>
            <input
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-edge-secondary bg-surface px-3 text-sm text-content outline-none focus:border-accent"
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-content-faint">Options</span>
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface-tertiary px-2.5 text-xs font-semibold text-content-muted hover:text-content"
              >
                <Plus size={13} />
                Add option
              </button>
            </div>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={option}
                    onChange={(event) =>
                      setOptions((prev) =>
                        prev.map((item, itemIndex) => (itemIndex === index ? event.target.value : item))
                      )
                    }
                    className="h-10 min-w-0 flex-1 rounded-lg border border-edge-secondary bg-surface px-3 text-sm text-content outline-none focus:border-accent"
                    placeholder={`Option ${index + 1}`}
                    maxLength={180}
                  />
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    disabled={options.length <= 2}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-content-muted hover:text-[#dc2626] disabled:cursor-default disabled:opacity-40"
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-edge-faint px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-surface-tertiary px-4 text-sm font-semibold text-content-muted hover:text-content disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text hover:opacity-90 disabled:cursor-default disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Create decision'}
          </button>
        </footer>
      </form>
    </div>
  );
}
