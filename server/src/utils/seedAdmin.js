const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../models/User');
const connectDB = require('../config/db');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const seedAdmin = async () => {
  const adminName = process.env.ADMIN_NAME || 'System Administrator';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@college.edu';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set before seeding the admin account.');
  }

  await connectDB();

  const existingAdmin = await User.findOne({ email: adminEmail.trim().toLowerCase() });
  if (existingAdmin) {
    console.log(`Admin already exists: ${existingAdmin.email}`);
    return existingAdmin;
  }

  const admin = await User.create({
    name: adminName.trim(),
    email: adminEmail.trim().toLowerCase(),
    password: adminPassword,
    role: 'admin',
    department: 'Computer Science',
    facultyId: 'ADMIN-001',
  });

  console.log('Admin seeded successfully.');
  console.log(`Email: ${admin.email}`);
  console.log('Password: [hidden in logs]');
  return admin;
};

if (require.main === module) {
  seedAdmin()
    .then(() => {
      mongoose.connection.close();
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to seed admin account:', error.message);
      mongoose.connection.close();
      process.exit(1);
    });
}

module.exports = { seedAdmin };
