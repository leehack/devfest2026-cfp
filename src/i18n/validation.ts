import type { ZodIssue } from 'zod';
import type { Dictionary } from './en';

/**
 * Turns a zod issue into a translated message.
 *
 * zod's own strings are English-only, so at a bilingual event they would leave a
 * French applicant with English errors on the fields they got wrong. Custom
 * issues carry `params.key`; the built-in codes are mapped here.
 */
export function validationMessage(issue: ZodIssue, t: Dictionary): string {
  const e = t.errors;

  if (issue.code === 'custom') {
    const key = (issue.params as { key?: string } | undefined)?.key;
    return (key && e.rules[key]) || e.invalid;
  }

  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? e.required : e.invalid;

    case 'too_small':
      // A one-character floor is "you left this blank", not a length rule.
      return issue.minimum === 1 ? e.required : e.tooShort(Number(issue.minimum));

    case 'too_big':
      return e.tooLong(Number(issue.maximum));

    case 'invalid_enum_value':
      return e.chooseOne;

    case 'invalid_literal':
      // Only the acknowledgements use a literal, and all three are `true`.
      return e.mustAgree;

    case 'invalid_string':
      return e.email; // email is the only string format the schema checks

    default:
      return e.invalid;
  }
}
