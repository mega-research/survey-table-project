import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { MailAttachment } from './schema-types';
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

export const mailTemplatesRelations = relations(mailTemplates, ({ one }) => ({
  survey: one(surveys, {
    fields: [mailTemplates.surveyId],
    references: [surveys.id],
  }),
}));

export type MailTemplate = typeof mailTemplates.$inferSelect;
export type NewMailTemplate = typeof mailTemplates.$inferInsert;
