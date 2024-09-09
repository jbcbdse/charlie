import winston from "winston";

export interface ILogger {
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  verbose: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}
type LogLevel = "error" | "warn" | "info" | "verbose" | "debug";
export class Logger implements ILogger {
  private logLevel: LogLevel;
  private logger: winston.Logger;
  constructor(options: { logLevel?: LogLevel } = {}) {
    this.logLevel = options.logLevel || "debug";
    this.logger = winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.simple(),
      ),
      transports: [
        new winston.transports.Console({
          stderrLevels: ["error", "warn", "info", "verbose", "debug"],
        }),
      ],
    });
  }
  public error(message: string, meta?: Record<string, unknown>) {
    this.logger.error(message, meta);
  }
  public warn(message: string, meta?: Record<string, unknown>) {
    this.logger.warn(message, meta);
  }
  public info(message: string, meta?: Record<string, unknown>) {
    this.logger.info(message, meta);
  }
  public verbose(message: string, meta?: Record<string, unknown>) {
    this.logger.verbose(message, meta);
  }
  public debug(message: string, meta?: Record<string, unknown>) {
    this.logger.debug(message, meta);
  }
}
