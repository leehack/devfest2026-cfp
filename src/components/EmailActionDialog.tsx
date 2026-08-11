import { useEffect, useRef } from 'react';

import { useI18n } from '../i18n/context';

export interface EmailReviewRow {
  logId: string;
  kind: string;
  to: string;
  title?: string;
  status?: string;
}

export type EmailReviewAction = 'release' | 'retry' | 'resend' | 'compose';

export function EmailActionDialog({
  action,
  rows,
  busy,
  message,
  error = '',
  onCancel,
  onConfirm,
}: {
  action: EmailReviewAction;
  rows: EmailReviewRow[];
  busy: boolean;
  message?: { subject: string; body: string };
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  busyRef.current = busy;
  onCancelRef.current = onCancel;
  const recipientCount = new Set(rows.map((row) => row.to)).size;
  const kindCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return counts;
  }, {});
  const title = t.admin.emailReview[`${action}Title`];
  const help = t.admin.emailReview[`${action}Help`];
  const showStatus = action === 'retry' || action === 'resend';

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current) return;
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="schedule-dialog-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="schedule-dialog email-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-review-title"
        aria-describedby="email-review-help"
        tabIndex={-1}
      >
        <div className="schedule-dialog__heading">
          <div>
            <p>{t.admin.emailReview.eyebrow}</p>
            <h3 id="email-review-title">{title}</h3>
          </div>
          <button
            data-autofocus
            type="button"
            className="btn btn--ghost btn--compact"
            disabled={busy}
            onClick={onCancel}
          >
            {t.admin.emailReview.close}
          </button>
        </div>

        <p id="email-review-help" className="email-review-dialog__help">
          {help}
        </p>

        <dl className="email-review-dialog__summary">
          <div>
            <dt>{t.admin.emailReview.messages}</dt>
            <dd>{rows.length}</dd>
          </div>
          <div>
            <dt>{t.admin.emailReview.recipients}</dt>
            <dd>{recipientCount}</dd>
          </div>
          <div>
            <dt>{t.admin.emailReview.types}</dt>
            <dd>{Object.keys(kindCounts).length}</dd>
          </div>
        </dl>

        <ul className="email-review-dialog__kinds" aria-label={t.admin.emailReview.typeBreakdown}>
          {Object.entries(kindCounts).map(([kind, count]) => (
            <li key={kind}>
              <span>{t.admin.emailKinds[kind] ?? kind}</span>
              <strong>{count}</strong>
            </li>
          ))}
        </ul>

        {message && (
          <div className="email-review-dialog__message">
            <p>
              <span>{t.admin.messageSubject}</span>
              <strong>{message.subject}</strong>
            </p>
            <pre>{message.body}</pre>
          </div>
        )}

        <div
          className="table__scroll table__scroll--focusable"
          role="region"
          aria-label={t.admin.emailReview.listLabel}
          tabIndex={0}
        >
          <table className="table table--email-review">
            <thead>
              <tr>
                <th scope="col">{t.admin.emailKind}</th>
                <th scope="col">{t.admin.emailTo}</th>
                <th scope="col">{t.proposal.title}</th>
                {showStatus && <th scope="col">{t.admin.emailStatusColumn}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.logId}>
                  <td data-label={t.admin.emailKind}>
                    {t.admin.emailKinds[row.kind] ?? row.kind}
                  </td>
                  <td className="table__wrap" data-label={t.admin.emailTo}>
                    {row.to}
                  </td>
                  <td className="table__wrap" data-label={t.proposal.title}>
                    {row.title || '—'}
                  </td>
                  {showStatus && (
                    <td data-label={t.admin.emailStatusColumn}>
                      {(t.admin.emailStatus as Record<string, string>)[row.status ?? ''] ??
                        row.status ??
                        '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}

        <div className="schedule-dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t.admin.emailReview.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {action === 'release'
              ? t.admin.emailReview.confirmRelease(rows.length)
              : action === 'retry'
                ? t.admin.emailReview.confirmRetry(rows.length)
                : action === 'resend'
                  ? t.admin.emailReview.confirmResend
                  : t.admin.emailReview.confirmCompose(rows.length)}
          </button>
        </div>
      </section>
    </div>
  );
}
