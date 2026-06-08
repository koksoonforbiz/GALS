import { Controller, Get, Post, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { VlmService } from './vlm.service';
import type { VlmDescribePageDto } from './dto/vlm-describe-page.dto';
import type { UpdateVlmConfigDto } from './dto/update-vlm-config.dto';

@Controller('vlm')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VlmController {
  constructor(private readonly vlm: VlmService) {}

  /** Student calls this when a checked slide has sparse text. */
  @Post('describe-page')
  @Roles('student', 'teacher', 'admin')
  describePage(@Body() dto: VlmDescribePageDto, @Req() req: { user: { id: string } }) {
    return this.vlm.describePage(dto.base64, dto.courseId, req.user.id);
  }

  /** Student fetches the teacher's VLM config so the threshold + image
   *  size are respected client-side before sending the canvas. */
  @Get('config/course/:courseId')
  @Roles('student', 'teacher', 'admin')
  getConfigForCourse(@Param('courseId') courseId: string) {
    return this.vlm.getConfigForCourse(courseId);
  }

  /** Teacher reads their own VLM config. */
  @Get('config')
  @Roles('teacher', 'admin')
  getConfig(@Req() req: { user: { id: string } }) {
    return this.vlm.getConfig(req.user.id);
  }

  /** Teacher updates their VLM config. */
  @Patch('config')
  @Roles('teacher', 'admin')
  updateConfig(@Body() dto: UpdateVlmConfigDto, @Req() req: { user: { id: string } }) {
    return this.vlm.updateConfig(req.user.id, dto);
  }
}
