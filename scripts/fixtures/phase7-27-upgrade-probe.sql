do $$
declare
  lecture_id uuid;
  poll_id uuid;
begin
  lecture_id := public.admin_create_lecture_v2(
    'Phase 7.27 upgrade preservation probe',
    encode(
      extensions.digest(convert_to('727260', 'UTF8'), 'sha256'),
      'hex'
    ),
    '727260',
    null,
    null
  );

  poll_id := public.admin_create_poll(
    lecture_id,
    'Existing Phase 7.26 Poll remains isolated?',
    'single',
    array['Yes', 'No']
  );

  perform public.admin_register_pdf_document(
    lecture_id,
    'phase727-upgrade-probe-doc',
    repeat('b', 64),
    1,
    'Phase 7.27 Upgrade Probe PDF',
    1,
    1024,
    100,
    repeat('b', 64),
    repeat('c', 64),
    true
  );
end;
$$;
