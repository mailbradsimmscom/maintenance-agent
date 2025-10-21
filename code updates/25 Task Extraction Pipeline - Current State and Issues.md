# 25. Task Extraction Pipeline - Current State and Issues

**Date:** 2025-10-21
**Status:** 🚨 CRITICAL - Duplicate Issue Identified
**Problem:** Risk of duplicating existing Pinecone tasks

---

## 🚨 CRITICAL ISSUE: Duplicate Upload Risk

### The Problem:
**The extraction script does NOT check what's already in Pinecone before uploading.**

Every time you run `extract-enrich-and-upload-tasks.js`, it:
1. Reads ALL chunks from `pinecone_search_results` table
2. Extracts tasks from those chunks
3. Generates NEW task IDs: `task-${Date.now()}-${i}`
4. Uploads to Pinecone (even if same task already exists)

**Result:** Running the script twice = duplicate tasks in Pinecone

---

## 📊 CURRENT STATE (As of 2025-10-21)

### Database: `pinecone_search_results` (Supabase)
```
Total chunks: 387
  - Yanmar/Engine chunks: ~9 (scores 0.50-0.57)
  - Watermaker chunks: ~378 (scores 0.30-0.57)
    - High-scoring watermaker (≥0.50): ~9 chunks
    - Low-scoring watermaker (0.30-0.49): ~369 chunks
```

### Database: Pinecone MAINTENANCE_TASKS namespace
```
Total tasks: 55 (YANMAR TASKS ALREADY UPLOADED)
  - These were uploaded at some point (unclear when/how)
  - Watermaker tasks: 0 (not uploaded yet)
```

### Files Generated:
```
dry-run-tasks-1761004971817.json (103 Yanmar tasks - from dry-run, never uploaded)
deduplication-results-*.json (multiple files from dedup testing)
```

---

## 🔄 WHAT WE DID TODAY (Session 25)

### Step 1: Combined Two Scripts into One
**OLD (inefficient):**
- `extract-high-scores.js` → Extract tasks from chunks
- `import-all-with-ai-enrichment.js` → Classify frequency_basis + task_type

**NEW (optimized):**
- `extract-enrich-and-upload-tasks.js` → Extract + Classify + Upload in one script
- Saves 50% API calls (68 instead of 136)

### Step 2: Added Dry-Run Mode
```bash
node scripts/extract-enrich-and-upload-tasks.js --dry-run
```
- Extracts tasks
- Shows results
- Saves to JSON
- **DOES NOT UPLOAD to Pinecone**

### Step 3: Tested with Yanmar (Dry-Run)
```bash
node scripts/extract-enrich-and-upload-tasks.js --dry-run
```
**Result:**
- 9 chunks processed
- 103 tasks extracted
- Saved to `dry-run-tasks-1761004971817.json`
- **NOT uploaded to Pinecone** (dry-run)

**BUT:** Somehow 55 Yanmar tasks are ALREADY in Pinecone (from previous session?)

### Step 4: Added Watermaker System
```bash
node scripts/capture-pinecone-scores.js --system "watermaker"
```
**Result:**
- 378 watermaker chunks added to `pinecone_search_results`
- 9 chunks score ≥50% (eligible for extraction)

### Step 5: Created Watermaker-Only Script
**File:** `extract-enrich-and-upload-tasks-watermaker.js`
- Filters `pinecone_search_results` to ONLY watermaker chunks
- Avoids re-processing Yanmar chunks

---

## 🗂️ SCRIPT INVENTORY

### Script 1: `capture-pinecone-scores.js`
**Purpose:** Find maintenance-related chunks in uploaded PDFs

**Reads from:**
- Supabase `systems` table (list of all equipment)
- Pinecone `REIMAGINEDDOCS` namespace (PDF chunks)

**Writes to:**
- Supabase `pinecone_search_results` table

**How it works:**
1. Gets systems from database (optionally filtered by `--system` flag)
2. For each system, queries Pinecone for chunks similar to "maintenance service inspection cleaning..."
3. Keeps chunks with score ≥30%
4. Stores chunks in `pinecone_search_results` table

