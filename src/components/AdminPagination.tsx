import { useI18n } from '../i18n/context';

export function AdminPagination({
  page,
  pageSize,
  totalItems,
  hasPrevious,
  hasNext,
  busy = false,
  onPrevious,
  onNext,
}: {
  page: number;
  pageSize?: number;
  totalItems?: number;
  hasPrevious: boolean;
  hasNext: boolean;
  busy?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  if (!hasPrevious && !hasNext) return null;

  const hasTotals =
    typeof totalItems === 'number' &&
    totalItems > 0 &&
    typeof pageSize === 'number' &&
    pageSize > 0;
  const totalPages = hasTotals ? Math.ceil(totalItems / pageSize) : null;
  const startItem = hasTotals ? page * pageSize + 1 : null;
  const endItem = hasTotals ? Math.min(totalItems, (page + 1) * pageSize) : null;

  return (
    <nav className="admin-pagination" aria-label={t.platformAdmin.paginationLabel}>
      {hasTotals && startItem !== null && endItem !== null && (
        <p className="admin-pagination__range">
          {t.platformAdmin.paginationRange
            .replace('{start}', String(startItem))
            .replace('{end}', String(endItem))
            .replace('{total}', String(totalItems))}
        </p>
      )}
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
          {totalPages !== null
            ? t.platformAdmin.paginationPage
                .replace('{current}', String(page + 1))
                .replace('{total}', String(totalPages))
            : t.platformAdmin.paginationCurrent.replace('{current}', String(page + 1))}
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
