---
title: "Database migrations tracked by name"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - database
  - sqlite
  - migrations
  - deployment
status: unread
---

# Database migrations tracked by name

Picture a building renovated over several years by different crews. Every job has a work order, and the site office keeps a logbook. Each finished job is signed off by its work-order name and date. A new crew reads the logbook, skips every job already signed off, and does the rest in date order. Two crews who each wrote a work order the same week never both claim to be "job four". CT Quest's database now works this way. The logbook is a table called schema_migrations.

## What we did in this project

The original CT Quest created its tables with "create table if not exists". That works on a fresh database and does nothing on an existing one. The production database lives in a Docker volume, so a new column added that way would never reach it, and the next query using the column would crash.

Migrations live in backend/src/migrations. Each is a file named with a twelve-digit timestamp, year down to minute, then a short slug, for example 202609260100-platform-core. The file name is the migration's id. On startup the runner reads the folder, sorts the names, and looks up which ids are already recorded in schema_migrations, a table with the id and the time it was applied. It runs every missing one in order. Each runs inside a transaction together with its own logbook row, so a migration that throws halfway leaves no partial tables and no record,.

The first file is the baseline: the original schema word for word, still "if not exists". Databases made by the original code have those tables but no logbook, and report SQLite's built-in version number, PRAGMA user_version, as zero. For them the baseline changes nothing, and they continue through the later files like a fresh database. A database from the first review round, which counted to user_version three, is bridged: a one-off step creates the logbook, marks the three current migrations done, and adds what that round lacked. The runner refuses a database whose logbook names a migration this code does not know, and one stuck at user_version one or two.

The platform-core migration adds the new columns, including a late flag, a normalised student key, reset fields, a results-released time and a detail column for structured scoring. It also rebuilds the answers table, because SQLite cannot relax a NOT NULL constraint in place. Foreign keys are dangerous during a rebuild, and SQLite ignores the pragma that disables them while a transaction is open. So the runner switches them off before the loop, back on afterwards, and runs a foreign key check before each commit.

While copying answers, the migration records what the student actually saw. Each old answer only stored an option index, so it looks up that event's snapshot as it was and writes both the index and the option's text. It also rewrites old snapshots into the new shape and backfills ontology and learning-outcome tags from the bank question with the same id. To do that it needs the content, so the runner passes each migration a context object carrying the validated content. That is why content is now loaded and validated before migrating.

The last migration fixes four flawed questions inside snapshots, but only for events with no submitted attempts. An event that already has submissions keeps exactly the snapshot its students answered. Its stored answers, their recorded option text and the scores awarded all stay consistent, so a teacher's results view never pairs a student's old choice with changed option text. The cost is real: any further student on such an event still sees the flawed question, and the migration logs each event it left alone so a teacher can start a fresh one.

Before migrating a database that holds data, the runner copies it with SQLite's "vacuum into" command to a file named after the target and the last applied migration plus a timestamp. Rolling back means stopping the container and swapping files.

The tests load a real fixture, dumped from a database made by the original main-branch code. It includes one student, Chen, who chose every option the fix changes. The test checks that Chen's answer to S2-02 still says "8", that the score stays 15 out of 90, and that the fresh and migrated schemas are identical.

## Why this choice, and what the alternatives were

The first version of this runner used user_version alone: one integer, bumped by each numbered migration. It needs no table and suits a single file, but it forces a single global sequence. Two Phase 2 branches written in parallel would both create "migration 4", each valid alone, and whoever merged second would have to renumber and hope nobody had run the old number. A logbook of names removes the collision. Each branch adds a timestamped file, and on merge only their relative order needs a glance. The cost is one extra table and a rule about file names, which a test enforces.

Tools like Knex migrations or Umzug do the same with down migrations and several engines, and will be worth it for the planned Postgres move.

Patching every snapshot would have corrected future students on old events, but at the price of history that no longer matches what students saw. Truthful records and consistent scores were judged more important, because a teacher can always create a new event.

## Glossary

Migration: a named, one-way change to the database schema or data.
Schema_migrations: the table recording which migrations have run.
PRAGMA user_version: an integer SQLite stores in the file header, used here only to recognise old databases.
Transaction: a group of changes that commit together or not at all.
Foreign key: a column that must point at an existing row in another table.
Snapshot: the frozen copy of an event's questions taken when the event was created.