**Usage:**
```bash
# All systems
node scripts/capture-pinecone-scores.js

# Specific system
node scripts/capture-pinecone-scores.js --system "watermaker"
```

**When to run:** After PDFs are uploaded, before task extraction

---

### Script 2: `extract-enrich-and-upload-tasks.js`
**Purpose:** Extract tasks from chunks and upload to Pinecone

**Reads from:**
- Supabase `pinecone_search_results` table (chunks with score ≥50%)

**Writes to:**
- Pinecone `MAINTENANCE_TASKS` namespace

**How it works:**
1. Gets chunks from `pinecone_search_results` where score ≥50%
2. For each chunk, calls OpenAI to:
   - Extract tasks (description, frequency, etc.)
   - Classify frequency_basis (calendar/usage/event/condition)
   - Classify task_type (fluid_check, parts_replacement, etc.)
3. Normalizes frequency to hours
4. Generates embeddings for each task
5. Uploads to Pinecone with unique ID: `task-${Date.now()}-${i}`

**⚠️ CRITICAL:** Generates NEW task IDs every time = duplicates if run twice

**Usage:**
```bash
# Dry-run (no upload)
node scripts/extract-enrich-and-upload-tasks.js --dry-run

# Real upload
node scripts/extract-enrich-and-upload-tasks.js
```

**When to run:** After `capture-pinecone-scores.js`, once per system

---

### Script 3: `extract-enrich-and-upload-tasks-watermaker.js`
**Purpose:** Extract tasks ONLY from watermaker chunks

**Same as Script 2, but:**
- Filters `pinecone_search_results` to only watermaker systems
- Prevents re-processing Yanmar chunks

**Usage:**
```bash
node scripts/extract-enrich-and-upload-tasks-watermaker.js
```

**When to run:** When you want to add watermaker tasks WITHOUT duplicating Yanmar

---

### Script 4: `deduplicate-tasks-forreview.js`
**Purpose:** Find duplicate tasks in Pinecone for human review

**Reads from:**
- Pinecone `MAINTENANCE_TASKS` namespace

**Writes to:**
- `deduplication-results-{timestamp}.json`

**How it works:**
1. Fetches ALL tasks from Pinecone (with embeddings)
2. In-memory pairwise comparison (cosine similarity)
3. Finds pairs with ≥65% similarity + matching metadata
4. Saves pairs to JSON for human review

**Usage:**
```bash
node scripts/deduplicate-tasks-forreview.js
```

**When to run:** After task upload, before human review

---

### Script 5: Human Review UI
**URL:** `http://localhost:3000/public/maintenance-review.html`

**Reads from:**
- Latest `deduplication-results-{timestamp}.json` file
- Supabase `reviewed_task_pairs` table
- Supabase `deleted_duplicate_tasks` table

**Writes to:**
- Supabase `duplicate_review_decisions` table (ML training data)
- Supabase `reviewed_task_pairs` table (prevent re-showing)
- Supabase `deleted_duplicate_tasks` table (audit trail)
- Pinecone `MAINTENANCE_TASKS` (deletes chosen duplicate)

**How it works:**
1. Loads pairs from JSON
2. Filters out already-reviewed pairs
3. Filters out pairs with deleted tasks
4. Shows side-by-side comparison
5. User picks which task to delete (or keep both)
6. Deletes from Pinecone and saves decision to database

---

## 📋 CORRECT WORKFLOW (No Duplicates)

### First Time Setup (Per System):

```bash
# 1. Find maintenance chunks for system
node scripts/capture-pinecone-scores.js --system "yanmar"

# 2. Extract and upload tasks (ONCE ONLY)
node scripts/extract-enrich-and-upload-tasks.js

# 3. Find duplicates
node scripts/deduplicate-tasks-forreview.js

# 4. Review in browser
# Open: http://localhost:3000/public/maintenance-review.html
```

