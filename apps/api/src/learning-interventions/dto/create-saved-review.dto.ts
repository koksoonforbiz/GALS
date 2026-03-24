import { InterventionType } from '@prisma/client';

export interface CreateSavedReviewDto {
  interventionId: string;
  interventionType: InterventionType;
  courseId: string;
  contentId?: string;
  pageType?: string;
  title: string;
  selectedText: string;
  savedData: object;
  notes?: string;
}
