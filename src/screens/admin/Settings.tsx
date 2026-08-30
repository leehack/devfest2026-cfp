import { useCallback, useEffect, useRef, useState } from 'react';

import { Checkbox, RadioGroup, TextAreaField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n/context';
import {
  addZonedCalendarDays,
  toDate,
  toZonedDateTimeInput,
  zonedDateTimeToIso,
} from '../../lib/dates';
import { adminError } from '../../lib/errors';
import { archiveCfp, deleteCfp, loadCfp, setCfpWindow, updateCfp } from '../../lib/roles';
import { invalidateCache } from '../../lib/cache';
import { navigate } from '../../lib/router';
import { useLatest } from '../../lib/useLatest';
import { Result } from './Result';
import type { CfpRole, Visibility } from '@shared/cfp';
import { CFP_LIMITS } from '@shared/cfp';
import type { Cfp } from '@shared/types';

export function Settings({
  cfpId,
  role,
  onDirtyChange,
  onCfpChange,
}: {
  cfpId: string;
  role: CfpRole;
  onDirtyChange?: (dirty: boolean) => void;
  onCfpChange?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionFr, setDescriptionFr] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [eventTimeZone, setEventTimeZone] = useState('America/Toronto');
  const [venue, setVenue] = useState('');
  const [place, setPlace] = useState('');
  const [website, setWebsite] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [blindReview, setBlindReview] = useState(false);
  const [archived, setArchived] = useState(false);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [paused, setPaused] = useState(false);
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [programmePublished, setProgrammePublished] = useState(false);
  const [windowTimeZone, setWindowTimeZone] = useState('America/Toronto');
  const [loadedCfp, setLoadedCfp] = useState('');
  const [failedCfp, setFailedCfp] = useState('');
  const [identityBaseline, setIdentityBaseline] = useState('');
  const [windowBaseline, setWindowBaseline] = useState('');
  /*
   * Starts true, so the fields are disabled until the call's current settings
   * have arrived. Editable-but-empty is a trap: type into it fast enough and the
   * load lands afterwards and replaces what you wrote. Every field already reads
   * `busy`, so this costs nothing but the initial value.
   */
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const activeCfp = useRef(cfpId);
  const generation = useRef(0);
  activeCfp.current = cfpId;
  const identityState = JSON.stringify([
    name,
    visibility,
    descriptionEn,
    descriptionFr,
    eventDate,
    eventEndDate,
    eventTimeZone,
    venue,
    place,
    website,
    primaryColor,
    accentColor,
    blindReview,
  ]);
  const windowState = JSON.stringify([opensAt, closesAt, paused, reviewsVisible]);
  const dirty =
    loadedCfp === cfpId &&
    ((identityBaseline !== '' && identityState !== identityBaseline) ||
      (windowBaseline !== '' && windowState !== windowBaseline));

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const refresh = useCallback(
    async (force = false) => {
      const scope = cfpId;
      const request = ++generation.current;
      const current = () =>
        activeCfp.current === scope && generation.current === request;

      const applyCfp = (cfp: Cfp | null) => {
        if (!current()) return false;
        if (!cfp) {
          setError(tRef.current.errors.notFound);
          setLoadedCfp('');
          setFailedCfp(scope);
          return false;
        }
        const nextName = cfp.name ?? '';
        const nextVisibility = (cfp.visibility ?? 'public') as Visibility;
        const nextDescriptionEn = cfp.description?.en ?? '';
        const nextDescriptionFr = cfp.description?.fr ?? '';
        const nextEventDate = cfp.eventStartDate ?? cfp.eventDate ?? '';
        const nextEventEndDate = cfp.eventEndDate ?? nextEventDate;
        const nextEventTimeZone = cfp.timeZone ?? 'America/Toronto';
        const nextVenue = cfp.venue ?? '';
        const nextPlace = cfp.location ?? '';
        const nextWebsite = cfp.website ?? '';
        const nextPrimaryColor = cfp.theme?.primaryColor ?? '';
        const nextAccentColor = cfp.theme?.accentColor ?? '';
        const nextBlindReview = cfp.features?.blindReview === true;
        const nextOpensAt = toZonedDateTimeInput(toDate(cfp.opensAt), nextEventTimeZone);
        const nextClosesAt = toZonedDateTimeInput(toDate(cfp.closesAt), nextEventTimeZone);

        setName(nextName);
        setVisibility(nextVisibility);
        setDescriptionEn(nextDescriptionEn);
        setDescriptionFr(nextDescriptionFr);
        setEventDate(nextEventDate);
        setEventEndDate(nextEventEndDate);
        setEventTimeZone(nextEventTimeZone);
        setWindowTimeZone(nextEventTimeZone);
        setVenue(nextVenue);
        setPlace(nextPlace);
        setWebsite(nextWebsite);
        setPrimaryColor(nextPrimaryColor);
        setAccentColor(nextAccentColor);
        setBlindReview(nextBlindReview);
        setArchived(cfp.archived === true);
        setOpensAt(nextOpensAt);
        setClosesAt(nextClosesAt);
        setPaused(cfp.paused === true);
        setReviewsVisible(cfp.reviewsVisible === true);
        setProgrammePublished(Boolean(cfp.publishedScheduleId));
        setIdentityBaseline(
          JSON.stringify([
            nextName,
            nextVisibility,
            nextDescriptionEn,
            nextDescriptionFr,
            nextEventDate,
            nextEventEndDate,
            nextEventTimeZone,
            nextVenue,
            nextPlace,
            nextWebsite,
            nextPrimaryColor,
            nextAccentColor,
            nextBlindReview,
          ]),
        );
        setWindowBaseline(
          JSON.stringify([
            nextOpensAt,
            nextClosesAt,
            cfp.paused === true,
            cfp.reviewsVisible === true,
          ]),
        );
        setLoadedCfp(scope);
        setFailedCfp('');
        setError('');
        return true;
      };

      try {
        const revalidatedCfp = { current: null as { value: Cfp | null } | null };
        const cfp = await loadCfp(cfpId, {
          force,
          onRevalidate: (fresh) => {
            if (current() && !dirtyRef.current) {
              revalidatedCfp.current = { value: fresh };
              applyCfp(fresh);
            }
          },
        });
        return applyCfp(revalidatedCfp.current ? revalidatedCfp.current.value : cfp);
      } catch (e) {
        if (!current()) return false;
        setError(adminError(e, tRef.current));
        setFailedCfp(scope);
        return false;
      }
    },
    [cfpId, tRef],
  );

  /*
   * Keyed on the call, not on the loader's identity. The loader is rebuilt
   * whenever the dictionary changes — and the dictionary changes once on every
   * page load now, because the locale cannot be known until after mount. Running
   * it again would refetch and overwrite whatever is on screen unsaved.
   */
  useEffect(() => {
    generation.current += 1;
    setLoadedCfp('');
    setFailedCfp('');
    setIdentityBaseline('');
    setWindowBaseline('');
    setBusy(true);
    setNote('');
    setError('');
    const scope = cfpId;
    void refresh().finally(() => {
      if (activeCfp.current === scope) setBusy(false);
    });
  }, [cfpId, refresh]);

  /** One `busy`, one `Result`: two saves running at once is not a state to design for. */
  async function run(
    work: (current: () => boolean) => Promise<void>,
    ok: string,
    after: (current: () => boolean) => Promise<unknown> | void = () => refresh(true),
  ) {
    const scope = cfpId;
    const current = () => activeCfp.current === scope;
    setBusy(true);
    setNote('');
    setError('');
    try {
      await work(current);
      if (!current()) return;
      await after(current);
      if (current()) setNote(ok);
    } catch (e) {
      if (current()) setError(adminError(e, tRef.current));
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function retry() {
    const scope = cfpId;
    setBusy(true);
    setError('');
    try {
      await refresh();
    } finally {
      if (activeCfp.current === scope) setBusy(false);
    }
  }

  async function saveIdentity() {
    if (archived) return;
    const previousWindowTimeZone = windowTimeZone;
    const next = {
      name: name.trim(),
      visibility,
      descriptionEn: descriptionEn.trim(),
      descriptionFr: descriptionFr.trim(),
      eventDate: eventDate.trim(),
      eventEndDate: eventEndDate.trim(),
      eventTimeZone: eventTimeZone.trim(),
      venue: venue.trim(),
      place: place.trim(),
      website: website.trim(),
    };
    await run(
      async () =>
        void (await updateCfp({
          cfpId,
          name: next.name,
          visibility: next.visibility,
          description: { en: next.descriptionEn, fr: next.descriptionFr },
          eventStartDate: next.eventDate,
          eventEndDate: next.eventEndDate,
          timeZone: next.eventTimeZone,
          venue: next.venue,
          location: next.place,
          website: next.website,
          theme: {
            ...(primaryColor.trim() ? { primaryColor: primaryColor.trim() } : {}),
            ...(accentColor.trim() ? { accentColor: accentColor.trim() } : {}),
          },
          features: {
            blindReview,
          },
        })),
      t.admin.identitySaved,
      () => {
        const inNextZone = (value: string) => {
          const instant = zonedDateTimeToIso(value, previousWindowTimeZone);
          return instant
            ? toZonedDateTimeInput(new Date(instant), next.eventTimeZone)
            : value;
        };
        const nextOpensAt = inNextZone(opensAt);
        const nextClosesAt = inNextZone(closesAt);
        let nextWindowBaseline = windowBaseline;
        try {
          const [baselineOpens, baselineCloses, baselinePaused, baselineReviews] = JSON.parse(
            windowBaseline,
          ) as [string, string, boolean, boolean];
          nextWindowBaseline = JSON.stringify([
            inNextZone(baselineOpens),
            inNextZone(baselineCloses),
            baselinePaused,
            baselineReviews,
          ]);
        } catch {
          // An empty baseline only exists while loading, when the save is disabled.
        }
        setName(next.name);
        setDescriptionEn(next.descriptionEn);
        setDescriptionFr(next.descriptionFr);
        setEventDate(next.eventDate);
        setEventEndDate(next.eventEndDate);
        setEventTimeZone(next.eventTimeZone);
        setWindowTimeZone(next.eventTimeZone);
        setOpensAt(nextOpensAt);
        setClosesAt(nextClosesAt);
        setWindowBaseline(nextWindowBaseline);
        setVenue(next.venue);
        setPlace(next.place);
        setWebsite(next.website);
        setPrimaryColor(primaryColor);
        setAccentColor(accentColor);
        setBlindReview(blindReview);
        setIdentityBaseline(
          JSON.stringify([
            next.name,
            next.visibility,
            next.descriptionEn,
            next.descriptionFr,
            next.eventDate,
            next.eventEndDate,
            next.eventTimeZone,
            next.venue,
            next.place,
            next.website,
            primaryColor,
            accentColor,
            blindReview,
          ]),
        );
        invalidateCache(`cfp:${cfpId}`);
        invalidateCache(`cfpWindow:${cfpId}`);
      },
    );
  }

  async function saveWindow() {
    if (archived) return;
    const opensAtIso = zonedDateTimeToIso(opensAt, windowTimeZone);
    const closesAtIso = zonedDateTimeToIso(closesAt, windowTimeZone);
    if (
      !opensAtIso ||
      !closesAtIso ||
      new Date(closesAtIso).getTime() <= new Date(opensAtIso).getTime()
    ) {
      setNote('');
      setError(t.admin.windowInvalid);
      return;
    }
    await run(
      async () =>
        void (await setCfpWindow({
          cfpId,
          opensAt: opensAtIso,
          closesAt: closesAtIso,
          paused,
          reviewsVisible,
        })),
      t.admin.windowSaved,
      () => {
        setWindowBaseline(JSON.stringify([opensAt, closesAt, paused, reviewsVisible]));
        invalidateCache(`cfp:${cfpId}`);
        invalidateCache(`cfpWindow:${cfpId}`);
      },
    );
  }

  function prepareLateIntake() {
    if (archived) return;
    const now = new Date();
    const nextOpensAt = toZonedDateTimeInput(now, windowTimeZone);
    const nextClosesAt = addZonedCalendarDays(nextOpensAt, windowTimeZone, 7);
    if (!nextClosesAt) {
      setNote('');
      setError(t.admin.windowInvalid);
      return;
    }
    setOpensAt(nextOpensAt);
    setClosesAt(nextClosesAt);
    setPaused(false);
    setReviewsVisible(false);
    setNote('');
    setError('');
  }

  if (loadedCfp !== cfpId) {
    return (
      <section className="section">
        <h2>{t.admin.tabs.settings}</h2>
        {busy || failedCfp !== cfpId ? (
          <p className="muted">{t.app.loading}</p>
        ) : (
          <>
            <Result ok="" error={error || t.errors.unavailable} />
            <button type="button" className="btn" disabled={busy} onClick={() => void retry()}>
              {t.errors.reload}
            </button>
          </>
        )}
      </section>
    );
  }

  const opensAtIso = zonedDateTimeToIso(opensAt, windowTimeZone);
  const closesAtIso = zonedDateTimeToIso(closesAt, windowTimeZone);
  const windowOpenNow = Boolean(
    !paused &&
      opensAtIso &&
      closesAtIso &&
      new Date(opensAtIso).getTime() <= Date.now() &&
      Date.now() < new Date(closesAtIso).getTime(),
  );
  const eventTimeZoneUnsaved = eventTimeZone.trim() !== windowTimeZone;

  return (
    <>
      <section className="section section--form">
        <h2>{t.admin.identity}</h2>
        <p className="section__help">{t.admin.identityHelp}</p>

        <TextField
          label={t.admin.identityName}
          value={name}
          onChange={setName}
          required
          maxLength={CFP_LIMITS.nameMax}
          disabled={busy || archived}
        />

        <RadioGroup
          label={t.admin.identityVisibility}
          help={t.platform.visibilityHelp}
          value={visibility}
          onChange={setVisibility}
          required
          disabled={busy || archived}
          options={[
            { value: 'public', label: t.platform.visibilityPublic },
            { value: 'private', label: t.platform.visibilityPrivate },
          ]}
        />

        <p className="field__help">
          {t.admin.identityAddress.replace('{url}', `${location.origin}/c/${cfpId}`)}
        </p>

        {/* Everything below is the public page rather than the machinery, but it
            saves with the name above: two Save buttons on one form is two ways
            to lose the half you did not press. */}
        <h3 className="card__subtitle">{t.admin.about}</h3>
        <p className="field__help">{t.admin.aboutHelp}</p>

        <TextAreaField
          label={t.admin.descriptionEn}
          value={descriptionEn}
          onChange={setDescriptionEn}
          maxLength={CFP_LIMITS.descriptionMax}
          rows={5}
          disabled={busy || archived}
        />
        <TextAreaField
          label={t.admin.descriptionFr}
          help={t.admin.descriptionFrHelp}
          value={descriptionFr}
          onChange={setDescriptionFr}
          maxLength={CFP_LIMITS.descriptionMax}
          rows={5}
          disabled={busy || archived}
        />

        <div className="grid grid--2 grid--align-controls">
          <TextField
            label={t.admin.eventStartDate}
            type="date"
            value={eventDate}
            onChange={setEventDate}
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.eventEndDate}
            type="date"
            value={eventEndDate}
            onChange={setEventEndDate}
            min={eventDate || undefined}
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.eventTimeZone}
            value={eventTimeZone}
            onChange={setEventTimeZone}
            placeholder="America/Toronto"
            maxLength={CFP_LIMITS.timeZoneMax}
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.eventWebsite}
            type="url"
            value={website}
            onChange={setWebsite}
            maxLength={CFP_LIMITS.websiteMax}
            placeholder="https://"
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.eventVenue}
            value={venue}
            onChange={setVenue}
            maxLength={CFP_LIMITS.venueMax}
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.eventLocation}
            help={t.admin.eventLocationHelp}
            value={place}
            onChange={setPlace}
            maxLength={CFP_LIMITS.locationMax}
            disabled={busy || archived}
          />
        </div>

        <h3 className="card__subtitle">{t.admin.themeTitle}</h3>
        <p className="field__help">{t.admin.themeHelp}</p>

        <Checkbox
          label={t.admin.blindReview}
          help={t.admin.blindReviewHelp}
          checked={blindReview}
          onChange={setBlindReview}
          disabled={busy || archived}
        />

        <div className="grid grid--2 grid--align-controls">
          <TextField
            label={t.admin.primaryColor}
            value={primaryColor}
            onChange={setPrimaryColor}
            placeholder="#1a73e8"
            maxLength={7}
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.accentColor}
            value={accentColor}
            onChange={setAccentColor}
            placeholder="#1769d2"
            maxLength={7}
            disabled={busy || archived}
          />
        </div>

        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || archived || !name.trim()}
          onClick={() => void saveIdentity()}
        >
          {t.admin.identitySave}
        </button>
      </section>

      <section className="section section--form" id="late-intake-window">
        <h2>{t.admin.window}</h2>

        {programmePublished && (
          <aside className="window-lifecycle-note" aria-labelledby="late-intake-window-title">
            <p className="window-lifecycle-note__eyebrow">{t.admin.lateIntakeEyebrow}</p>
            <h3 id="late-intake-window-title">
              {windowOpenNow ? t.admin.lateIntakeWindowOpen : t.admin.lateIntakeWindowClosed}
            </h3>
            <p>{t.admin.lateIntakeWindowHelp}</p>
            {!windowOpenNow && (
              <div className="window-lifecycle-note__action">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || archived || eventTimeZoneUnsaved}
                  onClick={prepareLateIntake}
                >
                  {t.admin.prepareLateIntake}
                </button>
                <p>{t.admin.prepareLateIntakeHelp}</p>
              </div>
            )}
            {reviewsVisible && (
              <p className="window-lifecycle-note__warning" role="alert">
                {t.admin.lateIntakeScoresWarning}
              </p>
            )}
          </aside>
        )}

        <div className="grid grid--2">
          <TextField
            label={t.admin.opensAtLabel}
            type="datetime-local"
            value={opensAt}
            onChange={setOpensAt}
            required
            disabled={busy || archived}
          />
          <TextField
            label={t.admin.closesAtLabel}
            type="datetime-local"
            value={closesAt}
            onChange={setClosesAt}
            required
            disabled={busy || archived}
          />
        </div>
        <p className="field__help">
          {t.admin.windowTimeZone.replace('{zone}', windowTimeZone)}
        </p>
        {eventTimeZoneUnsaved && (
          <p className="field__error" role="alert">
            {t.admin.windowTimeZoneUnsaved}
          </p>
        )}

        <Checkbox
          label={t.admin.pausedLabel}
          help={t.admin.pausedHelp}
          checked={paused}
          onChange={setPaused}
          disabled={busy || archived}
        />

        <Checkbox
          label={t.admin.reviewsVisibleLabel}
          help={t.admin.reviewsVisibleHelp}
          checked={reviewsVisible}
          onChange={setReviewsVisible}
          disabled={busy || archived}
        />

        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || archived || !opensAt || !closesAt || eventTimeZoneUnsaved}
          onClick={() => void saveWindow()}
        >
          {t.admin.saveWindow}
        </button>
      </section>

      <Lifecycle
        cfpId={cfpId}
        role={role}
        archived={archived}
        onCfpChange={onCfpChange}
        busy={busy}
        run={run}
        note={note}
        error={error}
        dirty={dirty}
      />
    </>
  );
}

