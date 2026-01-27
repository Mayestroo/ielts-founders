import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateUserDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CENTER_ADMIN)
  create(@Body() createUserDto: CreateUserDto, @Request() req) {
    return this.usersService.create(
      createUserDto,
      req.user.id,
      req.user.role,
      req.user.centerId,
    );
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CENTER_ADMIN, Role.TEACHER)
  findAll(
    @Request() req,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
    @Query('search') search?: string,
    @Query('role') role?: Role,
    @Query('centerId') centerId?: string,
  ) {
    return this.usersService.findAll(req.user.role, req.user.centerId, skip, take, search, role, centerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.usersService.findOne(id, req.user.id, req.user.role, req.user.centerId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req,
  ) {
    return this.usersService.update(
      id,
      updateUserDto,
      req.user.id,
      req.user.role,
      req.user.centerId,
    );
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.CENTER_ADMIN)
  remove(@Param('id') id: string, @Request() req) {
    return this.usersService.remove(id, req.user.id, req.user.role, req.user.centerId);
  }
}
