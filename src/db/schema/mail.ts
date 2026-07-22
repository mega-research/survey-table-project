import { relations } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { contactTargets } from './contacts';
import type {
  CampaignFilterSnapshot,
  MailAttachment,
  MailRecipientSendPayloadSnapshot,
} from './schema-types';
import { surveys } from './surveys';

export const mailTemplates = pgTable('mail_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subject: text('subject').notNull().default(''),
  bodyHtml: text('body_html').notNull().default(''),
  fromLocal: text('from_local').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  replyTo: text('reply_to'),
  attachments: jsonb('attachments')
    .notNull()
    .default([])
    .$type<MailAttachment[]>(),
  variablesUsed: jsonb('variables_used')
    .notNull()
    .default([])
    .$type<string[]>(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mailTemplatesRelations = relations(mailTemplates, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [mailTemplates.surveyId],
    references: [surveys.id],
  }),
  campaigns: many(mailCampaigns),
}));

// ─────────────────────────────────────────────────────────────────────────────
// mail_campaigns — 단체 발송 회차. status 전이: draft → queued → sending → completed/partial/cancelled
// 카운터 컬럼은 webhook handler 가 atomic delta 로 갱신 (트리거 미사용).
// ─────────────────────────────────────────────────────────────────────────────

export const mailCampaignStatusValues = [
  'draft',
  'queued',
  'sending',
  'completed',
  'partial',
  'cancelled',
] as const;
export type MailCampaignStatus = (typeof mailCampaignStatusValues)[number];

export const mailCampaigns = pgTable(
  'mail_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    mailTemplateId: uuid('mail_template_id').references(() => mailTemplates.id, {
      onDelete: 'set null',
    }),
    runNumber: integer('run_number').notNull(),
    isTest: boolean('is_test').notNull().default(false),
    title: text('title').notNull(),

    // 발송 시점 스냅샷
    subjectSnapshot: text('subject_snapshot').notNull(),
    bodyHtmlSnapshot: text('body_html_snapshot').notNull(),
    fromLocalSnapshot: text('from_local_snapshot').notNull(),
    fromNameSnapshot: text('from_name_snapshot').notNull(),
    replyToSnapshot: text('reply_to_snapshot'),
    attachmentsSnapshot: jsonb('attachments_snapshot')
      .notNull()
      .default([])
      .$type<MailAttachment[]>(),
    filterSnapshot: jsonb('filter_snapshot')
      .notNull()
      .default({})
      .$type<CampaignFilterSnapshot>(),

    createdBy: uuid('created_by'),
    status: text('status').$type<MailCampaignStatus>().notNull().default('draft'),

    // 카운터 캐시
    recipientCount: integer('recipient_count').notNull().default(0),
    queuedCount: integer('queued_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    openedCount: integer('opened_count').notNull().default(0),
    bouncedCount: integer('bounced_count').notNull().default(0),
    complainedCount: integer('complained_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedUnsubscribedCount: integer('skipped_unsubscribed_count').notNull().default(0),

    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    surveyScopeRunUnique: unique('mail_campaigns_survey_scope_run_unique').on(
      table.surveyId,
      table.isTest,
      table.runNumber,
    ),
  }),
);

export const mailCampaignsRelations = relations(mailCampaigns, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [mailCampaigns.surveyId],
    references: [surveys.id],
  }),
  template: one(mailTemplates, {
    fields: [mailCampaigns.mailTemplateId],
    references: [mailTemplates.id],
  }),
  recipients: many(mailRecipients),
}));

// ─────────────────────────────────────────────────────────────────────────────
// mail_recipients — 수신자별 status + Resend message id 매핑.
// status 전이: queued → sending → sent → delivered → opened
//   또는 → bounced/complained/failed (terminal), 또는 → skipped_unsubscribed (insert 시점)
// ─────────────────────────────────────────────────────────────────────────────

export const mailRecipientStatusValues = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'opened',
  'bounced',
  'complained',
  'failed',
  'skipped_unsubscribed',
] as const;
export type MailRecipientStatus = (typeof mailRecipientStatusValues)[number];

export const mailRecipients = pgTable(
  'mail_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => mailCampaigns.id, { onDelete: 'cascade' }),
    contactTargetId: uuid('contact_target_id').references(() => contactTargets.id, {
      onDelete: 'set null',
    }),
    emailSnapshot: text('email_snapshot'),
    inviteTokenSnapshot: uuid('invite_token_snapshot'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    status: text('status').$type<MailRecipientStatus>().notNull().default('queued'),
    resendMessageId: text('resend_message_id'),
    errorReason: text('error_reason'),
    sendAttemptedAt: timestamp('send_attempted_at', { withTimezone: true }),
    sendLeaseToken: uuid('send_lease_token'),
    sendLeaseExpiresAt: timestamp('send_lease_expires_at', { withTimezone: true }),
    sendPayloadSnapshot: jsonb('send_payload_snapshot').$type<MailRecipientSendPayloadSnapshot>(),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    complainedAt: timestamp('complained_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    campaignContactUnique: unique('mail_recipients_campaign_contact_unique').on(
      table.campaignId,
      table.contactTargetId,
    ),
  }),
);

export const mailRecipientsRelations = relations(mailRecipients, ({ one }) => ({
  campaign: one(mailCampaigns, {
    fields: [mailRecipients.campaignId],
    references: [mailCampaigns.id],
  }),
  contactTarget: one(contactTargets, {
    fields: [mailRecipients.contactTargetId],
    references: [contactTargets.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// webhook_events — Resend webhook idempotency dedupe. id = svix-id (header).
// ─────────────────────────────────────────────────────────────────────────────

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  source: text('source').notNull().default('resend'),
  eventType: text('event_type'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});

// 타입 export
export type MailTemplate = typeof mailTemplates.$inferSelect;
export type NewMailTemplate = typeof mailTemplates.$inferInsert;
export type MailCampaign = typeof mailCampaigns.$inferSelect;
export type NewMailCampaign = typeof mailCampaigns.$inferInsert;
export type MailRecipient = typeof mailRecipients.$inferSelect;
export type NewMailRecipient = typeof mailRecipients.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
