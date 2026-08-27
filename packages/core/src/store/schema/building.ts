import type { Migration } from '../open.js'

/**
 * One database per building. A building shares nothing with its neighbours, so
 * this file is the whole of what a building is: its staff, its work, its post,
 * its approvals, its archives and its spending.
 */
export const BUILDING_MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'floors, work, post, approvals',
    sql: `
      create table floors (
        id          text primary key,
        level       integer not null,
        role        text not null,
        name        text not null,
        charter     text not null,
        posting     text not null,
        tools       text not null default '[]',
        hired_at    text not null,
        vacated_at  text
      );
      create index floors_occupied on floors (vacated_at) where vacated_at is null;

      create table tasks (
        id           text primary key,
        assigned_by  text not null references floors (id),
        assigned_to  text not null references floors (id),
        goal         text not null,
        acceptance   text not null default '[]',
        limits       text not null,
        state        text not null,
        result       text,
        created_at   text not null,
        settled_at   text
      );
      create index tasks_open on tasks (assigned_to, state);
      create index tasks_by_state on tasks (state);

      create table messages (
        id            text primary key,
        kind          text not null,
        sender        text not null references floors (id),
        recipient     text not null references floors (id),
        in_reply_to   text references messages (id),
        body          text not null,
        read_at       text,
        created_at    text not null
      );
      -- An inbox is the unread post for one floor, so that is the index.
      create index messages_inbox on messages (recipient, read_at);

      create table approvals (
        id            text primary key,
        kind          text not null,
        requested_by  text not null references floors (id),
        intent        text not null,
        state         text not null default 'pending',
        decided_at    text,
        created_at    text not null
      );
      create index approvals_pending on approvals (state) where state = 'pending';

      -- What was spent, by whom, on what. Budgets are enforced against this and
      -- it is also the answer to "why did today cost that much".
      create table spend (
        id             integer primary key autoincrement,
        floor_id       text references floors (id),
        task_id        text references tasks (id),
        provider       text not null,
        model          text not null,
        input_tokens   integer not null default 0,
        output_tokens  integer not null default 0,
        at             text not null
      );
      create index spend_by_time on spend (at);
    `,
  },
  {
    id: 2,
    name: 'the archives',
    sql: `
      create table memory (
        id           text primary key,
        scope        text not null check (scope in ('floor', 'building', 'skyline')),
        layer        text not null check (layer in ('working', 'episodic', 'semantic', 'procedural')),
        floor_id     text references floors (id),
        text         text not null,
        source       text not null default '',
        pinned       integer not null default 0,
        confidence   real not null default 0.5,
        use_count    integer not null default 0,
        last_used_at text,
        expires_at   text,
        created_at   text not null,
        -- Filled in by the curator; absent until then, and search still works.
        embedding    blob
      );
      create index memory_scope on memory (scope, layer);
      create index memory_pinned on memory (pinned) where pinned = 1;
      create index memory_floor on memory (floor_id);

      -- Keyword search alongside meaning search: each finds what the other misses.
      create virtual table memory_fts using fts5 (
        text,
        content = 'memory',
        content_rowid = 'rowid',
        tokenize = 'porter unicode61'
      );

      create trigger memory_ai after insert on memory begin
        insert into memory_fts (rowid, text) values (new.rowid, new.text);
      end;
      create trigger memory_ad after delete on memory begin
        insert into memory_fts (memory_fts, rowid, text) values ('delete', old.rowid, old.text);
      end;
      create trigger memory_au after update of text on memory begin
        insert into memory_fts (memory_fts, rowid, text) values ('delete', old.rowid, old.text);
        insert into memory_fts (rowid, text) values (new.rowid, new.text);
      end;
    `,
  },
  {
    id: 3,
    name: 'approvals carry what to do when granted',
    sql: `
      -- An approval that only records a sentence cannot be acted on: somebody
      -- has to re-type what was agreed. The payload is what granting it does.
      alter table approvals add column payload text;
    `,
  },
  {
    id: 4,
    name: 'who is working this building',
    sql: `
      -- A claim, held while a goal is being worked, so that the daemon and the
      -- terminal cannot both set a manager going at once. It expires rather
      -- than being merely released: a process that dies cannot tidy up, and a
      -- claim nobody can clear would lock the building for ever.
      create table claim (
        id          integer primary key check (id = 1),
        holder      text not null,
        claimed_at  text not null,
        expires_at  text not null
      );
    `,
  },
  {
    id: 5,
    name: 'the owner is in the post',
    sql: `
      -- Both ends of a message referenced floors and were not null, so the
      -- person who owns the building could not be at either end of one. They
      -- are not a floor and should not be given one — a floor is a hire, it is
      -- counted in the headcount and it changes the shape of the building.
      --
      -- Null is the owner. That is true rather than convenient: they are the
      -- correspondent who does not work here.
      --
      -- SQLite cannot drop a NOT NULL, so the table is rebuilt. Everything
      -- already in it is floor-to-floor and copies across unchanged.
      create table messages_new (
        id            text primary key,
        kind          text not null,
        sender        text references floors (id),
        recipient     text references floors (id),
        in_reply_to   text references messages_new (id),
        body          text not null,
        read_at       text,
        created_at    text not null
      );

      insert into messages_new (id, kind, sender, recipient, in_reply_to, body, read_at, created_at)
        select id, kind, sender, recipient, in_reply_to, body, read_at, created_at from messages;

      drop table messages;
      alter table messages_new rename to messages;

      -- An inbox is the unread post for one floor, so that is the index.
      create index messages_inbox on messages (recipient, read_at);
      -- And the mailroom is the whole correspondence in order, which is not the
      -- same query and was doing a table scan.
      create index messages_when on messages (created_at);
    `,
  },
]
