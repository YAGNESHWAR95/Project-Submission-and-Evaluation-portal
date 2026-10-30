const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Deadline = require('../models/Deadline');
const Project = require('../models/Project');
const Evaluation = require('../models/Evaluation');
const connectDB = require('../config/db');

const seedData = async () => {
  try {
    const connUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/project_portal';
    await mongoose.connect(connUri);
    console.log('Connected to MongoDB for seeding...');

    // Clear existing data
    await User.deleteMany({});
    await Deadline.deleteMany({});
    await Project.deleteMany({});
    await Evaluation.deleteMany({});
    console.log('Cleared existing collections.');

    // 1. Create Deadlines
    const deadline1 = await Deadline.create({
      batch: 'Batch 2026',
      title: 'Capstone Phase 1 - Scoping & SRS',
      submissionStartDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // opened 3 days ago
      submissionEndDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),   // closes in 5 days
      isActive: true,
    });

    const deadline2 = await Deadline.create({
      batch: 'Batch 2027',
      title: 'Early Abstract Review',
      submissionStartDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // opens in 10 days
      submissionEndDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      isActive: false,
    });

    console.log('Submission deadlines seeded.');

    // 2. Create Users
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@college.edu';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
    const facultyPassword = process.env.FACULTY_PASSWORD || 'Faculty@123';

    const admin = await User.create({
      name: process.env.ADMIN_NAME || 'System Administrator',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      department: 'Computer Science',
    });

    const facultySeedData = [
      { name: 'Dr. Anitha Rao', email: 'anitha.faculty@college.edu', department: 'Information Technology', facultyId: 'FAC-IT-01', specialization: 'Artificial Intelligence', expertise: ['Machine Learning', 'NLP', 'Deep Learning', 'Data Science'], subjects: ['AI', 'Machine Learning', 'Data Mining'], researchAreas: ['Natural Language Processing', 'Educational AI'], experienceYears: 8, maxProjects: 8, availability: 'available' },
      { name: 'Dr. Ravi Kumar', email: 'ravi.faculty@college.edu', department: 'Information Technology', facultyId: 'FAC-IT-02', specialization: 'Web and Cloud Computing', expertise: ['React', 'Node.js', 'MERN', 'Cloud Computing', 'Distributed Systems'], subjects: ['Web Development', 'Cloud Computing'], researchAreas: ['Cloud Applications'], experienceYears: 7, maxProjects: 8, availability: 'available' },
      { name: 'Dr. Suresh Reddy', email: 'suresh.faculty@college.edu', department: 'Information Technology', facultyId: 'FAC-IT-03', specialization: 'Cybersecurity', expertise: ['Cybersecurity', 'Computer Networks', 'Cryptography', 'Network Security'], subjects: ['Networks', 'Security'], researchAreas: ['Network Security'], experienceYears: 10, maxProjects: 6, availability: 'available' },
      { name: 'Dr. Priya Sharma', email: 'priya.faculty@college.edu', department: 'Computer Science', facultyId: 'FAC-CS-01', specialization: 'Data Science and Machine Learning', expertise: ['Data Science', 'Machine Learning', 'NLP', 'Statistics', 'Deep Learning'], subjects: ['Data Science', 'ML'], researchAreas: ['Data Analytics', 'NLP'], experienceYears: 9, maxProjects: 8, availability: 'available' },
      { name: 'Dr. Kiran Rao', email: 'kiran.faculty@college.edu', department: 'Computer Science', facultyId: 'FAC-CS-02', specialization: 'IoT', expertise: ['IoT', 'Embedded Systems', 'Sensors', 'Edge Computing'], subjects: ['IoT', 'Embedded Systems'], researchAreas: ['Smart Systems'], experienceYears: 6, maxProjects: 6, availability: 'available' },
      { name: 'Dr. Meena Devi', email: 'meena.faculty@college.edu', department: 'Computer Science', facultyId: 'FAC-CS-03', specialization: 'Software Engineering and Databases', expertise: ['Software Engineering', 'Databases', 'SQL', 'System Design', 'Testing'], subjects: ['DBMS', 'Software Engineering'], researchAreas: ['Software Quality'], experienceYears: 11, maxProjects: 8, availability: 'available' },
    ];

    const facultyUsers = await Promise.all(facultySeedData.map((faculty) => User.create({
      name: faculty.name,
      email: faculty.email,
      password: facultyPassword,
      role: 'faculty',
      department: faculty.department,
      facultyId: faculty.facultyId,
      availability: faculty.availability,
      facultyProfile: {
        facultyId: faculty.facultyId,
        qualification: 'Ph.D. / M.Tech',
        specialization: faculty.specialization,
        expertise: faculty.expertise,
        subjects: faculty.subjects,
        researchAreas: faculty.researchAreas,
        experienceYears: faculty.experienceYears,
        maxProjects: faculty.maxProjects,
        currentProjects: 0,
        availability: faculty.availability,
      },
    })));

    // Students
    const student1 = await User.create({
      name: 'Liam Vance',
      email: 'liam-student1@localhost.test',
      password: 'Student@123',
      role: 'student',
      department: 'Computer Science',
      rollNumber: 'CS26-001',
      section: 'A',
      batch: '2026-2030',
      academicYear: '2026-27',
      officialCollegeEmail: 'cs26-001@college.test',
    });

    const student2 = await User.create({
      name: 'Sophia Vance',
      email: 'sophia-student2@localhost.test',
      password: 'Student@123',
      role: 'student',
      department: 'Computer Science',
      rollNumber: 'CS26-002',
      section: 'A',
      batch: '2026-2030',
      academicYear: '2026-27',
      officialCollegeEmail: 'cs26-002@college.test',
    });

    const student3 = await User.create({
      name: 'Ethan Mercer',
      email: 'ethan-student3@localhost.test',
      password: 'Student@123',
      role: 'student',
      department: 'Computer Science',
      rollNumber: 'CS26-003',
      section: 'A',
      batch: '2026-2030',
      academicYear: '2026-27',
      officialCollegeEmail: 'cs26-003@college.test',
    });

    console.log('User profiles (Admin, 6 faculty, students) seeded successfully.');
    console.log('Demo seed complete.');

    process.exit(0);
  } catch (error) {
    console.error('Seeding process failed:', error);
    process.exit(1);
  }
};

seedData();
