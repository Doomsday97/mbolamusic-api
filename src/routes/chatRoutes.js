const router = require('express').Router();
const chat = require('../controllers/chatController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// User endpoints
router.get('/messages',       chat.getMyMessages);
router.post('/messages',      chat.sendMessage);
router.get('/unread',         chat.unreadCount);

// Admin endpoints
router.get('/admin/conversations',          requireRole('ADMIN'), chat.adminListConversations);
router.get('/admin/conversations/:userId',  requireRole('ADMIN'), chat.adminGetMessages);
router.post('/admin/conversations/:userId', requireRole('ADMIN'), chat.adminSendMessage);

module.exports = router;