/**
 * Archiving and deleting, both owner-only and kept together at the foot of the
 * page. The callables refuse a non-owner regardless; hiding the controls is so
 * that an admin is not offered a button that will only ever tell them no.
 */
function Lifecycle({
  cfpId,
  role,
  archived,
  onCfpChange,
  busy,
  run,
  note,
  error,
  dirty,
}: {
  cfpId: string;
  role: CfpRole;
  archived: boolean;
  onCfpChange?: () => void | Promise<void>;
  busy: boolean;
  run: (
    work: (current: () => boolean) => Promise<void>,
    ok: string,
    after?: (current: () => boolean) => Promise<unknown> | void,
  ) => Promise<void>;
  note: string;
  error: string;
  dirty: boolean;
}) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState('');

  if (role !== 'owner') {
    return (
      <section className="section">
        <Result ok={note} error={error} />
        <p className="muted">{t.admin.ownerOnly}</p>
      </section>
    );
  }

  return (
    <>
      <section className="section section--form" id="event-closeout">
        <h2>{t.admin.archive}</h2>
        <p className="section__help">{t.admin.archiveHelp}</p>
        <button
          type="button"
          className="btn"
          disabled={busy || dirty}
          onClick={() => {
            if (!archived && !window.confirm(t.admin.archiveConfirm)) return;
            void run(
              async () => {
                await archiveCfp({ cfpId, archived: !archived });
                await onCfpChange?.();
              },
              archived ? t.admin.unarchived : t.admin.archived,
            );
          }}
        >
          {archived ? t.admin.unarchiveAction : t.admin.archiveAction}
        </button>
      </section>

      <section className="section section--form">
        <h2>{t.admin.danger}</h2>
        <p className="section__help">{t.admin.dangerHelp}</p>
        {!archived ? (
          <p className="field__help">{t.admin.dangerNeedsArchive}</p>
        ) : (
          <>
            <TextField
              label={t.admin.dangerConfirmLabel.replace('{id}', cfpId)}
              value={confirm}
              onChange={setConfirm}
              // Every field carries a required/optional chip, and "Optional"
              // beside "type the address to confirm" reads as the opposite of
              // what this control is for.
              required
              disabled={busy || dirty}
            />
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy || dirty || confirm !== cfpId}
              onClick={() => {
                if (!window.confirm(t.admin.dangerConfirm)) return;
                void run(async (current) => {
                  await deleteCfp({ cfpId, confirm });
                  if (current()) navigate('home');
                }, t.admin.dangerDeleting);
              }}
            >
              {t.admin.dangerAction}
            </button>
          </>
        )}
      </section>

      <Result ok={note} error={error} />
    </>
  );
}