### Adding Another System (Avoid Duplicates):

**Option A: Use system-specific script**
```bash
# 1. Find watermaker chunks
node scripts/capture-pinecone-scores.js --system "watermaker"

# 2. Extract ONLY watermaker (avoids re-processing Yanmar)
node scripts/extract-enrich-and-upload-tasks-watermaker.js

# 3. Run dedup
node scripts/deduplicate-tasks-forreview.js
```

**Option B: Clear Pinecone first (nuclear option)**
```bash
# 1. Delete ALL tasks from Pinecone
# (would need to write a script for this)

# 2. Re-run extraction for ALL systems
node scripts/extract-enrich-and-upload-tasks.js
```

---

## 🚨 CURRENT PROBLEM

### State Before Next Step:
```
pinecone_search_results table:
  - Yanmar chunks: 9
  - Watermaker chunks: 378 (9 high-scoring ≥50%)

Pinecone MAINTENANCE_TASKS:
  - Yanmar tasks: 55 (already uploaded)
  - Watermaker tasks: 0
```

### If You Run Main Script:
```bash
node scripts/extract-enrich-and-upload-tasks.js
```

**What happens:**
1. Processes Yanmar chunks → extracts ~103 tasks
2. Processes Watermaker chunks → extracts ~30 tasks
3. Uploads ALL to Pinecone with NEW IDs
4. **Result: 55 old Yanmar + 103 new Yanmar + 30 watermaker = 188 tasks (48 duplicates)**

### Solution: Run Watermaker-Only Script:
```bash
node scripts/extract-enrich-and-upload-tasks-watermaker.js
```

**What happens:**
1. Processes ONLY watermaker chunks → extracts ~30 tasks
2. Uploads to Pinecone
3. **Result: 55 Yanmar + 30 watermaker = 85 tasks (no duplicates)**

---

## ✅ WHAT TO DO NEXT

### Immediate Next Steps:

**Step 1: Upload Watermaker Tasks (No Duplicates)**
```bash
cd /Users/brad/code/REIMAGINEDAPPV2/maintenance-agent
node scripts/extract-enrich-and-upload-tasks-watermaker.js
```

**Expected output:**
- ~9 chunks processed
- ~20-40 watermaker tasks extracted
- Tasks uploaded to Pinecone MAINTENANCE_TASKS
- No Yanmar duplicates

**Step 2: Verify Upload**
```bash
node scripts/list-unique-tasks.js
```

**Expected output:**
- Total tasks: ~85-95 (55 Yanmar + 30-40 watermaker)
- Lists all task descriptions

**Step 3: Find Duplicates**
```bash
node scripts/deduplicate-tasks-forreview.js
```

**Expected output:**
- Saves `deduplication-results-{timestamp}.json`
- Shows duplicate pairs (if any)

**Step 4: Review Duplicates**
```bash
# Start server if not running
cd /Users/brad/code/REIMAGINEDAPPV2
bash restart-all.sh

# Open browser
# http://localhost:3000/public/maintenance-review.html
```

---

## 🔧 FIXES NEEDED (Future)

### Fix 1: Idempotent Upload
**Problem:** Script generates new task IDs every time

**Solution:** Generate deterministic IDs based on content
```javascript
// Instead of:
const taskId = `task-${Date.now()}-${i}`;

// Use:
const taskId = generateDeterministicId(task.description, task.asset_uid);
```

**Benefit:** Running script twice won't create duplicates

### Fix 2: Check Before Upload
**Problem:** Script doesn't check what's already in Pinecone

**Solution:** Query Pinecone before upload
```javascript
const existingTasks = await pineconeRepository.queryByDescription(task.description);
if (existingTasks.length > 0) {
  console.log('Task already exists, skipping...');
  continue;
}
```

**Benefit:** Automatic deduplication at upload time

### Fix 3: Track Processed Chunks
**Problem:** No record of which chunks have been processed

