-- Migration: Add 'type' and 'search_terms' columns to test table
-- Date: 2025-10-20

ALTER TABLE pinecone_search_results_test
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'generic'
CHECK (type IN ('generic', 'LLM'));

ALTER TABLE pinecone_search_results_test
ADD COLUMN IF NOT EXISTS search_terms TEXT;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'pinecone_search_results_test'
  AND column_name IN ('search_terms', 'type');
