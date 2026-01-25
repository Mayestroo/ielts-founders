import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const results = await prisma.examResult.findMany({
    orderBy: { submittedAt: 'desc' },
    take: 5,
    include: { section: true }
  });
  console.log(JSON.stringify(results, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
