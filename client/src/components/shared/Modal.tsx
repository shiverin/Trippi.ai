import { X } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

const sizeClasses: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-5xl',
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  size?: string;
  footer?: React.ReactNode;
  hideCloseButton?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  footer,
  hideCloseButton = false,
}: ModalProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEsc]);

  const mouseDownTarget = useRef<EventTarget | null>(null);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="trek-modal-backdrop trek-backdrop-enter fixed inset-0 z-[200] flex items-start justify-center bg-[rgba(15,23,42,0.5)] px-4 sm:items-center"
      style={{ paddingTop: 70, paddingBottom: 'calc(20px + var(--bottom-nav-h))', overflow: 'hidden' }}
      onMouseDown={(e) => {
        mouseDownTarget.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) onClose();
        mouseDownTarget.current = null;
      }}
    >
      <div
        className={`trek-modal-enter w-full overflow-hidden rounded-2xl shadow-2xl ${sizeClasses[size] || sizeClasses.md} flex max-h-[calc(100dvh-var(--bottom-nav-h)-90px)] flex-col bg-surface-card sm:max-h-[calc(100dvh-90px)]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — stays put even while the body scrolls */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-edge-secondary p-6">
          <h2 className="text-lg font-semibold text-content">{title}</h2>
          {!hideCloseButton && (
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body — scrolls when content overflows. min-h-0 lets the flex child shrink below its intrinsic height. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

        {/* Footer — sticky at the bottom of the modal, never compressed */}
        {footer && <div className="flex-shrink-0 border-t border-edge-secondary p-6">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
