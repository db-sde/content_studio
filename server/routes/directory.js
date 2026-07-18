import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { listDirectoryEntries } from '../repositories/directoryRepo.js';

export const directoryRouter = Router();

// Backs the searchable Linked University / Linked Course dropdowns — small enough (every
// approved university/course, ever) to fetch in full and filter client-side rather than
// implementing server-side search-as-you-type.
directoryRouter.get('/', asyncRoute(async (req, res) => {
  const { pageType } = req.query;
  if (!['university', 'course'].includes(pageType)) {
    const err = new Error('pageType must be "university" or "course"'); err.status = 400; throw err;
  }
  res.json({ entries: await listDirectoryEntries(pageType) });
}));
