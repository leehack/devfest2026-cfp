/**
 * The speaker's own details, wherever they are being edited.
 *
 * Shared by the submission form and by the profile page, because they are the
 * same document: `speakers/{uid}` belongs to the account and not to any one
 * talk. Two copies of these fields would be two places for a limit or a help
 * line to drift.
 *
 * The caller supplies the heading and the section around it — on the form this
 * is one section among several and says so; on the profile page it is the page.
 */

import { Checkbox, TextAreaField, TextField } from './fields';
import { Reveal } from './Reveal';
import { SocialsInput } from './SocialsInput';
import { useI18n } from '../i18n';
import type { FormState } from '../lib/formState';
import { LIMITS } from '@shared/enums';

export interface SpeakerFieldsProps {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  /** Errors by schema path, e.g. `speaker.bio`. Undefined until they are shown. */
  err: (path: string) => string | undefined;
}

export function SpeakerFields({ form, set, err }: SpeakerFieldsProps) {
  const { t } = useI18n();

  return (
    <>
      <TextField
        label={t.speaker.name}
        value={form.name}
        onChange={(v) => set('name', v)}
        maxLength={LIMITS.nameMax}
        error={err('speaker.name')}
        required
      />

      <TextField
        label={t.speaker.email}
        help={t.speaker.emailHelp}
        value={form.email}
        onChange={(v) => set('email', v)}
        type="email"
        error={err('speaker.email')}
        disabled
        required
      />

      <TextAreaField
        label={t.speaker.bio}
        help={t.speaker.bioHelp}
        value={form.bio}
        onChange={(v) => set('bio', v)}
        minLength={LIMITS.bioMin}
        maxLength={LIMITS.bioMax}
        rows={4}
        error={err('speaker.bio')}
        required
      />

      <div className="grid grid--2">
        {/* Not required — independents and between-jobs applicants exist (§3).
            Said by the Optional chip on both fields rather than by help text
            under one of them, which pushed its input out of line with the
            other's and read as a broken row. */}
        <TextField
          label={t.speaker.company}
          value={form.company}
          onChange={(v) => set('company', v)}
          maxLength={LIMITS.companyMax}
          error={err('speaker.company')}
        />
        <TextField
          label={t.speaker.jobTitle}
          value={form.jobTitle}
          onChange={(v) => set('jobTitle', v)}
          maxLength={LIMITS.jobTitleMax}
          error={err('speaker.jobTitle')}
        />
      </div>

      <TextField
        label={t.speaker.basedIn}
        help={t.speaker.basedInHelp}
        value={form.basedIn}
        onChange={(v) => set('basedIn', v)}
        maxLength={LIMITS.basedInMax}
        error={err('speaker.basedIn')}
        required
      />

      <SocialsInput value={form.socials} onChange={(v) => set('socials', v)} />

      {/* Stored rather than asked for again: the import at the top of the form
          reads from this, and re-pasting your own profile URL at every CFP is
          exactly the kind of retyping the import exists to remove. */}
      <TextField
        label={t.speaker.sessionizeUrl}
        help={t.speaker.sessionizeUrlHelp}
        value={form.sessionizeUrl}
        onChange={(v) => set('sessionizeUrl', v)}
        maxLength={LIMITS.handleMax}
        placeholder="sessionize.com/your-name"
        error={err('speaker.sessionizeUrl')}
      />

      <TextAreaField
        label={t.speaker.pastTalks}
        help={t.speaker.pastTalksHelp}
        value={form.pastTalks}
        onChange={(v) => set('pastTalks', v)}
        maxLength={LIMITS.pastTalksMax}
        rows={3}
        error={err('speaker.pastTalks')}
      />

      <Checkbox
        label={t.speaker.isGde}
        checked={form.isGde}
        onChange={(v) => set('isGde', v)}
      />

      {/* Conditional 1 of 3 — shown only to GDEs, per §5. */}
      <Reveal when={form.isGde} variant="note">
        {t.speaker.gdeGuidance}
      </Reveal>
    </>
  );
}
