import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UploadsService } from './uploads.service';

@Controller('uploads')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CENTER_ADMIN, Role.TEACHER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (
          file.mimetype.match(/\/(jpg|jpeg|png|gif|mp3|mpeg|wav|ogg|opus)$/i)
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Unsupported file type'), false);
        }
      },
      limits: {
        fileSize: 200 * 1024 * 1024, // 200MB
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    await this.uploadsService.validateUploadedFile(file);

    return {
      url: this.uploadsService.getFileUrl(file.filename),
    };
  }

  @Post('speaking')
  @Roles(Role.STUDENT, Role.SUPER_ADMIN, Role.CENTER_ADMIN, Role.TEACHER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (file.mimetype.match(/\/(webm|mp4|mpeg|wav|ogg|opus|x-m4a)$/i)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Unsupported audio file type'), false);
        }
      },
      limits: {
        fileSize: 200 * 1024 * 1024,
      },
    }),
  )
  async uploadSpeakingAudio(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    await this.uploadsService.validateUploadedFile(file);

    return {
      url: this.uploadsService.getFileUrl(file.filename),
    };
  }
}
