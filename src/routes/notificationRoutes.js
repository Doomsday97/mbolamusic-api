const router = require('express').Router();
const notif = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/',                  notif.list);
router.patch('/:id/read',        notif.markRead);
router.patch('/read-all',        notif.markAllRead);
router.delete('/all',            notif.deleteAll);

module.exports = router;
