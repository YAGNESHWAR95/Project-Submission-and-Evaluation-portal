const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');

// Get notifications for the current user
const getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ recipient: req.user.id })
      .populate('relatedProject', 'title status')
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false,
    });

    res.status(200).json({
      status: 'success',
      notifications,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

// Mark notification as read
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return next(new AppError('Notification not found', 404));
    }

    if (notification.recipient.toString() !== req.user.id) {
      return next(new AppError('You are not authorized to modify this notification', 403));
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json({
      status: 'success',
      notification,
    });
  } catch (error) {
    next(error);
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'All notifications marked as read',
    });
  } catch (error) {
    next(error);
  }
};

const clearMyNotifications = async (req, res, next) => {
  try {
    const result = await Notification.deleteMany({ recipient: req.user.id });
    res.status(200).json({
      status: 'success',
      message: 'Notifications cleared',
      deletedCount: result.deletedCount || 0,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearMyNotifications,
};
