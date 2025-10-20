-- Migration: Create temp table for Pinecone results analysis
-- Date: 2025-10-19
-- Purpose: Store raw Pinecone search results to analyze score distribution

-- UP Migration
CREATE TABLE IF NOT EXISTS pinecone_search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_uid UUID NOT NULL,
  system_name TEXT,
  manufacturer TEXT,
  model TEXT,
  chunk_id TEXT NOT NULL,
  doc_id TEXT,
  relevance_score DECIMAL(5,4) NOT NULL,
  section_title TEXT,
  content_snippet TEXT,
  has_lists BOOLEAN,
  has_tables BOOLEAN,
  page_start INTEGER,
  page_end INTEGER,
  chunk_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX idx_pinecone_results_asset ON pinecone_search_results(asset_uid);
CREATE INDEX idx_pinecone_results_score ON pinecone_search_results(relevance_score DESC);
CREATE INDEX idx_pinecone_results_created ON pinecone_search_results(created_at DESC);

-- DOWN Migration (Rollback)
-- DROP TABLE IF EXISTS pinecone_search_results;