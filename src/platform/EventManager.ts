import { EventEmitter } from 'events';
import { singleton } from 'tsyringe';

@singleton()
export default class EventManager {
  private emitter: EventEmitter | null = null;

  public connect(): EventEmitter {
    this.emitter = new EventEmitter();

    return this.emitter;
  }
}
