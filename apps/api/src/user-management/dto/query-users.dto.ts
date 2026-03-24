export class QueryUsersDto {
  courseId?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'lastActive' | 'cost' | 'joinedAt';
  sortOrder?: 'asc' | 'desc';
}
