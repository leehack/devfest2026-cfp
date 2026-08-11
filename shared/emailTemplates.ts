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
 * `/admin` prefills with exactly the text that would otherwise be sent, and
 * one substitution path serves both.
 */

export const EMAIL_KINDS = [
  'submission_received',
  'committee_role_invited',
  'co_speaker_invited',
  'committee_proposal_submitted',
  'committee_schedule_shared',
  'profile_update_requested',
  'withdrawn',
  'accepted',
  'waitlisted',
  'rejected',
  'schedule_assigned',
  'schedule_changed',
  'schedule_cancelled',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Decisions go out together or not at all — see the queue's `held` status. */
export const DECISION_KINDS: readonly EmailKind[] = ['accepted', 'waitlisted', 'rejected'];
export const SCHEDULE_EMAIL_KINDS: readonly EmailKind[] = [
  'schedule_assigned',
  'schedule_changed',
  'schedule_cancelled',
];
export const STAFF_EMAIL_KINDS: readonly EmailKind[] = [
  'committee_proposal_submitted',
  'committee_schedule_shared',
];
export const ROLE_INVITATION_EMAIL_KINDS: readonly EmailKind[] = [
  'committee_role_invited',
];
export const CO_SPEAKER_INVITATION_KINDS: readonly EmailKind[] = [
  'co_speaker_invited',
];
export const PROFILE_UPDATE_REQUEST_EMAIL_KINDS: readonly EmailKind[] = [
  'profile_update_requested',
];

/**
 * A one-off an organiser writes themselves — a question, a correction, a
 * detail the templates do not cover.
 *
 * Deliberately not an `EmailKind`: it has no stored copy, so it must not appear
 * in the template dictionaries or in the editor that walks them. It carries its
 * own subject and body on the `emailLog` row instead, and goes through the same
 * substitution and HTML derivation as everything else.
 */
export const MESSAGE_KIND = 'message';

/** What an `emailLog` row's `kind` may be. */
export type LogKind = EmailKind | typeof MESSAGE_KIND;

export interface EmailData {
  speakerName: string;
  title: string;
  /** Absolute, so it works from a mail client with no session. */
  proposalUrl: string;
  /** The CFP's own name — every message is signed with it. */
  event: string;
  /** Drives the `{visa}` paragraph on an acceptance (§5). */
  needsVisa?: boolean;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleRoom?: string;
  scheduleUrl?: string;
  reviewUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * What an author may write in a template. `{visa}` is the conditional one: a
 * paragraph consisting only of it disappears when the speaker does not need a
 * visa, which is how one template serves both cases.
 */
export const PLACEHOLDERS = [
  'speakerName',
  'title',
  'proposalUrl',
  'event',
  'visa',
  'scheduleDate',
  'scheduleTime',
  'scheduleRoom',
  'scheduleUrl',
  'reviewUrl',
] as const;
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
  committee_role_invited: {
    subject: 'You are invited to the {event} committee',
    body: p(
      'Hello,',
      'You have been invited to help review proposals for {event}.',
      'Sign in with this email address to claim your access:',
      '{reviewUrl}',
    ),
  },
  co_speaker_invited: {
    subject: 'Invitation to co-present “{title}” at {event}',
    body: p(
      'Hello,',
      'You have been invited to co-present “{title}” at {event}.',
      'The invitation does not add you to the proposal automatically. Sign in with this exact email address, review the proposal, and accept or decline it yourself:',
      '{proposalUrl}',
      'Accepting gives you access to the proposal and means you cannot review it as a committee member.',
    ),
  },
  committee_proposal_submitted: {
    subject: 'New proposal ready to review for {event}',
    body: p(
      'Hi {speakerName},',
      'There is a new item in the {event} review queue.',
      'Sign in to review it:',
      '{reviewUrl}',
    ),
  },
  committee_schedule_shared: {
    subject: 'Committee schedule update for {event}',
    body: p(
      'Hi {speakerName},',
      'The committee schedule view for {event} has been updated.',
      'Sign in to view the current working schedule:',
      '{scheduleUrl}',
      'Please reply to the organising team if you spot a conflict or anything that needs changing.',
    ),
  },
  profile_update_requested: {
    subject: 'Profile update requested for “{title}” at {event}',
    body: p(
      'Hi {speakerName},',
      'The organising team has asked you to update your speaker information for “{title}”.',
      'Open this exact session to see what is requested, adopt the updated profile details or photo, and mark the request complete:',
      '{proposalUrl}',
      'Your confirmation and any current shared programme remain unchanged until the organising team reviews and reshares the update.',
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
      'We would like to invite you to present “{title}” at {event}.',
      'This is an invitation, not a published programme placement. The organising team schedules sessions after speakers respond.',
      'Please confirm you can still make it: open your proposal and pick one of the two answers there. Signing in with the account you submitted with is all it takes.',
      '{proposalUrl}',
      'If you cannot come, saying so early is genuinely useful rather than awkward: it lets us offer the slot to someone on the waitlist while there is still time.',
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
  schedule_assigned: {
    subject: 'Your {event} session placement',
    body: p(
      'Hi {speakerName},',
      'The organising team shared a working placement for “{title}” on {scheduleDate} at {scheduleTime}, in {scheduleRoom}.',
      'This placement is shared with speakers and the committee. Public programme visibility is controlled separately. Review it in My proposals:',
      '{scheduleUrl}',
      'Please tell the organising team promptly if this timing creates a problem.',
    ),
  },
  schedule_changed: {
    subject: 'Your {event} session placement changed',
    body: p(
      'Hi {speakerName},',
      'The organising team shared a new working placement for “{title}” on {scheduleDate} at {scheduleTime}, in {scheduleRoom}.',
      'This placement is shared with speakers and the committee. Public programme visibility is controlled separately. Review it in My proposals:',
      '{scheduleUrl}',
      'Please tell the organising team promptly if this timing creates a problem.',
    ),
  },
  schedule_cancelled: {
    subject: 'Your {event} session placement was removed',
    body: p(
      'Hi {speakerName},',
      'The organising team removed “{title}” from its shared working schedule.',
      'Public programme visibility is controlled separately. Review your proposal in My proposals:',
      '{scheduleUrl}',
      'If this is unexpected, please reply to the organising team.',
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
  committee_role_invited: {
    subject: 'Invitation au comité de {event}',
    body: p(
      'Bonjour,',
      'Vous avez été invité·e à participer à l’évaluation des propositions pour {event}.',
      'Connectez-vous avec cette adresse courriel pour accepter votre accès :',
      '{reviewUrl}',
    ),
  },
  co_speaker_invited: {
    subject: 'Invitation à coprésenter « {title} » à {event}',
    body: p(
      'Bonjour,',
      'Vous avez été invité·e à coprésenter « {title} » à {event}.',
      'Cette invitation ne vous ajoute pas automatiquement à la proposition. Connectez-vous avec cette adresse courriel précise, consultez la proposition, puis acceptez ou refusez vous-même :',
      '{proposalUrl}',
      'En acceptant, vous aurez accès à la proposition et ne pourrez pas l’évaluer comme membre du comité.',
    ),
  },
  committee_proposal_submitted: {
    subject: 'Nouvelle proposition à évaluer pour {event}',
    body: p(
      'Bonjour {speakerName},',
      'Un nouvel élément se trouve dans la file d’évaluation de {event}.',
      'Connectez-vous pour le consulter :',
      '{reviewUrl}',
    ),
  },
  committee_schedule_shared: {
    subject: 'Mise à jour de l’horaire du comité pour {event}',
    body: p(
      'Bonjour {speakerName},',
      'La vue de l’horaire du comité pour {event} a été mise à jour.',
      'Connectez-vous pour consulter l’horaire de travail actuel :',
      '{scheduleUrl}',
      'Répondez à l’équipe organisatrice si vous repérez un conflit ou un élément à corriger.',
    ),
  },
  profile_update_requested: {
    subject: 'Mise à jour de profil demandée pour « {title} » à {event}',
    body: p(
      'Bonjour {speakerName},',
      'L’équipe organisatrice vous demande de mettre à jour vos renseignements de personne conférencière pour « {title} ».',
      'Ouvrez cette séance précise pour voir la demande, adopter les renseignements ou la photo mis à jour, puis marquer la demande comme terminée :',
      '{proposalUrl}',
      'Votre confirmation et tout programme actuellement partagé restent inchangés jusqu’à ce que l’équipe organisatrice vérifie et partage de nouveau la mise à jour.',
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
      'Nous aimerions vous inviter à présenter « {title} » à {event}.',
      'Il s’agit d’une invitation, et non d’un placement au programme public. L’équipe organisatrice planifie les séances après la réponse des personnes invitées.',
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
  schedule_assigned: {
    subject: 'Placement de votre séance à {event}',
    body: p(
      'Bonjour {speakerName},',
      'L’équipe organisatrice a partagé un placement de travail pour « {title} » le {scheduleDate} à {scheduleTime}, dans {scheduleRoom}.',
      'Ce placement est partagé avec les personnes conférencières et le comité. La visibilité du programme public est gérée séparément. Consultez-le dans Mes propositions :',
      '{scheduleUrl}',
      'Prévenez rapidement l’équipe organisatrice si cet horaire pose problème.',
    ),
  },
  schedule_changed: {
    subject: 'Le placement de votre séance à {event} a changé',
    body: p(
      'Bonjour {speakerName},',
      'L’équipe organisatrice a partagé un nouveau placement de travail pour « {title} » le {scheduleDate} à {scheduleTime}, dans {scheduleRoom}.',
      'Ce placement est partagé avec les personnes conférencières et le comité. La visibilité du programme public est gérée séparément. Consultez-le dans Mes propositions :',
      '{scheduleUrl}',
      'Prévenez rapidement l’équipe organisatrice si cet horaire pose problème.',
    ),
  },
  schedule_cancelled: {
    subject: 'Le placement de votre séance à {event} a été retiré',
    body: p(
      'Bonjour {speakerName},',
      'L’équipe organisatrice a retiré « {title} » de son horaire de travail partagé.',
      'La visibilité du programme public est gérée séparément. Consultez votre proposition dans Mes propositions :',
      '{scheduleUrl}',
      'Si cela vous surprend, répondez à l’équipe organisatrice.',
    ),
  },
};

/**
 * The sign-in link, for people who do not have a Google account.
 *
 * Not an `EmailKind`, and deliberately not overridable: this one is a bearer
 * credential with a covering note, and the wording is what tells someone
 * whether a link they did not ask for is worth clicking. That is not copy to
 * hand to whoever is editing templates that week.
 *
 * The link rides in `{proposalUrl}` because that is the renderer's "the URL
 * this message points at" slot — it gets the same linkifying and escaping as
 * every other link we send.
 */
const SIGN_IN: Record<EmailLocale, Template> = {
  en: {
    subject: 'Your {event} sign-in link',
    body: p(
      'Here is your link to sign in to the {event} call for proposals:',
      '{proposalUrl}',
      'It works once, and only for about an hour. If it has expired, ask for another from the same page.',
      'If you did not ask to sign in, you can ignore this — the link is useless until someone opens it, and nobody can request one on your behalf without knowing your address.',
    ),
  },
  fr: {
    subject: 'Votre lien de connexion pour {event}',
    body: p(
      'Voici votre lien pour vous connecter à l’appel à conférences de {event} :',
      '{proposalUrl}',
      'Il ne fonctionne qu’une fois, et pendant environ une heure. S’il a expiré, demandez-en un autre depuis la même page.',
      'Si vous n’avez pas demandé à vous connecter, vous pouvez ignorer ce message — le lien ne sert à rien tant que personne ne l’ouvre.',
    ),
  },
};

export function renderSignInEmail(
  link: string,
  locale: EmailLocale,
  event: string,
): RenderedEmail {
  return renderTemplate(SIGN_IN[locale], locale, {
    speakerName: '',
    title: '',
    proposalUrl: link,
    event,
  });
}

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
    event: data.event,
    visa: data.needsVisa ? VISA[locale] : '',
    scheduleDate: data.scheduleDate ?? '',
    scheduleTime: data.scheduleTime ?? '',
    scheduleRoom: data.scheduleRoom ?? '',
    scheduleUrl: data.scheduleUrl ?? '',
    reviewUrl: data.reviewUrl ?? '',
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
  return renderTemplate(activeTemplate(kind, locale, overrides), locale, data);
}

/** One committee notice when no explicit language has been stored for its recipient. */
export function renderBilingualEmail(
  kind: EmailKind,
  data: EmailData,
  overrides?: TemplateOverrides,
): RenderedEmail {
  const en = renderEmail(kind, 'en', data, overrides);
  const fr = renderEmail(kind, 'fr', data, overrides);
  return {
    subject: `${en.subject} / ${fr.subject}`,
    text: `${en.text}\n\n--- Français ---\n\n${fr.text}`,
    html: [
      '<div lang="en">',
      en.html,
      '</div>',
      '<hr style="border:0;border-top:1px solid #dadce0;margin:24px 0">',
      '<div lang="fr">',
      fr.html,
      '</div>',
    ].join(''),
  };
}

/**
 * The rendering itself, given copy from anywhere — a dictionary, an organiser's
 * override, or a message typed once and never stored. A free-form message gets
 * the same placeholders, the same escaping and the same linkified URLs as the
 * templates, because it reaches the same inbox.
 */
export function renderTemplate(
  template: Template,
  locale: EmailLocale,
  data: EmailData,
): RenderedEmail {
  const paragraphs = template.body
    .split(/\n\s*\n/)
    .map((paragraph) => substitute(paragraph.trim(), data, locale))
    // A paragraph that was only `{visa}` collapses to nothing when no visa is
    // needed, and must not leave a blank gap behind it.
    .filter(Boolean);

  return {
    subject: substitute(template.subject, data, locale),
    text: [...paragraphs, '', `— ${data.event}`].join('\n\n'),
    html: [
      '<div style="font:16px/1.55 system-ui,sans-serif;max-width:34rem;color:#16181d">',
      ...paragraphs.map((paragraph) =>
        URL_LIKE.test(paragraph)
          ? `<p><a href="${escapeHtml(paragraph)}">${escapeHtml(paragraph)}</a></p>`
          : `<p>${escapeHtml(paragraph)}</p>`,
      ),
      `<p style="color:#5f6673;font-size:0.875rem">— ${escapeHtml(data.event)}</p>`,
      '</div>',
    ].join(''),
  };
}
