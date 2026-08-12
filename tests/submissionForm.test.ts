/**
 * The submission form as data.
 *
 * Two properties matter more than the rest. A call that has no stored config
 * must behave exactly as it did before there was one — every CFP created before
 * this feature is in that state, with live proposals under it. And a stored
 * taxonomy has to be the *only* thing the schema will accept, or configuring it
 * would be decoration.
 */

import { describe, expect, it } from 'vitest';
import {
  attendanceInputFor,
  attendanceNeedsVisa,
  attendanceWriteFor,
  DEFAULT_SUBMISSION_FORM,
  NEW_CFP_SUBMISSION_FORM,
  labelOf,
  mergeSubmissionForm,
  normaliseSubmissionForm,
  optionValues,
  rawSubmissionAttendanceFault,
  reviewerAttendanceEnabled,
  validateSubmissionForm,
  type SubmissionForm,
} from '@shared/submissionForm';
import { attendanceSchemaFor, submissionSchema } from '@shared/schema';
import { LIMITS } from '@shared/enums';

const clone = (): SubmissionForm => JSON.parse(JSON.stringify(DEFAULT_SUBMISSION_FORM));

describe('mergeSubmissionForm', () => {
  it('reads an absent document as the defaults', () => {
    expect(mergeSubmissionForm(undefined)).toEqual(DEFAULT_SUBMISSION_FORM);
    expect(mergeSubmissionForm(null)).toEqual(DEFAULT_SUBMISSION_FORM);
    expect(mergeSubmissionForm({})).toEqual(DEFAULT_SUBMISSION_FORM);
  });

  it('merges key by key, so a partial config keeps the standard taxonomy', () => {
    const merged = mergeSubmissionForm({ category: [{ value: 'ops', label: { en: 'Ops' } }] });
    expect(optionValues(merged.category)).toEqual(['ops']);
    expect(merged.format).toEqual(DEFAULT_SUBMISSION_FORM.format);
    expect(merged.level).toEqual(DEFAULT_SUBMISSION_FORM.level);
  });

  it('treats an empty acks list as an answer, not as an absence', () => {
    // An organiser who deleted all three consents meant it. Falling back to the
    // defaults here would silently put them back on every submission.
    expect(mergeSubmissionForm({ acks: [] }).acks).toEqual([]);
    expect(mergeSubmissionForm({}).acks).toEqual(DEFAULT_SUBMISSION_FORM.acks);
  });

  it('defaults `fields` to empty rather than to anything', () => {
    expect(mergeSubmissionForm({}).fields).toEqual([]);
  });

  it('keeps legacy calls on the original Montréal attendance defaults', () => {
    const merged = mergeSubmissionForm(undefined);
    expect(merged.attendance.enabled).toBe(true);
    expect(merged.attendance.needsVisa.enabled).toBe(true);
    expect(merged.attendance.title.en).toContain('Montréal');
  });

  it('defaults omitted nested attendance switches to the legacy enabled policy', () => {
    const merged = mergeSubmissionForm({ attendance: { enabled: false } });
    expect(merged.attendance.enabled).toBe(false);
    expect(merged.attendance.statusReviewerVisible).toBe(true);
    expect(merged.attendance.fundingSource.enabled).toBe(true);
    expect(merged.attendance.fundingSource.reviewerVisible).toBe(true);
  });

  it('does not reintroduce legacy optional copy into an explicit generic config', () => {
    const merged = mergeSubmissionForm(NEW_CFP_SUBMISSION_FORM);
    expect(merged.attendance.gdeGuidance).toBeUndefined();
    expect(JSON.stringify(merged.attendance)).not.toMatch(/Montréal|Montreal|Canada|GDE/);
    expect(mergeSubmissionForm(normaliseSubmissionForm(merged))).toEqual(
      normaliseSubmissionForm(merged),
    );
  });
});

