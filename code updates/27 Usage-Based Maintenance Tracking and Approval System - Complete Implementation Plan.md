# Session 27: Usage-Based Maintenance Tracking + Approval System

**Date:** 2025-10-22
**Session Duration:** Extended Planning Session
**Status:** 🚧 PLANNING COMPLETE - READY FOR IMPLEMENTATION
**Version:** 2.0 (Includes Approval System Integration)

---

## 📋 SESSION SUMMARY

### **What We Built Today:**
1. Fixed 5 state management bugs in `maintenance-tasks-list.html`
2. Enhanced `delete-tasks-by-category.js` to accept `--asset-uid` filter
3. Designed complete architecture for usage-based maintenance tracking
4. Integrated approval workflow into existing system
5. Created comprehensive 8-phase implementation plan

### **Critical Outcome:**
- **APPROVED PLAN:** 7-8 day implementation
- **4 new database tables**
- **8 new API endpoints**
- **Zero breaking changes** to existing system
- **Render-ready** autonomous agent design

---

## 🎯 EXECUTIVE SUMMARY

### **Problem Statement:**
Current system extracts maintenance tasks from manuals but:
- ❌ No tracking of system operating hours
- ❌ No way to know when usage-based tasks are due
- ❌ No completion tracking (tasks don't "roll" after completion)
- ❌ No way to distinguish one-time vs recurring tasks
- ❌ No explicit approval workflow (approval is implicit)
- ❌ No autonomous prompts to update hours

### **Solution:**
Build TWO complementary systems:

**1. Operational Tracking System**
- Track current operating hours per system
- Record task completions (with hour meter readings)
- Calculate next due dates for recurring tasks
- BoatOS autonomous prompts (every 7 days) to update hours
- User To-Do lists (current + upcoming tasks)

**2. Approval System**
- Explicit approval workflow for extracted tasks
- Review status tracking (pending/approved)
- Bulk approval capabilities
- Integrated into existing maintenance-tasks-list.html
- BoatOS tasks only created for approved tasks

---

## 🗂️ CONVERSATION CONTEXT

### **How We Got Here:**

#### **Part 1: Bug Fixes (maintenance-tasks-list.html)**
User reported: "the page is not working correctly"

**Issues Found:**
1. Filters didn't update timeline view
2. Timeline ignored user-selected filters
3. Modal save didn't refresh table view
4. Save/delete operations reset active filters
5. No view synchronization

**Fixed:** All 5 bugs by:
- Making `applyFilters()` view-aware
- Making `loadTasks()` re-apply filters after fetch
- Removing redundant render calls
- Making timeline respect `filteredTasks` state

#### **Part 2: Script Enhancement**
User needed: "delete tasks by category for specific asset only"

**Enhanced:** `delete-tasks-by-category.js`
- Added `--asset-uid` parameter
- Filters by category AND asset (optional)
- Shows affected systems in preview

**Example:**
```bash
node scripts/delete-tasks-by-category.js \
  --categories "VAGUE" \
  --asset-uid "6747bcaf-5c31-e12f-8947-37fce290ab47"
```

Ran successfully: Deleted 42 VAGUE tasks for Yanmar diesel engine

#### **Part 3: Usage-Based Tracking Discussion**
User asked: "let's talk about usage based tasks"

**Key Insight:** Two types of usage tasks:
1. **Recurring:** "Change oil every 50 hours" (repeats forever)
2. **One-time:** "Check valves after first 50 hours" (happens once)

**Problem:** Current system doesn't distinguish, can't track completions, can't calculate next due

**Requirements Identified:**
- Track system state (current hours, installation date)
- Record completions
- Calculate next due for recurring
- Hide one-time tasks after completion
- Prompt users to update hours regularly

#### **Part 4: Approval System Discovery**
User observation: "there is no concept of an 'approved task'"

**Current Reality:**
- Tasks uploaded directly to Pinecone
- If it exists = implicitly approved
- If deleted = implicitly rejected
- `maintenance_tasks_queue` table exists but unused
- `maintenance.route.js` has approve/reject endpoints but nothing uses them

**Decision:** Add explicit approval to Pinecone metadata (Option 1)
- Simplest approach
- Single source of truth
- No workflow changes
- Backward compatible

#### **Part 5: Detailed Planning**
Following CLAUDE.md Rule #2: "Very Detailed Planning to Avoid Regression"

Created comprehensive plan covering:
- Database schema (4 new tables)
- API design (8 endpoints)
- Data flows (4 complete workflows)
- Risk analysis (6 major risks identified)
- Implementation phases (8 phases, 7-8 days)
- Render deployment strategy
- Testing scenarios (6 end-to-end scenarios)

---

## 🏗️ ARCHITECTURE DESIGN

### **Design Principles:**

1. **Separation of Concerns**
   - Main System (Express) ← Supabase → Maintenance Agent (Render)
   - No code dependencies between systems
   - Database-only communication

2. **Layered Architecture**
   - Routes → Services → Repositories (STRICT)
   - No route→repository violations
   - Business logic in services only

3. **Backward Compatibility**
   - Zero changes to existing `systems` table
   - New tables with FK CASCADE
   - Old Pinecone tasks work as-is (default values)

4. **Marine Environment**
   - 200+ interconnected systems
   - Small changes = cascading effects
   - Incorrect advice = dangerous/expensive

5. **Render Deployment**
   - Stateless operation
   - Autonomous (cron jobs)
   - Database-only state
   - Structured logging to stdout

---

## 📊 DATABASE SCHEMA

### **New Tables (4 total):**

#### **1. system_maintenance**
**Purpose:** Current operational state per system

```sql
CREATE TABLE system_maintenance (
  asset_uid UUID PRIMARY KEY
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  current_operating_hours INTEGER NOT NULL DEFAULT 0
    CHECK (current_operating_hours >= 0),
  installation_date TIMESTAMPTZ,
  last_hours_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_maintenance_hours
  ON system_maintenance(current_operating_hours);
CREATE INDEX idx_system_maintenance_updated
  ON system_maintenance(last_hours_update);

COMMENT ON TABLE system_maintenance IS
  'Current operational state for systems with usage-based maintenance';
COMMENT ON COLUMN system_maintenance.installation_date IS
  'Auto-set on first hours entry if NULL';
```

**Key Behaviors:**
- One row per system (not all systems, only those with usage-based tasks)
- `installation_date` auto-set on first hours update if NULL
- `last_hours_update` tracks staleness for BoatOS prompts
- Updated every time user enters hours

**Consumers:**
- Hours update API (validation, update)
- BoatOS task checker (determines if prompt needed)
- System Card UI (displays current state)

---

#### **2. system_hours_history**
**Purpose:** Complete audit trail of all hour meter readings

```sql
CREATE TABLE system_hours_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  hours INTEGER NOT NULL CHECK (hours >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by TEXT NOT NULL DEFAULT 'user',
  notes TEXT,
  meter_replaced BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hours_history_asset
  ON system_hours_history(asset_uid, submitted_at DESC);
CREATE INDEX idx_hours_history_submitted
  ON system_hours_history(submitted_at DESC);

COMMENT ON TABLE system_hours_history IS
  'Audit trail of all hour meter readings with validation support';
COMMENT ON COLUMN system_hours_history.meter_replaced IS
  'TRUE allows lower reading than previous (with required note)';
```

**Key Behaviors:**
- Insert-only (never update/delete) for audit integrity
- Every hours update creates new row
- `meter_replaced` flag allows lower reading (with required note)
- Multiple updates per day allowed
- Used for validation (fetch last entry to compare)

**Validation Logic:**
```javascript
// Fetch last entry
const lastEntry = await getLatestHours(assetUid);

// Validate new entry
if (newHours < lastEntry.hours && !meterReplaced) {
  throw new Error(`Hours cannot decrease (last: ${lastEntry.hours})`);
}

if (meterReplaced && !notes) {
  throw new Error('Note required when meter replaced');
}

// Valid - insert
await insertHistory({ asset_uid, hours: newHours, meter_replaced, notes });
```

**Consumers:**
- Hours update API (validation)
- System Card (history display)
- Analytics/trends (future)
- Warranty compliance (audit trail)

---

#### **3. boatos_tasks**
**Purpose:** System-generated prompts for user actions

```sql
CREATE TABLE boatos_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL DEFAULT 'update_usage_hours'
    CHECK (task_type IN ('update_usage_hours')),
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  frequency_days INTEGER NOT NULL DEFAULT 7 CHECK (frequency_days > 0),
  last_completed TIMESTAMPTZ,
  next_due TIMESTAMPTZ NOT NULL,
  last_dismissed TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_boatos_tasks_unique_active
  ON boatos_tasks(asset_uid, task_type)
  WHERE is_active = TRUE;

CREATE INDEX idx_boatos_tasks_asset
  ON boatos_tasks(asset_uid) WHERE is_active = TRUE;
CREATE INDEX idx_boatos_tasks_next_due
  ON boatos_tasks(next_due) WHERE is_active = TRUE;

COMMENT ON TABLE boatos_tasks IS
  'System-generated prompts for user actions (autonomous BoatOS tasks)';
COMMENT ON COLUMN boatos_tasks.task_type IS
  'Current: update_usage_hours. Future: check_spares, seasonal_checks';
```

**Key Behaviors:**
- **Auto-created** by extraction script when system has approved usage tasks
- **7-day cycle** (configurable via frequency_days)
- **Independent per system** (staggered, not synchronized)
- **Dismissible** but re-prompts next day if still overdue
- **Completed** when user updates hours → next_due = NOW() + 7 days

**Lifecycle:**
```
Created (next_due = NOW() + 7 days)
    ↓
7 days pass
    ↓
Appears in To-Do list (next_due <= NOW())
    ↓
User dismisses → last_dismissed = NOW()
    ↓
Disappears from To-Do
    ↓
Tomorrow: Reappears (still overdue, last_dismissed < yesterday)
    ↓
User updates hours → last_completed = NOW(), next_due = NOW() + 7 days
    ↓
Disappears from To-Do
    ↓
7 days later: Cycle repeats
```

**Consumers:**
- To-Do API (getDueTasks)
- Extraction script (creates if not exists)
- Hours update API (marks complete)

---

#### **4. task_completions**
**Purpose:** History of task completions for recurring scheduling

```sql
CREATE TABLE task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hours_at_completion INTEGER CHECK (hours_at_completion >= 0),
  completed_by TEXT NOT NULL DEFAULT 'user',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_completions_task
  ON task_completions(task_id, completed_at DESC);
CREATE INDEX idx_task_completions_asset
  ON task_completions(asset_uid, completed_at DESC);

COMMENT ON TABLE task_completions IS
  'History of maintenance task completions for scheduling recurring tasks';
COMMENT ON COLUMN task_completions.hours_at_completion IS
  'Hour meter reading when completed (NULL for calendar-based tasks)';
```

**Key Behaviors:**
- **Insert-only** (audit trail)
- **task_id** matches Pinecone task ID (e.g., "task-1761081...")
- **hours_at_completion** NULL for calendar-based tasks
- Multiple completions per task (recurring tasks)
- Used to calculate next due date

**Next Due Calculation:**
```javascript
// For recurring tasks
const lastCompletion = await getLatestForTask(taskId, assetUid);

if (task.frequency_basis === 'usage') {
  // Usage-based: hours
  const nextDueHours = lastCompletion.hours_at_completion + task.frequency_value;
  return { next_due_hours: nextDueHours };

} else if (task.frequency_basis === 'calendar') {
  // Calendar-based: date
  const nextDueDate = addTime(lastCompletion.completed_at, task.frequency_value, task.frequency_type);
  return { next_due_date: nextDueDate };
}
```

**Consumers:**
- Task completion API (inserts)
- Timeline view (calculates due status)
- Task Card (shows history)

---

## 🔧 PINECONE METADATA CHANGES

### **Namespace:** `MAINTENANCE_TASKS`

### **New Fields:**

```javascript
metadata: {
  // EXISTING FIELDS (unchanged)
  description: "Change engine oil",
  frequency_value: 50,
  frequency_type: "hours",
  frequency_basis: "usage",
  task_type: "fluid_replacement",
  criticality: "important",
  confidence: 0.9,
  system_name: "57 hp diesel engine (PORT)",
  asset_uid: "6747bcaf-5c31-e12f-8947-37fce290ab47",
  source: "manual",

  // NEW: Task Type Classification
  is_recurring: true,  // false for "first 50 hours" tasks

  // NEW: Approval Workflow
  review_status: "pending",  // "pending" | "approved"
  reviewed_at: "2025-10-22T19:45:00Z",
  reviewed_by: "user",
  review_notes: "Looks correct",

  // NEW: Completion Tracking (updated on completion)
  last_completed_at: "2025-10-22T20:00:00Z",
  last_completed_hours: 275,
  next_due_hours: 325,  // For usage-based
  next_due_date: "2026-01-22",  // For calendar-based
  is_completed: false  // true for one-time tasks after completion
}
```

### **Backward Compatibility:**

**Old tasks without new fields:**
- `is_recurring`: Default to `true` (safe assumption)
- `review_status`: Default to `"approved"` (existing tasks assumed approved)
- Other new fields: `null` or omitted

**No migration needed** - queries handle missing fields gracefully

---

### **Detection Logic for `is_recurring`:**

**In extraction script:**
```javascript
function detectIsRecurring(description, frequency_value) {
  // Keywords indicating one-time tasks
  const oneTimeKeywords = [
    'first', 'initial', 'break-in', 'commissioning',
    'after installation', 'new engine', 'startup',
    'break in', 'initially', 'during commissioning'
  ];

  const descLower = description.toLowerCase();
  const hasOneTimeKeyword = oneTimeKeywords.some(kw => descLower.includes(kw));

  // If has one-time keyword → not recurring
  if (hasOneTimeKeyword) return false;

  // If has frequency → assume recurring
  if (frequency_value && frequency_value > 0) return true;

  // Default: recurring (safer assumption)
  return true;
}
```

**Examples:**
- ✅ "Check valve clearance after first 50 hours" → `is_recurring: false`
- ✅ "Change oil every 50 hours" → `is_recurring: true`
- ✅ "Adjust propeller shaft during break-in period" → `is_recurring: false`
- ✅ "Inspect belt every 100 hours" → `is_recurring: true`

---

## 🌐 API ENDPOINTS

### **A. System Hours Management**

#### **POST /admin/api/system-maintenance/hours**
**Purpose:** Update system operating hours

**Request:**
```json
{
  "asset_uid": "6747bcaf-5c31-e12f-8947-37fce290ab47",
  "hours": 275,
  "meter_replaced": false,
  "notes": "Regular update"
}
```

**Business Logic:**
1. Validate: `meter_replaced` requires `notes`
2. Fetch last hours from history
3. If `hours < last_hours` AND `!meter_replaced`: REJECT
4. BEGIN TRANSACTION:
   - INSERT INTO system_hours_history
   - UPDATE system_maintenance (hours, last_update)
   - SET installation_date IF NULL
   - UPDATE boatos_tasks (last_completed, next_due)
5. COMMIT

**Response:**
```json
{
  "success": true,
  "data": {
    "updated_hours": 275,
    "previous_hours": 250,
    "validation_result": "valid",
    "boatos_task_updated": true,
    "next_prompt_date": "2025-10-29"
  },
  "requestId": "abc-123"
}
```

---

#### **GET /admin/api/system-maintenance/:assetUid**
**Purpose:** Get current system state

**Response:**
```json
{
  "success": true,
  "data": {
    "system_maintenance": {
      "asset_uid": "6747bcaf-...",
      "current_operating_hours": 275,
      "installation_date": "2024-01-15T00:00:00Z",
      "last_hours_update": "2025-10-22T19:00:00Z"
    },
    "system_info": {
      "system_name": "57 hp diesel engine (PORT)",
      "manufacturer_norm": "Yanmar",
      "model_norm": "3YM30"
    },
    "last_entry": {
      "hours": 275,
      "submitted_at": "2025-10-22T19:00:00Z",
      "submitted_by": "user"
    }
  }
}
```

---

#### **GET /admin/api/system-maintenance/:assetUid/history**
**Purpose:** Get hours update history

**Query Params:**
- `limit` (default: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "history": [
      {
        "id": "...",
        "hours": 275,
        "submitted_at": "2025-10-22T19:00:00Z",
        "submitted_by": "user",
        "notes": null,
        "meter_replaced": false
      },
      {
        "id": "...",
        "hours": 250,
        "submitted_at": "2025-10-15T18:30:00Z",
        "submitted_by": "user",
        "notes": null,
        "meter_replaced": false
      },
      {
        "id": "...",
        "hours": 0,
        "submitted_at": "2025-10-08T10:00:00Z",
        "submitted_by": "user",
        "notes": "New meter installed",
        "meter_replaced": true
      }
    ],
    "total_entries": 3
  }
}
```

---

### **B. Task Completions**

#### **POST /admin/api/task-completions**
**Purpose:** Mark task as complete

**Request:**
```json
{
  "task_id": "task-1761081739633-196",
  "asset_uid": "6747bcaf-5c31-e12f-8947-37fce290ab47",
  "hours_at_completion": 275,
  "notes": "Used synthetic oil"
}
```

**Business Logic:**
1. Fetch task from Pinecone
2. Validate: `review_status === "approved"` (reject if pending)
3. INSERT INTO task_completions
4. If `is_recurring`:
   - Calculate next_due
   - UPDATE Pinecone metadata (last_completed, next_due)
5. If `!is_recurring`:
   - UPDATE Pinecone metadata (is_completed: true)
   - Task filtered out of UI

**Response:**
```json
{
  "success": true,
  "data": {
    "completion": {
      "id": "...",
      "task_id": "task-1761081739633-196",
      "completed_at": "2025-10-22T20:00:00Z",
      "hours_at_completion": 275
    },
    "next_due_calculated": {
      "is_recurring": true,
      "next_due_hours": 325,
      "due_in_hours": 50
    }
  }
}
```

---

### **C. BoatOS Tasks**

#### **GET /admin/api/boatos-tasks**
**Purpose:** Get BoatOS tasks (optionally filtered)

**Query Params:**
- `asset_uid` (optional): Filter to specific system

**Response:**
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "...",
        "task_type": "update_usage_hours",
        "asset_uid": "6747bcaf-...",
        "system_name": "57 hp diesel engine (PORT)",
        "frequency_days": 7,
        "last_completed": "2025-10-15T19:00:00Z",
        "next_due": "2025-10-22T19:00:00Z",
        "is_overdue": true,
        "days_overdue": 0
      }
    ]
  }
}
```

