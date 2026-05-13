import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TimeOffRequest } from './entities/time-off-request.entity';

export interface ListRequestsFilter {
  employeeId?: string;
  locationId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class TimeOffRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(
    manager: EntityManager,
    id: string,
  ): Promise<TimeOffRequest | null> {
    return manager.findOne(TimeOffRequest, { where: { id } });
  }

  async findByIdempotencyKey(
    manager: EntityManager,
    key: string,
  ): Promise<TimeOffRequest | null> {
    return manager.findOne(TimeOffRequest, { where: { idempotencyKey: key } });
  }

  async create(
    manager: EntityManager,
    data: Partial<TimeOffRequest>,
  ): Promise<TimeOffRequest> {
    const entity = manager.create(TimeOffRequest, data);
    return manager.save(TimeOffRequest, entity);
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    patch: Partial<TimeOffRequest>,
  ): Promise<void> {
    await manager.update(TimeOffRequest, id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  async list(
    filter: ListRequestsFilter,
  ): Promise<{ rows: TimeOffRequest[]; total: number }> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const qb = this.dataSource.manager
      .createQueryBuilder(TimeOffRequest, 'req')
      .orderBy('req.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filter.employeeId)
      qb.andWhere('req.employeeId = :emp', { emp: filter.employeeId });
    if (filter.locationId)
      qb.andWhere('req.locationId = :loc', { loc: filter.locationId });
    if (filter.status)
      qb.andWhere('req.status = :status', { status: filter.status });

    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async sumPendingDays(
    manager: EntityManager,
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder(TimeOffRequest, 'req')
      .select('COALESCE(SUM(req.days), 0)', 'total')
      .where(
        'req.employeeId = :emp AND req.locationId = :loc AND req.leaveType = :type AND req.status = :status',
        {
          emp: employeeId,
          loc: locationId,
          type: leaveType,
          status: 'PENDING',
        },
      )
      .getRawOne<{ total: number }>();
    return Number(result?.total ?? 0);
  }
}