describe('new CFP defaults', () => {
  it('start with generic logistics disabled and no Montréal travel consent', () => {
    expect(NEW_CFP_SUBMISSION_FORM.attendance.enabled).toBe(false);
    expect(NEW_CFP_SUBMISSION_FORM.acks.map((ack) => ack.key)).not.toContain('noTravelSupport');
    const serialized = JSON.stringify(NEW_CFP_SUBMISSION_FORM);
    expect(serialized).not.toMatch(/Montréal|Montreal|Canada|GDE/);
  });
});

describe('labels', () => {
  it('renders in the reader’s language', () => {
    expect(labelOf(DEFAULT_SUBMISSION_FORM.level, 'all', 'en')).toBe('All levels');
    expect(labelOf(DEFAULT_SUBMISSION_FORM.level, 'all', 'fr')).toBe('Tous les niveaux');
  });

  it('falls back to the stored code, so a retired choice still renders', () => {
    // Removing an option is how a choice is retired, and the talks filed under
    // it are still in front of the committee.
    expect(labelOf(DEFAULT_SUBMISSION_FORM.category, 'gone', 'en')).toBe('gone');
  });

  it('falls back to English when a French label was never written', () => {
    const options = [{ value: 'ops', label: { en: 'Ops' } }];
    expect(labelOf(options, 'ops', 'fr')).toBe('Ops');
  });
});

describe('normaliseSubmissionForm', () => {
  it('drops anything the shape does not define', () => {
    const form = clone() as SubmissionForm & { sneaky?: string };
    form.sneaky = 'rides along into every applicant’s browser';
    (form.category[0] as unknown as Record<string, unknown>).extra = true;

    const clean = normaliseSubmissionForm(form) as SubmissionForm & { sneaky?: string };
    expect(clean.sneaky).toBeUndefined();
    expect(Object.keys(clean.category[0])).toEqual(['value', 'label']);
  });

  it('trims, and drops a French label that is only whitespace', () => {
    const form = clone();
    form.category = [{ value: ' web ', label: { en: ' Web ', fr: '   ' } }];
    const [option] = normaliseSubmissionForm(form).category;
    expect(option).toEqual({ value: 'web', label: { en: 'Web' } });
  });

  it('keeps reviewer visibility explicit while defaulting legacy questions to visible', () => {
    const form = clone();
    form.fields = [
      { key: 'legacy', type: 'text', label: { en: 'Legacy' }, required: false },
      {
        key: 'privateNote',
        type: 'textarea',
        label: { en: 'Private note' },
        required: false,
        reviewerVisible: false,
      },
    ];

    expect(normaliseSubmissionForm(form).fields.map((field) => field.reviewerVisible)).toEqual([
      true,
      false,
    ]);
  });
});

