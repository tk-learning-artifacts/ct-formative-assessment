---
title: "Versioned database migrations with PRAGMA user_version"
date: 2026-09-26
project: ct-formative-assessment
tags:
  - database
  - sqlite
  - migrations
  - deployment
status: unread
---

# Versioned database migrations with PRAGMA user_version

Picture a building renovated floor by floor over several years. Every renovation has a numbered work order, and a plaque at the entrance records the last one completed. When a new crew arrives, they read the plaque, skip everything up to that number, and carry out the remaining work orders in sequence. Nobody tries to guess from the paint colour what has already been done. A versioned migration system works the same way, and in SQLite the plaque is a single number in the database file header called user_version.

## What we did in this project

The original CT Quest created its tables with "create table if not exists". That works on a fresh database and does nothing on an existing one. The production database lives in a Docker volume, so adding a column that way would silently never reach it, and the next query using that column would crash.

Migrations now live in backend/src/migrations. Each is a numbered file exporting a version, a name and an up function. Version 1 is the baseline, which is the original schema word for word, still written with "if not exists". Old databases report user_version zero while already holding those tables. For them, running the baseline changes nothing and the version moves to 1. A fresh database gets the tables at that step and then follows exactly the same path. Version 2 is the platform core. Version 3 corrects four broken questions inside existing event snapshots. The runner checks at load time that versions are consecutive and match their position in the list.

On startup the runner reads user_version. If the database is newer than the code, it refuses to run, because an old build must not write to a schema it does not understand. It runs each pending migration inside a transaction, and the version bump happens inside that same transaction. If a migration throws halfway, the partial work and the version bump both roll back, and the file is back at the previous version. A test proves this by adding a deliberately broken migration that creates a table and then throws. Afterwards the version is unchanged and the half-made table is gone.

Version 2 needed the correct_index column in the answers table to allow empty values, because future question types have no option index. SQLite cannot relax a column constraint in place, so the migration builds a new answers table, copies every row across with their original ids, drops the old table and renames the new one. Foreign keys are dangerous during a rebuild like this. If a rebuilt table has children with cascading deletes, dropping it deletes the children. SQLite ignores the pragma that switches foreign keys off while a transaction is open, so the runner switches them off before the loop and back on afterwards. Inside each transaction it runs a foreign key check and aborts if anything points nowhere. The answers table has no children, which makes it the safe one to rebuild.

Version 2 also rewrites each frozen event snapshot from the old shape, a bare answer index field, to the new shape with a type and an answer object. That way runtime code only ever reads one shape. It also fills in each old attempt's deadline from its start time and the event's duration. Version 3 patches four questions in snapshots, but only where the snapshot still holds the known-bad version. Submitted scores are left alone.

Before migrating a database that already holds data, the runner copies it with SQLite's "vacuum into" command to a file named after the target and source versions and a timestamp. Rolling back in production means stopping the container and swapping files.

The tests use a real fixture. Before any code changed, the original main-branch server was run and driven through a join, an attempt and a submission, and the resulting database was dumped to backend/test/fixtures/v1-app.sql. The migration test loads that dump and upgrades it. It then checks that the row counts survive (one user, two events, 25 snapshot rows, two attempts, 20 answers), that Ada's 16 out of 90 is intact, and that the legacy teacher password still logs in. Another test compares every table's columns and every index name between the migrated database and a freshly created one, and they must be identical. That catches drift, where a fresh install and an upgraded install quietly end up with different schemas.

## Why this choice, and what the alternatives were

The user_version approach needs no migrations table and no dependency, and it is about a hundred lines. It suits SQLite, where one process owns the file. Tools like Knex migrations or Umzug keep a table of applied migration names, support down migrations and work across Postgres and MySQL. That is worth having when the planned Postgres move happens. Until then they add a dependency and a second source of truth.

Object-relational mappers that "auto-sync" the schema from model definitions are fast to start with, but they guess at renames and can drop columns. Nobody should accept that risk on a volume holding real students' results.

The migrations have no down steps. Writing a reverse for a table rebuild is error-prone, and the automatic backup is the rollback plan.

The weak spot is parallel branches. Two branches that each add migration 4 will both look valid alone. Whoever merges second must renumber, and the consecutive-version check at load time turns a missed renumber into a startup error rather than a silent skip.

## Glossary

Migration: a numbered, one-way change to the database schema or data.
PRAGMA: an SQLite command that reads or sets a database setting, here user_version.
Transaction: a group of changes that commit together or not at all.
Foreign key: a column that must point at an existing row in another table.
Cascade delete: deleting a parent row automatically deletes its children.
Schema drift: fresh and upgraded databases ending up with different structures.
Fixture: saved test data, here a dump of a real version 1 database.
