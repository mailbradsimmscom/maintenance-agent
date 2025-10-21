# Session 28: Timeline View + 7-Step Pipeline Filtering

**Date:** 2025-10-21
**Status:** 🚧 IN PROGRESS - FILTERING PARTIALLY COMPLETE

---

## 🎯 CRITICAL: THE 7-STEP PIPELINE (MUST READ FIRST)

This is the **COMPLETE** maintenance task extraction pipeline. **DO NOT SKIP STEPS.**

### **Step 1: Generic Chunk Search**
```bash
node maintenance-agent/scripts/capture-pinecone-scores.js [--system "Name"] [--asset-uid "uid"]
```
- **Reads from:** Pinecone `REIMAGINEDDOCS` namespace + Supabase `systems` table
- **Writes to:** Supabase `pinecone_search_results` table
- **What it does:** Uses hard-coded generic terms "maintenance schedule inspection service interval replacement" to find relevant document chunks
- **Output:** Chunks with score ≥ 0.30 (30%)

### **Step 2: LLM-Powered System-Specific Chunk Search**
```bash
node maintenance-agent/scripts/LLM_powered_vector_search.js [--system "Name"] [--asset-uid "uid"]
```
- **Reads from:** Pinecone `REIMAGINEDDOCS` namespace + Supabase `systems` table
- **Writes to:** Supabase `pinecone_search_results` table (marked as `type='LLM'`)
- **What it does:** For EACH system, LLM generates 5-8 custom maintenance search terms specific to that system/manufacturer/model
- **Output:** System-specific chunks with score ≥ 0.30

**Why 2 passes?** Generic catches broad maintenance sections, LLM-powered catches system-specific terminology (e.g., "reverse osmosis membrane pickling" for watermakers)

### **Step 3: Extract Tasks from Chunks**
```bash
node maintenance-agent/scripts/extract-enrich-and-upload-tasks.js [--dry-run] [--system "Name"] [--asset-uid "uid"]
```
- **Reads from:** Supabase `pinecone_search_results` table
- **Writes to:** Pinecone `MAINTENANCE_TASKS` namespace
- **What it does:**
  - Pulls chunks with score ≥ 0.50 (50%)
  - For EACH chunk, sends to GPT-4o-mini to extract AND classify tasks
  - Generates embeddings (text-embedding-3-large, 3072 dims)
  - Uploads to Pinecone with metadata (frequency, basis, type, criticality, confidence)
- **Optimization:** ONE LLM call per chunk (extract + classify together)

### **Step 4: Automated Deduplication (85% threshold)**
```bash
node maintenance-agent/scripts/deduplicate-tasks.js [--delete] [--system "Name"] [--asset-uid "uid"]
```
- **Reads/Writes:** Pinecone `MAINTENANCE_TASKS` namespace
- **What it does:**
  - Pairwise comparison using cosine similarity on embeddings
  - Flags duplicates with ≥85% similarity + matching frequency (dynamic tolerance ±10-20%)
  - Groups duplicates into clusters (primary + duplicates)
  - With `--delete` flag: removes duplicates, keeps primary
- **Output:** JSON report + optional deletion

### **Step 5: Human Review Deduplication (65% threshold)**
```bash
node maintenance-agent/scripts/deduplicate-tasks-forreview.js [--system "Name"] [--asset-uid "uid"]
```
- **Reads from:** Pinecone `MAINTENANCE_TASKS` namespace
- **Writes to:** JSON file only (NO Pinecone changes)
- **What it does:**
  - Same as Step 4 but with LOWER 65% similarity threshold
  - Catches edge cases for human review
  - Full task metadata in JSON for side-by-side comparison
- **Purpose:** Manual review of borderline duplicates

### **Step 6: Classify + Discover**
```bash
node maintenance-agent/scripts/classify-and-discover.js --system "Schenker" [--asset-uid "uid"]
```
- **Reads/Writes:** Pinecone `MAINTENANCE_TASKS` namespace
- **What it does:**
  - **Classify:** Batch classifies ALL tasks into categories:
    - MAINTENANCE (recurring preventive maintenance)
    - INSTALLATION (one-time setup)
    - PRE_USE_CHECK (operational checks before use)
    - VAGUE (no clear frequency/timeframe)
  - **Discover:** LLM generates 3-5 MISSING tasks based on industry best practices
  - Uploads discovered tasks with `source='real_world'`
