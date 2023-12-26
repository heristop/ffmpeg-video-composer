import { LogParams } from '@/core/types';

abstract class AbstractLogger {
  abstract debug(message: string, params?: LogParams): void;

  abstract info(message: string, params?: LogParams): void;

  abstract error(message: string, params?: LogParams): void;
}

export default AbstractLogger;
