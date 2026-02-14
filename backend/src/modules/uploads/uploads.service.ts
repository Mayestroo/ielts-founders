import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec as execCallback } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const exec = promisify(execCallback);

@Injectable()
export class UploadsService {
  private readonly uploadPath = path.join(process.cwd(), 'uploads');
  private readonly maxUploadBytes = 200 * 1024 * 1024;

  constructor(private readonly configService: ConfigService) {
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  getFilePath(filename: string): string {
    return path.join(this.uploadPath, filename);
  }

  getFileUrl(filename: string): string {
    const baseUrl =
      this.configService.get('BACKEND_URL') || 'http://localhost:3000';
    return `${baseUrl}/uploads/${filename}`;
  }

  async validateUploadedFile(file: Express.Multer.File): Promise<void> {
    const pathToFile = this.getFilePath(file.filename);

    const fileHandle = await fs.promises.open(pathToFile, 'r');
    let header = Buffer.alloc(0);

    try {
      const metadata = await fileHandle.stat();
      if (metadata.size <= 0 || metadata.size > this.maxUploadBytes) {
        await fs.promises.unlink(pathToFile).catch(() => undefined);
        throw new BadRequestException('Invalid file size');
      }

      const headerBuffer = Buffer.alloc(16);
      const { bytesRead } = await fileHandle.read(
        headerBuffer,
        0,
        headerBuffer.length,
        0,
      );
      header = headerBuffer.subarray(0, bytesRead);
    } finally {
      await fileHandle.close().catch(() => undefined);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();

    const detectedType = this.detectFileType(header);
    const allowedByExt = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.mp3',
      '.wav',
      '.ogg',
      '.opus',
    ];
    const allowedByMime = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/ogg',
      'audio/opus',
      'application/ogg',
    ];

    if (
      !detectedType ||
      !allowedByExt.includes(ext) ||
      !allowedByMime.includes(mime)
    ) {
      await fs.promises.unlink(pathToFile).catch(() => undefined);
      throw new BadRequestException('Unsupported or invalid file type');
    }

    const expected = this.fileTypeFromExtension(ext);
    if (expected !== detectedType) {
      await fs.promises.unlink(pathToFile).catch(() => undefined);
      throw new BadRequestException('File content does not match extension');
    }

    await this.runOptionalMalwareScan(pathToFile);
  }

  private async runOptionalMalwareScan(pathToFile: string): Promise<void> {
    const scanCommand = this.configService.get<string>('UPLOAD_SCAN_COMMAND');
    if (!scanCommand) {
      return;
    }

    const escapedPath = pathToFile.replace(/"/g, '\\"');
    const command = scanCommand.includes('{file}')
      ? scanCommand.replaceAll('{file}', `"${escapedPath}"`)
      : `${scanCommand} "${escapedPath}"`;

    try {
      await exec(command, { timeout: 20000 });
    } catch {
      await fs.promises.unlink(pathToFile).catch(() => undefined);
      throw new BadRequestException('File failed malware scan');
    }
  }

  private fileTypeFromExtension(ext: string): string | null {
    if (ext === '.jpg' || ext === '.jpeg') return 'jpeg';
    if (ext === '.png') return 'png';
    if (ext === '.gif') return 'gif';
    if (ext === '.mp3') return 'mp3';
    if (ext === '.wav') return 'wav';
    if (ext === '.ogg' || ext === '.opus') return 'ogg';
    return null;
  }

  private detectFileType(buffer: Buffer): string | null {
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'png';
    }

    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'jpeg';
    }

    if (
      buffer.length >= 6 &&
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) &&
      buffer[5] === 0x61
    ) {
      return 'gif';
    }

    if (
      buffer.length >= 4 &&
      buffer[0] === 0x4f &&
      buffer[1] === 0x67 &&
      buffer[2] === 0x67 &&
      buffer[3] === 0x53
    ) {
      return 'ogg';
    }

    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x41 &&
      buffer[10] === 0x56 &&
      buffer[11] === 0x45
    ) {
      return 'wav';
    }

    if (
      (buffer.length >= 3 &&
        buffer[0] === 0x49 &&
        buffer[1] === 0x44 &&
        buffer[2] === 0x33) ||
      (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    ) {
      return 'mp3';
    }

    return null;
  }
}