- **Output:** All tasks have `task_category`, `task_category_confidence`, etc.

### **Step 7: Review & Edit UI**
```
http://localhost:3000/public/maintenance-tasks-list.html
```
- **Reads/Writes:** Pinecone `MAINTENANCE_TASKS` namespace (via API)
- **Features:**
  - **Table View:** Browse, filter, inline edit, delete
  - **Timeline View:** Visual timeline grouped by frequency (Usage/Daily/Weekly/Monthly/etc.)
  - **Modal Editor:** Click any timeline task to edit all fields
- **Purpose:** Final human review and cleanup

---

## 🔄 SESSION 28 WORK: WHAT WE DID

### **1. Built Timeline View with Modal Editing**

Added visual timeline to the maintenance tasks UI:

**Files Modified:**
- `/src/public/maintenance-tasks-list.html` (~250 lines added)

**Features Added:**
- View toggle: Table ⟷ Timeline
- Timeline sections:
  - **[Usage]** - Operating hours based (sorted by hours)
  - **[Daily/Weekly/Monthly/Quarterly/etc.]** - Calendar-based
- Visual timeline bars with dots showing frequency
- Color-coded by frequency
- Click any task → modal editor opens
- Modal has all editable fields + save/delete

**Timeline Example:**
```
[Usage] ●─●───────●──────────── (0h → 500h)
  • Replace oil filter - every 50 hours (50h)
  • Service engine - every 100 hours (100h)

[Daily] ●─●─●─●─●─●─● (365 times/year)
  • Check strainer - every 5 days

[Monthly] ─────●─────●─── (12 times/year)
  • Clean system - every 3 months
```

### **2. Added Filtering to Pipeline Scripts**

**GOAL:** Support both `--system "Name"` AND `--asset-uid "uid"` filtering on ALL 6 scripts

**STATUS:**
- ✅ Step 1: `capture-pinecone-scores.js` - COMPLETE
- ✅ Step 2: `LLM_powered_vector_search.js` - COMPLETE
- ✅ Step 3: `extract-enrich-and-upload-tasks.js` - COMPLETE
- 🚧 Step 4: `deduplicate-tasks.js` - **INCOMPLETE**
- 🚧 Step 5: `deduplicate-tasks-forreview.js` - **INCOMPLETE**
- 🚧 Step 6: `classify-and-discover.js` - **INCOMPLETE** (has `--system` but needs `--asset-uid`)

**Changes Made:**

Steps 1-3 now support:
```bash
# Filter by system name (fuzzy match)
--system "Schenker"

# Filter by exact asset_uid
--asset-uid "abc-123"

# Can use both together (AND logic)
--system "Watermaker" --asset-uid "abc-123"
```

---

## 🚧 NEXT STEPS (RESUME HERE)

### **IMMEDIATE: Finish Adding Filters**

**Step 4: `deduplicate-tasks.js`**
Add filtering after line 240 where tasks are fetched:
```javascript
// After: const allTasks = await fetchAllTasksFromPinecone();

// Add argument parsing
const args = process.argv.slice(2);
const systemIndex = args.indexOf('--system');
const assetUidIndex = args.indexOf('--asset-uid');
const systemFilter = systemIndex !== -1 ? args[systemIndex + 1] : null;
const assetUidFilter = assetUidIndex !== -1 ? args[assetUidIndex + 1] : null;

// Filter tasks
let filteredTasks = allTasks;
if (systemFilter) {
  console.log(`🔍 Filtering by system name: "${systemFilter}"\n`);
  filteredTasks = filteredTasks.filter(t =>
    t.system_name && t.system_name.toLowerCase().includes(systemFilter.toLowerCase())
  );
}
if (assetUidFilter) {
  console.log(`🔍 Filtering by asset_uid: "${assetUidFilter}"\n`);
  filteredTasks = filteredTasks.filter(t => t.asset_uid === assetUidFilter);
}

console.log(`Filtered to ${filteredTasks.length} tasks\n`);

// Then use filteredTasks instead of allTasks for the rest of the script
```

**Step 5: `deduplicate-tasks-forreview.js`**
Same changes as Step 4 (copy the filtering code)

