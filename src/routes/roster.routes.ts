import { Router } from 'express';
import multer from 'multer';
import { authenticateJWT as requireAuth } from '../middleware/auth';
import {
  listRoster, addToRoster, updateRoster, deleteFromRoster,
  importRosterCsv, addRosterTeachersToSession
} from '../controllers/roster.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();

router.get('/',                         requireAuth, listRoster);
router.post('/',                        requireAuth, addToRoster);
router.put('/:id',                      requireAuth, updateRoster);
router.delete('/:id',                   requireAuth, deleteFromRoster);
router.post('/import',                  requireAuth, upload.single('file'), importRosterCsv);
router.post('/to-session/:sessionId',   requireAuth, addRosterTeachersToSession);

export default router;
