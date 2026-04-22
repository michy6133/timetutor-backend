-- Migration 002 — Ajout du rôle teacher dans users
-- Supprime l'ancienne contrainte et la recrée avec 'teacher' inclus

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','director','teacher'));