**Solution:** Add `processed` column to `pinecone_search_results`
```sql
ALTER TABLE pinecone_search_results
ADD COLUMN processed BOOLEAN DEFAULT FALSE;
```

**Benefit:** Script only processes new chunks

### Fix 4: Automation
**Problem:** Manual script execution for each step

**Solution:** Event-driven pipeline
```
PDF uploaded → Webhook → capture-pinecone-scores → extract-tasks → dedup → review queue
```

**Benefit:** Fully automated workflow

---

## 📊 DATA INVENTORY

### Supabase Tables:

**`systems`**
- All equipment/systems in database
- Used by: `capture-pinecone-scores.js`

**`pinecone_search_results`**
- Maintenance-related chunks found by semantic search
- 387 total chunks (Yanmar + Watermaker)
- Used by: `extract-enrich-and-upload-tasks.js`

**`duplicate_review_decisions`**
- Human decisions on duplicate pairs
- Used for ML training
- Used by: Review UI

**`reviewed_task_pairs`**
- Cache of reviewed pairs (prevents re-showing)
- Used by: Review UI

**`deleted_duplicate_tasks`**
- Audit trail of deleted tasks
- Used by: Review UI

### Pinecone Namespaces:

**`REIMAGINEDDOCS`**
- All PDF chunks from uploaded documents
- Used by: `capture-pinecone-scores.js`

**`MAINTENANCE_TASKS`**
- Extracted maintenance tasks with embeddings
- 55 tasks currently (Yanmar only)
- Used by: Deduplication, Review UI

### Files:

**`dry-run-tasks-1761004971817.json`**
- 103 Yanmar tasks from dry-run test
- Never uploaded to Pinecone

**`deduplication-results-*.json`**
- Duplicate pairs for human review
- Multiple files from testing

---

## 🎯 SUMMARY

**Where we are:**
- ✅ Optimized extraction script (50% fewer API calls)
- ✅ Added dry-run mode
- ✅ Tested with Yanmar (dry-run)
- ✅ Added watermaker chunks to search results
- ✅ Created watermaker-only extraction script
- ⚠️ Have 55 Yanmar tasks in Pinecone (from previous session)
- 🚨 Risk of duplicates if we use main script

**What to do:**
1. Run `extract-enrich-and-upload-tasks-watermaker.js` (adds watermaker, no duplicates)
2. Verify with `list-unique-tasks.js`
3. Run `deduplicate-tasks-forreview.js`
4. Review in UI

**Long-term fixes needed:**
- Idempotent task IDs (content-based, not timestamp)
- Check Pinecone before upload
- Track processed chunks
- Automate workflow

---

## 📞 CONTACT POINTS

**If context is lost:**
1. Read this document
2. Check `pinecone_search_results` table (what chunks exist)
3. Check Pinecone MAINTENANCE_TASKS (what tasks exist)
4. Check `list-unique-tasks.js` output (current state)

**Common questions:**
- **How many tasks in Pinecone?** → Run `list-unique-tasks.js`
- **What chunks are ready?** → Query `pinecone_search_results WHERE relevance_score >= 0.50`
- **Did I already process this?** → No tracking exists (PROBLEM!)
- **Will this duplicate?** → YES if chunk was already processed

---

## 🔬 SESSION 26 UPDATE (2025-10-21)

### Key Changes & Improvements

#### 1. **Temperature Reduction for Deterministic Extraction**
**Problem:** Temperature 0.3 caused variations in task extraction - same chunk could produce different descriptions each time.

**Solution:** Reduced temperature to 0.0 in both extraction scripts
- `extract-enrich-and-upload-tasks.js` line 102
- `extract-enrich-and-upload-tasks-TEST.js` line 98

**Impact:** Same chunk should now produce 95%+ similar tasks on repeat runs, making 85% auto-delete threshold effective.

---

#### 2. **LLM-Powered Vector Search (GAME CHANGER)**

