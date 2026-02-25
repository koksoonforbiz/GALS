import { IsEmail, IsString, IsArray, ArrayMinSize, MinLength } from 'class-validator';

export class AddStudentDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  courseIds: string[];
}

export class BulkAddStudentsDto {
  @IsArray()
  @ArrayMinSize(1)
  students: Array<{ email: string; name: string }>;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  courseIds: string[];
}
