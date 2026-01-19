import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CentersService } from './centers.service';
import { CreateCenterDto, UpdateCenterDto } from './dto/center.dto';

@Controller('centers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CentersController {
  constructor(private centersService: CentersService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  create(@Body() createCenterDto: CreateCenterDto) {
    return this.centersService.create(createCenterDto);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  findAll() {
    return this.centersService.findAll();
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.CENTER_ADMIN, Role.TEACHER, Role.STUDENT)
  findOne(@Param('id') id: string) {
    return this.centersService.findOne(id);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() updateCenterDto: UpdateCenterDto) {
    return this.centersService.update(id, updateCenterDto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.centersService.remove(id);
  }
}
