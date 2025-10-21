-- Migration: Add 'search_terms' column to pinecone_search_results
-- Date: 2025-10-20
-- Purpose: Store the search terms used for LLM-powered searches

ALTER TABLE pinecone_search_results
ADD COLUMN IF NOT EXISTS search_terms TEXT;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'pinecone_search_results'
  AND column_name IN ('search_terms', 'type');