**Problem:** Generic search query `"maintenance schedule inspection service interval replacement"` produced poor results:
- Watermaker: 3 chunks found, all 30-40% scores (too low quality)
- Engine-focused terminology didn't match watermaker maintenance vocabulary

**Solution:** Created `LLM_powered_vector_search.js`
- For each system, GPT-4o-mini generates 5-8 system-specific maintenance terms
- Creates embedding from those terms
- Queries Pinecone filtered by asset_uid

**Results Comparison (Schenker Watermaker):**

| Metric | Generic Search | LLM-Powered Search |
|--------|---------------|-------------------|
| Chunks Found | 3 | 20 |
| Score Range | 30-40% | 55-68% |
| Avg Score | 35% | **61%** (↑74%) |
| Chunks >= 50% | 0 | **20** |

**Example LLM-generated terms:**
```
Schenker zen_150 watermaker maintenance, marine plumbing system service,
watermaker filter replacement procedures, Schenker watermaker troubleshooting,
hull plumbing maintenance checklist, 48V watermaker parts replacement,
marine watermaker routine maintenance, seawater intake strainer cleaning
```

**Key Insight:** System-specific terminology dramatically improves search quality. LLM understands domain vocabulary (e.g., "membrane pickling", "fresh water flush" for watermakers vs "lubrication", "belt tension" for engines).

---

#### 3. **Database Schema Updates**

**Added columns to `pinecone_search_results`:**
```sql
ALTER TABLE pinecone_search_results
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'generic'
CHECK (type IN ('generic', 'LLM'));

ALTER TABLE pinecone_search_results
ADD COLUMN IF NOT EXISTS search_terms TEXT;
```

**Purpose:**
- `type`: Track which search method was used ('generic' or 'LLM')
- `search_terms`: Store the actual search terms generated/used for audit trail

**Updated scripts:**
- `capture-pinecone-scores.js`: Sets `type='generic'`
- `LLM_powered_vector_search.js`: Sets `type='LLM'` and stores generated terms

---

#### 4. **Test Table Infrastructure**

**Created test environment to safely test extraction without affecting production:**

**Tables:**
- `pinecone_search_results_test` - Copy of main table structure

**Scripts:**
- `copy-to-test-table.js` - Copy rows to test table (with filters)
- `extract-enrich-and-upload-tasks-TEST.js` - Extract from test table

**Workflow:**
```bash
# 1. Copy specific rows to test
node scripts/copy-to-test-table.js --system "Schenker" --clear

# 2. Test extraction
node scripts/extract-enrich-and-upload-tasks-TEST.js

# 3. Review results without affecting production chunks
```

---

#### 5. **Manual Review UI Enhancement**

**Added "Delete Both Tasks" button** to `/public/maintenance-review.html`

**Why needed:** Sometimes both Task A and Task B are incorrect/unwanted (e.g., installation steps, not maintenance tasks).

**Implementation:**
- **Frontend:** Added 4th button "❌❌ Delete Both Tasks"
- **Backend route:** Updated validation to accept `delete_which: 'both'`
- **Backend service:** Deletes both tasks from Pinecone, saves both to audit trail
- **Database:** Added `'deleted_both'` to action_taken constraint

**Migration:**
```sql
ALTER TABLE duplicate_review_decisions
DROP CONSTRAINT IF EXISTS duplicate_review_decisions_action_taken_check;

ALTER TABLE duplicate_review_decisions
ADD CONSTRAINT duplicate_review_decisions_action_taken_check
CHECK (action_taken IN ('deleted_task_a', 'deleted_task_b', 'deleted_both', 'kept_both'));
```

---

#### 6. **Maintenance Tasks Browser Page**

**Created:** `/public/maintenance-tasks-list.html`

**Purpose:** Browse all extracted maintenance tasks with filtering

**Features:**
- **Stats Dashboard:** Total tasks, systems count, avg frequency
- **Filters:**
  - Search by description
  - Filter by system
  - Filter by frequency basis (calendar/usage/event/condition)
  - Filter by task type
