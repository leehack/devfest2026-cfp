/**
 * Email copy, in both languages (§8).
 *
 * Pure: takes data, returns strings. Nothing here reaches a network, so the
 * wording is testable without sending anything — which matters, because these
 * are the only messages most applicants will ever get from us.
 *
 * Plain text is the source of truth and the HTML is derived from it. An email
 * that reads correctly with images and styles stripped is one that survives
 * every client, and a CFP has no reason to send anything richer.
 *
 * The built-in copy is stored as placeholder templates rather than as functions
 * so that it is the same shape as an organiser's override — the editor on
 * `#/admin` prefills with exactly the text that would otherwise be sent, and
 * one substitution path serves both.
 */

export const EMAIL_KINDS = [
  'submission_received',
  'withdrawn',
  'accepted',
  'waitlisted',
  'rejected',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Decisions go out together or not at all — see the queue's `held` status. */
export const DECISION_KINDS: readonly EmailKind[] = ['accepted', 'waitlisted', 'rejected'];

export interface EmailData {
  speakerName: string;
  title: string;
  /** Absolute, so it works from a mail client with no session. */
  proposalUrl: string;
  /** Drives the `{visa}` paragraph on an acceptance (§5). */
  needsVisa?: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const EVENT = 'DevFest Montréal 2026';

/**
 * What an author may write in a template. `{visa}` is the conditional one: a
 * paragraph consisting only of it disappears when the speaker does not need a
 * visa, which is how one template serves both cases.
 */
export const PLACEHOLDERS = ['speakerName', 'title', 'proposalUrl', 'event', 'visa'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface Template {
  subject: string;
  /** Paragraphs separated by a blank line. */
  body: string;
}

const p = (...paragraphs: string[]) => paragraphs.join('\n\n');

const EN: Record<EmailKind, Template> = {
  submission_received: {
    subject: 'Your {event} proposal is in',
    body: p(
      'Hi {speakerName},',
      'We have your proposal, “{title}”.',
      'You can still edit it, or withdraw it, until the call closes — nothing is locked in until the committee starts reading. Everything you sent is here:',
      '{proposalUrl}',
      'We will write again when there is a decision. That is usually a few weeks after the deadline, and we will tell you either way.',
    ),
  },
  withdrawn: {
    subject: 'You withdrew “{title}” from {event}',
    body: p(
      'Hi {speakerName},',
      'Your proposal “{title}” has been withdrawn, and the committee will not review it.',
      'If that was a mistake, you can submit again while the call is still open:',
      '{proposalUrl}',
    ),
  },
  accepted: {
    subject: 'Your {event} talk has been accepted',
    body: p(
      'Hi {speakerName},',
      '“{title}” is on the programme. We would like you to give it at {event}.',
      'Please confirm you can still make it, here:',
      '{proposalUrl}',
      '{visa}',
      'A reminder of something you agreed to when you submitted: travel and accommodation are not covered by the event.',
    ),
  },
  waitlisted: {
    subject: 'Your {event} proposal is on the waitlist',
    body: p(
      'Hi {speakerName},',
      '“{title}” is on our waitlist. That means the committee rated it well and we ran out of slots, not that there was anything wrong with it.',
      'Places do free up — speakers withdraw, plans change — and we come back to the waitlist in order when they do. We will know more as the programme settles, and we will write either way rather than leaving you to guess.',
      '{proposalUrl}',
    ),
  },
  rejected: {
    subject: 'Your {event} proposal was not selected',
    body: p(
      'Hi {speakerName},',
      'We are not able to fit “{title}” into this year’s programme. There were far more good proposals than slots, and turning down talks we liked was the hard part of the process.',
      'This is not a judgement on the work, and it is not a reason to skip next year — several talks on the programme were submitted by people we had turned down before.',
      'Thank you for taking the time. It matters more than a form can convey.',
    ),
  },
};

const FR: Record<EmailKind, Template> = {
  submission_received: {
    subject: 'Votre proposition pour {event} est bien reçue',
    body: p(
      'Bonjour {speakerName},',
      'Nous avons bien reçu votre proposition, « {title} ».',
      'Vous pouvez encore la modifier ou la retirer jusqu’à la clôture de l’appel — rien n’est figé tant que le comité n’a pas commencé sa lecture. Tout ce que vous avez envoyé se trouve ici :',
      '{proposalUrl}',
      'Nous vous réécrirons dès qu’il y aura une décision, généralement quelques semaines après la date limite. Nous vous répondrons dans tous les cas.',
    ),
  },
  withdrawn: {
    subject: 'Vous avez retiré « {title} » de {event}',
    body: p(
      'Bonjour {speakerName},',
      'Votre proposition « {title} » a été retirée et ne sera pas évaluée par le comité.',
      'S’il s’agit d’une erreur, vous pouvez soumettre à nouveau tant que l’appel est ouvert :',
      '{proposalUrl}',
    ),
  },
  accepted: {
    subject: 'Votre conférence pour {event} est acceptée',
    body: p(
      'Bonjour {speakerName},',
      '« {title} » est au programme. Nous aimerions que vous la présentiez à {event}.',
      'Merci de confirmer votre disponibilité ici :',
      '{proposalUrl}',
      '{visa}',
      'Un rappel de ce que vous avez accepté lors de la soumission : les déplacements et l’hébergement ne sont pas couverts par l’événement.',
    ),
  },
  waitlisted: {
    subject: 'Votre proposition pour {event} est sur la liste d’attente',
    body: p(
      'Bonjour {speakerName},',
      '« {title} » est sur notre liste d’attente. Cela signifie que le comité l’a bien notée et que les places manquaient, pas qu’elle présentait un défaut.',
      'Des places se libèrent — des conférenciers se désistent, les plans changent — et nous reprenons la liste dans l’ordre à ce moment-là. Nous en saurons plus à mesure que le programme se précise, et nous vous écrirons dans tous les cas plutôt que de vous laisser dans l’attente.',
      '{proposalUrl}',
    ),
  },
  rejected: {
    subject: 'Votre proposition pour {event} n’a pas été retenue',
    body: p(
      'Bonjour {speakerName},',
      'Nous ne pouvons pas inscrire « {title} » au programme cette année. Les bonnes propositions étaient bien plus nombreuses que les places, et refuser des conférences qui nous plaisaient a été la partie difficile du processus.',
      'Ce n’est pas un jugement sur votre travail, et ce n’est pas une raison de passer votre tour l’an prochain : plusieurs conférences au programme viennent de personnes que nous avions refusées auparavant.',
      'Merci du temps que vous y avez consacré. Cela compte plus qu’un formulaire ne peut le dire.',
    ),
  },
};

const VISA = {
  en: 'You told us you will need a visa or eTA. We will send an invitation letter this week — start your application as soon as it arrives, because processing can run to several months.',
  fr: 'Vous nous avez indiqué avoir besoin d’un visa ou d’une AVE. Nous vous enverrons une lettre d’invitation cette semaine — entamez votre demande dès sa réception, les délais pouvant atteindre plusieurs mois.',
};

const DICTIONARIES = { en: EN, fr: FR };
export type EmailLocale = keyof typeof DICTIONARIES;
export const EMAIL_LOCALES = Object.keys(DICTIONARIES) as EmailLocale[];

/** An organiser's replacement for one message, by kind and language. */
export type TemplateOverrides = Partial<
  Record<EmailKind, Partial<Record<EmailLocale, Template>>>
>;

/** The copy as shipped — what the editor prefills with, and what Reset restores. */
export function builtInTemplate(kind: EmailKind, locale: EmailLocale): Template {
  return DICTIONARIES[locale][kind];
}

/** What will actually be sent: the override if there is one, otherwise ours. */
export function activeTemplate(
  kind: EmailKind,
  locale: EmailLocale,
  overrides?: TemplateOverrides,
): Template {
  const custom = overrides?.[kind]?.[locale];
  return custom?.subject && custom?.body ? custom : builtInTemplate(kind, locale);
}

export type TemplateProblem = 'emptySubject' | 'emptyBody' | 'unknownPlaceholder';

/**
 * Catches the two ways an override goes wrong in front of an applicant: blank,
 * and a mistyped placeholder that would print `{speaker}` in the message body.
 */
export function validateTemplate(
  template: Template,
): { problem: TemplateProblem; detail?: string } | null {
  if (!template.subject.trim()) return { problem: 'emptySubject' };
  if (!template.body.trim()) return { problem: 'emptyBody' };

  const known = new Set<string>(PLACEHOLDERS);
  for (const source of [template.subject, template.body]) {
    for (const [, name] of source.matchAll(/\{(\w+)\}/g)) {
      if (!known.has(name)) return { problem: 'unknownPlaceholder', detail: name };
    }
  }
  return null;
}

/** Belt and braces: these strings end up inside an HTML document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const URL_LIKE = /^https?:\/\/\S+$/;

function substitute(source: string, data: EmailData, locale: EmailLocale): string {
  const values: Record<string, string> = {
    speakerName: data.speakerName,
    title: data.title,
    proposalUrl: data.proposalUrl,
    event: EVENT,
    visa: data.needsVisa ? VISA[locale] : '',
  };
  // An unknown name is left untouched rather than blanked: validateTemplate
  // rejects them on save, and a visible `{typo}` is easier to diagnose than a
  // sentence that silently lost a word.
  return source.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? values[name] : whole,
  );
}

export function renderEmail(
  kind: EmailKind,
  locale: EmailLocale,
  data: EmailData,
  overrides?: TemplateOverrides,
): RenderedEmail {
  const template = activeTemplate(kind, locale, overrides);

  const paragraphs = template.body
    .split(/\n\s*\n/)
    .map((paragraph) => substitute(paragraph.trim(), data, locale))
    // A paragraph that was only `{visa}` collapses to nothing when no visa is
    // needed, and must not leave a blank gap behind it.
    .filter(Boolean);

  return {
    subject: substitute(template.subject, data, locale),
    text: [...paragraphs, '', `— ${EVENT}`].join('\n\n'),
    html: [
      '<div style="font:16px/1.55 system-ui,sans-serif;max-width:34rem;color:#16181d">',
      ...paragraphs.map((paragraph) =>
        URL_LIKE.test(paragraph)
          ? `<p><a href="${escapeHtml(paragraph)}">${escapeHtml(paragraph)}</a></p>`
          : `<p>${escapeHtml(paragraph)}</p>`,
      ),
      `<p style="color:#5f6673;font-size:0.875rem">— ${EVENT}</p>`,
      '</div>',
    ].join(''),
  };
}