describe('validateSubmissionForm', () => {
  it('accepts what DevFest already asked', () => {
    expect(validateSubmissionForm(DEFAULT_SUBMISSION_FORM)).toBeNull();
  });

  it('refuses an empty list — nobody could submit', () => {
    const form = clone();
    form.format = [];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'noOptions', key: 'format' });
  });

  it('refuses two choices that would be stored the same way', () => {
    const form = clone();
    form.level = [
      { value: 'all', label: { en: 'All' } },
      { value: 'all', label: { en: 'Everyone' } },
    ];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'duplicateValue', key: 'level' });
  });

  it('refuses a value Firestore or a URL would have to escape', () => {
    const form = clone();
    form.category = [{ value: 'Web Dev!', label: { en: 'Web' } }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'badValue', key: 'category' });
  });

  it('refuses a choice with no English label', () => {
    const form = clone();
    form.category = [{ value: 'web', label: { en: '', fr: 'Web' } }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'emptyLabel', key: 'category' });
  });

  it('refuses a delivery language the scheduling code has never heard of', () => {
    // The one list whose values are ours: `either` is what the dashboard counts
    // and what `languagePreference` exists for.
    const form = clone();
    form.deliveryLanguage = [{ value: 'klingon', label: { en: 'Klingon' } }];
    expect(validateSubmissionForm(form)).toEqual({
      problem: 'unknownLanguage',
      key: 'deliveryLanguage',
    });
  });

  it('lets a call offer only some of the four languages', () => {
    const form = clone();
    form.deliveryLanguage = [{ value: 'en', label: { en: 'English' } }];
    expect(validateSubmissionForm(form)).toBeNull();
  });

  it('refuses an optional consent — that is a question, not an agreement', () => {
    const form = clone();
    form.acks = [{ key: 'coc', type: 'checkbox', label: { en: 'Agree?' }, required: false }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'ackNotRequired', key: 'coc' });
  });

  it('refuses a photo on the submission form', () => {
    // §3: ~70% of these people will be turned down and we should not be holding
    // their picture. The confirmation form is where that question belongs.
    const form = clone();
    form.fields = [{ key: 'headshot', type: 'image', label: { en: 'Photo' }, required: false }];
    expect(validateSubmissionForm(form)).toEqual({ problem: 'noImages', key: 'headshot' });
  });

  it('refuses a non-boolean reviewer visibility value', () => {
    const form = clone();
    form.fields = [
      {
        key: 'context',
        type: 'text',
        label: { en: 'Context' },
        required: false,
        reviewerVisible: 'sometimes',
      } as unknown as SubmissionForm['fields'][number],
    ];
    expect(validateSubmissionForm(form)).toEqual({
      problem: 'badReviewerVisibility',
      key: 'context',
    });
  });

  it('requires every fixed attendance status exactly once', () => {
    const form = clone();
    form.attendance.statuses = [
      form.attendance.statuses[0],
      form.attendance.statuses[0],
      form.attendance.statuses[2],
    ];
    expect(validateSubmissionForm(form)).toEqual({
      problem: 'unknownAttendanceStatus',
      key: 'attendance.statuses',
    });
  });

  it('allows optional GDE guidance to be absent', () => {
    const form = clone();
    delete form.attendance.gdeGuidance;
    expect(validateSubmissionForm(form)).toBeNull();
  });

  it('rejects raw non-boolean attendance switches before normalisation', () => {
    expect(
      rawSubmissionAttendanceFault({
        attendance: { needsVisa: { enabled: 'sometimes' } },
      }),
    ).toEqual({
      problem: 'badAttendanceConfig',
      key: 'attendance.needsVisa.enabled',
    });
  });
});