---

#### **PATCH /admin/api/boatos-tasks/:id/dismiss**
**Purpose:** Dismiss BoatOS task (re-prompts tomorrow)

**Response:**
```json
{
  "success": true,
  "data": {
    "task": {
      "id": "...",
      "last_dismissed": "2025-10-22T20:00:00Z",
      "will_reprompt_on": "2025-10-23T00:00:00Z"
    }
  }
}
```

---

### **D. Task Approval**

#### **PATCH /admin/api/maintenance-tasks/:taskId/approve**
**Purpose:** Approve a single pending task

**Request:**
```json
{
  "notes": "Verified with manual, looks correct"
}
```

**Business Logic:**
1. Fetch task from Pinecone (with embeddings)
2. UPDATE metadata:
   - `review_status`: "approved"
   - `reviewed_at`: NOW()
   - `reviewed_by`: "user"
   - `review_notes`: notes
3. Re-upsert to Pinecone (same ID, same embeddings, updated metadata)

**Response:**
```json
{
  "success": true,
  "data": {
    "task_id": "task-1761081739633-196",
    "updated_metadata": {
      "review_status": "approved",
      "reviewed_at": "2025-10-22T20:00:00Z"
    }
  }
}
```

---

#### **PATCH /admin/api/maintenance-tasks/bulk-approve**
**Purpose:** Approve multiple tasks at once

