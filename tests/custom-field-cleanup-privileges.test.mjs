import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

const canonical = read('supabase/migrations/20260921200000_contact_custom_fields.sql')
const hardening = read('supabase/migrations/20260922130000_revoke_custom_field_cleanup_execute.sql')

test('cleanup_custom_field_values es una función SECURITY DEFINER privada y sigue conectada al trigger', () => {
  assert.match(canonical, /CREATE OR REPLACE FUNCTION public\.cleanup_custom_field_values\(\)[\s\S]*RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/)
  assert.match(canonical, /CREATE TRIGGER trg_cleanup_custom_field_values[\s\S]*EXECUTE FUNCTION public\.cleanup_custom_field_values\(\)/)
})

test('la migración posterior revoca EXECUTE sin eliminar el trigger', () => {
  assert.match(hardening, /REVOKE EXECUTE ON FUNCTION public\.cleanup_custom_field_values\(\) FROM PUBLIC;/)
  assert.match(hardening, /REVOKE EXECUTE ON FUNCTION public\.cleanup_custom_field_values\(\) FROM anon;/)
  assert.match(hardening, /REVOKE EXECUTE ON FUNCTION public\.cleanup_custom_field_values\(\) FROM authenticated;/)
  assert.doesNotMatch(hardening, /DROP TRIGGER|DROP FUNCTION|GRANT EXECUTE/)
})
