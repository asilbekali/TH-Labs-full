import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface LogOptions {
  action: string;
  message: string;
  userId?: string | number;
  email?: string;
  ip?: string;
  status?: 'SUCCESS' | 'FAILED' | 'WARNING' | 'INFO';
  metadata?: Record<string, any>;
}

@Injectable()
export class LoggerService {
  private readonly logger = new Logger('TH-LABS');

  private readonly logsDir = path.join(process.cwd(), 'logs');
  private readonly appLog = path.join(this.logsDir, 'app.log');
  private readonly errorLog = path.join(this.logsDir, 'error.log');
  private readonly auditLog = path.join(this.logsDir, 'audit.log');

  constructor() {
    this.initializeLogs();
  }

  /**
   * Create logs directory
   */
  private initializeLogs() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Format log message
   */
  private formatLog(data: LogOptions): string {
    return JSON.stringify(
      {
        time: new Date().toISOString(),
        action: data.action,
        message: data.message,
        userId: data.userId ?? null,
        email: data.email ?? null,
        ip: data.ip ?? null,
        status: data.status ?? 'INFO',
        metadata: data.metadata ?? {},
      },
      null,
      2,
    );
  }

  /**
   * Write to file
   */
  private write(file: string, data: LogOptions) {
    fs.appendFileSync(file, this.formatLog(data) + '\n\n');
  }

  /**
   * General application log
   */
  log(data: LogOptions) {
    this.logger.log(data.message);

    this.write(this.appLog, data);
  }

  /**
   * Audit log
   */
  audit(data: LogOptions) {
    this.logger.log(`[AUDIT] ${data.message}`);

    this.write(this.auditLog, data);
  }

  /**
   * Error log
   */
  error(message: string, trace?: string, metadata?: Record<string, any>) {
    this.logger.error(message, trace);

    this.write(this.errorLog, {
      action: 'ERROR',
      message,
      status: 'FAILED',
      metadata: {
        trace,
        ...metadata,
      },
    });
  }

  /**
   * Warning
   */
  warn(message: string, metadata?: Record<string, any>) {
    this.logger.warn(message);

    this.write(this.appLog, {
      action: 'WARNING',
      message,
      status: 'WARNING',
      metadata,
    });
  }

  /**
   * Debug
   */
  debug(message: string, metadata?: Record<string, any>) {
    this.logger.debug(message);

    this.write(this.appLog, {
      action: 'DEBUG',
      message,
      metadata,
    });
  }

  /**
   * Login Log
   */
  login(userId: number | string, email: string, ip: string) {
    this.audit({
      action: 'LOGIN',
      message: `${email} logged in.`,
      userId,
      email,
      ip,
      status: 'SUCCESS',
    });
  }

  /**
   * Logout Log
   */
  logout(userId: number | string, email: string, ip: string) {
    this.audit({
      action: 'LOGOUT',
      message: `${email} logged out.`,
      userId,
      email,
      ip,
      status: 'SUCCESS',
    });
  }

  /**
   * Email Log
   */
  email(to: string, subject: string) {
    this.audit({
      action: 'EMAIL_SENT',
      message: `Email sent to ${to}`,
      email: to,
      status: 'SUCCESS',
      metadata: {
        subject,
      },
    });
  }

  /**
   * Payment Log
   */
  payment(userId: number | string, amount: number, currency = 'USD') {
    this.audit({
      action: 'PAYMENT',
      message: `Payment completed.`,
      userId,
      status: 'SUCCESS',
      metadata: {
        amount,
        currency,
      },
    });
  }

  /**
   * AI Dubbing Log
   */
  dubbing(userId: number | string, video: string, language: string) {
    this.audit({
      action: 'AI_DUBBING',
      message: `AI dubbing started.`,
      userId,
      status: 'SUCCESS',
      metadata: {
        video,
        language,
      },
    });
  }
}
