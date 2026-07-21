do $$
declare
  lecture_id uuid;
begin
  lecture_id := public.admin_create_lecture(
    'Phase 7.26 upgrade preservation probe',
    '79a1c962332b60e014c52f692e439ba667583452ced5743bd7bdae005852d8b5',
    '726200',
    null,
    null
  );

  perform public.admin_set_lecture_status(lecture_id, 'start', null);

  perform public.admin_register_pdf_document(
    lecture_id,
    'upgrade-probe-doc',
    repeat('b', 64),
    1,
    'Upgrade Probe PDF',
    1,
    1024,
    100,
    repeat('b', 64),
    repeat('c', 64),
    true
  );
end;
$$;
