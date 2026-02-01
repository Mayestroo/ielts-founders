#!/usr/bin/env ts-node

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding test data...');

  // Clean up existing test data
  await prisma.user.deleteMany({
    where: { username: 'test_student' },
  });

  // Get or create a test center
  const center = await prisma.center.upsert({
    where: { name: 'Test Center' },
    update: {},
    create: {
      name: 'Test Center',
    },
  });

  console.log('✓ Created test center:', center.name);

  // Create test student
  const hashedPassword = await bcrypt.hash('test_password', 10);

  const student = await prisma.user.upsert({
    where: { username: 'test_student' },
    update: {
      password: hashedPassword,
      centerId: center.id,
    },
    create: {
      username: 'test_student',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'Student',
      role: 'STUDENT',
      centerId: center.id,
    },
  });

  console.log('✓ Created test student:', student.username);

  // Create teacher
  const teacher = await prisma.user.upsert({
    where: { username: 'test_teacher' },
    update: {
      password: hashedPassword,
    },
    create: {
      username: 'test_teacher',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'Teacher',
      role: 'TEACHER',
      centerId: center.id,
    },
  });

  console.log('✓ Created test teacher:', teacher.username);

  // Create exam sections
  const now = new Date();

  // Listening section (10 minutes - for quick testing)
  const listeningSection = await prisma.examSection.upsert({
    where: { id: 'test-listening-section' },
    update: {},
    create: {
      id: 'test-listening-section',
      title: 'IELTS Listening Test',
      type: 'LISTENING',
      description: 'Test listening section for E2E testing',
      duration: 10, // 10 minutes for quick testing
      teacherId: teacher.id,
      centerId: center.id,
      questions: [
        {
          id: 'q1',
          type: 'FILL_BLANK',
          questionText: 'What is the main topic of the lecture?',
          correctAnswer: 'climate change',
          points: 1,
        },
        {
          id: 'q2',
          type: 'TRUE_FALSE_NOT_GIVEN',
          questionText: 'The speaker mentions three types of renewable energy.',
          correctAnswer: 'TRUE',
          points: 1,
        },
        {
          id: 'q3',
          type: 'MCQ_SINGLE',
          questionText: 'What percentage of the audience agreed with the proposal?',
          options: [
            { id: 'opt1', text: '25%' },
            { id: 'opt2', text: '50%' },
            { id: 'opt3', text: '75%' },
          ],
          correctAnswer: 'opt2',
          points: 1,
        },
      ],
      audioUrl: '/uploads/test-listening.mp3',
    },
  });

  console.log('✓ Created listening section');

  // Reading section (10 minutes)
  const readingSection = await prisma.examSection.upsert({
    where: { id: 'test-reading-section' },
    update: {},
    create: {
      id: 'test-reading-section',
      title: 'IELTS Reading Test',
      type: 'READING',
      description: 'Test reading section for E2E testing',
      duration: 10,
      teacherId: teacher.id,
      centerId: center.id,
      questions: [
        {
          id: 'q4',
          type: 'MCQ_SINGLE',
          questionText: 'What is the main purpose of the first paragraph?',
          options: [
            { id: 'r1', text: 'To introduce the topic' },
            { id: 'r2', text: 'To present arguments' },
            { id: 'r3', text: 'To provide examples' },
          ],
          correctAnswer: 'r1',
          points: 1,
        },
        {
          id: 'q5',
          type: 'TRUE_FALSE_NOT_GIVEN',
          questionText: 'The author supports the new policy.',
          correctAnswer: 'FALSE',
          points: 1,
        },
      ],
      passages: [
        {
          id: 'passage1',
          title: 'Test Passage',
          content: 'This is a test passage for reading comprehension. It contains multiple paragraphs and questions related to the content.',
        },
      ],
    },
  });

  console.log('✓ Created reading section');

  // Writing section (10 minutes)
  const writingSection = await prisma.examSection.upsert({
    where: { id: 'test-writing-section' },
    update: {},
    create: {
      id: 'test-writing-section',
      title: 'IELTS Writing Test',
      type: 'WRITING',
      description: 'Test writing section for E2E testing',
      duration: 10,
      teacherId: teacher.id,
      centerId: center.id,
      questions: [
        {
          id: 'w1',
          type: 'FILL_BLANK',
          questionText: 'The chart shows the number of...',
          instruction: 'Summarize the information by selecting and reporting the main features, and make comparisons where relevant.',
          correctAnswer: '',
          points: 1,
        },
        {
          id: 'w2',
          type: 'FILL_BLANK',
          questionText: 'Some people believe that...',
          instruction: 'Give reasons for your answer and include any relevant examples from your own knowledge or experience.',
          correctAnswer: '',
          points: 1,
        },
      ],
    },
  });

  console.log('✓ Created writing section');

  // Create assignments for test student
  await prisma.examAssignment.deleteMany({
    where: {
      studentId: student.id,
      sectionId: {
        in: [
          listeningSection.id,
          readingSection.id,
          writingSection.id,
        ],
      },
    },
  });

  await prisma.fullMockSession.deleteMany({
    where: { studentId: student.id },
  });

  const fullMockSession = await prisma.fullMockSession.create({
    data: {
      studentId: student.id,
      centerId: center.id,
      status: 'ASSIGNED',
      breakMinutes: 1,
      currentSequence: 1,
    },
  });

  console.log('✓ Created full mock session:', fullMockSession.id);

  const listeningAssignment = await prisma.examAssignment.create({
    data: {
      studentId: student.id,
      sectionId: listeningSection.id,
      status: 'ASSIGNED',
      fullMockSessionId: fullMockSession.id,
      fullMockSequence: 1,
      createdAt: now,
      updatedAt: now,
    },
  });

  console.log('✓ Created listening assignment:', listeningAssignment.id);

  const readingAssignment = await prisma.examAssignment.create({
    data: {
      studentId: student.id,
      sectionId: readingSection.id,
      status: 'ASSIGNED',
      fullMockSessionId: fullMockSession.id,
      fullMockSequence: 2,
      createdAt: now,
      updatedAt: now,
    },
  });

  console.log('✓ Created reading assignment:', readingAssignment.id);

  const writingAssignment = await prisma.examAssignment.create({
    data: {
      studentId: student.id,
      sectionId: writingSection.id,
      status: 'ASSIGNED',
      fullMockSessionId: fullMockSession.id,
      fullMockSequence: 3,
      createdAt: now,
      updatedAt: now,
    },
  });

  console.log('✓ Created writing assignment:', writingAssignment.id);

  // Create super admin for backend tests
  const admin = await prisma.user.upsert({
    where: { username: 'test_admin' },
    update: {
      password: hashedPassword,
    },
    create: {
      username: 'test_admin',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
    },
  });

  console.log('✓ Created test admin:', admin.username);

  console.log('\n✅ Test data seeded successfully!');
  console.log('\n📝 Test Credentials:');
  console.log('  Student:  test_student / test_password');
  console.log('  Teacher:  test_teacher / test_password');
  console.log('  Admin:    test_admin / test_password');
  console.log('\n📝 Full Mock Assignments:');
  console.log('  Listening:  ' + listeningAssignment.id);
  console.log('  Reading:   ' + readingAssignment.id);
  console.log('  Writing:    ' + writingAssignment.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Error seeding data:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
