import { useI18n } from '../i18n/context';

export interface FormProgressItem {
  id: string;
  label: string;
  complete: boolean;
  attention: boolean;
}

/**
 * A compact map of a long, single-page form.
 *
 * The links stay ordinary fragment links so they work before hydration, with a
 * keyboard, and in a reduced-motion browser. CSS turns the same small component
 * into a sticky rail on wide screens and a horizontal strip on narrow ones.
 */
export function FormProgress({ items }: { items: FormProgressItem[] }) {
  const { t } = useI18n();
  const completed = items.filter((item) => item.complete).length;
  const percent = items.length === 0 ? 0 : Math.round((completed / items.length) * 100);

  return (
    <nav className="form-progress" aria-label={t.form.progress}>
      <div className="form-progress__header">
        <span className="form-progress__eyebrow">{t.form.progress}</span>
        <strong className="form-progress__summary" aria-live="polite">
          {t.form.progressSummary(completed, items.length)}
        </strong>
      </div>
      <div
        className="form-progress__meter"
        role="progressbar"
        aria-label={t.form.progress}
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={completed}
      >
        <span className="form-progress__meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <ol className="form-progress__list">
        {items.map((item, index) => {
          const state = item.attention ? 'attention' : item.complete ? 'complete' : 'incomplete';
          const stateLabel =
            state === 'attention'
              ? t.form.sectionAttention
              : state === 'complete'
                ? t.form.sectionComplete
                : t.form.sectionIncomplete;

          return (
            <li key={item.id} className={`form-progress__item form-progress__item--${state}`}>
              <a
                className="form-progress__link"
                href={`#${item.id}`}
                aria-label={`${item.label} — ${stateLabel}`}
                onClick={() => {
                  requestAnimationFrame(() => {
                    document.getElementById(item.id)?.focus({ preventScroll: true });
                  });
                }}
              >
                <span className="form-progress__marker" aria-hidden="true">
                  {item.complete ? '✓' : index + 1}
                </span>
                <span className="form-progress__label">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
