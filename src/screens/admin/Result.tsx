/** The outcome line every one of these forms shows after a save. */
export function Result({ ok, error }: { ok: string; error: string }) {
  return (
    <>
      {ok && <p className="note note--inline">{ok}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