**Request:**
```json
{
  "task_ids": [
    "task-1761081739633-196",
    "task-1761081729263-183",
    "task-1761081721458-173"
  ],
  "notes": "Batch approved after review"
}
```

**Business Logic:**
1. For each task_id:
   - Fetch from Pinecone
   - Update metadata (same as single approve)
   - Re-upsert
2. Collect successes/failures

**Response:**
```json
{
  "success": true,
  "data": {
    "approved_count": 3,
    "total_requested": 3,
    "failed": []
  }
}
```

---

### **E. To-Do Lists**

#### **GET /admin/api/todo/current**
**Purpose:** Get tasks due now or overdue

**Response:**
```json
{
  "success": true,
  "data": {
    "boatos_tasks": [
      {
        "id": "...",
        "type": "boatos",
        "description": "Update Yanmar (PORT) operating hours",
        "system_name": "57 hp diesel engine (PORT)",
        "asset_uid": "6747bcaf-...",
        "due_status": "overdue",
        "days_overdue": 2,
        "last_updated": "2025-10-15T19:00:00Z"
      }
    ],
    "maintenance_tasks": [
      {
        "id": "task-...",
        "type": "maintenance",
        "description": "Change engine oil",
        "system_name": "57 hp diesel engine (PORT)",
        "due_status": "due_now",
        "current_hours": 275,
        "next_due_hours": 300,
        "hours_until_due": 25
      }
    ],
    "total_due": 2
  }
}
```

