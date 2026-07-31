import { useId, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';

interface CommonProps {
  label: string;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

function Requirement({ required }: { required?: boolean }) {
  const { t } = useI18n();
  return <span className="field__requirement">{required ? t.form.required : t.form.optional}</span>;
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="field__error" id={id}>
      {message}
    </p>
  );
}

interface ShellProps extends CommonProps {
  htmlFor?: string;
  children: ReactNode;
  /** Rendered under the input, e.g. a character counter. */
  meta?: ReactNode;
  helpId?: string;
  errorId?: string;
  metaId?: string;
}

function Shell({
  label,
  help,
  error,
  required,
  htmlFor,
  children,
  meta,
  helpId,
  errorId,
  metaId,
}: ShellProps) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        <Requirement required={required} />
      </label>
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
      {children}
      {/* Rendered only when occupied — an always-present row reserved ~18px of
          nothing under every field, which is most of why the form scrolled. */}
      {(error || meta) && (
        <div className="field__foot">
          <FieldError id={errorId} message={error} />
          {meta && (
            <span className="field__meta" id={metaId}>
              {meta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- text inputs

interface TextFieldProps extends CommonProps {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  type?: 'text' | 'email' | 'date' | 'datetime-local' | 'url' | 'password';
  placeholder?: string;
  min?: string;
}

export function TextField({
  label,
  value,
  onChange,
  help,
  error,
  required,
  maxLength,
  type = 'text',
  placeholder,
  disabled,
  min,
}: TextFieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Shell
      label={label}
      help={help}
      error={error}
      required={required}
      htmlFor={id}
      helpId={helpId}
      errorId={errorId}
    >
      <input
        id={id}
        className="field__input"
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={helpId}
        aria-errormessage={errorId}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

interface TextAreaFieldProps extends Omit<TextFieldProps, 'type' | 'min'> {
  rows?: number;
  minLength?: number;
}

export function TextAreaField({
  label,
  value,
  onChange,
  help,
  error,
  required,
  maxLength,
  minLength,
  rows = 6,
  placeholder,
  disabled,
}: TextAreaFieldProps) {
  const id = useId();
  const { t } = useI18n();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  // Below the floor, count up to it; above it, count down to the cap. Applicants
  // stall on "200 characters minimum" without a live number.
  let meta: string | undefined;
  if (minLength && value.length < minLength) {
    meta = t.form.charsNeeded(minLength - value.length);
  } else if (maxLength) {
    meta = t.form.charsRemaining(maxLength - value.length);
  }
  const metaId = meta ? `${id}-meta` : undefined;
  const describedBy = [helpId, metaId].filter(Boolean).join(' ') || undefined;

  return (
    <Shell
      label={label}
      help={help}
      error={error}
      required={required}
      htmlFor={id}
      meta={meta}
      helpId={helpId}
      errorId={errorId}
      metaId={metaId}
    >
      <textarea
        id={id}
        className="field__input field__input--area"
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={describedBy}
        aria-errormessage={errorId}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

// -------------------------------------------------------------------- choices

interface Option<T extends string> {
  value: T;
  label: string;
  /** Longer explanatory line, used by the attendance radio group. */
  description?: string;
}

interface ChoiceProps<T extends string> extends CommonProps {
  value: T | '';
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  help,
  error,
  required,
  disabled,
}: ChoiceProps<T>) {
  const { t } = useI18n();
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const hasEmptyOption = options.some((option) => option.value === '');
  return (
    <Shell
      label={label}
      help={help}
      error={error}
      required={required}
      htmlFor={id}
      helpId={helpId}
      errorId={errorId}
    >
      <select
        id={id}
        className="field__input field__input--select"
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-required={required}
        aria-describedby={helpId}
        aria-errormessage={errorId}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {!hasEmptyOption && (
          <option value="" disabled>
            {t.form.answerPick}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  help,
  error,
  required,
  disabled,
}: ChoiceProps<T>) {
  const name = useId();
  const helpId = help ? `${name}-help` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset
      className={`field fieldset${error ? ' field--error' : ''}`}
      aria-invalid={Boolean(error)}
      aria-required={required}
      aria-describedby={helpId}
      aria-errormessage={errorId}
    >
      <legend className="field__label">
        {label}
        <Requirement required={required} />
      </legend>
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
      <div className="radios">
        {options.map((o) => (
          <label key={o.value} className={`radio${value === o.value ? ' radio--on' : ''}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-required={required}
              aria-describedby={helpId}
              aria-errormessage={errorId}
              onChange={() => onChange(o.value)}
            />
            <span className="radio__body">
              <span className="radio__label">{o.label}</span>
              {o.description && <span className="radio__desc">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

interface CheckboxProps extends Omit<CommonProps, 'label' | 'required'> {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Checkbox({ label, checked, onChange, help, error, disabled }: CheckboxProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`checkbox${error ? ' field--error' : ''}`}>
      <label className="checkbox__row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={helpId}
          aria-errormessage={errorId}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
