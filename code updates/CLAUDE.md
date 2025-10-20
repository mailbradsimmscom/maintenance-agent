# Claude Code Quick Reference - Maintenance Agent

**Project:** REIMAGINEDAPPV2 Maintenance Agent - Autonomous Maintenance Discovery System
**Last Updated:** 2025-10-19
**Status:** 🚧 Development

---

## Context: What We're Building

This is the **Maintenance Agent** - an autonomous microservice that discovers and tracks maintenance requirements for marine systems on catamarans.

**Mission:** Ensure nothing on the vessel fails due to unknown or forgotten maintenance.

**Key Capabilities:**
- **Extract**: Find maintenance tasks in existing documentation (manuals, PDFs)
- **Discover**: Proactively hunt for maintenance not in any manual
- **Infer**: Identify hidden dependencies (e.g., AC needs sea strainer cleaning)
- **Learn**: Improve recommendations based on user feedback per system
- **Queue**: Present tasks for human review and approval

**Relationship to Main System:**
- This is a **completely separate microservice** from the main REIMAGINEDAPPV2 system
- Shares only database access (Supabase, Pinecone)
- No direct code dependencies
- Communicates through database tables only
- Designed for cloud deployment (Render → AWS)

---

## 🚨 CRITICAL RULES (Read First, Every Session)

### Rule #1: No Code Changes Without Approval
**NEVER write, edit, or modify code without explicit user approval.**

Same as main system - small changes can have cascading effects.

### Rule #2: Maintain Separation from Main System
**This agent must remain independent.**

- ✅ Share database connections only
- ✅ Use similar patterns but independent code
- ❌ Don't import from main system
- ❌ Don't create tight coupling

### Rule #3: Agent-First Architecture
**This is a background worker, not an API server.**

- Primary mode: Autonomous processing via cron jobs
- Secondary: API endpoints for task approval (future)
- Focus on job orchestration, not request handling

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Maintenance Agent (This Service)                   │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │ Cron Jobs    │  │ Job Processor│                │
│  └──────────────┘  └──────────────┘                │
│          ↓                 ↓                         │
│  ┌──────────────────────────────────────┐          │
│  │  Services (Business Logic)           │          │
│  │  - extraction.service.js              │          │
│  │  - discovery.service.js               │          │
│  │  - deduplication.service.js           │          │
│  └──────────────────────────────────────┘          │
│                      ↓                              │
│  ┌──────────────────────────────────────┐          │
│  │  Repositories (I/O Layer)            │          │
│  │  - supabase.repository.js            │          │
│  │  - pinecone.repository.js            │          │
│  │  - openai.repository.js              │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
                          ↓
        Database Integration (No Code Deps)
                          ↓
┌─────────────────────────────────────────────────────┐
│  Shared Infrastructure                              │
│  - Supabase (PostgreSQL)                            │
│  - Pinecone (Vector DB)                             │
│  - OpenAI API                                       │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│  Main REIMAGINEDAPPV2 System                        │
│  (Separate codebase at /REIMAGINEDAPPV2)            │
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
maintenance-agent/
├── src/
│   ├── config/
│   │   └── env.js              # Zod-validated environment
│   ├── services/
│   │   ├── extraction.service.js    # Manual extraction
│   │   ├── discovery.service.js     # Real-world search
│   │   └── deduplication.service.js # Task deduplication
│   ├── repositories/
│   │   ├── supabase.repository.js   # Database operations
│   │   ├── pinecone.repository.js   # Vector search
│   │   └── openai.repository.js     # LLM operations
│   ├── jobs/
│   │   ├── system-processor.job.js  # Main processing
│   │   └── scheduler.job.js         # Cron management
│   ├── utils/
│   │   └── logger.js            # Structured logging
│   └── index.js                 # Entry point
├── scripts/
│   └── check-schema.js         # Database utilities
├── docs/
├── package.json
├── CLAUDE.md                    # This file
└── .cursorrules                 # Coding standards
```

---

## Key Patterns

### 1. Service → Repository Pattern
```javascript
// Services contain business logic
// Repositories handle all I/O

// ✅ CORRECT
services/extraction.service.js → repositories/pinecone.repository.js

// ❌ WRONG
jobs/processor.job.js → Direct API calls
```

### 2. No Console.log
```javascript
// ✅ CORRECT
import { createLogger } from './utils/logger.js';
const logger = createLogger('component-name');
logger.info('Processing', { data });

// ❌ WRONG
console.log('Processing', data);
```

### 3. Environment via Zod
```javascript
// ✅ CORRECT
import { getConfig } from './config/env.js';
const config = getConfig();