---

#### **GET /admin/api/todo/upcoming**
**Purpose:** Get tasks due in next N days

**Query Params:**
- `days` (default: 30)

**Response:**
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "task-...",
        "description": "Replace fuel filter",
        "system_name": "57 hp diesel engine (PORT)",
        "due_in_days": 15,
        "due_date": "2025-11-06"
      }
    ],
    "total_upcoming": 1
  }
}
```

---

## 🔄 COMPLETE DATA FLOWS

### **Flow 1: Task Extraction → Approval → BoatOS Creation**

```
┌─────────────────────────────────────────────────────────┐
│ 1. USER RUNS EXTRACTION                                 │
└─────────────────────────────────────────────────────────┘
                          ↓
node scripts/extract-enrich-and-upload-tasks.js --system "Yanmar"
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. SCRIPT PROCESSES MANUAL                              │
│    - Extracts 50 tasks                                  │
│    - Detects is_recurring for each                     │
│    - Sets review_status: "pending"                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. UPLOAD TO PINECONE                                   │
│    Namespace: MAINTENANCE_TASKS                         │
│    Metadata includes:                                   │
│    - is_recurring: true/false                           │
│    - review_status: "pending"                           │
│    - reviewed_at: null                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. CHECK FOR BOATOS TASK CREATION                      │
│    Query: Does system have approved usage tasks?        │
│    Result: NO (all tasks are pending)                   │
│    Action: Skip BoatOS creation                         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 5. USER OPENS UI                                        │
│    http://localhost:3000/public/maintenance-tasks-list  │
│    Filter: "Review Status: Pending"                     │
│    Shows: 50 pending tasks                              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 6. USER REVIEWS TASKS                                   │
│    - Edits 5 tasks (fix descriptions)                  │
│    - Deletes 10 tasks (duplicates)                     │
│    - Leaves 5 tasks pending (needs more review)        │
│    - Selects 30 tasks → "Approve Selected"            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 7. BULK APPROVAL API                                    │
│    PATCH /admin/api/maintenance-tasks/bulk-approve      │
│    Body: { task_ids: [30 IDs], notes: "Reviewed" }     │
│                                                         │
│    For each task:                                       │
│    - Fetch from Pinecone (with embeddings)             │
│    - Update metadata:                                   │
│      review_status: "approved"                          │
│      reviewed_at: NOW()                                 │
│      reviewed_by: "user"                                │
│    - Re-upsert to Pinecone                             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 8. TASKS NOW APPROVED                                   │
│    Status: 30 approved, 5 pending, 10 deleted          │
│    UI updates: Badges change to "✅ APPROVED"          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 9. RE-RUN EXTRACTION (NEXT TIME)                       │
│    Script checks again:                                 │
│    Query: approved usage tasks for this system?         │
│    Result: YES (15 approved usage-based tasks found)    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 10. CREATE BOATOS TASK                                  │
│     Check: Does BoatOS task already exist?              │
│     Result: NO                                          │
│     Action: INSERT INTO boatos_tasks                    │
│     Data:                                               │
│       asset_uid: "6747bcaf-..."                         │
│       task_type: "update_usage_hours"                   │
│       next_due: NOW() + 7 days                          │
│       is_active: true                                   │
└─────────────────────────────────────────────────────────┘
                          ↓
                 ✅ COMPLETE
```

---

### **Flow 2: BoatOS Hour Tracking Cycle**

```
┌─────────────────────────────────────────────────────────┐
│ 1. BOATOS TASK CREATED                                  │
│    created_at: Oct 15, 2025                             │
│    next_due: Oct 22, 2025 (7 days later)                │
└─────────────────────────────────────────────────────────┘
                          ↓
            [7 days pass...]
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. USER OPENS TO-DO LIST (Oct 22)                      │
│    GET /admin/api/todo/current                          │
│                                                         │
│    Query: boatos_tasks WHERE next_due <= NOW()          │
│    Result: 1 task found                                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. TASK DISPLAYED                                       │
│    🤖 Update Yanmar (PORT) hours                        │
│    Due: Today                                           │
│    Last updated: 7 days ago                             │
│    [Update Hours] [Dismiss]                             │
└─────────────────────────────────────────────────────────┘
                          ↓
          USER CLICKS "DISMISS"
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. DISMISS ACTION                                       │
│    PATCH /admin/api/boatos-tasks/:id/dismiss            │
│                                                         │
│    UPDATE boatos_tasks                                  │
│    SET last_dismissed = NOW()                           │
│    WHERE id = ...                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 5. TASK DISAPPEARS FROM TO-DO                          │
│    Reason: Dismissed                                    │
└─────────────────────────────────────────────────────────┘
                          ↓
          [Next day: Oct 23]
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 6. TASK REAPPEARS                                       │
│    Query logic:                                         │
│    WHERE next_due <= NOW()                              │
│      AND (last_dismissed IS NULL                        │
│           OR last_dismissed < CURRENT_DATE)             │
│                                                         │
│    Result: Task shows again (still overdue)             │
└─────────────────────────────────────────────────────────┘
                          ↓
     USER CLICKS "UPDATE HOURS"
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 7. SYSTEM CARD OPENS                                    │
│    GET /admin/api/system-maintenance/:assetUid          │
│                                                         │
│    Current Hours: 250                                   │
│    Last Updated: 9 days ago (Oct 14)                    │
│    Installation: Jan 15, 2024                           │
│                                                         │
│    Update Hours: [275] [Submit]                         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 8. HOURS UPDATE API                                     │
│    POST /admin/api/system-maintenance/hours             │
│    Body: { asset_uid, hours: 275 }                      │
│                                                         │
│    VALIDATION:                                          │
│    ✅ 275 > 250 (last hours)                           │
│    ✅ meter_replaced = false (OK)                      │
│                                                         │
│    BEGIN TRANSACTION:                                   │
│    1. INSERT system_hours_history (275)                 │
│    2. UPDATE system_maintenance                         │
│       SET current_operating_hours = 275                 │
│           last_hours_update = NOW()                     │
│    3. UPDATE boatos_tasks                               │
│       SET last_completed = NOW()                        │
│           next_due = NOW() + 7 days (Oct 30)            │
│    COMMIT                                               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 9. SUCCESS RESPONSE                                     │
│    BoatOS task updated                                  │
│    Next prompt: Oct 30, 2025                            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 10. TASK DISAPPEARS FROM TO-DO                         │
│     Reason: Completed (next_due > NOW())                │
└─────────────────────────────────────────────────────────┘
                          ↓
         [7 days later: Oct 30]
                          ↓
             CYCLE REPEATS
