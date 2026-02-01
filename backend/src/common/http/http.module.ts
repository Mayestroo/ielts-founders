import { Module } from '@nestjs/common';
import { HttpModule as NestHttpModule } from '@nestjs/axios';
import { AxiosHttpClient } from './axios-http.client';

@Module({
  imports: [NestHttpModule],
  providers: [
    {
      provide: 'HttpClient',
      useClass: AxiosHttpClient,
    },
  ],
  exports: ['HttpClient'],
})
export class HttpModule {}
