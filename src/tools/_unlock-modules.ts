import 'dotenv/config';
import { prisma as db } from '../shared/prisma.js';

async function unlock() {
  const tenant = await db.tenant.findFirst({ where: { companyName: 'Test Agri Co' } });
  if (!tenant) throw new Error('Tenant not found');
  const tid = tenant.id;

  let plan = await db.billingPlan.findUnique({ where: { name: 'Enterprise-Test' } });
  if (!plan) {
    plan = await db.billingPlan.create({
      data: {
        name: 'Enterprise-Test',
        description: 'Test plan with all modules',
        monthlyPrice: 0,
        annualPrice: 0,
        trialDays: 9999,
        isActive: true,
      },
    });
    console.log('Plan created:', plan.id);
  } else {
    console.log('Plan exists:', plan.id);
  }

  const modules = ['sales', 'purchase', 'accounting', 'inventory'];
  for (const m of modules) {
    await db.planFeature.upsert({
      where: { planId_feature: { planId: plan.id, feature: m } },
      update: { enabled: true },
      create: { planId: plan.id, feature: m, enabled: true },
    });
  }
  console.log('PlanFeatures set:', modules.join(', '));

  await db.tenantBillingSubscription.upsert({
    where: { tenantId: tid },
    update: { planId: plan.id },
    create: {
      tenantId: tid,
      planId: plan.id,
      billingCycle: 'MONTHLY',
      isInTrial: false,
    },
  });
  console.log('Subscription linked to tenant');
  console.log('DONE - all modules unlocked');
}

unlock()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
