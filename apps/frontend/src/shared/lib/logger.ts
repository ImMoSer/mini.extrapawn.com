const IS_DEV_MODE = import.meta.env.MODE === 'development'

const logger = {
  log: (...args: unknown[]): void => {
    if (IS_DEV_MODE) {
      console.log('[LOG]', ...args)
    }
  },
  info: (...args: unknown[]): void => {
    if (IS_DEV_MODE) {
      console.info('[INFO]', ...args)
    }
  },
  warn: (...args: unknown[]): void => {
    if (IS_DEV_MODE) {
      console.warn('[WARN]', ...args)
    }
  },
  error: (...args: unknown[]): void => {
    console.error('[ERROR]', ...args)
  },
  debug: (...args: unknown[]): void => {
    if (IS_DEV_MODE) {
      console.debug('[DEBUG]', ...args)
    }
  },
}

export default logger

