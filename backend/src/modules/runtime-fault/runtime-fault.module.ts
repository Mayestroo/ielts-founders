import { Global, Module } from '@nestjs/common';
import { RuntimeFaultService } from './runtime-fault.service';

@Global()
@Module({
  providers: [RuntimeFaultService],
  exports: [RuntimeFaultService],
})
export class RuntimeFaultModule {}
