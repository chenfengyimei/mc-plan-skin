/**
 * 可注入时钟。所有涉及过期、保留和会话生命周期的逻辑都必须依赖此接口，
 * 使测试可以用固定时钟验证“30 天对话、24 小时候选”等时间规则。
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** 测试用固定时钟。 */
export class FixedClock implements Clock {
  private readonly instant: Date;

  constructor(instant: Date) {
    this.instant = instant;
  }

  now(): Date {
    return new Date(this.instant.getTime());
  }
}
