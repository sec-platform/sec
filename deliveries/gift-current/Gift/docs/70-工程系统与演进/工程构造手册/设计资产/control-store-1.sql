-- Gift control store: physical design 1, not a deployed product database.
-- Run only for an explicitly new empty store after verifying root ownership.
-- Existing stores require the migration/readback algorithm in chapter 09.
PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  root_id TEXT PRIMARY KEY NOT NULL,
  physical_revision INTEGER NOT NULL CHECK (typeof(physical_revision)='integer' AND physical_revision = 1),
  root_identity BLOB NOT NULL CHECK(typeof(root_identity)='blob'),
  revision TEXT NOT NULL COLLATE BINARY CHECK(typeof(revision)='text' AND length(CAST(revision AS BLOB))=length(revision)),
  desired TEXT,
  observed TEXT,
  observed_revision TEXT NOT NULL COLLATE BINARY CHECK(typeof(observed_revision)='text' AND length(CAST(observed_revision AS BLOB))=length(observed_revision)),
  active TEXT,
  fence TEXT NOT NULL COLLATE BINARY CHECK(typeof(fence)='text' AND length(CAST(fence AS BLOB))=length(fence)),
  managed BLOB NOT NULL CHECK(typeof(managed)='blob'),
  CHECK (revision='0' OR (length(revision) BETWEEN 1 AND 20 AND substr(revision,1,1) BETWEEN '1' AND '9' AND revision NOT GLOB '*[^0-9]*' AND (length(revision)<20 OR revision<='18446744073709551615'))),
  CHECK (observed_revision='0' OR (length(observed_revision) BETWEEN 1 AND 20 AND substr(observed_revision,1,1) BETWEEN '1' AND '9' AND observed_revision NOT GLOB '*[^0-9]*' AND (length(observed_revision)<20 OR observed_revision<='18446744073709551615'))),
  CHECK (fence='0' OR (length(fence) BETWEEN 1 AND 20 AND substr(fence,1,1) BETWEEN '1' AND '9' AND fence NOT GLOB '*[^0-9]*' AND (length(fence)<20 OR fence<='18446744073709551615'))),
  CHECK (observed IS NOT NULL OR observed_revision='0'),
  FOREIGN KEY(root_id,desired) REFERENCES generations(root_id,generation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(root_id,observed) REFERENCES generations(root_id,generation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(root_id,active) REFERENCES operations(root_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE generations (
  root_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  capsule_codec TEXT NOT NULL,
  capsule BLOB NOT NULL CHECK(typeof(capsule)='blob'),
  digest_algorithm TEXT NOT NULL CHECK(digest_algorithm='sha256'),
  capsule_digest BLOB NOT NULL CHECK(typeof(capsule_digest)='blob' AND length(capsule_digest)=32),
  source_basis BLOB NOT NULL CHECK(typeof(source_basis)='blob'),
  target_basis BLOB NOT NULL CHECK(typeof(target_basis)='blob'),
  PRIMARY KEY(root_id,generation_id),
  FOREIGN KEY(root_id) REFERENCES meta(root_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE operations (
  root_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('workspace','external')),
  intent_codec TEXT NOT NULL,
  intent BLOB NOT NULL CHECK(typeof(intent)='blob'),
  intent_digest BLOB NOT NULL CHECK(typeof(intent_digest)='blob' AND length(intent_digest)=32),
  expected_revision TEXT NOT NULL COLLATE BINARY CHECK(typeof(expected_revision)='text' AND length(CAST(expected_revision AS BLOB))=length(expected_revision)),
  desired_generation TEXT,
  prior_head BLOB CHECK(prior_head IS NULL OR typeof(prior_head)='blob'),
  phase TEXT NOT NULL CHECK(phase IN ('prepared','admitted','applying','recovery-required','applied','aborted','rolled-back','dispatch-intent','outcome-unknown','confirmed','not-applied','compensating','compensated')),
  direction TEXT NOT NULL CHECK(direction IN ('forward','rollback','compensate')),
  admitted_revision TEXT COLLATE BINARY CHECK(admitted_revision IS NULL OR (typeof(admitted_revision)='text' AND length(CAST(admitted_revision AS BLOB))=length(admitted_revision))),
  admitted_fence TEXT COLLATE BINARY CHECK(admitted_fence IS NULL OR (typeof(admitted_fence)='text' AND length(CAST(admitted_fence AS BLOB))=length(admitted_fence))),
  authorization_observation BLOB NOT NULL CHECK(typeof(authorization_observation)='blob'),
  budget_state BLOB NOT NULL CHECK(typeof(budget_state)='blob'),
  reservations BLOB NOT NULL CHECK(typeof(reservations)='blob'),
  PRIMARY KEY(root_id,operation_id),
  CHECK(expected_revision='0' OR (length(expected_revision) BETWEEN 1 AND 20 AND substr(expected_revision,1,1) BETWEEN '1' AND '9' AND expected_revision NOT GLOB '*[^0-9]*' AND (length(expected_revision)<20 OR expected_revision<='18446744073709551615'))),
  CHECK(admitted_revision IS NULL OR admitted_revision='0' OR (length(admitted_revision) BETWEEN 1 AND 20 AND substr(admitted_revision,1,1) BETWEEN '1' AND '9' AND admitted_revision NOT GLOB '*[^0-9]*' AND (length(admitted_revision)<20 OR admitted_revision<='18446744073709551615'))),
  CHECK(admitted_fence IS NULL OR admitted_fence='0' OR (length(admitted_fence) BETWEEN 1 AND 20 AND substr(admitted_fence,1,1) BETWEEN '1' AND '9' AND admitted_fence NOT GLOB '*[^0-9]*' AND (length(admitted_fence)<20 OR admitted_fence<='18446744073709551615'))),
  CHECK ((kind='workspace' AND desired_generation IS NOT NULL AND direction IN ('forward','rollback') AND phase IN ('prepared','admitted','applying','recovery-required','applied','aborted','rolled-back')) OR
         (kind='external' AND desired_generation IS NULL AND direction IN ('forward','compensate') AND phase IN ('prepared','admitted','dispatch-intent','outcome-unknown','confirmed','not-applied','aborted','compensating','compensated'))),
  FOREIGN KEY(root_id) REFERENCES meta(root_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(root_id,desired_generation) REFERENCES generations(root_id,generation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX one_active_workspace_operation ON operations(root_id)
 WHERE kind='workspace' AND phase IN ('admitted','applying','recovery-required');
CREATE INDEX operation_recovery ON operations(root_id,kind,phase);
CREATE TABLE files (
  root_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  path_key TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('read','replace','delete')),
  before_exists INTEGER NOT NULL CHECK(before_exists IN (0,1)),
  before_bytes BLOB CHECK(before_bytes IS NULL OR typeof(before_bytes)='blob'),
  before_digest BLOB CHECK(before_digest IS NULL OR typeof(before_digest)='blob'),
  before_mode INTEGER,
  after_exists INTEGER NOT NULL CHECK(after_exists IN (0,1)),
  after_bytes BLOB CHECK(after_bytes IS NULL OR typeof(after_bytes)='blob'),
  after_digest BLOB CHECK(after_digest IS NULL OR typeof(after_digest)='blob'),
  after_mode INTEGER,
  last_observation BLOB CHECK(last_observation IS NULL OR typeof(last_observation)='blob'),
  PRIMARY KEY(root_id,operation_id,path_key),
  CHECK((before_exists=0 AND before_bytes IS NULL AND before_digest IS NULL AND before_mode IS NULL) OR
        (before_exists=1 AND before_bytes IS NOT NULL AND before_digest IS NOT NULL AND length(before_digest)=32 AND before_mode IS NOT NULL)),
  CHECK((after_exists=0 AND after_bytes IS NULL AND after_digest IS NULL AND after_mode IS NULL) OR
        (after_exists=1 AND after_bytes IS NOT NULL AND after_digest IS NOT NULL AND length(after_digest)=32 AND after_mode IS NOT NULL)),
  CHECK(action!='replace' OR after_exists=1),
  CHECK(action!='delete' OR (before_exists=1 AND after_exists=0)),
  CHECK(action!='read' OR (before_exists=after_exists AND before_bytes IS after_bytes AND before_digest IS after_digest AND before_mode IS after_mode)),
  FOREIGN KEY(root_id,operation_id) REFERENCES operations(root_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE events (
  root_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL CHECK(typeof(event_seq)='integer' AND event_seq >= 0),
  kind TEXT NOT NULL,
  payload_codec TEXT NOT NULL,
  payload BLOB NOT NULL CHECK(typeof(payload)='blob'),
  clock_observation BLOB CHECK(clock_observation IS NULL OR typeof(clock_observation)='blob'),
  PRIMARY KEY(root_id,operation_id,event_seq),
  FOREIGN KEY(root_id,operation_id) REFERENCES operations(root_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