```

---

### **Flow 3: Recurring Task Completion**

```
┌─────────────────────────────────────────────────────────┐
│ SYSTEM STATE                                            │
│ - Current hours: 275                                    │
│ - Task: "Change oil every 50 hours"                    │
│   - frequency_value: 50                                 │
│   - frequency_type: "hours"                             │
│   - frequency_basis: "usage"                            │
│   - is_recurring: true                                  │
│   - review_status: "approved"                           │
│   - last_completed_hours: null (never completed)        │
│   - next_due_hours: 50 (first occurrence)               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ TIMELINE VIEW CALCULATION                               │
│ Current: 275 hours                                      │
│ Next due: 50 hours                                      │
│ Status: OVERDUE (225 hours past due)                    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ USER PERFORMS MAINTENANCE                               │
│ - Changes oil at 275 hours                             │
│ - Clicks "Mark Complete" on task card                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ MODAL OPENS                                             │
│ Task: Change engine oil                                 │
│ Hours at completion: [275] (pre-filled)                 │
│ Notes: [Used synthetic 10W-30]                          │
│ [Cancel] [Complete]                                     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ COMPLETION API                                          │
│ POST /admin/api/task-completions                        │
│ Body: {                                                 │
│   task_id: "task-1761081739633-196",                    │
│   asset_uid: "6747bcaf-...",                            │
│   hours_at_completion: 275,                             │
│   notes: "Used synthetic 10W-30"                        │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ SERVICE LOGIC                                           │
│ 1. Fetch task from Pinecone                            │
│    - Verify review_status = "approved" ✅              │
│    - Get frequency_value: 50                            │
│                                                         │
│ 2. INSERT INTO task_completions                         │
│    - task_id, asset_uid, hours: 275                     │
│                                                         │
│ 3. Calculate next due:                                  │
│    next_due_hours = 275 + 50 = 325                      │
│                                                         │
│ 4. Update Pinecone metadata:                            │
│    - last_completed_at: NOW()                           │
│    - last_completed_hours: 275                          │
│    - next_due_hours: 325                                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ SUCCESS RESPONSE                                        │
│ {                                                       │
│   completion: { ... },                                  │
│   next_due_calculated: {                                │
│     is_recurring: true,                                 │
│     next_due_hours: 325,                                │
│     due_in_hours: 50 (from current 275)                 │
│   }                                                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ TIMELINE VIEW UPDATED                                   │
│ Task: Change engine oil                                 │
│ Last completed: 275 hours                               │
│ Next due: 325 hours                                     │
│ Status: Due in 50 hours                                 │
└─────────────────────────────────────────────────────────┘
                          ↓
         [System reaches 325 hours]
                          ↓
┌─────────────────────────────────────────────────────────┐
│ TASK DUE AGAIN                                          │
│ Status: DUE NOW                                         │
│ User completes at 330 hours                             │
│ Next due: 380 hours                                     │
└─────────────────────────────────────────────────────────┘
                          ↓
              CYCLE REPEATS FOREVER
```

---

### **Flow 4: One-Time Task Completion**

```
┌─────────────────────────────────────────────────────────┐
│ TASK: "Check valve clearance after first 50 hours"     │
│ - is_recurring: false                                   │
│ - review_status: "approved"                             │
│ - frequency_value: 50                                   │
│ - frequency_basis: "usage"                              │
│ - next_due_hours: 50 (first occurrence)                 │
│ - is_completed: false                                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ SYSTEM STATE                                            │
│ Current hours: 52                                       │
│ Task status: DUE (past 50 hours)                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ USER MARKS COMPLETE                                     │
│ POST /admin/api/task-completions                        │
│ Body: {                                                 │
│   task_id: "task-...",                                  │
│   asset_uid: "...",                                     │
│   hours_at_completion: 52,                              │
│   notes: "Checked - within spec"                        │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ SERVICE LOGIC                                           │
│ 1. Fetch task: is_recurring = false                    │
│                                                         │
│ 2. INSERT INTO task_completions                         │
│    (one-time completion record)                         │
│                                                         │
│ 3. Update Pinecone metadata:                            │
│    - is_completed: true                                 │
│    - completed_at: NOW()                                │
│    - completed_hours: 52                                │
│    - next_due_hours: null (doesn't repeat)              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ UI BEHAVIOR                                             │
│ Timeline view filter:                                   │
│ WHERE is_completed = false OR is_recurring = true       │
│                                                         │
│ Result: Task filtered out (is_completed = true)         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ TASK NO LONGER APPEARS                                  │
│ - Not in Timeline view                                  │
│ - Not in Current To-Do                                  │
│ - Only appears in completions history                   │
└─────────────────────────────────────────────────────────┘
                          ↓
                  ✅ ARCHIVED
```

---

## 📁 FILES TO CREATE/MODIFY

### **NEW FILES (Main System):**

#### **Repositories (3 files):**
1. `src/repositories/system-maintenance.repository.js`
2. `src/repositories/task-completions.repository.js`
3. `src/repositories/boatos-tasks.repository.js`

#### **Services (5 files):**
1. `src/services/system-maintenance.service.js`
2. `src/services/task-completions.service.js`
3. `src/services/boatos-tasks.service.js`
4. `src/services/task-approval.service.js`
5. `src/services/todo.service.js`

#### **Routes (4 files):**
1. `src/routes/admin/system-maintenance.route.js`
2. `src/routes/admin/task-completions.route.js`
3. `src/routes/admin/boatos-tasks.route.js`
4. `src/routes/admin/todo.route.js`

---

### **MODIFIED FILES:**

#### **Main System:**
1. **`src/routes/admin/maintenance-tasks.route.js`**
   - Add approval endpoints (PATCH /:taskId/approve, PATCH /bulk-approve)

2. **`src/routes/admin/index.js`**
   - Register 4 new route files

3. **`src/public/maintenance-tasks-list.html`**
   - Add review status filter
   - Add approval buttons/badges
   - Add bulk selection checkboxes
   - Add stats with approval counts
   - Add BoatOS filter option

#### **Maintenance Agent:**
4. **`maintenance-agent/scripts/extract-enrich-and-upload-tasks.js`**
   - Add `is_recurring` detection logic
   - Set `review_status: "pending"` on new tasks
   - Add BoatOS task creation (end of script)

5. **`maintenance-agent/src/repositories/pinecone.repository.js`**
   - Update task creation to include new metadata fields

---

### **DO NOT TOUCH:**
- ❌ `systems` table (existing)
- ❌ `maintenance_tasks_queue` table (dormant, for future)
- ❌ `maintenance.route.js` (dormant approval routes)
- ❌ `maintenance-review.html` (duplicate review page)

---

## ⚠️ RISK ANALYSIS

### **Risk 1: Breaking Existing Systems Table Queries**
**Impact:** HIGH
**Probability:** LOW
**Mitigation:**
- Zero changes to `systems` table
- New tables use FK with CASCADE
- All queries isolated in new repositories
- Test existing queries before/after

---

### **Risk 2: Pinecone Metadata Update Pattern**
**Impact:** MEDIUM
**Challenge:** Pinecone doesn't support partial updates - must re-upsert entire record

**Pattern to Follow:**
```javascript
// 1. Fetch full record with embeddings
const fetchResponse = await namespace.fetch([taskId]);
const existing = fetchResponse.records[taskId];

// 2. Merge metadata
const updatedMetadata = {
  ...existing.metadata,
  review_status: "approved",
  reviewed_at: new Date().toISOString(),
  reviewed_by: "user"
};

// 3. Re-upsert (same ID, same embeddings, updated metadata)
await namespace.upsert([{
  id: taskId,
  values: existing.values,  // Same embeddings
  metadata: updatedMetadata  // Updated metadata
}]);
```

**Mitigation:**
- Always fetch before update
- Always preserve embeddings
- Rate limit awareness (batch if >100 tasks)

---

### **Risk 3: Hours Validation Edge Cases**
**Impact:** MEDIUM
**Probability:** MEDIUM

**Known Edge Cases:**
1. **Hour meter replaced** → Allow lower reading with note
2. **Typo correction** → Allow multiple updates same day
3. **Forgot to update for weeks** → Allow catch-up
4. **Manual rollback** → Admin override (future Phase 9)

**Mitigation:**
```javascript
// Case 1: Meter replaced
if (meter_replaced === true) {
  if (!notes || notes.trim() === '') {
    throw new Error('Note required when meter replaced');
  }
  // Allow any hours value (even lower)
}

// Case 2: Multiple updates per day - ALWAYS ALLOWED
// No restriction on update frequency

// Case 3: Catch-up - ALLOWED
// Validation only checks: newHours >= lastHours (if !meter_replaced)

// Case 4: Admin override - FUTURE
// Create separate endpoint: /admin-override-hours (Phase 9)
```

---

### **Risk 4: BoatOS Task Staggering**
**Impact:** LOW
**Probability:** CERTAIN (by design)

**Behavior:**
- Each system's BoatOS task created at different times
- Tasks naturally stagger (not all due on same day)
- Reduces user burden

**Mitigation:**
- Document this as intentional
- Optional future: "Sync all systems" button to align schedules

---

### **Risk 5: Render Deployment First Time**
**Impact:** HIGH
**Probability:** MEDIUM

**Challenges:**
- Environment variables misconfigured
- Database connection pooling issues
- Cron jobs don't trigger
- Logs not captured

**Mitigation:**
- Comprehensive deployment guide (Phase 7)
- Health check endpoint
- Environment variable checklist
- Test locally with Render-like env first
- Staging deployment before production

---

### **Risk 6: Approval Workflow Confusion**
**Impact:** LOW
**Probability:** MEDIUM

**Challenge:** User might forget to approve tasks

**Mitigation:**
- Clear badges: 🟡 PENDING REVIEW
- Stats show: "42 pending review"
- Filter defaults to "All" (see both pending and approved)
- Training documentation

---

## 🧪 TESTING SCENARIOS

### **Scenario 1: Full Workflow (Extraction → Approval → Tracking)**

**Steps:**
1. Run: `node scripts/extract-enrich-and-upload-tasks.js --system "Yanmar"`
2. Verify: 50 tasks in Pinecone with `review_status: "pending"`
3. Open: maintenance-tasks-list.html
4. Filter: "Review Status: Pending"
5. Approve: 30 tasks (bulk)
6. Delete: 10 tasks (duplicates)
7. Edit: 5 tasks (fix descriptions)
8. Leave: 5 tasks pending
9. Verify: 30 approved, 5 pending
10. Run extraction again
11. Verify: BoatOS task created
12. Check: `boatos_tasks` table has entry

**Expected:**
- ✅ BoatOS task created only after approval
- ✅ BoatOS task not duplicated on re-run
- ✅ Approved tasks queryable separately

---

### **Scenario 2: Hours Update with Validation**

**Steps:**
1. Open System Card for Yanmar
2. Current: 0 hours (first time)
3. Enter: 250 hours → Submit
4. Verify: `system_maintenance` updated
5. Verify: `system_hours_history` has entry
6. Verify: `installation_date` auto-set to today
7. Enter: 275 hours → Submit (1 second later)
8. Verify: ALLOWED (same day updates OK)
9. Try: 270 hours → Submit
10. Verify: REJECTED "Cannot be lower than 275h"
11. Check "Meter replaced", add note: "New meter installed"
12. Enter: 0 hours → Submit
13. Verify: ALLOWED (`meter_replaced = true`)
14. Check history: Shows all 3 entries with notes

**Expected:**
- ✅ Validation prevents accidental rollback
- ✅ Meter replacement override works
- ✅ History shows complete audit trail

---

### **Scenario 3: Recurring Task Completion**

**Steps:**
1. System at 275 hours
2. Task: "Change oil every 50 hours"
   - Never completed
   - Next due: 50 hours
3. Timeline shows: "OVERDUE (225 hours past)"
4. User marks complete at 275 hours
5. Verify: `task_completions` has entry
6. Verify: Pinecone `next_due_hours: 325`
7. Timeline shows: "Due at 325 hours (50 hours from now)"
8. System reaches 325 hours
9. Complete again at 330 hours
10. Next due: 380 hours
11. Verify: 2 entries in `task_completions`

**Expected:**
- ✅ Task rolls after each completion
- ✅ Next due calculated correctly
- ✅ Complete history preserved

---

### **Scenario 4: One-Time Task Completion**

**Steps:**
1. Task: "Check valve clearance after first 50 hours"
   - `is_recurring: false`
   - `review_status: "approved"`
2. System at 52 hours
3. Mark complete
4. Verify: `task_completions` has entry
5. Verify: Pinecone `is_completed: true`
6. Refresh page
7. Task no longer in Timeline
8. Check completions history: Shows archived task

**Expected:**
- ✅ One-time task disappears after completion
- ✅ Doesn't reappear
- ✅ Archived in history

---

### **Scenario 5: BoatOS Prompt Cycle**

**Steps:**
1. BoatOS task created (`next_due: Oct 22`)
2. Open To-Do on Oct 22
3. Shows: "Update Yanmar hours" (due today)
4. User dismisses
5. Task disappears
6. Check tomorrow (Oct 23)
7. Task reappears (still overdue)
8. User updates hours to 300
9. Verify: `next_due: Oct 29`
10. Task disappears
11. Check on Oct 29
12. Task reappears

**Expected:**
- ✅ 7-day cycle works
- ✅ Dismissal re-prompts tomorrow
- ✅ Completion resets 7-day timer

---

### **Scenario 6: Bulk Approval**

**Steps:**
1. Run extraction → 50 pending tasks
2. Filter: "Pending Review"
3. Single approve: Task 1 → Badge: "✅ APPROVED"
4. Select 10 tasks → "Approve Selected"
5. Verify: All 10 badges update
6. Verify: Pinecone metadata for all 11 updated
7. Filter: "Approved" → Shows 11 tasks
8. Filter: "Pending" → Shows 39 tasks
9. BoatOS check: Approved usage tasks found?
10. If yes → BoatOS task created

**Expected:**
- ✅ Bulk approval updates all tasks
- ✅ UI reflects changes immediately
- ✅ BoatOS creation triggered

---

## 🎯 IMPLEMENTATION PHASES

### **Phase 1: Database Schema (Day 1 - 4 hours)**

**Deliverables:**
- 4 SQL files (numbered 001-004)
- 1 rollback script (000)
- Schema verification queries

**Execution:**
1. Copy SQL into Supabase SQL Editor
2. Execute each numbered file in order
3. Run verification queries
4. Test insert/update/delete on each table

**Approval Gate:** User reviews SQL, confirms execution success

---

### **Phase 2: Repositories (Day 1-2 - 8 hours)**

**Files to Create:**
1. `src/repositories/system-maintenance.repository.js`
2. `src/repositories/task-completions.repository.js`
3. `src/repositories/boatos-tasks.repository.js`

**Patterns:**
- Import `getSupabaseClient()`
- Use structured logger
- Pure I/O functions (no business logic)
- Throw errors with context
- Return null for not-found

**Testing:** Manual function calls with test data

---

### **Phase 3: Services (Day 2-3 - 10 hours)**

**Files to Create:**
1. `src/services/system-maintenance.service.js`
2. `src/services/task-completions.service.js`
3. `src/services/boatos-tasks.service.js`
4. `src/services/task-approval.service.js`
5. `src/services/todo.service.js`

**Patterns:**
- Import from repositories
- Business logic only
- Use logger
- Return structured data

---

### **Phase 4: Routes (Day 3-4 - 8 hours)**

**Files to Create:**
1. `src/routes/admin/system-maintenance.route.js`
2. `src/routes/admin/task-completions.route.js`
3. `src/routes/admin/boatos-tasks.route.js`
4. `src/routes/admin/todo.route.js`

**File to Modify:**
5. `src/routes/admin/maintenance-tasks.route.js` (add approval endpoints)
6. `src/routes/admin/index.js` (register routes)

**Patterns:**
- Thin routes (validation only)
- Call service layer
- Return envelope format
- Use logger

---

### **Phase 5: Agent Integration (Day 4-5 - 6 hours)**

**Files to Modify:**
1. `maintenance-agent/scripts/extract-enrich-and-upload-tasks.js`
   - Add `is_recurring` detection
   - Set `review_status: "pending"`
   - Add BoatOS creation logic

2. `maintenance-agent/src/repositories/pinecone.repository.js`
   - Include new metadata fields

---

### **Phase 6: Frontend (Day 5-6 - 10 hours)**

**File to Modify:**
1. `src/public/maintenance-tasks-list.html`
   - Add review status filter
   - Add approval buttons/badges
   - Add bulk selection
   - Add stats with approval counts
   - Add BoatOS filter

---

### **Phase 7: Render Deployment Config (Day 6 - 4 hours)**

**Deliverables:**
- `maintenance-agent/render.yaml`
- Health check endpoint
- Environment variable checklist
- Deployment guide

---

### **Phase 8: Integration Testing (Day 7 - 6 hours)**

**Execute all 6 test scenarios**
- Document results
- Fix any issues found
- Get user approval for production

---

## 📝 CRITICAL PATTERNS TO FOLLOW

### **1. Repository Pattern**
```javascript
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

export async function getByAssetUid(assetUid) {
  const supabase = await getSupabaseClient();
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('system_maintenance')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (error) throw error;
    return data || null;

  } catch (error) {
    requestLogger.error('Failed to fetch system maintenance', {
      assetUid,
      error: error.message
    });
    throw error;
  }
}
```

---

### **2. Service Pattern**
```javascript
import * as repo from '../repositories/system-maintenance.repository.js';
import { logger } from '../utils/logger.js';

export async function validateHoursUpdate(assetUid, newHours, meterReplaced) {
  const requestLogger = logger.createRequestLogger();

  // Fetch last hours
  const lastEntry = await repo.getLatestHours(assetUid);

  // Validation logic
  if (!meterReplaced && lastEntry && newHours < lastEntry.hours) {
    return {
      valid: false,
      error: `Hours cannot decrease (last: ${lastEntry.hours})`
    };
  }

  return { valid: true };
}
```

---

### **3. Route Pattern**
```javascript
import express from 'express';
import { logger } from '../../utils/logger.js';
import * as service from '../../services/system-maintenance.service.js';

const router = express.Router();

router.post('/hours', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { asset_uid, hours, meter_replaced, notes } = req.body;

    // Call service
    const result = await service.updateOperatingHours(
      asset_uid, hours, meter_replaced, notes
    );

    // Return envelope
    return res.json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });

  } catch (error) {
    requestLogger.error('Error updating hours', {
      error: error.message
    });
    return next(error);
  }
});

