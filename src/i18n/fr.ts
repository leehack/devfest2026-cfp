import type { Dictionary } from './en';

export const fr: Dictionary = {
  locale: 'fr',
  localeName: 'Français',
  switchTo: 'English',

  app: {
    title: 'Appel à conférences',
    event: 'DevFest Montréal 2026',
    signIn: 'Connectez-vous pour soumettre',
    signInHint:
      'Nous utilisons votre compte Google afin que vous puissiez revenir modifier votre brouillon.',
    signOut: 'Déconnexion',
    signedInAs: 'Connecté en tant que',
    loading: 'Chargement…',
  },

  window: {
    notOpen: "L'appel à conférences n'est pas encore ouvert.",
    opensAt: 'Il ouvre le',
    closed: "L'appel à conférences est terminé.",
    closedAt: 'Il s’est terminé le',
    paused: "L'appel à conférences est en pause. Revenez sous peu.",
    closesAt: 'Les soumissions se terminent le',
  },

  sections: {
    proposal: 'Votre conférence',
    proposalHelp: "C'est ce que le comité de sélection lit.",
    language: 'Langue',
    speaker: 'À propos de vous',
    acks: 'Avant de soumettre',
    attendance: 'Venir à Montréal',
  },

  proposal: {
    title: 'Titre',
    titleHelp: 'Court et concret vaut mieux que spirituel.',
    abstract: 'Résumé',
    abstractHelp: 'Publié mot pour mot dans le programme public.',
    pitch: 'Argumentaire pour le comité',
    pitchHelp:
      "Facultatif, et jamais publié. Pourquoi cette conférence, et pourquoi vous. Sans cela, les propositions limites sont difficiles à juger.",
    category: 'Catégorie',
    format: 'Format',
    level: 'Niveau du public',
  },

  language: {
    delivery: 'Dans quelle langue allez-vous présenter ?',
    preference: 'Avez-vous une préférence ?',
    preferenceHelp:
      'Facultatif. Si nous devons choisir pour vous, cela nous indique votre penchant.',
    bilingualNote:
      'Nous indiquerons cette séance comme bilingue dans le programme public, afin que le public sache qu’une partie ne sera pas dans sa langue.',
  },

  import: {
    label: 'Vous avez un profil Sessionize ?',
    help: 'Collez votre profil, ou le lien d’une de vos conférences. Nous remplirons votre biographie, vos liens et la conférence que vous choisirez — rien de ce que vous avez déjà écrit ne sera remplacé sans vous le demander.',
    placeholder: 'sessionize.com/votre-nom',
    sessionsFound: (n: number) =>
      n === 1
        ? 'Nous avons trouvé 1 conférence sur votre profil. L’utiliser pour cette proposition ?'
        : `Nous avons trouvé ${n} conférences sur votre profil. Choisissez celle que vous proposez :`,
    useThis: 'Utiliser celle-ci',
    noAbstract: 'aucun résumé sur Sessionize',
    sessionApplied: (title: string) => `Utilisation de « ${title} ».`,
    replaceConfirm: (fields: string) =>
      `Cela remplacera ce que vous avez déjà écrit : ${fields}. Continuer ?`,
    sessionDeclined: 'Votre texte a été conservé — rien n’a été modifié.',
    sessionMissing:
      'Cette conférence n’est plus listée sur votre profil — veuillez en choisir une dans la liste.',
    action: 'Importer',
    importing: 'Importation…',
    filled: (fields: string) => `Champs remplis : ${fields}. Veuillez les vérifier.`,
    skipped: (fields: string) =>
      `Laissés tels quels, car vous les aviez déjà remplis : ${fields}.`,
    nothing:
      'Rien de nouveau à remplir — votre formulaire contient déjà tout ce que nous avons pu lire.',
    partial: (fields: string) =>
      `Nous n’avons pas pu lire : ${fields}. Veuillez les remplir à la main.`,
    tooLong: (field: string, length: number, max: number) =>
      `Le champ « ${field} » importé compte ${length} caractères et la limite ici est de ${max}. Nous l’avons tout de même rempli — veuillez le raccourcir avant de soumettre.`,
    tooShort: (field: string, length: number, min: number) =>
      `Le champ « ${field} » importé ne compte que ${length} caractères et il en faut au moins ${min}. Veuillez l’étoffer avant de soumettre.`,
    fieldNames: { bio: 'biographie', title: 'titre', abstract: 'résumé' } as Record<string, string>,
    errors: {
      badLink:
        'Ce lien ne semble pas provenir de Sessionize. Collez votre profil (sessionize.com/votre-nom) ou une de vos conférences.',
      noProfile: 'Aucun profil Sessionize n’a été trouvé à cette adresse.',
      offHost: 'Ce lien redirige ailleurs que vers Sessionize — nous avons arrêté.',
      unreadable:
        'La page s’est chargée mais rien n’a pu en être lu. Sessionize a peut-être changé sa mise en page — veuillez remplir le formulaire à la main et prévenir les organisateurs.',
      unavailable: 'Impossible de joindre Sessionize. Veuillez réessayer dans un instant.',
    },
  },

  speaker: {
    name: 'Nom',
    bio: 'Biographie',
    bioHelp:
      'Rédigez-la dans la langue de votre choix. Si votre conférence est retenue, nous l’utiliserons pour votre promotion — écrivez-la comme vous souhaitez être présenté.',
    company: 'Entreprise',
    jobTitle: 'Poste',
    employerHelp: 'Les deux sont facultatifs.',
    basedIn: 'Lieu de résidence',
    basedInHelp: 'Ville et région — par exemple, Montréal, QC.',
    socials: 'Liens',
    socialsHelp: 'Facultatif. Où l’on peut vous trouver.',
    addSocial: 'Ajouter un lien',
    removeSocial: 'Retirer',
    platform: 'Plateforme',
    handle: 'Identifiant ou URL',
    isGde: 'Je suis Google Developer Expert',
    pastTalks: 'Conférences passées',
    pastTalksHelp:
      "Liens facultatifs vers des enregistrements. Un contexte utile, pas une exigence — nous acceptons les nouvelles conférencières et nouveaux conférenciers.",
    email: 'Courriel',
    emailHelp: 'Provient de votre compte Google. Toute la correspondance y sera envoyée.',
    gdeGuidance:
      "Les GDE doivent communiquer avec leur gestionnaire de programme GDE concernant le soutien aux déplacements. L'événement ne l'offre pas directement.",
  },

  acks: {
    noTravelSupport:
      "Je comprends que les déplacements et l'hébergement ne sont pas couverts par l'événement.",
    coc: 'J’ai lu et j’accepte le code de conduite.',
    cocLink: 'Lire le code de conduite',
    recording: "Je consens à ce que ma conférence soit enregistrée et publiée.",
  },

  attendance: {
    question: 'Si votre conférence est retenue, comment viendrez-vous ?',
    help: 'Une réponse honnête nous aide à bâtir un horaire qui tient la route.',
    local: 'Je suis dans la région de Montréal — aucun déplacement requis',
    secured:
      "Mes déplacements et mon hébergement sont déjà couverts (employeur, programme GDE, ou à mes frais)",
    pending: "Je compte m'organiser, mais ce n'est pas encore confirmé",
    fundingSource: 'D’où provient le financement ?',
    fundingSourceHelp:
      'Une phrase suffit — par exemple, « budget conférences de mon employeur » ou « demande au programme GDE ».',
    decisionBy: 'Quand pensez-vous le savoir ?',
    decisionByHelp:
      "Si cette date suit le verrouillage du programme, vous pourriez être placé sur la liste d'attente.",
    needsVisa: "J'aurai besoin d'un visa ou d'une AVE pour entrer au Canada",
    visaGuidance:
      "Nous émettrons une lettre d'invitation dès votre acceptation. Commencez votre demande le plus tôt possible — les délais de traitement peuvent atteindre plusieurs mois.",
  },

  enums: {
    category: {
      app_dev: 'Développement d’applications',
      ai_ml: 'IA et apprentissage automatique',
      cloud: 'Infonuagique',
      web: 'Web',
      ui_ux: 'Interface et expérience utilisateur',
      soft_skills_career: 'Compétences humaines et carrière',
      other: 'Autre',
    },
    format: {
      session_40: 'Session — 40 minutes',
      lightning_15: 'Conférence éclair — 15 minutes',
      workshop_90: 'Atelier — 90 minutes',
    },
    level: {
      beginner: 'Débutant',
      intermediate: 'Intermédiaire',
      advanced: 'Avancé',
      all: 'Tous les niveaux',
    },
    deliveryLanguage: {
      en: 'Anglais',
      fr: 'Français',
      either: 'L’une ou l’autre — à vous de choisir',
      bilingual: 'Bilingue — j’alterne entre les deux pendant la conférence',
    },
    socialPlatform: {
      bluesky: 'Bluesky',
      linkedin: 'LinkedIn',
      github: 'GitHub',
      mastodon: 'Mastodon',
      x: 'X',
      website: 'Site web',
      other: 'Autre',
    },
  },

  form: {
    required: 'Obligatoire',
    optional: 'Facultatif',
    charsRemaining: (n: number) => `${n} caractères restants`,
    charsNeeded: (n: number) => `${n} caractères de plus requis`,
    save: 'Enregistrer le brouillon',
    saving: 'Enregistrement…',
    saved: 'Brouillon enregistré',
    saveFailed: 'Impossible d’enregistrer votre brouillon',
    submit: 'Soumettre la proposition',
    submitting: 'Soumission…',
    submitted: 'Votre proposition a été soumise.',
    submittedHelp:
      'Nous vous avons envoyé une copie par courriel. Vous pouvez encore la retirer, mais elle ne peut plus être modifiée.',
    withdraw: 'Retirer la proposition',
    withdrawConfirm: 'Retirer cette proposition ? Cette action est irréversible.',
    fixErrors: 'Veuillez vérifier les champs signalés.',
    errorCount: (n: number) =>
      n === 1 ? '1 champ requiert votre attention' : `${n} champs requièrent votre attention`,
  },

  errors: {
    generic: 'Une erreur est survenue. Veuillez réessayer.',
    signIn: 'Connexion impossible. Veuillez réessayer.',
    signedOut: 'Votre session a expiré. Veuillez vous reconnecter.',
    notFound: 'Cette proposition est introuvable.',
    incomplete: 'Des réponses sont manquantes ou invalides. Veuillez vérifier le formulaire.',
    unavailable: 'Ce service est indisponible pour le moment. Veuillez réessayer sous peu.',
    notOpen: 'L’appel à conférences n’est pas ouvert en ce moment.',
    readOnlyNow:
      'Ce formulaire ne peut plus être modifié — l’appel est peut-être terminé, ou votre proposition a déjà été soumise. Rechargez la page pour voir l’état actuel.',
    crashed: 'Un problème est survenu sur cette page. Rechargez — votre brouillon est conservé.',
    reload: 'Recharger',

    required: 'Ce champ est obligatoire.',
    invalid: 'Veuillez vérifier ce champ.',
    tooShort: (n: number) => `Au moins ${n} caractères.`,
    tooLong: (n: number) => `Au plus ${n} caractères.`,
    chooseOne: 'Choisissez une option.',
    mustAgree: 'Vous devez accepter ceci avant de soumettre.',
    email: 'Saisissez une adresse courriel valide.',

    rules: {
      fundingSourceRequired: 'Dites-nous d’où provient le financement.',
      fundingSourceNotApplicable:
        'Le financement ne s’applique pas aux conférenciers de la région.',
      decisionByRequired: 'Quand pensez-vous le savoir ?',
      decisionByNotApplicable:
        'La date de décision ne s’applique que si le financement est en attente.',
      languagePreferenceNotApplicable:
        'La préférence linguistique ne s’applique que si vous pouvez présenter dans les deux langues.',
      dateFormat: 'Utilisez le sélecteur de date.',
    },
  },
};
