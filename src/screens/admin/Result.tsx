/** The outcome line every one of these forms shows after a save. */
export function Result({ ok, error }: { ok: string; error: string }) {
  return (
    <div className={ok || error ? 'form-result' : undefined}>
      <div
        className={ok ? 'note note--inline' : undefined}
        role="status"
        aria-atomic="true"
      >
        {ok}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
