import { useId, type ReactNode } from 'react';
import { useI18n } from '../i18n';

interface ShellProps {
  label: string;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  /** Rendered under the input, e.g. a character counter. */
  meta?: ReactNode;
}

function Shell({ label, help, error, required, htmlFor, children, meta }: ShellProps) {
  const { t } = useI18n();
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        <span className="field__requirement">
          {required ? t.form.required : t.form.optional}
        </span>
      </label>
      {help && <p className="field__help">{help}</p>}
      {children}
      <div className="field__foot">
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : (
          <span />
        )}
        {meta && <span className="field__meta">{meta}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- text inputs

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  maxLength?: number;
  type?: 'text' | 'email' | 'date' | 'url';
  placeholder?: string;
  disabled?: boolean;
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

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | '';
  options: readonly Option<T>[];
  onChange: (v: T) => void;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
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
}: SelectFieldProps<T>) {
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

interface RadioGroupProps<T extends string> {
  label: string;
  value: T | '';
  options: readonly Option<T>[];
  onChange: (v: T) => void;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
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
}: RadioGroupProps<T>) {
  const name = useId();
  const { t } = useI18n();
  return (
    <fieldset className={`field fieldset${error ? ' field--error' : ''}`}>
      <legend className="field__label">
        {label}
        <span className="field__requirement">
          {required ? t.form.required : t.form.optional}
        </span>
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
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  disabled?: boolean;
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
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
