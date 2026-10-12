import { useEffect, useRef } from 'react';
import { Spinner } from './States';

// Accessible confirmation built on <dialog> (no window.confirm).
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, busy, onConfirm, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { if (busy) e.preventDefault(); }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[4px] border border-line-strong bg-ink-900 p-0 text-fg shadow-2xl shadow-black/60 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 className="display text-3xl">{title}</h2>
        <div className="mt-3 text-sm leading-relaxed text-muted">{children}</div>
        <div className="mt-8 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
