import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const replays = sqliteTable('duoq_replays', {
  id: text('id').primaryKey(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
});