export default router;
```

---

## 🚀 RENDER DEPLOYMENT CHECKLIST

### **Environment Variables:**
```
Required:
☐ SUPABASE_URL
☐ SUPABASE_SERVICE_KEY
☐ PINECONE_API_KEY
☐ OPENAI_API_KEY
☐ PINECONE_INDEX=reimaginedsv
☐ NODE_ENV=production

Optional:
☐ AGENT_RUN_INTERVAL_MINUTES=60
☐ LOG_LEVEL=info
```

### **Health Check Endpoint:**
```javascript
// maintenance-agent/src/index.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

### **Graceful Shutdown:**
```javascript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  // Close database connections
  // Wait for jobs to finish
  process.exit(0);
});
```

---

## ✅ IMPLEMENTATION CHECKLIST

### **Before Starting:**
- [ ] User has approved complete plan
- [ ] All questions answered
- [ ] Risk analysis understood
- [ ] SQL scripts reviewed

### **Phase Gates:**
- [ ] Phase 1: Database schema executed and verified
- [ ] Phase 2: Repositories tested
- [ ] Phase 3: Services tested
- [ ] Phase 4: Routes tested with curl/Postman
- [ ] Phase 5: Agent tested on dev system
- [ ] Phase 6: Frontend tested in browser
- [ ] Phase 7: Render config reviewed
- [ ] Phase 8: All 6 test scenarios passed

