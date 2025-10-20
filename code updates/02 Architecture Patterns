# Maintenance Agent - Architecture Patterns & Best Practices

## Error Recovery Pattern

### Idempotent Jobs
All jobs must be safely retryable without causing duplicate work.

```javascript
// ✅ CORRECT - Check before creating
const exists = await db.tasks.taskExists(hash);
if (!exists) {
  await db.tasks.queueTask(task);
}

// ❌ WRONG - Could create duplicates
await db.tasks.queueTask(task);
```

### Retry Strategy
```javascript
// Track in maintenance_agent_memory
{
  processing_status: 'failed',
  retry_count: 3,
  last_retry_at: '2025-10-19T12:00:00Z',
  next_retry_at: '2025-10-19T12:30:00Z', // Exponential backoff
  failure_reason: 'API timeout'
}
```

### Exponential Backoff
- 1st retry: 5 minutes
- 2nd retry: 15 minutes
- 3rd retry: 1 hour
- 4th retry: 6 hours
- 5th retry: Move to dead letter queue

### Dead Letter Queue
After 5 failed attempts, mark as `permanently_failed` and alert admin.

---

## Rate Limiting Strategy

### OpenAI API Limits
```javascript
// src/repositories/openai.repository.js
import { RateLimiter } from 'limiter';

const rateLimiter = new RateLimiter({
  tokensPerInterval: 50,
  interval: 'minute',
  fireImmediately: true
});

// Before each API call
await rateLimiter.removeTokens(1);
```

### Limits by Service
- **OpenAI**: 50 requests/minute, 1000/day
- **Web Search**: 10 requests/minute
- **Pinecone**: 100 requests/second

### Circuit Breaker Pattern
If 5 consecutive failures, stop calling service for 5 minutes.

---

## Batch Processing Strategy

### Why Small Batches?
- `AGENT_BATCH_SIZE=5` prevents timeouts
- Allows graceful shutdown between batches
- Reduces memory usage
- Better error isolation

### Processing Order
```javascript
// Process each system completely before moving to next
for (const system of batch) {
  try {
    await processSystem(system); // Full pipeline
    await markCompleted(system);
  } catch (error) {
    await markFailed(system);
    // Continue with next system
  }
}
```

### Graceful Shutdown
```javascript
// Check between systems
for (const system of batch) {
  if (isShuttingDown) {
    logger.info('Graceful shutdown requested');
    break;
  }
  await processSystem(system);
}
```

---

## State Machine Pattern

### Processing States
```
         ┌──────────┐
         │   new    │
         └────┬─────┘
              ↓
      ┌───────────────┐
      │  in_progress  │
      └───┬───────┬───┘
          ↓       ↓
   ┌──────────┐ ┌────────┐
   │completed │ │ failed │
   └──────────┘ └────┬───┘
                     ↓
               ┌─────────────┐
               │retry_pending│
               └─────┬───────┘
                     ↓
              [back to in_progress]
                     or
              ┌──────────────────┐
              │permanently_failed│
              └──────────────────┘
```

### Valid Transitions
```javascript
const validTransitions = {
  'new': ['in_progress'],
  'in_progress': ['completed', 'failed'],
  'failed': ['retry_pending', 'permanently_failed'],
  'retry_pending': ['in_progress'],
  'completed': [], // Terminal state
  'permanently_failed': [] // Terminal state
};
```

### Processing Stages (within in_progress)
1. `extraction` - Pulling from manuals
2. `discovery` - Real-world search
3. `inference` - Dependency analysis
4. `deduplication` - Removing duplicates
5. `queueing` - Adding to review queue
6. `completed` - All done

---

## Database Migration Strategy

### Migration Structure
```
migrations/
├── agent/                    # Agent-only migrations
│   ├── 001_create_memory_table.sql
│   └── 002_add_retry_columns.sql
├── shared/                   # Coordinate with main system
│   └── 001_add_system_flags.sql
└── README.md
```

### Migration Rules

#### Agent-Specific Tables
- Migrate independently
- No coordination needed
- Use timestamp prefixes: `20251019_add_column.sql`

#### Shared Tables (systems, documents)
- **READ-ONLY from agent perspective**
- Never modify schema from agent
- If changes needed, request from main system team
- Document required fields in README

### Migration Process
```bash
# Development
npm run migrate:dev

# Staging (test first!)
npm run migrate:staging

# Production (after staging verification)
npm run migrate:prod
```

### Rollback Strategy
Every migration must have a rollback:
```sql
-- migrate up
ALTER TABLE maintenance_agent_memory
ADD COLUMN retry_count INTEGER DEFAULT 0;

-- migrate down
ALTER TABLE maintenance_agent_memory
DROP COLUMN retry_count;
```

---

## Monitoring & Alerting

### Key Metrics
```javascript
// Track these in memory table
{
  systems_processed_today: 145,
  tasks_discovered_today: 892,
  average_processing_time: 2.3, // seconds
  failure_rate: 0.02, // 2%
  api_calls_remaining: {
    openai: 850,
    pinecone: 99999
  }
}
```

### Alert Thresholds
- Failure rate > 10%
- Queue size > 1000 tasks
- No systems processed in 2 hours
- API rate limit < 10% remaining

### Health Check Endpoint
```javascript
// Future: GET /health
{
  status: 'healthy',
  uptime: 3600,
  lastProcessed: '2025-10-19T12:00:00Z',
  queueSize: 42,
  connections: {
    supabase: 'connected',
    pinecone: 'connected',
    openai: 'connected'
  }
}
```

---

## Security Considerations

### API Keys
- Rotate every 90 days
- Never log API keys
- Use separate keys for dev/staging/prod

### Database Access
- Service account with minimal permissions
- Read-only on shared tables
- Full access only on agent tables

### Audit Logging
```javascript
// Log all state changes
{
  event: 'task_approved',
  user: 'admin@example.com',
  taskId: '123',
  timestamp: '2025-10-19T12:00:00Z',
  changes: { status: ['pending', 'approved'] }
}
```

---

## Performance Optimization

### Caching Strategy
```javascript
// Cache system data for 1 hour
const systemCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
```

### Database Query Optimization
- Use indexes on frequently queried columns
- Batch inserts when possible
- Connection pooling configured

### Memory Management
- Process streams instead of loading all data
- Clear caches periodically
- Monitor heap usage

---

## Testing Strategy

### Unit Tests
- Test each service method independently
- Mock repository layer
- Focus on business logic

### Integration Tests
- Test service → repository flow
- Use test database
- Clean up after each test

### End-to-End Tests
- Test full system processing pipeline
- Include retry logic
- Verify state transitions