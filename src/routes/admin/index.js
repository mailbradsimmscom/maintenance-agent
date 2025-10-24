/**
 * Admin Routes Index
 * Registers all admin API routes for the maintenance agent
 */

import express from 'express';
import systemMaintenanceRouter from './system-maintenance.route.js';
import taskCompletionsRouter from './task-completions.route.js';
import boatosTasksRouter from './boatos-tasks.route.js';
import todoRouter from './todo.route.js';
import maintenanceTasksRouter from './maintenance-tasks.route.js';

const router = express.Router();

// Note: adminOnly middleware should be applied by parent router
// All routes here require admin authentication

// Mount Phase 1 routes
router.use('/system-maintenance', systemMaintenanceRouter);
router.use('/task-completions', taskCompletionsRouter);
router.use('/boatos-tasks', boatosTasksRouter);
router.use('/todo', todoRouter);
router.use('/maintenance-tasks', maintenanceTasksRouter);

export default router;
