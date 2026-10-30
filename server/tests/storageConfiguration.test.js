const test = require('node:test');
const assert = require('node:assert/strict');
const { configureCloudinary, validateStorageConfiguration } = require('../src/config/cloudinary');

const environmentKeys = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'SERVER_URL',
  'NODE_ENV',
];

const withEnvironment = async (values, run) => {
  const original = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  environmentKeys.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    environmentKeys.forEach((key) => {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    });
  }
};

test('partial Cloudinary configuration fails clearly without including configured values', async () => {
  await withEnvironment({ CLOUDINARY_CLOUD_NAME: 'placeholder-cloud', SERVER_URL: 'https://portal.example' }, () => {
    assert.throws(() => validateStorageConfiguration(), (error) => {
      assert.match(error.message, /CLOUDINARY_API_KEY/);
      assert.match(error.message, /CLOUDINARY_API_SECRET/);
      assert.equal(error.message.includes('placeholder-cloud'), false);
      return true;
    });
  });
});

test('complete absence of Cloudinary settings permits local storage with a valid server URL', async () => {
  await withEnvironment({ SERVER_URL: 'https://portal.example/', NODE_ENV: 'production' }, () => {
    assert.doesNotThrow(() => validateStorageConfiguration());
  });
});

test('production local storage requires SERVER_URL and configured URLs must use HTTP(S)', async () => {
  await withEnvironment({ NODE_ENV: 'production' }, () => {
    assert.throws(() => validateStorageConfiguration(), /SERVER_URL is required/);
  });
  await withEnvironment({ SERVER_URL: 'ftp://portal.example', NODE_ENV: 'development' }, () => {
    assert.throws(() => validateStorageConfiguration(), /HTTP or HTTPS/);
  });
});

test('startup configuration selects local storage when optional Cloudinary credentials are absent', async () => {
  await withEnvironment({ SERVER_URL: 'http://localhost:5000', NODE_ENV: 'development' }, () => {
    assert.equal(configureCloudinary(), null);
  });
});