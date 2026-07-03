const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, splat } = format;

const logFormat = printf(({ timestamp, level, message, ...rest }) => {
  const meta = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
  return `${timestamp} [${level}]: ${message}${meta}`;
});

const logger = createLogger({
  format: combine(timestamp(), splat(), logFormat),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp(), splat(), logFormat),
    }),
  ],
});

module.exports = logger;
