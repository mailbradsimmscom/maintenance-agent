# Frontend Migration Guide: Maintenance Agent → Main System

**Status:** Phase 6 Complete (Option A)
**Next Step:** Migrate to main system for iOS integration (Option B)
**Date:** 2025-10-23

---

## Overview

The maintenance agent currently has **5 standalone HTML pages** running on **port 3001**. These need to be migrated to the main system (port 3000) for iOS app integration.

---

## Current Architecture (Option A - Standalone)

```
maintenance-agent (Port 3001)
├── public/
│   ├── index.html            ← Dashboard/landing page
│   ├── hours-update.html     ← Update operating hours + history
│   ├── todos.html            ← Aggregated to-do list
│   ├── approvals.html        ← Task approval queue
│   └── task-completion.html  ← Mark tasks complete
├── src/routes/admin/         ← 24 API endpoints
└── src/index.js              ← Express server (static files + APIs)
```

**Access:** `http://localhost:3001/`

---

## Target Architecture (Option B - Integrated)

```
REIMAGINEDAPPV2 (Port 3000)
├── src/public/
│   ├── maintenance-hours.html      ← Migrated from hours-update.html
│   ├── maintenance-todos.html      ← Migrated from todos.html
│   ├── maintenance-approvals.html  ← Migrated from approvals.html
│   └── maintenance-completion.html ← Migrated from task-completion.html
└── src/public/js/
    └── maintenance-api.js          ← Shared API client (CORS to port 3001)
```

**Access:** `http://localhost:3000/maintenance-hours.html`

---

## Migration Steps

### Step 1: Copy HTML Files to Main System

```bash
cd /Users/brad/code/REIMAGINEDAPPV2

# Copy pages (rename for clarity)
cp maintenance-agent/public/hours-update.html src/public/maintenance-hours.html
cp maintenance-agent/public/todos.html src/public/maintenance-todos.html
cp maintenance-agent/public/approvals.html src/public/maintenance-approvals.html
cp maintenance-agent/public/task-completion.html src/public/maintenance-completion.html
```

### Step 2: Update API Base URL in Each File

Currently pages use `/admin/api` (same-origin).
After migration, must use `http://localhost:3001/admin/api` (cross-origin).

**Find and replace in each file:**
```javascript
// Before (Option A - same origin)
const API_BASE = '/admin/api';

// After (Option B - cross origin)
const API_BASE = 'http://localhost:3001/admin/api';
```

**Example diff:**
```diff
--- maintenance-agent/public/hours-update.html
+++ REIMAGINEDAPPV2/src/public/maintenance-hours.html
@@ -123,7 +123,7 @@
     </div>

     <script>
-        const API_BASE = '/admin/api';
+        const API_BASE = 'http://localhost:3001/admin/api';
         let currentAssetUid = null;
```

**Files to update:**
- `maintenance-hours.html` (line ~123)
- `maintenance-todos.html` (line ~78)
- `maintenance-approvals.html` (line ~114)
- `maintenance-completion.html` (line ~107)

### Step 3: Ensure CORS is Configured

**Already done in Phase 5!** The maintenance-agent Express server has CORS enabled:

```javascript
// src/index.js (line 59-62)
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',  // Allows requests from port 3000
  credentials: true,
}));
```

✅ **No changes needed** - APIs are already accessible cross-origin.

### Step 4: Update Navigation Links

**Option A (current):** Links use relative paths
```html
<a href="hours-update.html">Hours Update</a>
```

**Option B (after migration):** Update to new filenames
```html
<a href="maintenance-hours.html">Hours Update</a>
```

**Files to update:**
- All 4 HTML files (update `<a href="/">` back links)
- Main system dashboard (add links to new pages)

### Step 5: (Optional) Create Shared API Client

Instead of duplicating `const API_BASE` in every file, create a shared module:

```javascript
// src/public/js/maintenance-api.js
const API_BASE = 'http://localhost:3001/admin/api';

const MaintenanceAPI = {
  async updateHours(assetUid, data) {
    const response = await fetch(`${API_BASE}/system-maintenance/${assetUid}/hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  },

  async getTodos() {
    const response = await fetch(`${API_BASE}/todo`);
    return response.json();
  },

  // ... other methods
};
```

Then in HTML files:
```html
<script src="/js/maintenance-api.js"></script>
<script>
  async function loadTodos() {
    const data = await MaintenanceAPI.getTodos();
    // ... render data
  }
</script>
```

---

## Testing Checklist

After migration, test each page:

- [ ] **maintenance-hours.html**
  - [ ] Page loads without errors
  - [ ] Can select test system from dropdown
  - [ ] Can submit hours update (test with 250 hours)
  - [ ] History loads and displays correctly
  - [ ] Validation works (try submitting lower hours)

- [ ] **maintenance-todos.html**
  - [ ] Page loads without errors
  - [ ] To-do list fetches from API
  - [ ] Shows correct badges (BoatOS, maintenance, approval)
  - [ ] Handles empty state ("All caught up")

- [ ] **maintenance-approvals.html**
  - [ ] Page loads without errors
  - [ ] Pending tasks load (if any exist)
  - [ ] Checkbox selection works
  - [ ] Bulk approve/reject buttons work
  - [ ] Success/error messages display

- [ ] **maintenance-completion.html**
  - [ ] Page loads without errors
  - [ ] Can enter task ID and complete
  - [ ] Shows next due date for recurring tasks
  - [ ] Shows confirmation for one-time tasks

---

## Production Considerations

### For Render Deployment:

**Environment Variable:**
```bash
# In main system's .env
MAINTENANCE_AGENT_URL=https://maintenance-agent.onrender.com

# Update API_BASE in HTML files to use this variable
# (requires server-side rendering or build step)
```

**Alternative:** Use relative proxy

Add to main system's Express server:
```javascript
// Proxy /api/maintenance to maintenance-agent
app.use('/api/maintenance', createProxyMiddleware({
  target: 'https://maintenance-agent.onrender.com',
  changeOrigin: true,
  pathRewrite: { '^/api/maintenance': '/admin/api' }
}));
```

Then HTML files can use:
```javascript
const API_BASE = '/api/maintenance';  // Same-origin via proxy
```

---

## Benefits of Option B (Integrated)

1. ✅ **Single URL** for users (port 3000 only)
2. ✅ **Unified navigation** across all pages
3. ✅ **iOS app** can use same endpoints
4. ✅ **No CORS issues** in production (via proxy)
5. ✅ **Consistent auth** (shared session/tokens)

---

## Timeline Estimate

**Migration effort:** ~2-3 hours
- Copy files: 15 min
- Update API URLs: 30 min
- Test all pages: 90 min
- Update navigation: 30 min

**Total:** Minimal effort, low risk

---

## Rollback Plan

If migration causes issues:
1. Pages still work standalone on port 3001
2. Can revert to Option A instantly
3. No changes to backend/APIs required

---

**Status:** Documentation complete. Ready for iOS migration when needed.
