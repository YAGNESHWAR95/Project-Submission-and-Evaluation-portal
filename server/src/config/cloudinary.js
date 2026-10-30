const cloudinary = require('cloudinary').v2;
const CLOUDINARY_VARIABLES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

const validateStorageConfiguration = () => {
  const configured = CLOUDINARY_VARIABLES.filter((name) => String(process.env[name] || '').trim());
  if (configured.length > 0 && configured.length !== CLOUDINARY_VARIABLES.length) {
    const missing = CLOUDINARY_VARIABLES.filter((name) => !String(process.env[name] || '').trim());
    throw new Error(`Cloudinary configuration is incomplete. Set all required variables or leave all unset for local storage: ${missing.join(', ')}`);
  }

  const serverUrl = String(process.env.SERVER_URL || '').trim();
  if (serverUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(serverUrl);
    } catch {
      throw new Error('SERVER_URL must be a valid absolute HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      throw new Error('SERVER_URL must be a valid absolute HTTP or HTTPS URL without embedded credentials.');
    }
  } else if (process.env.NODE_ENV === 'production' && configured.length === 0) {
    throw new Error('SERVER_URL is required when production uses local file storage.');
  }
};

const configureCloudinary = () => {
  validateStorageConfiguration();
  if (CLOUDINARY_VARIABLES.every((name) => String(process.env[name] || '').trim())) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.info('Cloudinary SDK configuration is valid; project-scoped uploads remain on local disk storage.');
    return cloudinary;
  } else {
    console.info('Cloudinary is not configured; local file storage is active.');
    return null;
  }
};

module.exports = { configureCloudinary, validateStorageConfiguration, cloudinary };
