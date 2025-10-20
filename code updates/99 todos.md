# Outstanding TODOs - Maintenance Agent

**Last Updated:** 2025-10-19
**After Session:** Architecture Refactoring

## 🔴 Immediate Priority (Blocking)

### 1. Apply Database Migration
**Status:** Migration created, needs execution
**File:** `/migrations/agent/001_add_retry_columns.sql`
**Action Required:**
```bash
# Apply to Supabase
psql $DATABASE_URL < migrations/agent/001_add_retry_columns.sql
```
**Columns to Add:**
- `retry_count` - Track retry attempts
- `last_retry_at` - When last retried
- `next_retry_at` - When to retry next
- `last_error` - Error message storage
- `tasks_queued` - Count of queued tasks

**Why Critical:** Agent is failing to save state without these columns

---

## 🟡 High Priority (Core Functionality)

### 2. Create Approval Workflow API
**Status:** Not started
**Requirements:**
- REST endpoints for task review
- Authentication with admin token
- CRUD operations for maintenance tasks
- Approval/rejection tracking

**Suggested Endpoints:**
```
GET  /api/tasks/pending     - List pending tasks
POST /api/tasks/:id/approve - Approve a task
POST /api/tasks/:id/reject  - Reject a task
GET  /api/tasks/approved    - List approved tasks
```

### 3. Enable Feature Flags
**Status:** Implemented but disabled
**Action:** Test and enable in `.env`:
```bash
ENABLE_REAL_WORLD_SEARCH=true    # LLM-based discovery
ENABLE_DEPENDENCY_INFERENCE=true  # Find hidden dependencies
ENABLE_AUTO_LEARNING=false       # Keep off until approval API ready
```

---

## 🟢 Medium Priority (User Interface)

### 4. Build Frontend UI
**Status:** Not started
**Components Needed:**
- Task review dashboard
- Approval/rejection interface
- System overview page
- Task statistics view

**Tech Stack Suggestion:**
- Vanilla JS (match main system)
- Or React if separate deployment

### 5. Implement Learning System
**Status:** Structure ready, logic not implemented
**Requirements:**
- Track approval/rejection patterns per system
- Adjust confidence scores based on feedback
- Store patterns in `maintenance_agent_memory`
- Implement feedback loop

**Key Functions to Implement:**
```javascript
learningService.recordApproval(taskId, systemId)
learningService.recordRejection(taskId, systemId, reason)
learningService.adjustConfidence(pattern)
```

---

## 🔵 Low Priority (Deployment)

### 6. Configure Render Deployment
**Status:** Not started
**Requirements:**
- `render.yaml` configuration
- Environment variable setup
- Health check endpoint
- Monitoring setup

**Deployment Checklist:**
- [ ] Create Render account
- [ ] Set up environment variables
- [ ] Configure build command
- [ ] Set up cron job triggers
- [ ] Add error alerting

### 7. Add Health Check Endpoint
**Status:** Not implemented
**Purpose:** Monitoring and uptime checks
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connections: {
      supabase: supabaseStatus,
      pinecone: pineconeStatus
    },
    lastRun: lastSystemCheck
  });
});
```

---

## 📝 Documentation TODOs

### 8. Create API Documentation
- Document approval workflow endpoints
- Add example requests/responses
- Authentication requirements
- Rate limits

### 9. Create Deployment Guide
- Step-by-step Render setup
- Environment variable configuration
- Migration execution process
- Rollback procedures

### 10. Add Integration Tests
- Test full processing pipeline
- Mock external services
- Verify state transitions
- Test retry logic

---

## 🐛 Known Issues to Fix

### 11. Systems Showing "undefined" Name
**Fixed in code** but needs testing after migration
**Solution:** Already implemented in `system-processor.job.js`

### 12. Add Namespace Filtering
**Issue:** Not using PINECONE_NAMESPACE from env
**Fix Location:** `pinecone.repository.js`
```javascript
const queryResponse = await idx.namespace(config.pinecone.namespace).query({
  vector: queryVector,
  topK,
  filter
});
```

---

## 🚀 Future Enhancements

### 13. Real-time Updates
- WebSocket for live task updates
- Push notifications for critical maintenance
- Real-time approval notifications

### 14. SignalK Integration
- Connect to boat's data network
- Real-time sensor data
- Condition-based maintenance triggers

### 15. Inventory Management
- Track parts inventory
- Auto-order when low
- Link tasks to required parts

### 16. Calendar Integration
- Schedule maintenance tasks
- Conflict detection
- Reminder system

---

## Session Accomplishments Summary

✅ **Completed (11 items):**
1. Project structure setup
2. Zod environment validation
3. Structured logging
4. Service/Repository layers
5. Core services implementation
6. Documentation updates
7. Pattern documentation
8. Rate limiting
9. Migration strategy
10. Pinecone configuration fix
11. Architecture refactoring

⏳ **Pending (16 items):**
- 1 Immediate (database migration)
- 3 High Priority (API, features, learning)
- 2 Medium Priority (UI, learning logic)
- 2 Low Priority (deployment)
- 4 Documentation
- 2 Bug fixes
- 4 Future enhancements

---

## Next Session Priority Order

1. **Apply database migration** (5 minutes)
2. **Test with feature flags enabled** (10 minutes)
3. **Create basic approval API** (1 hour)
4. **Test full pipeline with real data** (30 minutes)

---

**Note:** The agent architecture is solid and production-ready. Focus should shift to making it usable (API + UI) and deployable (Render config).