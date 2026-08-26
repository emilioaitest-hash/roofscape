import type { Migration } from '../open.js'

/**
 * The skyline database: the list of buildings, who the owner is, and how to
 * reach the model providers. Small on purpose — everything that belongs to one
 * building lives in that building's own database instead.
 */
export const SKYLINE_MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'buildings, owner, providers',
    sql: `
      create table buildings (
        id          text primary key,
        name        text not null,
        charter     text not null,
        workspace   text not null,
        repos       text not null default '[]',
        budget      text not null,
        created_at  text not null,
        closed_at   text
      );
      create unique index buildings_name on buildings (name);

      -- One row. The owner is a person, not an account, and this is what every
      -- building may know about them without being told twice.
      create table owner (
        id          integer primary key check (id = 1),
        name        text not null default '',
        profile     text not null default '',
        updated_at  text not null
      );
      insert into owner (id, name, profile, updated_at)
        values (1, '', '', datetime('now'));

      create table providers (
        name        text primary key,
        base_url    text,
        -- Either the secret itself, or the name of an environment variable to
        -- read it from. Which of the two is in credential_kind.
        credential      text,
        credential_kind text not null default 'literal'
          check (credential_kind in ('literal', 'env', 'none')),
        added_at    text not null
      );

      create table settings (
        key   text primary key,
        value text not null
      );
    `,
  },
  {
    id: 2,
    name: 'standing orders',
    sql: `
      -- Work that recurs. Kept at skyline level rather than per building, so
      -- one ticker can see everything due without opening every database.
      create table schedules (
        id            text primary key,
        building_id   text not null,
        goal          text not null,
        every_minutes integer not null,
        -- Optional wall-clock anchor, "HH:MM", for things that belong to a time
        -- of day rather than to an interval since the last run.
        at_time       text,
        enabled       integer not null default 1,
        last_run_at   text,
        next_run_at   text not null,
        created_at    text not null
      );
      create index schedules_due on schedules (enabled, next_run_at);
    `,
  },
]
