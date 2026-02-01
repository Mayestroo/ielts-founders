import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { HttpModule } from '../../common/http/http.module';

@Module({
  imports: [HttpModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
