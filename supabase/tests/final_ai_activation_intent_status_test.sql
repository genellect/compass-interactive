BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT results_eq(
  $$
    SELECT
      operation_key,
      edge_function,
      action_name,
      access_scope,
      lecture_state,
      gate_mode,
      operation_class,
      lecture_lock_mode,
      instructor_requires_ai,
      owner_requires_ai,
      request_binding_required,
      control_step_up_action
    FROM private.admin_google_operation_policies
    WHERE operation_key = 'manage-ai-activation-intent.status'
  $$,
  $$
    VALUES (
      'manage-ai-activation-intent.status'::text,
      'manage-ai-activation-intent'::text,
      'status'::text,
      'owned_lecture'::text,
      'retained'::text,
      'gate_independent'::text,
      'read'::text,
      'share'::text,
      false,
      false,
      false,
      null::text
    )
  $$,
  'activation-intent status remains an owned, gate-independent read after close'
);

SELECT results_eq(
  $$
    SELECT operation_key, lecture_state
    FROM private.admin_google_operation_policies
    WHERE operation_key IN (
      'manage-ai-activation-intent.arm',
      'manage-ai-activation-intent.cancel',
      'manage-ai-activation-intent.consume'
    )
    ORDER BY operation_key
  $$,
  $$
    VALUES
      ('manage-ai-activation-intent.arm'::text, 'draft'::text),
      ('manage-ai-activation-intent.cancel'::text, 'draft_or_open'::text),
      ('manage-ai-activation-intent.consume'::text, 'draft_or_open'::text)
  $$,
  'the status correction does not widen activation-intent mutations'
);

SELECT has_trigger(
  'private',
  'admin_google_operation_policies',
  'admin_google_operation_policies_immutable',
  'the closed operation-policy inventory is immutable after the correction'
);

SELECT * FROM finish();
ROLLBACK;
