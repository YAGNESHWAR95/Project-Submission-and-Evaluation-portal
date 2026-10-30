const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const app = require('./src/app');
const User = require('./src/models/User');
const Project = require('./src/models/Project');
const ProjectMember = require('./src/models/ProjectMember');
const TeamInvitation = require('./src/models/TeamInvitation');
const Deadline = require('./src/models/Deadline');
const PlagiarismResult = require('./src/models/PlagiarismResult');
const Notification = require('./src/models/Notification');
const Evaluation = require('./src/models/Evaluation');
const Complaint = require('./src/models/Complaint');

const PORT = 5055;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('=== STARTING WORKFLOW & FAILURE TESTS ===');

  // Connect DB
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected to MongoDB');

  // Start Server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ Test server running on ${BASE_URL}`);

  let student1Token, student1Id;
  let student2Token, student2Id;
  let facultyToken, facultyId;
  let adminToken, adminId;
  let testDeadlineId;
  let testProjectId;
  let testInvitationToken;
  let testComplaintId;

  const testSuffix = Date.now();
  const student1Email = `leader_${testSuffix}@test.com`;
  const student2Email = `member_${testSuffix}@test.com`;
  const facultyEmail = `faculty_${testSuffix}@test.com`;
  const adminEmail = `admin_${testSuffix}@test.com`;
  const password = 'Password123';

  try {
    // ----------------------------------------------------
    // SETUP: Ensure an active deadline exists with future end date
    // ----------------------------------------------------
    console.log('\n--- SETUP: Deadline ---');
    const now = new Date();
    let deadline = await Deadline.findOne({
      isActive: true,
      submissionStartDate: { $lte: now },
      submissionEndDate: { $gt: now },
    });
    if (!deadline) {
      deadline = await Deadline.create({
        batch: `Batch ${testSuffix}`,
        title: `Capstone 2026 Final Review ${testSuffix}`,
        submissionStartDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        submissionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      });
      console.log('✓ Created active deadline for testing with future end date');
    } else {
      console.log(`✓ Using existing active deadline: ${deadline.title}`);
    }
    testDeadlineId = deadline._id.toString();

    // ----------------------------------------------------
    // 1. REGISTER STUDENT 1 (LEADER)
    // ----------------------------------------------------
    console.log('\n--- 1. Register Student 1 (Leader) ---');
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jyosna Leader',
        email: student1Email,
        password,
        role: 'student',
        department: 'CSE',
        rollNumber: `CS${testSuffix}`,
      }),
    });
    const regData = await regRes.json();
    if (regRes.status !== 201) throw new Error(`Student 1 register failed: ${JSON.stringify(regData)}`);
    student1Id = regData.user._id;
    console.log(`✓ Registered Student 1: ${student1Email} (ID: ${student1Id})`);

    // ----------------------------------------------------
    // 2. LOGIN STUDENT 1
    // ----------------------------------------------------
    console.log('\n--- 2. Login Student 1 ---');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: student1Email, password }),
    });
    const loginData = await loginRes.json();
    if (loginRes.status !== 200) throw new Error(`Student 1 login failed: ${JSON.stringify(loginData)}`);
    student1Token = loginData.token;
    console.log(`✓ Student 1 logged in successfully`);

    // ----------------------------------------------------
    // 3. GET STUDENT DEADLINES
    // ----------------------------------------------------
    console.log('\n--- 3. Get Student Deadlines ---');
    const dRes = await fetch(`${BASE_URL}/api/projects/deadlines`, {
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    const dData = await dRes.json();
    if (dRes.status !== 200 || !dData.deadlines || dData.deadlines.length === 0) {
      throw new Error(`Failed to fetch student deadlines: ${JSON.stringify(dData)}`);
    }
    console.log(`✓ Fetched ${dData.deadlines.length} active deadlines`);

    // ----------------------------------------------------
    // 4. CREATE PROJECT (DRAFT)
    // ----------------------------------------------------
    console.log('\n--- 4. Create Project (DRAFT) ---');
    const createRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({
        title: `AI Capstone Project ${testSuffix}`,
        description: 'Deep Learning based evaluation framework for real-world projects.',
        deadlineId: testDeadlineId,
      }),
    });
    const createData = await createRes.json();
    if (createRes.status !== 201) throw new Error(`Create project failed: ${JSON.stringify(createData)}`);
    testProjectId = createData.project._id;
    console.log(`✓ Created Project ID: ${testProjectId}, Status: ${createData.project.status}`);
    if (createData.project.status !== 'draft') throw new Error(`Expected status 'draft', got ${createData.project.status}`);

    // Verify ProjectMember record created for leader
    const leaderMember = await ProjectMember.findOne({ project: testProjectId, user: student1Id });
    if (!leaderMember || leaderMember.role !== 'leader') {
      throw new Error('ProjectMember for leader was not properly created');
    }
    console.log(`✓ Verified ProjectMember record created for leader (Role: ${leaderMember.role})`);

    // ----------------------------------------------------
    // 5. REGISTER & LOGIN STUDENT 2 (TEAM MEMBER)
    // ----------------------------------------------------
    console.log('\n--- 5. Register & Login Student 2 ---');
    const reg2Res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rahul Member',
        email: student2Email,
        password,
        role: 'student',
        department: 'CSE',
        rollNumber: `CS2_${testSuffix}`,
      }),
    });
    const reg2Data = await reg2Res.json();
    if (reg2Res.status !== 201) throw new Error(`Student 2 register failed: ${JSON.stringify(reg2Data)}`);
    student2Id = reg2Data.user._id;

    const login2Res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: student2Email, password }),
    });
    const login2Data = await login2Res.json();
    student2Token = login2Data.token;
    console.log(`✓ Student 2 registered and logged in (${student2Email})`);

    // ----------------------------------------------------
    // 6. INVITATION WORKFLOW & FAILURE TESTS
    // ----------------------------------------------------
    console.log('\n--- 6. Team Invitation Tests ---');

    // Failure Case 6a: Self-invitation
    const selfInvRes = await fetch(`${BASE_URL}/api/team-invitations/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({ projectId: testProjectId, email: student1Email }),
    });
    if (selfInvRes.status === 400) {
      console.log('✓ Rejected self-invitation correctly (400)');
    } else {
      throw new Error(`Expected 400 for self-invitation, got ${selfInvRes.status}`);
    }

    // Success Case 6b: Invite Student 2
    const invRes = await fetch(`${BASE_URL}/api/team-invitations/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({ projectId: testProjectId, email: student2Email }),
    });
    const invData = await invRes.json();
    if (invRes.status !== 201) throw new Error(`Invitation failed: ${JSON.stringify(invData)}`);
    testInvitationToken = invData.invitation.token;
    console.log(`✓ Invited Student 2 successfully (Token: ${testInvitationToken.substring(0, 10)}...)`);

    // Failure Case 6c: Duplicate invitation
    const dupInvRes = await fetch(`${BASE_URL}/api/team-invitations/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({ projectId: testProjectId, email: student2Email }),
    });
    if (dupInvRes.status === 409) {
      console.log('✓ Rejected duplicate invitation correctly (409)');
    } else {
      throw new Error(`Expected 409 for duplicate invitation, got ${dupInvRes.status}`);
    }

    // Verify Notification created for Student 2
    const student2Notifs = await Notification.find({ recipient: student2Id, type: 'team_invitation' });
    if (student2Notifs.length === 0) throw new Error('Notification for team invitation not found');
    console.log(`✓ Verified in-app notification created for invited student`);

    // ----------------------------------------------------
    // 7. STUDENT 2 ACCEPTS INVITATION
    // ----------------------------------------------------
    console.log('\n--- 7. Accept Invitation ---');
    const myInvRes = await fetch(`${BASE_URL}/api/team-invitations/my`, {
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    const myInvData = await myInvRes.json();
    if (myInvRes.status !== 200 || myInvData.invitations.length === 0) {
      throw new Error('Student 2 failed to retrieve invitations');
    }
    console.log(`✓ Student 2 retrieved ${myInvData.invitations.length} invitation(s)`);

    const acceptRes = await fetch(`${BASE_URL}/api/team-invitations/${testInvitationToken}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    const acceptData = await acceptRes.json();
    if (acceptRes.status !== 200) throw new Error(`Accept invitation failed: ${JSON.stringify(acceptData)}`);
    console.log(`✓ Student 2 accepted invitation successfully`);

    // Verify ProjectMember exists
    const memberRecord = await ProjectMember.findOne({ project: testProjectId, user: student2Id });
    if (!memberRecord || memberRecord.role !== 'member') {
      throw new Error('ProjectMember record for Student 2 not found');
    }
    console.log(`✓ Verified ProjectMember record created for accepted student (Role: member)`);

    // Verify Project.teamMembers contains Student 2
    const updatedProject = await Project.findById(testProjectId);
    if (!updatedProject.teamMembers.map(String).includes(student2Id)) {
      throw new Error('Project.teamMembers does not contain Student 2');
    }
    console.log(`✓ Verified Project.teamMembers contains Student 2`);

    // ----------------------------------------------------
    // 8. FILE UPLOADS WITH PURPOSE VALIDATION
    // ----------------------------------------------------
    console.log('\n--- 8. File Uploads & Purpose Validation ---');

    // Create temp dummy files
    const dummyPdf = path.join(__dirname, `test_${testSuffix}.pdf`);
    const dummyPpt = path.join(__dirname, `test_${testSuffix}.pptx`);
    const dummyZip = path.join(__dirname, `test_${testSuffix}.zip`);

    fs.writeFileSync(dummyPdf, '%PDF-1.4 test document content for capstone report');
    fs.writeFileSync(dummyPpt, 'PK pptx test presentation mock content');
    fs.writeFileSync(dummyZip, 'PK zip mock source archive content');

    // Failure Case: Wrong purpose mapping (PDF uploaded as 'source')
    const wrongFormData = new FormData();
    wrongFormData.append('file', new Blob([fs.readFileSync(dummyPdf)]), 'test.pdf');
    wrongFormData.append('purpose', 'source');

    const wrongUploadRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: wrongFormData,
    });
    if (wrongUploadRes.status === 400) {
      console.log('✓ Rejected wrong file purpose correctly (400 - PDF as source)');
    } else {
      throw new Error(`Expected 400 for wrong purpose mapping, got ${wrongUploadRes.status}`);
    }

    // Valid Upload: Report (PDF)
    const reportFormData = new FormData();
    reportFormData.append('file', new Blob([fs.readFileSync(dummyPdf)]), 'project_report.pdf');
    reportFormData.append('purpose', 'report');

    const reportRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: reportFormData,
    });
    const reportData = await reportRes.json();
    if (reportRes.status !== 200) throw new Error(`Report upload failed: ${JSON.stringify(reportData)}`);
    console.log(`✓ Uploaded report (PDF) - Hash: ${reportData.hash.substring(0, 16)}...`);

    // Valid Upload: Presentation (PPTX)
    const pptFormData = new FormData();
    pptFormData.append('file', new Blob([fs.readFileSync(dummyPpt)]), 'project_presentation.pptx');
    pptFormData.append('purpose', 'presentation');

    const pptRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: pptFormData,
    });
    const pptData = await pptRes.json();
    if (pptRes.status !== 200) throw new Error(`PPT upload failed: ${JSON.stringify(pptData)}`);
    console.log(`✓ Uploaded presentation (PPTX) - Hash: ${pptData.hash.substring(0, 16)}...`);

    // Valid Upload: Source Code (ZIP)
    const zipFormData = new FormData();
    zipFormData.append('file', new Blob([fs.readFileSync(dummyZip)]), 'project_source.zip');
    zipFormData.append('purpose', 'source');

    const zipRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: zipFormData,
    });
    const zipData = await zipRes.json();
    if (zipRes.status !== 200) throw new Error(`ZIP upload failed: ${JSON.stringify(zipData)}`);
    console.log(`✓ Uploaded source code (ZIP) - Hash: ${zipData.hash.substring(0, 16)}...`);

    // Clean up local temp files
    try {
      fs.unlinkSync(dummyPdf);
      fs.unlinkSync(dummyPpt);
      fs.unlinkSync(dummyZip);
    } catch (e) {}

    // Verify MongoDB Project file metadata
    const projWithFiles = await Project.findById(testProjectId);
    if (!projWithFiles.files.reportUrl || !projWithFiles.files.pptUrl || !projWithFiles.files.codeZipUrl) {
      throw new Error('Project files metadata was not saved in MongoDB');
    }
    console.log(`✓ Verified all three file URLs and hashes recorded in MongoDB`);

    // ----------------------------------------------------
    // 9. SUBMIT PROJECT & RUN PLAGIARISM CHECK
    // ----------------------------------------------------
    console.log('\n--- 9. Submit Project & Plagiarism Check ---');
    const submitRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    const submitData = await submitRes.json();
    if (submitRes.status !== 200) throw new Error(`Project submission failed: ${JSON.stringify(submitData)}`);
    console.log(`✓ Project submitted successfully! Status: ${submitData.project.status}`);
    if (submitData.project.status !== 'submitted') {
      throw new Error(`Expected status 'submitted', got ${submitData.project.status}`);
    }

    // Verify PlagiarismResult in MongoDB
    const plagResult = await PlagiarismResult.findOne({ project: testProjectId });
    if (!plagResult) throw new Error('PlagiarismResult document was not generated');
    console.log(`✓ Verified PlagiarismResult: score=${plagResult.similarityScore}%, level=${plagResult.similarityLevel}`);

    // Verify in-app notifications created for team members
    const teamNotifs = await Notification.find({ relatedProject: testProjectId, type: 'project_submitted' });
    if (teamNotifs.length < 2) throw new Error('Team notifications for submission were not generated');
    console.log(`✓ Verified in-app notifications generated for ${teamNotifs.length} team members`);

    // ----------------------------------------------------
    // 10. ADMIN & FACULTY ALLOCATION
    // ----------------------------------------------------
    console.log('\n--- 10. Admin & Faculty Allocation ---');

    // Register Faculty
    const regFacRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dr. Ramesh Faculty',
        email: facultyEmail,
        password,
        role: 'faculty',
        department: 'CSE',
        facultyId: `FAC_${testSuffix}`,
      }),
    });
    const regFacData = await regFacRes.json();
    facultyId = regFacData.user._id;

    const facLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: facultyEmail, password }),
    });
    facultyToken = (await facLoginRes.json()).token;
    console.log(`✓ Registered and logged in Faculty (${facultyEmail})`);

    // Create Admin directly in MongoDB (per spec admin cannot self-register via API)
    const adminUser = await User.create({
      name: 'System Admin',
      email: adminEmail,
      password,
      role: 'admin',
      department: 'Administration',
    });
    adminId = adminUser._id.toString();

    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password }),
    });
    adminToken = (await adminLoginRes.json()).token;
    console.log(`✓ Admin user created and logged in (${adminEmail})`);

    // Admin assigns reviewer
    const assignRes = await fetch(`${BASE_URL}/api/projects/assign-reviewer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        projectId: testProjectId,
        facultyId,
      }),
    });
    const assignData = await assignRes.json();
    if (assignRes.status !== 200) throw new Error(`Assign reviewer failed: ${JSON.stringify(assignData)}`);
    console.log(`✓ Admin assigned reviewer. Project status: ${assignData.project.status}`);

    // Verify Faculty notification
    const facNotif = await Notification.findOne({ recipient: facultyId, type: 'faculty_assigned' });
    if (!facNotif) throw new Error('Faculty notification not found');
    console.log(`✓ Verified notification created for assigned faculty reviewer`);

    // ----------------------------------------------------
    // 11. FACULTY REVIEWS & EVALUATES PROJECT
    // ----------------------------------------------------
    console.log('\n--- 11. Faculty Evaluation ---');

    // Faculty gets assigned projects
    const facProjectsRes = await fetch(`${BASE_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${facultyToken}` },
    });
    const facProjectsData = await facProjectsRes.json();
    if (facProjectsRes.status !== 200 || facProjectsData.projects.length === 0) {
      throw new Error('Faculty failed to view assigned projects');
    }
    console.log(`✓ Faculty fetched assigned projects queue (${facProjectsData.projects.length} project)`);

    // Faculty submits Phase 3 Final evaluation
    const evalRes = await fetch(`${BASE_URL}/api/evaluations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`,
      },
      body: JSON.stringify({
        projectId: testProjectId,
        phase: 'final',
        scores: [
          { criteriaName: 'Project Quality', maxMarks: 20, scoredMarks: 18 },
          { criteriaName: 'Technical Implementation', maxMarks: 20, scoredMarks: 19 },
          { criteriaName: 'Documentation & Presentation', maxMarks: 20, scoredMarks: 17 },
        ],
        feedback: 'Excellent capstone implementation. Architecture is clean and well-tested.',
        isPublished: true,
      }),
    });
    const evalData = await evalRes.json();
    if (evalRes.status !== 200 && evalRes.status !== 201) throw new Error(`Evaluation submission failed: ${JSON.stringify(evalData)}`);
    console.log(`✓ Faculty submitted evaluation! Total marks: ${evalData.evaluation.totalScore}/60`);

    // Verify project status updated to EVALUATED
    const evaluatedProject = await Project.findById(testProjectId);
    if (evaluatedProject.status !== 'evaluated') {
      throw new Error(`Expected project status 'evaluated', got ${evaluatedProject.status}`);
    }
    console.log(`✓ Verified Project status updated to 'evaluated'`);

    // ----------------------------------------------------
    // 12. STUDENT VIEWS EVALUATION NOTIFICATION & DETAILS
    // ----------------------------------------------------
    console.log('\n--- 12. Student Evaluation Verification ---');
    const studNotifs = await Notification.find({
      recipient: student1Id,
      type: 'evaluation_published',
    });
    if (studNotifs.length === 0) throw new Error('Evaluation notification not found for student leader');
    console.log(`✓ Verified Student Leader received evaluation notification`);

    const studProjRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}`, {
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    const studProjData = await studProjRes.json();
    if (studProjRes.status !== 200 || !studProjData.project.evaluation) {
      throw new Error('Student could not retrieve evaluated project with evaluation ref');
    }
    console.log(`✓ Student successfully viewed evaluated project with evaluation data`);

    // ----------------------------------------------------
    // 13. COMPLAINTS MANAGEMENT
    // ----------------------------------------------------
    console.log('\n--- 13. Complaint Workflow ---');
    const compRes = await fetch(`${BASE_URL}/api/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`,
      },
      body: JSON.stringify({
        projectId: testProjectId,
        subject: 'Request for mark breakdown review',
        description: 'We would like clarification on the presentation criteria scores.',
      }),
    });
    const compData = await compRes.json();
    if (compRes.status !== 201) throw new Error(`Complaint submission failed: ${JSON.stringify(compData)}`);
    testComplaintId = compData.complaint._id;
    console.log(`✓ Student submitted complaint (ID: ${testComplaintId})`);

    // Student views my complaints
    const myCompRes = await fetch(`${BASE_URL}/api/complaints/my`, {
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    const myCompData = await myCompRes.json();
    if (myCompRes.status !== 200 || myCompData.complaints.length === 0) {
      throw new Error('Student failed to view complaints');
    }
    console.log(`✓ Student viewed their complaints (${myCompData.complaints.length} found)`);

    // Admin manages complaint
    const adminCompRes = await fetch(`${BASE_URL}/api/complaints/${testComplaintId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'resolved',
        adminResponse: 'Faculty reviewer reviewed and verified rubric marks breakdown.',
      }),
    });
    const adminCompData = await adminCompRes.json();
    if (adminCompRes.status !== 200 || adminCompData.complaint.status !== 'resolved') {
      throw new Error(`Admin update complaint failed: ${JSON.stringify(adminCompData)}`);
    }
    console.log(`✓ Admin updated complaint status to 'resolved' with response`);

    // Verify complaint notification created for student
    const compNotif = await Notification.findOne({ recipient: student1Id, type: 'complaint_status' });
    if (!compNotif) throw new Error('Complaint status notification not found for student');
    console.log(`✓ Verified complaint resolution notification created for student`);

    // ----------------------------------------------------
    // 14. FAILURE TEST: SUBMITTING WITHDRAWN PROJECT
    // ----------------------------------------------------
    console.log('\n--- 14. Failure Case: Submitting Withdrawn Project ---');
    // Register Student 3
    const student3Email = `withdrawn_student_${testSuffix}@test.com`;
    const reg3Res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Withdraw Test Student',
        email: student3Email,
        password,
        role: 'student',
        department: 'CSE',
        rollNumber: `CS3_${testSuffix}`,
      }),
    });
    const login3Res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: student3Email, password }),
    });
    const student3Token = (await login3Res.json()).token;

    // Create Project 2
    const p2Res = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student3Token}`,
      },
      body: JSON.stringify({
        title: `Project to Withdraw ${testSuffix}`,
        description: 'Test project for withdrawal failure testing.',
        deadlineId: testDeadlineId,
      }),
    });
    const p2Data = await p2Res.json();
    const p2Id = p2Data.project._id;

    // Withdraw Project 2
    const withdrawRes = await fetch(`${BASE_URL}/api/projects/${p2Id}/withdraw`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student3Token}` },
    });
    if (withdrawRes.status !== 200) throw new Error('Failed to withdraw project 2');
    console.log(`✓ Project 2 withdrawn successfully`);

    // Attempt to submit withdrawn project
    const submitWithdrawnRes = await fetch(`${BASE_URL}/api/projects/${p2Id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student3Token}` },
    });
    if (submitWithdrawnRes.status === 400) {
      console.log('✓ Rejected submitting withdrawn project correctly (400)');
    } else {
      throw new Error(`Expected 400 when submitting withdrawn project, got ${submitWithdrawnRes.status}`);
    }

    console.log('\n======================================================');
    console.log('🎉 ALL INTEGRATION WORKFLOW & FAILURE TESTS PASSED! 🎉');
    console.log('======================================================\n');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ TEST FAILURE:', err);
    process.exit(1);
  });
