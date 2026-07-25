import { Injectable } from '@nestjs/common';
import { LoggerService } from './common/logger/logger.service';

@Injectable()
export class AppService {
  constructor(private readonly logger: LoggerService) {}
  getHello(): string {
    this.logger.log({
      action: 'GET_HELLO',
      message: 'Returning hello message',
    });
    return 'Hello World!';
  }
}
