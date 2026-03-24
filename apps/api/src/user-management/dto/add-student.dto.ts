export interface AddStudentDto {
  name: string;
  email: string;
  courseIds: string[];
}

export interface BulkAddStudentsDto {
  students: Array<{ email: string; name: string }>;
  courseIds: string[];
}
