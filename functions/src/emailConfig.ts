import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

import {
  parseSender,
  senderMismatch,
  type EmailSettings,
} from '../../shared/emailSettings';
import {
  activeTemplate,
  EMAIL_KINDS,
  EMAIL_LOCALES,
  type EmailKind,
  type EmailLocale,
  type TemplateOverrides,
} from '../../shared/emailTemplates';
import {
  emailDomainBindingRef,
  emailDomainBindingMatches,
  ensureLegacyEmailDomainBinding,
  platformEmailDomainBindingMatches,
} from './emailTenancy';

export type EmailSource = 'platform' | 'event';

export interface EventEmailSettings {
  from: string;
  /** Optional display name while the platform retains ownership of the address. */
  platformSenderName: string;
  /** `null` inherits the platform value; an empty string explicitly clears it. */
  replyTo: string | null;
  domainId: string;
  domain: string;
}

export interface ResolvedEmailConfiguration {
  source: EmailSource;
  senderMode: EmailSource;
  settings: EmailSettings;
  domainId: string;
  domain: string;
  templates: TemplateOverrides;
  templateOverrides: TemplateOverrides;
  eventSettings: EventEmailSettings;
  platformData: DocumentData;
  eventData: DocumentData;
  platformBound: boolean;
  eventBound: boolean;
}

export interface EmailContentContext {
  cfpName: string;
  publicUrl: string;
}

/**
 * The Auth emulator can mint links without a real sender, but it must not hide
 * a broken identity that production would refuse. A completely unconfigured
 * platform remains useful for local dry runs; selecting an event identity is
 * itself a declaration even before all of its fields have been filled in.
 */
export function emailConfigurationHasInvalidActiveIdentity(
  config: ResolvedEmailConfiguration,
): boolean {
  const active = config.source === 'event' ? config.eventData : config.platformData;
  const identityDeclared =
    config.source === 'event' ||
    Boolean(text(active.from) || text(active.domainId) || text(active.domain));
  if (!identityDeclared) return false;

  const bound = config.source === 'event' ? config.eventBound : config.platformBound;
  return !bound || !config.settings.from || !config.domainId || !config.domain;
}

function emailTransportConfigurationFingerprintInput(config: ResolvedEmailConfiguration) {
  return {
    source: config.source,
    settings: config.settings,
    domainId: config.domainId,
    domain: config.domain,
    templates: emailTemplatesFingerprintInput(config.templates),
  };
}

/** Delivery inputs reviewed by a person, including copy rendered outside email config. */
export function emailConfigurationFingerprint(
  config: ResolvedEmailConfiguration,
  content: EmailContentContext,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...emailTransportConfigurationFingerprintInput(config),
        content,
      }),
    )
    .digest('base64url');
}

/** Preserves the pre-review handoff guard for immediate automatic messages. */
export function emailTransportConfigurationFingerprint(
  config: ResolvedEmailConfiguration,
): string {
  return createHash('sha256')
    .update(JSON.stringify(emailTransportConfigurationFingerprintInput(config)))
    .digest('base64url');
}

type EmailTemplateFingerprintLeaf = readonly [
  kind: EmailKind,
  locale: EmailLocale,
  subject: string,
  body: string,
];

