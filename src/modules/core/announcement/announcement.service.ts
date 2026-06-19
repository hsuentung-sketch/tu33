import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(tenantId: string, opts: { includeExpired?: boolean } = {}) {
  const now = new Date();
  return prisma.announcement.findMany({
    where: {
      tenantId,
      isPublished: true,
      ...(!opts.includeExpired
        ? { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
        : {}),
    },
    orderBy: { publishedAt: 'desc' },
  });
}

export async function listAll(tenantId: string) {
  return prisma.announcement.findMany({
    where: { tenantId },
    orderBy: { publishedAt: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.announcement.findFirst({ where: { id, tenantId } });
  if (!row) throw new NotFoundError('Announcement', id);
  return row;
}

export interface AnnouncementInput {
  title: string;
  content: string;
  priority?: string;
  isPublished?: boolean;
  publishedAt?: Date;
  expiresAt?: Date | null;
}

export async function create(tenantId: string, createdBy: string, data: AnnouncementInput) {
  return prisma.announcement.create({
    data: {
      tenantId,
      createdBy,
      title: data.title,
      content: data.content,
      priority: data.priority ?? 'normal',
      isPublished: data.isPublished ?? true,
      publishedAt: data.publishedAt ?? new Date(),
      expiresAt: data.expiresAt ?? null,
    },
  });
}

export async function update(tenantId: string, id: string, data: Partial<AnnouncementInput>) {
  await getById(tenantId, id);
  return prisma.announcement.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
      ...(data.publishedAt !== undefined ? { publishedAt: data.publishedAt } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
    },
  });
}

export async function remove(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.announcement.delete({ where: { id } });
}
