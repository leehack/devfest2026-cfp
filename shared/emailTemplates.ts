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
 */

export const EMAIL_KINDS = [
  'submission_received',
  'withdrawn',
  'accepted',
  'waitlisted',
  'rejected',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Decisions go out together or not at all — see `HOLD_UNTIL_RELEASED`. */
export const DECISION_KINDS: readonly EmailKind[] = ['accepted', 'waitlisted', 'rejected'];

export interface EmailData {
  speakerName: string;
  title: string;
  /** Absolute, so it works from a mail client with no session. */
  proposalUrl: string;
  /** Drives the visa paragraph on an acceptance (§5). */
  needsVisa?: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const EVENT = 'DevFest Montréal 2026';

type Copy = { subject: string; body: (d: EmailData) => string[] };

const EN: Record<EmailKind, Copy> = {
  submission_received: {
    subject: `Your ${EVENT} proposal is in`,
    body: (d) => [
      `Hi ${d.speakerName},`,
      `We have your proposal, “${d.title}”.`,
      `You can still edit it, or withdraw it, until the call closes — nothing is locked in until the committee starts reading. Everything you sent is here:`,
      d.proposalUrl,
      `We will write again when there is a decision. That is usually a few weeks after the deadline, and we will tell you either way.`,
    ],
  },
  withdrawn: {
    subject: `You withdrew “{title}” from ${EVENT}`,
    body: (d) => [
      `Hi ${d.speakerName},`,
      `Your proposal “${d.title}” has been withdrawn, and the committee will not review it.`,
      `If that was a mistake, you can submit again while the call is still open:`,
      d.proposalUrl,
    ],
  },
  accepted: {
    subject: `Your ${EVENT} talk has been accepted`,
    body: (d) => [
      `Hi ${d.speakerName},`,
      `“${d.title}” is on the programme. We would like you to give it at ${EVENT}.`,
      `Please confirm you can still make it, here:`,
      d.proposalUrl,
      ...(d.needsVisa
        ? [
            `You told us you will need a visa or eTA. We will send an invitation letter this week — start your application as soon as it arrives, because processing can run to several months.`,
          ]
        : []),
      `A reminder of something you agreed to when you submitted: travel and accommodation are not covered by the event.`,
    ],
  },
  waitlisted: {
    subject: `Your ${EVENT} proposal is on the waitlist`,
    body: (d) => [
      `Hi ${d.speakerName},`,
      `“${d.title}” is on our waitlist. That means the committee rated it well and we ran out of slots, not that there was anything wrong with it.`,
      `Places do free up — speakers withdraw, plans change — and we come back to the waitlist in order when they do. We will know more as the programme settles, and we will write either way rather than leaving you to guess.`,
      d.proposalUrl,
    ],
  },
  rejected: {
    subject: `Your ${EVENT} proposal was not selected`,
    body: (d) => [
      `Hi ${d.speakerName},`,
      `We are not able to fit “${d.title}” into this year's programme. There were far more good proposals than slots, and turning down talks we liked was the hard part of the process.`,
      `This is not a judgement on the work, and it is not a reason to skip next year — several talks on the programme were submitted by people we had turned down before.`,
      `Thank you for taking the time. It matters more than a form can convey.`,
    ],
  },
};

const FR: Record<EmailKind, Copy> = {
  submission_received: {
    subject: `Votre proposition pour ${EVENT} est bien reçue`,
    body: (d) => [
      `Bonjour ${d.speakerName},`,
      `Nous avons bien reçu votre proposition, « ${d.title} ».`,
      `Vous pouvez encore la modifier ou la retirer jusqu'à la clôture de l'appel — rien n'est figé tant que le comité n'a pas commencé sa lecture. Tout ce que vous avez envoyé se trouve ici :`,
      d.proposalUrl,
      `Nous vous réécrirons dès qu'il y aura une décision, généralement quelques semaines après la date limite. Nous vous répondrons dans tous les cas.`,
    ],
  },
  withdrawn: {
    subject: `Vous avez retiré « {title} » de ${EVENT}`,
    body: (d) => [
      `Bonjour ${d.speakerName},`,
      `Votre proposition « ${d.title} » a été retirée et ne sera pas évaluée par le comité.`,
      `S'il s'agit d'une erreur, vous pouvez soumettre à nouveau tant que l'appel est ouvert :`,
      d.proposalUrl,
    ],
  },
  accepted: {
    subject: `Votre conférence pour ${EVENT} est acceptée`,
    body: (d) => [
      `Bonjour ${d.speakerName},`,
      `« ${d.title} » est au programme. Nous aimerions que vous la présentiez à ${EVENT}.`,
      `Merci de confirmer votre disponibilité ici :`,
      d.proposalUrl,
      ...(d.needsVisa
        ? [
            `Vous nous avez indiqué avoir besoin d'un visa ou d'une AVE. Nous vous enverrons une lettre d'invitation cette semaine — entamez votre demande dès sa réception, les délais pouvant atteindre plusieurs mois.`,
          ]
        : []),
      `Un rappel de ce que vous avez accepté lors de la soumission : les déplacements et l'hébergement ne sont pas couverts par l'événement.`,
    ],
  },
  waitlisted: {
    subject: `Votre proposition pour ${EVENT} est sur la liste d'attente`,
    body: (d) => [
      `Bonjour ${d.speakerName},`,
      `« ${d.title} » est sur notre liste d'attente. Cela signifie que le comité l'a bien notée et que les places manquaient, pas qu'elle présentait un défaut.`,
      `Des places se libèrent — des conférenciers se désistent, les plans changent — et nous reprenons la liste dans l'ordre à ce moment-là. Nous en saurons plus à mesure que le programme se précise, et nous vous écrirons dans tous les cas plutôt que de vous laisser dans l'attente.`,
      d.proposalUrl,
    ],
  },
  rejected: {
    subject: `Votre proposition pour ${EVENT} n'a pas été retenue`,
    body: (d) => [
      `Bonjour ${d.speakerName},`,
      `Nous ne pouvons pas inscrire « ${d.title} » au programme cette année. Les bonnes propositions étaient bien plus nombreuses que les places, et refuser des conférences qui nous plaisaient a été la partie difficile du processus.`,
      `Ce n'est pas un jugement sur votre travail, et ce n'est pas une raison de passer votre tour l'an prochain : plusieurs conférences au programme viennent de personnes que nous avions refusées auparavant.`,
      `Merci du temps que vous y avez consacré. Cela compte plus qu'un formulaire ne peut le dire.`,
    ],
  },
};

const DICTIONARIES = { en: EN, fr: FR };
export type EmailLocale = keyof typeof DICTIONARIES;

/** Belt and braces: these strings end up inside an HTML document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const URL_LIKE = /^https?:\/\/\S+$/;

export function renderEmail(
  kind: EmailKind,
  locale: EmailLocale,
  data: EmailData,
): RenderedEmail {
  const copy = DICTIONARIES[locale][kind];
  const paragraphs = copy.body(data);

  return {
    subject: copy.subject.replace('{title}', data.title),
    text: [...paragraphs, '', `— ${EVENT}`].join('\n\n'),
    html: [
      '<div style="font:16px/1.55 system-ui,sans-serif;max-width:34rem;color:#16181d">',
      ...paragraphs.map((p) =>
        URL_LIKE.test(p)
          ? `<p><a href="${escapeHtml(p)}">${escapeHtml(p)}</a></p>`
          : `<p>${escapeHtml(p)}</p>`,
      ),
      `<p style="color:#5f6673;font-size:0.875rem">— ${EVENT}</p>`,
      '</div>',
    ].join(''),
  };
}
