-- Add execution tracking to deduplication_reviews
-- This allows us to track which decisions have been committed to Pinecone

ALTER TABLE deduplication_reviews
ADD COLUMN executed BOOLEAN DEFAULT false,
ADD COLUMN executed_at TIMESTAMPTZ,
ADD COLUMN execution_error TEXT;

-- Create index for finding unexecuted reviews
CREATE INDEX idx_dedup_reviews_unexecuted ON deduplication_reviews(review_status, executed)
WHERE executed = false AND review_status != 'pending';

-- Add comment
COMMENT ON COLUMN deduplication_reviews.executed IS 'Whether the decision has been committed to Pinecone';
COMMENT ON COLUMN deduplication_reviews.executed_at IS 'When the decision was executed';
COMMENT ON COLUMN deduplication_reviews.execution_error IS 'Error message if execution failed';
