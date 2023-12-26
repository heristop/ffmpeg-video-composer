import pino from 'pino';
import { injectable } from 'tsyringe';
import AbstractLogger from './AbstractLogger';
import { LogParams } from '@/core/types';

@injectable()
class PinoLogAdapter implements AbstractLogger {
  private logger = pino();

  debug(message: string, params?: LogParams): void {
    this.logger.debug({ ...params }, message);
  }

  info(message: string, params?: LogParams): void {
    this.logger.info({ ...params }, message);
  }

  error(message: string, params?: LogParams): void {
    this.logger.error({ ...params }, message);
  }
}

export default PinoLogAdapter;
