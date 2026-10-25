const express = require('express');
const router = express.Router();

const migrationController = require('../controllers/migration.controller');
const sourceController = require('../controllers/source.controller');
const etlController = require('../controllers/etl.controller');
const pipelineController = require('../controllers/pipeline.controller');
const authController = require('../controllers/auth.controller');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth.middleware');
const { loginRateLimiter } = require('../middleware/rate-limiter.middleware');

// ==========================================
// 0. Autentikasi & RBAC (User, Role, Menu)
// ==========================================
router.post('/auth/login', loginRateLimiter, (req, res) => authController.login(req, res));
router.post('/auth/logout', requireAuth, (req, res) => authController.logout(req, res));
router.get('/auth/me', requireAuth, (req, res) => authController.getMe(req, res));

// User Management CRUD (SUPERADMIN only)
router.get('/auth/users', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.getUsers(req, res));
router.post('/auth/users', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.createUser(req, res));
router.put('/auth/users/:id', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.updateUser(req, res));
router.post('/auth/users/:id/reset-password', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.resetPassword(req, res));
router.put('/auth/users/:id/reset-password', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.resetPassword(req, res));
router.delete('/auth/users/:id', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.deleteUser(req, res));

// Role Management CRUD (SUPERADMIN only)
router.get('/auth/roles', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.getRoles(req, res));
router.post('/auth/roles', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.createRole(req, res));
router.put('/auth/roles/:id', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.updateRole(req, res));
router.delete('/auth/roles/:id', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.deleteRole(req, res));

// Menu & Permissions Matrix CRUD (SUPERADMIN only for saving)
router.get('/auth/menus', requireAuth, (req, res) => authController.getMenus(req, res));
router.get('/auth/role-menus/:roleId', requireAuth, (req, res) => authController.getRolePermissions(req, res));
router.post('/auth/role-menus/:roleId', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.saveRolePermissions(req, res));
router.put('/auth/role-menus/:roleId', requireAuth, requireRole(['SUPERADMIN']), (req, res) => authController.saveRolePermissions(req, res));

// ==========================================
// 1. Core Health Check (Public untuk Liveness/Readiness probe)
// ==========================================
router.get('/health', (req, res) => migrationController.getHealth(req, res));

// ==========================================
// 2. Global Context & Onboarding Wizard
// ==========================================
router.get('/context/status', optionalAuth, (req, res) => etlController.getStatus(req, res));
router.post('/context/init-wizard', requireAuth, (req, res) => etlController.initWizard(req, res));

// Master Client CRUD
router.get('/context/clients', optionalAuth, (req, res) => etlController.getClients(req, res));
router.post('/context/clients', requireAuth, (req, res) => etlController.createClient(req, res));
router.put('/context/clients/:id', requireAuth, (req, res) => etlController.updateClient(req, res));
router.delete('/context/clients/:id', requireAuth, (req, res) => etlController.deleteClient(req, res));

// Master Environment CRUD
router.get('/context/environments', optionalAuth, (req, res) => etlController.getEnvironments(req, res));
router.get('/context/environments/:id/details', requireAuth, (req, res) => etlController.getEnvironmentDetails(req, res));
router.get('/context/environments/:id/health', requireAuth, (req, res) => etlController.getEnvironmentHealth(req, res));
router.post('/context/environments/save-with-connections', requireAuth, (req, res) => etlController.saveEnvironmentWithConnections(req, res));
router.post('/context/environments', requireAuth, (req, res) => etlController.createEnvironment(req, res));
router.put('/context/environments/:id', requireAuth, (req, res) => etlController.updateEnvironment(req, res));
router.delete('/context/environments/:id', requireAuth, (req, res) => etlController.deleteEnvironment(req, res));
router.post('/settings/environments/:id/sync-hop', requireAuth, (req, res) => etlController.syncHopConfig(req, res));
router.post('/context/environments/:id/sync-hop', requireAuth, (req, res) => etlController.syncHopConfig(req, res));

// Master Connection (Multiple DB) CRUD & Test Ping (Terproteksi Autentikasi)
router.get('/context/connections', requireAuth, (req, res) => etlController.getConnections(req, res));
router.post('/context/connections', requireAuth, (req, res) => etlController.createConnection(req, res));
router.put('/context/connections/:id', requireAuth, (req, res) => etlController.updateConnection(req, res));
router.delete('/context/connections/:id', requireAuth, (req, res) => etlController.deleteConnection(req, res));
router.post('/context/connections/test', requireAuth, (req, res) => etlController.testConnection(req, res));

