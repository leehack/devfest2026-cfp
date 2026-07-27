import { useEffect, useRef, type ReactNode } from 'react';

interface RevealProps {
  /** When false, children are unmounted and `onHide` fires once. */
  when: boolean;
  /**
   * `fields` — dependent inputs the applicant must fill in.
   * `note`  — static guidance text, no inputs.
   */
  variant?: 'fields' | 'note';
  /**
   * Fires on the true -> false edge so the parent can clear the values that
   * were only valid while this block was visible.
   *
   * This is the whole reason conditionals go through one component. The schema
   * rejects a `fundingSource` on a `local` applicant and a `languagePreference`
   * on a non-`either` talk, so a value left behind by a changed radio button is
   * a submit-time server error with no visible field to point at.
   */
  onHide?: () => void;
  children: ReactNode;
}

/**
 * The single conditional-reveal component (spec §3). All three dynamic sections
 * use it:
 *   1. isGde = true                        -> GDE travel guidance (§5)
 *   2. attendance.status = secured|pending -> funding source / decision date
 *   3. deliveryLanguage = either           -> language preference
 */
export function Reveal({ when, variant = 'fields', onHide, children }: RevealProps) {
  const wasVisible = useRef(when);

  useEffect(() => {
    if (wasVisible.current && !when) onHide?.();
    wasVisible.current = when;
  }, [when, onHide]);

  if (!when) return null;

  return (
    <div className={variant === 'note' ? 'reveal reveal--note' : 'reveal reveal--fields'}>
      {children}
    </div>
  );
}
