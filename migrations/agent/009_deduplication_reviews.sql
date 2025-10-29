-- Deduplication Review System
-- Persistent storage for duplicate task analysis and human review workflow

-- ==============================================================================
-- Table: deduplication_analyses
-- Tracks each time the deduplication analysis script runs
-- ==============================================================================
CREATE TABLE IF NOT EXISTS deduplication_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Analysis metadata
  analysis_date TIMESTAMPTZ NOT NULL,
  total_tasks INTEGER NOT NULL,
  duplicate_pairs_found INTEGER NOT NULL,
  duplicate_groups_found INTEGER DEFAULT 0,

  -- Analysis configuration
  thresholds JSONB NOT NULL, -- { semantic: { min, highConfidence }, frequency: { tight, medium, loose } }
  filters JSONB, -- { systemFilter: string, assetUidFilter: string }

  -- Audit
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_dedup_analysis_date ON deduplication_analyses(analysis_date DESC);
CREATE INDEX idx_dedup_analysis_created ON deduplication_analyses(created_at DESC);

-- Comments
COMMENT ON TABLE deduplication_analyses IS 'Tracks each deduplication analysis run';
COMMENT ON COLUMN deduplication_analyses.analysis_date IS 'When the analysis was performed';
COMMENT ON COLUMN deduplication_analyses.thresholds IS 'Similarity thresholds used for this analysis';
COMMENT ON COLUMN deduplication_analyses.filters IS 'System/asset filters applied';

-- ==============================================================================
-- Table: deduplication_reviews
-- Stores individual duplicate pairs for human review
-- ==============================================================================
CREATE TABLE IF NOT EXISTS deduplication_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to analysis run
  analysis_id UUID NOT NULL REFERENCES deduplication_analyses(id) ON DELETE CASCADE,

  -- Task pair identifiers
  task1_id TEXT NOT NULL,
  task1_description TEXT NOT NULL,
  task1_metadata JSONB NOT NULL, -- Full task object from Pinecone

  task2_id TEXT NOT NULL,
  task2_description TEXT NOT NULL,
  task2_metadata JSONB NOT NULL, -- Full task object from Pinecone

  -- Similarity metrics
  similarity_score DECIMAL(5,4) NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  match_reason TEXT NOT NULL, -- semantic_and_frequency_match, high_confidence_semantic_match, etc.
  warning TEXT, -- frequency_mismatch, etc.

  -- Review workflow
  review_status TEXT DEFAULT 'pending' CHECK (
    review_status IN (
      'pending',       -- Not yet reviewed
      'keep_both',     -- Decided to keep both tasks (not duplicates)
      'merge',         -- Merge into single task
      'delete_task1',  -- Delete first task, keep second
      'delete_task2',  -- Delete second task, keep first
      'delete_both',   -- Delete both tasks (both are garbage/invalid)
      'dismissed'      -- Low confidence, ignore this pair
    )
  ),
  reviewed_by TEXT, -- User who made the decision
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT, -- Optional notes about the decision

  -- Execution tracking
  executed BOOLEAN DEFAULT false, -- Whether decision has been committed to Pinecone
  executed_at TIMESTAMPTZ, -- When the decision was executed
  execution_error TEXT, -- Any error during execution

  -- Audit
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  -- Prevent duplicate entries for same pair (either order)
  CONSTRAINT unique_task_pair UNIQUE (analysis_id, task1_id, task2_id)
);

-- Indexes for efficient queries
CREATE INDEX idx_dedup_reviews_analysis ON deduplication_reviews(analysis_id);
CREATE INDEX idx_dedup_reviews_status ON deduplication_reviews(review_status);
CREATE INDEX idx_dedup_reviews_similarity ON deduplication_reviews(similarity_score DESC);
CREATE INDEX idx_dedup_reviews_task1 ON deduplication_reviews(task1_id);
CREATE INDEX idx_dedup_reviews_task2 ON deduplication_reviews(task2_id);
CREATE INDEX idx_dedup_reviews_pending ON deduplication_reviews(review_status) WHERE review_status = 'pending';

-- Trigger for updated_at
CREATE TRIGGER update_dedup_reviews_updated_at
  BEFORE UPDATE ON deduplication_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE deduplication_reviews IS 'Duplicate task pairs awaiting human review';
COMMENT ON COLUMN deduplication_reviews.analysis_id IS 'Links to the analysis run that found this pair';
COMMENT ON COLUMN deduplication_reviews.task1_metadata IS 'Full Pinecone task object (description, frequency, etc)';
COMMENT ON COLUMN deduplication_reviews.task2_metadata IS 'Full Pinecone task object (description, frequency, etc)';
COMMENT ON COLUMN deduplication_reviews.similarity_score IS 'Cosine similarity score (0-1)';
COMMENT ON COLUMN deduplication_reviews.match_reason IS 'Why these were flagged as duplicates';
COMMENT ON COLUMN deduplication_reviews.review_status IS 'Human decision on how to handle this pair';

-- ==============================================================================
-- View: Pending Reviews Summary
-- Quick access to reviews needing attention
-- ==============================================================================
CREATE OR REPLACE VIEW deduplication_pending_reviews AS
SELECT
  r.id,
  r.analysis_id,
  a.analysis_date,
  r.task1_id,
  r.task1_description,
  r.task2_id,
  r.task2_description,
  r.similarity_score,
  r.match_reason,
  r.warning,
  r.created_at,
  -- Extract key metadata
  r.task1_metadata->>'system_name' AS task1_system,
  r.task1_metadata->>'frequency_hours' AS task1_frequency,
  r.task2_metadata->>'system_name' AS task2_system,
  r.task2_metadata->>'frequency_hours' AS task2_frequency
FROM deduplication_reviews r
JOIN deduplication_analyses a ON r.analysis_id = a.id
WHERE r.review_status = 'pending'
ORDER BY r.similarity_score DESC, r.created_at DESC;

COMMENT ON VIEW deduplication_pending_reviews IS 'All pending duplicate reviews with key metadata';

-- ==============================================================================
-- Grant Permissions
-- ==============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON deduplication_analyses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON deduplication_analyses TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON deduplication_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON deduplication_reviews TO service_role;

GRANT SELECT ON deduplication_pending_reviews TO authenticated;
GRANT SELECT ON deduplication_pending_reviews TO service_role;
