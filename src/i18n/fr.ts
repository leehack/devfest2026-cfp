import type { Dictionary } from './en';

export const fr: Dictionary = {
  switchTo: 'English',

  app: {
    title: 'Appel à conférences',
    skipToContent: 'Aller au contenu',
    account: 'Compte',
    signedInAs: 'Connecté comme',
    closeNotification: 'Fermer la notification',
    darkTheme: 'Thème sombre',
    signIn: 'Se connecter',
    signInGoogle: 'Se connecter avec Google',
    signInHint:
      'Nous utilisons votre compte Google afin que vous puissiez revenir modifier votre brouillon.',
    signInCommitteeHint:
      'Connectez-vous avec l’adresse invitée par l’équipe organisatrice. Vous reviendrez ensuite à cet espace de travail.',
    signInAccountHint:
      'Connectez-vous pour voir votre profil et les appels où vous proposez, évaluez ou organisez.',
    signInEmailTitle: 'Pas de compte Google ?',
    signInEmailHint:
      'Nous vous enverrons un lien de connexion par courriel. Aucun mot de passe à choisir ni à retenir.',
    signInEmail: 'M’envoyer un lien',
    linkSending: 'Envoi…',
    linkSent:
      'Si {email} peut recevoir du courrier, un lien de connexion est en route. Il fonctionne une fois, pendant environ une heure.',
    linkChecking: 'Connexion en cours…',
    linkWhose: 'Une dernière chose',
    linkWhoseHelp:
      'Ce lien a été ouvert dans un autre navigateur que celui qui l’a demandé. Veuillez confirmer l’adresse utilisée.',
    linkContinue: 'Continuer',
    linkFailed:
      'Ce lien n’a pas fonctionné. Il a peut-être déjà servi ou expiré — demandez-en un nouveau ci-dessous.',
    linkTooMany: 'Cela fait beaucoup de liens en peu de temps. Veuillez réessayer dans une heure.',
    linkBadEmail: 'Cela ne ressemble pas à une adresse courriel.',
    linkUnavailable:
      'Cet événement ne peut pas encore envoyer de courriel de connexion. Utilisez Google ou communiquez avec l’équipe organisatrice.',
    signOut: 'Déconnexion',
    loading: 'Chargement…',
  },

  nav: {
    cfp: 'Événement',
    form: 'Mes propositions',
    schedule: 'Horaire',
    review: 'Évaluer',
    admin: 'Gérer l’événement',
    breadcrumb: 'Fil d’Ariane',
    eventSections: 'Sections de l’événement',
    forbidden: 'Cette page n’est pas accessible avec votre compte.',
    backToForm: 'Aller à mes propositions',
  },

  platform: {
    eyebrow: 'Pour les conférenciers et conférencières',
    title: 'Trouvez votre prochaine scène',
    help:
      'Explorez les appels à conférences, vérifiez les dates et choisissez où partager votre idée.',
    none: 'Aucun appel public n’est listé pour le moment. Revenez bientôt.',
    organiserEyebrow: 'Pour les organisateurs',
    organiserTitle: 'Vous organisez un événement ?',
    organiserHelp:
      'Créez un espace clair pour les soumissions, l’évaluation, les décisions et les communications.',
    yours: 'Les appels que vous tenez',
    yoursHelp: 'Vos appels publics, privés et archivés, réunis au même endroit.',
    helping: 'Où vous prêtez main-forte',
    helpingHelp: 'Les appels tenus par une autre équipe où vous faites partie du comité.',
    activity: 'Votre activité',
    activityHelp:
      'Reprenez un brouillon, une file d’évaluation ou un espace événement là où vous l’avez laissé.',
    submissions: 'Vos propositions',
    submissionsHelp:
      'Brouillons, conférences soumises et décisions dans tous les appels.',
    continueDraft: 'Continuer le brouillon',
    viewProposals: 'Voir les propositions',
    respondToDecision: 'Répondre à la décision',
    viewDecision: 'Voir la décision',
    reviewTalks: 'Évaluer',
    manageEvent: 'Gérer l’événement',
    view: 'Voir l’événement',
    cardLabel: '{name}. {status}. Adresse {path}.{details}',
    status: {
      open: 'Ouvert',
      upcoming: 'Ouverture prochaine',
      paused: 'En pause',
      closed: 'Terminé',
      archived: 'Archivé',
    },
    create: 'Lancer un appel à conférences',
    createEyebrow: 'Pour les organisateurs',
    createTitle: 'Créez votre appel à conférences',
    createDetailsTitle: 'Détails de l’événement',
    createHelp:
      'Commencez par l’essentiel. Vous passerez ensuite directement à la configuration des détails et du formulaire.',
    createStep: 'Étape {step} sur 3',
    createIdentity: 'Nom et adresse publique',
    createIdentityHelp: 'Ce sont les premiers repères que les conférenciers reconnaîtront et partageront.',
    createAccess: 'Choisissez qui peut le découvrir',
    createWindow: 'Fixez la période de soumission',
    nameLabel: 'Nom de l’événement',
    nameHelp: 'Ce que verront les conférenciers, et la signature de vos courriels.',
    addressLabel: 'Adresse (URL)',
    addressHelp:
      'Utilisez des minuscules, des chiffres et des traits d’union simples. Choisissez bien : cette adresse ne pourra plus être modifiée.',
    addressPreviewLabel: 'Adresse publique',
    addressImmutable: 'Permanente après la création',
    addressPreviewHelp: 'C’est le lien qu’utiliseront les conférenciers et les organisateurs.',
    visibilityLabel: 'Qui peut le trouver',
    visibilityPublic: 'Public — listé sur cette page, visible de tous',
    visibilityPrivate: 'Privé — accessible uniquement par son lien, et non listé ici',
    visibilityHelp:
      'Privé veut dire non listé, pas secret : toute personne ayant le lien peut le consulter.',
    opensLabel: 'Ouvre',
    closesLabel: 'Ferme',
    timeZone: 'Fuseau horaire de votre appareil : {zone}',
    timeZoneFallback: 'heure locale',
    ownerLabel: 'Compte propriétaire',
    ownerFallback: 'Votre compte',
    ownerHelp:
      'Ce compte connecté devient propriétaire. Vous pourrez ensuite inviter des administrateurs et des évaluateurs.',
    afterEyebrow: 'La suite',
    afterTitle: 'Vous arriverez dans votre espace de configuration',
    afterDetails: 'Ajoutez la description, la date, le lieu et le site web de l’événement.',
    afterForm: 'Vérifiez les questions et les choix proposés aux conférenciers.',
    afterTeam: 'Invitez les administrateurs et les évaluateurs lorsque vous serez prêt.',
    afterHelp: 'La création de l’appel ne publie ni n’envoie rien automatiquement.',
    submit: 'Créer',
    creating: 'Création…',
    submitHelp: 'Vous pourrez tout vérifier avant de partager le lien.',
    signInFirst: 'Connectez-vous pour lancer un appel à conférences.',
    notFound: 'Il n’y a aucun appel à conférences à cette adresse.',
    back: 'Tous les appels',
    archived: 'Archivé',
    private: 'Privé',
    closesOn: 'Ferme le {date}',
    opensOn: 'Ouvre le {date}',
    closedOn: 'Terminé le {date}',
    paused: 'Temporairement en pause',
    closed: 'Terminé',
    errors: {
      taken: 'Cette adresse est déjà prise. Essayez-en une autre.',
      idFormat: 'Minuscules, chiffres et traits d’union simples uniquement.',
      idLength: 'Cette adresse est trop courte ou trop longue.',
      nameEmpty: 'Il lui faut un nom.',
      nameLong: 'Ce nom est trop long.',
      visibility: 'Choisissez qui peut le trouver.',
      dates: 'Il fermerait avant d’ouvrir.',
      limit: 'Vous avez atteint la limite d’appels à conférences.',
      unverified: 'Vérifiez d’abord votre adresse courriel, puis rechargez cette page.',
    } as Record<string, string>,
  },

  platformAdmin: {
    title: 'Administration de la plateforme',
    accountLink: 'Accès à la plateforme',
    emailDefaultsAccountLink: 'Réglages courriel de la plateforme',
    eyebrow: 'Contrôles de la plateforme',
    intro:
      'Gérez les personnes pouvant créer des espaces d’appel et les réglages de courriel offerts à chaque événement. Les rôles des événements restent distincts : cet accès ne révèle ni propositions, ni profils, ni évaluations.',
    sections: 'Sections de l’administration de la plateforme',
    accessNav: 'Accès',
    emailDefaultsNav: 'Réglages courriel',
    accessTitle: 'Accès à la plateforme',
    accessHelp:
      'Les propriétaires, les administrateurs et les créateurs approuvés peuvent lancer un appel. Le retrait de cet accès ne supprime jamais les appels que la personne possède déjà.',
    addTitle: 'Approuver une personne',
    addHelp:
      'Utilisez l’adresse qu’elle vérifiera lors de sa connexion. L’accès attend en toute sécurité si son compte n’existe pas encore.',
    emailLabel: 'Adresse courriel',
    grant: 'Ajouter',
    granting: 'Ajout…',
    activeTitle: 'Personnes approuvées',
    activeHelp:
      'Les propriétaires sont gérés par le script d’amorçage. Ils peuvent déléguer l’administration; propriétaires et administrateurs peuvent approuver les créateurs d’appels.',
    pending: 'En attente d’une connexion vérifiée',
    roles: {
      owner: 'Propriétaire de la plateforme',
      admin: 'Administrateur de la plateforme',
      creator: 'Créateur d’appels',
    },
    isYou: 'vous',
    revoke: 'Retirer l’accès de création',
    revoking: 'Retrait…',
    revokeConfirm: (email: string) => `Retirer à ${email} l’accès à la création d’appels?`,
    empty: 'Aucun créateur d’appels n’a encore été approuvé.',
    grantedActive: (email: string) => `${email} peut maintenant créer des appels.`,
    grantedPending: (email: string) =>
      `${email} recevra l’accès après une connexion vérifiée.`,
    revoked: (email: string) => `${email} ne peut plus créer de nouveaux appels.`,
    adminAddTitle: 'Déléguer l’administration',
    adminAddHelp:
      'Les administrateurs peuvent approuver les créateurs d’appels, mais ne peuvent ni nommer d’autres administrateurs ni accéder aux données des événements.',
    adminEmailLabel: 'Adresse courriel de l’administrateur',
    adminGrant: 'Ajouter comme administrateur',
    adminGranting: 'Ajout…',
    adminRevoke: 'Retirer l’administration',
    adminRevoking: 'Retrait…',
    adminRevokeConfirm: (email: string) =>
      `Retirer à ${email} l’accès d’administration de la plateforme?`,
    adminGrantedActive: (email: string) =>
      `${email} est maintenant administrateur de la plateforme.`,
    adminGrantedPending: (email: string) =>
      `${email} deviendra administrateur après une connexion vérifiée.`,
    adminRevoked: (email: string) =>
      `${email} n’est plus administrateur de la plateforme.`,
    loadError: 'Impossible de charger les accès à la plateforme.',
    badEmail: 'Saisissez une adresse courriel valide.',
    adminManaged:
      'Cet accès est protégé. Les propriétaires gèrent les administrateurs, leur propre accès reste géré par le script d’amorçage et personne ne peut retirer son propre accès.',
    accessRequiredTitle: 'La création d’appels est restreinte',
    accessRequiredHelp:
      'Un administrateur de la plateforme doit approuver votre compte avant que vous puissiez lancer un nouvel appel.',
    checkAgain: 'Vérifier l’accès de nouveau',
    retry: 'Réessayer',
    emailDefaultsTitle: 'Réglages courriel de la plateforme',
    emailDefaultsIntro:
      'Les événements peuvent utiliser ce domaine vérifié, cet expéditeur et cette adresse de réponse sans répéter la configuration. Chaque événement garde le contrôle de ses propres textes.',
    emailDefaultsLoadError: 'Impossible de charger les réglages courriel de la plateforme.',
    emailDefaultsProviderTitle: 'Service de livraison partagé',
    emailDefaultsProviderHelp:
      'La clé Resend et le domaine de la plateforme sont des contrôles privés. Les administrateurs d’événement voient seulement si la livraison partagée est prête et l’expéditeur effectif.',
    emailDefaultsActiveDomainTitle: 'Domaine actif de la plateforme',
    emailDefaultsActiveDomainHelp:
      'Les événements qui héritent continuent d’utiliser ce domaine pendant la préparation et la vérification d’un remplacement.',
    emailDefaultsNoActiveDomain: 'Aucun domaine de plateforme n’est encore actif.',
    emailDefaultsStagedDomainTitle: 'Remplacement en préparation',
    emailDefaultsStagedDomainHelp:
      'L’ajout réserve le domaine à la plateforme sans changer la livraison. Vérifiez son DNS, puis activez-le explicitement.',
    emailDefaultsNoStagedDomain: 'Aucun domaine de remplacement n’est en préparation.',
    emailDefaultsActivateDomain: 'Activer le domaine vérifié',
    emailDefaultsActivateDomainDirty:
      'Enregistrez ou annulez d’abord la modification inachevée du service ou de l’expéditeur.',
    emailDefaultsDomainActivated: 'Domaine vérifié de la plateforme activé.',
    emailDefaultsDomainActivatedSenderCleared:
      'Domaine vérifié de la plateforme activé. Enregistrez un expéditeur correspondant pour reprendre la livraison.',
    emailDefaultsSenderTitle: 'Expéditeur par défaut',
    emailDefaultsSenderHelp:
      'Les nouveaux événements et ceux qui héritent utilisent ces adresses. L’enregistrement ne remplace jamais le réglage propre à un événement.',
    emailDefaultsReady: 'La livraison de la plateforme est prête',
    emailDefaultsReadyHelp: 'Les événements peuvent maintenant hériter de cette configuration.',
    emailDefaultsBlocked: 'La livraison de la plateforme doit être configurée',
    emailDefaultsBlockedHelp:
      'Configurez la clé, le domaine vérifié et l’expéditeur avant que les événements puissent en hériter.',
    emailDefaultsSaved: 'Expéditeur par défaut de la plateforme enregistré.',
    emailDefaultsTest: 'Envoyer un courriel test',
    emailDefaultsTestNeedsSetup:
      'Terminez la configuration de livraison partagée avant d’envoyer un test.',
    emailDefaultsTestSent: 'Courriel test envoyé à {to}.',
    emailDefaultsTestDryRun: 'Test rendu localement; aucun message n’a été envoyé.',
  },

  cfpPage: {
    eyebrow: 'Appel à conférences',
    status: {
      before: 'Ouverture prochaine',
      open: 'Soumissions ouvertes',
      paused: 'Temporairement en pause',
      closed: 'Soumissions terminées',
      archived: 'Archivé',
    },
    when: 'Quand',
    where: 'Où',
    website: 'Site web',
    noDescription: 'Plus de détails sur l’événement seront bientôt ajoutés.',
    noDescriptionHelp: 'La période de soumission est prête et les dates ci-dessous sont à jour.',
    nextStep: 'Prochaine étape',
    submitting: 'Proposer une conférence',
    managing: 'Vos propositions',
    submitAction: 'Proposer une conférence',
    manageAction: 'Voir vos propositions',
    submitNote:
      'Connectez-vous pour commencer un brouillon. Vous pourrez y revenir avant de le soumettre.',
    submitBeforeNote: 'Le formulaire sera accessible ici à l’ouverture de l’appel.',
    submitPausedNote: 'Les soumissions sont temporairement en pause. Revenez bientôt.',
    submitClosedNote:
      'Les soumissions sont terminées. Les organisateurs communiqueront la suite aux conférenciers.',
    submitArchivedNote: 'Cet appel est archivé et n’accepte plus de soumissions.',
  },

  profile: {
    link: 'Votre profil',
    eyebrow: 'Compte de conférencier',
    title: 'Votre profil',
    editorTitle: 'Renseignements du conférencier',
    help:
      'Ceci appartient à votre compte, et non à un appel à conférences en particulier. Après l’enregistrement, ouvrez une séance soumise pour choisir si sa copie pour l’événement doit utiliser ces renseignements à jour.',
    complete: 'Prêt à utiliser',
    needsAttention: 'À compléter',
    unsaved: 'Modifications non enregistrées',
    leaveConfirm: 'Quitter sans enregistrer les modifications de votre profil ?',
    save: 'Enregistrer le profil',
    saving: 'Enregistrement…',
    saved: 'Enregistré.',
    saveFailed: 'Impossible d’enregistrer votre profil',
    retrySave: 'Réessayer',
    incomplete: 'Certains champs restent à remplir.',
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
    speakerHelp:
      'Rattaché à votre compte, pas à une conférence. Il reste modifiable après la soumission; chaque séance soumise conserve sa propre copie jusqu’à ce que vous la mettiez à jour explicitement.',
    extra: 'Quelques questions de plus',
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
    basedIn: 'Lieu de résidence',
    basedInHelp: 'Ville et région — par exemple, Montréal, QC.',
    socials: 'Liens',
    socialsHelp: 'Facultatif. Où l’on peut vous trouver.',
    sessionizeUrl: 'Profil Sessionize',
    sessionizeUrlHelp:
      'Facultatif. Enregistré avec votre profil, afin que l’importation en haut d’un formulaire vous soit proposée sans redemander.',
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

  profilePhoto: {
    title: 'Photo du conférencier',
    help:
      'Cette photo de profil réutilisable n’est pas jointe aux propositions ni montrée au comité. Si une séance est retenue, vous pourrez approuver sa version exacte pour le programme au moment de la confirmation.',
    previewAlt: 'Photo actuelle du profil de conférencier',
    chooseLabel: 'Choisir la photo du profil de conférencier',
    requirements: (pixels: number) =>
      `JPEG, PNG ou WebP · jusqu’à 5 Mo · au moins ${pixels} × ${pixels} pixels.`,
    tooSmall: (pixels: number) =>
      `Choisissez une photo d’au moins ${pixels} pixels de chaque côté.`,
    loadFailed: 'Impossible de charger la photo actuelle du conférencier.',
    uploadFailed: 'Impossible de téléverser la photo du conférencier. Réessayez.',
    remove: 'Retirer la photo',
    removeConfirm:
      'Retirer cette photo de votre profil réutilisable ? Les copies déjà approuvées pour un événement resteront inchangées.',
    removeFailed: 'Impossible de retirer la photo du conférencier. Réessayez.',
    sessionUpdateTitle: 'Une nouvelle photo de profil est disponible',
    sessionUpdateHelp:
      'Cette séance utilise encore la photo approuvée précédemment. Remplacez-la seulement lorsque la nouvelle photo est prête pour le programme.',
    sessionCurrentTitle: 'Photo approuvée pour cette séance',
    sessionCurrentHelp:
      'La séance utilise exactement cette photo de profil. Le programme publié conserve sa copie actuelle jusqu’à une nouvelle publication.',
    sessionRemovalTitle: 'Photo retirée du profil',
    sessionRemovalHelp:
      'Cette séance utilise encore la photo approuvée précédemment. Retirez cette copie de l’événement seulement si vous ne voulez aucune photo dans le programme.',
    sessionEmptyTitle: 'Aucune photo approuvée pour cette séance',
    sessionEmptyHelp:
      'La photo facultative de cette séance est vide. Vous pourrez en ajouter une à votre profil lorsque vous serez prêt.',
    sessionRequiredTitle: 'Cette séance exige une photo de conférencier',
    sessionRequiredHelp:
      'Ajoutez une photo de profil avant de mettre cette séance à jour. Toute copie déjà approuvée pour le programme reste inchangée.',
    useForSession: 'Utiliser cette photo pour cette séance',
    removeFromSession: 'Retirer la photo de cette séance',
    sessionUpdating: 'Mise à jour de la photo de la séance…',
    sessionUpdateFailed: 'Impossible de mettre à jour la photo de la séance. Réessayez.',
  },

  profileSnapshot: {
    title: 'Profil utilisé pour cette séance',
    help:
      'Le profil de votre compte reste modifiable. Cette séance conserve une copie distincte pour l’événement afin que les changements ultérieurs ne modifient pas silencieusement ce que voient le comité ou le public.',
    adminHelp:
      'Ceci copie dans la séance les derniers champs publics du profil du conférencier. Les organisateurs n’obtiennent pas accès au profil global privé et les réponses de confirmation et de déplacement ne changent pas.',
    updateSelf: 'Utiliser mon profil à jour pour cette séance',
    updateSpeaker: (name: string) => `Utiliser le profil à jour de ${name}`,
    updating: 'Mise à jour de la copie de la séance…',
    updated: 'Profil de la séance mis à jour.',
    unchanged: 'Cette séance utilise déjà le profil à jour.',
    scheduleNotice:
      'L’horaire de travail doit maintenant être vérifié. Les versions partagée et publiée du programme restent inchangées jusqu’à un nouveau partage et une nouvelle publication.',
    notReady:
      'Complétez le profil et vérifiez que ce compte fait toujours partie des conférenciers actifs.',
    failed: 'Impossible de mettre à jour le profil de la séance. Réessayez.',
    gdeLabel: 'Google Developer Expert',
    yes: 'Oui',
    no: 'Non',
    notProvided: 'Non renseigné',
    reviewAdmin: 'Vérifier les changements au profil',
    reviewSelf: 'Vérifier les changements pour cette séance',
    reviewing: 'Vérification du profil…',
    reviewEyebrow: 'Comparaison de la copie de la séance',
    reviewTitle: (name: string) =>
      name ? `Changements au profil de ${name}` : 'Changements au profil',
    reviewHelp:
      'Seuls les champs différents sont affichés. Rien ne change sans votre confirmation explicite.',
    closeReview: 'Fermer la comparaison',
    sessionCopy: 'Utilisé par cette séance',
    latestProfile: 'Dernier profil du compte',
    noChangesTitle: 'Les renseignements du profil sont déjà à jour',
    noChangesHelp: 'Aucun changement au profil ne doit être appliqué à cette séance.',
    photoChangedTitle: 'La photo de profil est différente',
    photoChangedHelp:
      'La photo reste sous le contrôle du conférencier. Demandez-lui d’approuver sa photo de profil actuelle pour cette séance.',
    photoState: {
      present: 'Photo enregistrée',
      absent: 'Aucune photo',
    },
    apply: 'Appliquer les changements au profil',
    applying: 'Application des changements…',
    reviewChanged:
      'Le profil a changé pendant que cette comparaison était ouverte. Vérifiez les différences à jour avant de les appliquer.',
    requestUpdate: 'Demander une mise à jour',
    expandRequest: 'Demander un autre élément',
    requestAgain: 'Demander une autre mise à jour',
    requestItems: 'Que doit mettre à jour le conférencier ?',
    requestHelp:
      'Cette demande concerne uniquement cette personne et cette séance. Sélectionnez au moins un élément.',
    scope: {
      profile: 'Renseignements du profil',
      photo: 'Photo du conférencier',
    },
    scopeHelp: {
      profile: 'Nom, biographie, entreprise, poste, liens et titres publics.',
      photo: 'La photo de profil réutilisable, approuvée séparément pour cette séance.',
    },
    requestInAppOnly:
      'La demande apparaît dans l’espace de cette séance et un courriel avec le lien exact de la séance est mis en file automatiquement.',
    sendRequest: 'Ajouter la demande',
    requesting: 'Ajout de la demande…',
    cancelRequest: 'Annuler',
    requestCreated:
      'La demande a été ajoutée. Un courriel de notification est mis en file pour le conférencier.',
    requestExpanded: 'L’élément supplémentaire a été ajouté à la demande existante.',
    requestAlreadyPending: 'Cette mise à jour est déjà demandée.',
    cancelPendingRequest: 'Annuler la demande',
    cancellingRequest: 'Annulation…',
    cancelRequestConfirm:
      'Annuler cette demande de mise à jour du profil ? Elle ne sera plus présentée au conférencier comme une action à terminer.',
    requestCancelled: 'Demande de mise à jour du profil annulée.',
    requestPendingAdmin: 'Mise à jour demandée',
    requestShareHelp:
      'Un courriel de notification a été mis en file automatiquement. Vous pouvez aussi copier le lien exact de la séance comme solution de rechange.',
    copySessionLink: 'Copier le lien de la séance',
    sessionLinkCopied: 'Lien de séance copié.',
    sessionLinkCopyFailed: 'Impossible de copier le lien de la séance. Réessayez.',
    requestEyebrow: 'Demande de l’organisation',
    requestPendingTitle: 'Votre profil demande une intervention pour cette séance',
    requestPendingHelp:
      'Votre séance reste confirmée. Mettez à jour l’élément demandé dans le profil de votre compte, puis appliquez-le explicitement à cette séance.',
    requestedItems: 'Éléments du profil demandés',
    requestStepEdit: 'Modifiez et enregistrez l’élément demandé dans le profil de votre compte.',
    requestStepAdopt:
      'Appliquez les renseignements ici ou choisissez « Utiliser cette photo pour cette séance » pour la photo.',
    requestStepPublish:
      'L’organisation vérifie et republie; le programme actuel demeure inchangé entre-temps.',
    editProfile: 'Modifier le profil du compte',
    editPhoto: 'Aller à la photo du conférencier',
    completeRequest: 'Marquer les éléments demandés comme terminés',
    completingRequest: 'Vérification des éléments…',
    completeRequestHelp:
      'Utilisez cette action si les renseignements demandés sont déjà corrects ou après avoir appliqué vos changements à cette séance.',
    requestCompleted: 'Demande de mise à jour du profil terminée.',
    requestPartlyComplete:
      'Les éléments à jour sont terminés. Complétez le reste de la demande.',
    requestNotReady:
      'La copie de la séance n’est pas encore à jour. Appliquez les renseignements ou la photo, puis réessayez.',
    requestResolvedTitle: 'Demande de mise à jour terminée',
    requestResolvedHelp:
      'Les éléments demandés sont maintenant liés à cette séance. L’organisation peut vérifier et republier le programme.',
    pickerBadge: 'Mise à jour du profil demandée',
    taskLoadFailed: 'Impossible de vérifier les demandes de profil',
    taskLoadFailedHelp:
      'Vos propositions restent accessibles, mais certaines pastilles peuvent manquer jusqu’à ce que cette vérification réussisse.',
    adminQueueEyebrow: 'Suivi des conférenciers',
    adminQueueTitle: 'File des mises à jour de profil',
    adminQueueHelp:
      'Les demandes en attente nécessitent une action du conférencier. Les demandes prêtes nécessitent une vérification et un nouveau partage du programme.',
    adminQueueEmpty: 'Aucune mise à jour de profil ne demande une intervention.',
    adminQueueLoadFailed: 'Impossible de charger les demandes de mise à jour de profil.',
    waitingOnSpeaker: 'En attente du conférencier',
    readyToReview: 'Prête à vérifier',
    waitingCount: (count: number) => `En attente du conférencier · ${count}`,
    readyCount: (count: number) => `Prête à vérifier · ${count}`,
    viewRequest: 'Voir la demande',
    reviewReady: 'Vérifier la mise à jour',
    reviewSpeakerRequest: (speaker: string, session: string) =>
      `Vérifier la mise à jour du profil de ${speaker} pour ${session}`,
    filterLabel: 'Suivi du profil',
    filterAll: 'Tous les états du profil',
  },

  acks: {
    cocLink: 'Lire le code de conduite',
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
    deliveryLanguage: {
      en: 'Anglais',
      fr: 'Français',
      either: 'L’une ou l’autre — à vous de choisir',
      bilingual: 'Bilingue — j’alterne entre les deux pendant la conférence',
    },
    status: {
      draft: 'Brouillon',
      submitted: 'Soumise',
      under_review: 'En évaluation',
      accepted: 'Acceptée',
      confirmed: 'Confirmée',
      declined: 'Déclinée',
      waitlisted: 'Liste d’attente',
      rejected: 'Refusée',
      withdrawn: 'Retirée',
    },
    role: {
      owner: 'Propriétaire',
      reviewer: 'Évaluateur',
      admin: 'Administrateur',
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
    saveChanges: 'Enregistrer les modifications',
    saving: 'Enregistrement…',
    saved: 'Brouillon enregistré',
    saveFailed: 'Impossible d’enregistrer votre brouillon',
    retrySave: 'Réessayer l’enregistrement',
    unsaved: 'Modifications pas encore enregistrées',
    progress: 'Sections de la proposition',
    progressSummary: (complete: number, total: number) =>
      `${complete} section${complete === 1 ? '' : 's'} sur ${total}`,
    sectionComplete: 'Terminée',
    sectionIncomplete: 'À compléter',
    sectionAttention: 'À vérifier',
    submissionContext: 'Détails de la soumission',
    acceptingNow: 'Soumissions ouvertes',
    deadline: 'Date limite',
    deadlineTimeZone: 'Fuseau horaire de l’événement : {zone}',
    profileReady: 'Profil prêt',
    editProfile: 'Modifier le profil',
    submit: 'Soumettre la proposition',
    submitting: 'Soumission…',
    submittedHelp: 'Nous vous avons envoyé une copie par courriel.',
    journeyLabel: 'Parcours de la proposition',
    journeySteps: ['Proposition', 'Comité', 'Décision', 'Programme'],
    journeyOutcome: 'Résultat',
    nextStep: 'Prochaine étape',
    nextSteps: {
      archived: {
        title: 'Cet événement est archivé',
        help: 'La proposition est conservée en lecture seule. Communiquez avec l’équipe si quelque chose est incorrect.',
      },
      draft: {
        title: 'Terminez et soumettez votre proposition',
        help: 'Votre brouillon est privé. Remplissez les sections obligatoires, puis soumettez-le avant l’échéance.',
      },
      draftPaused: {
        title: 'Les soumissions sont temporairement suspendues',
        help: 'Votre brouillon est conservé en sécurité et redeviendra modifiable lorsque l’équipe rouvrira l’appel.',
      },
      coSpeakerDraft: {
        title: 'Complétez vos renseignements de conférencier',
        help: 'Terminez votre profil et vos renseignements de participation. Le conférencier principal soumettra la proposition lorsque chaque personne sera prête.',
      },
      draftClosed: {
        title: 'Ce brouillon n’a pas été soumis',
        help: 'La période est fermée. Gardez le brouillon pour vos dossiers ou supprimez-le si vous n’en avez plus besoin.',
      },
      submittedEditable: {
        title: 'Vérifiez ce que vous avez soumis',
        help: 'Le comité n’a pas commencé sa lecture; vous pouvez encore corriger la proposition avant son verrouillage.',
      },
      submitted: {
        title: 'Attendez le comité',
        help: 'Votre proposition est bien soumise. Nous vous écrirons lorsque l’équipe enregistrera une décision.',
      },
      underReview: {
        title: 'Le comité l’évalue',
        help: 'Le contenu est verrouillé pour une évaluation équitable. Votre profil et vos détails de voyage restent modifiables.',
      },
      underReviewNoAttendance: {
        title: 'Le comité l’évalue',
        help: 'Le contenu est verrouillé pour une évaluation équitable. Votre profil de conférencier reste modifiable.',
      },
      accepted: {
        title: 'Confirmez si vous pouvez présenter',
        help: 'Répondez à l’invitation ici et remplissez chaque détail obligatoire avant la planification de la séance.',
      },
      confirmedPublic: {
        title: 'Vérifiez votre séance publiée',
        help: 'Votre séance est publique. Vérifiez l’heure et la salle finales, puis téléchargez son entrée de calendrier.',
      },
      confirmedShared: {
        title: 'Vérifiez votre plage de travail',
        help: 'Vérifiez l’heure, la salle et la langue. Signalez tout conflit par le canal convenu; ce placement n’est pas encore public.',
      },
      confirmedUnavailable: {
        title: 'Rechargez avant de vous fier à une heure',
        help: 'Impossible de charger la plage actuelle du programme; aucune heure n’est affichée avant le rechargement.',
      },
      confirmedPending: {
        title: 'Attendez une nouvelle plage',
        help: 'L’horaire de travail actuel n’attribue aucune heure à cette séance. L’équipe partagera une nouvelle version.',
      },
      confirmedWaiting: {
        title: 'Attendez l’horaire de travail',
        help: 'Votre présence est confirmée. Votre plage paraîtra ici après le partage d’un aperçu confirmé.',
      },
      confirmedWaitingOnSpeaker: {
        title: 'Attendez la réponse de l’autre conférencier',
        help: 'Votre réponse est enregistrée. La séance sera confirmée lorsque chaque conférencier actif aura répondu.',
      },
      confirmedSpeakerDeclined: {
        title: 'L’équipe doit vérifier la liste des conférenciers',
        help: 'Votre réponse est enregistrée, mais un autre conférencier actif a décliné. L’équipe communiquera avec vous pour la suite.',
      },
      waitlisted: {
        title: 'Surveillez vos courriels',
        help: 'La proposition reste en considération si une place se libère. L’équipe vous écrira si son statut change.',
      },
      rejected: {
        title: 'Cette proposition n’a pas été retenue',
        help: 'Aucune action n’est requise. Votre profil reste à vous et pourra servir pour un autre événement.',
      },
      declined: {
        title: 'Vous avez décliné l’invitation',
        help: 'L’équipe peut offrir la place ailleurs. Communiquez directement avec elle si vos disponibilités changent.',
      },
      withdrawn: {
        title: 'Cette proposition est retirée',
        help: 'Elle ne sera ni évaluée ni planifiée. L’équipe en conserve le dossier; aucune action n’est requise.',
      },
    },

    statusHelp: {
      submitted: 'C’est envoyé. Le comité n’a pas encore commencé sa lecture.',
      under_review: 'Le comité est en train de la lire.',
      accepted:
        'Votre proposition a été acceptée. Dites-nous si vous pouvez toujours être présent afin que l’équipe puisse planifier une plage.',
      confirmed:
        'Votre présence est confirmée. Les détails paraîtront ici lorsque l’équipe partagera un aperçu confirmé.',
      waitlisted:
        'Pas encore retenue, mais pas écartée — nous revenons à la liste d’attente dès qu’une place se libère.',
      rejected:
        'Pas cette année. Il y a eu plus de bonnes propositions que de places, et nous en sommes désolés.',
      declined: 'Vous avez décliné la place.',
      withdrawn:
        'Vous avez retiré celle-ci. Elle n’est plus évaluée ni comptée dans votre limite; les organisateurs en conservent le dossier.',
    } as Record<string, string>,
    scheduledHelp: 'Votre présence est confirmée et cette séance figure maintenant au programme publié.',
    sharedScheduledHelp:
      'Votre présence est confirmée et l’équipe vous a communiqué votre plage actuelle.',
    sharedUnscheduledHelp:
      'Votre présence est confirmée, mais l’aperçu partagé actuel n’attribue pas encore d’heure à cette séance. L’équipe communiquera une nouvelle mise à jour lorsque cela changera.',
    scheduleDetails: 'Votre séance publiée',
    sharedScheduleDetails: 'Votre horaire de travail',
    sharedScheduleHelp:
      'Cette plage vous est communiquée pour la planification. Elle n’est pas encore publique et peut changer.',
    viewScheduledSession: 'Voir les détails de la séance',

    editHelp: {
      all: 'Vous pouvez encore tout modifier ici jusqu’à la date limite.',
      logistics:
        'La conférence elle-même est maintenant verrouillée. Votre profil et vos réponses de voyage restent modifiables.',
      none: 'Celle-ci est close. Votre profil vous appartient toujours.',
    } as Record<string, string>,
    editHelpNoAttendance: {
      all: 'Vous pouvez encore modifier tout ce que cet événement demande jusqu’à l’échéance.',
      logistics:
        'La conférence elle-même est maintenant verrouillée. Votre profil de conférencier reste modifiable.',
      none: 'Celle-ci est close. Votre profil vous appartient toujours.',
    } as Record<string, string>,
    pastTalksCount: (count: number) => `Propositions passées (${count})`,
    deleteDraft: 'Supprimer le brouillon',
    deleteDraftConfirm:
      'Supprimer définitivement ce brouillon ? Votre profil sera conservé, mais cette proposition sera irrécupérable.',
    draftDeleted: 'Brouillon supprimé.',
    withdraw: 'Retirer la proposition',
    withdrawConfirm: 'Retirer cette proposition ? Cette action est irréversible.',
    confirmAccept: 'Oui, je serai là',
    confirmDecline: 'Je dois décliner',
    confirmDeclineConfirm:
      'Décliner cette place ? Nous l’offrirons à quelqu’un d’autre : elle pourrait ne plus être disponible si vous changez d’avis.',
    answersHelp:
      'Quelques informations dont nous avons besoin avant la journée. Vous pourrez les modifier plus tard.',
    answersSubmit: 'Confirmer ma conférence',
    answersCancel: 'Retour',
    answersTitle: 'Vos informations',
    answersSave: 'Enregistrer',
    answersIncomplete: 'Veuillez vérifier les questions signalées.',
    confirmationAnswersSaved: 'Renseignements de confirmation enregistrés.',
    confirmationAnswersSaveFailed:
      'Impossible d’enregistrer vos renseignements de confirmation. Veuillez réessayer.',
    discardUnsubmittedAnswersConfirm:
      'Ces réponses de confirmation n’ont pas été soumises. Les abandonner et continuer ?',
    imageChoose: 'Choisir une photo',
    imageReplace: 'Choisir une autre photo',
    imageUploading: 'Téléversement…',
    imageHint: 'JPEG, PNG ou WebP, jusqu’à 5 Mo. Une photo carrée se recadre le mieux.',
    imageType: 'Ce fichier n’est pas un JPEG, un PNG ni un WebP.',
    imageTooBig: 'Cette photo dépasse 5 Mo. Veuillez en choisir une plus légère.',
    imageFailed: 'Le téléversement n’a pas abouti. Veuillez réessayer.',
    answerPick: 'Choisir…',
    answerErrors: {
      required: 'Cette réponse est requise.',
      tooLong: 'C’est plus long que ce que nous pouvons enregistrer.',
      notAnOption: 'Veuillez choisir l’une des options.',
      wrongType: 'Cette réponse n’est pas passée — veuillez réessayer.',
    } as Record<string, string>,
    yourTalks: 'Vos conférences',
    untitled: 'Conférence sans titre',
    newTalk: 'Nouvelle conférence',
    addTalk: '+ Une autre conférence',
    talkCap: (n: number) => `C’est le maximum de ${n}.`,
    fixErrors: 'Veuillez vérifier les champs signalés.',
    errorCount: (n: number) =>
      n === 1 ? '1 champ requiert votre attention' : `${n} champs requièrent votre attention`,
  },

  admin: {
    sections: 'Sections d’administration',
    sectionPicker: 'Section',
    workspace: 'Gestion de l’événement',
    tabs: {
      overview: 'Tableau de bord',
      proposals: 'Propositions',
      schedule: 'Horaire',
      committee: 'Comité',
      settings: 'Configuration',
      submission: 'Formulaire',
      confirmation: 'Formulaire de confirmation',
      email: 'Courriel',
    },
    setupTitle: 'Terminez l’essentiel avant de partager',
    setupHelp:
      'Une page publique claire, une période valide, un comité et des courriels fiables préparent l’appel pour les conférenciers.',
    readyTitle: 'Prêt à accueillir les conférenciers',
    readyHelp: 'L’essentiel est en place. Suivez la ronde à mesure que les propositions arrivent.',
    readiness: 'État de la préparation',
    cfpStates: {
      before: 'Planifié',
      open: 'Propositions ouvertes',
      closed: 'Soumissions terminées',
      paused: 'Soumissions en pause',
      archived: 'Archivé',
    },
    previewLinks: 'Liens d’aperçu et de travail',
    previewPublic: 'Voir la page publique',
    previewSubmission: 'Voir la soumission',
    openReview: 'Ouvrir l’espace d’évaluation',
    roundActivity: 'Activité de la ronde',
    metricProposals: 'Soumises',
    metricScored: 'Évaluées',
    metricDecided: 'Décidées',
    metricDeadline: 'Échéance',
    metricNeedsReview: 'Sans évaluation',
    metricNeedsDecision: 'Décision requise',
    metricAwaitingConfirmation: 'Réponse attendue',
    metricConfirmed: 'Confirmées',
    metricUnscheduled: (count: number) =>
      count === 1 ? ' · 1 non planifiée' : ` · ${count} non planifiées`,
    notSet: 'Non définie',
    lifecycle: {
      step: (current: number, total: number) =>
        `Prochaine action recommandée · Étape ${current} sur ${total}`,
      allSteps: 'Afficher les 17 étapes du cycle',
      skipLateIntake: 'Ignorer les ajouts tardifs et préparer la clôture de l’événement',
      programmeLabel: 'Programme',
      programmePrivate: 'Planification privée',
      programmeShared: 'Aperçu partagé',
      programmeLive: 'Public et à jour',
      programmeUpdate: 'Mise à jour publique requise',
      lateIntakeTitle: 'Le programme est public pendant que les propositions sont ouvertes',
      lateIntakeHelp:
        'Rouvrir les propositions ne change pas le programme public. Les ajouts tardifs passent toujours par l’évaluation, la confirmation, l’horaire privé, un nouvel aperçu partagé, puis une nouvelle publication explicite.',
      publicUpdateTitle: 'Le programme public comporte du travail non publié',
      publicUpdateHelp:
        'Gardez la version publique actuelle stable pendant les changements privés. Partagez un aperçu confirmé, recueillez les commentaires, puis publiez exactement cette version.',
      scheduleUnknown:
        'Impossible de vérifier l’état de l’horaire. Ouvrez Horaire avant de vous fier à cette position du cycle.',
      steps: [
        {
          title: 'Configurer l’événement',
          help: 'Terminez les détails publics, la période de propositions, les formulaires, le comité et l’envoi des courriels.',
          action: 'Terminer la configuration',
        },
        {
          title: 'Recevoir les propositions',
          help: 'Partagez la page de l’événement et surveillez les propositions complètes prêtes pour le comité.',
          action: 'Ouvrir la page publique',
        },
        {
          title: 'Évaluer les propositions',
          help: 'Les membres répondent de façon indépendante. Un conflit compte comme réponse, pas comme note.',
          action: 'Ouvrir les évaluations',
        },
        {
          title: 'Décider des résultats',
          help: 'Choisissez acceptée, sur la liste d’attente ou refusée. La confirmation appartient au conférencier.',
          action: 'Décider des propositions',
        },
        {
          title: 'Aviser et confirmer',
          help: 'Vérifiez les décisions retenues, envoyez-les et attendez que les conférenciers acceptés remplissent chaque détail obligatoire.',
          action: 'Vérifier la file de courriels',
        },
        {
          title: 'Construire l’horaire privé',
          help: 'Placez provisoirement les conférences acceptées et planifiez les conférences confirmées.',
          action: 'Ouvrir l’horaire',
        },
        {
          title: 'Partager l’horaire de travail',
          help: 'Créez un aperçu réservé aux conférences confirmées sans changer ce que voit le public.',
          action: 'Vérifier et partager',
        },
        {
          title: 'Vérifier l’horaire de travail',
          help: 'Demandez au comité et aux conférenciers planifiés de vérifier l’heure, la salle et la langue, puis de répondre par le canal convenu.',
          action: 'Fermer les propositions après les vérifications',
        },
        {
          title: 'Fermer les propositions',
          help: 'Fermez la période lorsque la collecte prévue est terminée. L’aperçu de travail reste privé.',
          action: 'Gérer la période',
        },
        {
          title: 'Publier le programme',
          help: 'Publiez exactement l’aperçu partagé actuel après avoir vérifié son horaire et son contenu.',
          action: 'Vérifier la publication',
        },
        {
          title: 'Ajouter des conférenciers à la dernière minute',
          help: 'Utilisez le même parcours de proposition et de confirmation pour ne contourner aucun détail obligatoire.',
          action: 'Préparer les ajouts tardifs',
        },
        {
          title: 'Recevoir les propositions tardives',
          help: 'Gardez la période tardive limitée ouverte sans changer le programme déjà public.',
          action: 'Ouvrir la page publique',
        },
        {
          title: 'Évaluer les nouvelles propositions',
          help: 'Évaluez les ajouts tardifs de façon indépendante; le programme public actuel reste stable.',
          action: 'Évaluer les ajouts',
        },
        {
          title: 'Décider des ajouts',
          help: 'Acceptez, mettez en attente ou refusez les ajouts selon les mêmes règles.',
          action: 'Décider des ajouts',
        },
        {
          title: 'Aviser et confirmer les ajouts',
          help: 'Envoyez les décisions retenues et recueillez les détails obligatoires avant de planifier.',
          action: 'Vérifier la file de courriels',
        },
        {
          title: 'Mettre à jour le programme public',
          help: 'Ajoutez les conférences confirmées en privé, partagez de nouveau pour vérification, puis publiez la nouvelle version.',
          action: 'Mettre à jour l’horaire',
        },
        {
          title: 'Clore l’événement',
          help: 'Après l’événement, conservez le dossier et archivez l’espace de travail lorsque les opérations sont terminées.',
          action: 'Vérifier l’archivage',
        },
      ],
    },
    setupChecklist: 'Liste de préparation',
    setupChecklistSummary: (done: number, total: number) =>
      `Liste de préparation · ${done} essentiels sur ${total} terminés`,
    setupChecklistHelp: 'Chaque élément mène exactement à l’endroit où le terminer.',
    refreshOverview: 'Actualiser l’état',
    optional: 'Facultatif',
    setupDetails: 'Publier les détails utiles de l’événement',
    setupDetailsDone: 'Description, date, lieu et site web sont prêts.',
    setupDetailsTodo: 'Ajoutez une description, une date, un lieu et un site web.',
    setupDetailsAction: 'Modifier l’événement',
    setupWindow: 'Confirmer la période de soumission',
    setupWindowDone: (opens: string, closes: string) =>
      `Du ${opens} au ${closes}.`,
    setupWindowTodo: 'Choisissez des heures d’ouverture et de fermeture valides.',
    setupWindowAction: 'Modifier la période',
    setupSubmission: 'Vérifier le formulaire de soumission',
    setupSubmissionDone: 'Chaque taxonomie offre au moins une option.',
    setupSubmissionTodo: 'Une ou plusieurs taxonomies obligatoires n’ont aucune option.',
    setupSubmissionAction: 'Modifier le formulaire',
    setupCommittee: 'Former le comité',
    setupCommitteeDone: (n: number) =>
      n === 1 ? '1 membre du comité est actif ou invité.' : `${n} membres du comité sont actifs ou invités.`,
    setupCommitteeTodo: 'Invitez au moins une autre personne à évaluer avec vous.',
    setupCommitteeAction: 'Inviter des évaluateurs',
    setupEmail: 'Terminer l’envoi des courriels',
    setupEmailDone: 'La clé API, le domaine vérifié et l’expéditeur sont configurés.',
    setupEmailTodo: 'Terminez la clé API, le domaine vérifié et l’expéditeur.',
    setupEmailProblems: (problems: string[]) => `Encore requis : ${problems.join('; ')}.`,
    setupEmailUnavailable:
      'Impossible de vérifier la configuration du courriel pour le moment. Ouvrez Courriel pour réessayer.',
    setupEmailAction: 'Configurer le courriel',
    setupConfirmation: 'Prévoir les détails des conférences retenues',
    setupConfirmationDone: (n: number) =>
      n === 1 ? '1 question de confirmation est configurée.' : `${n} questions de confirmation sont configurées.`,
    setupConfirmationEmpty: 'Aucune question de suivi. L’acceptation se fait en un clic.',
    setupConfirmationAction: 'Vérifier les questions',
    people: 'Comité',
    peopleHelp: 'Invitez par courriel. Le rôle s’applique dès la première connexion.',
    emailLabel: 'Adresse courriel',
    roleLabel: 'Rôle',
    roleFor: (who: string) => `Rôle de ${who}`,
    invite: 'Inviter',
    inviting: 'Invitation…',
    granted: (email: string) => `${email} détient maintenant ce rôle.`,
    invited: (email: string) => `${email} obtiendra ce rôle dès sa première connexion.`,
    awaitingSignIn: 'Invité — ne s’est pas encore connecté',
    revoke: 'Retirer',
    revokeConfirm: (email: string) => `Retirer tous les rôles de ${email} ?`,
    revoked: (email: string) => `${email} ne détient plus aucun rôle.`,
    noPeople: 'Personne ne détient de rôle pour l’instant.',
    isYou: 'vous',
    lastAdmin: 'C’est le seul administrateur restant — accordez d’abord le rôle à quelqu’un d’autre.',
    actionInvalid:
      'Cette action ne s’applique plus. Rechargez l’espace de travail et vérifiez l’état actuel.',
    emailDeliveryNotReady:
      'La configuration de la livraison n’est plus prête. Vérifiez la clé API, le domaine et l’expéditeur avant de réessayer.',
    emailActionInvalid:
      'L’état du courriel a changé avant la fin de l’action. Actualisez l’espace de livraison et vérifiez-le de nouveau.',
    emailBadInput:
      'Vérifiez le texte du courriel et les destinataires sélectionnés, puis réessayez.',
    emailMissing:
      'Cette entrée de courriel n’existe plus. Actualisez l’espace de livraison.',
    badInput: 'Vérifiez l’adresse courriel et les dates.',

    identity: 'Cet appel à conférences',
    identityHelp:
      'Le nom est ce que voient les conférenciers et ce qui signe vos courriels.',
    identityName: 'Nom',
    identityVisibility: 'Qui peut le trouver',
    identitySave: 'Enregistrer',
    identitySaved: 'Enregistré.',
    identityAddress: 'Son adresse est {url} — cette partie ne peut pas changer.',

    about: 'À propos de l’événement',
    aboutHelp:
      'Voici la page publique à cette adresse, et ce qu’un lien vers elle affiche lorsqu’on la partage.',
    descriptionEn: 'Description (anglais)',
    descriptionFr: 'Description (français)',
    descriptionFrHelp: 'Laissée vide, les lecteurs francophones voient l’anglais.',
    eventDate: 'Date de l’événement',
    eventStartDate: 'Premier jour de l’événement',
    eventEndDate: 'Dernier jour de l’événement',
    eventTimeZone: 'Fuseau horaire de l’événement',
    eventVenue: 'Lieu',
    eventLocation: 'Ville',
    eventLocationHelp: 'Les conférenciers planifient leur voyage à partir de cette information.',
    eventWebsite: 'Site web de l’événement',

    archive: 'Archivage',
    archiveHelp:
      'Un appel archivé est en lecture seule et disparaît de la liste publique. Son programme public existant reste accessible par son lien direct à titre d’archive figée. Vous pourrez réactiver l’événement plus tard.',
    archiveAction: 'Archiver',
    archiveConfirm:
      'Archiver cet appel ? Plus personne ne pourra soumettre, et il disparaîtra de la liste publique. Tout programme public existant restera accessible par son lien direct et sera figé jusqu’à la réactivation de l’événement.',
    archived: 'Archivé. Il est désormais en lecture seule.',
    unarchiveAction: 'Le réactiver',
    unarchived: 'De nouveau en service.',
    ownerOnly: 'Seul un propriétaire peut faire cela.',

    danger: 'Suppression',
    dangerHelp:
      'Ceci détruit chaque proposition, évaluation, photo et trace de courriel. Ce sont les écrits d’autres personnes autant que les vôtres, et c’est irréversible.',
    dangerNeedsArchive: 'Archivez-le d’abord. La suppression se fait délibérément en deux temps.',
    dangerConfirmLabel: 'Tapez {id} pour confirmer',
    dangerAction: 'Supprimer définitivement',
    dangerConfirm:
      'Supprimer cet appel à conférences et tout ce qu’il contient ? Il n’y a pas de retour en arrière.',
    dangerDeleting: 'Suppression…',

    window: 'Période de soumission',
    lateIntakeEyebrow: 'Ajouts tardifs',
    lateIntakeWindowOpen: 'Les propositions sont ouvertes avec un programme public',
    lateIntakeWindowClosed: 'Rouvrir les propositions sans perturber le programme public',
    lateIntakeWindowHelp:
      'Modifier cette période ne change pas le programme en ligne. Les nouvelles propositions passent toujours par l’évaluation, la confirmation, l’horaire privé, un nouvel aperçu partagé, puis une nouvelle publication explicite.',
    lateIntakeScoresWarning:
      'Les notes des évaluateurs sont actuellement visibles. Désactivez-les avant une nouvelle ronde pour éviter d’influencer les évaluations suivantes. Votre choix final est enregistré uniquement avec Enregistrer la période.',
    prepareLateIntake: 'Préparer 7 jours d’ajouts tardifs',
    prepareLateIntakeHelp:
      'Remplit une ouverture immédiate et une fermeture dans sept jours, reprend les soumissions et masque les notes. Vérifiez les champs, puis appuyez sur Enregistrer la période.',
    windowTimeZone: 'Les heures de la période utilisent le fuseau de l’événement : {zone}.',
    windowTimeZoneUnsaved:
      'Enregistrez d’abord les détails de l’événement avant de modifier la période afin que son fuseau soit sans ambiguïté.',
    windowInvalid:
      'Choisissez une ouverture valide et une fermeture ultérieure dans le fuseau de l’événement.',
    opensAtLabel: 'Ouverture',
    closesAtLabel: 'Fermeture',
    pausedLabel: 'Suspendre les soumissions',
    pausedHelp: 'Ferme le formulaire immédiatement, sans déplacer les dates.',
    reviewsVisibleLabel: 'Permettre aux évaluateurs de voir les notes des autres',
    reviewsVisibleHelp:
      'Gardez ceci désactivé jusqu’à la fin de l’évaluation — une note visible influence la suivante.',
    saveWindow: 'Enregistrer',
    windowSaved: 'Enregistré.',

    email: 'Courriels',
    emailStepKey: 'Clé API Resend partagée',
    emailKeyHelp:
      'Une seule clé dessert toute la plateforme. Seuls les administrateurs de la plateforme peuvent la remplacer; elle est conservée dans Secret Manager, vérifiée auprès de Resend et jamais réaffichée.',
    emailKeyPlatformManaged:
      'La clé Resend est partagée entre tous les appels. Demandez à un administrateur de la plateforme de la configurer ou de la remplacer; les administrateurs d’un événement ne peuvent pas la modifier.',
    emailManagePlatform: 'Gérer les réglages courriel de la plateforme',
    emailSourceLabel: 'Source de la configuration courriel',
    emailSourcePlatform: 'Utiliser les réglages de la plateforme',
    emailSourcePlatformHelp:
      'Utilise le domaine et l’expéditeur de la plateforme. Cet événement garde ses propres textes et peut définir sa propre adresse de réponse.',
    emailSourceEvent: 'Utiliser un réglage propre à l’événement',
    emailSourceEventHelp:
      'Activez-le seulement après la vérification du domaine et la configuration de son expéditeur.',
    emailSourceActivePlatform: 'Réglages de la plateforme utilisés',
    emailSourceActiveEvent: 'Réglage propre à cet événement utilisé',
    emailSourceEffective: 'Identité de livraison effective',
    emailSourceEffectiveHelp:
      'Les messages envoyés maintenant utilisent les valeurs ci-dessous. Un domaine d’événement en préparation ne change rien avant son activation.',
    emailEffectiveDomain: 'Domaine d’envoi',
    emailEffectiveFrom: 'Expéditeur',
    emailEffectiveReplyTo: 'Réponse à',
    emailNoReplyTo: 'Valeur par défaut du service',
    emailPlatformReplyToTitle: 'Adresse de réponse de l’événement',
    emailPlatformReplyToHelp:
      'Choisissez si les réponses héritent de l’adresse de la plateforme ou utilisent une adresse propre à l’événement. Une adresse personnalisée vide envoie délibérément sans Répondre à.',
    emailReplyToInherit: 'Hériter de l’adresse de réponse de la plateforme',
    emailReplyToClearHelp:
      'L’événement enverra explicitement sans adresse Répondre à. Sélectionnez l’héritage ci-dessus pour utiliser plutôt l’adresse de la plateforme.',
    emailSaveReplyTo: 'Enregistrer l’adresse de réponse',
    emailReplyToSaved: 'Adresse de réponse enregistrée.',
    emailEventOverrideTitle: 'Réglage de livraison de l’événement',
    emailEventOverrideHelp:
      'Préparez et vérifiez ici un domaine distinct. La livraison de la plateforme reste active tant que la configuration n’est pas terminée.',
    emailEventOverrideReady: 'Le réglage de l’événement est prêt à être activé.',
    emailEventOverrideNotReady:
      'Terminez le domaine et l’expéditeur avant d’activer ce réglage.',
    emailActivateEventOverride: 'Activer le réglage de l’événement',
    emailUsePlatformDefaults: 'Revenir aux réglages de la plateforme',
    emailSourceSavedPlatform: 'Les réglages de la plateforme sont maintenant actifs.',
    emailSourceSavedEvent: 'Le réglage de l’événement est maintenant actif.',
    emailKeySteps: [
      'Utilisez le compte Resend de la plateforme.',
      'Ouvrez API Keys, puis Create API Key.',
      'Choisissez la permission Full access. Une clé limitée à l’envoi ne peut pas gérer les domaines, et l’étape suivante en a besoin.',
      'Copiez la clé — elle commence par re_, et Resend ne l’affiche qu’une fois — puis collez-la ci-dessous.',
    ],
    emailKeyLink: 'Ouvrir les clés API Resend',
    emailKeyLabel: 'Clé API',
    emailKeySet: 'Une clé est configurée, terminant par {hint}.',
    emailKeySave: 'Enregistrer la clé',
    emailKeyReplace: 'Remplacer la clé',
    emailKeySaved: 'Clé enregistrée.',
    emailKeyFirst: 'Configurez d’abord la clé API.',
    emailStepDomain: 'Domaine d’envoi',
    emailDomainHelp:
      'Resend refuse les envois depuis un domaine non vérifié, et un fournisseur gratuit finit dans les indésirables. La vérification passe par le DNS : prévoyez le délai de propagation.',
    emailDomainSteps: [
      'Indiquez un domaine que vous contrôlez. Un sous-domaine comme cfp.exemple.org est préférable : son DNS reste distinct du courrier dont dépend tout le groupe.',
      'Ajoutez les enregistrements affichés ici à ce domaine, chez l’hébergeur de son DNS.',
      'Lancez la vérification. C’est habituellement une affaire de minutes, mais le DNS a le droit d’être bien plus lent.',
    ],
    emailDomainLabel: 'Domaine',
    emailDomainAdd: 'Ajouter le domaine',
    emailDomainAdded: 'Ajouté. Ajoutez maintenant les enregistrements DNS ci-dessous.',
    emailDomainVerify: 'Vérifier',
    emailDomainVerified: 'Vérifié.',
    emailDomainChecking:
      'Resend effectue la vérification. Le DNS peut prendre du temps — réessayez sous peu.',
    emailDomainStatus: {
      not_started: 'Pas encore vérifié',
      pending: 'En attente du DNS',
      verified: 'Vérifié',
      failed: 'Échec de la vérification',
      temporary_failure: 'Échec temporaire — nouvel essai prévu',
    } as Record<string, string>,
    emailDnsHelp: 'Ajoutez ceci à votre DNS, puis vérifiez de nouveau.',
    emailDnsRecords: 'Enregistrements DNS à ajouter',
    emailDnsType: 'Type',
    emailDnsName: 'Nom',
    emailDnsValue: 'Valeur',
    emailDnsPriority: (priority: number) => ` (priorité ${priority})`,
    emailStepSender: 'Expéditeur',
    emailPreview: 'Aperçu',
    emailPreviewLocale: 'Langue',
    emailLanguageNames: { en: 'Anglais', fr: 'Français' },
    emailPreviewVisa: 'Afficher le paragraphe sur le visa',
    emailPreviewPlain: 'Texte brut',
    emailEdit: 'Modifier le texte',
    emailCustom: 'Votre texte est utilisé, pas le nôtre.',
    emailSubjectLabel: 'Objet',
    emailBodyLabel: 'Message',
    emailPlaceholders: 'Une ligne vide entre les paragraphes. Disponibles :',
    emailVisaHelp:
      'Un paragraphe contenant uniquement {visa} disparaît pour les personnes qui n’en ont pas besoin : laissez-le sur sa propre ligne.',
    emailTemplateProblem: {
      emptySubject: 'Un objet est requis.',
      emptyBody: 'Le message ne peut pas être vide.',
      unknownPlaceholder: 'Il n’existe pas de variable {name} — elle serait envoyée telle quelle.',
    } as Record<string, string>,
    emailTemplateSave: 'Enregistrer le texte',
    emailTemplateSaved: 'Enregistré. C’est ce qui sera envoyé.',
    emailTemplateRestore: 'Restaurer le nôtre',
    emailTemplateReset: 'Restauré.',
    emailSubject: 'Objet :',
    emailTest: 'Me l’envoyer',
    emailTestSent: 'Envoyé à {to}.',
    emailTestDryRun:
      'Test non livré — terminez la configuration, puis relancez le test.',
    emailTestNeedsSetup:
      'Terminez la clé API, le domaine vérifié et l’expéditeur avant le test.',
    emailTestSaveFirst:
      'Enregistrez ce texte avant de le tester; le test utilise le modèle enregistré.',
    emailFrom: 'Expéditeur',
    emailReplyTo: 'Répondre à',
    emailFromHelp:
      'L’adresse doit être sur un domaine vérifié auprès de Resend, sinon tous les envois échouent. Le nom affiché se met entre chevrons : DevFest Montréal <cfp@exemple.org>.',
    emailDomainFirst: 'Ajoutez votre domaine d’envoi ci-dessus avant de définir une adresse.',
    emailDomainMismatch:
      'Vous envoyez depuis {sender}, mais le domaine vérifié auprès de Resend est {verified}. Resend vérifie un domaine exact : le message sera mis en file puis échouera à l’envoi.',
    emailSaveSender: 'Enregistrer l’adresse',
    emailNoSender:
      'Aucune adresse d’expéditeur n’est configurée : la livraison est verrouillée. Après l’avoir enregistrée, vérifiez explicitement les messages retenus ou en échec avant de les libérer.',
    emailSender: {
      empty: 'Une adresse d’expéditeur est requise.',
      format: 'Cela ne ressemble pas à une adresse courriel.',
      brackets:
        'Mettez le nom affiché entre chevrons : DevFest Montréal <cfp@exemple.org>.',
      url: 'Ce n’est pas une adresse web complète. Elle doit commencer par https:// et nommer un domaine.',
    },
    emailErrors: {
      badKey:
        'Resend a refusé cette clé. Vérifiez qu’elle a été copiée en entier et que sa permission est Full access — une clé limitée à l’envoi ne peut pas gérer les domaines.',
      noDomain: 'Resend ne connaît pas ce domaine. Il a peut-être été supprimé là-bas.',
      rejected: 'Resend a refusé la demande. Vérifiez le nom de domaine.',
      unreachable: 'Impossible de joindre Resend. Réessayez dans un instant.',
      domainUnavailable:
        'Ce domaine d’expédition est déjà attribué ou ne peut pas être adopté par cet événement. Demandez à un administrateur de la plateforme de résoudre le problème.',
      domainMismatch:
        'Le domaine d’expédition enregistré ne correspond plus à Resend. Demandez à un administrateur de la plateforme de réparer l’attribution du domaine.',
    },
    emailErrorReasons: {
      superseded: 'Cette notification a été remplacée.',
      event_deleted: 'Cette notification a été remplacée parce que l’événement a été supprimé.',
      event_archived: 'Cette notification a été remplacée parce que l’événement est archivé.',
      email_domain_unbound:
        'L’envoi est bloqué parce que ce domaine d’expédition n’est pas attribué à l’événement.',
      email_configuration_changed:
        'La configuration courriel a changé pendant l’envoi. Vérifiez l’expéditeur actuel et réessayez cette notification.',
    } as Record<string, string>,
    emailQueue: 'File d’attente',
    emailDecisionQueue: 'Notifications aux conférenciers retenues',
    emailHelp:
      'Les décisions et les changements d’horaire sont retenus jusqu’à leur libération. Vérifiez les destinataires et les types de message avant l’envoi — c’est irréversible.',
    emailQueueEmpty:
      'Aucune notification n’attend. Les nouvelles décisions et les changements d’horaire apparaissent ici avant tout envoi.',
    emailQueueSetupNeeded:
      'Ces courriels sont retenus en toute sécurité. Terminez la configuration de l’envoi ci-dessous avant de les libérer.',
    pendingEmailEyebrow: 'Notifications aux conférenciers',
    pendingEmailShort: 'en attente',
    pendingEmailTitle: (count: number) =>
      count === 1
        ? '1 notification attend d’être envoyée.'
        : `${count} notifications attendent d’être envoyées.`,
    pendingEmailHelp:
      'Les décisions et les changements d’horaire sont retenus pour vérification. Contrôlez les destinataires et les types de message avant l’envoi.',
    pendingEmailReview: 'Vérifier et envoyer',
    pendingEmailTabLabel: (count: number) =>
      `Courriel, ${count} notification${count === 1 ? '' : 's'} en attente`,
    emailAttentionTabLabel: (waiting: number, attention: number) =>
      `Courriel, ${waiting} en attente d’approbation, ${attention} livraison${attention === 1 ? '' : 's'} demandant une intervention`,
    emailAttentionShort: 'à corriger',
    emailAttentionTitle: (count: number) =>
      count === 1
        ? '1 livraison de courriel demande une intervention.'
        : `${count} livraisons de courriel demandent une intervention.`,
    emailReviewAttention: 'Vérifier les livraisons',
    pendingEmailUnknownTitle: 'État de la file de courriels indisponible',
    pendingEmailUnknownHelp:
      'La décision est enregistrée, mais son courriel n’a pas pu être vérifié. Ouvrez Courriel pour contrôler la file avant d’aviser les conférenciers.',
    emailStatus: {
      held: 'En attente de libération',
      queued: 'En file',
      sending: 'Envoi en cours',
      sent: 'Envoyés',
      dry_run: 'Non livré — configuration incomplète',
      failed: 'Échecs',
    },
    emailRecoverableStatus: 'Envoi interrompu — nouvelle tentative possible',
    emailKind: 'Message',
    emailTo: 'Destinataire',
    emailKinds: {
      submission_received: 'Proposition reçue',
      committee_role_invited: 'Invitation au comité',
      co_speaker_invited: 'Invitation à coprésenter',
      profile_update_requested: 'Demande de mise à jour du profil',
      committee_proposal_submitted: 'Nouvelle proposition pour le comité',
      committee_schedule_shared: 'Aperçu partagé pour le comité',
      withdrawn: 'Retirée',
      accepted: 'Acceptée',
      waitlisted: 'Liste d’attente',
      rejected: 'Non retenue',
      schedule_assigned: 'Horaire attribué',
      schedule_changed: 'Horaire modifié',
      schedule_cancelled: 'Séance annulée',
      message: 'Message',
    } as Record<string, string>,
    emailDeliveryImmediateStaff: 'Notification interne immédiate',
    emailDeliveryImmediateStaffHelp:
      'Elle part directement aux membres actifs et admissibles du comité lorsque l’action réussit. Elle ne fait pas partie du lot retenu pour les conférenciers.',
    emailDeliveryHeldSpeaker: 'Notification retenue pour le conférencier',
    emailDeliveryHeldSpeakerHelp:
      'Les nouveaux messages restent dans Courriel pour vérification et libération. Prévisualiser ou publier ne les envoie pas.',
    emailDeliveryAutomatic: 'Notification automatique de l’événement',
    emailDeliveryAutomaticHelp:
      'L’action correspondante met ce message en file immédiatement; l’envoi dépend toujours de l’expéditeur configuré.',
    messageTitle: 'Écrire à tous les conférenciers d’une conférence',
    messageHelp:
      'Pour tout ce que les modèles ne couvrent pas : une question, une correction, un détail sur la journée. Vérifiez d’abord les adresses actuelles; une copie est ensuite mise en file pour chaque personne conférencière active et consignée ci-dessous.',
    messageRecipients: (count: number) =>
      `Les ${count} conférencier${count === 1 ? '' : 's'} recevront ce message`,
    messageTalk: 'Conférence',
    messagePick: 'Choisir une conférence…',
    messageSubject: 'Objet',
    messageBody: 'Message',
    messageBodyHelp:
      'Une ligne vide commence un nouveau paragraphe. {speakerName}, {title} et {proposalUrl} sont remplis automatiquement.',
    messageSend: 'Vérifier les destinataires',
    messageSending: 'Mise en file…',
    messageConfirm: 'Mettre ce message en file pour {name} ?',
    messageSent: 'Mis en file pour livraison à {name}.',
    messageQueued: (count: number) =>
      `${count} copie${count === 1 ? '' : 's'} mise${count === 1 ? '' : 's'} en file pour livraison.`,
    messageSetupNeeded:
      'Terminez la configuration de la livraison avant de mettre un message en file.',
    messageRecipientPreview: 'Adresses de livraison actuelles',
    messageRecipientPreviewHelp:
      'Ces adresses proviennent des comptes actifs, et non de l’ancien instantané de la proposition.',
    messageRecipientChanged:
      'La liste des destinataires a changé pendant votre vérification. Vérifiez les adresses actuelles et réessayez.',
    messageNoReplyTo:
      'Aucune adresse de réponse n’est définie : une réponse n’arriverait à personne. Définissez-en une ci-dessus avant d’écrire.',
    messageNoTalks: 'Rien à écrire pour l’instant — aucune proposition n’a été soumise.',
    emailRefresh: 'Actualiser',
    emailRelease: (count: number) =>
      `Vérifier ${count} notification${count === 1 ? '' : 's'}`,
    emailNothing: 'Rien à envoyer',
    emailStaleHeld:
      'Notifications remplacées conservées : {count}. Elles restent dans l’historique et ne peuvent être envoyées que si elles redeviennent actuelles.',
    emailStaleStatus: 'Conservé — remplacé',
    emailConfirm: 'Mettre {count} notifications en file maintenant ? C’est irréversible.',
    emailRetry: 'Vérifier {count} nouvelles tentatives',
    emailBatchRemaining:
      'Il reste {count} messages. Ils apparaîtront pour une vérification distincte après la mise en file de ce lot.',
    emailSent: (count: number) =>
      `${count} courriel${count === 1 ? '' : 's'} mis en file.`,
    emailLog: 'Historique de livraison',
    emailLogHelp:
      'Les tentatives suivies dans cet espace apparaissent ici, y compris les messages en attente, en cours, en échec ou non livrés. La livraison des invitations privées à coprésenter reste dans la liste des conférenciers.',
    emailLogEmpty: 'Rien n’a encore été mis en file.',
    emailLogFilter: 'Afficher',
    emailLogAll: 'Tout',
    emailStatusColumn: 'Résultat',
    emailSentAt: 'Dernière tentative',
    emailActions: 'Actions',
    emailResend: 'Envoyer une autre copie',
    emailRetryOne: 'Réessayer la livraison',
    emailResendConfirm:
      'Renvoyer ce message à {to} ? La personne en recevra une seconde copie.',
    emailResent: 'Remis en file pour {to}.',
    emailLogTruncated: '{count} messages plus anciens ne sont pas affichés.',

    emailOperations: 'Vue d’ensemble des livraisons',
    emailOperationsHelp:
      'Suivez chaque message, de la vérification par l’organisation jusqu’à sa livraison confirmée.',
    emailAwaiting: 'En attente d’approbation',
    emailAwaitingHelp:
      'Décisions et changements d’horaire à vérifier par une personne organisatrice.',
    emailNeedsAttention: 'Attention requise',
    emailNeedsAttentionHelp:
      'Messages actuels en échec, non livrés ou dont la tentative est interrompue.',
    emailInProgress: 'En cours',
    emailInProgressHelp: 'Messages en file ou en cours de remise au fournisseur.',
    emailDelivered: 'Livrés',
    emailDeliveredHelp: 'Messages acceptés par le fournisseur de livraison.',
    emailNoAttention: 'Aucune livraison actuelle ne demande d’attention.',
    emailNoProgress: 'Aucun message n’est en cours.',
    emailDeliveryStatus: 'État de la livraison',
    emailDeliveryReady: 'Prêt à livrer',
    emailDeliveryReadyHelp: 'La clé API, le domaine vérifié et l’expéditeur sont prêts.',
    emailDeliveryBlocked: 'Configuration requise',
    emailDeliveryBlockedHelp:
      'Les messages peuvent encore être créés et retenus, mais leur libération, les nouvelles tentatives, les tests et les messages ponctuels restent verrouillés jusqu’à ce que tout soit prêt.',
    emailDeliveryChecking: 'Vérification de la configuration…',
    emailDeliveryProblems: {
      missing_key: 'Ajouter une clé API Resend',
      invalid_key: 'Remplacer la clé API refusée par Resend',
      missing_domain: 'Ajouter un domaine d’envoi',
      domain_unverified: 'Vérifier le domaine d’envoi',
      invalid_sender: 'Enregistrer une adresse d’expéditeur valide',
      sender_domain_mismatch: 'Utiliser le domaine vérifié dans l’adresse d’expéditeur',
      setup_unavailable: 'Vérifier la connexion au fournisseur de livraison',
    } as Record<string, string>,
    emailCompleteSetup: 'Terminer la configuration',
    emailActionSetupReason: 'Indisponible tant que la configuration n’est pas terminée.',
    emailHeldTableLabel: 'Notifications en attente d’approbation',
    emailAttentionTableLabel: 'Messages dont la livraison demande une intervention',
    emailHistoryTableLabel: 'Historique des livraisons de courriels',
    emailReview: {
      eyebrow: 'Vérification finale',
      releaseTitle: 'Libérer les notifications aux conférenciers',
      releaseHelp:
        'Vérifiez chaque adresse et chaque type de message. La confirmation met exactement cet ensemble en file; il ne peut plus être rappelé dès que la livraison commence.',
      retryTitle: 'Réessayer les livraisons non résolues',
      retryHelp:
        'Seules les lignes actuelles non résolues ci-dessous seront réessayées. Confirmez les adresses avant de créer une autre tentative.',
      resendTitle: 'Vérifier une autre copie',
      resendHelp:
        'Ce message a déjà fait l’objet d’une tentative. Vérifiez l’adresse et l’état avant de le remettre intentionnellement en file.',
      composeTitle: 'Vérifier le message aux conférenciers',
      composeHelp:
        'Vérifiez les adresses de livraison actuelles et votre texte. La confirmation met une copie privée en file pour chaque personne indiquée.',
      messages: 'Messages',
      recipients: 'Destinataires',
      types: 'Types de message',
      typeBreakdown: 'Messages regroupés par type',
      listLabel: 'Messages et destinataires exacts en cours de vérification',
      close: 'Fermer la vérification',
      cancel: 'Ne rien changer',
      confirmRelease: (count: number) =>
        `Mettre ${count} notification${count === 1 ? '' : 's'} en file`,
      confirmRetry: (count: number) =>
        `Réessayer ${count} livraison${count === 1 ? '' : 's'}`,
      confirmResend: 'Mettre une autre copie en file',
      confirmCompose: (count: number) =>
        `Mettre ${count} copie${count === 1 ? '' : 's'} en file`,
    },
    emailPreviewBilingual: 'Afficher le repli bilingue',
    emailPreviewBilingualHelp:
      'Lorsqu’un membre du comité ou une personne invitée n’a pas de langue enregistrée, le vrai message contient le français et l’anglais.',
    emailPreviewSelectedTest: 'Le test utilise uniquement la langue sélectionnée.',
    emailPreviewSample: {
      speakerName: 'Ada Lovelace',
      title: 'Notes sur la machine analytique',
      scheduleDate: 'samedi 14 novembre',
      scheduleTime: '10 h à 10 h 40',
      scheduleRoom: 'Salle A',
    },
    emailApplicablePlaceholders: 'Disponibles pour ce message :',

    proposals: 'Décisions sur les propositions',
    proposalsHelp:
      'Les notes se mettent à jour automatiquement à chaque évaluation. Trouvez les conférences qui demandent votre attention, puis prenez une décision explicite à la fois.',
    speakerResponseGuardrail:
      'Acceptée est la décision de l’organisation. Confirmée et déclinée sont les réponses du conférencier dans Mes propositions, où les détails obligatoires sont recueillis.',
    overview: 'La ronde en un coup d’œil',
    overviewHelp:
      'Couverture, résultats et équilibre du programme avant de prendre la prochaine décision.',
    metricInRound: 'Dans la ronde',
    metricUndecided: 'À décider',
    metricDisagreement: 'Fort désaccord',
    chartDecisions: 'Décisions',
    chartScores: 'Note moyenne',
    chartScoresLabel: (counts: number[]) =>
      counts
        .map((count, index) =>
          `Note ${index + 1} : ${count} ${count === 1 ? 'évaluation' : 'évaluations'}`,
        )
        .join(', '),
    chartCategories: 'Catégories',
    chartLanguages: 'Langues',
    undecided: 'Indécises',
    filters: 'Filtres des propositions',
    search: 'Rechercher',
    searchPlaceholder: 'Titre ou conférencier',
    filterStatus: 'Statut',
    filterCurrentStatuses: 'Propositions actuelles',
    filterAllStatuses: 'Tous les statuts',
    filterCategory: 'Catégorie',
    filterAllCategories: 'Toutes les catégories',
    filterScoreStatus: 'État des notes',
    filterAllScores: 'Toutes les propositions',
    filterScored: 'Évaluées',
    filterUnscored: 'Non évaluées',
    filterDisagreement: 'Fort désaccord (1,00+)',
    sortBy: 'Trier par',
    sortScore: 'Meilleure note',
    sortSpread: 'Plus grand désaccord',
    sortReviews: 'Plus d’évaluations',
    sortTitle: 'Titre A–Z',
    sortStatus: 'Statut',
    showingProposals: (shown: number, total: number) => `${shown} sur ${total} propositions`,
    clearFilters: 'Effacer les filtres',
    noMatchingProposals: 'Aucune proposition ne correspond à ces filtres.',
    noCurrentProposals:
      'Aucune proposition actuelle. Les propositions retirées sont masquées par défaut.',
    showWithdrawn: 'Afficher les propositions retirées',
    savingDecision: 'Enregistrement…',
    decisionChanged: (title: string, from: string, to: string) =>
      `« ${title} » est passée de ${from} à ${to}.`,
    decisionResetConfirm: (title: string, from: string, to: string) =>
      `Passer « ${title} » de ${from} à ${to} ? Cette action efface la réponse de confirmation, les renseignements logistiques et la photo du programme de chaque conférencier. Les conférenciers devront confirmer de nouveau.`,
    decisionEmailHeld: 'Décision enregistrée. Cette action n’envoie aucun courriel.',
    decisionReset: (title: string, to: string) =>
      `« ${title} » est passée à ${to} et ses réponses de conférencier ont été effacées. Cette action est irréversible.`,
    decisionUndone: (title: string) => `Le statut précédent de « ${title} » est rétabli.`,
    undo: 'Annuler',
    untitled: 'Proposition sans titre',
    allScored: 'Toutes les propositions ont été évaluées.',
    someUnscored: (n: number) =>
      n === 1
        ? '1 proposition n’a pas encore de note.'
        : `${n} propositions n’ont pas encore de note.`,
    form: 'Questions de confirmation',
    formHelp:
      'Chaque personne retenue répond séparément à ces questions. Utilisez-les pour les renseignements individuels, comme la taille du chandail ou les besoins alimentaires; rendez chaque réponse obligatoire lorsque l’événement l’exige. Un conférencier ajouté plus tard doit remplir sa propre confirmation avant que la conférence soit de nouveau confirmée.',
    speakerPhotoTitle: 'Photo du conférencier pour le programme',
    speakerPhotoHelp:
      'Chaque personne retenue peut vérifier ici la photo de son profil réutilisable. Elle reste facultative, sauf si vous la rendez obligatoire ci-dessous. La confirmation fige la version approuvée pour cet événement, et le programme publié conserve cette version jusqu’à la publication d’une nouvelle version.',
    speakerPhotoRequired:
      'Exiger une photo de profil pour chaque conférencier avant sa confirmation',
    formEmpty:
      'Aucune question personnalisée. Les conférenciers vérifient tout de même leur photo pour le programme, puis confirment.',
    formUntitled: 'Nouvelle question',
    formLabelEn: 'Question (anglais)',
    formLabelFr: 'Question (français)',
    formLabelFrHelp: 'Facultatif. Laissé vide, la version anglaise s’affiche.',
    formHelpEn: 'Précision (anglais)',
    formHelpFr: 'Précision (français)',
    formType: 'Type de réponse',
    formTypes: {
      text: 'Texte court',
      textarea: 'Texte long',
      select: 'Choix unique',
      checkbox: 'Case à cocher',
      image: 'Photo',
    },
    formRequired: 'Réponse obligatoire',
    formOptions: 'Options',
    formOptionsHelp: 'Une par ligne. Chaque ligne est affichée et enregistrée telle quelle.',
    formKey: 'Les réponses sont enregistrées sous « {key} ». Cette clé est figée après l’enregistrement, afin que les réponses existantes correspondent toujours.',
    formUp: 'Monter',
    formDown: 'Descendre',
    formRemove: 'Retirer',
    formRemoveConfirm: 'Retirer « {label} » ? Les réponses déjà données cesseront d’être affichées.',
    formAdd: 'Ajouter une question',
    formSave: 'Enregistrer les questions',
    formSaving: 'Enregistrement…',
    formSaved: 'Questions enregistrées.',
    formViewPhoto: 'Voir la photo',
    formYes: 'Oui',
    formNo: 'Non',
    formErrors: {
      tooManyFields: 'Cela dépasse le nombre de questions possible.',
      badKey: 'Un problème avec la question « {key} » — vérifiez son type.',
      duplicateKey: 'Deux questions seraient enregistrées sous « {key} ». Renommez-en une.',
      emptyLabel: 'Chaque question doit avoir un libellé en anglais.',
      tooLong: 'Une des questions est trop longue.',
      needsOptions: 'Une question à choix unique doit avoir au moins une option.',
      duplicateOption: 'Les options de « {key} » se répètent. Chacune doit être distincte.',
    } as Record<string, string>,
    submission: 'Le formulaire de proposition',
    submissionHelp:
      'Ce qu’on demande aux conférenciers et conférencières au moment de proposer. Les libellés se reformulent en tout temps ; un choix déjà utilisé par une proposition conserve son code, alors le retirer est la façon de le mettre hors service.',
    attendanceTitle: 'Déplacement et présence',
    attendanceEditorHelp:
      'Cette section est propre à chaque événement. Conservez le sens fixe des réponses pour que l’horaire et la validation continuent de fonctionner, puis adaptez le texte au lieu de l’événement.',
    attendanceEnabled: 'Demander les renseignements de déplacement',
    attendanceEnabledHelp:
      'Désactivez cette option pour un événement en ligne ou un appel qui ne nécessite aucune planification de déplacement. Les réponses existantes sont conservées, mais ne sont plus demandées.',
    attendanceStatusTitle: 'Réponses sur le statut de présence',
    attendanceFields: {
      fundingSource: 'Source de financement',
      decisionBy: 'Date de décision',
      needsVisa: 'Visa ou conditions d’entrée',
    },
    attendanceFieldEnabled: 'Poser cette question complémentaire',
    attendanceReviewerVisible: 'Montrer cette réponse au comité de sélection',
    attendanceReviewerVisibleHelp:
      'Désactivez cette option lorsque le comité n’a pas besoin de ce détail logistique. Les organisateurs conservent la réponse.',
    attendanceCopy: {
      title: 'Titre de la section',
      question: 'Question sur la présence',
      help: 'Aide de la question',
      local: 'Réponse sans déplacement',
      secured: 'Réponse déplacement couvert',
      pending: 'Réponse déplacement à confirmer',
      fundingSource: 'Question sur le financement',
      fundingSourceHelp: 'Aide sur le financement',
      decisionBy: 'Question sur la date de décision',
      decisionByHelp: 'Aide sur la date de décision',
      needsVisa: 'Question sur le visa ou les conditions d’entrée',
      needsVisaHelp: 'Conseils sur le visa',
      gdeGuidance: 'Conseils facultatifs pour les Google Developer Experts',
    },
    submissionSave: 'Enregistrer le formulaire',
    submissionSaved: 'Formulaire de proposition enregistré.',
    taxonomy: {
      category: 'Catégories',
      format: 'Formats',
      level: 'Niveaux',
      deliveryLanguage: 'Langues',
    },
    languagesHelp:
      'Les langues dans lesquelles vous acceptez une conférence. Les quatre sont fixes — l’horaire et la gestion du bilinguisme reposent dessus — mais vous choisissez lesquelles offrir et comment les nommer.',
    optionAdd: 'Ajouter un choix',
    previewLabel: 'Ce que verront les conférenciers :',
    choiceCount: (n: number) => (n === 1 ? '1 choix' : `${n} choix`),
    columnEnglish: 'Anglais',
    columnFrench: 'Français',
    columnCode: 'Enregistré sous',
    columnOrder: 'Ordre',
    optionUnnamed: 'ce choix',
    optionLabelEnFor: (who: string) => `Libellé anglais pour ${who}`,
    optionLabelFrFor: (who: string) => `Libellé français pour ${who}`,
    optionCodeHelp:
      'Fixé dès l’enregistrement, pour que les propositions déjà classées ainsi continuent de correspondre.',
    optionCodeOnSave: 'à l’enregistrement',
    moveUpOf: (who: string) => `Déplacer ${who} vers le haut`,
    moveDownOf: (who: string) => `Déplacer ${who} vers le bas`,
    removeOf: (who: string) => `Retirer ${who}`,
    unsaved: 'Modifications non enregistrées.',
    upToDate: 'Tout est enregistré.',
    optionsEmpty: 'Aucun choix. Personne ne peut soumettre tant qu’il n’y en a pas au moins un.',
    optionRemoveConfirm:
      'Retirer « {label} » ? Les conférences déjà classées ainsi le conservent, mais plus personne ne pourra le choisir.',
    acksTitle: 'Ce que les conférenciers acceptent',
    acksHelp:
      'Chacun est une case à cocher obligatoire. Si c’est facultatif, c’est une question — ajoutez-la plus bas.',
    acksEmpty: 'Rien à accepter.',
    ackUntitled: 'Nouvel engagement',
    ackLabelEn: 'Formulation (anglais)',
    ackLabelFr: 'Formulation (français)',
    ackAdd: 'Ajouter un engagement',
    ackRemoveConfirm:
      'Retirer « {label} » ? Les propositions déjà soumises conservent la réponse donnée.',
    extraTitle: 'Vos propres questions',
    extraHelp:
      'Tout ce que vous voulez demander d’autre sur la conférence. Les photos ne sont pas offertes ici : la plupart de ces personnes seront refusées, et leur photo n’est pas quelque chose à conserver. Demandez-la plutôt sur le formulaire de confirmation.',
    extraReviewerVisible: 'Montrer cette réponse au comité de sélection',
    extraReviewerVisibleHelp:
      'Désactivez cette option pour les renseignements dont le comité n’a pas besoin. Les organisateurs peuvent toujours voir la réponse enregistrée.',
    extraEmpty: 'Aucune question supplémentaire.',
    extraAdd: 'Ajouter une question',
    submissionErrors: {
      noOptions:
        '{key} n’a aucun choix. Personne ne peut soumettre tant qu’il n’y en a pas au moins un.',
      tooManyOptions: '{key} contient plus de choix que le formulaire ne peut en accueillir.',
      badValue: 'Un des choix sous {key} a un code que le formulaire ne peut pas enregistrer.',
      duplicateValue:
        'Deux choix sous {key} seraient enregistrés de la même façon. Reformulez-en un.',
      emptyLabel: 'Chaque choix sous {key} a besoin d’un libellé anglais.',
      unknownLanguage: 'Ce n’est pas une des quatre langues que l’horaire comprend.',
      ackNotRequired: '« {key} » doit être une case à cocher obligatoire.',
      badReviewerVisibility:
        '« {key} » a un paramètre de visibilité invalide pour le comité.',
      badAttendanceConfig:
        'La section de déplacement contient un paramètre invalide sous « {key} ».',
      unknownAttendanceStatus:
        'Les réponses de déplacement doivent conserver les trois significations comprises par la plateforme.',
      tooLong: 'Le texte sous « {key} » est trop long.',
      noImages:
        '« {key} » demande une photo. Demandez-la sur le formulaire de confirmation, une fois la personne retenue.',
    } as Record<string, string>,
    results: 'Conférenciers retenus',
    tally: (live: number, accepted: number, waitlisted: number, decided: number) =>
      `${live} devant le comité · ${accepted} acceptées · ${waitlisted} en liste d’attente · ${live - decided} à décider`,
    noneAccepted: 'Aucune acceptation pour l’instant.',
    colSpeaker: 'Conférencier',
    noProposals: 'Aucune proposition pour l’instant.',
    reviewerCoverage: 'Progression des évaluations',
    reviewerCoverageHelp:
      'La file actuelle de chaque membre actif du comité. Il n’y a pas d’attribution par proposition; un conflit compte comme réponse, mais pas comme note.',
    reviewerCoverageEmpty: 'Aucun membre actif du comité ne peut encore évaluer.',
    reviewerCoverageNoTalks: 'Aucune proposition n’attend une évaluation.',
    reviewerCoveragePrivate: (count: number) =>
      count === 1
        ? 'Une de vos propositions est masquée ici pour protéger la confidentialité des évaluations.'
        : `${count} de vos propositions sont masquées ici pour protéger la confidentialité des évaluations.`,
    reviewerHandled: (handled: number, eligible: number) =>
      `${handled} réponses sur ${eligible}`,
    reviewerBreakdown: (scored: number, conflicts: number, missing: number) =>
      `${scored} notées · ${conflicts} conflits · ${missing} sans réponse`,
    reviewerMissing: (count: number) =>
      count === 1 ? '1 proposition sans réponse' : `${count} propositions sans réponse`,
    reviewerProgressFor: (name: string) => `Progression des évaluations de ${name}`,
    coverageResponses: 'Réponses',
    coverageScores: 'Notes',
    coverageConflicts: 'Conflits',
    coverageWaiting: 'En attente',
    colTitle: 'Titre',
    colStatus: 'Statut',
    colScore: 'Moyenne',
    colReviews: 'Évaluations',
    colSpread: 'Écart',
  },

  review: {
    help: 'Notez chaque proposition que vous pouvez juger. Les vôtres n’apparaissent jamais.',
    workload: 'Votre charge d’évaluation',
    caughtUp: 'Vous êtes à jour',
    remainingTitle: (count: number) =>
      count === 1 ? '1 proposition attend votre réponse' : `${count} propositions attendent votre réponse`,
    responses: 'Réponses',
    conflicts: 'Conflits',
    remaining: 'Restantes',
    refresh: 'Actualiser les propositions',
    proposalNoLongerReviewable:
      'Cette proposition a quitté la ronde d’évaluation. Rechargez la liste des propositions.',
    accessRemoved: 'Votre accès au comité n’est plus actif.',
    ownProposal:
      'Vous êtes conférencier de cette proposition; ce n’est pas à vous de l’évaluer. Rechargez la liste des propositions pour la retirer de votre file.',
    intakeOpenHelp:
      'Les propositions sont encore ouvertes; de nouveaux éléments peuvent arriver. Actualisez avant de terminer une séance d’évaluation.',
    intakeClosedHelp:
      'Les propositions sont fermées. Lorsque chaque élément a une réponse, l’organisation peut décider.',
    scoresVisibleDuringIntake:
      'Les notes du comité sont visibles pendant que les propositions sont ouvertes. Pour une ronde tardive indépendante, demandez à l’organisation de masquer les notes avant de continuer.',
    allCategories: 'Toutes les catégories',
    empty: 'Rien à évaluer pour l’instant — aucune conférence n’a été soumise.',
    onlyYours: 'Rien à évaluer pour l’instant. Vous ne pouvez pas noter votre propre conférence, et c’est la seule soumise jusqu’ici.',
    progress: (handled: number, total: number) => `${handled} sur ${total} avec réponse`,
    scoreLabel: 'Noter cette proposition',
    scores: {
      1: '1 — Non',
      2: '2 — Peut-être',
      3: '3 — Oui',
      4: '4 — Oui, sans hésiter',
    } as Record<number, string>,
    rubricTitle: 'Un barème commun',
    rubricHelp:
      'Jugez la proposition devant vous, et non sa place par rapport à la file actuelle.',
    rubric: {
      1: 'Ne pas programmer : valeur floue, lacunes importantes ou préparation insuffisante.',
      2: 'À discuter : du potentiel, mais des questions importantes demeurent.',
      3: 'À programmer : valeur claire et présentation crédible.',
      4: 'À prioriser : exceptionnelle, pertinente et difficile à remplacer.',
    } as Record<number, string>,
    gde: 'GDE',
    position: (n: number, total: number) => `${n} sur ${total}`,
    previous: 'Proposition précédente',
    next: 'Proposition suivante',
    queue: 'File d’évaluation',
    queueHelp: 'Passez à n’importe quelle conférence et voyez lesquelles attendent une réponse.',
    queueClose: 'Fermer la file',
    nextUnscored: 'Prochaine sans réponse',
    queueCurrent: 'En cours',
    queueScored: 'Réponse donnée',
    queueConflict: 'Conflit déclaré',
    queueWaiting: 'Réponse requise',
    complete: 'Chaque proposition de cette vue a une réponse.',
    shortcuts: 'Raccourcis',
    shortcutScore: 'Noter, puis passer à la suivante',
    shortcutMove: 'Reculer et avancer sans noter',
    shortcutHelp: 'Afficher ou masquer ceci',
    submissionAnswers: 'Renseignements supplémentaires sur la conférence',
    answerYes: 'Oui',
    answerNo: 'Non',
    submissionDetails: 'Détails de la soumission',
    logistics: 'Venir sur place',
    languagePreference: 'Préférence de langue',
    travel: 'Déplacement',
    travelFor: (name: string) => `Déplacement — ${name}`,
    speakerFallback: (number: number) => `Conférencier ${number}`,
    attendance: {
      local: 'Réside dans la région de Montréal',
      secured: 'Couvert — employeur, programme GDE ou autofinancé',
      pending: 'Prévu mais non confirmé',
    } as Record<string, string>,
    funding: 'Financement',
    decisionBy: 'Saura d’ici',
    visa: 'Visa',
    visaYes: 'A besoin d’un visa ou d’une AVE pour entrer au Canada',
    visaNo: 'N’a pas besoin d’un visa ou d’une AVE pour entrer au Canada',
    submitted: 'Soumise',
    conflict: 'J’ai un conflit d’intérêts',
    conflictHelp: 'Exclue des totaux, y compris de votre propre calibrage.',
    comment: 'Notes pour le comité',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saved: 'Enregistré',
    notScored: 'Aucune réponse pour l’instant',
    untitled: 'Proposition sans titre',
    saveFailedTitle: 'Certaines évaluations ne sont pas enregistrées',
    saveFailedHelp:
      'Vos choix sont toujours ici. Réessayez avant de quitter l’espace d’évaluation.',
    retrySave: 'Réessayer',
    returnToProposal: 'Ouvrir la proposition',
    othersHidden:
      'Les notes des autres évaluateurs restent masquées jusqu’à leur ouverture par un administrateur.',
    others: 'Notes du comité',
    sortedByDisagreement: 'Triées par désaccord — celles qui méritent discussion sont en tête.',
    conflictDeclared: 'conflit déclaré',
  },

  coSpeakers: {
    title: 'Conférenciers de cette proposition',
    help:
      'Invitez jusqu’à trois co-conférenciers avant la soumission. Chaque personne complète sa propre préparation et, si la proposition est retenue, confirme séparément. La conférence est confirmée seulement lorsque tous les conférenciers actifs ont confirmé.',
    adminHelp:
      'Le conférencier principal invite les co-conférenciers avant la soumission. Une fois la proposition retenue, l’organisation peut envoyer ici une invitation vérifiée. Une invitation tardive ne change pas la conférence avant son acceptation; celle-ci attend ensuite la confirmation de tous les conférenciers actifs.',
    readOnlyHelp:
      'Vous êtes co-conférencier de cette proposition. Le conférencier principal gère le contenu; votre profil et votre confirmation demeurent les vôtres.',
    saveDetails: 'Enregistrer mes renseignements',
    loading: 'Chargement des conférenciers…',
    loadFailed: 'Impossible de charger la liste des conférenciers.',
    invitationNoLongerAvailable:
      'Cette invitation ne peut plus être complétée. Rechargez pour voir son état actuel.',
    invitationReviewerConflict:
      'Vous avez déjà évalué cette proposition; vous ne pouvez donc pas la rejoindre comme conférencier.',
    retry: 'Réessayer',
    refresh: 'Actualiser les conférenciers',
    refreshing: 'Actualisation…',
    refreshed: 'Liste des conférenciers actualisée.',
    empty: 'Aucun autre conférencier pour le moment.',
    inviteLabel: 'Courriel du co-conférencier',
    invitePlaceholder: 'conferencier@exemple.com',
    invite: 'Envoyer l’invitation',
    inviting: 'Envoi…',
    invited: (email: string) => `Invitation envoyée à ${email}.`,
    deliveryState: {
      queued: 'Courriel en file d’attente',
      sending: 'Envoi du courriel…',
      sent: 'Courriel envoyé',
      notDelivered: 'Courriel non livré',
    },
    retryDelivery: 'Réessayer l’envoi',
    retryingDelivery: 'Nouvel essai…',
    retryDeliveryFor: (email: string) => `Réessayer l’envoi de l’invitation à ${email}`,
    retryingDeliveryFor: (email: string) => `Nouvel essai d’envoi de l’invitation à ${email}…`,
    deliveryRetried: (email: string) => `Un nouveau courriel d’invitation a été mis en file d’attente pour ${email}.`,
    alreadyInvited:
      'Cette personne est déjà conférencière ou possède une invitation active.',
    inviteLimit:
      'Aucun autre co-conférencier ni aucune autre invitation ne peut être ajouté à cette proposition.',
    inviteHelp:
      'Utilisez l’adresse avec laquelle cette personne se connectera. Elle doit accepter avant la soumission.',
    lateInviteHelp:
      'Utilisez l’adresse avec laquelle cette personne se connectera. La conférence reste inchangée jusqu’à son acceptation; après son arrivée, cette personne doit remplir sa propre confirmation avant que la conférence soit de nouveau confirmée.',
    lateInvitePendingTitle: 'Cette personne ne fait pas encore partie de la conférence',
    lateInvitePendingHelp:
      'La liste et la confirmation actuelles restent inchangées tant que l’invitation est en attente. Son acceptation ajoute le conférencier et remet la conférence en attente des confirmations.',
    atCapacity: 'Cette proposition compte déjà le maximum de quatre conférenciers.',
    manage: 'Liste des conférenciers',
    close: 'Fermer la liste des conférenciers',
    lead: 'Conférencier principal',
    joined: 'A rejoint',
    pending: 'Invitation en attente',
    declined: 'Refusée',
    revoked: 'Invitation révoquée',
    currentAccount: 'Vous',
    awaitingConfirmation: 'Confirmation en attente',
    confirmationFor: (name: string) => `Confirmation — ${name}`,
    profileReadyLabel: 'Profil prêt',
    profileNeeded: 'Profil incomplet',
    detailsReady: 'Renseignements de participation prêts',
    detailsNeeded: 'Renseignements de participation requis',
    revoke: 'Révoquer l’invitation',
    revoking: 'Révocation…',
    revokeInvitation: (email: string) => `Révoquer l’invitation de ${email}`,
    revokingInvitation: (email: string) => `Révocation de l’invitation de ${email}…`,
    revokedNotice: (email: string) => `Invitation de ${email} révoquée.`,
    revokeConfirm: (email: string) =>
      `Révoquer l’invitation de co-conférencier envoyée à ${email} ? Ce lien ne permettra plus de rejoindre la proposition.`,
    remove: 'Retirer le co-conférencier',
    removing: 'Retrait…',
    removeSpeaker: (name: string) => `Retirer le co-conférencier ${name}`,
    removingSpeaker: (name: string) => `Retrait du co-conférencier ${name}…`,
    removedNotice: (name: string) => `${name} a été retiré de cette proposition.`,
    removeConfirm: (name: string) =>
      `Retirer ${name} de cette proposition ? Cette personne perdra son accès et disparaîtra de la liste. Si un aperçu du programme est déjà partagé ou public, vérifiez-le et partagez-le de nouveau.`,
    leave: 'Quitter la proposition',
    leaving: 'Départ…',
    leaveProposal: 'Quitter cette proposition',
    leavingProposal: 'Départ de cette proposition…',
    leaveConfirm:
      'Quitter cette proposition ? Vous perdrez votre accès et ne figurerez plus parmi les conférenciers.',
    leftNotice: 'Vous avez quitté cette proposition.',
    pendingBlockTitle: 'Complétez la préparation de chaque conférencier avant de soumettre',
    pendingBlockHelp:
      'Attendez l’acceptation des invitations et demandez à chaque personne de compléter son profil et ses renseignements de participation. Vous pouvez révoquer une invitation en attente pour soumettre sans cette personne.',
    yourSetupTitle: 'Le conférencier principal attend la préparation des participants',
    yourSetupHelp:
      'Complétez votre profil et vos renseignements de participation ci-dessous. La proposition ne peut pas être soumise avant que chaque personne soit prête.',
    waitingOnTeamTitle: 'Votre préparation est terminée',
    waitingOnTeamHelp:
      'Le conférencier principal attend qu’une autre personne invitée ou participante termine sa préparation.',
    startDraftFirst: 'Enregistrez le brouillon avant d’inviter un co-conférencier.',
    invitationEyebrow: 'Invitation à titre de co-conférencier',
    invitationTitle: 'Rejoindre cette proposition',
    invitationFrom: (name: string) =>
      `${name} vous invite à présenter cette conférence ensemble.`,
    lateInvitationFrom: (name: string) =>
      `L’organisation vous invite à rejoindre la conférence retenue de ${name} à titre de co-conférencier.`,
    eventLabel: 'Événement',
    proposalLabel: 'Proposition',
    accountLabel: 'Compte invité',
    talkDetailsTitle: 'Vérifiez la conférence avant de vous joindre',
    conflictTitle: 'Votre accès au comité change si vous acceptez',
    conflictHelp:
      'En acceptant, vous devenez conférencier de cette proposition. Vous ne pourrez pas l’évaluer ni lire les évaluations du comité, même si vous faites aussi partie du comité.',
    profileTitle: 'Complétez votre profil de conférencier',
    profileHelp:
      'Votre nom et votre biographie demeurent liés à votre compte et paraîtront avec la conférence si elle est publiée.',
    profileReady: 'Votre profil de conférencier est prêt.',
    participationTitle: 'Vos renseignements de participation',
    participationHelp:
      'Puisque cette conférence est déjà retenue, complétez les attestations de l’événement et vos renseignements de déplacement avant de vous joindre. Vous confirmerez ensuite la conférence et répondrez à ses questions de confirmation.',
    participationHelpAcks:
      'Puisque cette conférence est déjà retenue, complétez les attestations de l’événement avant de vous joindre. Vous confirmerez ensuite la conférence et répondrez à ses questions de confirmation.',
    participationHelpTravel:
      'Puisque cette conférence est déjà retenue, complétez vos renseignements de déplacement avant de vous joindre. Vous confirmerez ensuite la conférence et répondrez à ses questions de confirmation.',
    join: 'Enregistrer le profil et accepter',
    joinLate: 'Enregistrer les renseignements et accepter',
    joining: 'Acceptation…',
    decline: 'Refuser l’invitation',
    declineConfirm: 'Refuser cette invitation de co-conférencier ?',
    wrongAccountTitle: 'Cette invitation appartient à un autre compte',
    wrongAccountHelp: (email: string) =>
      `Connectez-vous avec ${email} pour accepter ou refuser cette invitation.`,
    switchAccount: 'Changer de compte',
    expiredTitle: 'Cette invitation est expirée',
    expiredHelp:
      'Demandez au conférencier principal d’envoyer une nouvelle invitation.',
    revokedTitle: 'Cette invitation a été révoquée',
    revokedHelp: 'Le conférencier principal a révoqué cette invitation.',
    pausedTitle: 'Cette invitation est temporairement indisponible',
    pausedHelp: 'L’appel à conférences est en pause. Réessayez lorsque celui-ci reprendra.',
    unavailableTitle: 'Cette invitation est indisponible',
    unavailableHelp: 'L’événement ne peut plus accepter de réponse à cette invitation.',
    acceptedTitle: 'Vous avez rejoint cette proposition',
    acceptedHelp: 'La conférence est maintenant visible avec vos autres propositions.',
    lateAcceptedHelp:
      'Vous faites maintenant partie des conférenciers de cette conférence. Ouvrez-la pour fournir les renseignements requis et confirmer votre participation.',
    declinedTitle: 'Invitation refusée',
    declinedHelp: 'Vous ne figurez pas parmi les conférenciers de cette proposition.',
    openProposal: 'Ouvrir la proposition',
    backToEvent: 'Retour à l’événement',
    personalEditHelp: {
      all:
        'Le conférencier principal gère la conférence. Vous pouvez encore modifier votre profil, vos attestations de participation et vos détails de voyage.',
      logistics:
        'Le conférencier principal gère la conférence. Vous pouvez encore modifier votre profil et vos détails de voyage.',
      none:
        'Le conférencier principal gère la conférence. Votre profil reste modifiable depuis votre compte; les renseignements de participation sont maintenant verrouillés.',
    } as Record<string, string>,
    personalEditHelpNoAttendance: {
      all:
        'Le conférencier principal gère la conférence. Vous pouvez encore modifier votre profil et vos attestations de participation.',
      logistics:
        'Le conférencier principal gère la conférence. Votre profil de conférencier reste modifiable.',
      none:
        'Le conférencier principal gère la conférence. Votre profil reste modifiable depuis votre compte; les renseignements de participation sont maintenant verrouillés.',
    } as Record<string, string>,
    manageFor: (title: string) => `Ouvrir la liste des conférenciers pour ${title}`,
  },

  schedule: {
    title: 'Programme',
    adminTitle: 'Construire le programme',
    adminHelp:
      'Placez les conférences en privé, partagez un aperçu confirmé, puis publiez exactement cette version vérifiée.',
    releaseFlowEyebrow: 'Diffusion de l’horaire',
    releaseFlowTitle: 'Faites avancer le programme en trois étapes volontaires',
    releaseFlowHelp:
      'Planifiez en privé, partagez un aperçu confirmé, puis publiez exactement cette version.',
    privateBadge: 'Privé',
    sharedBadge: 'Partagé',
    notSharedBadge: 'Non partagé',
    liveBadge: 'En ligne',
    offlineBadge: 'Hors ligne',
    privateDraftTitle: 'Brouillon privé',
    privateDraftHelp:
      'Votre tableau de travail. Les plages acceptées, provisoires et confirmées restent ici avec l’administration.',
    sharedPreviewTitle: 'Aperçu partagé',
    sharedPreviewHelp:
      'Une version figée des séances confirmées pour les conférenciers et le comité. Les changements du brouillon n’y paraissent pas.',
    publicProgrammeTitle: 'Programme public',
    publicProgrammeHelp:
      'La version destinée au public. La publication promeut exactement l’aperçu partagé, sans le reconstruire.',
    versionLabel: 'Version',
    revision: (n: number) => `Brouillon r${n}`,
    audienceLabel: 'Public visé',
    privateAudience: 'Administrateurs et propriétaires',
    sharedAudience: 'Comité; chaque conférencier confirmé ne voit que sa propre plage',
    publicAudience: 'Tout le monde',
    updatedLabel: 'Mise à jour',
    privateTentative: (n: number) => `${n} ${n === 1 ? 'plage provisoire reste' : 'plages provisoires restent'} privée${n === 1 ? '' : 's'}`,
    sharedStale:
      'L’aperçu partagé ne correspond plus aux détails actuels du programme. Partagez un nouvel aperçu avant de publier.',
    archivedTitle: 'Programme archivé — lecture seule',
    archivedHelp:
      'Le tableau de planification et l’historique du programme public sont figés. Réactivez d’abord l’événement si une modification urgente est nécessaire.',
    share: 'Vérifier et partager',
    shareTitle: 'Partager cet aperçu confirmé?',
    shareHelp:
      'Une version figée est créée avec les séances confirmées et les éléments publics. Les plages provisoires restent privées.',
    shareDeliveryHelp:
      'Après le partage, l’envoi au comité commence immédiatement. Les nouveaux messages de placement restent retenus dans Courriel pour vérification.',
    shareConfirm: 'Partager l’aperçu',
    shareBlocked: 'Résolvez les conflits entre les séances confirmées avant de partager.',
    shareNoChanges: 'L’aperçu partagé correspond déjà à ce brouillon.',
    shareSpeakerAudience:
      'Chaque conférencier confirmé voit seulement ses propres séances confirmées, avec les détails du programme et du placement.',
    shareCommitteeAudience: 'Les évaluateurs, administrateurs et propriétaires voient le programme confirmé en lecture seule.',
    sharePublicAudience: 'Le public continue de voir uniquement le programme actuellement publié.',
    sharedCount: (n: number) => `${n} éléments partagés`,
    omittedCount: (n: number) => `${n} provisoires omis`,
    shared: 'Aperçu partagé.',
    sharedVersion: (n: number) => `Version partagée ${n}`,
    sharedSummary: (shared: number, omitted: number) => `${shared} éléments partagés; ${omitted} provisoires omis.`,
    sharedChannels: (committee: number, speakers: number) =>
      `L’envoi a commencé pour ${committee} membre${committee === 1 ? '' : 's'} admissible${committee === 1 ? '' : 's'} du comité. ${speakers} message${speakers === 1 ? '' : 's'} de placement ${speakers === 1 ? 'est géré' : 'sont gérés'} dans Courriel; les nouveaux restent retenus pour vérification.`,
    publishNeedsShare: 'Vérifiez et partagez d’abord l’aperçu confirmé.',
    publishNeedsReshare:
      'L’aperçu partagé ne correspond plus aux détails actuels du programme. Partagez un nouvel aperçu avant de publier.',
    publishWaitingHelp: 'Rien n’est encore prêt pour le public. Partagez d’abord un aperçu confirmé.',
    publishReadyHelp: 'Le dernier aperçu partagé est prêt à être publié.',
    viewPublic: 'Voir le programme public',
    takeOffline: 'Retirer du public',
    takeOfflineTitle: 'Retirer le programme public?',
    takeOfflineHelp:
      'Le programme disparaîtra immédiatement de la vue publique. Les liens de séance n’afficheront plus son contenu.',
    takeOfflineKept:
      'Le brouillon privé, l’aperçu partagé et l’historique des versions restent intacts. Vous pourrez republier plus tard.',
    takeOfflineConfirm: 'Retirer le programme public',
    unpublishedSuccess: 'Le programme public est hors ligne. L’aperçu partagé et l’historique ont été conservés.',
    publishOpenTitle: 'Les propositions sont encore ouvertes',
    publishOpenHelp:
      'Publier maintenant expose le programme pendant que des personnes peuvent encore soumettre. Confirmez que ce moment est intentionnel.',
    configure: 'Configuration de l’horaire',
    configureHelp: 'Les salles sont les parcours visibles du public. Les heures suivent le fuseau de l’événement.',
    timeZone: 'Fuseau horaire de l’événement',
    days: 'Jours de l’événement',
    day: 'Jour',
    addDay: 'Ajouter un jour',
    removeDay: 'Retirer le jour',
    dayHasItems: 'Déplacez ou retirez d’abord les éléments programmés ce jour-là.',
    dayStarts: 'Début du programme',
    dayEnds: 'Fin du programme',
    rooms: 'Salles / parcours',
    roomNameEn: 'Nom de la salle (anglais)',
    roomNameFr: 'Nom de la salle (français)',
    addRoom: 'Ajouter une salle',
    roomCount: (n: number) => `${n} ${n === 1 ? 'salle / parcours' : 'salles / parcours'}`,
    roomNumber: (n: number) => `Salle ${n}`,
    roomOrder: (room: string) => `Changer la position de ${room}`,
    moveRoomUp: (room: string) => `Déplacer ${room} vers la gauche`,
    moveRoomDown: (room: string) => `Déplacer ${room} vers la droite`,
    removeRoom: 'Retirer la salle',
    roomHasItems: 'Déplacez ou retirez d’abord les éléments programmés dans cette salle.',
    oneRoomRequired: 'L’horaire doit conserver au moins une salle.',
    saveSetup: 'Enregistrer la configuration',
    setupSaved: 'Configuration de l’horaire enregistrée.',
    saveSetupFirst: 'Enregistrez la configuration avant de partager ou de publier.',
    needsSetup: 'Définissez les jours et au moins une salle avant de placer les séances.',
    unassigned: 'Séances non programmées',
    unassignedHelp:
      'Les conférences acceptées peuvent être planifiées ici; seules les confirmées entrent dans le programme partagé ou public.',
    noUnassigned: 'Chaque conférence retenue a une place.',
    tentative: 'Confirmation en attente',
    confirmed: 'Confirmée',
    confirmationStatus: 'Confirmation',
    sessionFacts: 'Détails de planification',
    search: 'Rechercher des séances',
    searchHelp: 'Recherchez par titre, conférencier, catégorie, format, niveau ou langue.',
    custom: 'Ajouter un élément',
    edit: 'Modifier le placement',
    editSelected: 'Modifier la séance sélectionnée',
    sessionActions: 'Actions de la séance',
    move: 'Déplacer ou modifier',
    remove: 'Retirer de l’horaire',
    removeConfirm: 'Retirer cet élément de l’horaire provisoire?',
    date: 'Date',
    startsAt: 'Heure de début',
    time: 'Heure',
    duration: 'Durée (minutes)',
    room: 'Salle / parcours',
    language: 'Langue programmée',
    languageNeeded: 'Langue à choisir',
    languageNeutral: 'Sans langue particulière',
    customLanguageHelp:
      'Facultatif. Laissez les pauses, repas et éléments destinés à tout le monde sans langue particulière.',
    itemType: 'Type d’élément',
    titleEn: 'Titre (anglais)',
    titleFr: 'Titre (français)',
    descriptionEn: 'Description (anglais)',
    descriptionFr: 'Description (français)',
    customSpeakersTitle: 'Conférenciers (facultatif)',
    customSpeakersHelp:
      'Ajoutez les personnes visibles du public pour les conférences principales, panels, cérémonies ou autres éléments.',
    customSpeakerCount: (count: number, max: number) => `${count} conférencier${count === 1 ? '' : 's'} sur ${max}`,
    noCustomSpeakers: 'Aucun conférencier ajouté. Cet élément paraîtra sans section de conférenciers.',
    addCustomSpeaker: 'Ajouter un conférencier',
    customSpeakerNumber: (n: number) => `Conférencier ${n}`,
    customSpeakerName: (n: number) => `Nom du conférencier ${n}`,
    customSpeakerJobTitle: (n: number) => `Rôle ou poste du conférencier ${n}`,
    customSpeakerCompany: (n: number) => `Organisation du conférencier ${n}`,
    customSpeakerBio: (n: number) => `Biographie du conférencier ${n}`,
    customSpeakerPhoto: 'Photo du conférencier',
    customSpeakerPhotoHelp:
      'Facultative. Ce portrait apparaît seulement après le partage et la publication du programme.',
    customSpeakerPhotoChoose: 'Choisir une photo',
    customSpeakerPhotoReplace: 'Remplacer la photo',
    customSpeakerPhotoRemove: 'Retirer',
    customSpeakerPhotoInput: (n: number) => `Choisir la photo du conférencier ${n} pour le programme`,
    customSpeakerPhotoUploading: 'Téléversement…',
    customSpeakerPhotoPending: 'Photo prête. Enregistrez cet élément du programme pour la joindre.',
    customSpeakerPhotoUploadFailed:
      'La photo du conférencier n’a pas pu être téléversée. Réessayez.',
    customSpeakerPhotoLoadFailed: 'La photo enregistrée du conférencier n’a pas pu être chargée.',
    customSpeakerPhotoRemoveConfirm:
      'Retirer cette photo de l’élément de programme en cours de préparation?',
    removeCustomSpeaker: (n: number) => `Retirer le conférencier ${n}`,
    removeCustomSpeakerShort: 'Retirer',
    customSpeakerNameMissing: 'Saisissez le nom de ce conférencier.',
    customSpeakerNameRequired: 'Ajoutez un nom pour chaque conférencier avant d’enregistrer.',
    saveItem: 'Enregistrer',
    cancelEdit: 'Annuler',
    dragHint: 'Glissez vers le repère de placement de 5 minutes ou utilisez Déplacer ou modifier. Sélectionnez une séance ci-dessous pour ajuster sa durée.',
    emptySlot: (time: string, room: string) => `Ajouter à ${time} dans ${room}`,
    dragGuide: (range: string, room: string) => `Déplacer à ${range} dans ${room}.`,
    dragConflict: 'Ce placement entre en conflit avec un autre élément du programme.',
    dragOutsideDay: 'Ce placement se termine après la journée du programme.',
    resizeLabel: (title: string) => `Redimensionner ${title}`,
    resizeSession: 'Ajuster la durée d’une séance',
    selectedSession: 'Séance sélectionnée',
    resizeHint: 'Glissez la commande, utilisez les flèches pour 5 minutes ou les touches Page pour 15 minutes.',
    durationValue: (minutes: number) => `${minutes} min`,
    resizeValue: (range: string, minutes: number) => `${range}, ${minutes} minutes`,
    resizeLimited: (range: string) => `Limite de l’horaire atteinte à ${range}.`,
    resizeConflict: (range: string) => `${range} entre en conflit avec un autre élément. La durée n’a pas changé.`,
    resizeNotSaved: 'La durée n’a pas changé. Rechargez l’horaire et réessayez.',
    metrics: 'État du programme',
    scheduledCount: (n: number) => `${n} programmées`,
    unassignedCount: (n: number) => `${n} non programmées`,
    tentativeCount: (n: number) => `${n} provisoires`,
    conflictCount: (n: number) => `${n} conflits`,
    unpublished: 'Modifications non partagées',
    publishedVersion: (n: number) => `Version publique ${n}`,
    publish: 'Vérifier et publier',
    publishTitle: 'Publier ce programme?',
    publishHelp:
      'Le public verra immédiatement cette version. Les courriels resteront en attente de vérification.',
    publishBlocked: 'L’aperçu partagé doit être à jour et sans conflit avant la publication.',
    publishNoChanges: 'Le programme public est déjà à jour.',
    publishConfirm: 'Publier le programme',
    published: 'Le programme public est en ligne.',
    committeePreviewTitle: 'Aperçu du comité',
    committeePreviewHelp: 'Séances confirmées seulement. Ce programme de travail en lecture seule n’est pas public.',
    committeePreviewDetail:
      'Il s’agit de la version de travail partagée du comité. Les téléchargements de calendrier seront offerts après la publication.',
    committeeNextTitle: 'Vérifiez les détails de travail',
    committeeNextHelp:
      'Vérifiez l’heure, la salle et la langue. Signalez tout conflit ou correction par le canal convenu avec l’équipe; il n’y a aucune approbation dans l’application.',
    committeeSignInTitle: 'Un aperçu du comité est disponible',
    committeeSignInHelp:
      'Connectez-vous avec votre compte du comité pour ouvrir l’horaire de travail confirmé actuel. Vous resterez sur cette page.',
    notPublic: 'Non public',
    publicHelp: 'Choisissez un jour, une salle ou une langue. Les heures suivent le fuseau de l’événement.',
    allRooms: 'Toutes les salles',
    allLanguages: 'Toutes les langues',
    languageNames: {
      en: 'Anglais',
      fr: 'Français',
      bilingual: 'Bilingue',
    },
    calendar: 'Télécharger le calendrier',
    sessionCalendar: 'Ajouter la séance au calendrier',
    csv: 'Télécharger le CSV',
    details: 'Détails de la séance',
    speakers: 'Conférenciers',
    back: 'Retour au programme',
    cancelled: 'Annulée',
    cancelledHelp: 'Cette séance n’aura plus lieu. Le programme sera bientôt mis à jour.',
    noPublished: 'Le programme n’est pas encore publié.',
    sessionNotFound: 'Cette séance ne figure pas dans le programme actuel.',
    noMatches: 'Aucun élément ne correspond à ces filtres.',
    sessionsAt: (time: string) => `Séances commençant à ${time}`,
    stale: 'Quelqu’un a modifié l’horaire dans un autre onglet. Rechargez avant de continuer.',
    conflict: 'Ce placement chevauche une salle ou un conférencier déjà programmé.',
    invalidState: 'Seules les conférences acceptées ou confirmées peuvent être planifiées; la publication exige une confirmation.',
    emailDeliveryInProgress:
      'Les notifications d’horaire sont en cours d’envoi. Attendez la fin de la livraison avant de partager un autre aperçu.',
    emailDeliveryRetryRequired:
      'Le résultat de livraison d’une notification d’horaire est incertain. Relancez-la dans Courriels avant de partager un autre aperçu.',
    cancellationDeliveryPending:
      'Envoyez ou relancez l’avis d’annulation précédent avant de remettre cette séance au programme.',
    cancellationProcessing:
      'Une annulation d’horaire précédente est toujours en cours de traitement. Attendez un instant, puis partagez de nouveau.',
    speakerPhotoRequired:
      'Chaque conférencier à l’horaire doit confirmer une photo pour le programme avant le partage de cet aperçu.',
    badInput: 'Vérifiez les jours, les salles, les heures, la durée et les titres obligatoires.',
    reload: 'Recharger l’horaire',
    types: {
      keynote: 'Conférence principale',
      break: 'Pause',
      meal: 'Repas',
      social: 'Activité sociale',
      opening: 'Ouverture',
      closing: 'Clôture',
      other: 'Autre',
    } as Record<string, string>,
  },

  consent: {
    title: 'Une petite question sur la mesure d’audience.',
    body:
      'Nous aimerions compter les visites de ce site afin de savoir si l’appel à conférences se rend jusqu’aux gens. Cela passe par Google Analytics, qui dépose un identifiant sur votre appareil. Ce n’est jamais lié à votre proposition, et refuser ne change rien au fonctionnement du site pour vous.',
    accept: 'Autoriser',
    decline: 'Non merci',
    stateOn: 'Les visites de ce site sont comptées.',
    stateOff: 'Les visites de ce site ne sont pas comptées.',
    change: 'Modifier ce choix',
  },
  errors: {
    generic: 'Une erreur est survenue. Veuillez réessayer.',
    signIn: 'Connexion impossible. Veuillez réessayer.',
    signedOut: 'Votre session a expiré. Veuillez vous reconnecter.',
    notFound: 'Cette proposition est introuvable.',
    incomplete: 'Des réponses sont manquantes ou invalides. Veuillez vérifier le formulaire.',
    unavailable: 'Ce service est indisponible pour le moment. Veuillez réessayer sous peu.',
    pageUnavailableTitle: 'Cette page est temporairement indisponible',
    notOpen: 'L’appel à conférences n’est pas ouvert en ce moment.',
    readOnlyNow:
      'Ce formulaire ne peut plus être modifié — l’appel est peut-être terminé, ou votre proposition a déjà été soumise. Rechargez la page pour voir l’état actuel.',
    crashed: 'Un problème est survenu sur cette page. Rechargez — votre brouillon est conservé.',
    reload: 'Recharger',
    talkCapReached:
      'Vous avez atteint la limite de propositions actives. Retirez-en une avant d’en soumettre une autre.',
    coSpeakerTalkCapReached:
      'Un co-conférencier de cette proposition a atteint sa limite de propositions actives. Cette personne doit en retirer une, ou vous pouvez la retirer de la proposition et la soumettre sans elle.',

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
      sessionizeUrl: 'Ce n’est pas un lien de profil Sessionize.',
      notAnOption: 'Choisissez l’une des options proposées.',
    },
  },
};