- **Task Cards:** Show all metadata
  - Description
  - System
  - Frequency (value + type)
  - Basis (calendar/usage/event/condition)
  - Task type
  - Criticality
  - Confidence score

**API Endpoint:** `/admin/api/maintenance-tasks/list`
- Fetches all tasks from Pinecone `MAINTENANCE_TASKS` namespace
- Uses main app's Pinecone config (not maintenance-agent's)
- Returns simplified task objects

**Access:** `http://localhost:3000/public/maintenance-tasks-list.html`

---

#### 7. **Current Pipeline Status**

**What works:**
1. ✅ LLM-powered search finds high-quality chunks (55-68% scores)
2. ✅ Temperature 0.0 makes extraction deterministic
3. ✅ Test environment allows safe experimentation
4. ✅ Manual review UI has "Delete Both" option
5. ✅ Browser UI to inspect all tasks

**Current State (After Session 26):**
- Pinecone `MAINTENANCE_TASKS`: 78 tasks (mostly watermaker from test run)
- Test successful: LLM search → extraction → deduplication → review
- Score distribution improved dramatically for watermaker

---

#### 8. **Issues Encountered & Fixes**

**Issue 1: Pinecone Index Name Confusion**
- **Problem:** maintenance-agent `.env` has `PINECONE_INDEX_NAME=reimaginedsv` but main app uses `PINECONE_INDEX=reimaginedsv`
- **Error:** "Index 'documents' not found" (404)
- **Fix:** Browse UI now uses main app's Pinecone client directly instead of importing from maintenance-agent

**Issue 2: Duplicate Detection Not Catching Duplicates**
- **Problem:** 85% threshold missed duplicates because temp=0.3 caused variation
- **Fix:** Set temp=0.0 for deterministic output

**Issue 3: Watermaker Tasks Scored Too Low**
- **Problem:** Generic search found 0 chunks >= 50%
- **Fix:** LLM-powered search with system-specific terms

---

### 📊 Updated Pipeline (Final)

```bash
# STEP 1: Find maintenance chunks (LLM-powered)
node scripts/LLM_powered_vector_search.js --system "Schenker"

# STEP 2: Extract tasks and upload
node scripts/extract-enrich-and-upload-tasks.js

# STEP 3A: Auto-delete high-confidence duplicates (85%+)
node scripts/deduplicate-tasks.js --delete

# STEP 3B: Manual review lower-confidence duplicates (65-84%)
node scripts/deduplicate-tasks-forreview.js
# Then review at: http://localhost:3000/public/maintenance-review.html

# STEP 4: Browse all tasks
# Open: http://localhost:3000/public/maintenance-tasks-list.html
```

---

### 🔮 Next Steps

#### Immediate (Production Ready):
1. **Run LLM-powered search for ALL systems** (not just watermaker)
   ```bash
   node scripts/LLM_powered_vector_search.js
   ```
   - Will process all systems in batches
   - 1-second delay between LLM calls (rate limiting)
   - Cost: ~$0.01-0.05 for all systems

2. **Extract tasks from high-quality chunks**
   ```bash
   node scripts/extract-enrich-and-upload-tasks.js
   ```

3. **Clean up duplicates**
   ```bash
   node scripts/deduplicate-tasks.js --delete
   node scripts/deduplicate-tasks-forreview.js
   ```

4. **Manual review** of any remaining duplicates or junk tasks (installation steps, operational procedures)

#### Medium-Term Improvements:
1. **Add `processed` column** to `pinecone_search_results`
   - Track which chunks have been extracted
   - Prevent re-processing same chunks

2. **Content-based task IDs** instead of timestamp
   ```javascript
   // Instead of: task-${Date.now()}-${i}
   // Use: task-${hash(description + asset_uid + frequency)}
   ```
   - Makes uploads idempotent
   - Prevents duplicates at upload time

3. **Automated pipeline**
   - Trigger on PDF upload
   - Auto-run: LLM search → extract → dedup → queue for review
   - Event-driven workflow

