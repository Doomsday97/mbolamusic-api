const router = require('express').Router();
const chat = require('../controllers/chatController');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadChatMedia } = require('../config/upload');

router.use(authenticate);

// User endpoints
router.get('/messages',       chat.getMyMessages);
router.post('/messages',      uploadChatMedia.single('media'), chat.sendMessage);
router.get('/unread',         chat.unreadCount);

// Admin endpoints
router.get('/admin/conversations',          requireRole('ADMIN'), chat.adminListConversations);
router.get('/admin/conversations/:userId',  requireRole('ADMIN'), chat.adminGetMessages);
router.post('/admin/conversations/:userId', requireRole('ADMIN'), uploadChatMedia.single('media'), chat.adminSendMessage);

module.exports = router;
