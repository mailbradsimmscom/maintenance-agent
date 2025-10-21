-- Migration: Add 'type' column to pinecone_search_results
-- Date: 2025-10-20
-- Purpose: Distinguish between generic search and LLM-powered search

ALTER TABLE pinecone_search_results
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'generic'
CHECK (type IN ('generic', 'LLM'));

-- Add index for filtering by type
CREATE INDEX IF NOT EXISTS idx_pinecone_search_results_type
ON pinecone_search_results(type);

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'pinecone_search_results'
  AND column_name = 'type';