### **Final Approval:**
- [ ] User tested end-to-end workflow
- [ ] User approves production deployment
- [ ] Backup database before deployment
- [ ] Deploy to Render staging first

---

## 📚 USER ANSWERS TO KEY QUESTIONS

### **Migration System:**
- **Answer:** Manual SQL execution in Supabase UI (no migration framework)

### **User Authentication:**
- **Answer:** No users table for now. Use `"user"` as default value in TEXT fields

### **Render Configuration:**
- **Answer:** Have Render account but not used yet. Will probably deploy via git (TBD)

### **Testing:**
- **Answer:** Manual testing only for now. Automated tests addressed post-code

### **Existing maintenance.route.js:**
- **Answer:** Leave untouched. It's dormant (for future agent approval workflow)

### **BoatOS Task Storage:**
- **Answer:** Supabase only. API merges BoatOS tasks + Pinecone tasks in responses

---

## 🎬 NEXT STEPS

**Status:** ⏸️ **AWAITING USER APPROVAL TO BEGIN PHASE 1**

**User must:**
1. ✅ Read this entire document
2. ✅ Confirm understanding of architecture
3. ✅ Explicitly approve: "Plan approved, proceed with Phase 1"

**Then we:**
1. Create SQL migration scripts
2. Execute on dev database (Supabase UI)
3. Verify schema created correctly
4. Proceed to Phase 2 (Repositories)

