const isDev = process.env.NODE_ENV !== 'production'

const ts = () => new Date().toISOString().slice(11, 23)

const logger = {
  info:  (...a) => console.log( `[${ts()}] [INFO ]`, ...a),
  warn:  (...a) => console.warn(`[${ts()}] [WARN ]`, ...a),
  error: (...a) => console.error(`[${ts()}] [ERROR]`, ...a),
  debug: (...a) => { if (isDev) console.log(`[${ts()}] [DEBUG]`, ...a) },
}

module.exports = logger
