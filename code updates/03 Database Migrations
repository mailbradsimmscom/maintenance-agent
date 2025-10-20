# Database Migrations

## Structure

```
migrations/
├── agent/      # Agent-specific tables (we control these)
│   └── *.sql   # Can be modified freely
└── shared/     # Tables shared with main system
    └── *.sql   # COORDINATION REQUIRED - Read-only from agent
```

## Migration Rules

### Agent Tables (We Control)
- `maintenance_agent_memory`
- `maintenance_tasks_queue`
- Any future agent-specific tables

**Process:**
1. Create migration file with timestamp: `YYYYMMDD_description.sql`
2. Test on development database
3. Apply to staging
4. Apply to production after verification

### Shared Tables (Read-Only)
- `systems`
- `documents`
- `document_chunks`

**⚠️ NEVER MODIFY THESE FROM AGENT**

If you need schema changes to shared tables:
1. Document the required change
2. Request from main system team
3. Wait for their migration
4. Update agent code after migration is complete

## Running Migrations

### Development
```bash
# Manual execution for now
psql $DATABASE_URL < migrations/agent/001_add_retry_columns.sql
```

### Future: Migration Tool
```bash
npm run migrate:up       # Apply all pending migrations
npm run migrate:down     # Rollback last migration
npm run migrate:status   # Show migration status
```

## Migration Template

```sql
-- Migration: [Description]
-- Date: [YYYY-MM-DD]
-- Author: [Name/Team]

-- UP Migration
ALTER TABLE table_name
ADD COLUMN column_name TYPE;

-- DOWN Migration (Rollback)
-- ALTER TABLE table_name
-- DROP COLUMN column_name;
```

## Testing Checklist

Before applying any migration:

- [ ] Test on local development database
- [ ] Verify rollback works
- [ ] Check for data loss risks
- [ ] Test with existing data
- [ ] Verify indexes are appropriate
- [ ] Document any app code changes needed

## Coordination with Main System

When the main system changes shared tables:

1. They notify us of pending changes
2. We review impact on agent
3. We prepare agent code changes
4. They deploy migration
5. We deploy updated agent code
6. We verify everything works

## Emergency Rollback

If a migration causes issues:

1. Stop the agent immediately
2. Run the DOWN migration
3. Restart with previous code version
4. Investigate and fix
5. Re-attempt migration

## Migration History

| Date | Migration | Status | Notes |
|------|-----------|--------|-------|
| 2025-10-19 | 001_add_retry_columns.sql | Pending | Add retry tracking |

## Required Fields from Shared Tables

Document what we need from shared tables:

### systems
- asset_uid (PRIMARY KEY)
- description
- manufacturer_norm
- model_norm
- system_norm
- subsystem_norm

### documents
- doc_id (PRIMARY KEY)
- asset_uid (FOREIGN KEY)
- storage_path
- manufacturer
- model

### document_chunks
- chunk_id (PRIMARY KEY)
- doc_id (FOREIGN KEY)
- text
- metadata
- chunk_index