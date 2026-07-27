import { useId, type ReactNode } from 'react';
import { useI18n } from '../i18n';

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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  );
}

interface ShellProps extends CommonProps {
  htmlFor?: string;
  children: ReactNode;
  /** Rendered under the input, e.g. a character counter. */
  meta?: ReactNode;
}

function Shell({ label, help, error, required, htmlFor, children, meta }: ShellProps) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        <Requirement required={required} />
      </label>
      {help && <p className="field__help">{help}</p>}
      {children}
      {/* Rendered only when occupied — an always-present row reserved ~18px of
          nothing under every field, which is most of why the form scrolled. */}
      {(error || meta) && (
        <div className="field__foot">
          <FieldError message={error} />
          {meta && <span className="field__meta">{meta}</span>}
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
  return (
    <Shell label={label} help={help} error={error} required={required} htmlFor={id}>
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

  // Below the floor, count up to it; above it, count down to the cap. Applicants
  // stall on "200 characters minimum" without a live number.
  let meta: string | undefined;
  if (minLength && value.length < minLength) {
    meta = t.form.charsNeeded(minLength - value.length);
  } else if (maxLength) {
    meta = t.form.charsRemaining(maxLength - value.length);
  }

  return (
    <Shell
      label={label}
      help={help}
      error={error}
      required={required}
      htmlFor={id}
      meta={meta}
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
  const id = useId();
  return (
    <Shell label={label} help={help} error={error} required={required} htmlFor={id}>
      <select
        id={id}
        className="field__input field__input--select"
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value as T)}
      >
        <option value="" disabled />
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
  return (
    <fieldset className={`field fieldset${error ? ' field--error' : ''}`}>
      <legend className="field__label">
        {label}
        <Requirement required={required} />
      </legend>
      {help && <p className="field__help">{help}</p>}
      <div className="radios">
        {options.map((o) => (
          <label key={o.value} className={`radio${value === o.value ? ' radio--on' : ''}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="radio__body">
              <span className="radio__label">{o.label}</span>
              {o.description && <span className="radio__desc">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

interface CheckboxProps extends Omit<CommonProps, 'label' | 'help' | 'required'> {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Checkbox({ label, checked, onChange, error, disabled }: CheckboxProps) {
  return (
    <div className={`checkbox${error ? ' field--error' : ''}`}>
      <label className="checkbox__row">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      <FieldError message={error} />
    </div>
  );
}
