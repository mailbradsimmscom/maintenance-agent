# BoatOS Task Automation - Quick Reference

## ✅ What Was Implemented

### 1. **Modified `classify-and-discover.js` (Step 6)**
- Now automatically checks if system has usage-based tasks
- Creates BoatOS `update_usage_hours` task if:
  - System has ANY tasks with `frequency_basis: 'usage'`
  - No active BoatOS task already exists for that system
- Prevents duplicates via upsert logic

### 2. **Created `setup-boatos-test-data.js`**
- Cleans up old test data
- Initializes test systems with operating hours
- Creates BoatOS tasks for testing
- Verifies setup

---

## 🎯 Current Test Data

### Test Systems:
1. **Schenker Zen 150 watermaker** (`d0cbc03e-ad33-47c8-84b7-92b41d319727`)
   - Initial hours: 0h
   - BoatOS task: ✅ Active
   - Usage-based tasks: 4 (2 approved, 2 pending)

2. **57 hp diesel engine (PORT)** (`6747bcaf-5c31-e12f-8947-37fce290ab47`)
   - Initial hours: 100h
   - BoatOS task: ✅ Active
   - Usage-based tasks: 32 (0 approved, 32 pending)

---

## 📝 Usage

### Initialize Test Data (Do this once)
```bash
node scripts/setup-boatos-test-data.js
```

This will:
- Delete old test data
- Set initial operating hours for both systems
- Create BoatOS tasks (7-day prompt cycle)
- Verify everything is set up correctly

### Run Step 6 (Classify & Discover)
```bash
# For watermaker
node scripts/classify-and-discover.js --system "watermaker"

# For Yanmar engine
node scripts/classify-and-discover.js --system "57 hp"
```

This will:
- Classify all tasks for the system
- Discover missing tasks
- **Automatically create BoatOS task if system has usage-based maintenance**
- Skip if BoatOS task already exists

---

## 🔄 Workflow: How It All Fits Together

```
Step 1-5: Extract & Classify Tasks
  ↓
Step 6: classify-and-discover.js
  ↓
[NEW] Check: Does system have usage-based tasks?
  ↓
Yes → Check: Does BoatOS task exist?
  ↓
No → Create BoatOS task
  ↓
Done! System will now prompt for hours updates every 7 days
```

---

## 🧪 Testing the UX

### 1. View To-Do List
```
http://localhost:3001/todos.html
```
Should show BoatOS tasks for both systems (next due: 7 days from now)

### 2. Update Operating Hours
```
http://localhost:3001/hours-update.html
```
- Select watermaker (currently at 0h)
- Update to 5h
- Check to-do list → usage-based tasks should now appear

### 3. Test Full Cycle
```bash
# 1. Update watermaker hours to 10h
# 2. Check to-do list → "Manual wash" task should appear (due at 10h)
# 3. Mark task complete
# 4. Check to-do list → task disappears (next due: 20h)
```

---

## 📊 Database Tables

### `boatos_tasks`
| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `task_type` | Always `'update_usage_hours'` for now |
| `asset_uid` | System this task belongs to |
| `frequency_days` | How often to prompt (default: 7) |
| `next_due` | When task should appear in to-do list |
| `last_completed` | When user last updated hours |
| `last_dismissed` | When user dismissed prompt (reappears daily) |
| `is_active` | Task enabled/disabled |

### `system_maintenance`
| Field | Description |
|-------|-------------|
| `asset_uid` | System UUID (primary key) |
| `current_operating_hours` | Current hour meter reading |
| `last_hours_update` | When hours were last updated |
| `installation_date` | System install date |

---

## 🐛 Troubleshooting

### BoatOS task not created by Step 6?
Check if system has usage-based tasks:
```bash
node -e "
import { pineconeRepository } from './src/repositories/pinecone.repository.js';
(async () => {
  const tasks = await pineconeRepository.listAllTasks();
  const usageTasks = tasks.filter(t =>
    t.metadata?.frequency_basis === 'usage' &&
    t.metadata?.asset_uid === 'd0cbc03e-ad33-47c8-84b7-92b41d319727'
  );
  console.log('Usage-based tasks:', usageTasks.length);
})();
"
```

### Duplicate BoatOS tasks?
Run cleanup:
```bash
node scripts/setup-boatos-test-data.js
```

### Task not appearing in to-do list?
1. Check `next_due` is in the past:
   ```sql
   SELECT * FROM boatos_tasks WHERE next_due < NOW();
   ```
2. Check `is_active = true`
3. Check not dismissed in last 24 hours

---

## 🚀 Next Steps

1. ✅ Test UX with both systems
2. ✅ Approve more tasks on Yanmar engine to test at scale
3. ✅ Test hours update → task appears workflow
4. ✅ Test mark complete → task disappears workflow
5. ⏳ Deploy to production when ready

---

## 📁 Files Modified/Created

### Modified:
- `scripts/classify-and-discover.js` - Added BoatOS task creation logic

### Created:
- `scripts/setup-boatos-test-data.js` - Test data initialization
- `scripts/README-BOATOS-TASKS.md` - This file

---

**Last Updated:** 2025-10-24
