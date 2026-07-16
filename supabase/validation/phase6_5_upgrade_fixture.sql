SET search_path = public, extensions;

CREATE TABLE public.phase6_5_upgrade_fixture (
  lecture_id uuid PRIMARY KEY,
  participant_id uuid,
  comment_id uuid,
  comments_version bigint
);
GRANT SELECT, INSERT, UPDATE ON public.phase6_5_upgrade_fixture TO service_role, authenticated;

SET ROLE service_role;
INSERT INTO public.phase6_5_upgrade_fixture (lecture_id)
VALUES (
  public.admin_create_lecture(
    'Phase 6.5 upgrade fixture',
    encode(extensions.digest(convert_to('P65-UPGRADE', 'UTF8'), 'sha256'), 'hex'),
    'P65-UPGRADE', null, null
  )
);
SELECT public.admin_set_lecture_status(
  (SELECT lecture_id FROM public.phase6_5_upgrade_fixture),
  'start',
  null
);

RESET ROLE;
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '56500000-0000-4000-8000-000000000001',
  false
);
UPDATE public.phase6_5_upgrade_fixture
SET participant_id = (
  SELECT participant_id FROM public.join_lecture_by_code('P65-UPGRADE')
);
WITH inserted AS (
  INSERT INTO public.comments (lecture_session_id, participant_id, body)
  SELECT lecture_id, participant_id, 'Pre-Phase 6.5 anonymous comment'
  FROM public.phase6_5_upgrade_fixture
  RETURNING id
)
UPDATE public.phase6_5_upgrade_fixture AS fixture
SET comment_id = inserted.id
FROM inserted;

RESET ROLE;
SET ROLE service_role;
UPDATE public.phase6_5_upgrade_fixture AS fixture
SET comments_version = live.comments_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
RESET ROLE;