/** Ordered, complete copy input so changing built-in wording invalidates an earlier review. */
export function emailTemplatesFingerprintInput(
  overrides: TemplateOverrides = {},
): EmailTemplateFingerprintLeaf[] {
  return EMAIL_KINDS.flatMap((kind) =>
    EMAIL_LOCALES.map((locale) => {
      const template = activeTemplate(kind, locale, overrides);
      return [kind, locale, template.subject, template.body] as const;
    }),
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const derivedUrl = () => `https://${process.env.GCLOUD_PROJECT ?? 'localhost'}.web.app`;

export function platformPublicUrl(platform: DocumentData): string {
  return (
    (typeof platform.publicUrl === 'string' ? platform.publicUrl : '') ||
    process.env.CFP_PUBLIC_URL ||
    derivedUrl()
  );
}

export function emailContentContext(
  cfpId: string,
  cfp: DocumentData,
  platform: DocumentData,
): EmailContentContext {
  return {
    cfpName: (typeof cfp.name === 'string' && cfp.name) || cfpId,
    publicUrl: platformPublicUrl(platform),
  };
}

export async function loadEmailContentContext(
  db: Firestore,
  cfpId: string,
): Promise<EmailContentContext> {
  const [cfpSnap, platformSnap] = await db.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc('config/platform'),
  );
  return emailContentContext(cfpId, cfpSnap.data() ?? {}, platformSnap.data() ?? {});
}

export function boundEmailSender(value: unknown, domain: string): string {
  const from = text(value);
  return 'address' in parseSender(from) && !senderMismatch(from, domain) ? from : '';
}

/** An event may rename the sender, but never choose another address on the shared domain. */
export function resolvedPlatformSender(
  platformFrom: unknown,
  eventSenderName: unknown,
  domain: string,
  bound: boolean,
): string {
  if (!bound) return '';
  const inherited = boundEmailSender(platformFrom, domain);
  if (!inherited) return '';
  const name = text(eventSenderName);
  if (!name) return inherited;
  const parsed = parseSender(inherited);
  return 'address' in parsed ? `${name} <${parsed.address}>` : '';
}

function owns(data: DocumentData, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

export function inferredEventEmailMode(data: DocumentData): EmailSource {
  if (data.senderMode === 'platform' || data.senderMode === 'event') return data.senderMode;
  return text(data.from) || text(data.domainId) || text(data.domain) ? 'event' : 'platform';
}

export function resolveReplyTo(event: DocumentData, platformReplyTo: string): string {
  return owns(event, 'replyTo') && event.replyTo !== null
    ? text(event.replyTo)
    : text(platformReplyTo);
}

function templatesFrom(data: DocumentData): TemplateOverrides {
  const templates = data.templates;
  return templates && typeof templates === 'object' ? (templates as TemplateOverrides) : {};
}

function resolveEmailConfigurationData(
  eventData: DocumentData,
  platformData: DocumentData,
  legacyPlatform: DocumentData,
  eventBound: boolean,
  platformBound: boolean,
): ResolvedEmailConfiguration {
  const platformDomainId = text(platformData.domainId);
  const platformDomain = text(platformData.domain).toLowerCase();
  const hasPlatformIdentity = Boolean(
    text(platformData.from) || platformDomainId || platformDomain,
  );
  // The legacy platform sender remains usable only for CFP-less sign-in links.
  // Event delivery needs the new platform identity and its exact binding.
  const platformFrom = hasPlatformIdentity
    ? resolvedPlatformSender(
        platformData.from,
        eventData.platformSenderName,
        platformDomain,
        platformBound,
      )
    : '';
  const platformReplyTo = owns(platformData, 'replyTo')
    ? text(platformData.replyTo)
    : text(legacyPlatform.replyTo) || text(process.env.CFP_REPLY_TO);

  const eventDomainId = text(eventData.domainId);
  const eventDomain = text(eventData.domain).toLowerCase();
  const candidateEventDomainId = text(eventData.stagedDomainId) || eventDomainId;
  const candidateEventDomain =
    text(eventData.stagedDomain).toLowerCase() || eventDomain;
  const senderMode = inferredEventEmailMode(eventData);
  const eventReplyTo = owns(eventData, 'replyTo') && eventData.replyTo !== null
    ? text(eventData.replyTo)
    : null;
  const templateOverrides = templatesFrom(eventData);
  // Wording belongs to the event. `activeTemplate` fills every absent leaf
  // from the built-in copy; old platform template data is deliberately inert.
  const templates = templateOverrides;
  const source = senderMode;
  const settings: EmailSettings =
    source === 'event'
      ? {
          from: eventBound ? boundEmailSender(eventData.from, eventDomain) : '',
          replyTo: resolveReplyTo(eventData, platformReplyTo),
          publicUrl: '',
        }
      : { from: platformFrom, replyTo: resolveReplyTo(eventData, platformReplyTo), publicUrl: '' };

  return {
    source,
    senderMode,
    settings,
    domainId:
      source === 'event'
        ? eventBound
          ? eventDomainId
          : ''
        : platformBound
          ? platformDomainId
          : '',
    domain:
      source === 'event'
        ? eventBound
          ? eventDomain
          : ''
        : platformBound
          ? platformDomain
          : '',
    templates,
    templateOverrides,
    eventSettings: {
      from: text(eventData.from),
      platformSenderName: text(eventData.platformSenderName),
      replyTo: eventReplyTo,
      domainId: candidateEventDomainId,
      domain: candidateEventDomain,
    },
    platformData,
    eventData,
    platformBound,
    eventBound,
  };
}

export async function resolveEmailConfiguration(
  db: Firestore,
  cfpId: string,
): Promise<ResolvedEmailConfiguration> {
  const [eventSnap, platformEmailSnap, legacyPlatformSnap] = await Promise.all([
    db.doc(`cfps/${cfpId}/config/email`).get(),
    db.doc('config/platformEmail').get(),
    db.doc('config/platform').get(),
  ]);
  const eventData = eventSnap.data() ?? {};
  const platformData = platformEmailSnap.data() ?? {};
  const legacyPlatform = legacyPlatformSnap.data() ?? {};

  const platformDomainId = text(platformData.domainId);
  const platformDomain = text(platformData.domain).toLowerCase();
  const platformBinding = platformDomainId
    ? await emailDomainBindingRef(db, platformDomainId).get()
    : null;
  const platformBound = platformEmailDomainBindingMatches(
    platformBinding?.data(),
    platformDomainId,
    platformDomain,
  );
  const eventDomainId = text(eventData.domainId);
  const eventDomain = text(eventData.domain).toLowerCase();
  const hasEventIdentity = Boolean(text(eventData.from) || eventDomainId || eventDomain);
  const eventBound = hasEventIdentity
    ? await ensureLegacyEmailDomainBinding(db, cfpId, eventData)
    : false;
  return resolveEmailConfigurationData(
    eventData,
    platformData,
    legacyPlatform,
    eventBound,
    platformBound,
  );
}

/** Reads every Firestore input that defines the effective setup inside the caller's transaction. */
export async function emailConfigurationFingerprintInTransaction(
  db: Firestore,
  tx: Transaction,
  cfpId: string,
): Promise<string> {
  const [cfpSnap, eventSnap, platformEmailSnap, legacyPlatformSnap] = await tx.getAll(
    db.doc(`cfps/${cfpId}`),
    db.doc(`cfps/${cfpId}/config/email`),
    db.doc('config/platformEmail'),
    db.doc('config/platform'),
  );
  const eventData = eventSnap.data() ?? {};
  const platformData = platformEmailSnap.data() ?? {};
  const legacyPlatform = legacyPlatformSnap.data() ?? {};
  const eventDomainId = text(eventData.domainId);
  const platformDomainId = text(platformData.domainId);
  const bindingIds = [...new Set([eventDomainId, platformDomainId].filter(Boolean))];
  const bindingSnaps = bindingIds.length
    ? await tx.getAll(...bindingIds.map((domainId) => emailDomainBindingRef(db, domainId)))
    : [];
  const bindings = new Map(
    bindingIds.map((domainId, index) => [domainId, bindingSnaps[index]?.data()]),
  );
  const eventDomain = text(eventData.domain).toLowerCase();
  const platformDomain = text(platformData.domain).toLowerCase();
  const resolved = resolveEmailConfigurationData(
    eventData,
    platformData,
    legacyPlatform,
    emailDomainBindingMatches(
      bindings.get(eventDomainId),
      cfpId,
      eventDomainId,
      eventDomain,
    ),
    platformEmailDomainBindingMatches(
      bindings.get(platformDomainId),
      platformDomainId,
      platformDomain,
    ),
  );
  return emailConfigurationFingerprint(
    resolved,
    emailContentContext(cfpId, cfpSnap.data() ?? {}, legacyPlatform),
  );
}

export async function resolvePlatformEmailConfiguration(db: Firestore): Promise<{
  settings: EmailSettings;
  domainId: string;
  domain: string;
  data: DocumentData;
  bound: boolean;
}> {
  const [platformEmailSnap, legacyPlatformSnap] = await Promise.all([
    db.doc('config/platformEmail').get(),
    db.doc('config/platform').get(),
  ]);
  const data = platformEmailSnap.data() ?? {};
  const legacy = legacyPlatformSnap.data() ?? {};
  const domainId = text(data.domainId);
  const domain = text(data.domain).toLowerCase();
  const binding = domainId ? await emailDomainBindingRef(db, domainId).get() : null;
  const bound = platformEmailDomainBindingMatches(binding?.data(), domainId, domain);
  const hasIdentity = Boolean(text(data.from) || domainId || domain);
  return {
    settings: {
      from: hasIdentity
        ? bound
          ? boundEmailSender(data.from, domain)
          : ''
        : text(legacy.from) || text(process.env.CFP_EMAIL_FROM),
      replyTo: owns(data, 'replyTo')
        ? text(data.replyTo)
        : text(legacy.replyTo) || text(process.env.CFP_REPLY_TO),
      publicUrl: '',
    },
    domainId: bound ? domainId : '',
    domain: bound ? domain : '',
    data,
    bound,
  };
}
