import { LIMITS, SOCIAL_PLATFORMS, type SocialPlatform } from '@shared/enums';
import type { Social } from '@shared/types';
import { useI18n } from '../i18n/context';

interface SocialsInputProps {
  value: Social[];
  onChange: (v: Social[]) => void;
  disabled?: boolean;
}

/**
 * §3 stores socials as `[{platform, handle}]` rather than fixed columns, so a
 * platform nobody has heard of yet does not need a schema migration.
 */
export function SocialsInput({ value, onChange, disabled }: SocialsInputProps) {
  const { t } = useI18n();

  const update = (index: number, patch: Partial<Social>) =>
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const add = () => onChange([...value, { platform: 'website', handle: '' }]);

  return (
    <div className="field">
      <span className="field__label">
        {t.speaker.socials}
        <span className="field__requirement">{t.form.optional}</span>
      </span>
      <p className="field__help">{t.speaker.socialsHelp}</p>

      {value.map((social, i) => (
        <div className="socials__row" key={i}>
          <select
            className="field__input field__input--select socials__platform"
            value={social.platform}
            disabled={disabled}
            aria-label={t.speaker.platform}
            onChange={(e) => update(i, { platform: e.target.value as SocialPlatform })}
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t.enums.socialPlatform[p]}
              </option>
            ))}
          </select>
          <input
            className="field__input socials__handle"
            value={social.handle}
            maxLength={LIMITS.handleMax}
            disabled={disabled}
            aria-label={t.speaker.handle}
            placeholder={t.speaker.handle}
            onChange={(e) => update(i, { handle: e.target.value })}
          />
          <button
            type="button"
            className="btn btn--ghost"
            disabled={disabled}
            onClick={() => remove(i)}
          >
            {t.speaker.removeSocial}
          </button>
        </div>
      ))}

      {value.length < LIMITS.maxSocials && (
        <button type="button" className="btn btn--ghost" disabled={disabled} onClick={add}>
          + {t.speaker.addSocial}
        </button>
      )}
    </div>
  );
}
