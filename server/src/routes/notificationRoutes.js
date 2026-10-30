const express = require('express');
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearMyNotifications,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', getMyNotifications);
router.get('/my', getMyNotifications);
router.patch('/read-all', markAllAsRead);
router.delete('/clear-all', clearMyNotifications);
router.patch('/:id/read', markAsRead);

module.exports = router;
