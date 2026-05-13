-- +goose Up
WITH target_persona AS (
    SELECT DISTINCT ON (account_id, persona_key)
           id,
           account_id,
           persona_key
      FROM personas
     WHERE deleted_at IS NULL
     ORDER BY account_id, persona_key, created_at DESC, id DESC
),
candidate_targets AS (
    SELECT
        legacy.id AS legacy_id,
        cgt.thread_id,
        row_number() OVER (
            PARTITION BY cgt.thread_id
            ORDER BY legacy.updated_at DESC, legacy.created_at DESC, legacy.id
        ) AS target_rank
      FROM scheduled_triggers AS legacy
      JOIN channel_identities AS ci
        ON ci.id = legacy.channel_identity_id
      JOIN target_persona AS tp
        ON tp.account_id = legacy.account_id
       AND tp.persona_key = legacy.persona_key
      JOIN channel_group_threads AS cgt
        ON cgt.channel_id = legacy.channel_id
       AND cgt.platform_chat_id = ci.platform_subject_id
       AND cgt.persona_id = tp.id
      JOIN threads AS t
        ON t.id = cgt.thread_id
     WHERE legacy.thread_id IS NULL
       AND legacy.job_id IS NULL
       AND legacy.trigger_kind = 'heartbeat'
       AND t.account_id = legacy.account_id
       AND t.deleted_at IS NULL
),
delete_duplicate_legacy AS (
    DELETE FROM scheduled_triggers AS legacy
     USING candidate_targets AS target
     WHERE legacy.id = target.legacy_id
       AND target.target_rank > 1
     RETURNING legacy.id
),
delete_conflicting_legacy AS (
    DELETE FROM scheduled_triggers AS legacy
     USING candidate_targets AS target,
           scheduled_triggers AS existing
     WHERE legacy.id = target.legacy_id
       AND target.target_rank = 1
       AND existing.thread_id = target.thread_id
       AND existing.id <> legacy.id
     RETURNING legacy.id
)
UPDATE scheduled_triggers AS legacy
   SET thread_id = target.thread_id,
       updated_at = now()
  FROM candidate_targets AS target
 WHERE legacy.id = target.legacy_id
   AND target.target_rank = 1
   AND NOT EXISTS (
       SELECT 1
         FROM scheduled_triggers AS existing
        WHERE existing.thread_id = target.thread_id
          AND existing.id <> legacy.id
   );

-- +goose Down
SELECT 1;
