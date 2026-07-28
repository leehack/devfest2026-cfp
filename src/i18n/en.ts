export const en = {
  locale: 'en',
  localeName: 'English',
  switchTo: 'Français',

  app: {
    title: 'Call for Proposals',
    event: 'DevFest Montréal 2026',
    signIn: 'Sign in to submit',
    signInHint: 'We use your Google account so you can come back and edit your draft.',
    signInEmailTitle: 'No Google account?',
    signInEmailHint:
      'We will email you a link that signs you in. No password to pick or remember.',
    signInEmail: 'Email me a link',
    linkSending: 'Sending…',
    linkSent:
      'If {email} can receive mail, a sign-in link is on its way. It works once, and for about an hour.',
    linkChecking: 'Signing you in…',
    linkWhose: 'One more thing',
    linkWhoseHelp:
      'This link was opened on a different device from the one that asked for it, so please confirm the address you used.',
    linkContinue: 'Continue',
    linkFailed:
      'That link did not work. It may have been used already or expired — ask for a new one below.',
    linkTooMany: 'That is a lot of links in a short time. Please try again in an hour.',
    linkBadEmail: 'That does not look like an email address.',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    loading: 'Loading…',
  },

  nav: {
    form: 'Your proposal',
    review: 'Review',
    admin: 'Admin',
    forbidden: 'That page is not available to your account.',
    backToForm: 'Go to your proposal',
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
    speakerHelp:
      'Part of your account, not of any one talk — editing it here changes it everywhere, and it stays editable after a talk is submitted.',
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
    status: {
      draft: 'Draft',
      submitted: 'Submitted',
      under_review: 'Under review',
      accepted: 'Accepted',
      confirmed: 'Confirmed',
      declined: 'Declined',
      waitlisted: 'Waitlisted',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
    },
    role: {
      reviewer: 'Reviewer',
      admin: 'Admin',
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
    saveChanges: 'Save changes',
    saving: 'Saving…',
    saved: 'Draft saved',
    saveFailed: 'Could not save your draft',
    submit: 'Submit proposal',
    submitting: 'Submitting…',
    submitted: 'Your proposal has been submitted.',
    submittedHelp: 'We have emailed you a copy.',

    /** What has happened to the talk. Falls back to `submittedHelp`. */
    statusHelp: {
      submitted: 'It is in. The committee has not started reading yet.',
      under_review: 'The committee is reading it now.',
      accepted:
        'You are on the programme — please tell us whether you can still make it, so we know the slot is filled.',
      confirmed: 'Confirmed. See you in Montréal.',
      waitlisted: 'Not in yet, but not out — we come back to the waitlist as places free up.',
      rejected: 'Not this year. There were more good proposals than slots, and we are sorry.',
      declined: 'You turned down the slot.',
      withdrawn: 'You withdrew this one.',
    } as Record<string, string>,

    /** What is still theirs to change, keyed by `EditScope`. */
    editHelp: {
      all: 'You can still edit anything here until the deadline.',
      // One string covers under_review through confirmed, so it cannot say
      // "while it is being judged" — by the time a talk is confirmed, it is not.
      logistics:
        'The talk itself is locked now. Your profile and your travel answers are still editable.',
      none: 'This one is closed. Your profile is still yours to edit.',
    } as Record<string, string>,
    withdraw: 'Withdraw proposal',
    withdrawConfirm: 'Withdraw this proposal? This cannot be undone.',
    confirmAccept: 'Yes, I can present',
    confirmDecline: 'I have to decline',
    confirmDeclineConfirm:
      'Decline this slot? We will offer it to someone else, so it may not be available if you change your mind.',
    answersHelp:
      'A few things we need before the day. You can change any of these later.',
    answersSubmit: 'Confirm my talk',
    answersCancel: 'Back',
    answersTitle: 'Your details',
    answersSave: 'Save details',
    answersIncomplete: 'Please check the highlighted questions.',
    imageChoose: 'Choose a photo',
    imageReplace: 'Choose a different photo',
    imageUploading: 'Uploading…',
    imageHint: 'JPEG, PNG or WebP, up to 5 MB. A square one crops best.',
    imageType: 'That file is not a JPEG, PNG or WebP.',
    imageTooBig: 'That photo is over 5 MB. Please pick a smaller one.',
    imageFailed: 'The upload did not go through. Please try again.',
    answerPick: 'Choose one…',
    answerErrors: {
      required: 'This one is needed.',
      tooLong: 'That is longer than we can store.',
      notAnOption: 'Please pick one of the options.',
      wrongType: 'That answer did not come through — please try again.',
    } as Record<string, string>,
    yourTalks: 'Your talks',
    untitled: 'Untitled talk',
    newTalk: 'New talk',
    addTalk: '+ Another talk',
    talkCap: (n: number) => `That is the maximum of ${n}.`,
    fixErrors: 'Please check the highlighted fields.',
    errorCount: (n: number) => (n === 1 ? '1 field needs attention' : `${n} fields need attention`),
  },

  admin: {
    people: 'Committee',
    peopleHelp: 'Invite by email. The role applies the first time they sign in.',
    emailLabel: 'Email address',
    roleLabel: 'Role',
    invite: 'Invite',
    inviting: 'Inviting…',
    granted: (email: string) => `${email} now holds that role.`,
    invited: (email: string) => `${email} will hold that role once they sign in.`,
    awaitingSignIn: 'Invited — has not signed in yet',
    revoke: 'Revoke',
    revokeConfirm: (email: string) => `Remove every role from ${email}?`,
    revoked: (email: string) => `${email} no longer holds a role.`,
    noPeople: 'Nobody holds a role yet.',
    isYou: 'you',
    lastAdmin: 'That is the only admin left — give someone else the role first.',
    badInput: 'Check the email address and the dates.',

    window: 'Submission window',
    opensAtLabel: 'Opens',
    closesAtLabel: 'Closes',
    pausedLabel: 'Pause submissions now',
    pausedHelp: 'Closes the form immediately without moving the dates.',
    reviewsVisibleLabel: 'Let reviewers see each other’s scores',
    reviewsVisibleHelp:
      'Keep this off until scoring is finished — a visible score anchors the next one.',
    saveWindow: 'Save window',
    windowSaved: 'Saved.',

    email: 'Email',
    emailStepKey: 'Resend API key',
    emailKeyHelp:
      'Stored in Secret Manager, not in the database, and never shown again. Checked against Resend before it is saved, so a typo fails here rather than on the night the decisions go out.',
    emailKeySteps: [
      'Create an account at resend.com — the free tier covers a CFP.',
      'Open API Keys, then Create API Key.',
      'Set the permission to Full access. Sending access alone cannot manage domains, and the next step needs it.',
      'Copy the key — it starts with re_, and Resend shows it only once — then paste it below.',
    ],
    emailKeyLink: 'Open Resend API keys',
    emailKeyLabel: 'API key',
    emailKeySet: 'A key is set, ending {hint}.',
    emailKeySave: 'Save key',
    emailKeyReplace: 'Replace key',
    emailKeySaved: 'Key saved.',
    emailKeyFirst: 'Set the API key first.',
    emailStepDomain: 'Sending domain',
    emailDomainHelp:
      'Mail from an unverified domain is refused by Resend, and mail from a free provider lands in spam. Verification is DNS, so allow for propagation.',
    emailDomainSteps: [
      'Enter a domain you control. A subdomain such as cfp.example.org is worth preferring: its DNS is separate from the mail everyone else in the group depends on.',
      'Add the records that appear here to that domain, at whoever hosts its DNS.',
      'Check verification. It is usually minutes, but DNS is allowed to take far longer.',
    ],
    emailDomainLabel: 'Domain',
    emailDomainAdd: 'Add domain',
    emailDomainAdded: 'Added. Now add the DNS records below.',
    emailDomainVerify: 'Check verification',
    emailDomainVerified: 'Verified.',
    emailDomainChecking: 'Resend is checking. DNS can take a while — try again shortly.',
    emailDomainStatus: {
      not_started: 'Not verified yet',
      pending: 'Waiting on DNS',
      verified: 'Verified',
      failed: 'Verification failed',
      temporary_failure: 'Temporarily failed — will retry',
    } as Record<string, string>,
    emailDnsHelp: 'Add these to your DNS, then check again.',
    emailDnsType: 'Type',
    emailDnsName: 'Name',
    emailDnsValue: 'Value',
    emailStepSender: 'Sender',
    emailPreview: 'Preview',
    emailPreviewLocale: 'Language',
    emailPreviewVisa: 'Show the visa paragraph',
    emailPreviewPlain: 'Plain text',
    emailEdit: 'Edit the wording',
    emailCustom: 'Using your wording, not ours.',
    emailSubjectLabel: 'Subject line',
    emailBodyLabel: 'Message',
    emailPlaceholders: 'Blank line between paragraphs. Available:',
    emailVisaHelp:
      'A paragraph that is only {visa} disappears for speakers who do not need one, so leave it on its own line.',
    emailTemplateProblem: {
      emptySubject: 'A subject line is required.',
      emptyBody: 'The message cannot be empty.',
      unknownPlaceholder: 'There is no {name} placeholder — it would be sent as written.',
    } as Record<string, string>,
    emailTemplateSave: 'Save wording',
    emailTemplateSaved: 'Saved. This is what will be sent.',
    emailTemplateRestore: 'Restore ours',
    emailTemplateReset: 'Restored.',
    emailSubject: 'Subject:',
    emailTest: 'Send this to me',
    emailTestSent: 'Sent to {to}.',
    emailTestDryRun: 'Nothing sent — finish the key and sender above first.',
    emailTestNeedsSetup: 'A test needs the key and the sending address set.',
    emailFrom: 'Send as',
    emailReplyTo: 'Reply-to',
    emailFromHelp:
      'Must be on a domain verified with Resend, or every message fails. Put a display name in angle brackets: DevFest Montréal <cfp@example.org>.',
    emailDomainMismatch:
      'You are sending from {sender}, but the domain verified with Resend is {verified}. Resend verifies an exact domain, so this will queue and then fail at send.',
    emailSaveSender: 'Save address',
    emailNoSender:
      'No sending address is set, so nothing is going out. Messages still queue, and send once you set one.',
    emailPublicUrl: 'Link in emails',
    emailPublicUrlHelp:
      'Where speakers are sent to confirm or read a decision. Leave it empty to use this project’s own address; set it once the CFP has a domain of its own.',
    emailPublicUrlPlaceholder: 'https://cfp.example.org',
    emailSender: {
      empty: 'A sending address is required.',
      format: 'That does not look like an email address.',
      brackets: 'Put the display name in angle brackets: DevFest Montréal <cfp@example.org>.',
      url: 'That is not a full web address. It needs to start with https:// and name a domain.',
    },
    emailErrors: {
      badKey:
        'Resend would not accept that key. Check that it was copied whole, and that its permission is Full access — a sending-only key cannot manage domains.',
      noDomain: 'Resend has no such domain. It may have been removed there.',
      rejected: 'Resend refused that request. Check the domain name.',
      unreachable: 'Could not reach Resend. Try again shortly.',
    },
    emailQueue: 'Queue',
    emailHelp:
      'Decisions are held until you release them, so everyone hears on the same day. Check the list below before sending — it cannot be taken back.',
    emailStatus: {
      held: 'Waiting for release',
      queued: 'Queued',
      sent: 'Sent',
      dry_run: 'Not sent — no sender configured',
      failed: 'Failed',
    },
    emailKind: 'Message',
    emailTo: 'To',
    emailKinds: {
      submission_received: 'Submission received',
      withdrawn: 'Withdrawn',
      accepted: 'Accepted',
      waitlisted: 'Waitlisted',
      rejected: 'Not selected',
      message: 'Message',
    } as Record<string, string>,
    messageTitle: 'Write to a speaker',
    messageHelp:
      'For anything the templates do not cover — a question, a correction, a detail about the day. It goes out from the same address and is recorded in the log below, so the rest of the committee can see it happened.',
    messageTalk: 'Talk',
    messagePick: 'Choose a talk…',
    messageSubject: 'Subject',
    messageBody: 'Message',
    messageBodyHelp:
      'A blank line starts a new paragraph. {speakerName}, {title} and {proposalUrl} are filled in for you.',
    messageSend: 'Send message',
    messageSending: 'Sending…',
    messageConfirm: 'Send this to {name}? It goes out immediately.',
    messageSent: 'Sent to {name}.',
    messageNoReplyTo:
      'No reply-to address is set, so a speaker who replies will reach nobody. Set one above before writing.',
    messageNoTalks: 'Nothing to write about yet — no proposal has been submitted.',
    emailRefresh: 'Refresh',
    emailRelease: 'Send {count} decisions',
    emailNothing: 'Nothing to send',
    emailConfirm: 'Send {count} decision emails now? This cannot be undone.',
    emailRetry: 'Retry {count} unsent',
    emailSent: '{count} messages queued.',
    emailLog: 'What was sent',
    emailLogEmpty: 'Nothing has been queued yet.',
    emailLogFilter: 'Show',
    emailLogAll: 'Everything',
    emailStatusColumn: 'Outcome',
    emailSentAt: 'Sent',
    emailResend: 'Send again',
    emailResendConfirm:
      'Send this message to {to} again? They will receive a second copy of it.',
    emailResent: 'Queued again for {to}.',
    emailLogTruncated: '{count} older messages are not shown.',

    proposals: 'Proposals',
    proposalsHelp: 'Best score first. Recompute after a round of scoring, then decide.',
    overview: 'The round at a glance',
    chartDecisions: 'Decisions',
    chartScores: 'Average score',
    chartCategories: 'Categories',
    chartLanguages: 'Languages',
    undecided: 'Undecided',
    allScored: 'Every proposal has been scored.',
    someUnscored: (n: number) =>
      n === 1 ? '1 proposal has no score yet.' : `${n} proposals have no score yet.`,
    form: 'Confirmation questions',
    formHelp:
      'Asked once a speaker accepts. Nothing here is required — leave it empty and confirming stays one click.',
    formEmpty: 'No questions yet. Speakers just confirm and that is that.',
    formUntitled: 'New question',
    formLabelEn: 'Question (English)',
    formLabelFr: 'Question (French)',
    formLabelFrHelp: 'Optional. Left blank, French speakers see the English.',
    formHelpEn: 'Hint (English)',
    formHelpFr: 'Hint (French)',
    formType: 'Answer type',
    formTypes: {
      text: 'Short text',
      textarea: 'Long text',
      select: 'Pick one',
      checkbox: 'Tick box',
    } as Record<string, string>,
    formRequired: 'Must be answered',
    formOptions: 'Options',
    formOptionsHelp: 'One per line. Each line is shown as written and stored as written.',
    formKey: 'Answers are stored under “{key}”. It is fixed once saved, so existing answers keep matching.',
    formUp: 'Move up',
    formDown: 'Move down',
    formRemove: 'Remove',
    formRemoveConfirm: 'Remove “{label}”? Answers already given to it stop being shown.',
    formAdd: 'Add a question',
    formSave: 'Save questions',
    formSaving: 'Saving…',
    formSaved: 'Questions saved.',
    formViewPhoto: 'View photo',
    formYes: 'Yes',
    formNo: 'No',
    formAnswers: 'Answers',
    formErrors: {
      tooManyFields: 'That is more questions than the form can hold.',
      badKey: 'Something is wrong with the question “{key}” — please check its type.',
      duplicateKey: 'Two questions would be stored under “{key}”. Rename one of them.',
      emptyLabel: 'Every question needs an English label.',
      tooLong: 'One of the questions is too long.',
      needsOptions: 'A “pick one” question needs at least one option.',
      duplicateOption: 'The options for “{key}” repeat. Each has to be distinct.',
    } as Record<string, string>,
    results: 'Selected speakers',
    tally: (live: number, accepted: number, waitlisted: number, decided: number) =>
      `${live} in front of the committee · ${accepted} accepted · ${waitlisted} waitlisted · ${live - decided} still to decide`,
    noneAccepted: 'Nothing accepted yet.',
    colSpeaker: 'Speaker',
    recompute: 'Recompute scores',
    recomputing: 'Recomputing…',
    recomputed: (proposals: number, reviews: number) =>
      `${reviews} reviews across ${proposals} proposals.`,
    noProposals: 'No proposals yet.',
    colTitle: 'Title',
    colStatus: 'Status',
    colScore: 'Average',
    colReviews: 'Reviews',
    colSpread: 'Spread',
  },

  review: {
    help: 'Score every proposal you can judge. Your own are never listed.',
    empty: 'Nothing to review yet — no talks have been submitted.',
    onlyYours: 'Nothing to review yet. You cannot score your own talk, and so far that is the only one submitted.',
    progress: (scored: number, total: number) => `${scored} of ${total} scored`,
    scoreLabel: 'Score',
    scores: {
      1: '1 — Pass',
      2: '2 — Maybe',
      3: '3 — Yes',
      4: '4 — Strong yes',
    } as Record<number, string>,
    gde: 'GDE',
    position: (n: number, total: number) => `${n} of ${total}`,
    previous: 'Previous proposal',
    next: 'Next proposal',
    shortcuts: 'Shortcuts',
    shortcutScore: 'Score, and move to the next one',
    shortcutMove: 'Back and forward without scoring',
    shortcutHelp: 'Show or hide this',
    conflict: 'I have a conflict of interest',
    conflictHelp: 'Excluded from the totals, including your own calibration.',
    comment: 'Notes for the committee',
    save: 'Save review',
    saving: 'Saving…',
    saved: 'Saved',
    notScored: 'Not scored yet',
    othersHidden: 'Other reviewers’ scores stay hidden until an admin opens them.',
    others: 'Committee scores',
    sortedByDisagreement: 'Sorted by disagreement — the ones worth discussing are first.',
    spread: 'Spread',
    conflictDeclared: 'conflict declared',
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