---

## 🔑 KEY TAKEAWAYS

### **What Makes This Complex:**
1. Two systems in one (tracking + approval)
2. Multiple data sources (Supabase + Pinecone)
3. Autonomous agent integration (Render)
4. Marine environment (high stakes)
5. 200+ interconnected systems

### **Why We're Confident:**
1. Zero changes to existing tables
2. Layered architecture (no violations)
3. Comprehensive testing plan
4. Phase-gate approvals
5. Complete rollback capability

### **Success Criteria:**
1. ✅ Users can track system hours
2. ✅ Recurring tasks roll after completion
3. ✅ One-time tasks disappear after completion
4. ✅ BoatOS prompts users every 7 days
5. ✅ Approval workflow prevents bad tasks
6. ✅ Zero breaking changes to existing features
7. ✅ Render agent runs autonomously

---

**END OF SESSION 27 DOCUMENTATION**

**This document contains everything needed to implement the complete system from scratch.**

---

## 📊 APPENDIX: SQL MIGRATION SCRIPTS

### **Script 001: system_maintenance**
```sql
-- File: 001_create_system_maintenance.sql
-- Execute in Supabase SQL Editor

CREATE TABLE system_maintenance (
  asset_uid UUID PRIMARY KEY
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  current_operating_hours INTEGER NOT NULL DEFAULT 0
    CHECK (current_operating_hours >= 0),
  installation_date TIMESTAMPTZ,
  last_hours_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_maintenance_hours
  ON system_maintenance(current_operating_hours);
CREATE INDEX idx_system_maintenance_updated
  ON system_maintenance(last_hours_update);

COMMENT ON TABLE system_maintenance IS
  'Current operational state for systems with usage-based maintenance';
COMMENT ON COLUMN system_maintenance.installation_date IS
  'Auto-set on first hours entry if NULL';
COMMENT ON COLUMN system_maintenance.current_operating_hours IS
  'Latest hour meter reading';

-- Verify
SELECT tablename, schemaname
FROM pg_tables
WHERE tablename = 'system_maintenance';
```

### **Script 002: system_hours_history**
```sql
-- File: 002_create_system_hours_history.sql
-- Execute in Supabase SQL Editor

CREATE TABLE system_hours_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  hours INTEGER NOT NULL CHECK (hours >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by TEXT NOT NULL DEFAULT 'user',
  notes TEXT,
  meter_replaced BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hours_history_asset
  ON system_hours_history(asset_uid, submitted_at DESC);
CREATE INDEX idx_hours_history_submitted
  ON system_hours_history(submitted_at DESC);

COMMENT ON TABLE system_hours_history IS
  'Audit trail of all hour meter readings with validation support';
COMMENT ON COLUMN system_hours_history.meter_replaced IS
  'TRUE allows lower reading than previous (with required note)';

-- Verify
SELECT tablename, indexname
FROM pg_indexes
WHERE tablename = 'system_hours_history';
```

### **Script 003: boatos_tasks**
```sql
-- File: 003_create_boatos_tasks.sql
-- Execute in Supabase SQL Editor

CREATE TABLE boatos_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL DEFAULT 'update_usage_hours'
    CHECK (task_type IN ('update_usage_hours')),
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  frequency_days INTEGER NOT NULL DEFAULT 7 CHECK (frequency_days > 0),
  last_completed TIMESTAMPTZ,
  next_due TIMESTAMPTZ NOT NULL,
  last_dismissed TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure one active task per system per type
CREATE UNIQUE INDEX idx_boatos_tasks_unique_active
  ON boatos_tasks(asset_uid, task_type)
  WHERE is_active = TRUE;

CREATE INDEX idx_boatos_tasks_asset
  ON boatos_tasks(asset_uid) WHERE is_active = TRUE;
CREATE INDEX idx_boatos_tasks_next_due
  ON boatos_tasks(next_due) WHERE is_active = TRUE;

COMMENT ON TABLE boatos_tasks IS
  'System-generated prompts for user actions (autonomous BoatOS tasks)';

-- Verify
SELECT COUNT(*) as index_count
FROM pg_indexes
WHERE tablename = 'boatos_tasks';
```

### **Script 004: task_completions**
```sql
-- File: 004_create_task_completions.sql
-- Execute in Supabase SQL Editor

CREATE TABLE task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hours_at_completion INTEGER CHECK (hours_at_completion >= 0),
  completed_by TEXT NOT NULL DEFAULT 'user',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_completions_task
  ON task_completions(task_id, completed_at DESC);
CREATE INDEX idx_task_completions_asset
  ON task_completions(asset_uid, completed_at DESC);

COMMENT ON TABLE task_completions IS
  'History of maintenance task completions for scheduling recurring tasks';

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'task_completions';
```

### **Script 000: Rollback**
```sql
-- File: 000_rollback_all.sql
-- Execute ONLY IF ROLLING BACK

DROP TABLE IF EXISTS task_completions CASCADE;
DROP TABLE IF EXISTS boatos_tasks CASCADE;
DROP TABLE IF EXISTS system_hours_history CASCADE;
DROP TABLE IF EXISTS system_maintenance CASCADE;

-- Verify cleanup
SELECT tablename
FROM pg_tables
WHERE tablename IN (
  'system_maintenance',
  'system_hours_history',
  'boatos_tasks',
  'task_completions'
);
-- Should return 0 rows
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-22
**Ready for Implementation:** YES ✅
