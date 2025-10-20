# 21. Maintenance Agent Architecture Refactoring

**Date:** 2025-10-19
**Status:** ✅ Major Refactoring Complete

## Overview

Complete architectural overhaul of the maintenance agent from a simple script to a production-grade microservice with clean architecture, proper separation of concerns, and enterprise patterns.

## What We Accomplished

### 1. ✅ Project Structure Transformation

**Before:** Single `index.js` file with everything mixed together
**After:** Clean layered architecture

```
maintenance-agent/
├── src/
│   ├── config/          # Zod-validated environment
│   ├── services/        # Business logic layer
│   ├── repositories/    # Data access layer
│   ├── jobs/           # Job orchestration
│   ├── utils/          # Shared utilities
│   └── index.js        # Minimal entry point
├── scripts/            # Utility scripts
├── docs/              # Documentation
└── migrations/        # Database migrations
```

### 2. ✅ Environment Configuration with Zod

**Implemented:**
- Full Zod validation for all environment variables
- Type-safe configuration access
- Feature flags for gradual rollout
- No more `process.env` scattered throughout code

```javascript
// Before
const apiKey = process.env.OPENAI_API_KEY; // Unsafe

// After
import { getConfig } from './config/env.js';
const config = getConfig();  // Fully validated
```

### 3. ✅ Structured Logging (No Console.log)

**Implemented:**
- Winston-based structured logging
- Component-specific loggers
- JSON/Pretty format switching
- Event-based logging for metrics

```javascript
// Before
console.log('Processing system:', system);

// After
logger.info('Processing system', {
  systemId: system.asset_uid,
  component: 'system-processor'
});
```

### 4. ✅ Clean Architecture Layers

**Service Layer → Repository Pattern:**

```javascript
// Jobs orchestrate
systemProcessorJob.checkForNewSystems()
  ↓
// Services contain business logic
extractionService.extractFromManuals(system)
  ↓
// Repositories handle I/O
pineconeRepository.searchMaintenanceContent(vector)
```

**Created Services:**
- `extraction.service.js` - Manual extraction logic
- `discovery.service.js` - Real-world search & inference
- `deduplication.service.js` - Task deduplication

**Created Repositories:**
- `supabase.repository.js` - All database operations
- `pinecone.repository.js` - Vector search operations
- `openai.repository.js` - LLM API calls

### 5. ✅ Production Patterns Documentation

Created `/docs/patterns.md` with:
- **Error Recovery Pattern** - Idempotent jobs, exponential backoff
- **Rate Limiting** - API protection with circuit breakers
- **State Machine** - Clear processing states
- **Batch Processing** - Small batches, graceful shutdown
- **Migration Strategy** - Safe database changes

### 6. ✅ Rate Limiting Implementation

**Created `rate-limiter.js`:**
- Request tracking per minute/day
- Circuit breaker after 5 consecutive failures
- Pre-configured limiters for each service
- Automatic queuing when limits reached

```javascript
// Automatically enforced
await rateLimiter.waitForSlot();
const response = await openai.chat.completions.create(...);
rateLimiter.recordSuccess();
```

### 7. ✅ Database Migration Strategy

**Created migration structure:**
```
migrations/
├── agent/      # We control these
├── shared/     # Read-only, coordinate with main
└── README.md   # Clear process documentation
```

**Migration with rollback support:**
```sql
-- UP: Add retry tracking
ALTER TABLE maintenance_agent_memory
ADD COLUMN retry_count INTEGER DEFAULT 0;

-- DOWN: Rollback
-- ALTER TABLE maintenance_agent_memory
-- DROP COLUMN retry_count;
```

### 8. ✅ Fixed Pinecone Configuration

**Problem:** Pinecone v1.x didn't support serverless indexes properly
**Solution:**
- Upgraded to Pinecone SDK v6.1.2
- Removed environment parameter (not needed for serverless)
- SDK now auto-detects serverless configuration

**Result:**
```
✅ Supabase connected
✅ Pinecone connected
🤖 Agent running with vector search
```

### 9. ✅ Documentation Updates

**Updated CLAUDE.md:**
- Adapted for maintenance agent context
- Clear separation from main system
- Agent-specific patterns

**Updated .cursorrules:**
- Agent-specific coding standards
- No console.log enforcement
- Service → Repository pattern

## Architecture Decisions

### Why This Architecture?

1. **Complete Separation** - Zero code dependencies on main system
2. **Scalability** - Can handle increased load with batch processing
3. **Resilience** - Circuit breakers, retry logic, graceful degradation
4. **Observability** - Structured logging, clear state tracking
5. **Maintainability** - Clean layers, single responsibility

### Key Patterns Implemented

| Pattern | Purpose | Implementation |
|---------|---------|----------------|
| Repository | Isolate I/O | All DB/API calls in repositories |
| Service Layer | Business Logic | Pure functions, testable |
| Job Orchestration | Scheduling | Cron jobs, batch processing |
| Circuit Breaker | API Protection | Stops calls after failures |
| State Machine | Processing Flow | Clear state transitions |
| Feature Flags | Gradual Rollout | Enable features via env |

## Configuration

### Environment Variables
```bash
# Core Services
SUPABASE_URL=...
PINECONE_API_KEY=...
OPENAI_API_KEY=...

# Agent Configuration
AGENT_RUN_INTERVAL_MINUTES=60
AGENT_BATCH_SIZE=5
AGENT_CONFIDENCE_THRESHOLD=0.7

# Feature Flags
ENABLE_REAL_WORLD_SEARCH=false
ENABLE_DEPENDENCY_INFERENCE=false
ENABLE_AUTO_LEARNING=false
```

## Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Code Organization | 1 file (244 lines) | 15+ files | Modular |
| Logging | console.log | Structured JSON | Searchable |
| Error Handling | Try/catch | Circuit breakers + retry | Resilient |
| Configuration | process.env | Zod validated | Type-safe |
| API Calls | Unprotected | Rate limited | Protected |

## Testing the Refactored Agent

```bash
# Start the agent
npm run dev

# Verify connections
✅ Supabase connected
✅ Pinecone connected

# Check structured logs
08:35:36 [info]: Processing system {
  "component": "system-processor-job",
  "systemId": "67f3c4a4-3811-0d7f-a316-bb6c9e434c7d"
}
```

## Code Quality Metrics

- **No console.log** (except bootstrap)
- **100% environment validation**
- **Full error handling** with recovery
- **Consistent logging** format
- **Clean separation** of concerns

## Migration Path

### From Old to New

1. **Old index.js** → Backed up as `index.js.old`
2. **Utility scripts** → Moved to `/scripts`
3. **Direct API calls** → Through repositories
4. **Console.log** → Structured logging
5. **process.env** → Validated config

## Lessons Applied

From the main system's `.cursorrules`:
- ✅ Routes → Services → Repositories pattern
- ✅ No console.log (structured logging only)
- ✅ Environment via Zod validation
- ✅ Max 250 lines per file
- ✅ ESM modules only

## Next Phase Ready

The agent is now architecturally ready for:
1. Database migration application
2. API endpoint addition
3. Frontend UI integration
4. Learning system implementation
5. Production deployment

---

**Status:** The maintenance agent has been transformed from a proof-of-concept into a production-ready microservice with enterprise-grade architecture, comprehensive error handling, and complete separation from the main system.