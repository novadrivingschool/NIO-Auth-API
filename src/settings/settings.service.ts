import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DevicesRegistry } from '../devices/devices.registry';
import { AppSetting } from './entities/app-setting.entity';
import {
  CAPTURE_INTERVAL_DEFAULT_SECONDS,
  CAPTURE_INTERVAL_EVENT,
  CAPTURE_INTERVAL_KEY,
  CAPTURE_INTERVAL_MAX_SECONDS,
  CAPTURE_INTERVAL_MIN_SECONDS,
} from './settings.constants';

export interface CaptureIntervalSetting {
  seconds: number;
  updatedAt: string | null;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
    private readonly registry: DevicesRegistry,
  ) {}

  async getCaptureInterval(): Promise<CaptureIntervalSetting> {
    const row = await this.repo.findOne({ where: { key: CAPTURE_INTERVAL_KEY } });
    const seconds = Number(row?.value);
    return {
      seconds: this.isValid(seconds) ? seconds : CAPTURE_INTERVAL_DEFAULT_SECONDS,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  async setCaptureInterval(
    seconds: number,
    userId: string | null,
  ): Promise<CaptureIntervalSetting> {
    if (!this.isValid(seconds)) {
      throw new BadRequestException(
        `seconds debe ser un entero múltiplo de 60 entre ${CAPTURE_INTERVAL_MIN_SECONDS} y ${CAPTURE_INTERVAL_MAX_SECONDS}`,
      );
    }

    await this.repo.save({ key: CAPTURE_INTERVAL_KEY, value: seconds, updatedBy: userId });
    const current = await this.getCaptureInterval();

    // Avisa a todos los dispositivos conectados. Los que estén offline lo
    // leerán por HTTP en su próximo clock-in / reconexión.
    const sent = this.registry.broadcast(CAPTURE_INTERVAL_EVENT, current);
    this.logger.log(
      `capture interval → ${current.seconds}s por ${userId ?? 'desconocido'} (broadcast=${sent})`,
    );
    return current;
  }

  private isValid(seconds: number): boolean {
    return (
      Number.isInteger(seconds) &&
      seconds >= CAPTURE_INTERVAL_MIN_SECONDS &&
      seconds <= CAPTURE_INTERVAL_MAX_SECONDS &&
      seconds % 60 === 0
    );
  }
}