// ❌ WRONG
process.env.OPENAI_API_KEY
```

### 4. Feature Flags
```javascript
// Control features via environment
ENABLE_REAL_WORLD_SEARCH=true
ENABLE_DEPENDENCY_INFERENCE=true
ENABLE_AUTO_LEARNING=false
```

---

## Database Tables

### Agent-Specific Tables
- **maintenance_agent_memory**: Processing state and learning patterns
- **maintenance_tasks_queue**: Tasks pending review

### Shared Tables (Read from Main System)
- **systems**: Equipment/systems to process
- **documents**: Manuals and documentation
- **document_chunks**: Vectorized content

---

## Common Commands

### Development
```bash
# Start agent (with file watching)
npm run dev

# Start agent (production mode)
npm start

# Check database schema
node scripts/check-schema.js
```

### Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Required variables:
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
PINECONE_API_KEY=
OPENAI_API_KEY=
ADMIN_TOKEN=

# Agent configuration:
AGENT_RUN_INTERVAL_MINUTES=60
AGENT_BATCH_SIZE=5
AGENT_CONFIDENCE_THRESHOLD=0.7

# Feature flags:
ENABLE_REAL_WORLD_SEARCH=false
ENABLE_DEPENDENCY_INFERENCE=false
```

### Testing Connections
```bash
# The agent tests connections on startup
npm run dev
# Look for:
# ✅ Supabase connected
# ✅ Pinecone connected
```

---

## Processing Pipeline

```
1. Cron job triggers system check
    ↓
2. Get unprocessed systems from database
    ↓
3. For each system:
    a. Extract from manuals (Pinecone + LLM)
    b. Search real-world knowledge (LLM)
    c. Infer dependencies (LLM)
    ↓
4. Deduplicate tasks
    ↓
5. Score confidence
    ↓
6. Queue for human review
    ↓
7. Update agent memory
```

---

## Current Implementation Status

### ✅ Completed
- Project structure and organization
- Environment configuration with Zod
- Structured logging (no console.log)
- Repository layer (Supabase, Pinecone, OpenAI)
- Service layer (extraction, discovery, deduplication)
- Job orchestration (system processor, scheduler)
- Cron job management

### 🚧 In Progress
- Testing with real data
- Approval workflow API

### 📋 TODO
- Frontend UI for task review
- Learning system implementation
- Render deployment configuration
- Integration tests
- Monitoring and alerting

---

## Complexity Management

### Why This Is Complex
1. **Autonomous Operation**: Always running, not request-driven
2. **Multi-Source Integration**: Manuals + LLM knowledge + inference
3. **Stateful Processing**: Must track what's been processed
4. **Learning System**: Adapts based on user feedback
5. **Continuous Discovery**: Always hunting for new maintenance

### Risk Mitigation
- Start with manual extraction only
- Add features incrementally via flags
- Comprehensive logging for debugging
- Database-only integration (no code coupling)
- Clear source attribution for trust

---

## Quick Debugging

### Check Agent Status
```javascript
// Look at logs
tail -f maintenance-agent.log  // When we add file logging

// Check database
SELECT * FROM maintenance_agent_memory
WHERE processing_status = 'failed';

SELECT COUNT(*) FROM maintenance_tasks_queue
WHERE status = 'pending';
```

### Common Issues
1. **"No systems to process"**: Check if systems exist in database
2. **"No vectors in Pinecone"**: Documents not vectorized yet
3. **Low confidence scores**: Adjust AGENT_CONFIDENCE_THRESHOLD
4. **Features not working**: Check ENABLE_* flags in .env

---

## Important Notes

### Before Production
1. Set up proper error alerting
2. Configure Render deployment
3. Add monitoring for queue size
4. Implement approval UI
5. Test with production data subset
6. Implement rate limiting for APIs
7. Set up database migration strategy

### Separation from Main System
- This agent has its **own repository** (future)
- **Own deployment** pipeline
- **Own monitoring** and logs
- Shares only database access

### Database Coordination
- **Agent tables**: Migrate independently
- **Shared tables**: Never modify from agent (read-only)
- **Schema changes**: Coordinate with main system team
- **Migration testing**: Always test on dev/staging first

---

## Additional Documentation

- **Architecture Patterns**: `/docs/patterns.md` - Error recovery, rate limiting, state machine
- **Main System Docs**: `/REIMAGINEDAPPV2/CLAUDE.md`

---

**⚠️ IMPORTANT: See `/docs/patterns.md` for critical patterns including error recovery, rate limiting, and state machine design**