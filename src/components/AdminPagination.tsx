import { useI18n } from '../i18n/context';

export function AdminPagination({
  page,
  hasPrevious,
  hasNext,
  busy = false,
  onPrevious,
  onNext,
}: {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  busy?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  if (!hasPrevious && !hasNext) return null;

  return (
    <nav className="admin-pagination" aria-label={t.platformAdmin.paginationLabel}>
      <div className="admin-pagination__controls">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!hasPrevious || busy}
          onClick={onPrevious}
        >
          ← {t.platformAdmin.paginationPrevious}
        </button>
        <span className="admin-pagination__page" aria-live="polite">
          {t.platformAdmin.paginationCurrent.replace('{current}', String(page + 1))}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!hasNext || busy}
          onClick={onNext}
        >
          {t.platformAdmin.paginationNext} →
        </button>
      </div>
    </nav>
  );
}
