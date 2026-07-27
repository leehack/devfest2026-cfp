export const en = {
  locale: 'en',
  localeName: 'English',
  switchTo: 'Français',

  app: {
    title: 'Call for Proposals',
    event: 'DevFest Montréal 2026',
    signIn: 'Sign in to submit',
    signInHint: 'We use your Google account so you can come back and edit your draft.',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    loading: 'Loading…',
  },

  window: {
    notOpen: 'The call for proposals is not open yet.',
    opensAt: 'It opens on',
    closed: 'The call for proposals has closed.',
    closedAt: 'It closed on',
    paused: 'The call for proposals is paused. Please check back shortly.',
    closesAt: 'Submissions close on',
  },

  sections: {
    proposal: 'Your talk',
    proposalHelp: 'This is what the review committee reads.',
    language: 'Language',
    speaker: 'About you',
    acks: 'Before you submit',
    attendance: 'Getting to Montréal',
  },

  proposal: {
    title: 'Title',
    titleHelp: 'Short and concrete beats clever.',
    abstract: 'Abstract',
    abstractHelp: 'Published word for word in the public programme.',
    pitch: 'Pitch to the committee',
    pitchHelp:
      'Optional, and never published. Why this talk, and why you. Borderline proposals are hard to judge without it.',
    category: 'Category',
    format: 'Format',
    level: 'Audience level',
  },

  language: {
    delivery: 'Which language will you present in?',
    preference: 'Do you have a preference?',
    preferenceHelp:
      'Optional. If we end up choosing for you, this tells us which way you lean.',
    bilingualNote:
      'We will label this session as bilingual on the public programme, so attendees know part of it will not be in their language.',
  },

  import: {
    label: 'Have a Sessionize profile?',
    help: 'Paste your profile, or a link to one of your talks. We will fill in your bio, your links, and whichever talk you pick — nothing you have already written will be replaced without asking.',
    placeholder: 'sessionize.com/your-name',
    sessionsFound: (n: number) =>
      n === 1
        ? 'We found 1 talk on your profile. Use it for this proposal?'
        : `We found ${n} talks on your profile. Pick the one you are proposing:`,
    useThis: 'Use this one',
    noAbstract: 'no abstract on Sessionize',
    sessionApplied: (title: string) => `Using “${title}”.`,
    replaceConfirm: (fields: string) =>
      `This will replace what you have already written: ${fields}. Continue?`,
    sessionDeclined: 'Left your own text in place — nothing was changed.',
    sessionMissing:
      'That talk is not listed on your profile any more, so pick one from the list instead.',
    action: 'Import',
    importing: 'Importing…',
    filled: (fields: string) => `Filled in: ${fields}. Please check it over.`,
    skipped: (fields: string) => `Left alone because you had already filled it: ${fields}.`,
    nothing: 'Nothing new to fill in — your form already has everything we could read.',
    partial: (fields: string) =>
      `We could not read: ${fields}. Please fill those in by hand.`,
    tooLong: (field: string, length: number, max: number) =>
      `The imported ${field} is ${length} characters and the limit here is ${max}. We have filled it in anyway — please trim it before submitting.`,
    tooShort: (field: string, length: number, min: number) =>
      `The imported ${field} is only ${length} characters and we need at least ${min}. Please expand it before submitting.`,
    fieldNames: { bio: 'bio', title: 'title', abstract: 'abstract' } as Record<string, string>,
    errors: {
      badLink:
        'That does not look like a Sessionize link. Paste your profile (sessionize.com/your-name) or one of your talks.',
      noProfile: 'We could not find a Sessionize profile at that address.',
      offHost: 'That link redirected somewhere other than Sessionize, so we stopped.',
      unreadable:
        'That page loaded but nothing could be read from it. Sessionize may have changed their layout — please fill the form in by hand and let the organisers know.',
      unavailable: 'We could not reach Sessionize. Please try again in a moment.',
    },
  },

  speaker: {
    name: 'Name',
    bio: 'Bio',
    bioHelp:
      'Write it in whichever language you prefer. If your talk is accepted we will use this to promote you, so write it the way you want to be introduced.',
    company: 'Company',
    jobTitle: 'Job title',
    employerHelp: 'Both optional.',
    basedIn: 'Based in',
    basedInHelp: 'City and region — for example, Montréal, QC.',
    socials: 'Links',
    socialsHelp: 'Optional. Where people can find you.',
    addSocial: 'Add a link',
    removeSocial: 'Remove',
    platform: 'Platform',
    handle: 'Handle or URL',
    isGde: 'I am a Google Developer Expert',
    pastTalks: 'Past talks',
    pastTalksHelp:
      'Optional links to recordings. Helpful context, not a requirement — we accept first-time speakers.',
    email: 'Email',
    emailHelp: 'From your Google account. All CFP correspondence goes here.',
    gdeGuidance:
      'GDEs should contact their GDE program manager regarding travel support. This event does not provide it directly.',
  },

  acks: {
    noTravelSupport:
      'I understand that travel and accommodation are not covered by the event.',
    coc: 'I have read and agree to the Code of Conduct.',
    cocLink: 'Read the Code of Conduct',
    recording:
      'I consent to my talk being recorded and published.',
  },

  attendance: {
    question: 'If your talk is accepted, how will you get here?',
    help: 'An honest answer here helps us build a schedule that holds up.',
    local: "I'm based in the Montréal area — no travel required",
    secured:
      'My travel and accommodation are already covered (employer, GDE program, or self-funded)',
    pending: "I expect to arrange it but it isn't confirmed yet",
    fundingSource: 'Where is the funding coming from?',
    fundingSourceHelp:
      'A sentence is enough — for example, "employer conference budget" or "applying to the GDE program".',
    decisionBy: 'When do you expect to know?',
    decisionByHelp: 'If this lands after our programme lock date, you may go on the waitlist.',
    needsVisa: 'I will need a visa or eTA to enter Canada',
    visaGuidance:
      "We will issue an invitation letter as soon as you're accepted. Please start your application as early as possible — processing times can run to several months.",
  },

  enums: {
    category: {
      app_dev: 'App Dev',
      ai_ml: 'AI & ML',
      cloud: 'Cloud',
      web: 'Web',
      ui_ux: 'UI & UX',
      soft_skills_career: 'Soft Skills & Career',
      other: 'Other',
    },
    format: {
      session_40: 'Session — 40 minutes',
      lightning_15: 'Lightning talk — 15 minutes',
      workshop_90: 'Workshop — 90 minutes',
    },
    level: {
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      all: 'All levels',
    },
    deliveryLanguage: {
      en: 'English',
      fr: 'French',
      either: 'Either — you choose',
      bilingual: 'Bilingual — I switch between both during the talk',
    },
    socialPlatform: {
      bluesky: 'Bluesky',
      linkedin: 'LinkedIn',
      github: 'GitHub',
      mastodon: 'Mastodon',
      x: 'X',
      website: 'Website',
      other: 'Other',
    },
  },

  form: {
    required: 'Required',
    optional: 'Optional',
    charsRemaining: (n: number) => `${n} characters left`,
    charsNeeded: (n: number) => `${n} more characters needed`,
    save: 'Save draft',
    saving: 'Saving…',
    saved: 'Draft saved',
    saveFailed: 'Could not save your draft',
    submit: 'Submit proposal',
    submitting: 'Submitting…',
    submitted: 'Your proposal has been submitted.',
    submittedHelp:
      'We have emailed you a copy. You can still withdraw it, but it can no longer be edited.',
    withdraw: 'Withdraw proposal',
    withdrawConfirm: 'Withdraw this proposal? This cannot be undone.',
    fixErrors: 'Please check the highlighted fields.',
    errorCount: (n: number) => (n === 1 ? '1 field needs attention' : `${n} fields need attention`),
  },

  errors: {
    generic: 'Something went wrong. Please try again.',
    signIn: 'Could not sign you in. Please try again.',
    signedOut: 'Your session has expired. Please sign in again.',
    notFound: 'We could not find that proposal.',
    incomplete: 'Some answers are missing or invalid. Please check the form.',
    unavailable: 'That service is unavailable right now. Please try again shortly.',
    notOpen: 'The call for proposals is not open right now.',
    readOnlyNow:
      'This can no longer be edited — the call may have closed, or your proposal is already submitted. Reload to see where things stand.',
    crashed: 'Something broke on this page. Reload and your draft will still be here.',
    reload: 'Reload',

    required: 'This one is required.',
    invalid: 'Please check this.',
    tooShort: (n: number) => `At least ${n} characters.`,
    tooLong: (n: number) => `At most ${n} characters.`,
    chooseOne: 'Choose one.',
    mustAgree: 'You need to agree to this before submitting.',
    email: 'Enter a valid email address.',

    /** Keyed by the `params.key` on each custom issue in `shared/schema.ts`. */
    rules: {
      fundingSourceRequired: 'Tell us where the funding is coming from.',
      fundingSourceNotApplicable: 'Funding source does not apply to local speakers.',
      decisionByRequired: 'When do you expect to know?',
      decisionByNotApplicable: 'Decision date only applies when funding is pending.',
      languagePreferenceNotApplicable:
        'Language preference only applies when you can present in either language.',
      dateFormat: 'Use the date picker.',
    } as Record<string, string>,
  },
};

/**
 * English is the reference dictionary: `fr` is typed against it, so a key added
 * here fails the build until the French translation exists. Deliberately not
 * `as const` — literal types would make every French string a type error.
 */
export type Dictionary = typeof en;