describe('configured attendance', () => {
  it('omits the section entirely when disabled', () => {
    const form = clone();
    form.attendance.enabled = false;
    expect(attendanceInputFor(form, { status: 'pending', needsVisa: true })).toBeUndefined();
    expect(attendanceSchemaFor(form).safeParse(undefined).success).toBe(true);
    const parsed = attendanceSchemaFor(form).safeParse({ status: 'pending', needsVisa: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBeUndefined();
  });

  it('strips disabled and non-applicable properties before validation or storage', () => {
    const form = clone();
    form.attendance.needsVisa.enabled = false;
    expect(
      attendanceInputFor(form, {
        status: 'local',
        fundingSource: 'stale funding',
        decisionBy: '2026-10-01',
        needsVisa: true,
        privateNote: 'never store',
      }),
    ).toEqual({ status: 'local' });

    form.attendance.fundingSource.enabled = false;
    form.attendance.decisionBy.enabled = false;
    const parsed = attendanceSchemaFor(form).safeParse({
      status: 'pending',
      fundingSource: 'stale funding',
      decisionBy: 'not a date',
      needsVisa: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ status: 'pending' });
  });

  it('clears configured non-applicable fields but preserves disabled field history', () => {
    const form = clone();
    expect(
      attendanceWriteFor(form, {
        status: 'local',
        fundingSource: 'stale funding',
        decisionBy: '2026-10-01',
        needsVisa: false,
      }),
    ).toEqual({
      status: 'local',
      fundingSource: '',
      decisionBy: '',
      needsVisa: false,
    });

    form.attendance.fundingSource.enabled = false;
    form.attendance.decisionBy.enabled = false;
    expect(
      attendanceWriteFor(form, {
        status: 'local',
        fundingSource: 'historical funding',
        decisionBy: '2026-10-01',
        needsVisa: false,
      }),
    ).toEqual({ status: 'local', needsVisa: false });

    form.attendance.enabled = false;
    expect(attendanceWriteFor(form, { status: 'local', needsVisa: false })).toBeUndefined();
  });

  it('skips reviewer travel reads when no configured property is visible', () => {
    const form = clone();
    form.attendance.statusReviewerVisible = false;
    form.attendance.fundingSource.reviewerVisible = false;
    form.attendance.decisionBy.reviewerVisible = false;
    form.attendance.needsVisa.reviewerVisible = false;
    expect(reviewerAttendanceEnabled(form)).toBe(false);
    form.attendance.needsVisa.reviewerVisible = true;
    expect(reviewerAttendanceEnabled(form)).toBe(true);
    form.attendance.enabled = false;
    expect(reviewerAttendanceEnabled(form)).toBe(false);
  });

  it('gates visa email copy on both the section and visa field', () => {
    const form = clone();
    const attendance = { status: 'pending', needsVisa: true };
    expect(attendanceNeedsVisa(form, attendance)).toBe(true);
    form.attendance.needsVisa.enabled = false;
    expect(attendanceNeedsVisa(form, attendance)).toBe(false);
    form.attendance.needsVisa.enabled = true;
    form.attendance.enabled = false;
    expect(attendanceNeedsVisa(form, attendance)).toBe(false);
  });
});

describe('submissionSchema against a configured form', () => {
  const proposal = {
    title: 'A talk',
    abstract: 'a'.repeat(LIMITS.abstractMin),
    category: 'web',
    format: 'session_40',
    level: 'all',
    deliveryLanguage: 'en',
  };
  const speaker = {
    name: 'Someone',
    bio: 'b'.repeat(LIMITS.bioMin),
    basedIn: 'Montréal, QC',
    socials: [],
    isGde: false,
    email: 'someone@example.test',
  };
  const attendance = { status: 'local', needsVisa: false };
  const acks = { noTravelSupport: true, coc: true, recording: true };

  it('accepts the default taxonomy', () => {
    expect(submissionSchema().safeParse({ proposal, speaker, acks, attendance }).success).toBe(true);
  });

  it('rejects a value from another call’s list', () => {
    const form = clone();
    form.category = [{ value: 'ops', label: { en: 'Ops' } }];
    const result = submissionSchema(form).safeParse({ proposal, speaker, acks, attendance });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'proposal.category');
    expect((issue as { params?: { key?: string } } | undefined)?.params?.key).toBe('notAnOption');
  });

  it('requires exactly the consents this call asks for', () => {
    const form = clone();
    form.acks = [
      { key: 'coc', type: 'checkbox', label: { en: 'Code of conduct' }, required: true },
    ];
    const schema = submissionSchema(form);
    expect(schema.safeParse({ proposal, speaker, acks: { coc: true }, attendance }).success).toBe(
      true,
    );
    // The three DevFest ones are not this call's, so their absence is fine and
    // `coc` alone is the whole requirement.
    expect(schema.safeParse({ proposal, speaker, acks: {}, attendance }).success).toBe(false);
  });

  it('accepts a call that asks for no consents at all', () => {
    const form = clone();
    form.acks = [];
    expect(
      submissionSchema(form).safeParse({ proposal, speaker, acks: {}, attendance }).success,
    ).toBe(true);
  });

  it('accepts an omitted attendance payload when this event disables travel questions', () => {
    const form = clone();
    form.attendance.enabled = false;
    expect(submissionSchema(form).safeParse({ proposal, speaker, acks }).success).toBe(true);
  });
});