4. **Quality filtering**
   - Automatically exclude installation/operational tasks
   - LLM-based classification: "Is this recurring maintenance?"
   - Filter out condition_based tasks with N/A frequency

#### Long-Term:
1. **ML-based deduplication**
   - Train model on human review decisions
   - Auto-classify duplicates at 75%+ confidence
   - Reduce manual review burden

2. **Task enrichment**
   - Add parts catalog links
   - Estimate labor hours
   - Link to vendor manuals

3. **Maintenance scheduling**
   - Generate actual calendar events
   - Track completion
   - Send reminders

---

### 📁 Files Modified/Created (Session 26)

**Created:**
- `scripts/LLM_powered_vector_search.js` - System-specific search term generation
- `scripts/copy-to-test-table.js` - Test data management
- `scripts/create-test-table-simple.js` - Test table creation helper
- `src/public/maintenance-tasks-list.html` - Task browser UI
- `src/routes/admin/maintenance-tasks.route.js` - API endpoint for task list
- `migrations/add-search-type-column.sql` - Add 'type' column
- `migrations/add-search-terms-column.sql` - Add 'search_terms' column
- `migrations/add-deleted-both-action.sql` - Support "Delete Both" feature
- `migrations/update-test-table-columns.sql` - Test table schema updates

**Modified:**
- `scripts/extract-enrich-and-upload-tasks.js` - Temperature 0.0
- `scripts/extract-enrich-and-upload-tasks-TEST.js` - Temperature 0.0, threshold 0.50
- `scripts/capture-pinecone-scores.js` - Add `type='generic'` field
- `src/public/maintenance-review.html` - Add "Delete Both" button
- `src/routes/admin/duplicate-review.route.js` - Accept `delete_which='both'`
- `src/services/duplicate-review.service.js` - Handle deleting both tasks
- `src/routes/admin/index.js` - Mount maintenance-tasks route
- `maintenance-agent/src/repositories/pinecone.repository.js` - Index initialization logging

**Deleted (Obsolete):**
- `scripts/extract-high-scores.js` - Replaced by combined script
- `scripts/import-all-with-ai-enrichment.js` - Replaced by combined script
- `scripts/extract-enrich-and-upload-tasks-watermaker.js` - System-specific hack

---

### 💡 Key Learnings

1. **LLM-powered search is essential** for systems with specialized terminology
   - Generic search failed completely for watermaker (0 chunks >= 50%)
   - LLM search found 20 high-quality chunks (all >= 55%)

2. **Temperature matters for deduplication**
   - Temp 0.3: Same chunk → different tasks → duplicates score 65-84%
   - Temp 0.0: Same chunk → identical tasks → duplicates score 95%+

3. **Separate test environment is critical**
   - Prevented multiple "oh shit" moments
   - Allowed safe experimentation without polluting production

4. **Manual review needs flexibility**
   - "Delete Both" option handles edge cases (installation steps, junk tasks)
   - Not all pairs fit "keep one" decision model

5. **System-specific context is powerful**
   - Watermaker terms: membrane, pickling, preservation, sanitization
   - Engine terms: lubrication, belt tension, valve clearance
   - Generic terms miss domain-specific vocabulary

---

### 📞 Updated Contact Points

**If context is lost:**
1. Read this document (Session 26 update)
2. Check `pinecone_search_results` table + `type` column (generic vs LLM)
3. Check Pinecone MAINTENANCE_TASKS (78 tasks currently)
4. Browse tasks: `http://localhost:3000/public/maintenance-tasks-list.html`

**Common questions:**
- **How many tasks?** → Browse UI or `list-unique-tasks.js`
- **Which search method worked better?** → Check `type` column in `pinecone_search_results`
- **What were the search terms?** → Check `search_terms` column
- **Did LLM search run for all systems?** → Check row count by type: `SELECT type, COUNT(*) FROM pinecone_search_results GROUP BY type`

---

**END OF SESSION 26 UPDATE**

---

**END OF DOCUMENT**
