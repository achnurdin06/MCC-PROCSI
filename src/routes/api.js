const express = require('express');
const router = express.Router();

const migrationController = require('../controllers/migration.controller');
const sourceController = require('../controllers/source.controller');
const etlController = require('../controllers/etl.controller');
const pipelineController = require('../controllers/pipeline.controller');

// ==========================================
// 1. Core Health Check
// ==========================================
router.get('/health', (req, res) => migrationController.getHealth(req, res));

// ==========================================
// 2. Modul 1: Source Data (SQL Server dbo Views)
// ==========================================
router.get('/source/views', (req, res) => sourceController.getViewsSummary(req, res));
router.get('/source/view-data', (req, res) => sourceController.getViewData(req, res));

// ==========================================
// 3. Modul 2: ETL Config & Execution Monitor (etl_antam)
// ==========================================
router.get('/etl/overview', (req, res) => etlController.getOverview(req, res));
router.get('/etl/configs', (req, res) => etlController.getMasterConfigs(req, res));
router.get('/etl/runs', (req, res) => etlController.getRuns(req, res));
router.get('/etl/step-logs', (req, res) => etlController.getStepLogs(req, res));
router.get('/etl/error-logs', (req, res) => etlController.getErrorLogs(req, res));

// ==========================================
// 4. Modul 3: Hasil Migrasi (Pipeline 3-Tier Reconciliation)
// ==========================================
router.get('/reconciliation/pipeline', (req, res) => pipelineController.getPipelineSummary(req, res));
router.get('/reconciliation/config-details', (req, res) => pipelineController.getConfigDetail(req, res));
router.get('/reconciliation/stage-data', (req, res) => pipelineController.getPipelineStageData(req, res));
router.get('/reconciliation/berita-acara', (req, res) => pipelineController.getBeritaAcara(req, res));

// Legacy compatibility
router.get('/tables', (req, res) => migrationController.getTables(req, res));
router.get('/summary', (req, res) => migrationController.getSummary(req, res));
router.get('/data', (req, res) => migrationController.getTableData(req, res));

module.exports = router;
