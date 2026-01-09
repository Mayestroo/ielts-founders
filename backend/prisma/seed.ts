import { PrismaPg } from '@prisma/adapter-pg';
import { AssignmentStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting full seed...');

  // 1. Create Center
  const center = await prisma.center.upsert({
    where: { name: 'IELTS Founders Academy' },
    update: {},
    create: { name: 'IELTS Founders Academy' },
  });
  console.log('✅ Center created');

  // 2. Create Users
  const password = await bcrypt.hash('password123', 10);
  
  const superAdmin = await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: {},
    create: {
      username: 'superadmin',
      password,
      firstName: 'Admin',
      lastName: 'User',
      role: Role.SUPER_ADMIN,
    },
  });

  const teacher = await prisma.user.upsert({
    where: { username: 'teacher' },
    update: {},
    create: {
      username: 'teacher',
      password,
      firstName: 'Sarah',
      lastName: 'Wilson',
      role: Role.TEACHER,
      centerId: center.id,
    },
  });

  const student1 = await prisma.user.upsert({
    where: { username: 'student' },
    update: {},
    create: {
      username: 'student',
      password,
      firstName: 'Alex',
      lastName: 'Chen',
      role: Role.STUDENT,
      centerId: center.id,
    },
  });

  const student2 = await prisma.user.upsert({
    where: { username: 'student2' },
    update: {},
    create: {
      username: 'student2',
      password,
      firstName: 'Maria',
      lastName: 'Garcia',
      role: Role.STUDENT,
      centerId: center.id,
    },
  });
  console.log('✅ Users created');

  // 3. Create Reading Exam
  const readingExam = await prisma.examSection.upsert({
    where: { id: 'reading-test-01' },
    update: {},
    create: {
      id: 'reading-test-01',
      title: 'IELTS Academic Reading Test 1',
      type: 'READING',
      description: 'Full 3-passage academic reading test. Topics: Urban Planning, Bee Conservation, History of Maps.',
      duration: 60,
      teacherId: teacher.id,
      centerId: center.id,
      passages: [
        {
          id: 'p1',
          title: 'Passage 1: The Future of Urban Planning',
          content: `Urban planning is reaching a critical turning point as cities around the globe face the dual challenges of rapid population growth and climate change. Traditional approaches to city design, often characterized by rigid zoning and car-centric infrastructure, are proving inadequate for the needs of modern urban dwellers. Instead, a new wave of urbanism is emerging, one that prioritizes sustainability, walkability, and social equity.

One of the central tenets of this new approach is the concept of the "15-minute city." Developed by scientist Carlos Moreno, this model proposes that all residents should be able to access their daily needs—work, school, shopping, and healthcare—within a 15-minute walk or bike ride from their homes. This vision starkly contrasts with the urban sprawl of the 20th century, which often forced residents to endure long commutes and isolated neighborhoods. Cities like Paris and Barcelona are already implementing variations of this model, redesigning streets to favor pedestrians over automobiles and creating mixed-use districts that blend residential, commercial, and recreational spaces.

Furthermore, the integration of green infrastructure is becoming paramount. "Sponge cities," a concept pioneered in China, utilize permeable pavements, rain gardens, and green roofs to absorb excess rainfall and reduce flood risks. This nature-based solution not only builds resilience against extreme weather events but also helps to mitigate the urban heat island effect, improving air quality and overall livability. As urban populations continue to swell, these innovative strategies offer a blueprint for creating resilient, inclusive, and thriving cities for the future.`
        },
        {
          id: 'p2',
          title: 'Passage 2: The Silent Crisis of Bee Conservation',
          content: `Bees are often heralded as the world's most important pollinators, responsible for pollinating nearly three-quarters of the plants that produce 90% of the world's food. However, bee populations are in precipitous decline, facing a multitude of threats from habitat loss, pesticide exposure, and disease. This phenomenon, often referred to as Colony Collapse Disorder, poses a severe threat to global food security and biodiversity.

A significant driver of this decline is the intensification of agriculture. Large-scale monocultures reduce the diversity of floral resources available to bees, leading to nutritional deficits. Moreover, the widespread use of neonicotinoid pesticides has been linked to impaired navigation and reproduction in bee colonies. Unlike contact pesticides, neonicotinoids are systemic, meaning they are absorbed by the plant and present in its pollen and nectar, turning the very food source of bees into a poison.

Conservationists are advocating for a multi-faceted approach to address this crisis. This includes promoting "pollinator-friendly" farming practices, such as planting wildflower strips along field margins and reducing pesticide usage. In urban areas, the "rewilding" of gardens and public parks can provide crucial sanctuaries for native bee species. Ultimately, saving the bees is not just an environmental issue but a humanitarian one, ensuring the sustainability of our food systems for generations to come.`
        },
        {
          id: 'p3',
          title: 'Passage 3: The Evolution of Cartography',
          content: `The history of mapmaking is a testament to humanity's enduring quest to understand and document the world. From the earliest clay tablets of Babylon to the sophisticated digital mapping systems of today, cartography has evolved from a symbolic art form into a precise science.

Ancient maps were often more philosophical than geographical. The "Mappa Mundi" of the Middle Ages, for instance, depicted the world with Jerusalem at the center, reflecting the religious worldview of the time rather than physical reality. It wasn't until the Age of Discovery in the 15th and 16th centuries that accuracy became paramount. Explorers and navigators needed charts that could reliably guide them across vast oceans, leading to the development of the Mercator projection, which revolutionized navigation by representing lines of constant course as straight segments.

In the modern era, the advent of aerial photography and satellite imagery has transformed our perspective yet again. We no longer rely on the reports of travelers but can view our planet from above with unprecedented clarity. Today, Geographic Information Systems (GIS) allow us to layer complex data sets onto maps, analyzing everything from traffic patterns to disease outbreaks. This shift has democratized cartography; with GPS-enabled smartphones, every individual is now both a map user and a potential mapmaker, contributing to a dynamic, real-time representation of our changing world.`
        }
      ],
      questions: [
        // Passage 1 Questions
        {
          id: 'q1',
          type: 'TRUE_FALSE_NOT_GIVEN',
          passageId: 'p1',
          questionRange: '1-6',
          instruction: 'Do the following statements agree with the information given in Reading Passage 1? In boxes 1-6 on your answer sheet, write **TRUE** if the statement agrees with the information, **FALSE** if the statement contradicts the information, **NOT GIVEN** if there is no information on this.',
          questionText: 'Traditional urban planning methods are sufficient for current population growth.',
          correctAnswer: 'FALSE',
          points: 1
        },
        {
          id: 'q2',
          type: 'TRUE_FALSE_NOT_GIVEN',
          passageId: 'p1',
          questionText: 'The 15-minute city concept aims to increase car dependency.',
          correctAnswer: 'FALSE',
          points: 1
        },
        {
          id: 'q3',
          type: 'FILL_BLANK',
          passageId: 'p1',
          questionRange: '7-13',
          instruction: 'Complete the notes below. Choose **ONE WORD ONLY** from the passage for each answer. Write your answers in boxes 7-13 on your answer sheet.',
          questionText: 'The "Sponge city" concept uses _____ pavements to absorb water.',
          correctAnswer: 'permeable',
          points: 1
        },
        // Passage 2 Questions
        {
          id: 'q4',
          type: 'MCQ_SINGLE',
          passageId: 'p2',
          questionText: 'What is identified as a major driver of bee decline?',
          options: [
             { id: 'a', text: 'Urbanization' },
             { id: 'b', text: 'Intensification of agriculture' },
             { id: 'c', text: 'Climate change' },
             { id: 'd', text: 'Overpopulation' }
          ],
          correctAnswer: 'b',
          points: 1
        },
        {
          id: 'q5',
          type: 'SHORT_ANSWER',
          passageId: 'p2',
          questionText: 'What type of pesticides are absorbed by plants and present in pollen?',
          correctAnswer: 'neonicotinoid',
          points: 1
        },
        // Passage 3 Questions
        {
          id: 'q6',
          type: 'MATCHING',
          passageId: 'p3',
          questionText: 'Match the era with its cartographic characteristic:',
          items: [
            { id: 'i1', text: 'Middle Ages' },
            { id: 'i2', text: 'Age of Discovery' },
            { id: 'i3', text: 'Modern Era' }
          ],
          matchOptions: [
            { id: 'o1', text: 'Religious worldview / Jerusalem at center' },
            { id: 'o2', text: 'Precise navigation / Mercator projection' },
            { id: 'o3', text: 'Satellite imagery / GIS' }
          ],
          correctAnswer: { 'i1': 'o1', 'i2': 'o2', 'i3': 'o3' },
          points: 3
        }
      ]
    },
  });
  console.log('✅ Reading Exam created');

  // 4. Create Listening Exam
  const listeningExam = await prisma.examSection.upsert({
    where: { id: 'listening-test-01' },
    update: {},
    create: {
      id: 'listening-test-01',
      title: 'IELTS Listening Practice 1',
      type: 'LISTENING',
      description: 'Standard 4-part listening test. Part 1: Hotel Booking, Part 2: University Orientation.',
      duration: 30,
      teacherId: teacher.id,
      centerId: center.id,
      audioUrl: 'https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav', // Sample placeholder audio
      questions: [
        {
          id: 'lq1',
          type: 'FILL_BLANK',
          questionRange: '1-10',
          instruction: 'Complete the notes below. Write **NO MORE THAN TWO WORDS** for each answer.',
          questionText: 'Customer Name: _____ Smith',
          correctAnswer: 'John',
          points: 1
        },
        {
          id: 'lq2',
          type: 'MCQ_SINGLE',
          questionText: 'How many nights does the guest want to stay?',
          options: [
            { id: 'a', text: 'Two nights' },
            { id: 'b', text: 'Three nights' },
            { id: 'c', text: 'Four nights' }
          ],
          correctAnswer: 'b',
          points: 1
        },
        {
          id: 'lq3',
          type: 'MCQ_MULTIPLE',
          questionText: 'Which facilities are included in the price? (Select two)',
          options: [
            { id: 'a', text: 'Breakfast' },
            { id: 'b', text: 'Gym access' },
            { id: 'c', text: 'Spa treatment' },
            { id: 'd', text: 'Airport shuttle' },
            { id: 'e', text: 'Dinner' }
          ],
          correctAnswer: ['a', 'b'],
          points: 2
        }
      ]
    },
  });
  console.log('✅ Listening Exam created');

  // 5. Create Writing Exam
  const writingExam = await prisma.examSection.upsert({
    where: { id: 'writing-test-01' },
    update: {},
    create: {
      id: 'writing-test-01',
      title: 'IELTS Academic Writing Task 1 & 2',
      type: 'WRITING',
      description: 'Task 1: Bar Chart on Global Energy Consumption. Task 2: Essay on Remote Work.',
      duration: 60,
      teacherId: teacher.id,
      centerId: center.id,
      questions: [
        {
             id: 'wq1',
             type: 'SHORT_ANSWER',
             questionRange: 'Task 1',
             instruction: 'You should spend about 20 minutes on this task.',
             questionText: 'The bar chart below shows the global energy consumption by source in 2000 and 2020. Summarize the information by selecting and reporting the main features, and make comparisons where relevant. (Write at least 150 words)',
             points: 10,
             correctAnswer: 'N/A'
        },
        {
             id: 'wq2',
             type: 'SHORT_ANSWER',
             questionText: 'Task 2: Many people argue that remote work has improved the quality of life for employees, while others believe it has blurred the lines between work and personal life. Discuss both views and give your own opinion. (Write at least 250 words)',
             points: 20,
             correctAnswer: 'N/A'
        }
      ]
    },
  });
  console.log('✅ Writing Exam created');

  // 6. Assign Exams
  await prisma.examAssignment.createMany({
    data: [
      {
        studentId: student1.id,
        sectionId: readingExam.id,
        status: AssignmentStatus.ASSIGNED,
      },
      {
        studentId: student1.id,
        sectionId: listeningExam.id,
        status: AssignmentStatus.IN_PROGRESS,
        startTime: new Date(),
      },
      {
        studentId: student2.id,
        sectionId: readingExam.id,
        status: AssignmentStatus.SUBMITTED,
        score: 6,
        startTime: new Date(Date.now() - 86400000), // yesterday
        endTime: new Date(Date.now() - 82800000),
      }
    ],
    skipDuplicates: true,
  });
  console.log('✅ Assignments created');

  // 7. Create Historical Results
  await prisma.examResult.createMany({
    data: [
      {
        studentId: student2.id, // Maria
        sectionId: readingExam.id,
        score: 6,
        totalScore: 9, // Points total from seeding is 8 actually (3+2+3). Let's say 9 for simplicity.
        bandScore: 6.5,
        answers: { 'q1': 'FALSE', 'q2': 'TRUE', 'q3': 'permeable', 'q4': 'b', 'q5': 'neonicotinoid', 'q6': { 'i1': 'o1', 'i2': 'o2', 'i3': 'o3' } },
        submittedAt: new Date(Date.now() - 82800000),
      },
      {
         studentId: student1.id, // Alex (previous attempt)
         sectionId: listeningExam.id,
         score: 3,
         totalScore: 4,
         bandScore: 6.0,
         answers: { 'lq1': 'John', 'lq2': 'a', 'lq3': ['a'] },
         submittedAt: new Date(Date.now() - 172800000), // 2 days ago
      }
    ],
    skipDuplicates: true
  });
  console.log('✅ Historical Results created');

  console.log('\n🎉 Real Data Seed Complete!');
  console.log('------------------------------------------------');
  console.log('Credentials:');
  console.log('  SUPER_ADMIN: superadmin / password123');
  console.log('  TEACHER:     teacher / password123');
  console.log('  STUDENT 1:   student / password123 (Alex)');
  console.log('  STUDENT 2:   student2 / password123 (Maria)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
