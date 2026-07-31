import { useCallback, useEffect, useRef, useState } from 'react';

import { Checkbox, RadioGroup, TextAreaField, TextField } from '../../components/fields';
import { useI18n } from '../../i18n/context';
import { toDate, toDateTimeInput } from '../../lib/dates';
import { adminError } from '../../lib/errors';
import { archiveCfp, deleteCfp, loadCfp, setCfpWindow, updateCfp } from '../../lib/roles';
import { navigate } from '../../lib/router';
import { useLatest } from '../../lib/useLatest';
import { Result } from './Result';
import type { CfpRole, Visibility } from '@shared/cfp';
import { CFP_LIMITS } from '@shared/cfp';

export function Settings({
  cfpId,
  role,
  onDirtyChange,
}: {
  cfpId: string;
  role: CfpRole;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const tRef = useLatest(t);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionFr, setDescriptionFr] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [venue, setVenue] = useState('');
  const [place, setPlace] = useState('');
  const [website, setWebsite] = useState('');
  const [archived, setArchived] = useState(false);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [paused, setPaused] = useState(false);
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [timeZone, setTimeZone] = useState('');
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
    venue,
    place,
    website,
  ]);
  const windowState = JSON.stringify([opensAt, closesAt, paused, reviewsVisible]);
  const dirty =
    loadedCfp === cfpId &&
    ((identityBaseline !== '' && identityState !== identityBaseline) ||
      (windowBaseline !== '' && windowState !== windowBaseline));

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const refresh = useCallback(async () => {
    const scope = cfpId;
    const request = ++generation.current;
    const current = () =>
      activeCfp.current === scope && generation.current === request;
    try {
      const cfp = await loadCfp(cfpId);
      if (!current()) return false;
      if (!cfp) {
        setError(tRef.current.errors.notFound);
        setFailedCfp(scope);
        return false;
      }
      const nextName = cfp.name ?? '';
      const nextVisibility = (cfp.visibility ?? 'public') as Visibility;
      const nextDescriptionEn = cfp.description?.en ?? '';
      const nextDescriptionFr = cfp.description?.fr ?? '';
      const nextEventDate = cfp.eventDate ?? '';
      const nextVenue = cfp.venue ?? '';
      const nextPlace = cfp.location ?? '';
      const nextWebsite = cfp.website ?? '';
      const nextOpensAt = toDateTimeInput(toDate(cfp.opensAt));
      const nextClosesAt = toDateTimeInput(toDate(cfp.closesAt));

      setName(nextName);
      setVisibility(nextVisibility);
      setDescriptionEn(nextDescriptionEn);
      setDescriptionFr(nextDescriptionFr);
      setEventDate(nextEventDate);
      setVenue(nextVenue);
      setPlace(nextPlace);
      setWebsite(nextWebsite);
      setArchived(cfp.archived === true);
      setOpensAt(nextOpensAt);
      setClosesAt(nextClosesAt);
      setPaused(cfp.paused === true);
      setReviewsVisible(cfp.reviewsVisible === true);
      setIdentityBaseline(
        JSON.stringify([
          nextName,
          nextVisibility,
          nextDescriptionEn,
          nextDescriptionFr,
          nextEventDate,
          nextVenue,
          nextPlace,
          nextWebsite,
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
    } catch (e) {
      if (!current()) return false;
      setError(adminError(e, tRef.current));
      setFailedCfp(scope);
      return false;
    }
  }, [cfpId, tRef]);

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

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  /** One `busy`, one `Result`: two saves running at once is not a state to design for. */
  async function run(
    work: (current: () => boolean) => Promise<void>,
    ok: string,
    after: (current: () => boolean) => Promise<unknown> | void = () => refresh(),
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
    const next = {
      name: name.trim(),
      visibility,
      descriptionEn: descriptionEn.trim(),
      descriptionFr: descriptionFr.trim(),
      eventDate: eventDate.trim(),
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
          eventDate: next.eventDate,
          venue: next.venue,
          location: next.place,
          website: next.website,
        })),
      t.admin.identitySaved,
      () => {
        setName(next.name);
        setDescriptionEn(next.descriptionEn);
        setDescriptionFr(next.descriptionFr);
        setEventDate(next.eventDate);
        setVenue(next.venue);
        setPlace(next.place);
        setWebsite(next.website);
        setIdentityBaseline(
          JSON.stringify([
            next.name,
            next.visibility,
            next.descriptionEn,
            next.descriptionFr,
            next.eventDate,
            next.venue,
            next.place,
            next.website,
          ]),
        );
      },
    );
  }

  async function saveWindow() {
    await run(
      async () =>
        void (await setCfpWindow({
          cfpId,
          // ISO, so the server stores an instant rather than a wall-clock
          // time in whichever zone the admin happens to be sitting in.
          opensAt: new Date(opensAt).toISOString(),
          closesAt: new Date(closesAt).toISOString(),
          paused,
          reviewsVisible,
        })),
      t.admin.windowSaved,
      () => setWindowBaseline(JSON.stringify([opensAt, closesAt, paused, reviewsVisible])),
    );
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
          disabled={busy}
        />

        <RadioGroup
          label={t.admin.identityVisibility}
          help={t.platform.visibilityHelp}
          value={visibility}
          onChange={setVisibility}
          required
          disabled={busy}
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
          disabled={busy}
        />
        <TextAreaField
          label={t.admin.descriptionFr}
          help={t.admin.descriptionFrHelp}
          value={descriptionFr}
          onChange={setDescriptionFr}
          maxLength={CFP_LIMITS.descriptionMax}
          rows={5}
          disabled={busy}
        />

        <div className="grid grid--2">
          <TextField
            label={t.admin.eventDate}
            type="date"
            value={eventDate}
            onChange={setEventDate}
            disabled={busy}
          />
          <TextField
            label={t.admin.eventWebsite}
            type="url"
            value={website}
            onChange={setWebsite}
            maxLength={CFP_LIMITS.websiteMax}
            placeholder="https://"
            disabled={busy}
          />
          <TextField
            label={t.admin.eventVenue}
            value={venue}
            onChange={setVenue}
            maxLength={CFP_LIMITS.venueMax}
            disabled={busy}
          />
          <TextField
            label={t.admin.eventLocation}
            help={t.admin.eventLocationHelp}
            value={place}
            onChange={setPlace}
            maxLength={CFP_LIMITS.locationMax}
            disabled={busy}
          />
        </div>

        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !name.trim()}
          onClick={() => void saveIdentity()}
        >
          {t.admin.identitySave}
        </button>
      </section>

      <section className="section section--form">
        <h2>{t.admin.window}</h2>

        <div className="grid grid--2">
          <TextField
            label={t.admin.opensAtLabel}
            type="datetime-local"
            value={opensAt}
            onChange={setOpensAt}
            required
            disabled={busy}
          />
          <TextField
            label={t.admin.closesAtLabel}
            type="datetime-local"
            value={closesAt}
            onChange={setClosesAt}
            required
            disabled={busy}
          />
        </div>
        <p className="field__help">
          {t.platform.timeZone.replace(
            '{zone}',
            timeZone || t.platform.timeZoneFallback,
          )}
        </p>

        <Checkbox
          label={t.admin.pausedLabel}
          help={t.admin.pausedHelp}
          checked={paused}
          onChange={setPaused}
          disabled={busy}
        />

        <Checkbox
          label={t.admin.reviewsVisibleLabel}
          help={t.admin.reviewsVisibleHelp}
          checked={reviewsVisible}
          onChange={setReviewsVisible}
          disabled={busy}
        />

        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !opensAt || !closesAt}
          onClick={() => void saveWindow()}
        >
          {t.admin.saveWindow}
        </button>
      </section>

      <Lifecycle
        cfpId={cfpId}
        role={role}
        archived={archived}
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
  busy,
  run,
  note,
  error,
  dirty,
}: {
  cfpId: string;
  role: CfpRole;
  archived: boolean;
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
      <section className="section section--form">
        <h2>{t.admin.archive}</h2>
        <p className="section__help">{t.admin.archiveHelp}</p>
        <button
          type="button"
          className="btn"
          disabled={busy || dirty}
          onClick={() => {
            if (!archived && !window.confirm(t.admin.archiveConfirm)) return;
            void run(
              async () => void (await archiveCfp({ cfpId, archived: !archived })),
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
