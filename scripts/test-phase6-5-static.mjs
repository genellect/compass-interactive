import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [
  env,
  flags,
  migration,
  commentRepository,
  liveRepository,
  demoRepository,
  commentInput,
  commentCard,
] = await Promise.all([
  read('.env.local.example'),
  read('src/lib/featureFlags.ts'),
  read('supabase/migrations/20260716062858_phase6_5_optional_comment_nicknames.sql'),
  read('src/repositories/supabaseCommentRepository.ts'),
  read('src/repositories/supabaseLiveStateRepository.ts'),
  read('src/demo/demoRepository.ts'),
  read('src/components/LiveBoard/CommentInput.tsx'),
  read('src/components/LiveBoard/CommentCard.tsx'),
])

assert.match(env, /^VITE_PHASE6_5_COMMENT_NICKNAMES=false$/m)
assert.match(flags, /isPhase1SyncProtocolEnabled\s*&&\s*\n\s*import\.meta\.env\.VITE_PHASE6_5_COMMENT_NICKNAMES === 'true'/)
assert.match(migration, /alter table public\.comments\s+add column nickname text/)
assert.match(migration, /nickname is null/)
assert.match(migration, /char_length\(nickname\) between 1 and 10/)
assert.doesNotMatch(migration, /create table .*nickname|create table .*profile/i)
assert.doesNotMatch(migration, /alter publication .* add table/i)
assert.match(migration, /security definer[\s\S]*set search_path = ''/)
assert.match(migration, /get_lecture_public_snapshot_v2_phase65_core/)
assert.match(migration, /get_lecture_comment_history_v2_phase65_core/)
assert.match(migration, /get_lecture_archive_v2_phase65_core/)
assert.match(commentRepository, /\.from\('comments'\)[\s\S]*\.insert\(\{/)
assert.match(commentRepository, /nickname: normalizedNickname/)
assert.doesNotMatch(commentRepository, /\.update\(|\.channel\(|postgres_changes/)
assert.match(liveRepository, /nickname: isPhase65CommentNicknamesEnabled/)
assert.doesNotMatch(
  demoRepository,
  /supabase\s*\.\s*from\(|fetch\(|\.rpc\(|createClient|ensureAnonymousAuthSession/i,
)
assert.match(commentInput, /useState\(false\)/)
assert.doesNotMatch(commentInput, /デフォルト：匿名の参加者/)
assert.match(commentInput, /10文字以内で入力してください/)
assert.match(commentInput, /このデモ画面の中だけで使われます/)
assert.match(commentCard, /comment\.nickname \? 'has-nickname' : ''/)

console.log('Phase 6.5 nickname static security and integration checks passed.')