**Step 6: `classify-and-discover.js`**
Already has `--system`, add `--asset-uid` support around line 156:
```javascript
// After existing systemFilter code, add:
const assetUidIndex = args.indexOf('--asset-uid');
const assetUidFilter = assetUidIndex !== -1 ? args[assetUidIndex + 1] : null;

// In the query filter (around line 172):
if (assetUidFilter) {
  console.log(`🔍 Also filtering by asset_uid: "${assetUidFilter}"`);
  queryFilter = {
    ...queryFilter,
    asset_uid: { $eq: assetUidFilter }
  };
}
```

### **AFTER Filtering is Complete:**

1. **Test the full pipeline** on Schenker watermaker with asset_uid
2. **Run for other systems** (one at a time to avoid pollution)
3. **Document any issues** in this file

---

## 📊 CURRENT STATE: WATERMAKER EXAMPLE

After running Steps 1-7 on Schenker watermaker:

**Tasks in Pinecone:** 83 total
- 78 extracted from manual
- 5 discovered by LLM

**Classification Breakdown:**
- 20 MAINTENANCE (25%)
- 10 INSTALLATION (13%)
- 53 VAGUE (67%)
- 0 PRE_USE_CHECK

**Next Action:** Use UI to review/clean VAGUE tasks, delete INSTALLATION tasks

---

## 🔑 KEY CONCEPTS TO REMEMBER

### **Namespace Structure:**
- `REIMAGINEDDOCS` - Document chunks (from PDFs)
- `MAINTENANCE_TASKS` - Extracted maintenance tasks

### **Database Tables:**
- `systems` - List of equipment/systems on the boat
- `pinecone_search_results` - Intermediate table storing chunk search results
- (Step 3 reads this table to know which chunks to extract from)

### **Filtering Priority:**
- `--asset-uid` is EXACT match (most precise)
- `--system` is fuzzy name match (more flexible)
- Use `--asset-uid` when you know it
- Use `--system` when you don't have the UID

### **Why Dedup BEFORE Classify:**
Don't waste LLM calls classifying duplicates that will be deleted

### **Two Types of Discovery:**
1. **Step 2:** Discovers chunks (LLM generates search terms)
2. **Step 6:** Discovers tasks (LLM generates missing maintenance items)

---

## 🐛 KNOWN ISSUES

1. **Classification variance:** Running classify twice gives slightly different results (even at temperature=0)
2. **Embedding dimension:** MUST use `text-embedding-3-large` (3072 dims) - using 3-small (1536 dims) causes upload failure
3. **Step 4/5 need filtering:** Currently process ALL tasks regardless of system (inefficient)

---

## 📝 CODE REFERENCE

### Timeline View
**File:** `/src/public/maintenance-tasks-list.html`
**Key sections:**
- Lines 360-374: View toggle HTML
- Lines 428-596: Timeline CSS
- Lines 896-1014: `renderTimeline()` function
- Lines 1308-1421: Modal functions

### Pipeline Scripts
**Location:** `/maintenance-agent/scripts/`
- `capture-pinecone-scores.js` - Step 1
- `LLM_powered_vector_search.js` - Step 2
- `extract-enrich-and-upload-tasks.js` - Step 3
- `deduplicate-tasks.js` - Step 4
- `deduplicate-tasks-forreview.js` - Step 5
- `classify-and-discover.js` - Step 6

### API Endpoints
**File:** `/src/routes/admin/maintenance-tasks.route.js`
- `GET /list` - Fetch all tasks
- `PATCH /:taskId` - Update task metadata
- `DELETE /:taskId` - Delete task

---

## ⚡ QUICK RECOVERY COMMANDS

If starting a new session and need context:

```bash
# See what's in Pinecone
http://localhost:3000/public/maintenance-tasks-list.html

# Check which systems exist
# (Query Supabase systems table via your preferred method)

# Test filtering on one system
node maintenance-agent/scripts/capture-pinecone-scores.js --system "Schenker"
```

---

**END OF SESSION 28 DOCUMENTATION**

**NEXT SESSION: Finish adding filters to Steps 4-6, then test full pipeline on a new system.**

next step next: next for 1 and 2 we need a --test mode when used it writes the results to pinecone_search_results_test and for 3 when we use --test it reads from pinecone_search_results_test 