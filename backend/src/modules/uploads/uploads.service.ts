import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadsService {
  private readonly uploadPath = path.join(process.cwd(), 'uploads');

  constructor(private readonly configService: ConfigService) {
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  getFilePath(filename: string): string {
    return path.join(this.uploadPath, filename);
  }

  getFileUrl(filename: string): string {
    const baseUrl = this.configService.get('BACKEND_URL') || 'http://localhost:3000';
    return `${baseUrl}/uploads/${filename}`;
  }
}
