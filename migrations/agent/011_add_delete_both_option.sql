-- Add 'delete_both' option to review_status
-- This allows marking both tasks as garbage/invalid

-- Drop the old constraint
ALTER TABLE deduplication_reviews
DROP CONSTRAINT IF EXISTS deduplication_reviews_review_status_check;

-- Add new constraint with delete_both option
ALTER TABLE deduplication_reviews
ADD CONSTRAINT deduplication_reviews_review_status_check
CHECK (review_status IN (
  'pending',
  'keep_both',
  'merge',
  'delete_task1',
  'delete_task2',
  'delete_both'
));

-- Add comment
COMMENT ON COLUMN deduplication_reviews.review_status IS 'pending=not reviewed, keep_both=not duplicates, delete_task1=delete first, delete_task2=delete second, delete_both=both are garbage, merge=combine into one';
