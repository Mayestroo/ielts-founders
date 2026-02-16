#!/usr/bin/env ts-node

import { PrismaPg } from '@prisma/adapter-pg';
import {
  AssignmentStatus,
  Prisma,
  PrismaClient,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { Pool } from 'pg';

type CliArgs = Record<string, string | boolean>;

interface SeedConfig {
  users: number;
  prefix: string;
  padWidth: number;
  password: string;
  centerName: string;
  teacherUsername: string;
  sectionId: string;
  sectionTitle: string;
  sectionType: 'READING' | 'LISTENING' | 'WRITING';
  sectionAudioUrl?: string;
  sectionDurationMinutes: number;
  reset: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function readString(args: CliArgs, key: string, fallback: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    return fallback;
  }

  return value;
}

function readNumber(
  args: CliArgs,
  key: string,
  fallback: number,
  min: number,
): number {
  const value = args[key];
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
}

function readBoolean(args: CliArgs, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function usage() {
  console.log('Usage: npm run perf:seed -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --users <n>                Number of load students (default: 100)');
  console.log('  --prefix <value>           Username prefix (default: load_student_)');
  console.log('  --pad-width <n>            Username index width (default: 4)');
  console.log('  --password <value>         Shared password for seeded students');
  console.log('  --center-name <value>      Center name (default: Load Test Center)');
  console.log('  --teacher <username>       Teacher username (default: load_teacher)');
  console.log('  --section-id <id>          Section id (default: load-reading-section)');
  console.log('  --section-title <value>    Section title');
  console.log('  --section-type <value>     READING | LISTENING | WRITING');
  console.log('  --audio-url <value>        Audio URL (for LISTENING section)');
  console.log('  --duration <minutes>       Section duration minutes (default: 180)');
  console.log('  --reset <true|false>       Delete existing load students first');
  console.log('  --help                     Show this message');
}

function createConfig(args: CliArgs): SeedConfig {
  const password =
    readString(args, 'password', process.env.LOAD_TEST_PASSWORD || 'load_password') ||
    'load_password';

  const rawSectionType = readString(args, 'section-type', 'READING')
    .trim()
    .toUpperCase();
  const sectionType: SeedConfig['sectionType'] =
    rawSectionType === 'LISTENING' ||
    rawSectionType === 'WRITING' ||
    rawSectionType === 'READING'
      ? rawSectionType
      : 'READING';

  const sectionAudioUrl = readString(args, 'audio-url', '').trim() || undefined;

  return {
    users: readNumber(args, 'users', 100, 1),
    prefix: readString(args, 'prefix', 'load_student_'),
    padWidth: readNumber(args, 'pad-width', 4, 1),
    password,
    centerName: readString(args, 'center-name', 'Load Test Center'),
    teacherUsername: readString(args, 'teacher', 'load_teacher'),
    sectionId: readString(args, 'section-id', 'load-reading-section'),
    sectionTitle: readString(args, 'section-title', 'Load Test Reading Section'),
    sectionType,
    sectionAudioUrl,
    sectionDurationMinutes: readNumber(args, 'duration', 180, 10),
    reset: readBoolean(args, 'reset', true),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const config = createConfig(args);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('Seeding load-test users and assignments...');

    if (config.reset) {
      const deletedUsers = await prisma.user.deleteMany({
        where: {
          username: { startsWith: config.prefix },
        },
      });

      console.log(`Removed existing load users: ${deletedUsers.count}`);
    }

    const center = await prisma.center.upsert({
      where: { name: config.centerName },
      update: {},
      create: {
        name: config.centerName,
      },
    });

    const passwordHash = await bcrypt.hash(config.password, 10);

    const teacher = await prisma.user.upsert({
      where: { username: config.teacherUsername },
      update: {
        password: passwordHash,
        centerId: center.id,
        role: Role.TEACHER,
      },
      create: {
        username: config.teacherUsername,
        password: passwordHash,
        role: Role.TEACHER,
        firstName: 'Load',
        lastName: 'Teacher',
        centerId: center.id,
      },
    });

    const section = await prisma.examSection.upsert({
      where: { id: config.sectionId },
      update: {
        title: config.sectionTitle,
        type: config.sectionType,
        duration: config.sectionDurationMinutes,
        audioUrl:
          config.sectionType === 'LISTENING' ? config.sectionAudioUrl || null : null,
        passages:
          config.sectionType === 'READING'
            ? ([
                {
                  id: 'load-passage-1',
                  title: 'Load Test Passage',
                  content:
                    'This passage exists to support synthetic load tests and does not represent production exam content.',
                },
              ] as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        teacherId: teacher.id,
        centerId: center.id,
      },
      create: {
        id: config.sectionId,
        title: config.sectionTitle,
        type: config.sectionType,
        description: 'Load test section for concurrency simulation',
        duration: config.sectionDurationMinutes,
        audioUrl:
          config.sectionType === 'LISTENING' ? config.sectionAudioUrl || null : null,
        teacherId: teacher.id,
        centerId: center.id,
        questions: [
          {
            id: 'q1',
            type: 'MCQ_SINGLE',
            questionText: 'Load question 1',
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
              { id: 'c', text: 'C' },
            ],
            correctAnswer: 'a',
            points: 1,
          },
          {
            id: 'q2',
            type: 'TRUE_FALSE_NOT_GIVEN',
            questionText: 'Load question 2',
            correctAnswer: 'TRUE',
            points: 1,
          },
          {
            id: 'q3',
            type: 'FILL_BLANK',
            questionText: 'Load question 3',
            correctAnswer: 'sample',
            points: 1,
          },
        ] as Prisma.InputJsonValue,
        passages:
          config.sectionType === 'READING'
            ? ([
                {
                  id: 'load-passage-1',
                  title: 'Load Test Passage',
                  content:
                    'This passage exists to support synthetic load tests and does not represent production exam content.',
                },
              ] as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });

    const usernames = Array.from({ length: config.users }, (_, index) => {
      const suffix = String(index + 1).padStart(config.padWidth, '0');
      return `${config.prefix}${suffix}`;
    });

    await prisma.user.createMany({
      data: usernames.map((username) => ({
        username,
        password: passwordHash,
        role: Role.STUDENT,
        centerId: center.id,
      })),
      skipDuplicates: true,
    });

    await prisma.user.updateMany({
      where: { username: { in: usernames } },
      data: {
        password: passwordHash,
        role: Role.STUDENT,
        centerId: center.id,
      },
    });

    const students = await prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });

    if (students.length !== config.users) {
      throw new Error(
        `Expected ${config.users} students, found ${students.length}`,
      );
    }

    const studentIds = students.map((student) => student.id);

    await prisma.examAssignment.updateMany({
      where: {
        sectionId: section.id,
        studentId: { in: studentIds },
      },
      data: {
        status: AssignmentStatus.ASSIGNED,
        startTime: null,
        endTime: null,
        answers: {} as Prisma.InputJsonValue,
        highlights: {} as Prisma.InputJsonValue,
        score: null,
      },
    });

    await prisma.examAssignment.createMany({
      data: studentIds.map((studentId) => ({
        studentId,
        sectionId: section.id,
        status: AssignmentStatus.ASSIGNED,
      })),
      skipDuplicates: true,
    });

    const assignmentCount = await prisma.examAssignment.count({
      where: {
        sectionId: section.id,
        studentId: { in: studentIds },
      },
    });

    console.log('');
    console.log('Load data seeded successfully.');
    console.log(`Center: ${center.name}`);
    console.log(`Section: ${section.id} (${section.title})`);
    console.log(`Teacher: ${teacher.username}`);
    console.log(`Students: ${students.length}`);
    console.log(`Assignments: ${assignmentCount}`);
    console.log('');
    console.log('Credentials:');
    console.log(`  username pattern: ${config.prefix}{index}`);
    console.log(`  password: ${config.password}`);
    console.log(`  first user: ${students[0]?.username || 'n/a'}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to seed load data:', error);
  process.exit(1);
});
