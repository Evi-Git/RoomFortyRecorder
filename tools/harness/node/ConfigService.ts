// Stand-in for config/ConfigService: reads the harness config object.
import { state } from './state';

export default class ConfigService {
  private static instance: ConfigService;

  static getInstance() {
    ConfigService.instance ??= new ConfigService();
    return ConfigService.instance;
  }

  get<T>(key: string): T {
    return state().config[key] as T;
  }

  set(key: string, value: unknown) {
    state().config[key] = value;
  }
}
