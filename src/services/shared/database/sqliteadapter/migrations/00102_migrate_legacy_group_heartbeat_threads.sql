-- +goose Up
DROP TABLE IF EXISTS heartbeat_thread_targets;

CREATE TEMP TABLE heartbeat_thread_targets (
    legacy_id   TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    target_rank INTEGER NOT NULL
);

INSERT INTO heartbeat_thread_targets (legacy_id, thread_id, target_rank)
WITH target_persona AS (
    SELECT
        id,
        account_id,
        persona_key,
        row_number() OVER (
            PARTITION BY account_id, persona_key
            ORDER BY created_at DESC, id DESC
        ) AS persona_rank
      FROM personas
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
       AND tp.persona_rank = 1
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
)
SELECT legacy_id, thread_id, target_rank
  FROM candidate_targets;

DELETE FROM scheduled_triggers
 WHERE id IN (
     SELECT legacy_id
       FROM heartbeat_thread_targets
      WHERE target_rank > 1
 );

DELETE FROM scheduled_triggers
 WHERE id IN (
     SELECT target.legacy_id
       FROM heartbeat_thread_targets AS target
      WHERE target.target_rank = 1
        AND EXISTS (
            SELECT 1
              FROM scheduled_triggers AS existing
             WHERE existing.thread_id = target.thread_id
               AND existing.id <> target.legacy_id
        )
 );

UPDATE scheduled_triggers
   SET thread_id = (
           SELECT thread_id
             FROM heartbeat_thread_targets
            WHERE legacy_id = scheduled_triggers.id
       ),
       updated_at = datetime('now')
 WHERE id IN (
       SELECT legacy_id
         FROM heartbeat_thread_targets
        WHERE target_rank = 1
   )
   AND NOT EXISTS (
       SELECT 1
         FROM scheduled_triggers AS existing
        WHERE existing.thread_id = (
              SELECT thread_id
                FROM heartbeat_thread_targets
               WHERE legacy_id = scheduled_triggers.id
          )
          AND existing.id <> scheduled_triggers.id
   );

DROP TABLE heartbeat_thread_targets;

-- +goose Down
SELECT 1;