// ==========================================
// 3. Modul 1: Source Data (SQL Server dbo Views & View Management)
// ==========================================
router.get('/source/views', requireAuth, (req, res) => sourceController.getViewsSummary(req, res));
router.get('/source/view-data', requireAuth, (req, res) => sourceController.getViewData(req, res));
router.get('/source/view-definition', requireAuth, (req, res) => sourceController.getViewDefinition(req, res));
router.post('/source/save-view-definition', requireAuth, (req, res) => sourceController.saveViewDefinition(req, res));
router.post('/source/create-view', requireAuth, (req, res) => sourceController.createOrAlterView(req, res));
router.post('/source/validate-query', requireAuth, (req, res) => sourceController.validateQuery(req, res));
router.delete('/source/drop-view/:viewName', requireAuth, (req, res) => sourceController.dropView(req, res));
router.post('/source/sync-all-views', requireAuth, (req, res) => sourceController.syncAllViews(req, res));

// ==========================================
// 4. Modul 2: Migration Config (Master Tables & CRUD)
// ==========================================
router.get('/etl/configs', requireAuth, (req, res) => etlController.getMasterConfigs(req, res));
router.get('/etl/configs/export', requireAuth, (req, res) => etlController.exportConfigs(req, res));
router.post('/etl/configs/import', requireAuth, (req, res) => etlController.importConfigs(req, res));
router.post('/etl/configs/test-precheck', requireAuth, (req, res) => etlController.testPrecheckSql(req, res));
router.get('/etl/configs/migration_config/defaults', requireAuth, (req, res) => etlController.generateConfigDefaults(req, res));
router.post('/etl/configs/migration_config/defaults', requireAuth, (req, res) => etlController.generateConfigDefaults(req, res));
router.get('/etl/configs/migration_target_config/defaults', requireAuth, (req, res) => etlController.generateTargetConfigDefaults(req, res));
router.post('/etl/configs/migration_target_config/defaults', requireAuth, (req, res) => etlController.generateTargetConfigDefaults(req, res));
router.post('/etl/configs/:table', requireAuth, (req, res) => etlController.createConfigRecord(req, res));
router.put('/etl/configs/:table/:id', requireAuth, (req, res) => etlController.updateConfigRecord(req, res));
router.delete('/etl/configs/:table/:id', requireAuth, (req, res) => etlController.deleteConfigRecord(req, res));

// ==========================================
// 5. Modul 3: Migration Proses (Execution & Log Monitoring)
// ==========================================
router.get('/etl/overview', requireAuth, (req, res) => etlController.getOverview(req, res));
router.get('/etl/runs', requireAuth, (req, res) => etlController.getRuns(req, res));
router.post('/etl/runs/:runId/cancel', requireAuth, (req, res) => etlController.cancelRun(req, res));
router.get('/etl/step-logs', requireAuth, (req, res) => etlController.getStepLogs(req, res));
router.get('/etl/error-logs', requireAuth, (req, res) => etlController.getErrorLogs(req, res));

// ==========================================
// 6. Modul 4: Hasil Migrasi (Pipeline 3-Tier Reconciliation)
// ==========================================
router.get('/reconciliation/pipeline', requireAuth, (req, res) => pipelineController.getPipelineSummary(req, res));
router.get('/reconciliation/config-details', requireAuth, (req, res) => pipelineController.getConfigDetail(req, res));
router.get('/reconciliation/stage-data', requireAuth, (req, res) => pipelineController.getPipelineStageData(req, res));
router.get('/reconciliation/compare', requireAuth, (req, res) => pipelineController.comparePipelineConfig(req, res));
router.get('/reconciliation/berita-acara', requireAuth, (req, res) => pipelineController.getBeritaAcara(req, res));

const flowCanvasController = require('../controllers/flow-canvas.controller');

// ==========================================
// 7. Modul 5: Visual Workflow Canvas & Dynamic Orchestrator
// ==========================================
router.get('/flows/presets', requireAuth, (req, res) => flowCanvasController.getPresets(req, res));
router.post('/flows/execute', requireAuth, (req, res) => flowCanvasController.executeFlow(req, res));
router.post('/flows/flow-1-staging', requireAuth, (req, res) => flowCanvasController.executeFlow1(req, res));
router.post('/flows/flow-2-post', requireAuth, (req, res) => flowCanvasController.executeFlow2(req, res));
router.post('/flows/flow-3-rollback', requireAuth, (req, res) => flowCanvasController.executeFlow3(req, res));
router.post('/flows/flow-4-purge', requireAuth, (req, res) => flowCanvasController.executeFlow4(req, res));
router.get('/flows/stream/:runId', requireAuth, (req, res) => flowCanvasController.streamFlowEvents(req, res));
router.get('/flows/error-diagnostic/:runId', requireAuth, (req, res) => flowCanvasController.getErrorDiagnostic(req, res));

// Legacy compatibility
router.get('/tables', requireAuth, (req, res) => migrationController.getTables(req, res));
router.get('/summary', requireAuth, (req, res) => migrationController.getSummary(req, res));
router.get('/data', requireAuth, (req, res) => migrationController.getTableData(req, res));

module.exports = router;
